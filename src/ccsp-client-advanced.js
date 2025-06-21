/**
 * 高度なCCSPクライアント - エージェント統合層用
 * 
 * エラーハンドリング、再試行、監視機能を含む完全な実装
 */

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

/**
 * CCSPリクエストの標準フォーマット
 */
class CCSPRequest {
  constructor(data = {}) {
    this.requestId = data.requestId || uuidv4();
    this.fromAgent = data.fromAgent || 'poppo-builder';
    this.taskType = data.taskType || 'claude-cli';
    this.timestamp = data.timestamp || new Date().toISOString();
    this.priority = data.priority || 'normal';
    this.metadata = data.metadata || {};
    this.taskData = data.taskData || {};
    
    // Claude CLI特有のフィールド
    this.prompt = data.prompt;
    this.systemPrompt = data.systemPrompt;
    this.includeFiles = data.includeFiles || [];
    this.modelPreference = data.modelPreference || {};
    this.continueExecution = data.continueExecution || false;
  }
  
  toJSON() {
    return {
      requestId: this.requestId,
      fromAgent: this.fromAgent,
      taskType: this.taskType,
      timestamp: this.timestamp,
      priority: this.priority,
      metadata: this.metadata,
      taskData: this.taskData,
      prompt: this.prompt,
      systemPrompt: this.systemPrompt,
      includeFiles: this.includeFiles,
      modelPreference: this.modelPreference,
      continueExecution: this.continueExecution
    };
  }
}

/**
 * CCSPレスポンスの標準フォーマット
 */
class CCSPResponse {
  constructor(data = {}) {
    this.requestId = data.requestId;
    this.success = data.success || false;
    this.result = data.result;
    this.error = data.error;
    this.sessionTimeout = data.sessionTimeout || false;
    this.rateLimitInfo = data.rateLimitInfo;
    this.executionTime = data.executionTime;
    this.timestamp = data.timestamp || new Date().toISOString();
    this.retryable = data.retryable !== false;
  }
  
  isRetryable() {
    // セッションタイムアウトは再試行不可
    if (this.sessionTimeout) return false;
    
    // レート制限は待機後に再試行可能
    if (this.rateLimitInfo) return true;
    
    // その他のエラーはretryableフラグに従う
    return !this.success && this.retryable;
  }
  
  getWaitTime() {
    if (this.rateLimitInfo && this.rateLimitInfo.waitTime) {
      return this.rateLimitInfo.waitTime;
    }
    return 0;
  }
}

/**
 * 高度なCCSPクライアント
 */
class AdvancedCCSPClient extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        ...config.redis
      },
      responseTimeout: config.responseTimeout || 300000, // 5分
      retryConfig: {
        maxRetries: 3,
        initialDelay: 5000,
        maxDelay: 60000,
        backoffMultiplier: 2,
        ...config.retryConfig
      },
      monitoring: {
        enabled: true,
        metricsInterval: 30000,
        ...config.monitoring
      },
      ...config
    };
    
    this.logger = config.logger || console;
    this.redis = new Redis(this.config.redis);
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      timeouts: 0,
      rateLimits: 0,
      sessionTimeouts: 0,
      averageResponseTime: 0
    };
    
    this.pendingRequests = new Map();
    this.setupRedisEventHandlers();
    
    if (this.config.monitoring.enabled) {
      this.startMetricsCollection();
    }
  }
  
  /**
   * Redis イベントハンドラーの設定
   */
  setupRedisEventHandlers() {
    this.redis.on('error', (error) => {
      this.logger.error('[AdvancedCCSPClient] Redis error:', error);
      this.emit('error', error);
    });
    
    this.redis.on('connect', () => {
      this.logger.info('[AdvancedCCSPClient] Redis connected');
      this.emit('connected');
    });
    
    this.redis.on('close', () => {
      this.logger.warn('[AdvancedCCSPClient] Redis connection closed');
      this.emit('disconnected');
    });
  }
  
  /**
   * メトリクス収集の開始
   */
  startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.emit('metrics', this.getMetrics());
    }, this.config.monitoring.metricsInterval);
  }
  
  /**
   * リクエストの送信（再試行機能付き）
   */
  async sendRequest(requestData, options = {}) {
    const request = new CCSPRequest(requestData);
    const startTime = Date.now();
    
    this.metrics.totalRequests++;
    this.emit('request:start', request);
    
    let lastError;
    let attempt = 0;
    const maxRetries = options.maxRetries !== undefined 
      ? options.maxRetries 
      : this.config.retryConfig.maxRetries;
    
    while (attempt <= maxRetries) {
      try {
        if (attempt > 0) {
          const delay = this.calculateRetryDelay(attempt);
          this.logger.info(`[AdvancedCCSPClient] Retry attempt ${attempt} after ${delay}ms`);
          await this.sleep(delay);
        }
        
        const response = await this.sendRequestOnce(request, options);
        
        // レスポンスの検証
        if (response.success) {
          this.metrics.successfulRequests++;
          const responseTime = Date.now() - startTime;
          this.updateAverageResponseTime(responseTime);
          this.emit('request:success', request, response, responseTime);
          return response;
        }
        
        // エラーレスポンスの処理
        if (!response.isRetryable() || attempt >= maxRetries) {
          this.handleRequestFailure(request, response);
          return response;
        }
        
        // レート制限の場合は待機時間を考慮
        if (response.rateLimitInfo) {
          const waitTime = response.getWaitTime();
          if (waitTime > 0) {
            this.logger.info(`[AdvancedCCSPClient] Rate limit detected, waiting ${waitTime}ms`);
            this.metrics.rateLimits++;
            await this.sleep(waitTime);
          }
        }
        
        lastError = response.error;
        attempt++;
        
      } catch (error) {
        lastError = error;
        attempt++;
        
        if (attempt > maxRetries) {
          this.metrics.failedRequests++;
          this.emit('request:error', request, error);
          throw error;
        }
      }
    }
    
    // すべての再試行が失敗
    this.metrics.failedRequests++;
    const error = new Error(`All retry attempts failed: ${lastError}`);
    this.emit('request:error', request, error);
    throw error;
  }
  
  /**
   * 単一リクエストの送信
   */
  async sendRequestOnce(request, options = {}) {
    const timeout = options.timeout || this.config.responseTimeout;
    
    try {
      // リクエストをキューに送信
      await this.redis.lpush('ccsp:requests', JSON.stringify(request.toJSON()));
      this.logger.debug(`[AdvancedCCSPClient] Request sent: ${request.requestId}`);
      
      // レスポンスを待機
      const response = await this.waitForResponse(
        request.fromAgent, 
        request.requestId, 
        timeout
      );
      
      return new CCSPResponse(response);
      
    } catch (error) {
      if (error.message.includes('timeout')) {
        this.metrics.timeouts++;
      }
      throw error;
    }
  }
  
  /**
   * レスポンス待機
   */
  async waitForResponse(fromAgent, requestId, timeout) {
    const responseKey = `ccsp:response:${fromAgent}`;
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        reject(new Error(`Response timeout for request ${requestId}`));
      }, timeout);
      
      const checkResponse = async () => {
        try {
          const elapsed = Date.now() - startTime;
          if (elapsed >= timeout) {
            clearTimeout(timeoutTimer);
            reject(new Error(`Response timeout for request ${requestId}`));
            return;
          }
          
          // ブロッキングモードで待機（1秒タイムアウト）
          const result = await this.redis.blpop(responseKey, 1);
          
          if (result) {
            const [, data] = result;
            const response = JSON.parse(data);
            
            // このリクエストのレスポンスか確認
            if (response.requestId === requestId) {
              clearTimeout(timeoutTimer);
              resolve(response);
            } else {
              // 他のリクエストのレスポンスは戻す
              await this.redis.lpush(responseKey, data);
              // 再度チェック
              setImmediate(checkResponse);
            }
          } else {
            // タイムアウトしたので再度チェック
            setImmediate(checkResponse);
          }
        } catch (error) {
          clearTimeout(timeoutTimer);
          reject(error);
        }
      };
      
      // 初回チェック
      checkResponse();
    });
  }
  
  /**
   * リクエスト失敗の処理
   */
  handleRequestFailure(request, response) {
    this.metrics.failedRequests++;
    
    if (response.sessionTimeout) {
      this.metrics.sessionTimeouts++;
      this.emit('session:timeout', request, response);
    } else if (response.rateLimitInfo) {
      this.metrics.rateLimits++;
      this.emit('rate:limit', request, response);
    } else {
      this.emit('request:failed', request, response);
    }
  }
  
  /**
   * 再試行遅延の計算
   */
  calculateRetryDelay(attempt) {
    const { initialDelay, maxDelay, backoffMultiplier } = this.config.retryConfig;
    const delay = Math.min(
      initialDelay * Math.pow(backoffMultiplier, attempt - 1),
      maxDelay
    );
    
    // ジッターを追加（±25%）
    const jitter = delay * 0.25;
    return delay + (Math.random() * jitter * 2 - jitter);
  }
  
  /**
   * 平均レスポンス時間の更新
   */
  updateAverageResponseTime(responseTime) {
    const successCount = this.metrics.successfulRequests;
    const currentAverage = this.metrics.averageResponseTime;
    this.metrics.averageResponseTime = 
      (currentAverage * (successCount - 1) + responseTime) / successCount;
  }
  
  /**
   * スリープ
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * メトリクスの取得
   */
  getMetrics() {
    const totalResponses = this.metrics.successfulRequests + this.metrics.failedRequests;
    const successRate = totalResponses > 0 
      ? (this.metrics.successfulRequests / totalResponses * 100).toFixed(2)
      : 0;
    
    return {
      ...this.metrics,
      successRate: `${successRate}%`,
      pendingRequests: this.pendingRequests.size
    };
  }
  
  /**
   * ヘルスチェック
   */
  async healthCheck() {
    try {
      await this.redis.ping();
      return {
        healthy: true,
        redis: 'connected',
        metrics: this.getMetrics()
      };
    } catch (error) {
      return {
        healthy: false,
        redis: 'disconnected',
        error: error.message
      };
    }
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    
    // 保留中のリクエストをキャンセル
    for (const [requestId, request] of this.pendingRequests) {
      this.emit('request:cancelled', request);
    }
    this.pendingRequests.clear();
    
    await this.redis.quit();
    this.emit('cleanup');
  }
}

module.exports = {
  AdvancedCCSPClient,
  CCSPRequest,
  CCSPResponse
};