const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Logger = require('../../src/logger');
const { createAgentI18n } = require('./agent-i18n');

/**
 * Agent Base Class
 * All agents should inherit from this class
 */
class AgentBase extends EventEmitter {
  constructor(agentName, config = {}) {
    super();
    
    this.agentName = agentName;
    this.agentId = `${agentName}-${uuidv4().substring(0, 8)}`;
    this.config = config;
    this.logger = new Logger(agentName);
    
    // Initialize i18n system
    this.i18n = createAgentI18n(agentName, config.language || process.env.POPPO_LANGUAGE_PRIMARY || 'ja');
    
    // Message directories
    this.messageDir = path.join(__dirname, '../../messages', agentName.toLowerCase());
    this.inboxDir = path.join(this.messageDir, 'inbox');
    this.outboxDir = path.join(this.messageDir, 'outbox');
    
    // Agent state
    this.status = 'initializing';
    this.activeTasks = new Map();
    this.metrics = {
      tasksReceived: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      startTime: new Date()
    };
    
    // Polling configuration
    this.pollingInterval = config.pollingInterval || 5000; // 5 seconds
    this.pollingTimer = null;
    
    // Heartbeat configuration
    this.heartbeatInterval = config.heartbeatInterval || 30000; // 30 seconds
    this.heartbeatTimer = null;
  }
  
  /**
   * Initialize agent
   */
  async initialize() {
    try {
      // Initialize i18n first
      await this.i18n.init();
      
      this.logger.info(this.i18n.t('common.initializing', { agentName: this.agentName }));
      
      // Ensure message directories exist
      await this.ensureDirectories();
      
      // Subclass initialization
      await this.onInitialize();
      
      // Start message polling
      this.startPolling();
      
      // Start heartbeat
      this.startHeartbeat();
      
      this.status = 'running';
      this.logger.info(this.i18n.t('common.initialized', { agentName: this.agentName }));
      
      return true;
    } catch (error) {
      this.logger.error(this.i18n.t('common.error', { agentName: this.agentName, error: error.message }));
      this.status = 'error';
      throw error;
    }
  }
  
  /**
   * Ensure message directories exist
   */
  async ensureDirectories() {
    await fs.mkdir(this.inboxDir, { recursive: true });
    await fs.mkdir(this.outboxDir, { recursive: true });
  }
  
  /**
   * Start message polling
   */
  startPolling() {
    this.pollingTimer = setInterval(async () => {
      await this.checkMessages();
    }, this.pollingInterval);
    
    // Immediately perform first check
    this.checkMessages();
  }
  
  /**
   * Start heartbeat
   */
  startHeartbeat() {
    this.heartbeatTimer = setInterval(async () => {
      await this.sendHeartbeat();
    }, this.heartbeatInterval);
  }
  
  /**
   * 受信メッセージのチェック
   */
  async checkMessages() {
    try {
      const files = await fs.readdir(this.inboxDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      for (const file of jsonFiles) {
        const filePath = path.join(this.inboxDir, file);
        
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const message = JSON.parse(content);
          
          // メッセージ処理
          await this.handleMessage(message);
          
          // 処理済みメッセージを削除
          await fs.unlink(filePath);
          
        } catch (error) {
          this.logger.error(`メッセージ処理エラー (${file}): ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`メッセージチェックエラー: ${error.message}`);
    }
  }
  
  /**
   * メッセージの処理（ルーティング）
   */
  async handleMessage(message) {
    this.logger.info(`メッセージ受信: ${message.type} (${message.id})`);
    
    try {
      switch (message.type) {
        case 'TASK_ASSIGNMENT':
          await this.handleTaskAssignment(message);
          break;
          
        case 'TASK_CANCEL':
          await this.handleTaskCancel(message);
          break;
          
        case 'STATUS_REQUEST':
          await this.handleStatusRequest(message);
          break;
          
        default:
          // サブクラスで定義されたカスタムメッセージハンドラー
          await this.onMessage(message);
      }
    } catch (error) {
      this.logger.error(`メッセージ処理エラー: ${error.message}`);
      await this.sendErrorNotification(message, error);
    }
  }
  
  /**
   * タスク割り当ての処理
   */
  async handleTaskAssignment(message) {
    const { taskId, priority, deadline } = message;
    
    // タスク受諾メッセージを送信
    await this.sendMessage('core', {
      type: 'TASK_ACCEPTED',
      taskId,
      acceptedBy: this.agentName,
      estimatedDuration: this.estimateTaskDuration(message),
      startTime: new Date().toISOString()
    });
    
    // タスクを記録
    this.activeTasks.set(taskId, {
      message,
      startTime: new Date(),
      status: 'processing'
    });
    
    this.metrics.tasksReceived++;
    
    // サブクラスのタスク処理を実行
    try {
      const result = await this.processTask(message);
      
      // タスク完了メッセージを送信
      await this.sendMessage('core', {
        type: 'TASK_COMPLETED',
        taskId,
        agent: this.agentName,
        completionTime: new Date().toISOString(),
        result
      });
      
      this.activeTasks.delete(taskId);
      this.metrics.tasksCompleted++;
      
    } catch (error) {
      this.logger.error(`タスク処理エラー (${taskId}): ${error.message}`);
      
      // エラー通知を送信
      await this.sendErrorNotification(message, error);
      
      this.activeTasks.delete(taskId);
      this.metrics.tasksFailed++;
    }
  }
  
  /**
   * タスクキャンセルの処理
   */
  async handleTaskCancel(message) {
    const { taskId } = message;
    
    if (this.activeTasks.has(taskId)) {
      // サブクラスのキャンセル処理を呼び出し
      await this.onTaskCancel(taskId);
      
      this.activeTasks.delete(taskId);
      this.logger.info(`タスク ${taskId} をキャンセルしました`);
    }
  }
  
  /**
   * ステータスリクエストの処理
   */
  async handleStatusRequest(message) {
    await this.sendMessage(message.from || 'core', {
      type: 'STATUS_RESPONSE',
      agent: this.agentName,
      status: this.status,
      activeTasks: Array.from(this.activeTasks.keys()),
      metrics: this.metrics,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * ハートビートの送信
   */
  async sendHeartbeat() {
    const cpuUsage = process.cpuUsage();
    const memoryUsage = process.memoryUsage();
    
    await this.sendMessage('core', {
      type: 'HEARTBEAT',
      agent: this.agentName,
      status: this.status,
      timestamp: new Date().toISOString(),
      metrics: {
        cpuUsage: Math.round((cpuUsage.user + cpuUsage.system) / 1000000), // ミリ秒に変換
        memoryUsage: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MBに変換
        activeTasks: this.activeTasks.size,
        tasksCompleted: this.metrics.tasksCompleted,
        tasksFailed: this.metrics.tasksFailed,
        uptime: Math.round((new Date() - this.metrics.startTime) / 1000) // 秒に変換
      }
    });
  }
  
  /**
   * エラー通知の送信
   */
  async sendErrorNotification(originalMessage, error) {
    await this.sendMessage('core', {
      type: 'ERROR_NOTIFICATION',
      taskId: originalMessage.taskId,
      agent: this.agentName,
      errorCode: error.code || 'INTERNAL_ERROR',
      errorMessage: error.message,
      retryable: error.retryable !== false,
      timestamp: new Date().toISOString(),
      originalMessage
    });
  }
  
  /**
   * メッセージの送信
   */
  async sendMessage(recipient, message) {
    try {
      // メッセージIDとタイムスタンプを追加
      message.id = message.id || uuidv4();
      message.timestamp = message.timestamp || new Date().toISOString();
      message.from = this.agentName;
      message.to = recipient;
      
      // ファイル名の生成
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}_${message.id}_${message.type}.json`;
      
      // 送信先のinboxパス
      const recipientInbox = path.join(__dirname, '../../messages', recipient.toLowerCase(), 'inbox');
      const filePath = path.join(recipientInbox, filename);
      
      // メッセージを書き込み
      await fs.writeFile(filePath, JSON.stringify(message, null, 2));
      
      this.logger.debug(`メッセージ送信: ${message.type} → ${recipient}`);
      
    } catch (error) {
      this.logger.error(`メッセージ送信エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 進捗報告の送信
   */
  async reportProgress(taskId, progress, message, details = {}) {
    await this.sendMessage('core', {
      type: 'PROGRESS_UPDATE',
      taskId,
      agent: this.agentName,
      progress,
      status: 'processing',
      message,
      details,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * エージェントのシャットダウン
   */
  async shutdown() {
    this.logger.info(`エージェント ${this.agentName} をシャットダウン中...`);
    
    // ポーリングとハートビートを停止
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    
    // サブクラスのシャットダウン処理
    await this.onShutdown();
    
    this.status = 'stopped';
    this.logger.info(`エージェント ${this.agentName} のシャットダウン完了`);
  }
  
  // === サブクラスでオーバーライドするメソッド ===
  
  /**
   * 初期化時の処理（サブクラスで実装）
   */
  async onInitialize() {
    // サブクラスで実装
  }
  
  /**
   * タスク処理（サブクラスで実装）
   */
  async processTask(message) {
    throw new Error('processTask メソッドを実装してください');
  }
  
  /**
   * タスク実行時間の見積もり（サブクラスで実装）
   */
  estimateTaskDuration(message) {
    return 3600000; // デフォルト: 1時間
  }
  
  /**
   * カスタムメッセージハンドラー（サブクラスで実装）
   */
  async onMessage(message) {
    // サブクラスで必要に応じて実装
  }
  
  /**
   * タスクキャンセル時の処理（サブクラスで実装）
   */
  async onTaskCancel(taskId) {
    // サブクラスで必要に応じて実装
  }
  
  /**
   * シャットダウン時の処理（サブクラスで実装）
   */
  async onShutdown() {
    // サブクラスで必要に応じて実装
  }
}

module.exports = AgentBase;