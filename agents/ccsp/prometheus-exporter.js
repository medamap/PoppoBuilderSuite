/**
 * Prometheusメトリクス エクスポーター
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * Prometheus形式でのメトリクス公開機能
 */

const Logger = require('../../src/logger');

class PrometheusExporter {
  constructor(options = {}) {
    this.logger = new Logger('PrometheusExporter');
    this.config = {
      prefix: options.prefix || 'ccsp_',
      includeLabels: options.includeLabels !== false,
      ...options
    };
    
    // メトリクスデータ
    this.metrics = {
      // カウンター
      requests_total: 0,
      requests_success_total: 0,
      requests_error_total: 0,
      requests_timeout_total: 0,
      requests_rate_limited_total: 0,
      
      // ゲージ
      queue_size: {
        urgent: 0,
        high: 0,
        normal: 0,
        low: 0,
        scheduled: 0
      },
      active_requests: 0,
      session_valid: 1,
      
      // ヒストグラム（簡易実装）
      request_duration_seconds: {
        buckets: {
          '0.1': 0,
          '0.5': 0,
          '1.0': 0,
          '5.0': 0,
          '10.0': 0,
          '30.0': 0,
          '60.0': 0,
          '+Inf': 0
        },
        sum: 0,
        count: 0
      },
      
      // エージェント別メトリクス
      agent_requests: {},
      agent_errors: {},
      agent_response_time: {}
    };
    
    this.startTime = Date.now();
    
    this.logger.info('Prometheus Exporter initialized', {
      prefix: this.config.prefix
    });
  }
  
  /**
   * API使用量の記録
   */
  recordAPIUsage(usage) {
    const {
      agent = 'unknown',
      success = true,
      responseTime = 0,
      rateLimited = false,
      error = null
    } = usage;
    
    // 総カウンターの更新
    this.metrics.requests_total++;
    
    if (success) {
      this.metrics.requests_success_total++;
    } else {
      this.metrics.requests_error_total++;
    }
    
    if (rateLimited) {
      this.metrics.requests_rate_limited_total++;
    }
    
    if (error && error.includes('timeout')) {
      this.metrics.requests_timeout_total++;
    }
    
    // レスポンス時間ヒストグラムの更新
    this.updateHistogram('request_duration_seconds', responseTime / 1000);
    
    // エージェント別メトリクスの更新
    this.updateAgentMetrics(agent, success, responseTime);
  }
  
  /**
   * キューサイズの更新
   */
  updateQueueSize(priority, delta = 1) {
    if (this.metrics.queue_size[priority] !== undefined) {
      this.metrics.queue_size[priority] = Math.max(0, this.metrics.queue_size[priority] + delta);
    }
  }
  
  /**
   * キューサイズの増加
   */
  incrementQueueSize(priority) {
    this.updateQueueSize(priority, 1);
  }
  
  /**
   * キューサイズの減少
   */
  decrementQueueSize(priority) {
    this.updateQueueSize(priority, -1);
  }
  
  /**
   * アクティブリクエスト数の設定
   */
  setActiveRequests(count) {
    this.metrics.active_requests = count;
  }
  
  /**
   * セッション状態の設定
   */
  setSessionValid(valid) {
    this.metrics.session_valid = valid ? 1 : 0;
  }
  
  /**
   * ヒストグラムの更新
   */
  updateHistogram(metricName, value) {
    const histogram = this.metrics[metricName];
    if (!histogram) return;
    
    histogram.sum += value;
    histogram.count++;
    
    // バケットの更新
    for (const [bucket, _] of Object.entries(histogram.buckets)) {
      if (bucket === '+Inf' || value <= parseFloat(bucket)) {
        histogram.buckets[bucket]++;
      }
    }
  }
  
  /**
   * エージェント別メトリクスの更新
   */
  updateAgentMetrics(agent, success, responseTime) {
    // リクエスト数
    if (!this.metrics.agent_requests[agent]) {
      this.metrics.agent_requests[agent] = 0;
    }
    this.metrics.agent_requests[agent]++;
    
    // エラー数
    if (!success) {
      if (!this.metrics.agent_errors[agent]) {
        this.metrics.agent_errors[agent] = 0;
      }
      this.metrics.agent_errors[agent]++;
    }
    
    // レスポンス時間
    if (!this.metrics.agent_response_time[agent]) {
      this.metrics.agent_response_time[agent] = {
        sum: 0,
        count: 0
      };
    }
    this.metrics.agent_response_time[agent].sum += responseTime;
    this.metrics.agent_response_time[agent].count++;
  }
  
  /**
   * カスタムメトリクスの設定
   */
  setCustomMetric(name, value, labels = {}) {
    if (!this.metrics.custom) {
      this.metrics.custom = {};
    }
    
    const key = this.generateMetricKey(name, labels);
    this.metrics.custom[key] = {
      name,
      value,
      labels,
      timestamp: Date.now()
    };
  }
  
  /**
   * メトリクスキーの生成
   */
  generateMetricKey(name, labels) {
    const labelString = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    
    return labelString ? `${name}{${labelString}}` : name;
  }
  
  /**
   * Prometheus形式のメトリクス生成
   */
  async getMetrics() {
    const timestamp = Date.now();
    let output = [];
    
    // ヘッダーコメント
    output.push('# HELP ccsp_info CCSP Agent information');
    output.push('# TYPE ccsp_info gauge');
    output.push(`ccsp_info{version="4.0.0",component="ccsp-agent"} 1 ${timestamp}`);
    output.push('');
    
    // アップタイム
    const uptime = (timestamp - this.startTime) / 1000;
    output.push('# HELP ccsp_uptime_seconds CCSP Agent uptime in seconds');
    output.push('# TYPE ccsp_uptime_seconds counter');
    output.push(`ccsp_uptime_seconds ${uptime} ${timestamp}`);
    output.push('');
    
    // リクエスト総数
    output.push('# HELP ccsp_requests_total Total number of requests processed');
    output.push('# TYPE ccsp_requests_total counter');
    output.push(`ccsp_requests_total ${this.metrics.requests_total} ${timestamp}`);
    output.push('');
    
    // 成功リクエスト数
    output.push('# HELP ccsp_requests_success_total Total number of successful requests');
    output.push('# TYPE ccsp_requests_success_total counter');
    output.push(`ccsp_requests_success_total ${this.metrics.requests_success_total} ${timestamp}`);
    output.push('');
    
    // エラーリクエスト数
    output.push('# HELP ccsp_requests_error_total Total number of failed requests');
    output.push('# TYPE ccsp_requests_error_total counter');
    output.push(`ccsp_requests_error_total ${this.metrics.requests_error_total} ${timestamp}`);
    output.push('');
    
    // タイムアウトリクエスト数
    output.push('# HELP ccsp_requests_timeout_total Total number of timeout requests');
    output.push('# TYPE ccsp_requests_timeout_total counter');
    output.push(`ccsp_requests_timeout_total ${this.metrics.requests_timeout_total} ${timestamp}`);
    output.push('');
    
    // レート制限リクエスト数
    output.push('# HELP ccsp_requests_rate_limited_total Total number of rate limited requests');
    output.push('# TYPE ccsp_requests_rate_limited_total counter');
    output.push(`ccsp_requests_rate_limited_total ${this.metrics.requests_rate_limited_total} ${timestamp}`);
    output.push('');
    
    // キューサイズ
    output.push('# HELP ccsp_queue_size Current queue size by priority');
    output.push('# TYPE ccsp_queue_size gauge');
    for (const [priority, size] of Object.entries(this.metrics.queue_size)) {
      output.push(`ccsp_queue_size{priority="${priority}"} ${size} ${timestamp}`);
    }
    output.push('');
    
    // アクティブリクエスト数
    output.push('# HELP ccsp_active_requests Current number of active requests');
    output.push('# TYPE ccsp_active_requests gauge');
    output.push(`ccsp_active_requests ${this.metrics.active_requests} ${timestamp}`);
    output.push('');
    
    // セッション状態
    output.push('# HELP ccsp_session_valid Claude session validity (1=valid, 0=invalid)');
    output.push('# TYPE ccsp_session_valid gauge');
    output.push(`ccsp_session_valid ${this.metrics.session_valid} ${timestamp}`);
    output.push('');
    
    // レスポンス時間ヒストグラム
    const histogram = this.metrics.request_duration_seconds;
    output.push('# HELP ccsp_request_duration_seconds Request duration in seconds');
    output.push('# TYPE ccsp_request_duration_seconds histogram');
    
    for (const [bucket, count] of Object.entries(histogram.buckets)) {
      output.push(`ccsp_request_duration_seconds_bucket{le="${bucket}"} ${count} ${timestamp}`);
    }
    output.push(`ccsp_request_duration_seconds_sum ${histogram.sum} ${timestamp}`);
    output.push(`ccsp_request_duration_seconds_count ${histogram.count} ${timestamp}`);
    output.push('');
    
    // エージェント別リクエスト数
    if (Object.keys(this.metrics.agent_requests).length > 0) {
      output.push('# HELP ccsp_agent_requests_total Total requests by agent');
      output.push('# TYPE ccsp_agent_requests_total counter');
      for (const [agent, count] of Object.entries(this.metrics.agent_requests)) {
        output.push(`ccsp_agent_requests_total{agent="${agent}"} ${count} ${timestamp}`);
      }
      output.push('');
    }
    
    // エージェント別エラー数
    if (Object.keys(this.metrics.agent_errors).length > 0) {
      output.push('# HELP ccsp_agent_errors_total Total errors by agent');
      output.push('# TYPE ccsp_agent_errors_total counter');
      for (const [agent, count] of Object.entries(this.metrics.agent_errors)) {
        output.push(`ccsp_agent_errors_total{agent="${agent}"} ${count} ${timestamp}`);
      }
      output.push('');
    }
    
    // エージェント別平均レスポンス時間
    if (Object.keys(this.metrics.agent_response_time).length > 0) {
      output.push('# HELP ccsp_agent_response_time_seconds Average response time by agent');
      output.push('# TYPE ccsp_agent_response_time_seconds gauge');
      for (const [agent, data] of Object.entries(this.metrics.agent_response_time)) {
        const avg = data.count > 0 ? (data.sum / data.count) / 1000 : 0;
        output.push(`ccsp_agent_response_time_seconds{agent="${agent}"} ${avg} ${timestamp}`);
      }
      output.push('');
    }
    
    // カスタムメトリクス
    if (this.metrics.custom) {
      for (const [key, metric] of Object.entries(this.metrics.custom)) {
        output.push(`# HELP ccsp_${metric.name} Custom metric: ${metric.name}`);
        output.push(`# TYPE ccsp_${metric.name} gauge`);
        
        const labelString = Object.entries(metric.labels)
          .map(([k, v]) => `${k}="${v}"`)
          .join(',');
        
        const metricName = labelString ? 
          `ccsp_${metric.name}{${labelString}}` : 
          `ccsp_${metric.name}`;
        
        output.push(`${metricName} ${metric.value} ${timestamp}`);
      }
      output.push('');
    }
    
    return output.join('\n');
  }
  
  /**
   * メトリクス統計の取得
   */
  getStats() {
    const totalRequests = this.metrics.requests_total;
    
    return {
      totalRequests,
      successRate: totalRequests > 0 ? (this.metrics.requests_success_total / totalRequests) : 0,
      errorRate: totalRequests > 0 ? (this.metrics.requests_error_total / totalRequests) : 0,
      rateLimitRate: totalRequests > 0 ? (this.metrics.requests_rate_limited_total / totalRequests) : 0,
      averageResponseTime: this.calculateAverageResponseTime(),
      queueSizes: { ...this.metrics.queue_size },
      activeRequests: this.metrics.active_requests,
      sessionValid: this.metrics.session_valid === 1,
      uptime: (Date.now() - this.startTime) / 1000
    };
  }
  
  /**
   * 平均レスポンス時間の計算
   */
  calculateAverageResponseTime() {
    const histogram = this.metrics.request_duration_seconds;
    return histogram.count > 0 ? (histogram.sum / histogram.count) : 0;
  }
  
  /**
   * メトリクスのリセット
   */
  resetMetrics() {
    // カウンターはリセットしない（累積値）
    this.metrics.queue_size = {
      urgent: 0,
      high: 0,
      normal: 0,
      low: 0,
      scheduled: 0
    };
    this.metrics.active_requests = 0;
    
    this.logger.info('Metrics reset (counters preserved)');
  }
  
  /**
   * メトリクスの完全クリア
   */
  clearAllMetrics() {
    this.metrics = {
      requests_total: 0,
      requests_success_total: 0,
      requests_error_total: 0,
      requests_timeout_total: 0,
      requests_rate_limited_total: 0,
      queue_size: {
        urgent: 0,
        high: 0,
        normal: 0,
        low: 0,
        scheduled: 0
      },
      active_requests: 0,
      session_valid: 1,
      request_duration_seconds: {
        buckets: {
          '0.1': 0,
          '0.5': 0,
          '1.0': 0,
          '5.0': 0,
          '10.0': 0,
          '30.0': 0,
          '60.0': 0,
          '+Inf': 0
        },
        sum: 0,
        count: 0
      },
      agent_requests: {},
      agent_errors: {},
      agent_response_time: {}
    };
    
    this.startTime = Date.now();
    this.logger.info('All metrics cleared');
  }
  
  /**
   * クリーンアップ
   */
  async shutdown() {
    this.logger.info('Prometheus Exporter shutting down', this.getStats());
  }
}

module.exports = PrometheusExporter;