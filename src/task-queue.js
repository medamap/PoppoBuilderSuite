const EventEmitter = require('events');

/**
 * 優先度付きタスクキュー
 */
class TaskQueue extends EventEmitter {
  constructor(config = {}) {
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
    
    // 統計情報
    this.stats = {
      totalEnqueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      byPriority: {}
    };
    
    // 優先度ごとの統計を初期化
    Object.values(this.PRIORITY_LEVELS).forEach(level => {
      this.stats.byPriority[level] = {
        enqueued: 0,
        processed: 0,
        failed: 0,
        averageWaitTime: 0
      };
    });
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
  enqueue(task) {
    // キューサイズチェック
    const totalSize = this.getQueueSize();
    if (totalSize >= this.maxQueueSize) {
      throw new Error(`Queue is full (${totalSize}/${this.maxQueueSize})`);
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
  startTask(taskId, processInfo) {
    this.runningTasks.set(taskId, {
      startedAt: Date.now(),
      processInfo
    });
    
    this.emit('taskStarted', { taskId, processInfo });
  }

  /**
   * タスクの実行を完了
   */
  completeTask(taskId, success = true) {
    const runningInfo = this.runningTasks.get(taskId);
    if (!runningInfo) return;
    
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
}

module.exports = TaskQueue;