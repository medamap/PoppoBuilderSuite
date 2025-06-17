const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const { createLogger } = require('./logger');

/**
 * グローバルキューマネージャー
 * 複数のプロジェクトからのタスクを統一管理する
 */
class GlobalQueueManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = createLogger('GlobalQueueManager');
    
    // 設定
    this.config = {
      dataDir: config.dataDir || path.join(process.env.HOME, '.poppo-builder'),
      queueFile: 'global-queue.json',
      projectsFile: 'projects.json',
      maxQueueSize: config.maxQueueSize || 1000,
      maxConcurrentTasks: config.maxConcurrentTasks || 5,
      pollInterval: config.pollInterval || 1000,
      ...config
    };
    
    // データファイルのパス
    this.queuePath = path.join(this.config.dataDir, this.config.queueFile);
    this.projectsPath = path.join(this.config.dataDir, this.config.projectsFile);
    
    // 内部状態
    this.queue = [];
    this.projects = new Map();
    this.runningTasks = new Map();
    this.statistics = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      byProject: {},
      byPriority: {}
    };
    
    this.isRunning = false;
    this.pollTimer = null;
  }
  
  /**
   * グローバルキューマネージャーを初期化
   */
  async initialize() {
    try {
      // データディレクトリの作成
      await fs.mkdir(this.config.dataDir, { recursive: true });
      
      // 既存のキューとプロジェクトを読み込み
      await this.loadQueue();
      await this.loadProjects();
      
      this.logger.info('グローバルキューマネージャーを初期化しました', {
        dataDir: this.config.dataDir,
        queueSize: this.queue.length,
        projects: this.projects.size
      });
      
      return true;
    } catch (error) {
      this.logger.error('初期化エラー:', error);
      throw error;
    }
  }
  
  /**
   * プロジェクトを登録
   */
  async registerProject(projectInfo) {
    const { id, name, path: projectPath, priority = 50, config = {} } = projectInfo;
    
    if (!id || !name || !projectPath) {
      throw new Error('プロジェクトID、名前、パスは必須です');
    }
    
    const project = {
      id,
      name,
      path: projectPath,
      priority,
      config,
      registeredAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      statistics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageExecutionTime: 0
      }
    };
    
    this.projects.set(id, project);
    await this.saveProjects();
    
    this.logger.info('プロジェクトを登録しました', { project });
    this.emit('projectRegistered', project);
    
    return project;
  }
  
  /**
   * プロジェクトを削除
   */
  async unregisterProject(projectId) {
    if (!this.projects.has(projectId)) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    // そのプロジェクトのタスクをキューから削除
    this.queue = this.queue.filter(task => task.projectId !== projectId);
    await this.saveQueue();
    
    const project = this.projects.get(projectId);
    this.projects.delete(projectId);
    await this.saveProjects();
    
    this.logger.info('プロジェクトを削除しました', { projectId });
    this.emit('projectUnregistered', project);
    
    return project;
  }
  
  /**
   * タスクをキューに追加
   */
  async enqueueTask(task) {
    const { projectId, issueNumber, priority = 50, metadata = {} } = task;
    
    if (!projectId || !issueNumber) {
      throw new Error('プロジェクトIDとIssue番号は必須です');
    }
    
    if (!this.projects.has(projectId)) {
      throw new Error(`プロジェクト ${projectId} が登録されていません`);
    }
    
    if (this.queue.length >= this.config.maxQueueSize) {
      throw new Error('キューが満杯です');
    }
    
    const project = this.projects.get(projectId);
    const effectivePriority = this.calculateEffectivePriority(priority, project.priority);
    
    const queuedTask = {
      id: `${projectId}-${issueNumber}-${Date.now()}`,
      projectId,
      issueNumber,
      priority,
      effectivePriority,
      metadata,
      status: 'queued',
      enqueuedAt: new Date().toISOString(),
      attempts: 0
    };
    
    // 優先度順に挿入
    const insertIndex = this.queue.findIndex(t => t.effectivePriority < effectivePriority);
    if (insertIndex === -1) {
      this.queue.push(queuedTask);
    } else {
      this.queue.splice(insertIndex, 0, queuedTask);
    }
    
    await this.saveQueue();
    
    // 統計更新
    this.statistics.totalEnqueued++;
    this.updateProjectStatistics(projectId, 'enqueued');
    
    this.logger.info('タスクをキューに追加しました', { task: queuedTask });
    this.emit('taskEnqueued', queuedTask);
    
    return queuedTask;
  }
  
  /**
   * 次のタスクを取得（プロジェクト別）
   */
  async getNextTask(projectId) {
    const taskIndex = this.queue.findIndex(
      task => task.projectId === projectId && task.status === 'queued'
    );
    
    if (taskIndex === -1) {
      return null;
    }
    
    const task = this.queue[taskIndex];
    task.status = 'processing';
    task.startedAt = new Date().toISOString();
    
    this.runningTasks.set(task.id, task);
    await this.saveQueue();
    
    this.logger.info('タスクを処理開始', { task });
    this.emit('taskStarted', task);
    
    return task;
  }
  
  /**
   * タスクを完了
   */
  async completeTask(taskId, result = {}) {
    const taskIndex = this.queue.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      throw new Error(`タスク ${taskId} が見つかりません`);
    }
    
    const task = this.queue[taskIndex];
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = result;
    
    // キューから削除
    this.queue.splice(taskIndex, 1);
    this.runningTasks.delete(taskId);
    await this.saveQueue();
    
    // 統計更新
    this.statistics.totalProcessed++;
    this.updateProjectStatistics(task.projectId, 'completed');
    
    this.logger.info('タスクを完了しました', { task });
    this.emit('taskCompleted', task);
    
    return task;
  }
  
  /**
   * タスクを失敗
   */
  async failTask(taskId, error) {
    const taskIndex = this.queue.findIndex(t => t.id === taskId);
    if (taskIndex === -1) {
      throw new Error(`タスク ${taskId} が見つかりません`);
    }
    
    const task = this.queue[taskIndex];
    task.attempts++;
    
    if (task.attempts >= 3) {
      // 最大リトライ回数に達した場合
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.error = error.message || error;
      
      // キューから削除
      this.queue.splice(taskIndex, 1);
      this.runningTasks.delete(taskId);
      
      // 統計更新
      this.statistics.totalFailed++;
      this.updateProjectStatistics(task.projectId, 'failed');
      
      this.logger.error('タスクが失敗しました', { task, error });
      this.emit('taskFailed', task);
    } else {
      // リトライ可能な場合
      task.status = 'queued';
      task.lastError = error.message || error;
      this.runningTasks.delete(taskId);
      
      this.logger.warn('タスクをリトライします', { task, attempt: task.attempts });
      this.emit('taskRetry', task);
    }
    
    await this.saveQueue();
    return task;
  }
  
  /**
   * 効果的な優先度を計算
   */
  calculateEffectivePriority(taskPriority, projectPriority) {
    // タスク優先度（0-100）とプロジェクト優先度（0-100）を組み合わせる
    // プロジェクト優先度を重視（70%）、タスク優先度（30%）
    return Math.round(projectPriority * 0.7 + taskPriority * 0.3);
  }
  
  /**
   * プロジェクト統計を更新
   */
  updateProjectStatistics(projectId, event) {
    if (!this.statistics.byProject[projectId]) {
      this.statistics.byProject[projectId] = {
        enqueued: 0,
        completed: 0,
        failed: 0
      };
    }
    
    switch (event) {
      case 'enqueued':
        this.statistics.byProject[projectId].enqueued++;
        break;
      case 'completed':
        this.statistics.byProject[projectId].completed++;
        break;
      case 'failed':
        this.statistics.byProject[projectId].failed++;
        break;
    }
  }
  
  /**
   * キューを保存
   */
  async saveQueue() {
    try {
      await fs.writeFile(
        this.queuePath,
        JSON.stringify({ queue: this.queue, statistics: this.statistics }, null, 2)
      );
    } catch (error) {
      this.logger.error('キューの保存に失敗しました:', error);
    }
  }
  
  /**
   * キューを読み込み
   */
  async loadQueue() {
    try {
      const data = await fs.readFile(this.queuePath, 'utf-8');
      const parsed = JSON.parse(data);
      this.queue = parsed.queue || [];
      this.statistics = parsed.statistics || this.statistics;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('キューの読み込みに失敗しました:', error);
      }
    }
  }
  
  /**
   * プロジェクトを保存
   */
  async saveProjects() {
    try {
      const projects = Array.from(this.projects.entries()).map(([id, project]) => ({
        ...project,
        id
      }));
      await fs.writeFile(this.projectsPath, JSON.stringify(projects, null, 2));
    } catch (error) {
      this.logger.error('プロジェクトの保存に失敗しました:', error);
    }
  }
  
  /**
   * プロジェクトを読み込み
   */
  async loadProjects() {
    try {
      const data = await fs.readFile(this.projectsPath, 'utf-8');
      const projects = JSON.parse(data);
      projects.forEach(project => {
        this.projects.set(project.id, project);
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('プロジェクトの読み込みに失敗しました:', error);
      }
    }
  }
  
  /**
   * キューの状態を取得
   */
  getQueueStatus() {
    return {
      queueSize: this.queue.length,
      runningTasks: this.runningTasks.size,
      projects: this.projects.size,
      statistics: this.statistics,
      tasksByProject: this.getTasksByProject(),
      tasksByStatus: this.getTasksByStatus()
    };
  }
  
  /**
   * プロジェクト別のタスク数を取得
   */
  getTasksByProject() {
    const byProject = {};
    this.queue.forEach(task => {
      if (!byProject[task.projectId]) {
        byProject[task.projectId] = {
          queued: 0,
          processing: 0
        };
      }
      byProject[task.projectId][task.status]++;
    });
    return byProject;
  }
  
  /**
   * ステータス別のタスク数を取得
   */
  getTasksByStatus() {
    const byStatus = {
      queued: 0,
      processing: 0
    };
    this.queue.forEach(task => {
      byStatus[task.status]++;
    });
    return byStatus;
  }
  
  /**
   * タイムアウトしたタスクをチェック
   */
  async checkTimeouts() {
    const now = Date.now();
    const timeout = 30 * 60 * 1000; // 30分
    
    for (const [taskId, task] of this.runningTasks) {
      const startTime = new Date(task.startedAt).getTime();
      if (now - startTime > timeout) {
        this.logger.warn('タスクがタイムアウトしました', { taskId });
        await this.failTask(taskId, new Error('タスクがタイムアウトしました'));
      }
    }
  }
  
  /**
   * 定期的なメンテナンス
   */
  async performMaintenance() {
    // タイムアウトチェック
    await this.checkTimeouts();
    
    // 統計情報の保存
    await this.saveQueue();
    
    // プロジェクトの最終活動時刻を更新
    for (const [projectId, project] of this.projects) {
      const hasRecentTask = this.queue.some(
        task => task.projectId === projectId && 
        new Date(task.enqueuedAt).getTime() > Date.now() - 24 * 60 * 60 * 1000
      );
      if (hasRecentTask) {
        project.lastActivity = new Date().toISOString();
      }
    }
  }
  
  /**
   * キューマネージャーを開始
   */
  async start() {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    this.logger.info('グローバルキューマネージャーを開始しました');
    
    // 定期的なメンテナンス
    this.pollTimer = setInterval(() => {
      this.performMaintenance().catch(error => {
        this.logger.error('メンテナンスエラー:', error);
      });
    }, this.config.pollInterval);
    
    this.emit('started');
  }
  
  /**
   * キューマネージャーを停止
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
    await this.saveQueue();
    await this.saveProjects();
    
    this.logger.info('グローバルキューマネージャーを停止しました');
    this.emit('stopped');
  }
}

module.exports = GlobalQueueManager;