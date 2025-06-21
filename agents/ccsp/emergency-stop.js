/**
 * 緊急停止機能
 * 
 * 重大なエラーを検出した場合、CCSPエージェントを完全に停止させる
 */

class EmergencyStop {
  constructor(logger, notificationHandler) {
    this.logger = logger;
    this.notificationHandler = notificationHandler;
    this.stopped = false;
    this.stopReason = null;
    this.resumeTime = null;
  }

  /**
   * エラーメッセージをチェックして緊急停止が必要か判断
   */
  checkError(errorMessage) {
    if (this.stopped) return true;

    // レート制限チェック
    const rateLimitMatch = errorMessage.match(/Claude AI usage limit reached\|(\d+)/);
    if (rateLimitMatch) {
      const epochSeconds = parseInt(rateLimitMatch[1]);
      this.resumeTime = epochSeconds * 1000; // ミリ秒に変換
      this.stopReason = 'RATE_LIMIT';
      this.initiateEmergencyStop(errorMessage);
      return true;
    }

    // セッションタイムアウトチェック
    if (errorMessage.includes('Invalid API key') || 
        errorMessage.includes('Please run /login') ||
        errorMessage.includes('API Login Failure')) {
      this.stopReason = 'SESSION_TIMEOUT';
      this.initiateEmergencyStop(errorMessage);
      return true;
    }

    return false;
  }

  /**
   * 緊急停止を実行
   */
  async initiateEmergencyStop(errorMessage) {
    if (this.stopped) return;
    
    this.stopped = true;
    const stopTime = new Date().toISOString();
    
    this.logger.error('🚨 緊急停止発動 🚨');
    this.logger.error(`理由: ${this.stopReason}`);
    this.logger.error(`エラー: ${errorMessage}`);
    
    if (this.resumeTime) {
      const resumeDate = new Date(this.resumeTime);
      this.logger.error(`再開予定時刻: ${resumeDate.toISOString()}`);
    }

    // 通知を送信
    await this.notificationHandler.notify({
      type: 'emergency_stop',
      reason: this.stopReason,
      errorMessage,
      stopTime,
      resumeTime: this.resumeTime
    });

    // プロセスを完全に停止
    this.logger.error('CCSPエージェントを完全停止します');
    
    // 少し待ってから強制終了（ログが出力されるように）
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  }

  /**
   * 再開可能かチェック
   */
  canResume() {
    if (!this.stopped) return true;
    
    if (this.stopReason === 'RATE_LIMIT' && this.resumeTime) {
      return Date.now() >= this.resumeTime;
    }
    
    // セッションタイムアウトの場合は手動再開が必要
    return false;
  }

  /**
   * 停止状態をリセット
   */
  reset() {
    this.stopped = false;
    this.stopReason = null;
    this.resumeTime = null;
  }
}

module.exports = EmergencyStop;