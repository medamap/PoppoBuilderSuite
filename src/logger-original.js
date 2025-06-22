const fs = require('fs');
const path = require('path');

/**
 * シンプルなロガークラス
 */
class Logger {
  constructor(logDir = path.join(__dirname, '../logs')) {
    this.logDir = logDir;
    this.ensureLogDir();
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
   * ログ出力（ファイルとコンソール）
   */
  log(level, category, message, data = null) {
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
}

module.exports = Logger;