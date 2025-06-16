const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Logger = require('../../src/logger');
const { spawn } = require('child_process');

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
        maxConcurrentTasks: 3
      },
      CCAG: {
        script: path.join(__dirname, '../ccag/index.js'),
        capabilities: ['generate-docs', 'create-comment', 'update-readme', 'translate-docs'],
        maxConcurrentTasks: 5
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
    
    // エージェントの起動
    await this.startAgents();
    
    // メッセージポーリング開始
    this.startPolling();
    
    this.logger.info('エージェントコーディネーターの初期化完了');
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
    for (const [agentName, config] of Object.entries(this.agentConfigs)) {
      try {
        await this.startAgent(agentName, config);
      } catch (error) {
        this.logger.error(`エージェント ${agentName} の起動に失敗: ${error.message}`);
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
    // 適切なエージェントを選択
    const agent = this.selectAgent(taskType);
    
    if (!agent) {
      throw new Error(`タスクタイプ ${taskType} に対応するエージェントが見つかりません`);
    }
    
    const task = {
      taskId,
      type: taskType,
      context,
      payload,
      status: 'pending',
      assignedTo: agent.name,
      createdAt: new Date()
    };
    
    this.activeTasks.set(taskId, task);
    this.stats.tasksAssigned++;
    
    // タスク割り当てメッセージを送信
    await this.sendMessage(agent.name, {
      type: 'TASK_ASSIGNMENT',
      taskId,
      issueNumber: context.issueNumber,
      assignedTo: agent.name,
      priority: context.priority || 'normal',
      taskType,
      deadline: new Date(Date.now() + 3600000).toISOString(), // 1時間後
      context,
      payload
    });
    
    this.logger.info(`タスク ${taskId} を ${agent.name} に割り当てました`);
    
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
   * シャットダウン
   */
  async shutdown() {
    this.logger.info('エージェントコーディネーターをシャットダウン中...');
    
    // ポーリングを停止
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
    }
    
    // すべてのエージェントを停止
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