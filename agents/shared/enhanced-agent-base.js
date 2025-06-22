const AgentBase = require('./agent-base');
const { CompatibilityLayer, EventBus } = require('./messaging');
const Logger = require('../../src/logger');

/**
 * 拡張エージェント基盤クラス
 * メッセージキューとイベント駆動アーキテクチャをサポート
 */
class EnhancedAgentBase extends AgentBase {
  constructor(agentName, config = {}) {
    super(agentName, config);
    
    // メッセージングモード設定
    this.messagingConfig = {
      mode: config.messagingMode || process.env.MESSAGING_MODE || 'hybrid',
      redis: config.redis || {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      },
      enableEvents: config.enableEvents !== false,
      ...config.messaging
    };
    
    // 互換性レイヤーとイベントバス
    this.compatibilityLayer = null;
    this.eventBus = null;
    
    // 拡張メトリクス
    this.extendedMetrics = {
      messagesQueued: 0,
      eventsPublished: 0,
      eventsConsumed: 0,
      queueLatency: []
    };
  }
  
  /**
   * エージェントの初期化（オーバーライド）
   */
  async initialize() {
    try {
      this.logger.info(`拡張エージェント ${this.agentName} を初期化中...`);
      
      // 互換性レイヤーの初期化
      this.compatibilityLayer = new CompatibilityLayer({
        ...this.messagingConfig,
        messageDir: this.messageDir
      });
      await this.compatibilityLayer.initialize();
      
      // イベントバスの初期化
      if (this.messagingConfig.enableEvents) {
        this.eventBus = new EventBus(this.messagingConfig);
        await this.eventBus.initialize(this.compatibilityLayer.messageQueue);
        
        // デフォルトイベントハンドラーの設定
        this.setupDefaultEventHandlers();
      }
      
      // メッセージハンドラーの登録
      await this.registerMessageHandlers();
      
      // 親クラスの初期化をスキップ（重複を避ける）
      // サブクラスの初期化処理のみ実行
      await this.onInitialize();
      
      // ハートビート開始
      this.startHeartbeat();
      
      // 初期化完了イベント
      await this.publishEvent('AGENT_STATE_CHANGED', {
        agent: this.agentName,
        previousState: 'initializing',
        newState: 'running',
        reason: 'initialization-complete'
      });
      
      this.status = 'running';
      this.logger.info(`拡張エージェント ${this.agentName} の初期化完了`);
      
      return true;
    } catch (error) {
      this.logger.error(`拡張エージェント初期化エラー: ${error.message}`);
      this.status = 'error';
      
      // エラーイベントの発行
      await this.publishEvent('ERROR_OCCURRED', {
        errorCode: 'AGENT_INIT_FAILED',
        errorMessage: error.message,
        source: {
          agent: this.agentName,
          task: 'initialization'
        },
        severity: 'critical',
        retryable: true,
        timestamp: new Date().toISOString()
      });
      
      throw error;
    }
  }
  
  /**
   * メッセージハンドラーの登録
   */
  async registerMessageHandlers() {
    // 基本メッセージタイプのハンドラー
    const handlers = {
      'TASK_ASSIGNMENT': this.handleTaskAssignment.bind(this),
      'TASK_CANCEL': this.handleTaskCancel.bind(this),
      'STATUS_REQUEST': this.handleStatusRequest.bind(this),
      'BROADCAST_EVENT': this.handleBroadcastEvent.bind(this)
    };
    
    // 各ハンドラーを登録
    for (const [messageType, handler] of Object.entries(handlers)) {
      await this.compatibilityLayer.registerMessageHandler(
        this.agentName,
        messageType,
        handler
      );
    }
    
    // カスタムメッセージハンドラー（サブクラス用）
    await this.compatibilityLayer.registerMessageHandler(
      this.agentName,
      '*',
      async (message) => {
        // 既知のタイプはスキップ
        if (!handlers[message.type]) {
          await this.onMessage(message);
        }
      }
    );
  }
  
  /**
   * デフォルトイベントハンドラーの設定
   */
  setupDefaultEventHandlers() {
    // エラーイベントの購読
    this.subscribeEvent('ERROR_OCCURRED', async (event) => {
      if (event.payload.severity === 'critical' && event.payload.source.agent !== this.agentName) {
        this.logger.error(`クリティカルエラー検知: ${event.payload.errorMessage}`);
      }
    });
    
    // システムイベントの購読
    this.subscribeEvent('SYSTEM_EVENT', async (event) => {
      if (event.payload.event === 'shutdown') {
        this.logger.info('システムシャットダウンイベントを受信');
        await this.shutdown();
      }
    });
  }
  
  /**
   * タスク割り当ての処理（拡張版）
   */
  async handleTaskAssignment(message) {
    const { taskId, priority, deadline } = message;
    const startTime = Date.now();
    
    try {
      // タスク受諾メッセージ
      await this.sendMessage('core', {
        type: 'TASK_ACCEPTED',
        taskId,
        acceptedBy: this.agentName,
        estimatedDuration: this.estimateTaskDuration(message),
        startTime: new Date().toISOString()
      });
      
      // タスク開始イベント
      await this.publishEvent('TASK_PROGRESS', {
        taskId,
        taskType: message.taskType,
        progress: 0,
        milestone: 'started',
        estimatedTimeRemaining: this.estimateTaskDuration(message)
      });
      
      // タスクを記録
      this.activeTasks.set(taskId, {
        message,
        startTime: new Date(),
        status: 'processing'
      });
      
      this.metrics.tasksReceived++;
      this.extendedMetrics.messagesQueued++;
      
      // サブクラスのタスク処理を実行
      const result = await this.processTask(message);
      
      const processingTime = Date.now() - startTime;
      
      // タスク完了メッセージ
      await this.sendMessage('core', {
        type: 'TASK_COMPLETED',
        taskId,
        agent: this.agentName,
        completionTime: new Date().toISOString(),
        processingTime,
        result
      });
      
      // タスク完了イベント
      await this.publishEvent('TASK_PROGRESS', {
        taskId,
        taskType: message.taskType,
        progress: 100,
        milestone: 'completed',
        estimatedTimeRemaining: 0,
        details: { processingTime }
      });
      
      this.activeTasks.delete(taskId);
      this.metrics.tasksCompleted++;
      
      // レイテンシ記録
      this.extendedMetrics.queueLatency.push(processingTime);
      if (this.extendedMetrics.queueLatency.length > 100) {
        this.extendedMetrics.queueLatency.shift();
      }
      
    } catch (error) {
      this.logger.error(`タスク処理エラー (${taskId}): ${error.message}`);
      
      // エラーイベント
      await this.publishEvent('ERROR_OCCURRED', {
        errorCode: error.code || 'TASK_PROCESSING_ERROR',
        errorMessage: error.message,
        errorStack: error.stack,
        source: {
          agent: this.agentName,
          task: taskId,
          context: message
        },
        severity: 'high',
        retryable: error.retryable !== false,
        timestamp: new Date().toISOString()
      });
      
      // エラー通知を送信
      await this.sendErrorNotification(message, error);
      
      this.activeTasks.delete(taskId);
      this.metrics.tasksFailed++;
    }
  }
  
  /**
   * ブロードキャストイベントの処理
   */
  async handleBroadcastEvent(message) {
    const event = message.payload;
    
    if (this.eventBus) {
      // ローカルイベントとして再発行
      this.eventBus.emit(event.type, event);
    }
  }
  
  /**
   * メッセージの送信（拡張版）
   */
  async sendMessage(recipient, message) {
    // 互換性レイヤーを使用
    return await this.compatibilityLayer.sendMessage(recipient, message);
  }
  
  /**
   * イベントの発行
   */
  async publishEvent(eventType, payload, options = {}) {
    if (!this.eventBus) {
      return;
    }
    
    this.extendedMetrics.eventsPublished++;
    
    return await this.eventBus.publish(eventType, payload, {
      source: this.agentName,
      ...options
    });
  }
  
  /**
   * イベントの購読
   */
  subscribeEvent(eventType, handler, options = {}) {
    if (!this.eventBus) {
      return () => {};
    }
    
    const wrappedHandler = async (event) => {
      this.extendedMetrics.eventsConsumed++;
      await handler(event);
    };
    
    return this.eventBus.subscribe(eventType, wrappedHandler, options);
  }
  
  /**
   * パターンによるイベント購読
   */
  subscribeEventPattern(pattern, handler, options = {}) {
    if (!this.eventBus) {
      return () => {};
    }
    
    return this.eventBus.subscribePattern(pattern, handler, options);
  }
  
  /**
   * 進捗報告の送信（拡張版）
   */
  async reportProgress(taskId, progress, message, details = {}) {
    // 通常のメッセージ送信
    await super.reportProgress(taskId, progress, message, details);
    
    // イベントも発行
    await this.publishEvent('TASK_PROGRESS', {
      taskId,
      progress,
      milestone: message,
      details
    });
  }
  
  /**
   * ハートビートの送信（拡張版）
   */
  async sendHeartbeat() {
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    
    const metrics = {
      cpuUsage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000),
      memoryUsage: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      activeTasks: this.activeTasks.size,
      tasksCompleted: this.metrics.tasksCompleted,
      tasksFailed: this.metrics.tasksFailed,
      uptime: Math.round((new Date() - this.metrics.startTime) / 1000),
      // 拡張メトリクス
      messagesQueued: this.extendedMetrics.messagesQueued,
      eventsPublished: this.extendedMetrics.eventsPublished,
      eventsConsumed: this.extendedMetrics.eventsConsumed,
      avgQueueLatency: this.calculateAverageLatency()
    };
    
    // ハートビートメッセージ
    await this.sendMessage('core', {
      type: 'HEARTBEAT',
      agent: this.agentName,
      status: this.status,
      timestamp: new Date().toISOString(),
      metrics
    });
    
    // ハートビートイベント
    await this.publishEvent('AGENT_HEARTBEAT', {
      agent: this.agentName,
      status: this.status,
      metrics
    });
  }
  
  /**
   * 平均レイテンシの計算
   */
  calculateAverageLatency() {
    const latencies = this.extendedMetrics.queueLatency;
    if (latencies.length === 0) return 0;
    
    const sum = latencies.reduce((a, b) => a + b, 0);
    return Math.round(sum / latencies.length);
  }
  
  /**
   * 統計情報の取得（拡張版）
   */
  async getStats() {
    const baseStats = {
      agent: this.agentName,
      status: this.status,
      metrics: {
        ...this.metrics,
        ...this.extendedMetrics
      }
    };
    
    // メッセージキューの統計
    if (this.compatibilityLayer) {
      baseStats.messaging = await this.compatibilityLayer.getStats();
    }
    
    // イベントバスの統計
    if (this.eventBus) {
      baseStats.events = this.eventBus.getStats();
    }
    
    return baseStats;
  }
  
  /**
   * エージェントのシャットダウン（拡張版）
   */
  async shutdown() {
    this.logger.info(`拡張エージェント ${this.agentName} をシャットダウン中...`);
    
    // シャットダウンイベント
    await this.publishEvent('AGENT_STATE_CHANGED', {
      agent: this.agentName,
      previousState: this.status,
      newState: 'stopping',
      reason: 'shutdown-requested'
    });
    
    // 親クラスのシャットダウン処理
    await super.shutdown();
    
    // 互換性レイヤーのクリーンアップ
    if (this.compatibilityLayer) {
      await this.compatibilityLayer.cleanup();
    }
    
    // イベントバスのクリーンアップ
    if (this.eventBus) {
      await this.eventBus.cleanup();
    }
    
    this.logger.info(`拡張エージェント ${this.agentName} のシャットダウン完了`);
  }
  
  // === ファイルベースメソッドのオーバーライド（非推奨） ===
  
  /**
   * メッセージポーリングの開始（無効化）
   */
  startPolling() {
    // メッセージキューを使用するため、ファイルポーリングは不要
    this.logger.debug('ファイルポーリングはスキップ（メッセージキュー使用）');
  }
  
  /**
   * 受信メッセージのチェック（無効化）
   */
  async checkMessages() {
    // 互換性レイヤーが処理するため不要
  }
}

module.exports = EnhancedAgentBase;