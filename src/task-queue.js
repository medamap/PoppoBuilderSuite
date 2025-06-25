const EventEmitter = require('events');
const IssueLockManager = require('./issue-lock-manager');

/**
 * 優先度付きタスクキュー
 */
class TaskQueue extends EventEmitter {
  constructor(config = {}, lockManager = null) {
    super();
    
    // 優先度レベル
    this.PRIORITY_LEVELS = {
      DOGFOODING: 100,    // dogfoodingタスクは最優先
      HIGH: 75,
      NORMAL: 50,
      LOW: 25
    };
    
    // キュー（優先度ごとに管理）
    this.queues = {
      [this.PRIORITY_LEVELS.DOGFOODING]: [],
      [this.PRIORITY_LEVELS.HIGH]: [],
      [this.PRIORITY_LEVELS.NORMAL]: [],
      [this.PRIORITY_LEVELS.LOW]: []
    };
    
    // 実行中のタスク
    this.runningTasks = new Map();
    
    // 設定
    this.maxConcurrent = config.maxConcurrent || 2;
    this.maxQueueSize = config.maxQueueSize || 100;
    
    // IssueLockManager（オプショナル）
    this.lockManager = lockManager;
    
    // 統計情報
    this.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      byPriority: {}
    };
    
    // 優先度ごとの統計を初期化
    const createPriorityStats = () => ({
      enqueued: 0,
      processed: 0,
      failed: 0,
      averageWaitTime: 0
    });
    
    this.stats.byPriority = Object.fromEntries(
      Object.values(this.PRIORITY_LEVELS).map(level => [level, createPriorityStats()])
    );
  }

  /**
   * タスクの優先度を決定
   */
  determinePriority(task) {
    // dogfoodingラベルがある場合は最優先
    if (task.labels && task.labels.includes('task:dogfooding')) {
      return this.PRIORITY_LEVELS.DOGFOODING;
    }
    
    // 明示的な優先度指定
    if (task.priority !== undefined) {
      return task.priority;
    }
    
    // デフォルトは通常優先度
    return this.PRIORITY_LEVELS.NORMAL;
  }

  /**
   * タスクをキューに追加
   */
  async enqueue(task) {
    // キューサイズチェック
    const totalSize = this.getQueueSize();
    if (totalSize >= this.maxQueueSize) {
      throw new Error(`Queue is full (${totalSize}/${this.maxQueueSize})`);
    }
    
    // 汎用的な重複チェック
    if (this.hasDuplicateTask(task)) {
      const taskDesc = task.type === 'issue' ? `Issue #${task.issueNumber}` : 
                       task.type === 'comment' ? `Comment on Issue #${task.issueNumber}` : 
                       `Task ${task.id}`;
      console.log(`⚠️  ${taskDesc} は既にキューまたは実行中のためスキップ`);
      throw new Error(`${taskDesc} は既に処理中です`);
    }
    
    // IssueLockManagerが設定されている場合、既にロックされているかチェック
    if (this.lockManager && task.issueNumber) {
      const existingLock = await this.lockManager.checkLock(task.issueNumber);
      if (existingLock && this.lockManager.isLockValid(existingLock)) {
        console.log(`⚠️  Issue #${task.issueNumber} is already locked by PID ${existingLock.lockedBy.pid}, skipping enqueue`);
        throw new Error(`Issue #${task.issueNumber} is already being processed`);
      }
    }
    
    // 優先度を決定
    const priority = this.determinePriority(task);
    
    // タスクにメタデータを追加
    const queuedTask = {
      ...task,
      id: task.id || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      priority,
      enqueuedAt: Date.now(),
      attempts: 0
    };
    
    // 対応するキューに追加
    if (!this.queues[priority]) {
      this.queues[priority] = [];
    }
    this.queues[priority].push(queuedTask);
    
    // 統計を更新
    this.stats.totalEnqueued++;
    this.stats.byPriority[priority].enqueued++;
    
    // イベント発火
    this.emit('taskEnqueued', queuedTask);
    
    console.log(`📥 タスクをキューに追加: ${queuedTask.id} (優先度: ${this.getPriorityName(priority)})`);
    
    return queuedTask.id;
  }

  /**
   * 次のタスクを取得（優先度順）
   */
  dequeue() {
    // 優先度の高い順にチェック
    const priorities = Object.keys(this.queues)
      .map(p => parseInt(p))
      .sort((a, b) => b - a);
    
    for (const priority of priorities) {
      const queue = this.queues[priority];
      if (queue && queue.length > 0) {
        const task = queue.shift();
        
        // 待機時間を記録
        const waitTime = Date.now() - task.enqueuedAt;
        const stats = this.stats.byPriority[priority];
        stats.averageWaitTime = 
          (stats.averageWaitTime * stats.processed + waitTime) / 
          (stats.processed + 1);
        
        return task;
      }
    }
    
    return null;
  }

  /**
   * タスクの実行を開始
   */
  async startTask(taskId, processInfo) {
    // IssueLockManagerが設定されていて、processInfoにissueNumberがある場合はロックを取得
    if (this.lockManager && processInfo && processInfo.issueNumber) {
      this.emit('lockAttempt', { issueNumber: processInfo.issueNumber, taskId });
      
      const lockAcquired = await this.lockManager.acquireLock(processInfo.issueNumber, {
        pid: processInfo.pid || process.pid,
        sessionId: process.env.CLAUDE_SESSION_ID,
        taskId: taskId,
        type: 'issue_processing'
      });
      
      if (!lockAcquired) {
        this.emit('lockFailure', { issueNumber: processInfo.issueNumber, taskId });
        throw new Error(`Failed to acquire lock for Issue #${processInfo.issueNumber}`);
      }
    }
    
    this.runningTasks.set(taskId, {
      startedAt: Date.now(),
      processInfo
    });
    
    this.emit('taskStarted', { taskId, processInfo });
  }

  /**
   * タスクの実行を完了
   */
  async completeTask(taskId, success = true) {
    const runningInfo = this.runningTasks.get(taskId);
    if (!runningInfo) return;
    
    // IssueLockManagerが設定されていて、processInfoにissueNumberがある場合はロックを解放
    if (this.lockManager && runningInfo.processInfo && runningInfo.processInfo.issueNumber) {
      try {
        await this.lockManager.releaseLock(
          runningInfo.processInfo.issueNumber, 
          runningInfo.processInfo.pid || process.pid
        );
      } catch (error) {
        console.error(`Failed to release lock for Issue #${runningInfo.processInfo.issueNumber}:`, error);
      }
    }
    
    this.runningTasks.delete(taskId);
    
    // 統計を更新
    if (success) {
      this.stats.totalProcessed++;
    } else {
      this.stats.totalFailed++;
    }
    
    const duration = Date.now() - runningInfo.startedAt;
    this.emit('taskCompleted', { taskId, success, duration });
  }

  /**
   * 実行可能かチェック
   */
  canExecute() {
    return this.runningTasks.size < this.maxConcurrent;
  }

  /**
   * キューのサイズを取得
   */
  getQueueSize() {
    return Object.values(this.queues)
      .reduce((total, queue) => total + queue.length, 0);
  }

  /**
   * タスクがキューに存在するかチェック
   */
  isTaskInQueue(taskId) {
    for (const queue of Object.values(this.queues)) {
      if (queue.some(task => task.id === taskId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * 同じIssue/Commentのタスクが存在するかチェック
   * キューと実行中の両方をチェックする包括的なメソッド
   */
  hasDuplicateTask(task) {
    // Issue番号でチェック
    if (task.type === 'issue' && task.issueNumber) {
      for (const queue of Object.values(this.queues)) {
        if (queue.some(t => t.type === 'issue' && t.issueNumber === task.issueNumber)) {
          return true;
        }
      }
      // 実行中のタスクもチェック
      for (const runningInfo of this.runningTasks.values()) {
        if (runningInfo.processInfo && runningInfo.processInfo.issueNumber === task.issueNumber) {
          return true;
        }
      }
    }
    
    // コメントタスクの重複チェック
    if (task.type === 'comment' && task.issueNumber && task.comment && task.comment.id) {
      for (const queue of Object.values(this.queues)) {
        if (queue.some(t => 
          t.type === 'comment' && 
          t.issueNumber === task.issueNumber && 
          t.comment && 
          t.comment.id === task.comment.id
        )) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * 優先度名を取得
   */
  getPriorityName(priority) {
    const names = {
      [this.PRIORITY_LEVELS.DOGFOODING]: 'DOGFOODING',
      [this.PRIORITY_LEVELS.HIGH]: 'HIGH',
      [this.PRIORITY_LEVELS.NORMAL]: 'NORMAL',
      [this.PRIORITY_LEVELS.LOW]: 'LOW'
    };
    return names[priority] || 'UNKNOWN';
  }

  /**
   * キューの状態を取得
   */
  getStatus() {
    const queueStatus = {};
    Object.entries(this.queues).forEach(([priority, queue]) => {
      queueStatus[this.getPriorityName(parseInt(priority))] = queue.length;
    });
    
    return {
      running: this.runningTasks.size,
      queued: this.getQueueSize(),
      queuesByPriority: queueStatus,
      stats: this.stats
    };
  }

  /**
   * 特定のタスクを削除
   */
  removeTask(taskId) {
    for (const queue of Object.values(this.queues)) {
      const index = queue.findIndex(task => task.id === taskId);
      if (index !== -1) {
        queue.splice(index, 1);
        console.log(`🗑️  タスクをキューから削除: ${taskId}`);
        return true;
      }
    }
    return false;
  }

  /**
   * すべてのキューをクリア
   */
  clear() {
    Object.keys(this.queues).forEach(priority => {
      this.queues[priority] = [];
    });
    console.log('🧹 すべてのキューをクリアしました');
  }

  /**
   * キュー内の保留中のIssue番号リストを取得
   * （下位互換性のために保持）
   */
  getPendingIssues() {
    const issueNumbers = [];
    const allTasks = this.getAllPendingTasks();
    
    for (const task of allTasks) {
      if (task.type === 'issue' && task.issueNumber) {
        issueNumbers.push(task.issueNumber);
      }
    }
    
    return issueNumbers;
  }

  /**
   * すべての保留中タスクを取得（永続化用）
   */
  getAllPendingTasks() {
    const allTasks = [];
    
    // 優先度の高い順にタスクを収集
    const priorities = Object.keys(this.queues)
      .map(p => parseInt(p))
      .sort((a, b) => b - a);
    
    for (const priority of priorities) {
      const queue = this.queues[priority];
      if (queue && queue.length > 0) {
        allTasks.push(...queue);
      }
    }
    
    return allTasks;
  }

  /**
   * 保存されたタスクを復元
   */
  restoreTasks(tasks) {
    if (!Array.isArray(tasks)) {
      console.warn('復元するタスクが配列ではありません');
      return;
    }
    
    let restoredCount = 0;
    
    for (const task of tasks) {
      try {
        // タスクの整合性チェック
        if (!task || typeof task !== 'object') {
          console.warn('無効なタスクをスキップ:', task);
          continue;
        }
        
        // 優先度が設定されていない場合は再計算
        if (task.priority === undefined) {
          task.priority = this.determinePriority(task);
        }
        
        // キューに追加
        if (!this.queues[task.priority]) {
          this.queues[task.priority] = [];
        }
        this.queues[task.priority].push(task);
        restoredCount++;
      } catch (error) {
        console.error(`タスク復元エラー: ${error.message}`, task);
      }
    }
    
    console.log(`📥 ${restoredCount}個のタスクを復元しました`);
  }
}

module.exports = TaskQueue;