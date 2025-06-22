/**
 * CCSP統合版エージェント基盤クラス
 * 
 * AgentBaseを拡張し、CCSP経由でのClaude API呼び出し機能を提供
 */

const AgentBase = require('./agent-base');
const AgentCCSPClient = require('./agent-ccsp-client');

class AgentBaseWithCCSP extends AgentBase {
  constructor(agentName, config = {}) {
    super(agentName, config);
    
    // CCSP統合設定
    this.ccspEnabled = config.ccsp?.enabled !== false;
    this.ccspClient = null;
  }
  
  /**
   * エージェントの初期化（拡張版）
   */
  async initialize() {
    // 親クラスの初期化
    await super.initialize();
    
    // CCSPクライアントの初期化
    if (this.ccspEnabled) {
      try {
        this.logger.info('CCSPクライアントを初期化中...');
        
        this.ccspClient = new AgentCCSPClient(
          this.agentName,
          this.logger,
          this.config.ccsp || {}
        );
        
        // CCSPイベントリスナーの設定
        this.setupCCSPEventListeners();
        
        // ヘルスチェック
        const health = await this.ccspClient.healthCheck();
        if (!health.healthy) {
          throw new Error(`CCSP client health check failed: ${health.error}`);
        }
        
        this.logger.info('CCSPクライアントの初期化完了');
      } catch (error) {
        this.logger.error(`CCSPクライアント初期化エラー: ${error.message}`);
        this.ccspEnabled = false;
        // CCSPが利用できない場合も継続（エラーは記録のみ）
      }
    }
  }
  
  /**
   * CCSPイベントリスナーの設定
   */
  setupCCSPEventListeners() {
    if (!this.ccspClient) return;
    
    // セッションタイムアウト
    this.ccspClient.on('session:timeout', (response) => {
      this.logger.error('[CCSP] セッションタイムアウトを検出しました');
      this.logger.error('手動でのログインが必要です: claude login');
      this.emit('ccsp:session:timeout', response);
    });
    
    // レート制限
    this.ccspClient.on('rate:limit', (response) => {
      const unlockTime = new Date(response.rateLimitInfo.unlockTime);
      this.logger.warn(`[CCSP] レート制限を検出 - 解除時刻: ${unlockTime.toISOString()}`);
      this.emit('ccsp:rate:limit', response);
    });
    
    // エラー
    this.ccspClient.on('error', (error) => {
      this.logger.error('[CCSP] エラー:', error);
      this.emit('ccsp:error', error);
    });
    
    // 接続
    this.ccspClient.on('connected', () => {
      this.logger.info('[CCSP] Redis接続確立');
      this.emit('ccsp:connected');
    });
  }
  
  /**
   * Claude分析を実行（CCSP経由）
   * 
   * @param {string} prompt 分析プロンプト
   * @param {Object} options オプション
   * @returns {Promise<Object>} 分析結果
   */
  async analyzeWithClaude(prompt, options = {}) {
    if (!this.ccspEnabled || !this.ccspClient) {
      throw new Error('CCSPクライアントが利用できません');
    }
    
    this.logger.info('CCSP経由でClaude分析を実行中...');
    
    try {
      const result = await this.ccspClient.analyzeWithClaude(prompt, {
        taskType: 'analysis',
        priority: options.priority || 'normal',
        systemPrompt: options.systemPrompt,
        includeFiles: options.includeFiles || [],
        modelPreference: options.modelPreference || this.config.modelPreference,
        metadata: {
          agentId: this.agentId,
          taskId: options.taskId,
          ...options.metadata
        }
      });
      
      this.logger.info('Claude分析が完了しました');
      return result;
      
    } catch (error) {
      this.logger.error(`Claude分析エラー: ${error.message}`);
      
      // セッションタイムアウトやレート制限の場合は再スローする
      if (error.sessionTimeout || error.rateLimited) {
        throw error;
      }
      
      // その他のエラーの場合はフォールバック処理を提供
      if (options.fallback) {
        this.logger.warn('フォールバック処理を実行します');
        return options.fallback(prompt);
      }
      
      throw error;
    }
  }
  
  /**
   * コード生成を実行（CCSP経由）
   */
  async generateCodeWithClaude(prompt, options = {}) {
    return await this.analyzeWithClaude(prompt, {
      ...options,
      taskType: 'code-generation',
      systemPrompt: options.systemPrompt || `あなたは${this.agentName}のコード生成アシスタントです。
高品質で保守しやすいコードを生成してください。
重要: Claude APIを直接呼び出すコードは絶対に生成しないでください。`
    });
  }
  
  /**
   * レビューコメントを生成（CCSP経由）
   */
  async generateReviewWithClaude(prompt, options = {}) {
    return await this.analyzeWithClaude(prompt, {
      ...options,
      taskType: 'review-generation',
      systemPrompt: options.systemPrompt || `あなたは${this.agentName}のコードレビューアシスタントです。
建設的で具体的なフィードバックを提供してください。`
    });
  }
  
  /**
   * シャットダウン（拡張版）
   */
  async shutdown() {
    // CCSPクライアントのクリーンアップ
    if (this.ccspClient) {
      try {
        await this.ccspClient.cleanup();
        this.logger.info('CCSPクライアントをクリーンアップしました');
      } catch (error) {
        this.logger.error(`CCSPクライアントのクリーンアップエラー: ${error.message}`);
      }
    }
    
    // 親クラスのシャットダウン
    await super.shutdown();
  }
  
  /**
   * CCSPが利用可能かチェック
   */
  isCCSPAvailable() {
    return this.ccspEnabled && this.ccspClient !== null;
  }
  
  /**
   * CCSPヘルスチェック
   */
  async checkCCSPHealth() {
    if (!this.isCCSPAvailable()) {
      return { healthy: false, reason: 'CCSP not enabled or initialized' };
    }
    
    return await this.ccspClient.healthCheck();
  }
}

module.exports = AgentBaseWithCCSP;