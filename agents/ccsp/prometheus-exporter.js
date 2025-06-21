/**
 * Prometheus Exporter for CCSP Agent
 * Prometheus形式のメトリクスを提供
 */

const express = require('express');
const { register, Gauge, Counter, Histogram, Summary } = require('prom-client');

class PrometheusExporter {
  constructor(metricsCollector, queueManager, rateLimiter, healthMonitor) {
    this.metricsCollector = metricsCollector;
    this.queueManager = queueManager;
    this.rateLimiter = rateLimiter;
    this.healthMonitor = healthMonitor;
    
    this.setupMetrics();
    this.app = express();
    this.setupRoutes();
  }

  setupMetrics() {
    // カスタムメトリクスのクリア（既存のデフォルトメトリクスは保持）
    register.clear();
    
    // デフォルトメトリクス（プロセスとNode.js関連）
    const collectDefaultMetrics = require('prom-client').collectDefaultMetrics;
    collectDefaultMetrics({ prefix: 'ccsp_' });

    // キューメトリクス
    this.queueSize = new Gauge({
      name: 'ccsp_queue_size',
      help: 'Current number of tasks in the queue',
      labelNames: ['priority']
    });

    this.queueCapacity = new Gauge({
      name: 'ccsp_queue_capacity',
      help: 'Maximum capacity of the queue'
    });

    this.tasksProcessed = new Counter({
      name: 'ccsp_tasks_processed_total',
      help: 'Total number of tasks processed',
      labelNames: ['status', 'complexity']
    });

    this.taskDuration = new Histogram({
      name: 'ccsp_task_duration_seconds',
      help: 'Task execution duration in seconds',
      labelNames: ['complexity'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]
    });

    // レート制限メトリクス
    this.rateLimitRemaining = new Gauge({
      name: 'ccsp_rate_limit_remaining',
      help: 'Remaining rate limit capacity'
    });

    this.rateLimitTotal = new Gauge({
      name: 'ccsp_rate_limit_total',
      help: 'Total rate limit capacity'
    });

    this.rateLimitResets = new Counter({
      name: 'ccsp_rate_limit_resets_total',
      help: 'Number of rate limit resets'
    });

    // セッションメトリクス
    this.sessionStatus = new Gauge({
      name: 'ccsp_session_status',
      help: 'Claude session status (1=active, 0=inactive)'
    });

    this.sessionTimeouts = new Counter({
      name: 'ccsp_session_timeouts_total',
      help: 'Total number of session timeouts'
    });

    // ヘルスメトリクス
    this.healthScore = new Gauge({
      name: 'ccsp_health_score',
      help: 'Overall health score (0-100)',
      labelNames: ['component']
    });

    this.componentStatus = new Gauge({
      name: 'ccsp_component_status',
      help: 'Component status (1=healthy, 0=unhealthy)',
      labelNames: ['component']
    });

    // エラーメトリクス
    this.errors = new Counter({
      name: 'ccsp_errors_total',
      help: 'Total number of errors',
      labelNames: ['type', 'severity']
    });

    // API呼び出しメトリクス
    this.apiCalls = new Counter({
      name: 'ccsp_api_calls_total',
      help: 'Total number of API calls',
      labelNames: ['endpoint', 'method', 'status']
    });

    this.apiDuration = new Summary({
      name: 'ccsp_api_duration_seconds',
      help: 'API call duration in seconds',
      labelNames: ['endpoint', 'method'],
      percentiles: [0.5, 0.9, 0.95, 0.99]
    });

    // ワーカーメトリクス
    this.activeWorkers = new Gauge({
      name: 'ccsp_active_workers',
      help: 'Number of active workers'
    });

    this.workerUtilization = new Gauge({
      name: 'ccsp_worker_utilization_ratio',
      help: 'Worker utilization ratio (0-1)'
    });
  }

  async updateMetrics() {
    try {
      // キューメトリクスの更新
      const queueStats = await this.queueManager.getStats();
      this.queueSize.set({ priority: 'high' }, queueStats.high || 0);
      this.queueSize.set({ priority: 'normal' }, queueStats.normal || 0);
      this.queueSize.set({ priority: 'low' }, queueStats.low || 0);
      this.queueCapacity.set(queueStats.capacity || 100);

      // レート制限メトリクスの更新
      const rateLimitStatus = this.rateLimiter.getStatus();
      this.rateLimitRemaining.set(rateLimitStatus.remaining);
      this.rateLimitTotal.set(rateLimitStatus.limit);

      // セッションメトリクスの更新
      const sessionActive = this.healthMonitor.isSessionHealthy();
      this.sessionStatus.set(sessionActive ? 1 : 0);

      // ヘルスメトリクスの更新
      const health = this.healthMonitor.getHealth();
      this.healthScore.set({ component: 'overall' }, health.score || 0);
      
      for (const [component, status] of Object.entries(health.components || {})) {
        this.componentStatus.set({ component }, status.healthy ? 1 : 0);
        if (status.score !== undefined) {
          this.healthScore.set({ component }, status.score);
        }
      }

      // ワーカーメトリクスの更新
      const workerStats = this.metricsCollector.getWorkerStats();
      this.activeWorkers.set(workerStats.active || 0);
      this.workerUtilization.set(workerStats.utilization || 0);

    } catch (error) {
      console.error('Error updating metrics:', error);
      this.errors.inc({ type: 'metrics_update', severity: 'error' });
    }
  }

  // タスク処理完了時に呼ばれる
  recordTaskCompletion(complexity, duration, status) {
    this.tasksProcessed.inc({ status, complexity });
    this.taskDuration.observe({ complexity }, duration);
  }

  // エラー記録
  recordError(type, severity = 'error') {
    this.errors.inc({ type, severity });
  }

  // API呼び出し記録
  recordApiCall(endpoint, method, status, duration) {
    this.apiCalls.inc({ endpoint, method, status });
    this.apiDuration.observe({ endpoint, method }, duration);
  }

  // セッションタイムアウト記録
  recordSessionTimeout() {
    this.sessionTimeouts.inc();
  }

  // レート制限リセット記録
  recordRateLimitReset() {
    this.rateLimitResets.inc();
  }

  setupRoutes() {
    // メトリクスエンドポイント
    this.app.get('/metrics', async (req, res) => {
      try {
        await this.updateMetrics();
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
      } catch (error) {
        console.error('Error serving metrics:', error);
        res.status(500).end();
      }
    });

    // ヘルスチェックエンドポイント（Prometheusのscrapeターゲット確認用）
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok' });
    });
  }

  start(port = 9100) {
    this.server = this.app.listen(port, () => {
      console.log(`Prometheus metrics available at http://localhost:${port}/metrics`);
    });

    // 定期的なメトリクス更新（10秒ごと）
    this.updateInterval = setInterval(() => {
      this.updateMetrics();
    }, 10000);
  }

  stop() {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = PrometheusExporter;