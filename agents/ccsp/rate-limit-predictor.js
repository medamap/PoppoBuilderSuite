/**
 * Rate Limit Predictor for CCSP
 * Predicts when rate limits will be reached and provides throttling recommendations
 */

const EventEmitter = require('events');

class RateLimitPredictor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      // Claude APIのレート制限設定
      limits: {
        tokensPerMinute: options.tokensPerMinute || 100000,
        requestsPerMinute: options.requestsPerMinute || 50,
        dailyTokenLimit: options.dailyTokenLimit || 10000000,
        monthlyTokenLimit: options.monthlyTokenLimit || 300000000
      },
      // 警告閾値（％）
      warningThresholds: {
        immediate: options.immediateWarning || 90,    // 即時警告
        short: options.shortWarning || 80,            // 短期警告
        medium: options.mediumWarning || 70,          // 中期警告
        long: options.longWarning || 60               // 長期警告
      },
      // 予測設定
      prediction: {
        windowSize: options.windowSize || 60,         // 予測ウィンドウサイズ（秒）
        sampleInterval: options.sampleInterval || 5   // サンプリング間隔（秒）
      },
      ...options
    };
    
    // 使用量履歴
    this.history = {
      tokens: [],      // { timestamp, count }
      requests: []     // { timestamp, count }
    };
    
    // 現在の使用量
    this.current = {
      minute: {
        tokens: 0,
        requests: 0,
        startTime: Date.now()
      },
      day: {
        tokens: 0,
        requests: 0,
        startTime: this.getStartOfDay()
      },
      month: {
        tokens: 0,
        requests: 0,
        startTime: this.getStartOfMonth()
      }
    };
    
    // 予測結果
    this.predictions = {
      tokensPerMinute: null,
      requestsPerMinute: null,
      timeToTokenLimit: null,
      timeToRequestLimit: null,
      recommendedDelay: 0
    };
    
    // 定期的な予測更新
    this.predictionInterval = setInterval(() => {
      this.updatePredictions();
    }, this.options.prediction.sampleInterval * 1000);
  }
  
  /**
   * 使用量を記録
   * @param {number} tokens - 使用トークン数
   * @param {number} requests - リクエスト数（通常は1）
   */
  recordUsage(tokens, requests = 1) {
    const now = Date.now();
    
    // 履歴に追加
    this.history.tokens.push({ timestamp: now, count: tokens });
    this.history.requests.push({ timestamp: now, count: requests });
    
    // 現在の使用量を更新
    this.updateCurrentUsage(tokens, requests);
    
    // 古い履歴を削除
    this.cleanupHistory();
    
    // 予測を更新
    this.updatePredictions();
  }
  
  /**
   * 現在の使用量を更新
   */
  updateCurrentUsage(tokens, requests) {
    const now = Date.now();
    
    // 分単位の使用量
    if (now - this.current.minute.startTime > 60000) {
      this.current.minute = {
        tokens: tokens,
        requests: requests,
        startTime: now
      };
    } else {
      this.current.minute.tokens += tokens;
      this.current.minute.requests += requests;
    }
    
    // 日単位の使用量
    if (now > this.getStartOfDay() + 86400000) {
      this.current.day = {
        tokens: tokens,
        requests: requests,
        startTime: this.getStartOfDay()
      };
    } else {
      this.current.day.tokens += tokens;
      this.current.day.requests += requests;
    }
    
    // 月単位の使用量
    if (now > this.getStartOfMonth() + 30 * 86400000) {
      this.current.month = {
        tokens: tokens,
        requests: requests,
        startTime: this.getStartOfMonth()
      };
    } else {
      this.current.month.tokens += tokens;
      this.current.month.requests += requests;
    }
  }
  
  /**
   * 予測を更新
   */
  updatePredictions() {
    const now = Date.now();
    const windowStart = now - (this.options.prediction.windowSize * 1000);
    
    // ウィンドウ内の使用量を計算
    const windowTokens = this.history.tokens
      .filter(h => h.timestamp >= windowStart)
      .reduce((sum, h) => sum + h.count, 0);
    
    const windowRequests = this.history.requests
      .filter(h => h.timestamp >= windowStart)
      .reduce((sum, h) => sum + h.count, 0);
    
    // 分あたりの予測値を計算
    const windowMinutes = this.options.prediction.windowSize / 60;
    this.predictions.tokensPerMinute = windowTokens / windowMinutes;
    this.predictions.requestsPerMinute = windowRequests / windowMinutes;
    
    // レート制限到達までの時間を予測
    this.predictions.timeToTokenLimit = this.predictTimeToLimit(
      this.predictions.tokensPerMinute,
      this.options.limits.tokensPerMinute,
      this.current.minute.tokens
    );
    
    this.predictions.timeToRequestLimit = this.predictTimeToLimit(
      this.predictions.requestsPerMinute,
      this.options.limits.requestsPerMinute,
      this.current.minute.requests
    );
    
    // 推奨遅延時間を計算
    this.predictions.recommendedDelay = this.calculateRecommendedDelay();
    
    // 警告をチェック
    this.checkWarnings();
  }
  
  /**
   * レート制限到達までの時間を予測
   * @param {number} rate - 現在のレート（分あたり）
   * @param {number} limit - レート制限
   * @param {number} current - 現在の使用量
   */
  predictTimeToLimit(rate, limit, current) {
    if (rate <= 0) return Infinity;
    
    const remaining = limit - current;
    if (remaining <= 0) return 0;
    
    return (remaining / rate) * 60; // 秒単位で返す
  }
  
  /**
   * 推奨遅延時間を計算
   */
  calculateRecommendedDelay() {
    // トークンとリクエストの両方を考慮
    const tokenUtilization = this.predictions.tokensPerMinute / this.options.limits.tokensPerMinute;
    const requestUtilization = this.predictions.requestsPerMinute / this.options.limits.requestsPerMinute;
    
    const maxUtilization = Math.max(tokenUtilization, requestUtilization);
    
    // 利用率に基づいて遅延を計算
    if (maxUtilization >= 0.9) {
      // 90%以上：積極的なスロットリング
      return Math.max(5000, 60000 / this.options.limits.requestsPerMinute * 2);
    } else if (maxUtilization >= 0.7) {
      // 70%以上：適度なスロットリング
      return Math.max(2000, 60000 / this.options.limits.requestsPerMinute * 1.5);
    } else if (maxUtilization >= 0.5) {
      // 50%以上：軽いスロットリング
      return Math.max(1000, 60000 / this.options.limits.requestsPerMinute);
    } else {
      // 50%未満：最小遅延
      return 500;
    }
  }
  
  /**
   * 警告をチェック
   */
  checkWarnings() {
    const tokenUtilization = (this.predictions.tokensPerMinute / this.options.limits.tokensPerMinute) * 100;
    const requestUtilization = (this.predictions.requestsPerMinute / this.options.limits.requestsPerMinute) * 100;
    
    const maxUtilization = Math.max(tokenUtilization, requestUtilization);
    
    // 即時警告
    if (maxUtilization >= this.options.warningThresholds.immediate) {
      this.emit('warning:immediate', {
        utilization: maxUtilization,
        predictions: this.predictions,
        message: 'Rate limit approaching! Immediate action required.'
      });
    }
    // 短期警告
    else if (maxUtilization >= this.options.warningThresholds.short) {
      this.emit('warning:short', {
        utilization: maxUtilization,
        predictions: this.predictions,
        message: 'High rate limit utilization detected.'
      });
    }
    // 中期警告
    else if (maxUtilization >= this.options.warningThresholds.medium) {
      this.emit('warning:medium', {
        utilization: maxUtilization,
        predictions: this.predictions,
        message: 'Moderate rate limit utilization.'
      });
    }
    // 長期警告
    else if (maxUtilization >= this.options.warningThresholds.long) {
      this.emit('warning:long', {
        utilization: maxUtilization,
        predictions: this.predictions,
        message: 'Rate limit utilization increasing.'
      });
    }
    
    // 日次・月次制限のチェック
    this.checkLongTermLimits();
  }
  
  /**
   * 長期制限をチェック
   */
  checkLongTermLimits() {
    // 日次制限
    const dayUtilization = (this.current.day.tokens / this.options.limits.dailyTokenLimit) * 100;
    if (dayUtilization >= 80) {
      this.emit('warning:daily', {
        utilization: dayUtilization,
        current: this.current.day.tokens,
        limit: this.options.limits.dailyTokenLimit,
        message: 'Approaching daily token limit.'
      });
    }
    
    // 月次制限
    const monthUtilization = (this.current.month.tokens / this.options.limits.monthlyTokenLimit) * 100;
    if (monthUtilization >= 80) {
      this.emit('warning:monthly', {
        utilization: monthUtilization,
        current: this.current.month.tokens,
        limit: this.options.limits.monthlyTokenLimit,
        message: 'Approaching monthly token limit.'
      });
    }
  }
  
  /**
   * 現在の状態を取得
   */
  getStatus() {
    return {
      current: this.current,
      predictions: this.predictions,
      utilization: {
        tokens: (this.predictions.tokensPerMinute / this.options.limits.tokensPerMinute) * 100,
        requests: (this.predictions.requestsPerMinute / this.options.limits.requestsPerMinute) * 100,
        daily: (this.current.day.tokens / this.options.limits.dailyTokenLimit) * 100,
        monthly: (this.current.month.tokens / this.options.limits.monthlyTokenLimit) * 100
      },
      recommendations: {
        delay: this.predictions.recommendedDelay,
        action: this.getRecommendedAction()
      }
    };
  }
  
  /**
   * 推奨アクションを取得
   */
  getRecommendedAction() {
    const maxUtilization = Math.max(
      (this.predictions.tokensPerMinute / this.options.limits.tokensPerMinute) * 100,
      (this.predictions.requestsPerMinute / this.options.limits.requestsPerMinute) * 100
    );
    
    if (maxUtilization >= 90) {
      return 'PAUSE_QUEUE';
    } else if (maxUtilization >= 80) {
      return 'REDUCE_PRIORITY';
    } else if (maxUtilization >= 70) {
      return 'INCREASE_DELAY';
    } else if (maxUtilization >= 50) {
      return 'MONITOR';
    } else {
      return 'NORMAL';
    }
  }
  
  /**
   * 使用パターンを分析
   */
  analyzeUsagePattern() {
    const hourlyPattern = new Array(24).fill(0);
    const now = Date.now();
    const dayStart = this.getStartOfDay();
    
    // 過去24時間の使用パターンを分析
    this.history.tokens.forEach(h => {
      if (h.timestamp >= dayStart) {
        const hour = new Date(h.timestamp).getHours();
        hourlyPattern[hour] += h.count;
      }
    });
    
    // ピーク時間を特定
    let peakHour = 0;
    let peakUsage = 0;
    hourlyPattern.forEach((usage, hour) => {
      if (usage > peakUsage) {
        peakUsage = usage;
        peakHour = hour;
      }
    });
    
    return {
      hourlyPattern,
      peakHour,
      peakUsage,
      currentHour: new Date().getHours()
    };
  }
  
  /**
   * 古い履歴を削除
   */
  cleanupHistory() {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24時間
    
    this.history.tokens = this.history.tokens.filter(h => h.timestamp >= cutoff);
    this.history.requests = this.history.requests.filter(h => h.timestamp >= cutoff);
  }
  
  /**
   * 今日の開始時刻を取得
   */
  getStartOfDay() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }
  
  /**
   * 今月の開始時刻を取得
   */
  getStartOfMonth() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
  
  /**
   * クリーンアップ
   */
  cleanup() {
    if (this.predictionInterval) {
      clearInterval(this.predictionInterval);
      this.predictionInterval = null;
    }
  }
}

module.exports = RateLimitPredictor;