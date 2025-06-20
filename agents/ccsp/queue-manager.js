/**
 * Redis Queueマネージャー
 * 
 * リクエストの受信とレスポンスの送信を管理
 */

class QueueManager {
  constructor(redis, logger) {
    this.redis = redis;
    this.logger = logger;
    this.requestQueue = 'ccsp:requests';
  }
  
  /**
   * 次のリクエストを取得（FIFO: 先入れ先出し）
   */
  async getNextRequest() {
    try {
      // キューから1件取得（ブロッキングなし）
      // lpushで追加、rpopで取得 = FIFO
      const data = await this.redis.lpop(this.requestQueue);
      if (!data) {
        return null;
      }
      
      const request = JSON.parse(data);
      this.logger.info(`[QueueManager] Request received: ${request.requestId} from ${request.fromAgent}`);
      
      // 詳細なリクエストの検証
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        this.logger.error('[QueueManager] Invalid request format:', validation.errors);
        // エラーレスポンスを送信
        if (request.fromAgent && request.requestId) {
          await this.sendResponse(request.fromAgent, {
            requestId: request.requestId,
            success: false,
            error: `Invalid request: ${validation.errors.join(', ')}`,
            timestamp: new Date().toISOString()
          });
        }
        return null;
      }
      
      return request;
      
    } catch (error) {
      this.logger.error('[QueueManager] Error getting request:', error);
      return null;
    }
  }
  
  /**
   * 次のリクエストを取得（ブロッキングモード）
   * CPU使用率を削減するためのバージョン
   */
  async getNextRequestBlocking(timeoutSeconds = 1) {
    try {
      // blpopでブロッキング取得（タイムアウト付き）
      const result = await this.redis.blpop(this.requestQueue, timeoutSeconds);
      
      if (!result) {
        return null;
      }
      
      // blpopは[key, value]の配列を返す
      const [, data] = result;
      
      const request = JSON.parse(data);
      this.logger.info(`[QueueManager] Request received: ${request.requestId} from ${request.fromAgent}`);
      
      // 詳細なリクエストの検証
      const validation = this.validateRequest(request);
      if (!validation.valid) {
        this.logger.error('[QueueManager] Invalid request format:', validation.errors);
        // エラーレスポンスを送信
        if (request.fromAgent && request.requestId) {
          await this.sendResponse(request.fromAgent, {
            requestId: request.requestId,
            success: false,
            error: `Invalid request: ${validation.errors.join(', ')}`,
            timestamp: new Date().toISOString()
          });
        }
        return null;
      }
      
      return request;
      
    } catch (error) {
      this.logger.error('[QueueManager] Error getting request:', error);
      return null;
    }
  }
  
  /**
   * レスポンスを送信
   */
  async sendResponse(fromAgent, response) {
    try {
      const responseQueue = `ccsp:responses:${fromAgent}`;
      
      // レスポンスをキューに追加
      await this.redis.lpush(responseQueue, JSON.stringify(response));
      
      this.logger.info(`[QueueManager] Response sent: ${response.requestId} to ${fromAgent}`);
      
    } catch (error) {
      this.logger.error('[QueueManager] Error sending response:', error);
      throw error;
    }
  }
  
  /**
   * キューのサイズを取得
   */
  async getQueueSize() {
    try {
      const size = await this.redis.llen(this.requestQueue);
      return size;
    } catch (error) {
      this.logger.error('[QueueManager] Error getting queue size:', error);
      return 0;
    }
  }
  
  /**
   * 特定エージェントのレスポンスキューサイズを取得
   */
  async getResponseQueueSize(agentName) {
    try {
      const responseQueue = `ccsp:responses:${agentName}`;
      const size = await this.redis.llen(responseQueue);
      return size;
    } catch (error) {
      this.logger.error('[QueueManager] Error getting response queue size:', error);
      return 0;
    }
  }
  
  /**
   * デバッグ用：全キューの状態を取得
   */
  async getQueueStatus() {
    try {
      const status = {
        requestQueue: await this.getQueueSize(),
        responseQueues: {}
      };
      
      // 全てのレスポンスキューを確認
      const keys = await this.redis.keys('ccsp:responses:*');
      for (const key of keys) {
        const agentName = key.replace('ccsp:responses:', '');
        status.responseQueues[agentName] = await this.redis.llen(key);
      }
      
      return status;
      
    } catch (error) {
      this.logger.error('[QueueManager] Error getting queue status:', error);
      return null;
    }
  }
  
  /**
   * リクエストの検証
   */
  validateRequest(request) {
    const errors = [];
    
    // 必須フィールドのチェック
    if (!request.requestId) {
      errors.push('requestId is required');
    }
    if (!request.fromAgent) {
      errors.push('fromAgent is required');
    }
    if (!request.prompt) {
      errors.push('prompt is required');
    }
    if (!request.type) {
      errors.push('type is required');
    }
    
    // 型チェック
    if (request.requestId && typeof request.requestId !== 'string') {
      errors.push('requestId must be a string');
    }
    if (request.fromAgent && typeof request.fromAgent !== 'string') {
      errors.push('fromAgent must be a string');
    }
    if (request.prompt && typeof request.prompt !== 'string') {
      errors.push('prompt must be a string');
    }
    
    // コンテキストの検証（オプショナル）
    if (request.context) {
      if (typeof request.context !== 'object') {
        errors.push('context must be an object');
      } else {
        if (request.context.timeout && typeof request.context.timeout !== 'number') {
          errors.push('context.timeout must be a number');
        }
        if (request.context.priority && !['high', 'normal', 'low'].includes(request.context.priority)) {
          errors.push('context.priority must be high, normal, or low');
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }
}

module.exports = QueueManager;