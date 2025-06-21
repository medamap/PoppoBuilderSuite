/**
 * CCSPエージェント（パイちゃん） - Claude Code呼び出し専任エージェント
 * 
 * PoppoBuilderファミリー全体のClaude Code呼び出しを一元管理
 */

const Redis = require('ioredis');
const ClaudeExecutor = require('./claude-executor');
const QueueManager = require('./queue-manager');
const AdvancedQueueManager = require('./advanced-queue-manager');
const UsageMonitor = require('./usage-monitor');
const RateLimiter = require('./rate-limiter');
const MetricsCollector = require('./metrics-collector');
const HealthMonitor = require('./health-monitor');
const InstanceCoordinator = require('./instance-coordinator');
const SessionMonitor = require('./session-monitor');
const NotificationHandler = require('./notification-handler');
const EmergencyStop = require('./emergency-stop');
const PrometheusExporter = require('./prometheus-exporter');
const winston = require('winston');
const path = require('path');
const fs = require('fs');

// ロガー設定
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winston.transports.File({ 
      filename: path.join(__dirname, '../../logs/ccsp.log')
    })
  ]
});

class CCSPAgent {
  constructor(config = {}) {
    this.config = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      },
      maxConcurrent: 2,
      requestQueue: 'ccsp:requests',
      ...config
    };
    
    this.logger = logger;
    this.redis = new Redis(this.config.redis);
    this.claudeExecutor = new ClaudeExecutor(logger);
    this.queueManager = new QueueManager(this.redis, logger);
    this.advancedQueueManager = new AdvancedQueueManager({
      maxQueueSize: this.config.maxQueueSize || 10000,
      schedulerInterval: this.config.schedulerInterval || 5000
    });
    this.usageMonitor = new UsageMonitor({
      windowSize: this.config.windowSize || 3600000,
      alertThreshold: this.config.alertThreshold || 0.8
    });
    this.rateLimiter = new RateLimiter(logger);
    this.metricsCollector = new MetricsCollector(logger);
    this.healthMonitor = new HealthMonitor(this.redis, logger);
    this.instanceCoordinator = new InstanceCoordinator(this.redis, logger);
    this.sessionMonitor = new SessionMonitor(this.redis, logger);
    this.notificationHandler = new NotificationHandler(this.redis, logger);
    this.emergencyStop = new EmergencyStop(logger, this.notificationHandler);
    
    this.isRunning = false;
    this.activeRequests = new Map();
    
    // Prometheusエクスポーター
    this.prometheusExporter = new PrometheusExporter(
      this.metricsCollector,
      this.queueManager,
      this.rateLimiter,
      this.healthMonitor
    );
    
    // エラーハンドラーの設定
    this.setupErrorHandlers();
  }
  
  setupErrorHandlers() {
    // Redisエラーハンドラー
    this.redis.on('error', (error) => {
      this.logger.error('Redis connection error:', error);
      // 再接続は ioredis が自動的に行う
    });
    
    this.redis.on('close', () => {
      this.logger.warn('Redis connection closed');
    });
    
    this.redis.on('reconnecting', () => {
      this.logger.info('Redis reconnecting...');
    });
    
    // プロセスエラーハンドラー
    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception:', error);
      await this.emergencyShutdown();
    });
    
    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      // 継続可能なのでシャットダウンはしない
    });
  }
  
  async emergencyShutdown() {
    this.logger.error('Emergency shutdown initiated');
    
    // アクティブなリクエストにエラーレスポンスを送信
    for (const [requestId, request] of this.activeRequests) {
      try {
        await this.queueManager.sendResponse(request.fromAgent, {
          requestId,
          success: false,
          error: 'Agent emergency shutdown',
          timestamp: new Date().toISOString()
        });
      } catch (e) {
        // エラーは無視
      }
    }
    
    await this.stop();
    process.exit(1);
  }
  
  async start() {
    this.logger.info('CCSPエージェント（パイちゃん）を起動しています...');
    
    // Redisの接続確認
    try {
      await this.redis.ping();
      this.logger.info('Redis接続成功');
    } catch (error) {
      this.logger.error('Redis接続失敗:', error);
      throw error;
    }
    
    // 緊急停止状態をリセット（再起動時）
    this.emergencyStop.reset();
    this.logger.info('緊急停止状態をリセットしました');
    
    this.isRunning = true;
    
    // セッション監視を初期化
    await this.sessionMonitor.initialize();
    
    // セッションイベントのリスナー設定
    this.sessionMonitor.on('session-timeout', async (event) => {
      this.logger.error('[CCSP] Session timeout event received');
      // キューのブロックは各ワーカーで処理
    });
    
    this.sessionMonitor.on('session-restored', async (event) => {
      this.logger.info('[CCSP] Session restored event received');
      // キューの再開は各ワーカーで処理
    });
    
    // 通知ハンドラーを開始
    this.notificationHandler.startProcessing();
    
    // ヘルスモニタリングを開始
    this.healthMonitor.start();
    
    // 定期的な負荷情報の更新とクリーンアップ
    this.maintenanceInterval = setInterval(async () => {
      // 負荷情報を更新
      await this.instanceCoordinator.updateLoad(this.activeRequests.size);
      
      // 古い要求をクリーンアップ（1時間ごと）
      if (Date.now() % 3600000 < 30000) {
        await this.instanceCoordinator.cleanupOldClaims();
      }
    }, 30000); // 30秒ごと
    
    // Prometheusメトリクスエクスポーターを開始
    const prometheusPort = process.env.CCSP_PROMETHEUS_PORT || 9100;
    this.prometheusExporter.start(prometheusPort);
    this.logger.info(`Prometheus metrics available at port ${prometheusPort}`);
    
    // メインループを開始
    this.processLoop();
    
    this.logger.info('CCSPエージェント起動完了');
  }
  
  async processLoop() {
    // ワーカープロセスを起動（同時実行数分）
    const workers = [];
    for (let i = 0; i < this.config.maxConcurrent; i++) {
      workers.push(this.worker(i));
    }
    
    // 全ワーカーの完了を待つ
    await Promise.all(workers);
  }
  
  async worker(workerId) {
    this.logger.info(`Worker ${workerId} started`);
    
    while (this.isRunning) {
      try {
        // セッションブロックチェック
        if (this.sessionMonitor.isBlocked()) {
          // セッションがブロックされている場合は待機
          await new Promise(resolve => setTimeout(resolve, 5000));
          continue;
        }
        
        // レート制限チェック
        if (this.rateLimiter.isRateLimited()) {
          const waitTime = this.rateLimiter.getWaitTime();
          this.logger.info(`[Worker ${workerId}] レート制限中。${Math.round(waitTime / 1000)}秒待機`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
          continue;
        }
        
        // ブロッキングモードでリクエストを取得（CPU使用率削減）
        const request = await this.queueManager.getNextRequestBlocking(1);
        if (!request) {
          // タイムアウト（リクエストなし）
          continue;
        }
        
        // 複数インスタンス対応：リクエストを要求
        const claimed = await this.instanceCoordinator.claimRequest(request.requestId);
        if (!claimed) {
          // 他のインスタンスが処理中
          this.logger.debug(`[Worker ${workerId}] Request ${request.requestId} claimed by another instance`);
          continue;
        }
        
        // リクエストを処理
        this.logger.info(`[Worker ${workerId}] Processing request: ${request.requestId}`);
        await this.processRequest(request);
        
      } catch (error) {
        this.logger.error(`[Worker ${workerId}] Error:`, error);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    
    this.logger.info(`Worker ${workerId} stopped`);
  }
  
  async processRequest(request) {
    const { requestId, fromAgent } = request;
    
    this.logger.info(`リクエスト処理開始: ${requestId} from ${fromAgent}`);
    this.activeRequests.set(requestId, request);
    
    // メトリクス記録開始
    this.metricsCollector.recordRequestStart(request);
    const startTime = Date.now();
    
    try {
      // Claude Codeを実行
      const result = request.continueExecution 
        ? await this.claudeExecutor.continueExecution(request)
        : await this.claudeExecutor.execute(request);
      
      // 実行時間を計算
      const executionTime = Date.now() - startTime;
      
      // エラーメッセージをEmergencyStopでチェック
      if (!result.success && result.error) {
        const shouldStop = this.emergencyStop.checkError(result.error);
        if (shouldStop) {
          // 緊急停止が発動されているので、ここで処理を終了
          this.logger.error(`[CCSP] Emergency stop triggered for request ${requestId}`);
          return; // emergencyStop.initiateEmergencyStop()内でプロセスが停止される
        }
      }
      
      // セッションタイムアウトチェック
      if (result.sessionTimeout) {
        this.logger.error(`[CCSP] Session timeout detected for request ${requestId}`);
        
        // EmergencyStopでチェック（セッションタイムアウトも緊急停止対象）
        const errorMessage = result.message || 'SESSION_TIMEOUT';
        const shouldStop = this.emergencyStop.checkError(errorMessage);
        if (shouldStop) {
          return; // 緊急停止
        }
        
        // セッションモニターに通知
        await this.sessionMonitor.handleSessionTimeout(result);
        
        // ブロックされたリクエストとして記録
        this.sessionMonitor.addBlockedRequest(requestId, request);
        
        // エラーレスポンスを送信
        const timeoutResponse = {
          requestId,
          success: false,
          error: 'SESSION_TIMEOUT',
          message: 'Claude login session expired. Please check GitHub Issue for instructions.',
          sessionTimeout: true,
          timestamp: new Date().toISOString()
        };
        
        await this.queueManager.sendResponse(fromAgent, timeoutResponse);
        this.metricsCollector.recordRequestComplete(request, timeoutResponse, executionTime);
        
        // Prometheusメトリクスを記録（セッションタイムアウト）
        this.prometheusExporter.recordSessionTimeout();
        this.prometheusExporter.recordError('session_timeout', 'critical');
        
        return;
      }
      
      // レート制限情報を更新
      if (result.rateLimitInfo) {
        // EmergencyStopでレート制限をチェック
        const rateLimitMessage = `${result.rateLimitInfo.message}|${Math.floor(result.rateLimitInfo.unlockTime / 1000)}`;
        const shouldStop = this.emergencyStop.checkError(rateLimitMessage);
        if (shouldStop) {
          return; // 緊急停止
        }
        
        this.rateLimiter.updateRateLimit(result.rateLimitInfo);
        this.metricsCollector.recordRateLimit(request);
      }
      
      // レスポンスを送信
      const response = {
        requestId,
        success: result.success,
        result: result.result,
        error: result.error,
        executionTime: result.executionTime || executionTime,
        timestamp: new Date().toISOString()
      };
      
      await this.queueManager.sendResponse(fromAgent, response);
      
      // メトリクス記録完了
      this.metricsCollector.recordRequestComplete(request, result, executionTime);
      
      // Prometheusメトリクスを記録
      const complexity = request.priority === 'high' ? 'high' : 
                        request.priority === 'low' ? 'low' : 'normal';
      const status = result.success ? 'success' : 'failed';
      this.prometheusExporter.recordTaskCompletion(complexity, executionTime / 1000, status);
      
      this.logger.info(`リクエスト処理完了: ${requestId}`);
      
    } catch (error) {
      this.logger.error(`リクエスト処理失敗: ${requestId}`, error);
      
      const executionTime = Date.now() - startTime;
      
      // エラーレスポンスを送信
      const errorResponse = {
        requestId,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
      
      await this.queueManager.sendResponse(fromAgent, errorResponse);
      
      // メトリクス記録（エラー）
      this.metricsCollector.recordRequestComplete(request, errorResponse, executionTime);
      
      // Prometheusメトリクスを記録（エラー）
      const complexity = request.priority === 'high' ? 'high' : 
                        request.priority === 'low' ? 'low' : 'normal';
      this.prometheusExporter.recordTaskCompletion(complexity, executionTime / 1000, 'failed');
      this.prometheusExporter.recordError('task_execution', 'error');
      
    } finally {
      this.activeRequests.delete(requestId);
      // リクエストの要求を解放
      await this.instanceCoordinator.releaseRequest(requestId);
    }
  }
  
  async stop() {
    this.logger.info('CCSPエージェントを停止しています...');
    this.isRunning = false;
    
    // アクティブなリクエストの完了を待つ
    const waitStart = Date.now();
    while (this.activeRequests.size > 0 && Date.now() - waitStart < 30000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // タイムアウトしたリクエストの強制終了
    if (this.activeRequests.size > 0) {
      this.logger.warn(`Forcing termination of ${this.activeRequests.size} active requests`);
      for (const [requestId, request] of this.activeRequests) {
        try {
          await this.queueManager.sendResponse(request.fromAgent, {
            requestId,
            success: false,
            error: 'Agent shutdown timeout',
            timestamp: new Date().toISOString()
          });
        } catch (e) {
          // エラーは無視
        }
      }
      this.activeRequests.clear();
    }
    
    // メンテナンスインターバルを停止
    if (this.maintenanceInterval) {
      clearInterval(this.maintenanceInterval);
    }
    
    // セッションモニターと通知ハンドラーを停止
    await this.sessionMonitor.shutdown();
    this.notificationHandler.stopProcessing();
    
    // 各コンポーネントのクリーンアップ
    await this.claudeExecutor.cleanup();
    this.metricsCollector.cleanup();
    await this.healthMonitor.cleanup();
    
    // Prometheusエクスポーターを停止
    this.prometheusExporter.stop();
    
    // Redis接続を閉じる
    await this.redis.quit();
    
    this.logger.info('CCSPエージェント停止完了');
  }
  
  /**
   * ヘルスステータスを取得（APIエンドポイント用）
   */
  async getHealthStatus() {
    return await this.healthMonitor.getHealthSummary(this.metricsCollector);
  }
  
  // ===== Issue #142: 高度な制御機能とモニタリング API =====
  
  /**
   * キュー状態の取得
   */
  async getQueueStatus() {
    return this.advancedQueueManager.getStatus();
  }
  
  /**
   * キューの一時停止
   */
  async pauseQueue() {
    this.advancedQueueManager.pause();
  }
  
  /**
   * キューの再開
   */
  async resumeQueue() {
    this.advancedQueueManager.resume();
  }
  
  /**
   * キューのクリア
   */
  async clearQueue(priority = 'all') {
    this.advancedQueueManager.clearQueue(priority);
  }
  
  /**
   * タスクの削除
   */
  async removeTask(taskId) {
    return await this.advancedQueueManager.removeTask(taskId);
  }
  
  /**
   * タスクの追加
   */
  async enqueueTask(task, priority = 'normal', executeAt = null) {
    return await this.advancedQueueManager.enqueue(task, priority, executeAt);
  }
  
  /**
   * 使用量統計の取得
   */
  async getUsageStats(minutes = 60) {
    const currentStats = this.usageMonitor.getCurrentWindowStats();
    const timeSeriesStats = this.usageMonitor.getTimeSeriesStats(minutes);
    const prediction = this.usageMonitor.predictUsage();
    const rateLimitPrediction = this.usageMonitor.predictRateLimit();
    
    return {
      currentWindow: currentStats,
      timeSeries: timeSeriesStats,
      prediction,
      rateLimitPrediction,
      rateLimitInfo: this.usageMonitor.rateLimitInfo
    };
  }
  
  /**
   * エージェント別統計の取得
   */
  async getAgentStats(agentName = null) {
    return this.usageMonitor.getAgentStats(agentName);
  }
  
  /**
   * エラー統計の取得
   */
  async getErrorStats(hours = 24) {
    // メトリクスコレクターからエラー情報を取得
    return this.metricsCollector.getErrorStats(hours);
  }
  
  /**
   * パフォーマンス統計の取得
   */
  async getPerformanceStats() {
    return {
      queue: this.advancedQueueManager.getStats(),
      usage: this.usageMonitor.getCurrentWindowStats(),
      health: await this.getHealthStatus()
    };
  }
  
  /**
   * 使用量予測の取得
   */
  async getPrediction(minutesAhead = 30) {
    return this.usageMonitor.predictUsage(minutesAhead);
  }
  
  /**
   * スロットリング設定
   */
  async setThrottling(options) {
    // RateLimiterでスロットリングを設定
    return this.rateLimiter.setThrottling(options);
  }
  
  /**
   * エージェント優先度設定
   */
  async setAgentPriority(agent, priority) {
    // 将来的にエージェント別優先度マッピングを実装
    // 現在は基本実装
    this.logger.info(`Agent priority set: ${agent} -> ${priority}`);
    return { agent, priority, timestamp: new Date().toISOString() };
  }
  
  /**
   * 設定の取得
   */
  async getConfig() {
    return {
      ...this.config,
      queueStatus: this.advancedQueueManager.getStatus(),
      rateLimitInfo: this.usageMonitor.rateLimitInfo
    };
  }
  
  /**
   * 設定の更新
   */
  async updateConfig(newConfig) {
    // 安全な設定項目のみ更新
    const safeUpdates = ['maxConcurrent', 'alertThreshold', 'schedulerInterval'];
    const updated = {};
    
    for (const key of safeUpdates) {
      if (newConfig[key] !== undefined) {
        this.config[key] = newConfig[key];
        updated[key] = newConfig[key];
      }
    }
    
    this.logger.info('Config updated', updated);
    return updated;
  }
  
  /**
   * 詳細ヘルスチェック
   */
  async getDetailedHealth() {
    const baseHealth = await this.getHealthStatus();
    const queueStatus = this.advancedQueueManager.getStatus();
    const usageStats = this.usageMonitor.getCurrentWindowStats();
    
    return {
      ...baseHealth,
      queue: queueStatus,
      usage: usageStats,
      components: {
        redis: this.redis.status === 'ready',
        advancedQueue: !queueStatus.isPaused,
        usageMonitor: true,
        rateLimiter: true,
        sessionMonitor: true
      },
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Prometheusメトリクスの取得
   */
  async getPrometheusMetrics() {
    const queueStats = this.advancedQueueManager.getStats();
    const usageStats = this.usageMonitor.getCurrentWindowStats();
    const health = await this.getHealthStatus();
    
    const metrics = [
      `# HELP ccsp_queue_size Current queue size by priority`,
      `# TYPE ccsp_queue_size gauge`,
      `ccsp_queue_size{priority="urgent"} ${queueStats.currentQueueSizes?.urgent || 0}`,
      `ccsp_queue_size{priority="high"} ${queueStats.currentQueueSizes?.high || 0}`,
      `ccsp_queue_size{priority="normal"} ${queueStats.currentQueueSizes?.normal || 0}`,
      `ccsp_queue_size{priority="low"} ${queueStats.currentQueueSizes?.low || 0}`,
      `ccsp_queue_size{priority="scheduled"} ${queueStats.currentQueueSizes?.scheduled || 0}`,
      
      `# HELP ccsp_requests_total Total processed requests`,
      `# TYPE ccsp_requests_total counter`,
      `ccsp_requests_total ${queueStats.totalProcessed || 0}`,
      
      `# HELP ccsp_requests_per_minute Current requests per minute`,
      `# TYPE ccsp_requests_per_minute gauge`,
      `ccsp_requests_per_minute ${usageStats.requestsPerMinute || 0}`,
      
      `# HELP ccsp_success_rate Current success rate`,
      `# TYPE ccsp_success_rate gauge`,
      `ccsp_success_rate ${usageStats.successRate || 0}`,
      
      `# HELP ccsp_average_response_time Average response time in milliseconds`,
      `# TYPE ccsp_average_response_time gauge`,
      `ccsp_average_response_time ${usageStats.averageResponseTime || 0}`,
      
      `# HELP ccsp_health_status Overall health status (1=healthy, 0=unhealthy)`,
      `# TYPE ccsp_health_status gauge`,
      `ccsp_health_status ${health.status === 'healthy' ? 1 : 0}`
    ];
    
    return metrics.join('\n');
  }
}

// エントリーポイント
if (require.main === module) {
  const agent = new CCSPAgent();
  
  // シグナルハンドラー
  process.on('SIGINT', async () => {
    await agent.stop();
    process.exit(0);
  });
  
  process.on('SIGTERM', async () => {
    await agent.stop();
    process.exit(0);
  });
  
  // 起動
  agent.start().catch(error => {
    logger.error('起動エラー:', error);
    process.exit(1);
  });
}

module.exports = CCSPAgent;