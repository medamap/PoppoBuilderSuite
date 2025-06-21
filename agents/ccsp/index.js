/**
 * CCSP (Claude Code Specialized Processor) Agent - Phase 4 Complete Implementation
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * 完全なClaude API使用管理とモニタリング機能を提供
 */

const EventEmitter = require('events');
const Logger = require('../../src/logger');
const AdvancedQueueManager = require('./advanced-queue-manager');
const UsageMonitor = require('./usage-monitor');
const CCSPManagementAPI = require('./management-api');
const EmergencyStop = require('./emergency-stop');
const PrometheusExporter = require('./prometheus-exporter');
const ClaudeExecutor = require('./claude-executor');
const NotificationHandler = require('./notification-handler');
const Redis = require('redis');
const crypto = require('crypto');

class CCSPAgent extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('CCSPAgent');
    this.config = {
      port: options.port || 3003,
      redisHost: options.redisHost || 'localhost',
      redisPort: options.redisPort || 6379,
      maxConcurrentRequests: options.maxConcurrentRequests || 5,
      throttleDelay: options.throttleDelay || 1000,
      enableMetrics: options.enableMetrics !== false,
      enableDashboard: options.enableDashboard !== false,
      autoOptimization: options.autoOptimization !== false,
      ...options
    };
    
    // 内部状態
    this.isRunning = false;
    this.activeRequests = new Map();
    this.throttleConfig = {
      enabled: false,
      delay: this.config.throttleDelay,
      mode: 'fixed' // 'fixed', 'adaptive', 'exponential'
    };
    
    this.agentPriorities = new Map();
    this.sessionState = {
      isValid: true,
      lastCheck: Date.now(),
      timeoutWarnings: 0
    };
    
    // コアコンポーネントの初期化
    this.initializeComponents();
    
    this.logger.info('CCSP Agent Phase 4 initialized', {
      version: '4.0.0',
      maxConcurrent: this.config.maxConcurrentRequests,
      enableMetrics: this.config.enableMetrics,
      enableDashboard: this.config.enableDashboard
    });
  }
  
  /**
   * コンポーネントの初期化
   */
  async initializeComponents() {
    try {
      // Redis接続
      this.redis = Redis.createClient({
        host: this.config.redisHost,
        port: this.config.redisPort,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 3
      });
      
      await this.redis.connect();
      this.logger.info('Redis connection established');
      
      // キューマネージャー
      this.queueManager = new AdvancedQueueManager({
        maxQueueSize: this.config.maxQueueSize || 10000,
        schedulerInterval: 5000
      });
      
      // 使用量モニター
      this.usageMonitor = new UsageMonitor({
        windowSize: 3600000, // 1時間
        alertThreshold: 0.8,
        predictionWindow: 1800000 // 30分
      });
      
      // Claude実行エンジン
      this.claudeExecutor = new ClaudeExecutor({
        maxRetries: 3,
        retryDelay: 5000
      });
      
      // 通知ハンドラー
      this.notificationHandler = new NotificationHandler({
        enableGitHub: true,
        enableSlack: false
      });
      
      // 緊急停止機能
      this.emergencyStop = new EmergencyStop(
        this.logger,
        this.notificationHandler
      );
      
      // Prometheusメトリクス（オプション）
      if (this.config.enableMetrics) {
        this.prometheusExporter = new PrometheusExporter();
      }
      
      // 管理API
      if (this.config.enableDashboard) {
        this.managementAPI = new CCSPManagementAPI(this, {
          rateLimit: 100
        });
      }
      
      // イベントリスナーの設定
      this.setupEventListeners();
      
      this.logger.info('All CCSP components initialized successfully');
      
    } catch (error) {
      this.logger.error('Failed to initialize CCSP components', error);
      throw error;
    }
  }
  
  /**
   * イベントリスナーの設定
   */
  setupEventListeners() {
    // キューイベント
    this.queueManager.on('taskEnqueued', (task) => {
      this.emit('queueUpdated', this.queueManager.getStatus());
      if (this.prometheusExporter) {
        this.prometheusExporter.incrementQueueSize(task.priority);
      }
    });
    
    this.queueManager.on('taskDequeued', (task) => {
      this.emit('queueUpdated', this.queueManager.getStatus());
      if (this.prometheusExporter) {
        this.prometheusExporter.decrementQueueSize(task.priority);
      }
    });
    
    // 使用量監視イベント
    this.usageMonitor.on('usageAlert', (alert) => {
      this.handleUsageAlert(alert);
    });
    
    this.usageMonitor.on('usageRecorded', (usage) => {
      this.emit('usageUpdated', usage);
      if (this.prometheusExporter) {
        this.prometheusExporter.recordAPIUsage(usage);
      }
    });
    
    // 緊急停止イベント
    this.on('emergencyStop', (reason) => {
      this.logger.error('Emergency stop triggered', { reason });
      this.emergencyStop.initiateEmergencyStop(reason);
    });
  }
  
  /**
   * CCSPエージェントの開始
   */
  async start() {
    if (this.isRunning) {
      this.logger.warn('CCSP Agent is already running');
      return;
    }
    
    try {
      this.isRunning = true;
      
      // リクエスト処理ループの開始
      this.startRequestProcessing();
      
      // 自動最適化機能（オプション）
      if (this.config.autoOptimization) {
        this.startAutoOptimization();
      }
      
      // セッション監視
      this.startSessionMonitoring();
      
      this.logger.info('CCSP Agent started successfully', {
        port: this.config.port,
        maxConcurrent: this.config.maxConcurrentRequests
      });
      
      this.emit('agentStarted');
      
    } catch (error) {
      this.logger.error('Failed to start CCSP Agent', error);
      this.isRunning = false;
      throw error;
    }
  }
  
  /**
   * リクエスト処理ループ
   */
  async startRequestProcessing() {
    this.processingInterval = setInterval(async () => {
      if (!this.isRunning || this.emergencyStop.stopped) {
        return;
      }
      
      try {
        // 同時実行数をチェック
        if (this.activeRequests.size >= this.config.maxConcurrentRequests) {
          return;
        }
        
        // スロットリングチェック
        if (this.throttleConfig.enabled) {
          const shouldThrottle = await this.checkThrottling();
          if (shouldThrottle) {
            return;
          }
        }
        
        // 次のタスクを取得
        const task = await this.queueManager.dequeue();
        if (!task) {
          return;
        }
        
        // タスクを実行
        this.executeTask(task);
        
      } catch (error) {
        this.logger.error('Error in request processing loop', error);
      }
    }, 1000); // 1秒間隔
  }
  
  /**
   * タスクの実行
   */
  async executeTask(task) {
    const requestId = task.id;
    const startTime = Date.now();
    
    this.activeRequests.set(requestId, {
      task,
      startTime,
      agent: task.agent || 'unknown'
    });
    
    try {
      this.logger.info('Executing Claude request', {
        requestId,
        agent: task.agent,
        priority: task.priority
      });
      
      // Claude APIを実行
      const result = await this.claudeExecutor.execute(task);
      
      const responseTime = Date.now() - startTime;
      
      // 使用量を記録
      this.usageMonitor.recordUsage({
        agent: task.agent,
        requestId,
        success: true,
        responseTime,
        rateLimited: false
      });
      
      // 結果をRedisに返送
      await this.sendResponse(task.agent, requestId, {
        success: true,
        result,
        responseTime
      });
      
      this.logger.info('Claude request completed', {
        requestId,
        responseTime: `${responseTime}ms`
      });
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      // エラーパターンの検査
      const isEmergencyError = this.emergencyStop.checkError(error.message);
      
      if (isEmergencyError) {
        this.logger.error('Emergency error detected, stopping CCSP', {
          requestId,
          error: error.message
        });
        return; // 緊急停止により処理終了
      }
      
      // 使用量を記録（エラー）
      this.usageMonitor.recordUsage({
        agent: task.agent,
        requestId,
        success: false,
        responseTime,
        rateLimited: error.message.includes('rate limit'),
        error: error.message
      });
      
      // エラー結果を返送
      await this.sendResponse(task.agent, requestId, {
        success: false,
        error: error.message,
        responseTime
      });
      
      this.logger.error('Claude request failed', {
        requestId,
        error: error.message,
        responseTime: `${responseTime}ms`
      });
      
    } finally {
      this.activeRequests.delete(requestId);
    }
  }
  
  /**
   * レスポンスの送信
   */
  async sendResponse(agent, requestId, response) {
    try {
      const responseKey = `ccsp:response:${agent}`;
      await this.redis.lpush(responseKey, JSON.stringify({
        requestId,
        ...response,
        timestamp: new Date().toISOString()
      }));
      
      // TTLを設定（1時間）
      await this.redis.expire(responseKey, 3600);
      
    } catch (error) {
      this.logger.error('Failed to send response', {
        agent,
        requestId,
        error: error.message
      });
    }
  }
  
  /**
   * 新しいタスクをキューに追加
   */
  async enqueueTask(task, priority = 'normal', executeAt = null) {
    try {
      const taskId = await this.queueManager.enqueue(task, priority, executeAt);
      
      this.logger.info('Task enqueued successfully', {
        taskId,
        priority,
        agent: task.agent,
        executeAt
      });
      
      return taskId;
      
    } catch (error) {
      this.logger.error('Failed to enqueue task', error);
      throw error;
    }
  }
  
  /**
   * 使用量アラートの処理
   */
  async handleUsageAlert(alert) {
    this.logger.warn('Usage alert received', alert);
    
    switch (alert.type) {
      case 'usage_threshold':
        if (alert.data.usageRatio >= 0.9) {
          // 90%以上で自動スロットリング
          await this.setThrottling({
            enabled: true,
            delay: 5000,
            mode: 'adaptive'
          });
        }
        break;
        
      case 'rate_limit':
        // レート制限時は緊急スロットリング
        await this.setThrottling({
          enabled: true,
          delay: 60000, // 1分
          mode: 'exponential'
        });
        break;
    }
    
    this.emit('alert', alert);
  }
  
  /**
   * スロットリング設定
   */
  async setThrottling(config) {
    this.throttleConfig = {
      ...this.throttleConfig,
      ...config,
      lastThrottleTime: Date.now()
    };
    
    this.logger.info('Throttling configured', this.throttleConfig);
    return this.throttleConfig;
  }
  
  /**
   * スロットリングチェック
   */
  async checkThrottling() {
    if (!this.throttleConfig.enabled) {
      return false;
    }
    
    const now = Date.now();
    const timeSinceLastThrottle = now - (this.throttleConfig.lastThrottleTime || 0);
    
    let delay = this.throttleConfig.delay;
    
    switch (this.throttleConfig.mode) {
      case 'adaptive':
        // 使用率に基づいて遅延を調整
        const usage = this.usageMonitor.getCurrentWindowStats();
        const usageRate = usage.requestsPerMinute / 60; // requests/second
        delay = Math.max(1000, Math.min(10000, 1000 / Math.max(0.1, 10 - usageRate)));
        break;
        
      case 'exponential':
        // 指数的バックオフ
        const attempts = this.throttleConfig.attempts || 1;
        delay = Math.min(300000, this.throttleConfig.delay * Math.pow(2, attempts - 1));
        break;
    }
    
    return timeSinceLastThrottle < delay;
  }
  
  /**
   * エージェント優先度の設定
   */
  async setAgentPriority(agent, priority) {
    this.agentPriorities.set(agent, priority);
    this.logger.info('Agent priority set', { agent, priority });
  }
  
  /**
   * セッション監視の開始
   */
  startSessionMonitoring() {
    this.sessionMonitorInterval = setInterval(async () => {
      try {
        const isValid = await this.checkSessionValidity();
        if (!isValid) {
          this.sessionState.timeoutWarnings++;
          
          if (this.sessionState.timeoutWarnings >= 3) {
            this.emit('emergencyStop', 'Session timeout detected');
          }
        } else {
          this.sessionState.timeoutWarnings = 0;
        }
      } catch (error) {
        this.logger.error('Session monitoring error', error);
      }
    }, 300000); // 5分間隔
  }
  
  /**
   * セッション有効性チェック
   */
  async checkSessionValidity() {
    try {
      // 簡単なClaude CLI コマンドを実行してセッションを確認
      const result = await this.claudeExecutor.execute({
        prompt: 'Hi',
        timeout: 30000
      });
      
      this.sessionState.isValid = !result.error;
      this.sessionState.lastCheck = Date.now();
      
      return this.sessionState.isValid;
      
    } catch (error) {
      this.sessionState.isValid = false;
      return false;
    }
  }
  
  /**
   * 自動最適化の開始
   */
  startAutoOptimization() {
    this.optimizationInterval = setInterval(() => {
      this.performAutoOptimization();
    }, 300000); // 5分間隔
  }
  
  /**
   * 自動最適化の実行
   */
  async performAutoOptimization() {
    try {
      const usage = this.usageMonitor.getCurrentWindowStats();
      const prediction = this.usageMonitor.predictUsage(30);
      
      // キューサイズに基づく最適化
      const queueStatus = this.queueManager.getStatus();
      if (queueStatus.totalQueueSize > 100) {
        // 大きなキューサイズの場合、並行実行数を増加
        this.config.maxConcurrentRequests = Math.min(10, this.config.maxConcurrentRequests + 1);
        this.logger.info('Auto-optimization: Increased concurrent requests', {
          newLimit: this.config.maxConcurrentRequests
        });
      } else if (queueStatus.totalQueueSize < 10 && this.config.maxConcurrentRequests > 3) {
        // 小さなキューサイズの場合、並行実行数を減少
        this.config.maxConcurrentRequests = Math.max(3, this.config.maxConcurrentRequests - 1);
        this.logger.info('Auto-optimization: Decreased concurrent requests', {
          newLimit: this.config.maxConcurrentRequests
        });
      }
      
      // エラー率に基づく最適化
      if (usage.errorRate > 0.1) { // 10%以上のエラー率
        this.throttleConfig.delay = Math.min(10000, this.throttleConfig.delay * 1.5);
        this.logger.warn('Auto-optimization: Increased throttle delay due to high error rate', {
          errorRate: usage.errorRate,
          newDelay: this.throttleConfig.delay
        });
      }
      
    } catch (error) {
      this.logger.error('Auto-optimization error', error);
    }
  }
  
  // ======================
  // API Methods for Management API
  // ======================
  
  async getQueueStatus() {
    return this.queueManager.getStatus();
  }
  
  async pauseQueue() {
    this.queueManager.pause();
  }
  
  async resumeQueue() {
    this.queueManager.resume();
  }
  
  async clearQueue(priority = 'all') {
    return this.queueManager.clearQueue(priority);
  }
  
  async removeTask(taskId) {
    return await this.queueManager.removeTask(taskId);
  }
  
  async getUsageStats(minutes = 60) {
    return this.usageMonitor.getTimeSeriesStats(minutes);
  }
  
  async getAgentStats(agent = null) {
    return this.usageMonitor.getAgentStats(agent);
  }
  
  async getErrorStats(hours = 24) {
    // Error statistics implementation
    const stats = this.usageMonitor.getAgentStats();
    const errorStats = {};
    
    for (const [agent, data] of Object.entries(stats)) {
      errorStats[agent] = {
        errorRate: data.errorRate,
        errorCount: data.errorCount,
        recentErrors: data.recentErrors || []
      };
    }
    
    return errorStats;
  }
  
  async getPerformanceStats() {
    const usage = this.usageMonitor.getCurrentWindowStats();
    const queueStatus = this.queueManager.getStatus();
    
    return {
      averageResponseTime: usage.averageResponseTime,
      requestsPerMinute: usage.requestsPerMinute,
      successRate: usage.successRate,
      activeRequests: this.activeRequests.size,
      queueSize: queueStatus.totalQueueSize,
      uptime: Date.now() - this.startTime
    };
  }
  
  async getPrediction(minutesAhead = 30) {
    return this.usageMonitor.predictUsage(minutesAhead);
  }
  
  async getHealthStatus() {
    const usage = this.usageMonitor.getCurrentWindowStats();
    const queueStatus = this.queueManager.getStatus();
    
    let status = 'healthy';
    if (this.emergencyStop.stopped || !this.sessionState.isValid) {
      status = 'unhealthy';
    } else if (usage.errorRate > 0.1 || queueStatus.totalQueueSize > 1000) {
      status = 'degraded';
    }
    
    return {
      status,
      sessionValid: this.sessionState.isValid,
      emergencyStopped: this.emergencyStop.stopped,
      activeRequests: this.activeRequests.size,
      queueSize: queueStatus.totalQueueSize,
      errorRate: usage.errorRate,
      uptime: Date.now() - this.startTime
    };
  }
  
  async getDetailedHealth() {
    const basicHealth = await this.getHealthStatus();
    const usage = this.usageMonitor.getCurrentWindowStats();
    const prediction = this.usageMonitor.predictUsage(30);
    
    return {
      ...basicHealth,
      components: {
        redis: this.redis.isOpen,
        queueManager: this.queueManager ? 'running' : 'stopped',
        usageMonitor: this.usageMonitor ? 'running' : 'stopped',
        claudeExecutor: this.claudeExecutor ? 'running' : 'stopped'
      },
      metrics: usage,
      prediction,
      throttling: this.throttleConfig,
      agents: this.usageMonitor.getAgentStats()
    };
  }
  
  async getConfig() {
    return {
      ...this.config,
      throttling: this.throttleConfig,
      agentPriorities: Object.fromEntries(this.agentPriorities)
    };
  }
  
  async updateConfig(newConfig) {
    // 安全な設定更新
    const allowedKeys = [
      'maxConcurrentRequests',
      'throttleDelay',
      'autoOptimization'
    ];
    
    for (const key of allowedKeys) {
      if (newConfig[key] !== undefined) {
        this.config[key] = newConfig[key];
      }
    }
    
    this.logger.info('Configuration updated', newConfig);
    return this.config;
  }
  
  async emergencyShutdown(reason) {
    this.logger.error('Emergency shutdown requested', { reason });
    this.emit('emergencyStop', reason || 'Manual emergency stop');
  }
  
  async getPrometheusMetrics() {
    if (!this.prometheusExporter) {
      throw new Error('Prometheus metrics not enabled');
    }
    
    return await this.prometheusExporter.getMetrics();
  }
  
  /**
   * Express Router取得（管理API用）
   */
  getManagementRouter() {
    if (!this.managementAPI) {
      throw new Error('Management API not enabled');
    }
    
    return this.managementAPI.getRouter();
  }
  
  /**
   * WebSocket統合セットアップ
   */
  setupWebSocketIntegration(io) {
    if (this.managementAPI) {
      this.managementAPI.setupWebSocketIntegration(io);
    }
  }
  
  /**
   * CCSPエージェントの停止
   */
  async shutdown() {
    this.logger.info('Shutting down CCSP Agent...');
    
    this.isRunning = false;
    
    // インターバルの停止
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }
    
    if (this.sessionMonitorInterval) {
      clearInterval(this.sessionMonitorInterval);
    }
    
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
    }
    
    // アクティブなリクエストの完了を待機
    const maxWait = 30000; // 30秒
    const start = Date.now();
    
    while (this.activeRequests.size > 0 && (Date.now() - start) < maxWait) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // コンポーネントのシャットダウン
    if (this.queueManager) {
      await this.queueManager.shutdown();
    }
    
    if (this.usageMonitor) {
      await this.usageMonitor.shutdown();
    }
    
    if (this.redis && this.redis.isOpen) {
      await this.redis.disconnect();
    }
    
    this.logger.info('CCSP Agent shutdown complete', {
      activeRequestsRemaining: this.activeRequests.size
    });
  }
}

module.exports = CCSPAgent;