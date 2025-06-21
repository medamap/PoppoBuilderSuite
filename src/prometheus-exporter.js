const promClient = require('prom-client');
const express = require('express');
const os = require('os');

/**
 * PoppoBuilder Prometheus Metrics Exporter
 * 各エージェントのメトリクスをPrometheusに提供
 */
class PrometheusExporter {
  constructor(config = {}, logger = console) {
    this.config = {
      port: config.port || 9090,
      host: config.host || '0.0.0.0',
      path: config.path || '/metrics',
      prefix: config.prefix || 'poppo_',
      collectDefaultMetrics: config.collectDefaultMetrics !== false,
      ...config
    };
    
    this.logger = logger;
    this.registry = new promClient.Registry();
    this.app = express();
    this.server = null;
    
    // メトリクスの初期化
    this.initializeMetrics();
    
    // デフォルトメトリクスの収集を有効化
    if (this.config.collectDefaultMetrics) {
      promClient.collectDefaultMetrics({
        register: this.registry,
        prefix: this.config.prefix
      });
    }
  }

  /**
   * メトリクスの初期化
   */
  initializeMetrics() {
    const prefix = this.config.prefix;

    // Issue処理メトリクス
    this.issueProcessingDuration = new promClient.Histogram({
      name: `${prefix}issue_processing_duration_seconds`,
      help: 'Time spent processing issues',
      labelNames: ['agent', 'issue_type', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]
    });

    this.issuesProcessedTotal = new promClient.Counter({
      name: `${prefix}issues_processed_total`,
      help: 'Total number of issues processed',
      labelNames: ['agent', 'issue_type', 'status']
    });

    this.issueProcessingErrors = new promClient.Counter({
      name: `${prefix}issue_processing_errors_total`,
      help: 'Total number of issue processing errors',
      labelNames: ['agent', 'error_type']
    });

    // エージェント稼働状況
    this.agentStatus = new promClient.Gauge({
      name: `${prefix}agent_status`,
      help: 'Agent status (1=running, 0=stopped)',
      labelNames: ['agent', 'version']
    });

    this.agentUptime = new promClient.Gauge({
      name: `${prefix}agent_uptime_seconds`,
      help: 'Agent uptime in seconds',
      labelNames: ['agent']
    });

    this.agentMemoryUsage = new promClient.Gauge({
      name: `${prefix}agent_memory_usage_bytes`,
      help: 'Agent memory usage in bytes',
      labelNames: ['agent', 'type']
    });

    this.agentCpuUsage = new promClient.Gauge({
      name: `${prefix}agent_cpu_usage_percent`,
      help: 'Agent CPU usage percentage',
      labelNames: ['agent']
    });

    // キューメトリクス
    this.queueSize = new promClient.Gauge({
      name: `${prefix}queue_size`,
      help: 'Current queue size',
      labelNames: ['queue_name', 'priority']
    });

    this.queueWaitTime = new promClient.Histogram({
      name: `${prefix}queue_wait_time_seconds`,
      help: 'Time tasks spend waiting in queue',
      labelNames: ['queue_name', 'priority'],
      buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600]
    });

    this.queueProcessingRate = new promClient.Gauge({
      name: `${prefix}queue_processing_rate_per_minute`,
      help: 'Queue processing rate per minute',
      labelNames: ['queue_name']
    });

    // Redis/データベースメトリクス
    this.redisConnectionStatus = new promClient.Gauge({
      name: `${prefix}redis_connection_status`,
      help: 'Redis connection status (1=connected, 0=disconnected)'
    });

    this.redisOperationDuration = new promClient.Histogram({
      name: `${prefix}redis_operation_duration_seconds`,
      help: 'Redis operation duration',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2]
    });

    this.databaseOperations = new promClient.Counter({
      name: `${prefix}database_operations_total`,
      help: 'Total database operations',
      labelNames: ['operation', 'status']
    });

    // システムリソースメトリクス
    this.systemLoadAverage = new promClient.Gauge({
      name: `${prefix}system_load_average`,
      help: 'System load average',
      labelNames: ['period']
    });

    this.systemMemoryUsage = new promClient.Gauge({
      name: `${prefix}system_memory_usage_bytes`,
      help: 'System memory usage',
      labelNames: ['type']
    });

    this.diskUsage = new promClient.Gauge({
      name: `${prefix}disk_usage_bytes`,
      help: 'Disk usage in bytes',
      labelNames: ['path', 'type']
    });

    // GitHub API関連メトリクス
    this.githubApiRequests = new promClient.Counter({
      name: `${prefix}github_api_requests_total`,
      help: 'Total GitHub API requests',
      labelNames: ['endpoint', 'status_code']
    });

    this.githubApiRateLimit = new promClient.Gauge({
      name: `${prefix}github_api_rate_limit_remaining`,
      help: 'GitHub API rate limit remaining'
    });

    this.githubApiResponseTime = new promClient.Histogram({
      name: `${prefix}github_api_response_time_seconds`,
      help: 'GitHub API response time',
      labelNames: ['endpoint'],
      buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
    });

    // Claude API関連メトリクス
    this.claudeApiRequests = new promClient.Counter({
      name: `${prefix}claude_api_requests_total`,
      help: 'Total Claude API requests',
      labelNames: ['model', 'status']
    });

    this.claudeApiTokensUsed = new promClient.Counter({
      name: `${prefix}claude_api_tokens_used_total`,
      help: 'Total Claude API tokens used',
      labelNames: ['model', 'type']
    });

    this.claudeSessionStatus = new promClient.Gauge({
      name: `${prefix}claude_session_status`,
      help: 'Claude session status (1=active, 0=timeout)'
    });

    // エラー率とレート制限
    this.errorRate = new promClient.Gauge({
      name: `${prefix}error_rate_percent`,
      help: 'Current error rate percentage',
      labelNames: ['component']
    });

    this.rateLimitHits = new promClient.Counter({
      name: `${prefix}rate_limit_hits_total`,
      help: 'Total rate limit hits',
      labelNames: ['service']
    });

    // ヘルススコア
    this.healthScore = new promClient.Gauge({
      name: `${prefix}health_score`,
      help: 'Overall system health score (0-100)',
      labelNames: ['component']
    });

    // すべてのメトリクスをレジストリに登録
    this.registry.registerMetric(this.issueProcessingDuration);
    this.registry.registerMetric(this.issuesProcessedTotal);
    this.registry.registerMetric(this.issueProcessingErrors);
    this.registry.registerMetric(this.agentStatus);
    this.registry.registerMetric(this.agentUptime);
    this.registry.registerMetric(this.agentMemoryUsage);
    this.registry.registerMetric(this.agentCpuUsage);
    this.registry.registerMetric(this.queueSize);
    this.registry.registerMetric(this.queueWaitTime);
    this.registry.registerMetric(this.queueProcessingRate);
    this.registry.registerMetric(this.redisConnectionStatus);
    this.registry.registerMetric(this.redisOperationDuration);
    this.registry.registerMetric(this.databaseOperations);
    this.registry.registerMetric(this.systemLoadAverage);
    this.registry.registerMetric(this.systemMemoryUsage);
    this.registry.registerMetric(this.diskUsage);
    this.registry.registerMetric(this.githubApiRequests);
    this.registry.registerMetric(this.githubApiRateLimit);
    this.registry.registerMetric(this.githubApiResponseTime);
    this.registry.registerMetric(this.claudeApiRequests);
    this.registry.registerMetric(this.claudeApiTokensUsed);
    this.registry.registerMetric(this.claudeSessionStatus);
    this.registry.registerMetric(this.errorRate);
    this.registry.registerMetric(this.rateLimitHits);
    this.registry.registerMetric(this.healthScore);
  }

  /**
   * Expressサーバーのセットアップ
   */
  setupServer() {
    // メトリクスエンドポイント
    this.app.get(this.config.path, async (req, res) => {
      try {
        res.set('Content-Type', this.registry.contentType);
        const metrics = await this.registry.metrics();
        res.end(metrics);
      } catch (error) {
        this.logger.error('Error collecting metrics:', error);
        res.status(500).end('Error collecting metrics');
      }
    });

    // ヘルスチェックエンドポイント
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: require('../package.json').version
      });
    });

    // メトリクス情報エンドポイント
    this.app.get('/info', (req, res) => {
      const metricNames = this.registry.getMetricsAsArray().map(metric => ({
        name: metric.name,
        help: metric.help,
        type: metric.type
      }));
      
      res.json({
        metrics: metricNames,
        config: {
          prefix: this.config.prefix,
          path: this.config.path,
          port: this.config.port
        }
      });
    });
  }

  /**
   * システムメトリクスの更新
   */
  updateSystemMetrics() {
    try {
      // ロードアベレージ
      const loadAvg = os.loadavg();
      this.systemLoadAverage.set({ period: '1m' }, loadAvg[0]);
      this.systemLoadAverage.set({ period: '5m' }, loadAvg[1]);
      this.systemLoadAverage.set({ period: '15m' }, loadAvg[2]);

      // メモリ使用量
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      
      this.systemMemoryUsage.set({ type: 'total' }, totalMem);
      this.systemMemoryUsage.set({ type: 'free' }, freeMem);
      this.systemMemoryUsage.set({ type: 'used' }, usedMem);
      this.systemMemoryUsage.set({ type: 'used_percent' }, (usedMem / totalMem) * 100);

      // プロセスメモリ
      const processMemory = process.memoryUsage();
      this.agentMemoryUsage.set({ agent: 'prometheus-exporter', type: 'rss' }, processMemory.rss);
      this.agentMemoryUsage.set({ agent: 'prometheus-exporter', type: 'heapUsed' }, processMemory.heapUsed);
      this.agentMemoryUsage.set({ agent: 'prometheus-exporter', type: 'heapTotal' }, processMemory.heapTotal);
      this.agentMemoryUsage.set({ agent: 'prometheus-exporter', type: 'external' }, processMemory.external);

    } catch (error) {
      this.logger.error('Error updating system metrics:', error);
    }
  }

  /**
   * エージェントメトリクスの更新
   */
  updateAgentMetrics(agentName, metrics) {
    try {
      if (metrics.status !== undefined) {
        this.agentStatus.set({ agent: agentName, version: metrics.version || 'unknown' }, metrics.status);
      }
      
      if (metrics.uptime !== undefined) {
        this.agentUptime.set({ agent: agentName }, metrics.uptime);
      }
      
      if (metrics.memory) {
        Object.entries(metrics.memory).forEach(([type, value]) => {
          this.agentMemoryUsage.set({ agent: agentName, type }, value);
        });
      }
      
      if (metrics.cpu !== undefined) {
        this.agentCpuUsage.set({ agent: agentName }, metrics.cpu);
      }
      
      if (metrics.healthScore !== undefined) {
        this.healthScore.set({ component: agentName }, metrics.healthScore);
      }
      
    } catch (error) {
      this.logger.error(`Error updating agent metrics for ${agentName}:`, error);
    }
  }

  /**
   * Issue処理メトリクスの記録
   */
  recordIssueProcessing(agentName, issueType, status, duration) {
    this.issueProcessingDuration.observe({ agent: agentName, issue_type: issueType, status }, duration);
    this.issuesProcessedTotal.inc({ agent: agentName, issue_type: issueType, status });
  }

  /**
   * エラーメトリクスの記録
   */
  recordError(agentName, errorType) {
    this.issueProcessingErrors.inc({ agent: agentName, error_type: errorType });
  }

  /**
   * GitHub APIメトリクスの記録
   */
  recordGitHubApiCall(endpoint, statusCode, responseTime, rateLimit) {
    this.githubApiRequests.inc({ endpoint, status_code: statusCode });
    this.githubApiResponseTime.observe({ endpoint }, responseTime);
    
    if (rateLimit !== undefined) {
      this.githubApiRateLimit.set(rateLimit);
    }
  }

  /**
   * Claude APIメトリクスの記録
   */
  recordClaudeApiCall(model, status, tokensUsed = {}) {
    this.claudeApiRequests.inc({ model, status });
    
    if (tokensUsed.input) {
      this.claudeApiTokensUsed.inc({ model, type: 'input' }, tokensUsed.input);
    }
    if (tokensUsed.output) {
      this.claudeApiTokensUsed.inc({ model, type: 'output' }, tokensUsed.output);
    }
  }

  /**
   * キューメトリクスの更新
   */
  updateQueueMetrics(queueName, size, priority = 'normal', processingRate = 0) {
    this.queueSize.set({ queue_name: queueName, priority }, size);
    this.queueProcessingRate.set({ queue_name: queueName }, processingRate);
  }

  /**
   * サーバーを起動
   */
  start() {
    return new Promise((resolve, reject) => {
      this.setupServer();
      
      this.server = this.app.listen(this.config.port, this.config.host, (error) => {
        if (error) {
          reject(error);
          return;
        }
        
        const url = `http://${this.config.host}:${this.config.port}`;
        this.logger.info(`Prometheus metrics server started on ${url}${this.config.path}`);
        
        // 定期的なメトリクス更新を開始
        this.metricsInterval = setInterval(() => {
          this.updateSystemMetrics();
        }, 15000); // 15秒間隔
        
        resolve(url);
      });
    });
  }

  /**
   * サーバーを停止
   */
  stop() {
    return new Promise((resolve) => {
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
      }
      
      if (this.server) {
        this.server.close(() => {
          this.logger.info('Prometheus metrics server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * すべてのメトリクスをクリア
   */
  clearMetrics() {
    this.registry.clear();
  }

  /**
   * カスタムメトリクスの追加
   */
  addCustomMetric(metric) {
    this.registry.registerMetric(metric);
  }

  /**
   * メトリクスの取得
   */
  async getMetrics() {
    return await this.registry.metrics();
  }
}

module.exports = PrometheusExporter;