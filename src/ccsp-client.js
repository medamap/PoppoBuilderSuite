/**
 * CCSPクライアント - PoppoBuilderからCCSPエージェントへの通信
 * 
 * すべてのClaude CLI呼び出しをCCSP経由にルーティング
 */

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

class CCSPClient {
  constructor(logger = null) {
    this.logger = logger;
    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379
    });
    
    // レスポンス待機のタイムアウト（5分）
    this.responseTimeout = 300000;
    
    // リトライ設定
    this.maxRetries = 3;
    this.retryDelay = 5000; // 5秒
  }
  
  /**
   * CCSPにリクエストを送信
   */
  async sendRequest(taskData) {
    const requestId = taskData.requestId || uuidv4();
    const fromAgent = taskData.fromAgent || 'poppo-builder';
    
    const request = {
      requestId,
      fromAgent,
      taskType: 'claude-cli',
      timestamp: new Date().toISOString(),
      ...taskData
    };
    
    if (this.logger) {
      this.logger.info(`[CCSPClient] Sending request: ${requestId}`);
      this.logger.debug('[CCSPClient] Request details:', request);
    }
    
    try {
      // リクエストをRedisキューに送信
      await this.redis.lpush('ccsp:requests', JSON.stringify(request));
      
      // レスポンスを待機
      const response = await this.waitForResponse(fromAgent, requestId);
      
      if (this.logger) {
        this.logger.info(`[CCSPClient] Received response: ${requestId}`);
        this.logger.debug('[CCSPClient] Response details:', response);
      }
      
      return response;
      
    } catch (error) {
      if (this.logger) {
        this.logger.error('[CCSPClient] Error sending request:', error);
      }
      throw error;
    }
  }
  
  /**
   * レスポンスを待機
   */
  async waitForResponse(fromAgent, requestId) {
    const responseKey = `ccsp:response:${fromAgent}`;
    const startTime = Date.now();
    
    while (Date.now() - startTime < this.responseTimeout) {
      try {
        // ブロッキングモードで待機（1秒タイムアウト）
        const result = await this.redis.blpop(responseKey, 1);
        
        if (result) {
          const [, data] = result;
          const response = JSON.parse(data);
          
          // このリクエストのレスポンスか確認
          if (response.requestId === requestId) {
            return response;
          } else {
            // 他のリクエストのレスポンスは戻す
            await this.redis.lpush(responseKey, data);
          }
        }
      } catch (error) {
        if (this.logger) {
          this.logger.error('[CCSPClient] Error waiting for response:', error);
        }
      }
    }
    
    // タイムアウト
    throw new Error(`Response timeout for request ${requestId}`);
  }
  
  /**
   * ProcessManager用のヘルパーメソッド
   * 既存のClaude CLI呼び出しと互換性のあるインターフェース
   */
  async executeForProcessManager(taskId, prompt, args = []) {
    // argsから必要な情報を抽出
    const modelPreference = {};
    
    // --model オプションの解析
    const modelIndex = args.indexOf('--model');
    if (modelIndex !== -1 && args[modelIndex + 1]) {
      modelPreference.primary = args[modelIndex + 1];
    }
    
    // --fallback-model オプションの解析
    const fallbackIndex = args.indexOf('--fallback-model');
    if (fallbackIndex !== -1 && args[fallbackIndex + 1]) {
      modelPreference.fallback = args[fallbackIndex + 1];
    }
    
    const request = {
      requestId: `pm-${taskId}`,
      taskId,
      prompt,
      modelPreference: Object.keys(modelPreference).length > 0 ? modelPreference : undefined,
      metadata: {
        source: 'process-manager',
        originalArgs: args
      }
    };
    
    const response = await this.sendRequest(request);
    
    // ProcessManagerが期待する形式に変換
    if (response.success) {
      return {
        stdout: response.result || '',
        stderr: '',
        code: 0
      };
    } else {
      // エラーの種類に応じて処理
      if (response.sessionTimeout) {
        return {
          stdout: '',
          stderr: 'SESSION_TIMEOUT: ' + (response.message || 'Claude login required'),
          code: 1,
          sessionTimeout: true
        };
      } else if (response.rateLimitInfo) {
        return {
          stdout: '',
          stderr: `RATE_LIMIT: ${response.rateLimitInfo.message}`,
          code: 1,
          rateLimitInfo: response.rateLimitInfo
        };
      } else {
        return {
          stdout: '',
          stderr: response.error || 'Unknown error',
          code: 1
        };
      }
    }
  }
  
  /**
   * RateLimitHandler用のヘルパーメソッド
   * continueオプション付きの実行
   */
  async continueExecution(taskId) {
    const request = {
      requestId: `rlh-${taskId}`,
      taskId,
      prompt: 'please resume your jobs.',
      continueExecution: true,
      metadata: {
        source: 'rate-limit-handler',
        action: 'continue'
      }
    };
    
    const response = await this.sendRequest(request);
    
    if (response.success) {
      return {
        stdout: response.result || '',
        stderr: '',
        code: 0
      };
    } else {
      return {
        stdout: '',
        stderr: response.error || 'Failed to continue execution',
        code: 1
      };
    }
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    await this.redis.quit();
  }
}

module.exports = CCSPClient;