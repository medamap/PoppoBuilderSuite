/**
 * リトライマネージャー
 * タスクのリトライロジックを管理し、無限増殖を防ぐ
 */
class RetryManager {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 3;
    this.baseDelay = options.baseDelay || 1000; // 1秒
    this.maxDelay = options.maxDelay || 300000; // 5分
    this.backoffFactor = options.backoffFactor || 2;
    this.logger = options.logger || console;
    
    // タスクごとのリトライ情報を管理
    this.retryInfo = new Map();
    
    // エラータイプごとのリトライ設定
    this.errorPolicies = {
      RATE_LIMIT: {
        maxRetries: 5,
        baseDelay: 60000, // 1分
        backoffFactor: 1.5
      },
      LOCK_ERROR: {
        maxRetries: 0, // ロックエラーはリトライしない
        baseDelay: 0,
        backoffFactor: 1
      },
      NETWORK_ERROR: {
        maxRetries: 3,
        baseDelay: 5000, // 5秒
        backoffFactor: 2
      },
      AUTH_ERROR: {
        maxRetries: 1,
        baseDelay: 1000,
        backoffFactor: 1
      },
      DEFAULT: {
        maxRetries: this.maxRetries,
        baseDelay: this.baseDelay,
        backoffFactor: this.backoffFactor
      }
    };
  }

  /**
   * エラータイプを判定
   */
  getErrorType(error) {
    const errorMessage = error.message || '';
    
    if (errorMessage.includes('rate limit') || errorMessage.includes('Rate limit')) {
      return 'RATE_LIMIT';
    }
    if (errorMessage.includes('lock') || errorMessage.includes('already being processed')) {
      return 'LOCK_ERROR';
    }
    if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ETIMEDOUT') || errorMessage.includes('network')) {
      return 'NETWORK_ERROR';
    }
    if (errorMessage.includes('401') || errorMessage.includes('unauthorized') || errorMessage.includes('authentication')) {
      return 'AUTH_ERROR';
    }
    
    return 'DEFAULT';
  }

  /**
   * タスクのリトライ可否を判定
   */
  shouldRetry(taskId, error) {
    const errorType = this.getErrorType(error);
    const policy = this.errorPolicies[errorType];
    
    // リトライ情報を取得（なければ初期化）
    if (!this.retryInfo.has(taskId)) {
      this.retryInfo.set(taskId, {
        attempts: 0,
        firstAttemptAt: Date.now(),
        lastAttemptAt: Date.now(),
        errors: []
      });
    }
    
    const info = this.retryInfo.get(taskId);
    
    // リトライ回数チェック
    if (info.attempts >= policy.maxRetries) {
      this.logger.warn(`Task ${taskId} reached max retries (${info.attempts}/${policy.maxRetries}) for ${errorType}`);
      return false;
    }
    
    // 特定のエラータイプはリトライしない
    if (policy.maxRetries === 0) {
      this.logger.info(`Task ${taskId} will not be retried due to ${errorType}`);
      return false;
    }
    
    return true;
  }

  /**
   * 次のリトライまでの待機時間を計算
   */
  getRetryDelay(taskId, error) {
    const errorType = this.getErrorType(error);
    const policy = this.errorPolicies[errorType];
    const info = this.retryInfo.get(taskId);
    
    if (!info) {
      return policy.baseDelay;
    }
    
    // 指数バックオフ計算
    const delay = Math.min(
      policy.baseDelay * Math.pow(policy.backoffFactor, info.attempts),
      this.maxDelay
    );
    
    // ジッターを追加（10%のランダム性）
    const jitter = delay * 0.1 * Math.random();
    
    return Math.floor(delay + jitter);
  }

  /**
   * リトライ情報を更新
   */
  recordAttempt(taskId, error) {
    if (!this.retryInfo.has(taskId)) {
      this.retryInfo.set(taskId, {
        attempts: 0,
        firstAttemptAt: Date.now(),
        lastAttemptAt: Date.now(),
        errors: []
      });
    }
    
    const info = this.retryInfo.get(taskId);
    info.attempts++;
    info.lastAttemptAt = Date.now();
    info.errors.push({
      timestamp: Date.now(),
      message: error.message,
      type: this.getErrorType(error)
    });
    
    this.logger.info(`Task ${taskId} retry attempt ${info.attempts} recorded`);
  }

  /**
   * タスクのリトライ情報をクリア
   */
  clearRetryInfo(taskId) {
    if (this.retryInfo.has(taskId)) {
      this.logger.debug(`Clearing retry info for task ${taskId}`);
      this.retryInfo.delete(taskId);
    }
  }

  /**
   * 古いリトライ情報をクリーンアップ
   */
  cleanup(maxAge = 3600000) { // 1時間
    const now = Date.now();
    const keysToDelete = [];
    
    for (const [taskId, info] of this.retryInfo.entries()) {
      if (now - info.lastAttemptAt > maxAge) {
        keysToDelete.push(taskId);
      }
    }
    
    keysToDelete.forEach(key => this.retryInfo.delete(key));
    
    if (keysToDelete.length > 0) {
      this.logger.info(`Cleaned up ${keysToDelete.length} old retry entries`);
    }
  }

  /**
   * リトライ統計を取得
   */
  getStats() {
    const stats = {
      activeRetries: this.retryInfo.size,
      byErrorType: {},
      totalAttempts: 0
    };
    
    for (const info of this.retryInfo.values()) {
      stats.totalAttempts += info.attempts;
      
      info.errors.forEach(error => {
        if (!stats.byErrorType[error.type]) {
          stats.byErrorType[error.type] = 0;
        }
        stats.byErrorType[error.type]++;
      });
    }
    
    return stats;
  }
}

module.exports = RetryManager;