const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const { createLogger } = require('./logger');

/**
 * 高度なグローバルキューマネージャー
 * プロジェクト間の優先度制御、動的リソース配分、
 * フェアシェアスケジューリングを実装
 */
class AdvancedGlobalQueueManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = createLogger('AdvancedGlobalQueueManager');
    
    // 設定
    this.config = {
      dataDir: config.dataDir || path.join(process.env.HOME, '.poppo-builder'),
      queueFile: 'advanced-global-queue.json',
      projectsFile: 'projects-advanced.json',
      schedulingAlgorithm: config.schedulingAlgorithm || 'weighted-fair',
      resourceQuotaEnabled: config.resourceQuotaEnabled || true,
      dynamicPriorityEnabled: config.dynamicPriorityEnabled || true,
      maxQueueSize: config.maxQueueSize || 10000,
      maxConcurrentTasks: config.maxConcurrentTasks || 10,
      pollInterval: config.pollInterval || 1000,
      metricsRetentionDays: config.metricsRetentionDays || 30,
      ...config
    };
    
    // データファイルのパス
    this.queuePath = path.join(this.config.dataDir, this.config.queueFile);
    this.projectsPath = path.join(this.config.dataDir, this.config.projectsFile);
    
    // 内部状態
    this.queue = [];
    this.projects = new Map();
    this.runningTasks = new Map();
    this.resourceAllocations = new Map();
    this.projectMetrics = new Map();
    
    // スケジューリング状態
    this.schedulingState = {
      lastScheduledProject: null,
      fairShareTokens: new Map(),
      dynamicPriorities: new Map(),
      resourceUsage: {
        cpu: 0,
        memory: 0,
        concurrent: 0
      }
    };
    
    // 統計情報
    this.statistics = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      byProject: {},
      byPriority: {},
      resourceUtilization: [],
      schedulingMetrics: {
        avgWaitTime: 0,
        avgExecutionTime: 0,
        fairnessIndex: 1.0
      }
    };
    
    this.isRunning = false;
    this.pollTimer = null;
    this.metricsTimer = null;
  }

  /**
   * 初期化
   */
  async initialize() {
    try {
      await fs.mkdir(this.config.dataDir, { recursive: true });
      await this.loadQueue();
      await this.loadProjects();
      await this.initializeSchedulingState();
      
      this.logger.info('高度なグローバルキューマネージャーを初期化しました', {
        algorithm: this.config.schedulingAlgorithm,
        projects: this.projects.size,
        queueSize: this.queue.length
      });
      
      return true;
    } catch (error) {
      this.logger.error('初期化エラー:', error);
      throw error;
    }
  }

  /**
   * スケジューリング状態の初期化
   */
  async initializeSchedulingState() {
    // 各プロジェクトのフェアシェアトークンを初期化
    for (const [projectId, project] of this.projects) {
      const shareWeight = project.config?.shareWeight || 1.0;
      this.schedulingState.fairShareTokens.set(projectId, shareWeight);
      
      // 動的優先度の初期化
      if (this.config.dynamicPriorityEnabled) {
        this.schedulingState.dynamicPriorities.set(projectId, project.priority || 50);
      }
      
      // リソース割り当ての初期化
      if (this.config.resourceQuotaEnabled && project.config?.resourceQuota) {
        this.resourceAllocations.set(projectId, {
          cpu: project.config.resourceQuota.cpu || '1000m',
          memory: project.config.resourceQuota.memory || '1Gi',
          maxConcurrent: project.config.resourceQuota.maxConcurrent || 3
        });
      }
    }
  }

  /**
   * プロジェクトを登録（拡張版）
   */
  async registerProject(projectInfo) {
    const {
      id,
      name,
      path: projectPath,
      priority = 50,
      config = {}
    } = projectInfo;
    
    if (!id || !name || !projectPath) {
      throw new Error('プロジェクトID、名前、パスは必須です');
    }
    
    // デフォルトの設定をマージ
    const projectConfig = {
      maxConcurrent: 3,
      shareWeight: 1.0,
      resourceQuota: {
        cpu: '1000m',
        memory: '1Gi',
        maxConcurrent: 3
      },
      scheduling: {
        deadline: null,
        minThroughput: null,
        maxLatency: null
      },
      ...config
    };
    
    const project = {
      id,
      name,
      path: projectPath,
      priority,
      config: projectConfig,
      registeredAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      statistics: {
        totalTasks: 0,
        completedTasks: 0,
        failedTasks: 0,
        averageExecutionTime: 0,
        averageWaitTime: 0,
        resourceUsage: {
          peakCpu: 0,
          peakMemory: 0,
          avgCpu: 0,
          avgMemory: 0
        }
      },
      metrics: {
        throughput: [],
        latency: [],
        successRate: []
      }
    };
    
    this.projects.set(id, project);
    await this.saveProjects();
    
    // スケジューリング状態を更新
    await this.initializeProjectSchedulingState(id, project);
    
    this.logger.info('プロジェクトを登録しました', { project });
    this.emit('projectRegistered', project);
    
    return project;
  }

  /**
   * プロジェクトのスケジューリング状態を初期化
   */
  async initializeProjectSchedulingState(projectId, project) {
    const shareWeight = project.config?.shareWeight || 1.0;
    this.schedulingState.fairShareTokens.set(projectId, shareWeight);
    
    if (this.config.dynamicPriorityEnabled) {
      this.schedulingState.dynamicPriorities.set(projectId, project.priority);
    }
    
    if (this.config.resourceQuotaEnabled && project.config?.resourceQuota) {
      this.resourceAllocations.set(projectId, project.config.resourceQuota);
    }
  }

  /**
   * タスクをキューに追加（拡張版）
   */
  async enqueueTask(task) {
    const {
      projectId,
      issueNumber,
      priority = 50,
      metadata = {},
      deadline = null,
      estimatedDuration = null
    } = task;
    
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
    const effectivePriority = await this.calculateEffectivePriority(
      priority,
      projectId,
      deadline
    );
    
    const queuedTask = {
      id: `${projectId}-${issueNumber}-${Date.now()}`,
      projectId,
      issueNumber,
      priority,
      effectivePriority,
      metadata,
      status: 'queued',
      enqueuedAt: new Date().toISOString(),
      attempts: 0,
      deadline,
      estimatedDuration,
      schedulingMetadata: {
        virtualStartTime: this.calculateVirtualStartTime(projectId, effectivePriority),
        fairShareWeight: this.schedulingState.fairShareTokens.get(projectId)
      }
    };
    
    // スケジューリングアルゴリズムに基づいて挿入
    await this.insertTaskBySchedulingAlgorithm(queuedTask);
    
    await this.saveQueue();
    
    // 統計更新
    this.updateStatistics('enqueued', projectId, priority);
    
    // 動的優先度の調整
    if (this.config.dynamicPriorityEnabled) {
      await this.adjustDynamicPriorities();
    }
    
    this.logger.info('タスクをキューに追加しました', { task: queuedTask });
    this.emit('taskEnqueued', queuedTask);
    
    return queuedTask;
  }

  /**
   * 効果的な優先度を計算（拡張版）
   */
  async calculateEffectivePriority(taskPriority, projectId, deadline) {
    const project = this.projects.get(projectId);
    let effectivePriority = taskPriority;
    
    // プロジェクト優先度を考慮
    const projectPriority = this.config.dynamicPriorityEnabled
      ? this.schedulingState.dynamicPriorities.get(projectId)
      : project.priority;
    
    effectivePriority = Math.round(projectPriority * 0.6 + taskPriority * 0.4);
    
    // デッドラインに基づく優先度ブースト
    if (deadline) {
      const timeUntilDeadline = new Date(deadline) - new Date();
      const hoursUntilDeadline = timeUntilDeadline / (1000 * 60 * 60);
      
      if (hoursUntilDeadline < 24) {
        effectivePriority = Math.min(100, effectivePriority + 20);
      } else if (hoursUntilDeadline < 72) {
        effectivePriority = Math.min(100, effectivePriority + 10);
      }
    }
    
    // リソース使用率に基づく調整
    const projectResourceUsage = await this.getProjectResourceUsage(projectId);
    if (projectResourceUsage < 0.5) {
      // リソースを十分に使っていないプロジェクトを優遇
      effectivePriority = Math.min(100, effectivePriority + 5);
    }
    
    return effectivePriority;
  }

  /**
   * 仮想開始時刻を計算（フェアシェアスケジューリング用）
   */
  calculateVirtualStartTime(projectId, priority) {
    const tokens = this.schedulingState.fairShareTokens.get(projectId) || 1.0;
    const currentVirtualTime = Date.now() / tokens;
    
    // 優先度による調整
    const priorityFactor = (100 - priority) / 100;
    return currentVirtualTime + (priorityFactor * 1000);
  }

  /**
   * スケジューリングアルゴリズムに基づいてタスクを挿入
   */
  async insertTaskBySchedulingAlgorithm(task) {
    switch (this.config.schedulingAlgorithm) {
      case 'weighted-fair':
        await this.insertByWeightedFairQueuing(task);
        break;
      case 'priority-based':
        await this.insertByPriority(task);
        break;
      case 'deadline-aware':
        await this.insertByDeadline(task);
        break;
      case 'resource-aware':
        await this.insertByResourceAvailability(task);
        break;
      default:
        await this.insertByPriority(task);
    }
  }

  /**
   * 重み付きフェアキューイングでタスクを挿入
   */
  async insertByWeightedFairQueuing(task) {
    const insertIndex = this.queue.findIndex(t => 
      t.schedulingMetadata.virtualStartTime > task.schedulingMetadata.virtualStartTime
    );
    
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }
  }

  /**
   * 優先度ベースでタスクを挿入
   */
  async insertByPriority(task) {
    const insertIndex = this.queue.findIndex(t => t.effectivePriority < task.effectivePriority);
    
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }
  }

  /**
   * デッドライン考慮でタスクを挿入
   */
  async insertByDeadline(task) {
    if (!task.deadline) {
      // デッドラインがない場合は優先度ベース
      return this.insertByPriority(task);
    }
    
    const taskDeadline = new Date(task.deadline).getTime();
    const insertIndex = this.queue.findIndex(t => {
      if (!t.deadline) return true;
      return new Date(t.deadline).getTime() > taskDeadline;
    });
    
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }
  }

  /**
   * リソース可用性を考慮してタスクを挿入
   */
  async insertByResourceAvailability(task) {
    // プロジェクトのリソース使用状況を確認
    const projectResourceUsage = await this.getProjectResourceUsage(task.projectId);
    
    // リソースに余裕があるプロジェクトのタスクを優先
    const insertIndex = this.queue.findIndex(async (t) => {
      const tResourceUsage = await this.getProjectResourceUsage(t.projectId);
      return tResourceUsage > projectResourceUsage;
    });
    
    if (insertIndex === -1) {
      this.queue.push(task);
    } else {
      this.queue.splice(insertIndex, 0, task);
    }
  }

  /**
   * 次のタスクを取得（拡張版）
   */
  async getNextTask(requestingProjectId = null) {
    // リソースクォータチェック
    if (this.config.resourceQuotaEnabled && requestingProjectId) {
      const canAllocate = await this.checkResourceQuota(requestingProjectId);
      if (!canAllocate) {
        this.logger.warn('リソースクォータを超過しています', { projectId: requestingProjectId });
        return null;
      }
    }
    
    // スケジューリングアルゴリズムに基づいてタスクを選択
    const taskIndex = await this.selectNextTaskIndex(requestingProjectId);
    
    if (taskIndex === -1) {
      return null;
    }
    
    const task = this.queue[taskIndex];
    this.queue.splice(taskIndex, 1);
    
    task.status = 'processing';
    task.startedAt = new Date().toISOString();
    
    // リソースを割り当て
    if (this.config.resourceQuotaEnabled) {
      await this.allocateResources(task.projectId, task);
    }
    
    this.runningTasks.set(task.id, task);
    await this.saveQueue();
    
    // フェアシェアトークンを消費
    if (this.config.schedulingAlgorithm === 'weighted-fair') {
      this.consumeFairShareTokens(task.projectId);
    }
    
    this.logger.info('タスクを処理開始', { task });
    this.emit('taskStarted', task);
    
    return task;
  }

  /**
   * 次のタスクのインデックスを選択
   */
  async selectNextTaskIndex(requestingProjectId) {
    if (this.queue.length === 0) return -1;
    
    switch (this.config.schedulingAlgorithm) {
      case 'weighted-fair':
        return this.selectByWeightedFairShare(requestingProjectId);
      case 'deadline-aware':
        return this.selectByDeadline();
      case 'resource-aware':
        return this.selectByResourceAvailability(requestingProjectId);
      default:
        return this.selectByPriority(requestingProjectId);
    }
  }

  /**
   * 重み付きフェアシェアでタスクを選択
   */
  selectByWeightedFairShare(requestingProjectId) {
    // 最も仮想開始時刻が早いタスクを選択
    let selectedIndex = -1;
    let earliestVirtualTime = Infinity;
    
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      
      // リクエストしているプロジェクトIDがある場合はそれを優先
      if (requestingProjectId && task.projectId === requestingProjectId) {
        const virtualTime = task.schedulingMetadata.virtualStartTime;
        if (virtualTime < earliestVirtualTime) {
          earliestVirtualTime = virtualTime;
          selectedIndex = i;
        }
      } else if (!requestingProjectId) {
        const virtualTime = task.schedulingMetadata.virtualStartTime;
        if (virtualTime < earliestVirtualTime) {
          earliestVirtualTime = virtualTime;
          selectedIndex = i;
        }
      }
    }
    
    return selectedIndex;
  }

  /**
   * デッドラインを考慮してタスクを選択
   */
  selectByDeadline() {
    let selectedIndex = 0;
    let earliestDeadline = Infinity;
    
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      if (task.deadline) {
        const deadline = new Date(task.deadline).getTime();
        if (deadline < earliestDeadline) {
          earliestDeadline = deadline;
          selectedIndex = i;
        }
      }
    }
    
    return selectedIndex;
  }

  /**
   * 優先度でタスクを選択
   */
  selectByPriority(requestingProjectId) {
    if (requestingProjectId) {
      // 特定のプロジェクトのタスクから選択
      const projectTaskIndex = this.queue.findIndex(
        task => task.projectId === requestingProjectId && task.status === 'queued'
      );
      if (projectTaskIndex !== -1) return projectTaskIndex;
    }
    
    // 最も優先度の高いタスクを選択
    return 0;
  }

  /**
   * リソース可用性でタスクを選択
   */
  async selectByResourceAvailability(requestingProjectId) {
    for (let i = 0; i < this.queue.length; i++) {
      const task = this.queue[i];
      const canAllocate = await this.checkResourceQuota(task.projectId);
      if (canAllocate) {
        return i;
      }
    }
    return -1;
  }

  /**
   * リソースクォータをチェック
   */
  async checkResourceQuota(projectId) {
    const allocation = this.resourceAllocations.get(projectId);
    if (!allocation) return true;
    
    const currentUsage = await this.getProjectResourceUsage(projectId);
    const runningCount = Array.from(this.runningTasks.values())
      .filter(task => task.projectId === projectId).length;
    
    return runningCount < allocation.maxConcurrent;
  }

  /**
   * リソースを割り当て
   */
  async allocateResources(projectId, task) {
    const allocation = this.resourceAllocations.get(projectId);
    if (!allocation) return;
    
    // リソース使用量を記録
    const currentUsage = this.schedulingState.resourceUsage;
    currentUsage.concurrent++;
    
    // CPUとメモリの割り当て（仮想的）
    const cpuValue = this.parseCpuValue(allocation.cpu);
    const memoryValue = this.parseMemoryValue(allocation.memory);
    
    currentUsage.cpu += cpuValue;
    currentUsage.memory += memoryValue;
    
    task.allocatedResources = {
      cpu: cpuValue,
      memory: memoryValue
    };
  }

  /**
   * リソースを解放
   */
  async releaseResources(task) {
    if (!task.allocatedResources) return;
    
    const currentUsage = this.schedulingState.resourceUsage;
    currentUsage.concurrent--;
    currentUsage.cpu -= task.allocatedResources.cpu;
    currentUsage.memory -= task.allocatedResources.memory;
    
    delete task.allocatedResources;
  }

  /**
   * フェアシェアトークンを消費
   */
  consumeFairShareTokens(projectId) {
    const currentTokens = this.schedulingState.fairShareTokens.get(projectId) || 1.0;
    this.schedulingState.fairShareTokens.set(projectId, currentTokens * 0.9);
  }

  /**
   * フェアシェアトークンを補充
   */
  replenishFairShareTokens() {
    for (const [projectId, project] of this.projects) {
      const shareWeight = project.config?.shareWeight || 1.0;
      const currentTokens = this.schedulingState.fairShareTokens.get(projectId) || 0;
      const newTokens = Math.min(shareWeight, currentTokens + shareWeight * 0.1);
      this.schedulingState.fairShareTokens.set(projectId, newTokens);
    }
  }

  /**
   * 動的優先度を調整
   */
  async adjustDynamicPriorities() {
    for (const [projectId, project] of this.projects) {
      const metrics = await this.getProjectMetrics(projectId);
      const basePriority = project.priority;
      let adjustedPriority = basePriority;
      
      // スループットが目標を下回っている場合は優先度を上げる
      if (project.config.scheduling?.minThroughput) {
        const currentThroughput = metrics.throughput || 0;
        if (currentThroughput < project.config.scheduling.minThroughput) {
          adjustedPriority = Math.min(100, adjustedPriority + 10);
        }
      }
      
      // レイテンシーが目標を超えている場合は優先度を上げる
      if (project.config.scheduling?.maxLatency) {
        const currentLatency = metrics.averageLatency || 0;
        if (currentLatency > project.config.scheduling.maxLatency) {
          adjustedPriority = Math.min(100, adjustedPriority + 10);
        }
      }
      
      // 長時間待機しているタスクがある場合は優先度を上げる
      const waitingTasks = this.queue.filter(t => t.projectId === projectId);
      if (waitingTasks.length > 0) {
        const oldestTask = waitingTasks[0];
        const waitTime = Date.now() - new Date(oldestTask.enqueuedAt).getTime();
        if (waitTime > 3600000) { // 1時間以上
          adjustedPriority = Math.min(100, adjustedPriority + 5);
        }
      }
      
      this.schedulingState.dynamicPriorities.set(projectId, adjustedPriority);
    }
  }

  /**
   * タスクを完了（拡張版）
   */
  async completeTask(taskId, result = {}) {
    const task = this.runningTasks.get(taskId);
    if (!task) {
      throw new Error(`タスク ${taskId} が見つかりません`);
    }
    
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = result;
    
    const executionTime = new Date(task.completedAt) - new Date(task.startedAt);
    const waitTime = new Date(task.startedAt) - new Date(task.enqueuedAt);
    
    // リソースを解放
    if (this.config.resourceQuotaEnabled) {
      await this.releaseResources(task);
    }
    
    // メトリクスを更新
    await this.updateProjectMetrics(task.projectId, {
      executionTime,
      waitTime,
      success: true
    });
    
    this.runningTasks.delete(taskId);
    
    // 統計更新
    this.updateStatistics('completed', task.projectId, task.priority);
    
    // フェアシェアトークンを一部回復
    if (this.config.schedulingAlgorithm === 'weighted-fair') {
      this.replenishFairShareTokens();
    }
    
    this.logger.info('タスクを完了しました', { task });
    this.emit('taskCompleted', task);
    
    return task;
  }

  /**
   * プロジェクトのメトリクスを更新
   */
  async updateProjectMetrics(projectId, metrics) {
    const project = this.projects.get(projectId);
    if (!project) return;
    
    // 実行時間の更新
    if (metrics.executionTime !== undefined) {
      const stats = project.statistics;
      const count = stats.completedTasks + stats.failedTasks;
      stats.averageExecutionTime = 
        (stats.averageExecutionTime * count + metrics.executionTime) / (count + 1);
    }
    
    // 待機時間の更新
    if (metrics.waitTime !== undefined) {
      const stats = project.statistics;
      stats.averageWaitTime = 
        (stats.averageWaitTime * stats.totalTasks + metrics.waitTime) / (stats.totalTasks + 1);
    }
    
    // スループットとレイテンシーの記録
    if (!this.projectMetrics.has(projectId)) {
      this.projectMetrics.set(projectId, {
        throughput: [],
        latency: [],
        successRate: []
      });
    }
    
    const projectMetrics = this.projectMetrics.get(projectId);
    const now = Date.now();
    
    // 直近1時間のメトリクスを保持
    const oneHourAgo = now - 3600000;
    projectMetrics.throughput = projectMetrics.throughput.filter(m => m.timestamp > oneHourAgo);
    projectMetrics.latency = projectMetrics.latency.filter(m => m.timestamp > oneHourAgo);
    
    if (metrics.success !== undefined) {
      projectMetrics.throughput.push({ timestamp: now, value: 1 });
      projectMetrics.latency.push({ timestamp: now, value: metrics.executionTime });
    }
  }

  /**
   * プロジェクトのメトリクスを取得
   */
  async getProjectMetrics(projectId) {
    const metrics = this.projectMetrics.get(projectId);
    if (!metrics) {
      return {
        throughput: 0,
        averageLatency: 0,
        successRate: 100
      };
    }
    
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    
    // スループット（タスク/時間）
    const recentTasks = metrics.throughput.filter(m => m.timestamp > oneHourAgo);
    const throughput = recentTasks.length;
    
    // 平均レイテンシー
    const recentLatencies = metrics.latency.filter(m => m.timestamp > oneHourAgo);
    const averageLatency = recentLatencies.length > 0
      ? recentLatencies.reduce((sum, m) => sum + m.value, 0) / recentLatencies.length
      : 0;
    
    // 成功率
    const successRate = 100; // TODO: 失敗も追跡する
    
    return {
      throughput,
      averageLatency,
      successRate
    };
  }

  /**
   * プロジェクトのリソース使用率を取得
   */
  async getProjectResourceUsage(projectId) {
    const allocation = this.resourceAllocations.get(projectId);
    if (!allocation) return 0;
    
    const runningTasks = Array.from(this.runningTasks.values())
      .filter(task => task.projectId === projectId);
    
    return runningTasks.length / allocation.maxConcurrent;
  }

  /**
   * CPU値をパース
   */
  parseCpuValue(cpuString) {
    if (cpuString.endsWith('m')) {
      return parseInt(cpuString) / 1000;
    }
    return parseFloat(cpuString);
  }

  /**
   * メモリ値をパース
   */
  parseMemoryValue(memoryString) {
    const units = {
      'Ki': 1024,
      'Mi': 1024 * 1024,
      'Gi': 1024 * 1024 * 1024
    };
    
    for (const [unit, multiplier] of Object.entries(units)) {
      if (memoryString.endsWith(unit)) {
        return parseInt(memoryString) * multiplier;
      }
    }
    
    return parseInt(memoryString);
  }

  /**
   * 統計情報を更新
   */
  updateStatistics(event, projectId, priority) {
    switch (event) {
      case 'enqueued':
        this.statistics.totalEnqueued++;
        break;
      case 'completed':
        this.statistics.totalProcessed++;
        break;
      case 'failed':
        this.statistics.totalFailed++;
        break;
    }
    
    // プロジェクト別統計
    if (!this.statistics.byProject[projectId]) {
      this.statistics.byProject[projectId] = {
        enqueued: 0,
        completed: 0,
        failed: 0
      };
    }
    
    if (event === 'enqueued') {
      this.statistics.byProject[projectId].enqueued++;
    } else if (event === 'completed') {
      this.statistics.byProject[projectId].completed++;
    } else if (event === 'failed') {
      this.statistics.byProject[projectId].failed++;
    }
  }

  /**
   * スケジューリングメトリクスを計算
   */
  async calculateSchedulingMetrics() {
    const allProjects = Array.from(this.projects.keys());
    if (allProjects.length === 0) return;
    
    // 平均待機時間と実行時間
    let totalWaitTime = 0;
    let totalExecutionTime = 0;
    let taskCount = 0;
    
    for (const [projectId, project] of this.projects) {
      totalWaitTime += project.statistics.averageWaitTime * project.statistics.totalTasks;
      totalExecutionTime += project.statistics.averageExecutionTime * project.statistics.completedTasks;
      taskCount += project.statistics.totalTasks;
    }
    
    if (taskCount > 0) {
      this.statistics.schedulingMetrics.avgWaitTime = totalWaitTime / taskCount;
      this.statistics.schedulingMetrics.avgExecutionTime = 
        totalExecutionTime / this.statistics.totalProcessed;
    }
    
    // フェアネスインデックスの計算（Jain's fairness index）
    const throughputs = [];
    for (const projectId of allProjects) {
      const metrics = await this.getProjectMetrics(projectId);
      throughputs.push(metrics.throughput || 0.1); // ゼロ除算を避ける
    }
    
    const sumSquares = throughputs.reduce((sum, t) => sum + t * t, 0);
    const sumTotal = throughputs.reduce((sum, t) => sum + t, 0);
    const n = throughputs.length;
    
    this.statistics.schedulingMetrics.fairnessIndex = 
      (sumTotal * sumTotal) / (n * sumSquares);
  }

  /**
   * リソース使用率を記録
   */
  recordResourceUtilization() {
    const utilization = {
      timestamp: Date.now(),
      cpu: this.schedulingState.resourceUsage.cpu,
      memory: this.schedulingState.resourceUsage.memory,
      concurrent: this.schedulingState.resourceUsage.concurrent,
      queueLength: this.queue.length
    };
    
    this.statistics.resourceUtilization.push(utilization);
    
    // 古いデータを削除（1日分のみ保持）
    const oneDayAgo = Date.now() - 86400000;
    this.statistics.resourceUtilization = 
      this.statistics.resourceUtilization.filter(u => u.timestamp > oneDayAgo);
  }

  /**
   * 定期的なメンテナンス（拡張版）
   */
  async performMaintenance() {
    // タイムアウトチェック
    await this.checkTimeouts();
    
    // 動的優先度の調整
    if (this.config.dynamicPriorityEnabled) {
      await this.adjustDynamicPriorities();
    }
    
    // フェアシェアトークンの定期補充
    if (this.config.schedulingAlgorithm === 'weighted-fair') {
      this.replenishFairShareTokens();
    }
    
    // スケジューリングメトリクスの計算
    await this.calculateSchedulingMetrics();
    
    // リソース使用率の記録
    this.recordResourceUtilization();
    
    // データの永続化
    await this.saveQueue();
    await this.saveProjects();
  }

  /**
   * タイムアウトチェック（拡張版）
   */
  async checkTimeouts() {
    const now = Date.now();
    
    for (const [taskId, task] of this.runningTasks) {
      const startTime = new Date(task.startedAt).getTime();
      const project = this.projects.get(task.projectId);
      
      // プロジェクト固有のタイムアウト設定
      const timeout = project?.config?.taskTimeout || 30 * 60 * 1000; // デフォルト30分
      
      if (now - startTime > timeout) {
        this.logger.warn('タスクがタイムアウトしました', { taskId, timeout });
        await this.failTask(taskId, new Error('タスクがタイムアウトしました'));
      }
      
      // デッドラインチェック
      if (task.deadline) {
        const deadline = new Date(task.deadline).getTime();
        if (now > deadline) {
          this.logger.warn('タスクがデッドラインを超過しました', { taskId, deadline: task.deadline });
          await this.failTask(taskId, new Error('デッドラインを超過しました'));
        }
      }
    }
  }

  /**
   * タスクを失敗（拡張版）
   */
  async failTask(taskId, error) {
    const task = this.runningTasks.get(taskId);
    if (!task) {
      throw new Error(`タスク ${taskId} が見つかりません`);
    }
    
    task.attempts++;
    
    if (task.attempts >= 3) {
      // 最大リトライ回数に達した場合
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      task.error = error.message || error;
      
      // リソースを解放
      if (this.config.resourceQuotaEnabled) {
        await this.releaseResources(task);
      }
      
      this.runningTasks.delete(taskId);
      
      // メトリクスを更新
      await this.updateProjectMetrics(task.projectId, {
        success: false
      });
      
      // 統計更新
      this.updateStatistics('failed', task.projectId, task.priority);
      
      this.logger.error('タスクが失敗しました', { task, error });
      this.emit('taskFailed', task);
    } else {
      // リトライ可能な場合
      task.status = 'queued';
      task.lastError = error.message || error;
      
      // リソースを解放
      if (this.config.resourceQuotaEnabled) {
        await this.releaseResources(task);
      }
      
      this.runningTasks.delete(taskId);
      
      // キューに再挿入（優先度を少し上げる）
      task.effectivePriority = Math.min(100, task.effectivePriority + 5);
      await this.insertTaskBySchedulingAlgorithm(task);
      
      this.logger.warn('タスクをリトライします', { task, attempt: task.attempts });
      this.emit('taskRetry', task);
    }
    
    await this.saveQueue();
    return task;
  }

  /**
   * キューを保存（拡張版）
   */
  async saveQueue() {
    try {
      const data = {
        queue: this.queue,
        runningTasks: Array.from(this.runningTasks.entries()),
        schedulingState: {
          ...this.schedulingState,
          fairShareTokens: Array.from(this.schedulingState.fairShareTokens.entries()),
          dynamicPriorities: Array.from(this.schedulingState.dynamicPriorities.entries())
        },
        statistics: this.statistics,
        lastSaved: new Date().toISOString()
      };
      
      await fs.writeFile(this.queuePath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('キューの保存に失敗しました:', error);
    }
  }

  /**
   * キューを読み込み（拡張版）
   */
  async loadQueue() {
    try {
      const data = await fs.readFile(this.queuePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      this.queue = parsed.queue || [];
      this.statistics = parsed.statistics || this.statistics;
      
      // 実行中タスクの復元
      if (parsed.runningTasks) {
        this.runningTasks = new Map(parsed.runningTasks);
      }
      
      // スケジューリング状態の復元
      if (parsed.schedulingState) {
        if (parsed.schedulingState.fairShareTokens) {
          this.schedulingState.fairShareTokens = new Map(parsed.schedulingState.fairShareTokens);
        }
        if (parsed.schedulingState.dynamicPriorities) {
          this.schedulingState.dynamicPriorities = new Map(parsed.schedulingState.dynamicPriorities);
        }
        if (parsed.schedulingState.resourceUsage) {
          this.schedulingState.resourceUsage = parsed.schedulingState.resourceUsage;
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('キューの読み込みに失敗しました:', error);
      }
    }
  }

  /**
   * プロジェクトを保存（拡張版）
   */
  async saveProjects() {
    try {
      const projects = Array.from(this.projects.entries()).map(([id, project]) => ({
        ...project,
        id,
        metrics: this.projectMetrics.get(id) || {}
      }));
      
      await fs.writeFile(this.projectsPath, JSON.stringify(projects, null, 2));
    } catch (error) {
      this.logger.error('プロジェクトの保存に失敗しました:', error);
    }
  }

  /**
   * プロジェクトを読み込み（拡張版）
   */
  async loadProjects() {
    try {
      const data = await fs.readFile(this.projectsPath, 'utf-8');
      const projects = JSON.parse(data);
      
      projects.forEach(project => {
        this.projects.set(project.id, project);
        
        // メトリクスの復元
        if (project.metrics) {
          this.projectMetrics.set(project.id, project.metrics);
        }
      });
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('プロジェクトの読み込みに失敗しました:', error);
      }
    }
  }

  /**
   * 詳細なキューステータスを取得
   */
  getDetailedQueueStatus() {
    const projectStats = {};
    
    for (const [projectId, project] of this.projects) {
      const queuedTasks = this.queue.filter(t => t.projectId === projectId);
      const runningTasks = Array.from(this.runningTasks.values())
        .filter(t => t.projectId === projectId);
      
      projectStats[projectId] = {
        name: project.name,
        priority: this.config.dynamicPriorityEnabled
          ? this.schedulingState.dynamicPriorities.get(projectId)
          : project.priority,
        queued: queuedTasks.length,
        running: runningTasks.length,
        statistics: project.statistics,
        resourceAllocation: this.resourceAllocations.get(projectId),
        fairShareTokens: this.schedulingState.fairShareTokens.get(projectId),
        metrics: this.projectMetrics.get(projectId) || {}
      };
    }
    
    return {
      algorithm: this.config.schedulingAlgorithm,
      queueSize: this.queue.length,
      runningTasks: this.runningTasks.size,
      projects: this.projects.size,
      resourceUsage: this.schedulingState.resourceUsage,
      projectStats,
      schedulingMetrics: this.statistics.schedulingMetrics,
      statistics: this.statistics
    };
  }

  /**
   * キューマネージャーを開始
   */
  async start() {
    if (this.isRunning) {
      return;
    }
    
    this.isRunning = true;
    this.logger.info('高度なグローバルキューマネージャーを開始しました', {
      algorithm: this.config.schedulingAlgorithm
    });
    
    // 定期的なメンテナンス
    this.pollTimer = setInterval(() => {
      this.performMaintenance().catch(error => {
        this.logger.error('メンテナンスエラー:', error);
      });
    }, this.config.pollInterval);
    
    // メトリクス収集タイマー
    this.metricsTimer = setInterval(() => {
      this.recordResourceUtilization();
    }, 60000); // 1分ごと
    
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
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    await this.saveQueue();
    await this.saveProjects();
    
    this.logger.info('高度なグローバルキューマネージャーを停止しました');
    this.emit('stopped');
  }
}

module.exports = AdvancedGlobalQueueManager;