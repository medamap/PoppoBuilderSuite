const fs = require('fs');
const path = require('path');

/**
 * ハートビートログ管理
 * プロセスの生存確認と処理の進行状況を記録
 */
class HeartbeatLogger {
  constructor(logDir = path.join(__dirname, '../logs')) {
    this.logDir = logDir;
    this.heartbeatFile = path.join(logDir, 'heartbeat.log');
    this.interval = null;
    this.processInfo = {};
  }

  /**
   * ハートビート開始
   */
  start(intervalMs = 30000) {
    this.log('STARTUP', 'PoppoBuilder起動');
    
    // 定期的なハートビート
    this.interval = setInterval(() => {
      this.log('HEARTBEAT', 'プロセス正常動作中', {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        processCount: Object.keys(this.processInfo).length
      });
    }, intervalMs);
  }

  /**
   * ハートビート停止
   */
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.log('SHUTDOWN', 'PoppoBuilder停止');
    }
  }

  /**
   * 処理の節目でログ出力
   */
  checkpoint(action, details = {}) {
    this.log('CHECKPOINT', action, details);
  }

  /**
   * プロセス情報の更新
   */
  updateProcess(processId, status, details = {}) {
    this.processInfo[processId] = { status, ...details };
    this.log('PROCESS_UPDATE', `${processId}: ${status}`, details);
  }

  /**
   * エラー記録
   */
  error(action, error, details = {}) {
    this.log('ERROR', action, {
      error: error.message,
      stack: error.stack,
      ...details
    });
  }

  /**
   * ログ出力
   */
  log(type, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      type,
      message,
      data
    };

    // ファイルに追記
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(this.heartbeatFile, logLine, 'utf8');

    // ログローテーション確認
    this.checkRotation();
  }

  /**
   * ログローテーション
   */
  checkRotation() {
    try {
      const stats = fs.statSync(this.heartbeatFile);
      const maxSize = 10 * 1024 * 1024; // 10MB
      
      if (stats.size > maxSize) {
        const timestamp = new Date().toISOString().split('T')[0];
        const rotatedFile = path.join(this.logDir, `heartbeat-${timestamp}.log`);
        
        // 既存ファイルをリネーム
        fs.renameSync(this.heartbeatFile, rotatedFile);
        
        // 古いログファイルを削除（7日以上前）
        this.cleanOldLogs();
      }
    } catch (error) {
      // エラーは無視（ファイルが存在しない場合など）
    }
  }

  /**
   * 古いログファイルの削除
   */
  cleanOldLogs() {
    const files = fs.readdirSync(this.logDir);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7日
    
    files.forEach(file => {
      if (file.startsWith('heartbeat-') && file.endsWith('.log')) {
        const filePath = path.join(this.logDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtime.getTime() > maxAge) {
          fs.unlinkSync(filePath);
          console.log(`古いハートビートログを削除: ${file}`);
        }
      }
    });
  }
}

module.exports = HeartbeatLogger;