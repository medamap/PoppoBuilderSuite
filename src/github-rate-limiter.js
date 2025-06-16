/**
 * GitHub APIのレート制限管理
 */
class GitHubRateLimiter {
  constructor() {
    this.rateLimit = {
      limit: 5000,      // レート制限の上限
      remaining: 5000,  // 残り回数
      reset: null,      // リセット時刻（エポック秒）
      used: 0          // 使用済み回数
    };
    this.lastChecked = null;
  }

  /**
   * GitHub CLIの出力からレート制限情報を解析
   * gh api rate_limit の結果を使用
   */
  async updateRateLimit() {
    try {
      const { execSync } = require('child_process');
      const output = execSync('gh api rate_limit').toString();
      const data = JSON.parse(output);
      
      // Core APIのレート制限情報を取得
      const core = data.resources.core;
      this.rateLimit = {
        limit: core.limit,
        remaining: core.remaining,
        reset: core.reset * 1000, // ミリ秒に変換
        used: core.used
      };
      
      this.lastChecked = Date.now();
      
      // レート制限が逼迫している場合は警告
      const usagePercentage = (this.rateLimit.used / this.rateLimit.limit) * 100;
      if (usagePercentage > 80) {
        console.warn(`⚠️  GitHub APIレート制限警告: ${usagePercentage.toFixed(1)}% 使用中 (${this.rateLimit.used}/${this.rateLimit.limit})`);
      }
      
      return this.rateLimit;
    } catch (error) {
      console.error('GitHub APIレート制限情報の取得エラー:', error.message);
      return null;
    }
  }

  /**
   * APIコール前にレート制限をチェック
   * @param {number} requiredCalls - 必要なAPI呼び出し数
   * @returns {boolean} - 実行可能かどうか
   */
  async canMakeAPICalls(requiredCalls = 1) {
    // 1分ごとに最新情報を取得
    if (!this.lastChecked || Date.now() - this.lastChecked > 60000) {
      await this.updateRateLimit();
    }
    
    // 残り回数が必要数より少ない場合
    if (this.rateLimit.remaining < requiredCalls) {
      const resetDate = new Date(this.rateLimit.reset);
      console.log(`GitHub APIレート制限に到達: リセット時刻 ${resetDate.toLocaleString()}`);
      return false;
    }
    
    // 残り回数が少ない場合は警告
    if (this.rateLimit.remaining < 100) {
      console.warn(`⚠️  GitHub API残り回数が少なくなっています: ${this.rateLimit.remaining}回`);
    }
    
    return true;
  }

  /**
   * レート制限リセットまでの待機時間を取得（ミリ秒）
   */
  getWaitTime() {
    if (!this.rateLimit.reset) {
      return 0;
    }
    
    const now = Date.now();
    return Math.max(0, this.rateLimit.reset - now);
  }

  /**
   * レート制限情報を取得
   */
  getRateLimitInfo() {
    return {
      ...this.rateLimit,
      waitTime: this.getWaitTime(),
      resetDate: this.rateLimit.reset ? new Date(this.rateLimit.reset).toLocaleString() : null
    };
  }

  /**
   * リセットまで待機
   */
  async waitForReset() {
    const waitTime = this.getWaitTime();
    if (waitTime > 0) {
      console.log(`GitHub APIレート制限リセットまで ${Math.ceil(waitTime / 1000)} 秒待機...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      // リセット後は情報を更新
      await this.updateRateLimit();
    }
  }
}

module.exports = GitHubRateLimiter;