const fs = require('fs');
const path = require('path');
const LogRotator = require('./log-rotator');

// ストレージパスマネージャーを遅延読み込み（循環依存を避けるため）
let storagePaths = null;
const getStoragePaths = () => {
  if (!storagePaths) {
    try {
      storagePaths = require('./core/storage-paths');
    } catch (error) {
      // storage-pathsが利用できない場合は従来の動作
      storagePaths = null;
    }
  }
  return storagePaths;
};

/**
 * シンプルなロガークラス（ログローテーション機能付き）
 */
class Logger {
  constructor(categoryOrLogDir = 'default', options = {}) {
    // 後方互換性のチェック
    // 第一引数がパスのような文字列の場合は、旧形式として扱う
    if (typeof categoryOrLogDir === 'string' && 
        (categoryOrLogDir.includes('/') || categoryOrLogDir.includes('\\') || categoryOrLogDir === path.join(__dirname, '../logs'))) {
      // 旧形式: constructor(logDir, rotationConfig)
      this.category = 'default';
      this.logDir = categoryOrLogDir;
      this.rotationConfig = options;
    } else {
      // 新形式: constructor(category, options)
      this.category = categoryOrLogDir || 'default';
      
      // StoragePathsが利用可能な場合は使用
      const paths = getStoragePaths();
      if (paths && paths.getLogsDir) {
        try {
          // StoragePathsが初期化されているか確認
          if (paths.basePath && paths.projectName) {
            this.logDir = paths.getLogsDir('app');
          } else {
            // 初期化されていない場合はフォールバック
            const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
            this.logDir = options.logDir || path.join(homeDir, '.poppobuilder', 'logs');
          }
        } catch (error) {
          // エラーが発生した場合もフォールバック
          const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
          this.logDir = options.logDir || path.join(homeDir, '.poppobuilder', 'logs');
        }
      } else {
        // フォールバック
        const homeDir = process.env.HOME || process.env.USERPROFILE || '/tmp';
        this.logDir = options.logDir || path.join(homeDir, '.poppobuilder', 'logs');
      }
      
      this.rotationConfig = options.rotationConfig || {};
    }
    
    this.ensureLogDir();
    
    // ログローテーターを初期化
    this.rotator = new LogRotator(this.rotationConfig);
    
    // ログレベルの設定（デフォルトはINFO以上を出力）
    this.logLevels = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    };
    this.currentLogLevel = this.rotationConfig.logLevel || 'INFO';
  }

  ensureLogDir() {
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * タイムスタンプ付きのログファイル名を生成
   */
  getLogFileName(prefix) {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    return `${prefix}-${dateStr}.log`;
  }

  /**
   * ログレベルをチェック
   */
  shouldLog(level) {
    return this.logLevels[level] <= this.logLevels[this.currentLogLevel];
  }

  /**
   * ログ出力（ファイルとコンソール）
   */
  log(level, category, message, data = null) {
    // 引数の調整（categoryが省略された場合）
    if (arguments.length === 2) {
      // log(level, message) の形式
      data = null;
      message = category;
      category = this.category;
    } else if (arguments.length === 3 && typeof message !== 'string') {
      // log(level, message, data) の形式
      data = message;
      message = category;
      category = this.category;
    } else if (arguments.length === 4 && typeof category === 'string' && typeof message === 'string') {
      // 正しい形式なので何もしない
    } else {
      // その他の場合は、第2引数をカテゴリとして扱う
    }
    
    // ログレベルチェック
    if (!this.shouldLog(level)) {
      return;
    }
    
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      category,
      message,
      data
    };

    // コンソール出力
    const consoleMsg = `[${timestamp}] [${level}] [${category}] ${message}`;
    if (level === 'ERROR') {
      console.error(consoleMsg, data || '');
    } else {
      console.log(consoleMsg, data ? JSON.stringify(data, null, 2) : '');
    }

    // ファイル出力
    const fileName = this.getLogFileName('poppo');
    const filePath = path.join(this.logDir, fileName);
    const fileEntry = JSON.stringify(logEntry) + '\n';
    
    fs.appendFileSync(filePath, fileEntry, 'utf8');
  }

  /**
   * Issue処理専用ログ
   */
  logIssue(issueNumber, event, details) {
    const fileName = this.getLogFileName(`issue-${issueNumber}`);
    const filePath = path.join(this.logDir, fileName);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      issueNumber,
      event,
      details
    };

    fs.appendFileSync(filePath, JSON.stringify(logEntry) + '\n', 'utf8');
    
    // 通常ログにも記録
    this.log('INFO', `Issue#${issueNumber}`, event, details);
  }

  /**
   * プロセス実行ログ
   */
  logProcess(taskId, event, details) {
    const fileName = this.getLogFileName('processes');
    const filePath = path.join(this.logDir, fileName);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      taskId,
      event,
      details
    };

    fs.appendFileSync(filePath, JSON.stringify(logEntry) + '\n', 'utf8');
    
    // 通常ログにも記録
    this.log('INFO', `Process:${taskId}`, event, details);
  }

  // 便利メソッド
  info(category, message, data) {
    // 引数の数に応じて調整
    if (arguments.length === 1) {
      this.log('INFO', this.category, category);
    } else if (arguments.length === 2) {
      this.log('INFO', this.category, category, message);
    } else {
      this.log('INFO', category, message, data);
    }
  }

  error(category, message, data) {
    // 引数の数に応じて調整
    if (arguments.length === 1) {
      this.log('ERROR', this.category, category);
    } else if (arguments.length === 2) {
      this.log('ERROR', this.category, category, message);
    } else {
      this.log('ERROR', category, message, data);
    }
  }

  warn(category, message, data) {
    // 引数の数に応じて調整
    if (arguments.length === 1) {
      this.log('WARN', this.category, category);
    } else if (arguments.length === 2) {
      this.log('WARN', this.category, category, message);
    } else {
      this.log('WARN', category, message, data);
    }
  }

  debug(category, message, data) {
    // 引数の数に応じて調整
    if (arguments.length === 1) {
      this.log('DEBUG', this.category, category);
    } else if (arguments.length === 2) {
      this.log('DEBUG', this.category, category, message);
    } else {
      this.log('DEBUG', category, message, data);
    }
  }

  /**
   * システムログ（InfoレベルでSYSTEMカテゴリ）
   */
  logSystem(event, data) {
    this.log('INFO', 'SYSTEM', event, data);
  }

  /**
   * ログレベルを変更
   */
  setLogLevel(level) {
    if (this.logLevels.hasOwnProperty(level)) {
      this.currentLogLevel = level;
      this.logSystem(`ログレベル変更: ${level}`);
    }
  }

  /**
   * ログローテーターを停止
   */
  close() {
    if (this.rotator) {
      this.rotator.stopWatching();
    }
  }

  /**
   * 手動でログローテーションを実行
   */
  async rotate() {
    if (this.rotator) {
      await this.rotator.rotateAll();
    }
  }

  /**
   * アーカイブ統計情報を取得
   */
  async getArchiveStats() {
    if (this.rotator) {
      return await this.rotator.getArchiveStats();
    }
    return null;
  }
}

module.exports = Logger;