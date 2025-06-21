/**
 * サーキットブレーカーパターンの実装
 * 障害の連鎖を防ぎ、システムの回復を促進
 */

const EventEmitter = require('events');

// サーキットブレーカーの状態
const CircuitState = {
  CLOSED: 'closed',      // 正常（リクエスト通過）
  OPEN: 'open',          // 遮断（リクエスト拒否）
  HALF_OPEN: 'half-open' // 半開（テストリクエストのみ）
};

/**
 * サーキットブレーカークラス
 */
class CircuitBreaker extends EventEmitter {
  constructor(name, options = {}) {
    super();
    this.name = name;
    this.state = CircuitState.CLOSED;
    
    // 設定
    this.config = {
      failureThreshold: 5,        // 失敗閾値（この回数失敗したらOPENに）
      successThreshold: 3,        // 成功閾値（HALF_OPENでこの回数成功したらCLOSEDに）
      timeout: 60000,             // タイムアウト時間（ミリ秒）
      resetTimeout: 30000,        // リセットタイムアウト（OPENからHALF_OPENまでの時間）
      volumeThreshold: 10,        // ボリューム閾値（最小リクエスト数）
      errorThresholdPercentage: 50, // エラー率閾値（パーセント）
      ...options
    };
    
    // 統計情報
    this.stats = {
      requests: 0,
      failures: 0,
      successes: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      stateChanges: [],
      errorCounts: new Map()
    };
    
    // ウィンドウベースの統計
    this.rollingWindow = {
      windowSize: 60000, // 1分間のローリングウィンドウ
      buckets: new Map()
    };
    
    // 状態タイマー
    this.resetTimer = null;
  }
  
  /**
   * リクエストを実行
   */
  async execute(fn, fallback = null) {
    // 統計を更新
    this.stats.requests++;
    
    // 状態に応じて処理
    switch (this.state) {
      case CircuitState.OPEN:
        // サーキットが開いている場合はリクエストを拒否
        const error = new Error(`Circuit breaker is OPEN for ${this.name}`);
        error.code = 'CIRCUIT_OPEN';
        
        if (fallback) {
          return await this.executeFallback(fallback, error);
        }
        
        throw error;
        
      case CircuitState.HALF_OPEN:
        // 半開状態では慎重にテスト
        try {
          const result = await this.executeWithTimeout(fn);
          this.onSuccess();
          return result;
        } catch (error) {
          this.onFailure(error);
          
          if (fallback) {
            return await this.executeFallback(fallback, error);
          }
          
          throw error;
        }
        
      case CircuitState.CLOSED:
        // 通常実行
        try {
          const result = await this.executeWithTimeout(fn);
          this.onSuccess();
          return result;
        } catch (error) {
          this.onFailure(error);
          
          // エラー率をチェック
          if (this.shouldOpen()) {
            this.open();
          }
          
          if (fallback) {
            return await this.executeFallback(fallback, error);
          }
          
          throw error;
        }
    }
  }
  
  /**
   * タイムアウト付きで関数を実行
   */
  async executeWithTimeout(fn) {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${this.config.timeout}ms`));
      }, this.config.timeout);
      
      try {
        const result = await fn();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }
  
  /**
   * フォールバック関数を実行
   */
  async executeFallback(fallback, originalError) {
    try {
      this.emit('fallback', { name: this.name, error: originalError });
      return await fallback(originalError);
    } catch (fallbackError) {
      // フォールバックも失敗した場合は元のエラーを投げる
      throw originalError;
    }
  }
  
  /**
   * 成功時の処理
   */
  onSuccess() {
    this.stats.successes++;
    this.stats.consecutiveSuccesses++;
    this.stats.consecutiveFailures = 0;
    this.stats.lastSuccessTime = new Date();
    
    // ローリングウィンドウに記録
    this.recordInWindow('success');
    
    // HALF_OPEN状態で成功閾値に達したらCLOSEDに戻す
    if (this.state === CircuitState.HALF_OPEN &&
        this.stats.consecutiveSuccesses >= this.config.successThreshold) {
      this.close();
    }
    
    this.emit('success', { name: this.name });
  }
  
  /**
   * 失敗時の処理
   */
  onFailure(error) {
    this.stats.failures++;
    this.stats.consecutiveFailures++;
    this.stats.consecutiveSuccesses = 0;
    this.stats.lastFailureTime = new Date();
    
    // エラーカウントを更新
    const errorType = error.code || error.name || 'Unknown';
    this.stats.errorCounts.set(errorType, (this.stats.errorCounts.get(errorType) || 0) + 1);
    
    // ローリングウィンドウに記録
    this.recordInWindow('failure');
    
    this.emit('failure', { name: this.name, error });
  }
  
  /**
   * サーキットを開くべきか判定
   */
  shouldOpen() {
    // ボリューム閾値に達していない場合は開かない
    const recentStats = this.getRecentStats();
    if (recentStats.total < this.config.volumeThreshold) {
      return false;
    }
    
    // 連続失敗数が閾値を超えた場合
    if (this.stats.consecutiveFailures >= this.config.failureThreshold) {
      return true;
    }
    
    // エラー率が閾値を超えた場合
    const errorRate = (recentStats.failures / recentStats.total) * 100;
    if (errorRate >= this.config.errorThresholdPercentage) {
      return true;
    }
    
    return false;
  }
  
  /**
   * サーキットを開く（遮断）
   */
  open() {
    if (this.state === CircuitState.OPEN) {
      return;
    }
    
    this.changeState(CircuitState.OPEN);
    
    // リセットタイマーを設定
    this.resetTimer = setTimeout(() => {
      this.halfOpen();
    }, this.config.resetTimeout);
    
    this.emit('open', { name: this.name });
  }
  
  /**
   * サーキットを半開にする
   */
  halfOpen() {
    if (this.state !== CircuitState.OPEN) {
      return;
    }
    
    this.changeState(CircuitState.HALF_OPEN);
    this.stats.consecutiveSuccesses = 0;
    this.stats.consecutiveFailures = 0;
    
    this.emit('halfOpen', { name: this.name });
  }
  
  /**
   * サーキットを閉じる（正常）
   */
  close() {
    if (this.state === CircuitState.CLOSED) {
      return;
    }
    
    this.changeState(CircuitState.CLOSED);
    
    // リセットタイマーをクリア
    if (this.resetTimer) {
      clearTimeout(this.resetTimer);
      this.resetTimer = null;
    }
    
    this.emit('close', { name: this.name });
  }
  
  /**
   * 状態を変更
   */
  changeState(newState) {
    const oldState = this.state;
    this.state = newState;
    
    // 状態変更履歴に記録
    this.stats.stateChanges.push({
      from: oldState,
      to: newState,
      timestamp: new Date(),
      stats: {
        requests: this.stats.requests,
        failures: this.stats.failures,
        successes: this.stats.successes
      }
    });
    
    // 古い履歴を削除（最新100件のみ保持）
    if (this.stats.stateChanges.length > 100) {
      this.stats.stateChanges.shift();
    }
  }
  
  /**
   * ローリングウィンドウに記録
   */
  recordInWindow(type) {
    const now = Date.now();
    const bucketKey = Math.floor(now / 1000) * 1000; // 1秒単位のバケット
    
    const bucket = this.rollingWindow.buckets.get(bucketKey) || {
      timestamp: bucketKey,
      successes: 0,
      failures: 0
    };
    
    if (type === 'success') {
      bucket.successes++;
    } else {
      bucket.failures++;
    }
    
    this.rollingWindow.buckets.set(bucketKey, bucket);
    
    // 古いバケットを削除
    const cutoff = now - this.rollingWindow.windowSize;
    for (const [key, value] of this.rollingWindow.buckets) {
      if (key < cutoff) {
        this.rollingWindow.buckets.delete(key);
      }
    }
  }
  
  /**
   * 最近の統計を取得
   */
  getRecentStats() {
    const now = Date.now();
    const cutoff = now - this.rollingWindow.windowSize;
    
    let successes = 0;
    let failures = 0;
    
    for (const [key, bucket] of this.rollingWindow.buckets) {
      if (key >= cutoff) {
        successes += bucket.successes;
        failures += bucket.failures;
      }
    }
    
    return {
      successes,
      failures,
      total: successes + failures,
      errorRate: failures > 0 ? (failures / (successes + failures)) * 100 : 0
    };
  }
  
  /**
   * 統計情報を取得
   */
  getStats() {
    const recentStats = this.getRecentStats();
    
    return {
      name: this.name,
      state: this.state,
      stats: {
        ...this.stats,
        recent: recentStats,
        errorTypes: Object.fromEntries(this.stats.errorCounts)
      },
      config: this.config,
      stateHistory: this.stats.stateChanges.slice(-10) // 最新10件
    };
  }
  
  /**
   * 統計をリセット
   */
  reset() {
    this.stats = {
      requests: 0,
      failures: 0,
      successes: 0,
      consecutiveFailures: 0,
      consecutiveSuccesses: 0,
      lastFailureTime: null,
      lastSuccessTime: null,
      stateChanges: [],
      errorCounts: new Map()
    };
    
    this.rollingWindow.buckets.clear();
    this.close();
  }
  
  /**
   * 手動でサーキットを開く
   */
  trip() {
    this.open();
  }
  
  /**
   * 現在の状態を取得
   */
  getState() {
    return this.state;
  }
  
  /**
   * サーキットが開いているかチェック
   */
  isOpen() {
    return this.state === CircuitState.OPEN;
  }
  
  /**
   * サーキットが閉じているかチェック
   */
  isClosed() {
    return this.state === CircuitState.CLOSED;
  }
  
  /**
   * サーキットが半開かチェック
   */
  isHalfOpen() {
    return this.state === CircuitState.HALF_OPEN;
  }
}

/**
 * サーキットブレーカーファクトリー
 */
class CircuitBreakerFactory {
  constructor() {
    this.breakers = new Map();
  }
  
  /**
   * サーキットブレーカーを作成または取得
   */
  create(name, options = {}) {
    if (!this.breakers.has(name)) {
      const breaker = new CircuitBreaker(name, options);
      this.breakers.set(name, breaker);
    }
    
    return this.breakers.get(name);
  }
  
  /**
   * すべてのサーキットブレーカーを取得
   */
  getAll() {
    return Array.from(this.breakers.values());
  }
  
  /**
   * 特定のサーキットブレーカーを取得
   */
  get(name) {
    return this.breakers.get(name);
  }
  
  /**
   * すべての統計情報を取得
   */
  getAllStats() {
    const stats = {};
    
    for (const [name, breaker] of this.breakers) {
      stats[name] = breaker.getStats();
    }
    
    return stats;
  }
  
  /**
   * すべてのサーキットブレーカーをリセット
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }
}

module.exports = {
  CircuitBreaker,
  CircuitBreakerFactory,
  CircuitState
};