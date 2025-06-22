/**
 * CCSP API使用量モニタリングシステム
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * API使用量の追跡、統計分析、予測機能を提供
 */

const EventEmitter = require('events');
const Logger = require('../../src/logger');

class UsageMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('UsageMonitor');
    this.config = {
      windowSize: options.windowSize || 3600000, // 1時間のウィンドウ
      maxDataPoints: options.maxDataPoints || 1440, // 24時間分（1分間隔）
      alertThreshold: options.alertThreshold || 0.8, // 80%でアラート
      predictionWindow: options.predictionWindow || 1800000, // 30分先を予測
      ...options
    };
    
    // 使用量データ（時系列）
    this.usageData = [];
    
    // エージェント別統計
    this.agentStats = new Map();
    
    // 現在の使用量カウンター
    this.currentUsage = {
      requests: 0,
      successCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      totalResponseTime: 0,
      windowStart: Date.now()
    };
    
    // レート制限情報
    this.rateLimitInfo = {
      limit: null,
      remaining: null,
      resetTime: null,
      isLimited: false
    };
    
    // アラート状態
    this.alertState = {
      isActive: false,
      lastAlertTime: null,
      alertCount: 0
    };
    
    // 定期的なデータ集計
    this.startDataCollection();
    
    this.logger.info('Usage Monitor initialized', {
      windowSize: this.config.windowSize,
      maxDataPoints: this.config.maxDataPoints,
      alertThreshold: this.config.alertThreshold
    });
  }
  
  /**
   * API使用量を記録
   * @param {Object} usage - 使用量情報
   */
  recordUsage(usage) {
    const {
      agent,
      requestId,
      success = true,
      responseTime = 0,
      rateLimited = false,
      error = null
    } = usage;
    
    const timestamp = Date.now();
    
    // 現在のウィンドウ統計を更新
    this.currentUsage.requests++;
    
    if (success) {
      this.currentUsage.successCount++;
    } else {
      this.currentUsage.errorCount++;
    }
    
    if (rateLimited) {
      this.currentUsage.rateLimitCount++;
    }
    
    this.currentUsage.totalResponseTime += responseTime;
    
    // エージェント別統計を更新
    this.updateAgentStats(agent, {
      success,
      responseTime,
      rateLimited,
      error,
      timestamp
    });
    
    // レート制限状態の更新
    if (rateLimited && usage.rateLimitInfo) {
      this.updateRateLimitInfo(usage.rateLimitInfo);
    }
    
    // 使用量予測とアラート
    this.checkUsageThreshold();
    
    this.logger.debug('Usage recorded', {
      agent,
      requestId,
      success,
      responseTime: `${responseTime}ms`,
      currentRequests: this.currentUsage.requests
    });
    
    this.emit('usageRecorded', {
      ...usage,
      timestamp,
      currentStats: this.getCurrentWindowStats()
    });
  }
  
  /**
   * エージェント別統計の更新
   */
  updateAgentStats(agentName, stats) {
    if (!this.agentStats.has(agentName)) {
      this.agentStats.set(agentName, {
        totalRequests: 0,
        successCount: 0,
        errorCount: 0,
        rateLimitCount: 0,
        totalResponseTime: 0,
        averageResponseTime: 0,
        errorRate: 0,
        firstSeen: stats.timestamp,
        lastSeen: stats.timestamp,
        recentErrors: []
      });
    }
    
    const agentStat = this.agentStats.get(agentName);
    
    agentStat.totalRequests++;
    agentStat.lastSeen = stats.timestamp;
    
    if (stats.success) {
      agentStat.successCount++;
    } else {
      agentStat.errorCount++;
      // 最近のエラーを記録（最大10件）
      agentStat.recentErrors.push({
        error: stats.error,
        timestamp: stats.timestamp
      });
      if (agentStat.recentErrors.length > 10) {
        agentStat.recentErrors.shift();
      }
    }
    
    if (stats.rateLimited) {
      agentStat.rateLimitCount++;
    }
    
    agentStat.totalResponseTime += stats.responseTime;
    agentStat.averageResponseTime = agentStat.totalResponseTime / agentStat.totalRequests;
    agentStat.errorRate = agentStat.errorCount / agentStat.totalRequests;
  }
  
  /**
   * レート制限情報の更新
   */
  updateRateLimitInfo(rateLimitInfo) {
    this.rateLimitInfo = {
      ...this.rateLimitInfo,
      ...rateLimitInfo,
      isLimited: true,
      lastLimitTime: Date.now()
    };
    
    this.logger.warn('Rate limit detected', this.rateLimitInfo);
    this.emit('rateLimitUpdated', this.rateLimitInfo);
  }
  
  /**
   * 現在のウィンドウ統計を取得
   */
  getCurrentWindowStats() {
    const windowDuration = Date.now() - this.currentUsage.windowStart;
    
    return {
      requests: this.currentUsage.requests,
      successCount: this.currentUsage.successCount,
      errorCount: this.currentUsage.errorCount,
      rateLimitCount: this.currentUsage.rateLimitCount,
      successRate: this.currentUsage.requests > 0 ? 
        this.currentUsage.successCount / this.currentUsage.requests : 0,
      errorRate: this.currentUsage.requests > 0 ? 
        this.currentUsage.errorCount / this.currentUsage.requests : 0,
      averageResponseTime: this.currentUsage.requests > 0 ? 
        this.currentUsage.totalResponseTime / this.currentUsage.requests : 0,
      requestsPerMinute: windowDuration > 0 ? 
        (this.currentUsage.requests * 60000) / windowDuration : 0,
      windowDuration,
      windowStart: this.currentUsage.windowStart
    };
  }
  
  /**
   * エージェント別統計の取得
   */
  getAgentStats(agentName = null) {
    if (agentName) {
      return this.agentStats.get(agentName) || null;
    }
    
    return Object.fromEntries(this.agentStats.entries());
  }
  
  /**
   * 時系列統計の取得
   */
  getTimeSeriesStats(minutes = 60) {
    const cutoffTime = Date.now() - (minutes * 60000);
    return this.usageData.filter(data => data.timestamp >= cutoffTime);
  }
  
  /**
   * 使用量予測
   */
  predictUsage(minutesAhead = 30) {
    const recentData = this.getTimeSeriesStats(60); // 過去1時間のデータ
    
    if (recentData.length < 2) {
      return {
        prediction: null,
        confidence: 0,
        warning: 'Insufficient data for prediction'
      };
    }
    
    // 線形回帰による簡単な予測
    const trend = this.calculateTrend(recentData);
    const currentRate = this.getCurrentWindowStats().requestsPerMinute;
    
    const predictedRate = currentRate + (trend * minutesAhead);
    const predictedTotal = predictedRate * minutesAhead;
    
    // 信頼度の計算（データの一貫性に基づく）
    const confidence = this.calculatePredictionConfidence(recentData);
    
    return {
      prediction: {
        requestsPerMinute: Math.max(0, predictedRate),
        totalRequests: Math.max(0, predictedTotal),
        timeframe: minutesAhead
      },
      confidence,
      trend: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
      currentRate
    };
  }
  
  /**
   * レート制限到達予測
   */
  predictRateLimit() {
    if (!this.rateLimitInfo.limit) {
      return {
        prediction: null,
        warning: 'Rate limit information not available'
      };
    }
    
    const prediction = this.predictUsage(60); // 1時間先を予測
    
    if (!prediction.prediction) {
      return { prediction: null, warning: 'Cannot predict usage' };
    }
    
    const currentUsage = this.getCurrentWindowStats().requests;
    const remainingLimit = this.rateLimitInfo.limit - currentUsage;
    const minutesToLimit = remainingLimit / prediction.prediction.requestsPerMinute;
    
    return {
      prediction: {
        minutesToLimit: Math.max(0, minutesToLimit),
        remainingRequests: Math.max(0, remainingLimit),
        willExceedLimit: minutesToLimit < 60, // 1時間以内に制限到達
        confidence: prediction.confidence
      },
      recommendation: this.generateRateLimitRecommendation(minutesToLimit)
    };
  }
  
  /**
   * レート制限の推奨事項生成
   */
  generateRateLimitRecommendation(minutesToLimit) {
    if (minutesToLimit < 5) {
      return {
        action: 'emergency_throttle',
        message: 'Immediate throttling required - rate limit imminent',
        suggestedDelay: 300000 // 5分
      };
    } else if (minutesToLimit < 15) {
      return {
        action: 'moderate_throttle',
        message: 'Consider reducing request rate',
        suggestedDelay: 120000 // 2分
      };
    } else if (minutesToLimit < 30) {
      return {
        action: 'light_throttle',
        message: 'Monitor usage closely',
        suggestedDelay: 60000 // 1分
      };
    } else {
      return {
        action: 'normal',
        message: 'Usage within safe limits',
        suggestedDelay: 0
      };
    }
  }
  
  /**
   * 使用量閾値のチェック
   */
  checkUsageThreshold() {
    if (!this.rateLimitInfo.limit) return;
    
    const currentUsage = this.getCurrentWindowStats().requests;
    const usageRatio = currentUsage / this.rateLimitInfo.limit;
    
    if (usageRatio >= this.config.alertThreshold && !this.alertState.isActive) {
      this.triggerAlert('usage_threshold', {
        currentUsage,
        limit: this.rateLimitInfo.limit,
        usageRatio,
        threshold: this.config.alertThreshold
      });
    } else if (usageRatio < this.config.alertThreshold && this.alertState.isActive) {
      this.clearAlert('usage_threshold');
    }
  }
  
  /**
   * アラートの発生
   */
  triggerAlert(type, data) {
    this.alertState.isActive = true;
    this.alertState.lastAlertTime = Date.now();
    this.alertState.alertCount++;
    
    const alert = {
      type,
      data,
      timestamp: Date.now(),
      severity: this.calculateAlertSeverity(type, data)
    };
    
    this.logger.warn('Usage alert triggered', alert);
    this.emit('usageAlert', alert);
  }
  
  /**
   * アラートのクリア
   */
  clearAlert(type) {
    this.alertState.isActive = false;
    
    this.logger.info('Usage alert cleared', { type });
    this.emit('alertCleared', { type, timestamp: Date.now() });
  }
  
  /**
   * アラート重要度の計算
   */
  calculateAlertSeverity(type, data) {
    switch (type) {
      case 'usage_threshold':
        if (data.usageRatio >= 0.95) return 'critical';
        if (data.usageRatio >= 0.9) return 'high';
        return 'medium';
      case 'rate_limit':
        return 'critical';
      case 'error_rate':
        if (data.errorRate >= 0.5) return 'high';
        return 'medium';
      default:
        return 'low';
    }
  }
  
  /**
   * データ収集の開始
   */
  startDataCollection() {
    // 1分ごとにデータを集計
    this.dataCollectionInterval = setInterval(() => {
      this.collectWindowData();
    }, 60000);
    
    this.logger.info('Data collection started');
  }
  
  /**
   * ウィンドウデータの集計
   */
  collectWindowData() {
    const stats = this.getCurrentWindowStats();
    
    this.usageData.push({
      timestamp: Date.now(),
      ...stats
    });
    
    // 古いデータを削除（maxDataPointsを超えた分）
    if (this.usageData.length > this.config.maxDataPoints) {
      this.usageData.shift();
    }
    
    // 次のウィンドウの準備
    this.resetCurrentWindow();
    
    this.emit('dataCollected', stats);
  }
  
  /**
   * 現在ウィンドウのリセット
   */
  resetCurrentWindow() {
    this.currentUsage = {
      requests: 0,
      successCount: 0,
      errorCount: 0,
      rateLimitCount: 0,
      totalResponseTime: 0,
      windowStart: Date.now()
    };
  }
  
  /**
   * トレンドの計算
   */
  calculateTrend(data) {
    if (data.length < 2) return 0;
    
    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    
    for (let i = 0; i < n; i++) {
      const x = i;
      const y = data[i].requestsPerMinute;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
    }
    
    // 線形回帰の傾き
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  }
  
  /**
   * 予測信頼度の計算
   */
  calculatePredictionConfidence(data) {
    if (data.length < 3) return 0;
    
    // データの変動係数を計算
    const values = data.map(d => d.requestsPerMinute);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const cv = mean > 0 ? stdDev / mean : 1;
    
    // 変動が少ないほど信頼度が高い
    return Math.max(0, Math.min(1, 1 - cv));
  }
  
  /**
   * 統計サマリーの取得
   */
  getSummary() {
    return {
      currentWindow: this.getCurrentWindowStats(),
      agentStats: this.getAgentStats(),
      rateLimitInfo: this.rateLimitInfo,
      alertState: this.alertState,
      prediction: this.predictUsage(),
      rateLimitPrediction: this.predictRateLimit(),
      totalDataPoints: this.usageData.length,
      monitoringDuration: Date.now() - (this.usageData[0]?.timestamp || Date.now())
    };
  }
  
  /**
   * クリーンアップ
   */
  async shutdown() {
    if (this.dataCollectionInterval) {
      clearInterval(this.dataCollectionInterval);
    }
    
    this.logger.info('Usage Monitor shutdown', {
      totalDataPoints: this.usageData.length,
      totalAgents: this.agentStats.size
    });
  }
}

module.exports = UsageMonitor;