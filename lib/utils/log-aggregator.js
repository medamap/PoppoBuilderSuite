/**
 * Log Aggregator
 * 複数のログファイルを集約して検索・表示する機能を提供
 */

const fs = require('fs').promises;
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');
const { createReadStream } = require('fs');
const zlib = require('zlib');
const { promisify } = require('util');

class LogAggregator extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      globalLogDir: options.globalLogDir || path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'logs'),
      maxLinesPerFile: options.maxLinesPerFile || 10000,
      searchTimeout: options.searchTimeout || 30000,
      enableCache: options.enableCache !== false,
      cacheSize: options.cacheSize || 100,
      ...options
    };
    
    this.projectDirs = new Map(); // projectId -> logDir
    this.searchCache = new Map(); // cacheKey -> results
    this.isInitialized = false;
  }

  /**
   * Initialize aggregator
   */
  async initialize() {
    if (this.isInitialized) return;
    
    // グローバルログディレクトリの確認
    try {
      await fs.access(this.options.globalLogDir);
    } catch (error) {
      throw new Error(`Global log directory not found: ${this.options.globalLogDir}`);
    }
    
    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * Register a project for aggregation
   * @param {string} projectId - Project identifier
   * @param {string} projectPath - Project path
   */
  registerProject(projectId, projectPath) {
    const logDir = path.join(projectPath, '.poppobuilder', 'logs');
    this.projectDirs.set(projectId, logDir);
    this.emit('project-registered', { projectId });
  }

  /**
   * Search logs across all sources
   * @param {Object} criteria - Search criteria
   * @returns {Promise<Array>} Log entries matching criteria
   */
  async search(criteria = {}) {
    await this.ensureInitialized();
    
    const {
      query,
      level,
      startTime,
      endTime,
      projectId,
      component,
      limit = 1000,
      includeGlobal = true,
      includeProjects = true,
      includeDaemon = true
    } = criteria;
    
    // キャッシュチェック
    const cacheKey = this.getCacheKey(criteria);
    if (this.options.enableCache && this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey);
    }
    
    const results = [];
    const searchPromises = [];
    
    // グローバルログを検索
    if (includeGlobal) {
      searchPromises.push(
        this.searchLogFile(
          path.join(this.options.globalLogDir, 'global.log'),
          criteria,
          'global'
        )
      );
    }
    
    // デーモンログを検索
    if (includeDaemon) {
      searchPromises.push(
        this.searchLogFile(
          path.join(this.options.globalLogDir, 'daemon.log'),
          criteria,
          'daemon'
        )
      );
    }
    
    // プロジェクトログを検索
    if (includeProjects) {
      if (projectId) {
        // 特定のプロジェクトのみ
        const logDir = this.projectDirs.get(projectId);
        if (logDir) {
          searchPromises.push(
            this.searchLogFile(
              path.join(logDir, 'project.log'),
              criteria,
              `project:${projectId}`
            )
          );
        }
      } else {
        // すべてのプロジェクト
        for (const [pid, logDir] of this.projectDirs) {
          searchPromises.push(
            this.searchLogFile(
              path.join(logDir, 'project.log'),
              criteria,
              `project:${pid}`
            )
          );
        }
      }
    }
    
    // 並行検索を実行
    const searchResults = await Promise.all(searchPromises);
    
    // 結果をマージ
    for (const entries of searchResults) {
      results.push(...entries);
    }
    
    // ソート（タイムスタンプの降順）
    results.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });
    
    // 制限を適用
    const limitedResults = results.slice(0, limit);
    
    // キャッシュに保存
    if (this.options.enableCache) {
      this.updateCache(cacheKey, limitedResults);
    }
    
    this.emit('search-completed', {
      criteria,
      resultCount: limitedResults.length
    });
    
    return limitedResults;
  }

  /**
   * Search a single log file
   * @private
   */
  async searchLogFile(filePath, criteria, source) {
    const results = [];
    
    try {
      // ファイルの存在確認
      await fs.access(filePath);
      
      // 圧縮ファイルも検索対象に含める
      const files = await this.getLogFiles(filePath);
      
      for (const file of files) {
        const entries = await this.readLogFile(file, criteria);
        
        // ソース情報を追加
        entries.forEach(entry => {
          entry.source = source;
          entry.file = path.basename(file);
        });
        
        results.push(...entries);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error(`Error searching log file ${filePath}:`, error);
      }
    }
    
    return results;
  }

  /**
   * Get all log files including rotated ones
   * @private
   */
  async getLogFiles(baseFilePath) {
    const dir = path.dirname(baseFilePath);
    const basename = path.basename(baseFilePath, '.log');
    const files = [baseFilePath];
    
    try {
      const dirFiles = await fs.readdir(dir);
      
      // ローテーションされたファイルを探す
      const rotatedFiles = dirFiles
        .filter(f => 
          f.startsWith(basename) && 
          (f.endsWith('.log') || f.endsWith('.log.gz')) &&
          f !== path.basename(baseFilePath)
        )
        .map(f => path.join(dir, f))
        .sort()
        .reverse(); // 新しいファイルから
      
      files.push(...rotatedFiles);
    } catch (error) {
      // ディレクトリ読み取りエラーは無視
    }
    
    return files;
  }

  /**
   * Read and parse log file
   * @private
   */
  async readLogFile(filePath, criteria) {
    const entries = [];
    const isCompressed = filePath.endsWith('.gz');
    
    // ストリームの作成
    let stream = createReadStream(filePath);
    
    if (isCompressed) {
      const gunzip = zlib.createGunzip();
      stream = stream.pipe(gunzip);
    }
    
    const rl = readline.createInterface({
      input: stream,
      crlfDelay: Infinity
    });
    
    let lineCount = 0;
    
    for await (const line of rl) {
      if (lineCount >= this.options.maxLinesPerFile) break;
      
      try {
        const entry = this.parseLine(line);
        
        if (entry && this.matchesCriteria(entry, criteria)) {
          entries.push(entry);
          lineCount++;
        }
      } catch (error) {
        // パースエラーは無視
      }
    }
    
    return entries;
  }

  /**
   * Parse log line
   * @private
   */
  parseLine(line) {
    if (!line || line.trim() === '') return null;
    
    try {
      // JSON形式の場合
      if (line.startsWith('{')) {
        return JSON.parse(line);
      }
      
      // テキスト形式の場合
      const match = line.match(/^(\S+)\s+(\S+)\s+(?:\[([^\]]+)\])?(?:\[([^\]]+)\])?\s+(.*)$/);
      if (match) {
        const [, timestamp, level, component, projectId, message] = match;
        return {
          timestamp,
          level: level.toLowerCase(),
          component,
          projectId,
          message
        };
      }
    } catch (error) {
      // パースエラー
    }
    
    return null;
  }

  /**
   * Check if entry matches criteria
   * @private
   */
  matchesCriteria(entry, criteria) {
    const {
      query,
      level,
      startTime,
      endTime,
      projectId,
      component
    } = criteria;
    
    // レベルフィルター
    if (level && entry.level !== level.toLowerCase()) {
      return false;
    }
    
    // 時間フィルター
    if (startTime || endTime) {
      const entryTime = new Date(entry.timestamp).getTime();
      
      if (startTime && entryTime < new Date(startTime).getTime()) {
        return false;
      }
      
      if (endTime && entryTime > new Date(endTime).getTime()) {
        return false;
      }
    }
    
    // プロジェクトフィルター
    if (projectId && entry.projectId !== projectId) {
      return false;
    }
    
    // コンポーネントフィルター
    if (component && entry.component !== component) {
      return false;
    }
    
    // クエリフィルター
    if (query) {
      const searchableText = [
        entry.message,
        entry.component,
        entry.projectId,
        JSON.stringify(entry.metadata),
        JSON.stringify(entry.error)
      ].filter(Boolean).join(' ').toLowerCase();
      
      if (!searchableText.includes(query.toLowerCase())) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * Aggregate logs by criteria
   * @param {Object} options - Aggregation options
   * @returns {Promise<Object>} Aggregated results
   */
  async aggregate(options = {}) {
    const {
      groupBy = 'level', // level, project, component, hour
      startTime,
      endTime,
      includeStats = true
    } = options;
    
    // すべてのログを検索
    const entries = await this.search({
      startTime,
      endTime,
      limit: Number.MAX_SAFE_INTEGER
    });
    
    const aggregated = {};
    const stats = {
      total: entries.length,
      byLevel: {},
      byProject: {},
      byComponent: {},
      timeRange: {
        start: null,
        end: null
      }
    };
    
    for (const entry of entries) {
      // グループキーを取得
      let groupKey;
      switch (groupBy) {
        case 'level':
          groupKey = entry.level || 'unknown';
          break;
        case 'project':
          groupKey = entry.projectId || 'global';
          break;
        case 'component':
          groupKey = entry.component || 'unknown';
          break;
        case 'hour':
          const date = new Date(entry.timestamp);
          groupKey = `${date.toISOString().slice(0, 13)}:00`;
          break;
        default:
          groupKey = 'all';
      }
      
      // グループに追加
      if (!aggregated[groupKey]) {
        aggregated[groupKey] = [];
      }
      aggregated[groupKey].push(entry);
      
      // 統計情報を更新
      if (includeStats) {
        // レベル別
        stats.byLevel[entry.level] = (stats.byLevel[entry.level] || 0) + 1;
        
        // プロジェクト別
        const project = entry.projectId || 'global';
        stats.byProject[project] = (stats.byProject[project] || 0) + 1;
        
        // コンポーネント別
        if (entry.component) {
          stats.byComponent[entry.component] = (stats.byComponent[entry.component] || 0) + 1;
        }
        
        // 時間範囲
        const entryTime = new Date(entry.timestamp);
        if (!stats.timeRange.start || entryTime < stats.timeRange.start) {
          stats.timeRange.start = entryTime;
        }
        if (!stats.timeRange.end || entryTime > stats.timeRange.end) {
          stats.timeRange.end = entryTime;
        }
      }
    }
    
    // グループ別の統計を計算
    const groupStats = {};
    for (const [key, entries] of Object.entries(aggregated)) {
      groupStats[key] = {
        count: entries.length,
        percentage: (entries.length / stats.total) * 100
      };
    }
    
    return {
      groups: aggregated,
      groupStats,
      stats: includeStats ? stats : undefined
    };
  }

  /**
   * Get recent logs
   * @param {Object} options - Options
   * @returns {Promise<Array>} Recent log entries
   */
  async getRecent(options = {}) {
    const {
      limit = 100,
      level,
      projectId
    } = options;
    
    // 過去1時間のログを取得
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    return await this.search({
      startTime: oneHourAgo,
      level,
      projectId,
      limit
    });
  }

  /**
   * Get error summary
   * @param {Object} options - Options
   * @returns {Promise<Object>} Error summary
   */
  async getErrorSummary(options = {}) {
    const {
      startTime = new Date(Date.now() - 24 * 60 * 60 * 1000), // 過去24時間
      endTime = new Date(),
      groupByComponent = true
    } = options;
    
    const errors = await this.search({
      level: 'error',
      startTime,
      endTime,
      limit: Number.MAX_SAFE_INTEGER
    });
    
    const summary = {
      total: errors.length,
      byComponent: {},
      byProject: {},
      topErrors: {},
      timeline: {}
    };
    
    for (const error of errors) {
      // コンポーネント別
      if (groupByComponent && error.component) {
        summary.byComponent[error.component] = (summary.byComponent[error.component] || 0) + 1;
      }
      
      // プロジェクト別
      const project = error.projectId || 'global';
      summary.byProject[project] = (summary.byProject[project] || 0) + 1;
      
      // エラーメッセージ別（上位10件）
      const errorKey = error.error?.message || error.message;
      if (errorKey) {
        summary.topErrors[errorKey] = (summary.topErrors[errorKey] || 0) + 1;
      }
      
      // 時系列（1時間単位）
      const hour = new Date(error.timestamp).toISOString().slice(0, 13);
      summary.timeline[hour] = (summary.timeline[hour] || 0) + 1;
    }
    
    // topErrorsを配列に変換してソート
    summary.topErrors = Object.entries(summary.topErrors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([message, count]) => ({ message, count }));
    
    return summary;
  }

  /**
   * Stream logs in real-time
   * @param {Object} options - Stream options
   * @returns {EventEmitter} Log stream
   */
  streamLogs(options = {}) {
    const {
      follow = true,
      tail = 10,
      level,
      projectId
    } = options;
    
    const stream = new EventEmitter();
    const watchers = new Map();
    
    // 初期ログを取得
    this.getRecent({ limit: tail, level, projectId })
      .then(entries => {
        entries.reverse().forEach(entry => {
          stream.emit('log', entry);
        });
      })
      .catch(error => {
        stream.emit('error', error);
      });
    
    if (!follow) {
      return stream;
    }
    
    // ファイル監視を設定
    const setupWatcher = (filePath, source) => {
      try {
        const watcher = require('fs').watch(filePath, (eventType) => {
          if (eventType === 'change') {
            // 最新の行を読み取る
            this.readLatestLines(filePath, 1)
              .then(lines => {
                for (const line of lines) {
                  const entry = this.parseLine(line);
                  if (entry && this.matchesCriteria(entry, { level, projectId })) {
                    entry.source = source;
                    stream.emit('log', entry);
                  }
                }
              })
              .catch(error => {
                stream.emit('error', error);
              });
          }
        });
        
        watchers.set(filePath, watcher);
      } catch (error) {
        // ファイルが存在しない場合は無視
      }
    };
    
    // グローバルログの監視
    setupWatcher(
      path.join(this.options.globalLogDir, 'global.log'),
      'global'
    );
    
    // プロジェクトログの監視
    if (projectId) {
      const logDir = this.projectDirs.get(projectId);
      if (logDir) {
        setupWatcher(
          path.join(logDir, 'project.log'),
          `project:${projectId}`
        );
      }
    }
    
    // ストリームの停止メソッド
    stream.stop = () => {
      for (const watcher of watchers.values()) {
        watcher.close();
      }
      watchers.clear();
    };
    
    return stream;
  }

  /**
   * Read latest lines from file
   * @private
   */
  async readLatestLines(filePath, count) {
    const lines = [];
    const stream = createReadStream(filePath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream });
    
    for await (const line of rl) {
      lines.push(line);
      if (lines.length > count) {
        lines.shift();
      }
    }
    
    return lines;
  }

  /**
   * Get cache key
   * @private
   */
  getCacheKey(criteria) {
    return JSON.stringify(criteria);
  }

  /**
   * Update cache
   * @private
   */
  updateCache(key, value) {
    // キャッシュサイズ制限
    if (this.searchCache.size >= this.options.cacheSize) {
      // 最も古いエントリを削除
      const firstKey = this.searchCache.keys().next().value;
      this.searchCache.delete(firstKey);
    }
    
    this.searchCache.set(key, value);
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.searchCache.clear();
    this.emit('cache-cleared');
  }

  /**
   * Ensure initialized
   * @private
   */
  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Export logs to file
   * @param {string} outputPath - Output file path
   * @param {Object} criteria - Search criteria
   * @param {string} format - Export format (json, csv, text)
   */
  async export(outputPath, criteria = {}, format = 'json') {
    const entries = await this.search(criteria);
    
    let content;
    switch (format) {
      case 'csv':
        content = this.entriesToCSV(entries);
        break;
      case 'text':
        content = this.entriesToText(entries);
        break;
      case 'json':
      default:
        content = JSON.stringify(entries, null, 2);
    }
    
    await fs.writeFile(outputPath, content);
    
    this.emit('logs-exported', {
      outputPath,
      format,
      count: entries.length
    });
  }

  /**
   * Convert entries to CSV
   * @private
   */
  entriesToCSV(entries) {
    const headers = ['timestamp', 'level', 'source', 'component', 'projectId', 'message'];
    const rows = [headers.join(',')];
    
    for (const entry of entries) {
      const row = headers.map(h => {
        const value = entry[h] || '';
        // エスケープ処理
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      });
      rows.push(row.join(','));
    }
    
    return rows.join('\n');
  }

  /**
   * Convert entries to text
   * @private
   */
  entriesToText(entries) {
    return entries.map(entry => {
      const level = entry.level.toUpperCase().padEnd(5);
      const component = entry.component ? `[${entry.component}]` : '';
      const project = entry.projectId ? `[${entry.projectId}]` : '';
      return `${entry.timestamp} ${level} ${component}${project} ${entry.message}`;
    }).join('\n');
  }
}

module.exports = LogAggregator;