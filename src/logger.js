const fs = require('fs');
const path = require('path');
const LogRotator = require('./log-rotator');

/**
 * シンプルなロガークラス（ログローテーション機能付き）
 */
class Logger {
  constructor(logDir = path.join(__dirname, '../logs'), rotationConfig = {}) {
    this.logDir = logDir;
    this.ensureLogDir();
    
    // ログローテーターを初期化
    this.rotator = new LogRotator(rotationConfig);
    
    // ログレベルの設定（デフォルトはINFO以上を出力）
    this.logLevels = {
      ERROR: 0,
      WARN: 1,
      INFO: 2,
      DEBUG: 3
    };
    this.currentLogLevel = rotationConfig.logLevel || 'INFO';
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
    this.log('INFO', category, message, data);
  }

  error(category, message, data) {
    this.log('ERROR', category, message, data);
  }

  warn(category, message, data) {
    this.log('WARN', category, message, data);
  }

  debug(category, message, data) {
    this.log('DEBUG', category, message, data);
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