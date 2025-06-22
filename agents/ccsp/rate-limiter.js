/**
 * レート制限管理モジュール
 * 
 * Claude Codeのレート制限を追跡・管理
 */

class RateLimiter {
  constructor(logger) {
    this.logger = logger;
    this.rateLimitUntil = null;
    this.rateLimitMessage = null;
  }
  
  /**
   * レート制限中かチェック
   */
  isRateLimited() {
    if (!this.rateLimitUntil) {
      return false;
    }
    
    const now = Date.now();
    if (now >= this.rateLimitUntil) {
      // レート制限期間が終了
      this.rateLimitUntil = null;
      this.rateLimitMessage = null;
      return false;
    }
    
    return true;
  }
  
  /**
   * 待機時間を取得（ミリ秒）
   */
  getWaitTime() {
    if (!this.rateLimitUntil) {
      return 0;
    }
    
    const now = Date.now();
    const waitTime = this.rateLimitUntil - now;
    return waitTime > 0 ? waitTime : 0;
  }
  
  /**
   * レート制限情報を更新
   */
  updateRateLimit(rateLimitInfo) {
    if (!rateLimitInfo) {
      return;
    }
    
    const { message, unlockTime } = rateLimitInfo;
    
    this.rateLimitUntil = unlockTime + 60000; // 1分余裕を持たせる
    this.rateLimitMessage = message;
    
    this.logger.info(`[RateLimiter] Rate limit updated: ${message}`);
    this.logger.info(`[RateLimiter] Will be unlocked at: ${new Date(unlockTime).toISOString()}`);
    this.logger.info(`[RateLimiter] Waiting for: ${Math.round(this.getWaitTime() / 1000)}s`);
  }
  
  /**
   * レート制限情報をクリア
   */
  clearRateLimit() {
    this.rateLimitUntil = null;
    this.rateLimitMessage = null;
    this.logger.info('[RateLimiter] Rate limit cleared');
  }
  
  /**
   * 現在のレート制限状態を取得
   */
  getStatus() {
    if (!this.isRateLimited()) {
      return {
        limited: false,
        message: null,
        unlockTime: null,
        waitTime: 0
      };
    }
    
    return {
      limited: true,
      message: this.rateLimitMessage,
      unlockTime: new Date(this.rateLimitUntil - 60000).toISOString(), // 実際の解除時刻
      waitTime: this.getWaitTime()
    };
  }
}

module.exports = RateLimiter;