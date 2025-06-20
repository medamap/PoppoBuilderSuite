/**
 * CCSPエージェント（パイちゃん） - Claude Code呼び出し専任エージェント
 * 
 * PoppoBuilderファミリー全体のClaude Code呼び出しを一元管理
 */

const Redis = require('ioredis');
const ClaudeExecutor = require('./claude-executor');
const QueueManager = require('./queue-manager');
const RateLimiter = require('./rate-limiter');
const MetricsCollector = require('./metrics-collector');
const HealthMonitor = require('./health-monitor');
const InstanceCoordinator = require('./instance-coordinator');
const SessionMonitor = require('./session-monitor');
const NotificationHandler = require('./notification-handler');
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
    this.rateLimiter = new RateLimiter(logger);
    this.metricsCollector = new MetricsCollector(logger);
    this.healthMonitor = new HealthMonitor(this.redis, logger);
    this.instanceCoordinator = new InstanceCoordinator(this.redis, logger);
    this.sessionMonitor = new SessionMonitor(this.redis, logger);
    this.notificationHandler = new NotificationHandler(this.redis, logger);
    
    this.isRunning = false;
    this.activeRequests = new Map();
    
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
      const result = await this.claudeExecutor.execute(request);
      
      // 実行時間を計算
      const executionTime = Date.now() - startTime;
      
      // セッションタイムアウトチェック
      if (result.sessionTimeout) {
        this.logger.error(`[CCSP] Session timeout detected for request ${requestId}`);
        
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
        return;
      }
      
      // レート制限情報を更新
      if (result.rateLimitInfo) {
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