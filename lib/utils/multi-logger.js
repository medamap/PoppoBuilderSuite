/**
 * Multi-Project Logger
 * グローバルログとプロジェクト別ログを効率的に管理
 */

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const { createWriteStream } = require('fs');
const { once } = require('events');

class MultiLogger extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      globalLogDir: options.globalLogDir || path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'logs'),
      logLevel: options.logLevel || 'info',
      maxFileSize: options.maxFileSize || 100 * 1024 * 1024, // 100MB
      maxFiles: options.maxFiles || 10,
      datePattern: options.datePattern || 'YYYY-MM-DD',
      enableRotation: options.enableRotation !== false,
      enableCompression: options.enableCompression !== false,
      compressionLevel: options.compressionLevel || 6,
      format: options.format || 'json',
      ...options
    };
    
    this.logLevels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };
    
    this.streams = new Map(); // logId -> stream
    this.projectLoggers = new Map(); // projectId -> logger info
    this.rotationTimers = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize multi-logger
   */
  async initialize() {
    if (this.isInitialized) return;
    
    // グローバルログディレクトリの作成
    await fs.mkdir(this.options.globalLogDir, { recursive: true });
    
    // グローバルログの初期化
    await this.initializeGlobalLogs();
    
    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * Initialize global logs
   * @private
   */
  async initializeGlobalLogs() {
    // デーモンログ
    await this.createLogger('daemon', {
      filePath: path.join(this.options.globalLogDir, 'daemon.log'),
      isGlobal: true
    });
    
    // グローバルログ
    await this.createLogger('global', {
      filePath: path.join(this.options.globalLogDir, 'global.log'),
      isGlobal: true
    });
  }

  /**
   * Register a project logger
   * @param {string} projectId - Project identifier
   * @param {string} projectPath - Project path
   */
  async registerProject(projectId, projectPath) {
    const logDir = path.join(projectPath, '.poppobuilder', 'logs');
    await fs.mkdir(logDir, { recursive: true });
    
    const logFile = path.join(logDir, 'project.log');
    
    await this.createLogger(`project:${projectId}`, {
      filePath: logFile,
      isGlobal: false,
      projectId
    });
    
    this.projectLoggers.set(projectId, {
      id: projectId,
      path: projectPath,
      logDir,
      logFile
    });
    
    this.emit('project-registered', { projectId });
  }

  /**
   * Unregister a project logger
   * @param {string} projectId - Project identifier
   */
  async unregisterProject(projectId) {
    const loggerId = `project:${projectId}`;
    
    await this.closeLogger(loggerId);
    this.projectLoggers.delete(projectId);
    
    this.emit('project-unregistered', { projectId });
  }

  /**
   * Create a logger
   * @private
   */
  async createLogger(loggerId, options) {
    const { filePath, isGlobal, projectId } = options;
    
    // ストリームの作成
    const stream = createWriteStream(filePath, {
      flags: 'a', // append
      encoding: 'utf8',
      highWaterMark: 16384
    });
    
    // ストリームが準備できるまで待つ
    await once(stream, 'open');
    
    this.streams.set(loggerId, {
      id: loggerId,
      stream,
      filePath,
      isGlobal,
      projectId,
      bytesWritten: 0,
      linesWritten: 0,
      createdAt: Date.now()
    });
    
    // ローテーションの設定
    if (this.options.enableRotation) {
      this.setupRotation(loggerId);
    }
    
    return stream;
  }

  /**
   * Close a logger
   * @private
   */
  async closeLogger(loggerId) {
    const loggerInfo = this.streams.get(loggerId);
    if (!loggerInfo) return;
    
    // ローテーションタイマーの停止
    const timer = this.rotationTimers.get(loggerId);
    if (timer) {
      clearInterval(timer);
      this.rotationTimers.delete(loggerId);
    }
    
    // ストリームのクローズ
    await new Promise((resolve) => {
      loggerInfo.stream.end(resolve);
    });
    
    this.streams.delete(loggerId);
  }

  /**
   * Log a message
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} options - Log options
   */
  async log(level, message, options = {}) {
    if (!this.shouldLog(level)) return;
    
    const logEntry = this.formatLogEntry(level, message, options);
    
    // グローバルログに書き込み
    if (options.global !== false) {
      await this.writeLog('global', logEntry);
    }
    
    // デーモンログに書き込み（デーモン関連の場合）
    if (options.daemon) {
      await this.writeLog('daemon', logEntry);
    }
    
    // プロジェクトログに書き込み
    if (options.projectId) {
      await this.writeLog(`project:${options.projectId}`, logEntry);
    }
    
    // すべてのプロジェクトに書き込み（ブロードキャスト）
    if (options.broadcast) {
      for (const projectId of this.projectLoggers.keys()) {
        await this.writeLog(`project:${projectId}`, logEntry);
      }
    }
    
    this.emit('log-written', {
      level,
      message,
      options,
      logEntry
    });
  }

  /**
   * Write log to stream
   * @private
   */
  async writeLog(loggerId, logEntry) {
    const loggerInfo = this.streams.get(loggerId);
    if (!loggerInfo) return;
    
    const logLine = this.options.format === 'json' 
      ? JSON.stringify(logEntry) + '\n'
      : this.formatTextLog(logEntry) + '\n';
    
    const buffer = Buffer.from(logLine);
    
    // ストリームに書き込み
    const success = loggerInfo.stream.write(buffer);
    
    if (!success) {
      // バックプレッシャーを待つ
      await once(loggerInfo.stream, 'drain');
    }
    
    // 統計を更新
    loggerInfo.bytesWritten += buffer.length;
    loggerInfo.linesWritten++;
    
    // ローテーションチェック
    if (this.options.enableRotation && loggerInfo.bytesWritten >= this.options.maxFileSize) {
      await this.rotateLog(loggerId);
    }
  }

  /**
   * Format log entry
   * @private
   */
  formatLogEntry(level, message, options) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      pid: process.pid,
      hostname: require('os').hostname()
    };
    
    // メタデータを追加
    if (options.metadata) {
      entry.metadata = options.metadata;
    }
    
    if (options.projectId) {
      entry.projectId = options.projectId;
    }
    
    if (options.component) {
      entry.component = options.component;
    }
    
    if (options.error && options.error instanceof Error) {
      entry.error = {
        message: options.error.message,
        stack: options.error.stack,
        code: options.error.code
      };
    }
    
    return entry;
  }

  /**
   * Format text log
   * @private
   */
  formatTextLog(entry) {
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const timestamp = entry.timestamp;
    const component = entry.component ? `[${entry.component}]` : '';
    const project = entry.projectId ? `[${entry.projectId}]` : '';
    
    let message = `${timestamp} ${levelStr} ${component}${project} ${entry.message}`;
    
    if (entry.error) {
      message += `\n  Error: ${entry.error.message}`;
      if (entry.error.stack) {
        message += `\n  Stack: ${entry.error.stack.split('\n').join('\n         ')}`;
      }
    }
    
    return message;
  }

  /**
   * Should log based on level
   * @private
   */
  shouldLog(level) {
    const currentLevel = this.logLevels[this.options.logLevel] || 2;
    const messageLevel = this.logLevels[level] || 2;
    return messageLevel <= currentLevel;
  }

  /**
   * Setup log rotation
   * @private
   */
  setupRotation(loggerId) {
    // 日次ローテーションのチェック
    const checkInterval = 60 * 60 * 1000; // 1時間ごとにチェック
    
    const timer = setInterval(async () => {
      const loggerInfo = this.streams.get(loggerId);
      if (!loggerInfo) {
        clearInterval(timer);
        return;
      }
      
      // ファイルサイズチェック
      if (loggerInfo.bytesWritten >= this.options.maxFileSize) {
        await this.rotateLog(loggerId);
      }
      
      // 日付チェック
      const shouldRotateByDate = await this.shouldRotateByDate(loggerId);
      if (shouldRotateByDate) {
        await this.rotateLog(loggerId);
      }
    }, checkInterval);
    
    this.rotationTimers.set(loggerId, timer);
  }

  /**
   * Check if should rotate by date
   * @private
   */
  async shouldRotateByDate(loggerId) {
    const loggerInfo = this.streams.get(loggerId);
    if (!loggerInfo) return false;
    
    try {
      const stats = await fs.stat(loggerInfo.filePath);
      const fileDate = new Date(stats.birthtime);
      const currentDate = new Date();
      
      // 日付が変わったかチェック
      return fileDate.toDateString() !== currentDate.toDateString();
    } catch (error) {
      return false;
    }
  }

  /**
   * Rotate log file
   * @private
   */
  async rotateLog(loggerId) {
    const loggerInfo = this.streams.get(loggerId);
    if (!loggerInfo) return;
    
    try {
      // ストリームを一時的にクローズ
      await new Promise((resolve) => {
        loggerInfo.stream.end(resolve);
      });
      
      // ローテーション実行
      await this.performRotation(loggerInfo);
      
      // 新しいストリームを作成
      const newStream = createWriteStream(loggerInfo.filePath, {
        flags: 'a',
        encoding: 'utf8'
      });
      
      await once(newStream, 'open');
      
      // ストリーム情報を更新
      loggerInfo.stream = newStream;
      loggerInfo.bytesWritten = 0;
      loggerInfo.linesWritten = 0;
      
      this.emit('log-rotated', {
        loggerId,
        filePath: loggerInfo.filePath
      });
      
    } catch (error) {
      console.error(`Failed to rotate log ${loggerId}:`, error);
      this.emit('rotation-error', {
        loggerId,
        error
      });
    }
  }

  /**
   * Perform log rotation
   * @private
   */
  async performRotation(loggerInfo) {
    const { filePath } = loggerInfo;
    const dir = path.dirname(filePath);
    const basename = path.basename(filePath, '.log');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotatedFile = path.join(dir, `${basename}.${timestamp}.log`);
    
    // ファイルをリネーム
    await fs.rename(filePath, rotatedFile);
    
    // 圧縮が有効な場合
    if (this.options.enableCompression) {
      await this.compressLog(rotatedFile);
    }
    
    // 古いファイルの削除
    await this.cleanupOldLogs(dir, basename);
  }

  /**
   * Compress log file
   * @private
   */
  async compressLog(filePath) {
    const zlib = require('zlib');
    const { pipeline } = require('stream');
    const { promisify } = require('util');
    const pipelineAsync = promisify(pipeline);
    
    const gzipFile = `${filePath}.gz`;
    const readStream = require('fs').createReadStream(filePath);
    const writeStream = require('fs').createWriteStream(gzipFile);
    const gzip = zlib.createGzip({ level: this.options.compressionLevel });
    
    await pipelineAsync(readStream, gzip, writeStream);
    
    // 元のファイルを削除
    await fs.unlink(filePath);
  }

  /**
   * Cleanup old log files
   * @private
   */
  async cleanupOldLogs(dir, basename) {
    const files = await fs.readdir(dir);
    const logFiles = files
      .filter(f => f.startsWith(basename) && (f.endsWith('.log') || f.endsWith('.log.gz')))
      .sort()
      .reverse();
    
    // maxFilesを超えるファイルを削除
    if (logFiles.length > this.options.maxFiles) {
      const filesToDelete = logFiles.slice(this.options.maxFiles);
      
      for (const file of filesToDelete) {
        try {
          await fs.unlink(path.join(dir, file));
          this.emit('log-deleted', { file });
        } catch (error) {
          console.error(`Failed to delete old log ${file}:`, error);
        }
      }
    }
  }

  /**
   * Helper methods for different log levels
   */
  async error(message, options = {}) {
    await this.log('error', message, options);
  }

  async warn(message, options = {}) {
    await this.log('warn', message, options);
  }

  async info(message, options = {}) {
    await this.log('info', message, options);
  }

  async debug(message, options = {}) {
    await this.log('debug', message, options);
  }

  async trace(message, options = {}) {
    await this.log('trace', message, options);
  }

  /**
   * Set the log level dynamically
   * @param {string} level - New log level
   */
  setLevel(level) {
    if (this.logLevels.hasOwnProperty(level)) {
      this.options.logLevel = level;
      this.emit('level-changed', { level });
    } else {
      throw new Error(`Invalid log level: ${level}. Valid levels are: ${Object.keys(this.logLevels).join(', ')}`);
    }
  }

  /**
   * Get log statistics
   */
  getStats() {
    const stats = {
      loggers: {},
      totals: {
        bytesWritten: 0,
        linesWritten: 0,
        activeStreams: 0
      }
    };
    
    for (const [loggerId, loggerInfo] of this.streams) {
      stats.loggers[loggerId] = {
        filePath: loggerInfo.filePath,
        bytesWritten: loggerInfo.bytesWritten,
        linesWritten: loggerInfo.linesWritten,
        isGlobal: loggerInfo.isGlobal,
        projectId: loggerInfo.projectId,
        createdAt: loggerInfo.createdAt
      };
      
      stats.totals.bytesWritten += loggerInfo.bytesWritten;
      stats.totals.linesWritten += loggerInfo.linesWritten;
      stats.totals.activeStreams++;
    }
    
    return stats;
  }

  /**
   * Cleanup all loggers
   */
  async cleanup() {
    // すべてのローテーションタイマーを停止
    for (const timer of this.rotationTimers.values()) {
      clearInterval(timer);
    }
    this.rotationTimers.clear();
    
    // すべてのストリームをクローズ
    const closePromises = [];
    for (const loggerId of this.streams.keys()) {
      closePromises.push(this.closeLogger(loggerId));
    }
    
    await Promise.all(closePromises);
    
    this.emit('cleanup');
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance
 */
function getInstance(options) {
  if (!instance) {
    instance = new MultiLogger(options);
  }
  return instance;
}

module.exports = {
  MultiLogger,
  getInstance
};