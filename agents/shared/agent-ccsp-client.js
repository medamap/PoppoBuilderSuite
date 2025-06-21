/**
 * エージェント用CCSPクライアント
 * 
 * すべてのエージェントがCCSP経由でClaude APIを利用するための共通クライアント
 */

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class AgentCCSPClient extends EventEmitter {
  constructor(agentName, logger, config = {}) {
    super();
    
    this.agentName = agentName;
    this.logger = logger;
    this.config = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        ...config.redis
      },
      timeout: config.timeout || 600000, // 10分
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 5000
    };
    
    // Redis接続
    this.redis = new Redis(this.config.redis);
    this.requestQueue = 'ccsp:requests';
    this.responseQueue = `ccsp:response:${this.agentName.toLowerCase()}`;
    
    // エラーハンドラー
    this.redis.on('error', (error) => {
      this.logger.error(`[AgentCCSPClient] Redis error: ${error.message}`);
      this.emit('error', error);
    });
    
    this.redis.on('connect', () => {
      this.logger.info(`[AgentCCSPClient] Connected to Redis`);
      this.emit('connected');
    });
  }
  
  /**
   * Claude分析を実行
   */
  async analyzeWithClaude(prompt, options = {}) {
    const requestId = uuidv4();
    
    const request = {
      requestId,
      fromAgent: this.agentName,
      taskType: options.taskType || 'claude-analysis',
      prompt: this.buildSafePrompt(prompt),
      systemPrompt: options.systemPrompt || this.getDefaultSystemPrompt(),
      priority: options.priority || 'normal',
      includeFiles: options.includeFiles || [],
      modelPreference: options.modelPreference || {},
      metadata: {
        timestamp: new Date().toISOString(),
        source: this.agentName,
        ...options.metadata
      }
    };
    
    this.logger.info(`[AgentCCSPClient] Sending request ${requestId} to CCSP`);
    
    try {
      // リクエストを送信
      await this.redis.lpush(this.requestQueue, JSON.stringify(request));
      
      // レスポンスを待機
      const response = await this.waitForResponse(requestId);
      
      if (response.success) {
        this.logger.info(`[AgentCCSPClient] Request ${requestId} completed successfully`);
        return this.parseResponse(response);
      } else {
        this.handleError(response);
      }
      
    } catch (error) {
      this.logger.error(`[AgentCCSPClient] Request ${requestId} failed: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 安全なプロンプトを構築（Claude API呼び出し禁止の注意書きを追加）
   */
  buildSafePrompt(originalPrompt) {
    const safetyHeader = `【重要な制限事項】
以下の行為は絶対に禁止です：
1. Claude APIの直接呼び出し
2. anthropic、claude-ai、claude-sdk等のライブラリの使用
3. HTTPリクエストでのClaude APIエンドポイントへのアクセス
4. 子プロセスからのclaude CLIコマンドの実行

この制限はPoppoBuilderSuiteシステム全体のポリシーです。
Claude APIが必要な場合は、必ずCCSPエージェント経由でリクエストしてください。

=== 以下、本来のリクエスト内容 ===

`;
    
    return safetyHeader + originalPrompt;
  }
  
  /**
   * デフォルトのシステムプロンプト
   */
  getDefaultSystemPrompt() {
    return `あなたは${this.agentName}エージェントのアシスタントです。
PoppoBuilder Suiteのコードベースを分析し、適切な提案を行ってください。
重要: 直接Claude APIを呼び出すコードは絶対に生成しないでください。`;
  }
  
  /**
   * レスポンスを待機
   */
  async waitForResponse(requestId) {
    const timeout = Date.now() + this.config.timeout;
    
    while (Date.now() < timeout) {
      try {
        // ブロッキングモードで待機（1秒タイムアウト）
        const result = await this.redis.blpop(this.responseQueue, 1);
        
        if (result) {
          const [, data] = result;
          const response = JSON.parse(data);
          
          // 自分のリクエストのレスポンスか確認
          if (response.requestId === requestId) {
            return response;
          } else {
            // 他のリクエストのレスポンスは戻す
            await this.redis.lpush(this.responseQueue, data);
          }
        }
      } catch (error) {
        this.logger.error(`[AgentCCSPClient] Error waiting for response: ${error.message}`);
      }
    }
    
    throw new Error(`Timeout waiting for response: ${requestId}`);
  }
  
  /**
   * レスポンスをパース
   */
  parseResponse(response) {
    const output = response.result || '';
    
    // JSON形式のレスポンスを探す
    const jsonMatch = output.match(/```json\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[1]);
      } catch (error) {
        this.logger.warn('[AgentCCSPClient] Failed to parse JSON response');
      }
    }
    
    // プレーンテキストとして返す
    return {
      output: output,
      raw: true
    };
  }
  
  /**
   * エラーハンドリング
   */
  handleError(response) {
    if (response.sessionTimeout) {
      const error = new Error('Claude session timeout - manual login required');
      error.sessionTimeout = true;
      error.requiresManualAction = true;
      this.emit('session:timeout', response);
      throw error;
    }
    
    if (response.rateLimitInfo) {
      const error = new Error(`Rate limit reached - wait until ${new Date(response.rateLimitInfo.unlockTime).toISOString()}`);
      error.rateLimited = true;
      error.unlockTime = response.rateLimitInfo.unlockTime;
      error.waitTime = response.rateLimitInfo.waitTime;
      this.emit('rate:limit', response);
      throw error;
    }
    
    throw new Error(response.error || 'CCSP request failed');
  }
  
  /**
   * ヘルスチェック
   */
  async healthCheck() {
    try {
      await this.redis.ping();
      return {
        healthy: true,
        agent: this.agentName,
        responseQueue: this.responseQueue
      };
    } catch (error) {
      return {
        healthy: false,
        agent: this.agentName,
        error: error.message
      };
    }
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    await this.redis.quit();
    this.removeAllListeners();
  }
}

module.exports = AgentCCSPClient;