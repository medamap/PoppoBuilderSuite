/**
 * Task Scheduler
 * タスクスケジューラー - マルチプロジェクト間でタスクを効率的に振り分ける
 */

const EventEmitter = require('events');
const path = require('path');

/**
 * タスクスケジューラークラス
 * 複数のプロジェクト間でタスクを効率的にスケジューリング
 */
class TaskScheduler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      strategy: options.strategy || 'round-robin', // デフォルトはラウンドロビン
      defaultPriority: options.defaultPriority || 50,
      maxConcurrentPerProject: options.maxConcurrentPerProject || 5,
      fairShareWindow: options.fairShareWindow || 60000, // 60秒
      ...options
    };
    
    // プロジェクト管理
    this.projects = new Map();
    this.projectStats = new Map();
    
    // スケジューリング戦略
    this.strategies = new Map();
    this.currentStrategy = null;
    
    // メトリクス
    this.metrics = {
      totalScheduled: 0,
      totalCompleted: 0,
      schedulingDecisions: [],
      fairnessScore: 1.0
    };
    
    // ラウンドロビン用のインデックス
    this.roundRobinIndex = 0;
    
    // 初期化
    this.initialized = false;
  }
  
  /**
   * スケジューラーを初期化
   */
  async initialize() {
    try {
      // 戦略を登録
      await this.registerBuiltInStrategies();
      
      // デフォルト戦略を設定
      this.setStrategy(this.options.strategy);
      
      this.initialized = true;
      this.emit('initialized');
      
      return true;
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }
  
  /**
   * ビルトイン戦略を登録
   */
  async registerBuiltInStrategies() {
    // 各戦略をインポートして登録
    const strategies = [
      'round-robin',
      'priority',
      'weighted',
      'fair-share'
    ];
    
    for (const strategyName of strategies) {
      try {
        const StrategyClass = require(`../strategies/${strategyName}-strategy`);
        const strategy = new StrategyClass(this);
        this.registerStrategy(strategyName, strategy);
      } catch (error) {
        // 戦略ファイルがまだ存在しない場合はスキップ
        console.warn(`Strategy ${strategyName} not found, skipping...`);
      }
    }
  }
  
  /**
   * 戦略を登録
   */
  registerStrategy(name, strategy) {
    if (!strategy || typeof strategy.schedule !== 'function') {
      throw new Error('Strategy must implement schedule() method');
    }
    
    this.strategies.set(name, strategy);
    this.emit('strategy-registered', { name });
  }
  
  /**
   * 現在の戦略を設定
   */
  setStrategy(name) {
    if (!this.strategies.has(name)) {
      throw new Error(`Strategy '${name}' not found`);
    }
    
    const oldStrategy = this.currentStrategy;
    this.currentStrategy = this.strategies.get(name);
    
    if (oldStrategy !== this.currentStrategy) {
      this.emit('strategy-changed', { 
        from: oldStrategy?.name, 
        to: name 
      });
    }
    
    return this.currentStrategy;
  }
  
  /**
   * プロジェクトを登録
   */
  registerProject(projectId, options = {}) {
    const project = {
      id: projectId,
      priority: options.priority || this.options.defaultPriority,
      weight: options.weight || 1.0,
      maxConcurrent: options.maxConcurrent || this.options.maxConcurrentPerProject,
      metadata: options.metadata || {},
      active: true,
      createdAt: Date.now()
    };
    
    this.projects.set(projectId, project);
    
    // 統計を初期化
    this.projectStats.set(projectId, {
      tasksScheduled: 0,
      tasksCompleted: 0,
      totalWaitTime: 0,
      totalExecutionTime: 0,
      lastScheduledAt: null,
      currentConcurrent: 0
    });
    
    this.emit('project-registered', { projectId, project });
    return project;
  }
  
  /**
   * プロジェクトを削除
   */
  unregisterProject(projectId) {
    if (this.projects.has(projectId)) {
      this.projects.delete(projectId);
      this.projectStats.delete(projectId);
      this.emit('project-unregistered', { projectId });
      return true;
    }
    return false;
  }
  
  /**
   * タスクをスケジュール
   */
  async scheduleTask(task) {
    if (!this.initialized) {
      throw new Error('Scheduler not initialized');
    }
    
    if (!this.currentStrategy) {
      throw new Error('No scheduling strategy set');
    }
    
    // タスクにメタデータを追加
    const scheduledTask = {
      ...task,
      scheduledAt: Date.now(),
      schedulerId: this.options.schedulerId || 'default'
    };
    
    // 現在の戦略でスケジューリング
    const projectId = await this.currentStrategy.schedule(scheduledTask, {
      projects: Array.from(this.projects.values()),
      stats: this.projectStats
    });
    
    if (!projectId) {
      throw new Error('No suitable project found for task');
    }
    
    // 統計を更新
    this.updateStats(projectId, 'scheduled');
    
    // メトリクスを記録
    this.metrics.totalScheduled++;
    this.metrics.schedulingDecisions.push({
      taskId: task.id,
      projectId,
      strategy: this.currentStrategy.name || this.options.strategy,
      timestamp: Date.now()
    });
    
    // 古い決定履歴をクリーンアップ（最新1000件のみ保持）
    if (this.metrics.schedulingDecisions.length > 1000) {
      this.metrics.schedulingDecisions = this.metrics.schedulingDecisions.slice(-1000);
    }
    
    this.emit('task-scheduled', { task: scheduledTask, projectId });
    
    return projectId;
  }
  
  /**
   * タスクが完了したことを通知
   */
  taskCompleted(projectId, taskId, executionTime = 0) {
    const stats = this.projectStats.get(projectId);
    if (stats) {
      stats.tasksCompleted++;
      stats.totalExecutionTime += executionTime;
      stats.currentConcurrent = Math.max(0, stats.currentConcurrent - 1);
      
      this.metrics.totalCompleted++;
      this.updateFairnessScore();
      
      this.emit('task-completed', { projectId, taskId, executionTime });
    }
  }
  
  /**
   * 統計を更新
   */
  updateStats(projectId, action) {
    const stats = this.projectStats.get(projectId);
    if (!stats) return;
    
    switch (action) {
      case 'scheduled':
        stats.tasksScheduled++;
        stats.lastScheduledAt = Date.now();
        stats.currentConcurrent++;
        break;
    }
  }
  
  /**
   * フェアネススコアを計算
   */
  updateFairnessScore() {
    if (this.projects.size === 0) {
      this.metrics.fairnessScore = 1.0;
      return;
    }
    
    // 各プロジェクトの完了タスク数を取得
    const completedCounts = Array.from(this.projectStats.values())
      .map(stats => stats.tasksCompleted);
    
    if (completedCounts.length === 0 || completedCounts.every(count => count === 0)) {
      this.metrics.fairnessScore = 1.0;
      return;
    }
    
    // Jain's fairness indexを計算
    const sum = completedCounts.reduce((a, b) => a + b, 0);
    const sumSquared = completedCounts.reduce((a, b) => a + b * b, 0);
    const n = completedCounts.length;
    
    this.metrics.fairnessScore = (sum * sum) / (n * sumSquared);
  }
  
  /**
   * プロジェクトの統計を取得
   */
  getProjectStats(projectId) {
    return this.projectStats.get(projectId);
  }
  
  /**
   * 全体の統計を取得
   */
  getMetrics() {
    return {
      ...this.metrics,
      projects: this.projects.size,
      currentStrategy: this.options.strategy,
      projectStats: Object.fromEntries(this.projectStats)
    };
  }
  
  /**
   * アクティブなプロジェクトを取得
   */
  getActiveProjects() {
    return Array.from(this.projects.values())
      .filter(project => project.active);
  }
  
  /**
   * プロジェクトの優先度を更新
   */
  updateProjectPriority(projectId, priority) {
    const project = this.projects.get(projectId);
    if (project) {
      project.priority = priority;
      this.emit('project-priority-updated', { projectId, priority });
      return true;
    }
    return false;
  }
  
  /**
   * プロジェクトの重みを更新
   */
  updateProjectWeight(projectId, weight) {
    const project = this.projects.get(projectId);
    if (project) {
      project.weight = weight;
      this.emit('project-weight-updated', { projectId, weight });
      return true;
    }
    return false;
  }
  
  /**
   * スケジューラーをリセット
   */
  reset() {
    this.projects.clear();
    this.projectStats.clear();
    this.metrics = {
      totalScheduled: 0,
      totalCompleted: 0,
      schedulingDecisions: [],
      fairnessScore: 1.0
    };
    this.roundRobinIndex = 0;
    this.emit('reset');
  }
}

module.exports = TaskScheduler;