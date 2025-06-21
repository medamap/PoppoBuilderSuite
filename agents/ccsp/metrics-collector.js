/**
 * メトリクス収集モジュール
 * 
 * 処理時間、成功率、エラー率などを記録
 */

class MetricsCollector {
  constructor(logger) {
    this.logger = logger;
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        failed: 0,
        timeout: 0,
        rateLimit: 0
      },
      executionTime: {
        total: 0,
        count: 0,
        min: Number.MAX_SAFE_INTEGER,
        max: 0,
        histogram: {} // 時間帯別の分布
      },
      byAgent: {}, // エージェント別の統計
      byType: {}, // タイプ別の統計
      errors: [], // 最新のエラー（最大100件）
      startTime: Date.now()
    };
    
    // 定期的なメトリクスレポート（5分ごと）
    this.reportInterval = setInterval(() => {
      this.reportMetrics();
    }, 300000);
  }
  
  /**
   * リクエスト開始を記録
   */
  recordRequestStart(request) {
    this.metrics.requests.total++;
    
    // エージェント別カウント
    if (!this.metrics.byAgent[request.fromAgent]) {
      this.metrics.byAgent[request.fromAgent] = {
        total: 0,
        success: 0,
        failed: 0,
        avgTime: 0
      };
    }
    this.metrics.byAgent[request.fromAgent].total++;
    
    // タイプ別カウント
    if (!this.metrics.byType[request.type]) {
      this.metrics.byType[request.type] = {
        total: 0,
        success: 0,
        failed: 0,
        avgTime: 0
      };
    }
    this.metrics.byType[request.type].total++;
  }
  
  /**
   * リクエスト完了を記録
   */
  recordRequestComplete(request, result, executionTime) {
    if (result.success) {
      this.metrics.requests.success++;
      this.metrics.byAgent[request.fromAgent].success++;
      this.metrics.byType[request.type].success++;
    } else {
      this.metrics.requests.failed++;
      this.metrics.byAgent[request.fromAgent].failed++;
      this.metrics.byType[request.type].failed++;
      
      // エラーを記録
      this.recordError(request, result.error);
    }
    
    // 実行時間を記録
    this.recordExecutionTime(request, executionTime);
  }
  
  /**
   * レート制限を記録
   */
  recordRateLimit(request) {
    this.metrics.requests.rateLimit++;
  }
  
  /**
   * タイムアウトを記録
   */
  recordTimeout(request) {
    this.metrics.requests.timeout++;
  }
  
  /**
   * 実行時間を記録
   */
  recordExecutionTime(request, executionTime) {
    this.metrics.executionTime.total += executionTime;
    this.metrics.executionTime.count++;
    this.metrics.executionTime.min = Math.min(this.metrics.executionTime.min, executionTime);
    this.metrics.executionTime.max = Math.max(this.metrics.executionTime.max, executionTime);
    
    // ヒストグラムに追加（秒単位）
    const bucket = Math.floor(executionTime / 1000);
    if (!this.metrics.executionTime.histogram[bucket]) {
      this.metrics.executionTime.histogram[bucket] = 0;
    }
    this.metrics.executionTime.histogram[bucket]++;
    
    // エージェント別平均時間を更新
    const agentStats = this.metrics.byAgent[request.fromAgent];
    agentStats.avgTime = (agentStats.avgTime * (agentStats.success - 1) + executionTime) / agentStats.success;
    
    // タイプ別平均時間を更新
    const typeStats = this.metrics.byType[request.type];
    typeStats.avgTime = (typeStats.avgTime * (typeStats.success - 1) + executionTime) / typeStats.success;
  }
  
  /**
   * エラーを記録
   */
  recordError(request, error) {
    const errorRecord = {
      timestamp: new Date().toISOString(),
      requestId: request.requestId,
      fromAgent: request.fromAgent,
      type: request.type,
      error: error
    };
    
    this.metrics.errors.unshift(errorRecord);
    
    // 最大100件まで保持
    if (this.metrics.errors.length > 100) {
      this.metrics.errors.pop();
    }
  }
  
  /**
   * メトリクスをレポート
   */
  reportMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    const successRate = this.metrics.requests.total > 0 
      ? (this.metrics.requests.success / this.metrics.requests.total * 100).toFixed(2)
      : 0;
    const avgExecutionTime = this.metrics.executionTime.count > 0
      ? Math.round(this.metrics.executionTime.total / this.metrics.executionTime.count)
      : 0;
    
    this.logger.info('=== CCSP Metrics Report ===');
    this.logger.info(`Uptime: ${Math.round(uptime / 1000)}s`);
    this.logger.info(`Total Requests: ${this.metrics.requests.total}`);
    this.logger.info(`Success Rate: ${successRate}%`);
    this.logger.info(`Failed: ${this.metrics.requests.failed}`);
    this.logger.info(`Rate Limited: ${this.metrics.requests.rateLimit}`);
    this.logger.info(`Timeouts: ${this.metrics.requests.timeout}`);
    this.logger.info(`Average Execution Time: ${avgExecutionTime}ms`);
    this.logger.info(`Min/Max Time: ${this.metrics.executionTime.min}ms / ${this.metrics.executionTime.max}ms`);
    
    // エージェント別統計
    this.logger.info('By Agent:');
    for (const [agent, stats] of Object.entries(this.metrics.byAgent)) {
      this.logger.info(`  ${agent}: ${stats.total} requests, ${stats.success} success, avg ${Math.round(stats.avgTime)}ms`);
    }
    
    // タイプ別統計
    this.logger.info('By Type:');
    for (const [type, stats] of Object.entries(this.metrics.byType)) {
      this.logger.info(`  ${type}: ${stats.total} requests, ${stats.success} success, avg ${Math.round(stats.avgTime)}ms`);
    }
    
    this.logger.info('========================');
  }
  
  /**
   * 現在のメトリクスを取得
   */
  getMetrics() {
    const uptime = Date.now() - this.metrics.startTime;
    const successRate = this.metrics.requests.total > 0 
      ? (this.metrics.requests.success / this.metrics.requests.total * 100)
      : 0;
    const avgExecutionTime = this.metrics.executionTime.count > 0
      ? this.metrics.executionTime.total / this.metrics.executionTime.count
      : 0;
    
    return {
      uptime,
      requests: { ...this.metrics.requests },
      executionTime: {
        average: avgExecutionTime,
        min: this.metrics.executionTime.min === Number.MAX_SAFE_INTEGER ? 0 : this.metrics.executionTime.min,
        max: this.metrics.executionTime.max,
        histogram: { ...this.metrics.executionTime.histogram }
      },
      successRate,
      byAgent: { ...this.metrics.byAgent },
      byType: { ...this.metrics.byType },
      recentErrors: this.metrics.errors.slice(0, 10)
    };
  }
  
  /**
   * クリーンアップ
   */
  cleanup() {
    if (this.reportInterval) {
      clearInterval(this.reportInterval);
    }
    // 最後のレポートを出力
    this.reportMetrics();
  }
}

module.exports = MetricsCollector;