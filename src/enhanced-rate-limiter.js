const RateLimiter = require('./rate-limiter');
const GitHubRateLimiter = require('./github-rate-limiter');

/**
 * 統合レート制限管理
 * GitHub APIとClaude APIの両方のレート制限を管理
 */
class EnhancedRateLimiter {
  constructor(config = {}) {
    this.claudeRateLimiter = new RateLimiter();
    this.githubRateLimiter = new GitHubRateLimiter();
    
  }

  /**
   * レート制限チェック（両方のAPI）
   */
  async isRateLimited() {
    // Claude APIのレート制限チェック
    if (this.claudeRateLimiter.isRateLimited()) {
      return { limited: true, api: 'claude', waitTime: this.claudeRateLimiter.getRemainingTime() };
    }
    
    // GitHub APIのレート制限チェック
    const canCallGitHub = await this.githubRateLimiter.canMakeAPICalls(5); // 最低5回分の余裕を持つ
    if (!canCallGitHub) {
      return { limited: true, api: 'github', waitTime: this.githubRateLimiter.getWaitTime() };
    }
    
    return { limited: false };
  }


  /**
   * レート制限情報の取得
   */
  async getRateLimitStatus() {
    const githubInfo = this.githubRateLimiter.getRateLimitInfo();
    const claudeInfo = {
      isLimited: this.claudeRateLimiter.isRateLimited(),
      remainingTime: this.claudeRateLimiter.getRemainingTime()
    };
    
    return {
      github: githubInfo,
      claude: claudeInfo
    };
  }

  /**
   * エラーメッセージの解析（Claude用）
   */
  parseRateLimit(errorMessage) {
    return this.claudeRateLimiter.parseRateLimit(errorMessage);
  }

  /**
   * 統合待機処理
   */
  async waitForReset() {
    const status = await this.isRateLimited();
    
    if (status.limited) {
      if (status.api === 'claude') {
        await this.claudeRateLimiter.waitForReset();
      } else if (status.api === 'github') {
        await this.githubRateLimiter.waitForReset();
      }
    }
  }

  /**
   * API呼び出し前の事前チェック
   */
  async preflightCheck(requiredGitHubCalls = 5) {
    // GitHub APIレート制限の事前更新
    await this.githubRateLimiter.updateRateLimit();
    
    const status = await this.isRateLimited();
    if (status.limited) {
      const waitSeconds = Math.ceil(status.waitTime / 1000);
      console.log(`⚠️  ${status.api.toUpperCase()} APIレート制限中: ${waitSeconds}秒後に再試行`);
      return false;
    }
    
    return true;
  }
}

module.exports = EnhancedRateLimiter;