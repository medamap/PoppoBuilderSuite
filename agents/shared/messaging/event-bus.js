const EventEmitter = require('events');
const MessageQueue = require('./message-queue');
const MessageSchema = require('./message-schema');
const Logger = require('../../../src/logger');

/**
 * イベントバス
 * エージェント間のイベント駆動通信を管理
 */
class EventBus extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      eventQueueName: 'poppo:events',
      enablePersistence: config.enablePersistence !== false,
      enableBroadcast: config.enableBroadcast !== false,
      eventTTL: config.eventTTL || 3600000, // 1時間
      maxRetries: config.maxRetries || 3,
      ...config
    };
    
    this.logger = new Logger('EventBus');
    this.messageQueue = null;
    this.messageSchema = new MessageSchema();
    this.subscriptions = new Map();
    this.eventHandlers = new Map();
    this.eventStats = {
      published: 0,
      consumed: 0,
      failed: 0
    };
    
    // イベントスキーマの登録
    this.registerEventSchemas();
  }
  
  /**
   * 初期化
   */
  async initialize(messageQueue) {
    this.messageQueue = messageQueue || new MessageQueue(this.config);
    
    // イベントキューの設定
    if (this.config.enablePersistence) {
      await this.setupEventQueue();
    }
    
    this.logger.info('イベントバス初期化完了');
  }
  
  /**
   * イベントスキーマの登録
   */
  registerEventSchemas() {
    // Issue処理完了イベント
    this.messageSchema.registerCustomType('ISSUE_PROCESSED', {
      type: 'object',
      required: ['issueNumber', 'repository', 'result'],
      properties: {
        issueNumber: { type: 'number' },
        repository: { type: 'string' },
        result: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
            actions: { type: 'array', items: { type: 'string' } },
            artifacts: { type: 'array' }
          }
        },
        processingTime: { type: 'number' },
        agent: { type: 'string' }
      }
    });
    
    // エラー発生イベント
    this.messageSchema.registerCustomType('ERROR_OCCURRED', {
      type: 'object',
      required: ['errorCode', 'errorMessage', 'source'],
      properties: {
        errorCode: { type: 'string' },
        errorMessage: { type: 'string' },
        errorStack: { type: 'string' },
        source: {
          type: 'object',
          properties: {
            agent: { type: 'string' },
            task: { type: 'string' },
            context: { type: 'object' }
          }
        },
        severity: { 
          type: 'string', 
          enum: ['low', 'medium', 'high', 'critical'] 
        },
        retryable: { type: 'boolean' },
        timestamp: { type: 'string', format: 'date-time' }
      }
    });
    
    // エージェント状態変更イベント
    this.messageSchema.registerCustomType('AGENT_STATE_CHANGED', {
      type: 'object',
      required: ['agent', 'previousState', 'newState'],
      properties: {
        agent: { type: 'string' },
        previousState: { type: 'string' },
        newState: { type: 'string' },
        reason: { type: 'string' },
        metadata: { type: 'object' }
      }
    });
    
    // タスク進捗イベント
    this.messageSchema.registerCustomType('TASK_PROGRESS', {
      type: 'object',
      required: ['taskId', 'progress'],
      properties: {
        taskId: { type: 'string' },
        taskType: { type: 'string' },
        progress: { type: 'number', minimum: 0, maximum: 100 },
        milestone: { type: 'string' },
        estimatedTimeRemaining: { type: 'number' },
        details: { type: 'object' }
      }
    });
    
    // システムイベント
    this.messageSchema.registerCustomType('SYSTEM_EVENT', {
      type: 'object',
      required: ['event', 'component'],
      properties: {
        event: {
          type: 'string',
          enum: ['startup', 'shutdown', 'config-reload', 'health-check', 'resource-alert']
        },
        component: { type: 'string' },
        details: { type: 'object' },
        timestamp: { type: 'string', format: 'date-time' }
      }
    });
  }
  
  /**
   * イベントキューのセットアップ
   */
  async setupEventQueue() {
    // イベント処理用のグローバルプロセッサー
    await this.messageQueue.registerGlobalProcessor(
      this.config.eventQueueName,
      async (message) => {
        await this.handleQueuedEvent(message);
      },
      { concurrency: 5 }
    );
    
    // デッドレターキューの処理
    await this.messageQueue.processDeadLetterQueue(
      this.config.eventQueueName,
      async (message, originalError) => {
        this.logger.error(`イベント処理失敗 (DLQ): ${originalError}`);
        this.eventStats.failed++;
        
        // 失敗イベントの発行
        await this.publish('ERROR_OCCURRED', {
          errorCode: 'EVENT_PROCESSING_FAILED',
          errorMessage: originalError,
          source: {
            agent: 'event-bus',
            task: 'event-processing',
            context: message
          },
          severity: 'medium',
          retryable: false,
          timestamp: new Date().toISOString()
        });
      }
    );
  }
  
  /**
   * イベントの発行
   */
  async publish(eventType, payload, options = {}) {
    try {
      // イベントメッセージの構築
      const event = {
        id: this.generateEventId(),
        type: eventType,
        version: '1.0.0',
        timestamp: Date.now(),
        payload,
        metadata: {
          source: options.source || 'unknown',
          correlationId: options.correlationId,
          causationId: options.causationId,
          ttl: options.ttl || this.config.eventTTL
        }
      };
      
      // スキーマ検証
      const validation = this.messageSchema.validateMessage({
        ...event,
        type: eventType,
        payload
      });
      
      if (!validation.valid) {
        throw new Error(`イベント検証エラー: ${this.messageSchema.formatValidationErrors(validation.errors)}`);
      }
      
      // ローカルイベントの発行
      this.emit(eventType, event);
      
      // 永続化が有効な場合はキューに送信
      if (this.config.enablePersistence && this.messageQueue) {
        await this.messageQueue.sendMessage(
          this.config.eventQueueName,
          eventType,
          event,
          {
            priority: options.priority || 5,
            delay: options.delay,
            ttl: event.metadata.ttl
          }
        );
      }
      
      // ブロードキャストが有効な場合
      if (this.config.enableBroadcast && options.broadcast) {
        await this.broadcastEvent(event, options.targets);
      }
      
      this.eventStats.published++;
      this.logger.debug(`イベント発行: ${eventType}`);
      
      return event.id;
      
    } catch (error) {
      this.logger.error(`イベント発行エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * イベントの購読
   */
  subscribe(eventType, handler, options = {}) {
    const subscriptionId = this.generateSubscriptionId();
    
    // ローカルハンドラーの登録
    const wrappedHandler = async (event) => {
      try {
        await handler(event);
        this.eventStats.consumed++;
      } catch (error) {
        this.logger.error(`イベントハンドラーエラー (${eventType}): ${error.message}`);
        this.eventStats.failed++;
        
        if (options.onError) {
          await options.onError(error, event);
        }
      }
    };
    
    // EventEmitterへの登録
    this.on(eventType, wrappedHandler);
    
    // 購読情報の保存
    this.subscriptions.set(subscriptionId, {
      eventType,
      handler: wrappedHandler,
      options,
      createdAt: new Date()
    });
    
    this.logger.info(`イベント購読登録: ${eventType} (${subscriptionId})`);
    
    // 購読解除関数を返す
    return () => this.unsubscribe(subscriptionId);
  }
  
  /**
   * イベントの購読解除
   */
  unsubscribe(subscriptionId) {
    const subscription = this.subscriptions.get(subscriptionId);
    if (subscription) {
      this.removeListener(subscription.eventType, subscription.handler);
      this.subscriptions.delete(subscriptionId);
      this.logger.info(`イベント購読解除: ${subscription.eventType} (${subscriptionId})`);
    }
  }
  
  /**
   * パターンマッチング購読
   */
  subscribePattern(pattern, handler, options = {}) {
    const regex = new RegExp(pattern);
    
    // 全イベントをリッスンして、パターンマッチング
    const patternHandler = async (eventType, event) => {
      if (regex.test(eventType)) {
        try {
          await handler(eventType, event);
        } catch (error) {
          this.logger.error(`パターンハンドラーエラー: ${error.message}`);
        }
      }
    };
    
    // 特殊な'*'イベントで全イベントを受信
    this.on('*', patternHandler);
    
    const subscriptionId = this.generateSubscriptionId();
    this.subscriptions.set(subscriptionId, {
      pattern,
      handler: patternHandler,
      options,
      createdAt: new Date()
    });
    
    return () => {
      this.removeListener('*', patternHandler);
      this.subscriptions.delete(subscriptionId);
    };
  }
  
  /**
   * キューからのイベント処理
   */
  async handleQueuedEvent(message) {
    const event = message.payload;
    
    // ローカルイベントとして再発行
    this.emit(event.type, event);
    
    // 統計更新
    this.eventStats.consumed++;
  }
  
  /**
   * イベントのブロードキャスト
   */
  async broadcastEvent(event, targets = []) {
    if (!this.messageQueue) {
      return;
    }
    
    // デフォルトで全エージェントにブロードキャスト
    const targetQueues = targets.length > 0 
      ? targets.map(t => `poppo:${t}`)
      : ['poppo:ccla', 'poppo:ccag', 'poppo:ccpm', 'poppo:ccqa'];
    
    await this.messageQueue.broadcast(
      targetQueues,
      'BROADCAST_EVENT',
      event
    );
  }
  
  /**
   * イベント履歴の取得
   */
  async getEventHistory(filters = {}) {
    // TODO: イベント履歴の永続化と検索機能
    return {
      events: [],
      total: 0,
      filters
    };
  }
  
  /**
   * 統計情報の取得
   */
  getStats() {
    return {
      ...this.eventStats,
      subscriptions: this.subscriptions.size,
      eventTypes: this.eventNames().length
    };
  }
  
  /**
   * イベントIDの生成
   */
  generateEventId() {
    return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  /**
   * 購読IDの生成
   */
  generateSubscriptionId() {
    return `sub_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  /**
   * emit のオーバーライド（'*'イベントのサポート）
   */
  emit(eventType, ...args) {
    // 通常のイベント発行
    super.emit(eventType, ...args);
    
    // ワイルドカードイベントも発行
    if (eventType !== '*') {
      super.emit('*', eventType, ...args);
    }
    
    return true;
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    // 全購読の解除
    for (const subscriptionId of this.subscriptions.keys()) {
      this.unsubscribe(subscriptionId);
    }
    
    this.removeAllListeners();
    this.logger.info('イベントバスのクリーンアップ完了');
  }
}

module.exports = EventBus;