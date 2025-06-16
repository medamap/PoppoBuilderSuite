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
    
    // バックオフ設定
    this.backoffConfig = {
      initialDelay: config.initialBackoffDelay || 1000,    // 初期遅延: 1秒
      maxDelay: config.maxBackoffDelay || 300000,          // 最大遅延: 5分
      multiplier: config.backoffMultiplier || 2,           // 遅延倍率
      jitter: config.backoffJitter || 0.1                  // ジッター（0-10%）
    };
    
    // リトライ状態
    this.retryState = new Map(); // taskId -> { retryCount, nextDelay }
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
   * エクスポネンシャルバックオフの計算
   */
  calculateBackoff(taskId) {
    if (!this.retryState.has(taskId)) {
      this.retryState.set(taskId, { retryCount: 0, nextDelay: this.backoffConfig.initialDelay });
    }
    
    const state = this.retryState.get(taskId);
    state.retryCount++;
    
    // 次回の遅延を計算
    let delay = state.nextDelay;
    
    // ジッターを追加（ランダムな変動を加える）
    const jitterRange = delay * this.backoffConfig.jitter;
    const jitter = (Math.random() - 0.5) * 2 * jitterRange;
    delay = Math.round(delay + jitter);
    
    // 次回用の遅延を更新
    state.nextDelay = Math.min(
      state.nextDelay * this.backoffConfig.multiplier,
      this.backoffConfig.maxDelay
    );
    
    return {
      delay,
      retryCount: state.retryCount,
      shouldRetry: state.retryCount <= 5 // 最大5回まで
    };
  }

  /**
   * タスクのリトライ状態をリセット
   */
  resetRetryState(taskId) {
    this.retryState.delete(taskId);
  }

  /**
   * バックオフ待機
   */
  async waitWithBackoff(taskId, reason = 'rate limit') {
    const backoff = this.calculateBackoff(taskId);
    
    if (!backoff.shouldRetry) {
      throw new Error(`Maximum retry attempts reached for task ${taskId}`);
    }
    
    console.log(`⏳ バックオフ待機 (${reason}): ${backoff.delay}ms (リトライ ${backoff.retryCount}/5)`);
    await new Promise(resolve => setTimeout(resolve, backoff.delay));
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
      claude: claudeInfo,
      retryStates: Array.from(this.retryState.entries()).map(([taskId, state]) => ({
        taskId,
        ...state
      }))
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