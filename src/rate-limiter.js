/**
 * Claude CLIのレート制限管理
 */
class RateLimiter {
  constructor() {
    this.resetTime = null;
    this.isLimited = false;
  }

  /**
   * エラーメッセージからレート制限を検出
   */
  parseRateLimit(errorMessage) {
    // "rate limit reached|1234567890" 形式を検出
    const match = errorMessage.match(/rate.*limit.*reached.*\|(\d+)/i);
    
    if (match) {
      const epochSeconds = parseInt(match[1]);
      this.resetTime = epochSeconds * 1000; // ミリ秒に変換
      this.isLimited = true;
      
      const resetDate = new Date(this.resetTime);
      console.log(`レート制限検出: ${resetDate.toLocaleString()} まで待機`);
      
      return true;
    }
    
    return false;
  }

  /**
   * レート制限中かチェック
   */
  isRateLimited() {
    if (!this.isLimited) {
      return false;
    }

    const now = Date.now();
    if (now >= this.resetTime) {
      // 制限時間が過ぎた
      this.isLimited = false;
      this.resetTime = null;
      console.log('レート制限解除');
      return false;
    }

    return true;
  }

  /**
   * 残り待機時間を取得（ミリ秒）
   */
  getRemainingTime() {
    if (!this.isLimited) {
      return 0;
    }

    const now = Date.now();
    const remaining = Math.max(0, this.resetTime - now);
    return remaining;
  }

  /**
   * 制限解除まで待機
   */
  async waitForReset() {
    if (!this.isLimited) {
      return;
    }

    const remaining = this.getRemainingTime();
    if (remaining > 0) {
      console.log(`${Math.ceil(remaining / 1000)}秒待機中...`);
      await new Promise(resolve => setTimeout(resolve, remaining));
    }
  }
}

module.exports = RateLimiter;