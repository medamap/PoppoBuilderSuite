const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Logger = require('../../src/logger');
const { spawn } = require('child_process');
const AutoScaler = require('./auto-scaler');
const MetricsCollector = require('./metrics-collector');
const LoadBalancer = require('./load-balancer');
const LifecycleManager = require('../shared/lifecycle-manager');

/**
 * エージェントコーディネーター
 * 各エージェントの起動、管理、タスク振り分けを担当
 */
class AgentCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.logger = new Logger('AgentCoordinator');
    this.config = config;
    
    // エージェント管理
    this.agents = new Map();
    this.agentProcesses = new Map();
    
    // タスク管理
    this.activeTasks = new Map();
    this.taskQueue = [];
    
    // 動的スケーリングコンポーネント
    this.metricsCollector = new MetricsCollector(this.logger, config.metrics);
    this.autoScaler = new AutoScaler(this.logger, config.scaling);
    this.loadBalancer = new LoadBalancer(this.logger, config.loadBalancer);
    this.lifecycleManager = new LifecycleManager(this.logger, config.lifecycle);
    
    // メッセージディレクトリ
    this.messageDir = path.join(__dirname, '../../messages/core');
    this.inboxDir = path.join(this.messageDir, 'inbox');
    this.outboxDir = path.join(this.messageDir, 'outbox');
    
    // ポーリング設定
    this.pollingInterval = config.pollingInterval || 3000; // 3秒
    this.pollingTimer = null;
    
    // エージェント設定
    this.agentConfigs = {
      CCPM: {
        script: path.join(__dirname, '../ccpm/index.js'),
        capabilities: ['code-review', 'refactoring-suggestion', 'security-audit'],
        maxConcurrentTasks: 3,
        minInstances: 1,
        maxInstances: 5
      },
      CCAG: {
        script: path.join(__dirname, '../ccag/index.js'),
        capabilities: ['generate-docs', 'create-comment', 'update-readme', 'translate-docs'],
        maxConcurrentTasks: 5,
        minInstances: 1,
        maxInstances: 8
      },
      CCQA: {
        script: path.join(__dirname, '../ccqa/index.js'),
        capabilities: ['quality-assurance', 'test-execution', 'security-scan', 'performance-analysis'],
        maxConcurrentTasks: 2,
        minInstances: 1,
        maxInstances: 3
      },
      CCRA: {
        script: path.join(__dirname, '../ccra/index.js'),
        capabilities: ['pr-review', 'code-quality-check', 'security-audit', 'review-comment'],
        maxConcurrentTasks: 4,
        minInstances: 1,
        maxInstances: 5
      },
      CCTA: {
        script: path.join(__dirname, '../ccta/index.js'),
        capabilities: ['test-execution', 'coverage-report', 'performance-test', 'test-analysis'],
        maxConcurrentTasks: 2,
        minInstances: 1,
        maxInstances: 3
      }
    };
    
    // 統計情報
    this.stats = {
      tasksAssigned: 0,
      tasksCompleted: 0,
      tasksFailed: 0,
      startTime: new Date()
    };
  }
  
  /**
   * コーディネーターの初期化
   */
  async initialize() {
    this.logger.info('エージェントコーディネーターを初期化中...');
    
    // メッセージディレクトリの確認
    await this.ensureDirectories();
    
    // 動的スケーリングコンポーネントの初期化
    this.initializeDynamicScaling();
    
    // エージェントの起動
    await this.startAgents();
    
    // メッセージポーリング開始
    this.startPolling();
    
    this.logger.info('エージェントコーディネーターの初期化完了');
  }
  
  /**
   * 動的スケーリングコンポーネントの初期化
   */
  initializeDynamicScaling() {
    // MetricsCollectorの開始
    this.metricsCollector.start();
    
    // AutoScalerの設定
    this.autoScaler.setMetricsCollector(this.metricsCollector);
    this.autoScaler.on('scale-up', this.handleScaleUp.bind(this));
    this.autoScaler.on('scale-down', this.handleScaleDown.bind(this));
    this.autoScaler.start();
    
    // LoadBalancerの開始
    this.loadBalancer.start();
    
    // LifecycleManagerの開始
    this.lifecycleManager.on('agent-spawned', this.handleAgentSpawned.bind(this));
    this.lifecycleManager.on('agent-exit', this.handleAgentExit.bind(this));
    this.lifecycleManager.on('agent-failed', this.handleAgentFailed.bind(this));
    this.lifecycleManager.start();
    
    this.logger.info('動的スケーリングコンポーネントを初期化しました');
  }
  
  /**
   * メッセージディレクトリの確認・作成
   */
  async ensureDirectories() {
    await fs.mkdir(this.inboxDir, { recursive: true });
    await fs.mkdir(this.outboxDir, { recursive: true });
  }
  
  /**
   * エージェントの起動
   */
  async startAgents() {
    for (const [agentType, config] of Object.entries(this.agentConfigs)) {
      // 最小インスタンス数だけ起動
      for (let i = 0; i < config.minInstances; i++) {
        const agentId = `${agentType}-${Date.now()}-${i}`;
        try {
          await this.lifecycleManager.spawnAgent(agentId, {
            type: agentType,
            ...config
          });
          this.loadBalancer.registerAgent(agentId, {
            type: agentType,
            capabilities: config.capabilities,
            maxConcurrent: config.maxConcurrentTasks
          });
        } catch (error) {
          this.logger.error(`エージェント ${agentId} の起動に失敗: ${error.message}`);
        }
      }
    }
  }
  
  /**
   * 個別エージェントの起動
   */
  async startAgent(agentName, config) {
    this.logger.info(`エージェント ${agentName} を起動中...`);
    
    const agentProcess = spawn('node', [config.script], {
      env: { ...process.env, AGENT_NAME: agentName },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // 標準出力のログ
    agentProcess.stdout.on('data', (data) => {
      this.logger.debug(`[${agentName}] ${data.toString().trim()}`);
    });
    
    // エラー出力のログ
    agentProcess.stderr.on('data', (data) => {
      this.logger.error(`[${agentName}] ${data.toString().trim()}`);
    });
    
    // プロセス終了時の処理
    agentProcess.on('exit', (code) => {
      this.logger.warn(`エージェント ${agentName} が終了しました (code: ${code})`);
      this.agentProcesses.delete(agentName);
      this.agents.delete(agentName);
      
      // 自動再起動（エラー終了の場合）
      if (code !== 0 && this.config.autoRestart) {
        setTimeout(() => {
          this.startAgent(agentName, config).catch(err => {
            this.logger.error(`エージェント再起動失敗: ${err.message}`);
          });
        }, 5000);
      }
    });
    
    this.agentProcesses.set(agentName, agentProcess);
    this.agents.set(agentName, {
      name: agentName,
      config,
      status: 'initializing',
      activeTasks: 0,
      lastHeartbeat: new Date()
    });
    
    this.logger.info(`エージェント ${agentName} の起動完了`);
  }
  
  /**
   * メッセージポーリングの開始
   */
  startPolling() {
    this.pollingTimer = setInterval(async () => {
      await this.checkMessages();
      await this.processTaskQueue();
      await this.checkAgentHealth();
      await this.updateMetrics();
    }, this.pollingInterval);
    
    // 即座に最初のチェック
    this.checkMessages();
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
   * メッセージの処理
   */
  async handleMessage(message) {
    const { type, from } = message;
    
    this.logger.info(`メッセージ受信: ${type} from ${from}`);
    
    switch (type) {
      case 'HEARTBEAT':
        this.updateAgentStatus(from, message);
        break;
        
      case 'TASK_ACCEPTED':
        this.handleTaskAccepted(message);
        break;
        
      case 'PROGRESS_UPDATE':
        this.handleProgressUpdate(message);
        break;
        
      case 'TASK_COMPLETED':
        await this.handleTaskCompleted(message);
        break;
        
      case 'ERROR_NOTIFICATION':
        await this.handleErrorNotification(message);
        break;
        
      default:
        this.logger.warn(`未知のメッセージタイプ: ${type}`);
    }
  }
  
  /**
   * エージェントステータスの更新
   */
  updateAgentStatus(agentName, heartbeat) {
    const agent = this.agents.get(agentName);
    if (agent) {
      agent.status = heartbeat.status;
      agent.lastHeartbeat = new Date();
      agent.metrics = heartbeat.metrics;
      agent.activeTasks = heartbeat.metrics?.activeTasks || 0;
    }
  }
  
  /**
   * タスク受諾の処理
   */
  handleTaskAccepted(message) {
    const { taskId, acceptedBy, estimatedDuration } = message;
    const task = this.activeTasks.get(taskId);
    
    if (task) {
      task.status = 'accepted';
      task.assignedTo = acceptedBy;
      task.estimatedDuration = estimatedDuration;
      task.startTime = new Date();
      
      this.logger.info(`タスク ${taskId} が ${acceptedBy} に受諾されました`);
    }
  }
  
  /**
   * 進捗更新の処理
   */
  handleProgressUpdate(message) {
    const { taskId, progress, status, message: progressMessage } = message;
    const task = this.activeTasks.get(taskId);
    
    if (task) {
      task.progress = progress;
      task.status = status;
      task.lastUpdate = new Date();
      
      this.logger.info(`タスク ${taskId}: ${progressMessage} (${progress}%)`);
      
      // 外部へのイベント発火
      this.emit('task:progress', { taskId, progress, message: progressMessage });
    }
  }
  
  /**
   * タスク完了の処理
   */
  async handleTaskCompleted(message) {
    const { taskId, result } = message;
    const task = this.activeTasks.get(taskId);
    
    if (task) {
      task.status = 'completed';
      task.result = result;
      task.endTime = new Date();
      
      this.stats.tasksCompleted++;
      
      this.logger.info(`タスク ${taskId} が完了しました`);
      
      // 外部へのイベント発火
      this.emit('task:completed', { taskId, task, result });
      
      // タスクをアクティブリストから削除
      this.activeTasks.delete(taskId);
    }
  }
  
  /**
   * エラー通知の処理
   */
  async handleErrorNotification(message) {
    const { taskId, errorCode, errorMessage, retryable } = message;
    const task = this.activeTasks.get(taskId);
    
    if (task) {
      task.status = 'error';
      task.error = { code: errorCode, message: errorMessage };
      
      this.stats.tasksFailed++;
      
      this.logger.error(`タスク ${taskId} でエラー: ${errorMessage}`);
      
      if (retryable && task.retryCount < 3) {
        // リトライ
        task.retryCount = (task.retryCount || 0) + 1;
        this.logger.info(`タスク ${taskId} をリトライします (${task.retryCount}/3)`);
        
        // タスクをキューに戻す
        this.taskQueue.push(task);
        this.activeTasks.delete(taskId);
      } else {
        // 外部へのエラーイベント発火
        this.emit('task:error', { taskId, task, error: task.error });
        this.activeTasks.delete(taskId);
      }
    }
  }
  
  /**
   * タスクの割り当て
   */
  async assignTask(taskId, taskType, context, payload) {
    // LoadBalancerを使用してエージェントを選択
    const agentId = await this.loadBalancer.selectAgent({ type: taskType }, context.sessionId);
    
    if (!agentId) {
      throw new Error(`タスクタイプ ${taskType} に対応するエージェントが見つかりません`);
    }
    
    const task = {
      taskId,
      type: taskType,
      context,
      payload,
      status: 'pending',
      assignedTo: agentId,
      createdAt: new Date()
    };
    
    this.activeTasks.set(taskId, task);
    this.stats.tasksAssigned++;
    
    // LoadBalancerの負荷を増加
    this.loadBalancer.incrementLoad(agentId);
    
    // タスク割り当てメッセージを送信
    await this.sendMessage(agentId, {
      type: 'TASK_ASSIGNMENT',
      taskId,
      issueNumber: context.issueNumber,
      assignedTo: agentId,
      priority: context.priority || 'normal',
      taskType,
      deadline: new Date(Date.now() + 3600000).toISOString(), // 1時間後
      context,
      payload
    });
    
    this.logger.info(`タスク ${taskId} を ${agentId} に割り当てました`);
    
    return task;
  }
  
  /**
   * エージェントの選択
   */
  selectAgent(taskType) {
    // タスクタイプに対応するエージェントを探す
    for (const [agentName, agentInfo] of this.agents.entries()) {
      const config = this.agentConfigs[agentName];
      
      if (config.capabilities.includes(taskType)) {
        // エージェントが健全で、キャパシティに余裕があるか確認
        if (agentInfo.status === 'running' && 
            agentInfo.activeTasks < config.maxConcurrentTasks) {
          return agentInfo;
        }
      }
    }
    
    return null;
  }
  
  /**
   * タスクキューの処理
   */
  async processTaskQueue() {
    if (this.taskQueue.length === 0) return;
    
    const pendingTasks = [...this.taskQueue];
    this.taskQueue = [];
    
    for (const task of pendingTasks) {
      const agent = this.selectAgent(task.type);
      
      if (agent) {
        // タスクを再割り当て
        await this.assignTask(
          task.taskId,
          task.type,
          task.context,
          task.payload
        );
      } else {
        // エージェントが利用できない場合は、キューに戻す
        this.taskQueue.push(task);
      }
    }
  }
  
  /**
   * エージェントの健全性チェック
   */
  async checkAgentHealth() {
    const now = new Date();
    const heartbeatTimeout = 60000; // 1分
    
    for (const [agentName, agentInfo] of this.agents.entries()) {
      const timeSinceLastHeartbeat = now - agentInfo.lastHeartbeat;
      
      if (timeSinceLastHeartbeat > heartbeatTimeout) {
        this.logger.warn(`エージェント ${agentName} からのハートビートが途絶えています`);
        agentInfo.status = 'unresponsive';
        
        // エージェントプロセスが生きているか確認
        const process = this.agentProcesses.get(agentName);
        if (process && !process.killed) {
          // プロセスを再起動
          this.logger.info(`エージェント ${agentName} を再起動します`);
          process.kill();
        }
      }
    }
  }
  
  /**
   * メッセージの送信
   */
  async sendMessage(recipient, message) {
    try {
      // メッセージIDとタイムスタンプを追加
      message.id = message.id || uuidv4();
      message.timestamp = message.timestamp || new Date().toISOString();
      message.from = 'core';
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
   * 統計情報の取得
   */
  getStats() {
    const agents = Array.from(this.agents.values()).map(agent => ({
      name: agent.name,
      status: agent.status,
      activeTasks: agent.activeTasks,
      lastHeartbeat: agent.lastHeartbeat,
      metrics: agent.metrics
    }));
    
    return {
      agents,
      tasks: {
        active: this.activeTasks.size,
        queued: this.taskQueue.length,
        assigned: this.stats.tasksAssigned,
        completed: this.stats.tasksCompleted,
        failed: this.stats.tasksFailed
      },
      uptime: new Date() - this.stats.startTime
    };
  }
  
  /**
   * メトリクスの更新
   */
  async updateMetrics() {
    // タスクキューのメトリクス更新
    this.metricsCollector.updateTaskQueueMetrics({
      size: this.taskQueue.length,
      pending: this.taskQueue.length,
      processing: this.activeTasks.size,
      completed: this.stats.tasksCompleted,
      failed: this.stats.tasksFailed
    });
    
    // エージェントメトリクスの更新
    for (const [agentId, agentInfo] of this.agents.entries()) {
      this.metricsCollector.updateAgentMetrics(agentId, {
        status: agentInfo.status,
        tasksProcessed: agentInfo.metrics?.tasksProcessed || 0,
        errors: agentInfo.metrics?.errors || 0,
        uptime: Date.now() - agentInfo.lastHeartbeat,
        lastActivity: agentInfo.lastHeartbeat
      });
    }
  }
  
  /**
   * スケールアップハンドラー
   */
  async handleScaleUp(event) {
    const { increment, total, reason } = event;
    this.logger.info(`スケールアップ: ${increment} エージェント追加 (合計: ${total}), 理由: ${reason}`);
    
    // 各タイプのエージェントを比例的に増加
    for (const [agentType, config] of Object.entries(this.agentConfigs)) {
      const currentCount = Array.from(this.agents.values())
        .filter(a => a.type === agentType).length;
      const maxAllowed = config.maxInstances - currentCount;
      const toAdd = Math.min(Math.ceil(increment / 3), maxAllowed);
      
      for (let i = 0; i < toAdd; i++) {
        const agentId = `${agentType}-${Date.now()}-${i}`;
        try {
          await this.lifecycleManager.spawnAgent(agentId, {
            type: agentType,
            ...config
          });
        } catch (error) {
          this.logger.error(`エージェント ${agentId} のスケールアップ失敗: ${error.message}`);
        }
      }
    }
  }
  
  /**
   * スケールダウンハンドラー
   */
  async handleScaleDown(event) {
    const { decrement, total, reason } = event;
    this.logger.info(`スケールダウン: ${decrement} エージェント削減 (合計: ${total}), 理由: ${reason}`);
    
    // 各タイプのエージェントを比例的に削減
    const agentsByType = new Map();
    for (const [agentId, agentInfo] of this.agents.entries()) {
      const type = agentInfo.type;
      if (!agentsByType.has(type)) {
        agentsByType.set(type, []);
      }
      agentsByType.get(type).push(agentId);
    }
    
    for (const [agentType, agentIds] of agentsByType.entries()) {
      const config = this.agentConfigs[agentType];
      const currentCount = agentIds.length;
      const minRequired = config.minInstances;
      const toRemove = Math.min(Math.ceil(decrement / 3), currentCount - minRequired);
      
      for (let i = 0; i < toRemove; i++) {
        const agentId = agentIds[i];
        try {
          await this.lifecycleManager.terminateAgent(agentId, false);
          this.loadBalancer.unregisterAgent(agentId);
        } catch (error) {
          this.logger.error(`エージェント ${agentId} のスケールダウン失敗: ${error.message}`);
        }
      }
    }
  }
  
  /**
   * エージェント生成ハンドラー
   */
  handleAgentSpawned(event) {
    const { agentId, pid } = event;
    const agentInfo = this.lifecycleManager.getAgentStatus(agentId);
    
    if (agentInfo) {
      this.agents.set(agentId, {
        id: agentId,
        type: agentInfo.type,
        status: 'initializing',
        pid,
        activeTasks: 0,
        lastHeartbeat: new Date()
      });
      
      this.loadBalancer.registerAgent(agentId, {
        type: agentInfo.type,
        capabilities: this.agentConfigs[agentInfo.type]?.capabilities || [],
        maxConcurrent: this.agentConfigs[agentInfo.type]?.maxConcurrentTasks || 5
      });
    }
  }
  
  /**
   * エージェント終了ハンドラー
   */
  handleAgentExit(event) {
    const { agentId, code, signal } = event;
    
    this.agents.delete(agentId);
    this.loadBalancer.unregisterAgent(agentId);
    
    // 割り当て済みタスクを再配置
    for (const [taskId, task] of this.activeTasks.entries()) {
      if (task.assignedTo === agentId) {
        this.logger.warn(`エージェント ${agentId} の終了により、タスク ${taskId} を再配置します`);
        this.taskQueue.push(task);
        this.activeTasks.delete(taskId);
      }
    }
  }
  
  /**
   * エージェント失敗ハンドラー
   */
  handleAgentFailed(event) {
    const { agentId, error } = event;
    this.logger.error(`エージェント ${agentId} が失敗しました: ${error?.message || 'Unknown error'}`);
    
    // メトリクスにエラーを記録
    this.metricsCollector.recordError(new Error(`Agent failed: ${agentId}`), {
      agentId,
      severity: 'critical'
    });
  }
  
  /**
   * シャットダウン
   */
  async shutdown() {
    this.logger.info('エージェントコーディネーターをシャットダウン中...');
    
    // ポーリングを停止
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    
    // 動的スケーリングコンポーネントを停止
    this.metricsCollector.stop();
    this.autoScaler.stop();
    this.loadBalancer.stop();
    this.lifecycleManager.stop();
    
    // すべてのエージェントを停止
    await this.lifecycleManager.terminateAllAgents(false);
    
    // すべてのエージェントを停止（レガシー）
    for (const [agentName, process] of this.agentProcesses.entries()) {
      this.logger.info(`エージェント ${agentName} を停止中...`);
      process.kill('SIGINT');
    }
    
    // プロセス終了を待つ
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    this.logger.info('エージェントコーディネーターのシャットダウン完了');
  }
}

module.exports = AgentCoordinator;