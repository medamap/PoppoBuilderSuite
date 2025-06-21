/**
 * CCSP高度なキュー管理システム
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * 優先度ベースのキュー管理とスケジューリング機能を提供
 */

const EventEmitter = require('events');
const Logger = require('../../src/logger');

class AdvancedQueueManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.logger = new Logger('AdvancedQueueManager');
    this.config = {
      maxQueueSize: options.maxQueueSize || 10000,
      schedulerInterval: options.schedulerInterval || 5000, // 5秒間隔
      priorityWeights: {
        urgent: 1000,
        high: 100,
        normal: 10,
        low: 1
      },
      ...options
    };
    
    // 優先度別キュー
    this.queues = {
      urgent: [],      // 緊急タスク（即座実行）
      high: [],        // 高優先度
      normal: [],      // 通常優先度
      low: [],         // 低優先度
      scheduled: []    // スケジュール実行
    };
    
    // 統計情報
    this.stats = {
      totalProcessed: 0,
      byPriority: {
        urgent: 0,
        high: 0,
        normal: 0,
        low: 0,
        scheduled: 0
      },
      averageWaitTime: 0,
      currentQueueSize: 0
    };
    
    // 状態管理
    this.isPaused = false;
    this.isSchedulerRunning = false;
    
    // スケジューラー開始
    this.startScheduler();
    
    this.logger.info('Advanced Queue Manager initialized', {
      maxQueueSize: this.config.maxQueueSize,
      schedulerInterval: this.config.schedulerInterval
    });
  }
  
  /**
   * タスクをキューに追加
   * @param {Object} task - タスクオブジェクト
   * @param {string} priority - 優先度 (urgent, high, normal, low)
   * @param {Date|number} executeAt - スケジュール実行時刻（オプション）
   */
  async enqueue(task, priority = 'normal', executeAt = null) {
    if (this.getTotalQueueSize() >= this.config.maxQueueSize) {
      throw new Error('Queue is full');
    }
    
    // タスクにメタデータを追加
    const enrichedTask = {
      ...task,
      priority,
      enqueuedAt: new Date(),
      executeAt: executeAt ? new Date(executeAt) : null,
      id: task.requestId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    };
    
    if (executeAt) {
      // スケジュール実行
      this.queues.scheduled.push(enrichedTask);
      this.queues.scheduled.sort((a, b) => new Date(a.executeAt) - new Date(b.executeAt));
      this.logger.info('Task scheduled', {
        taskId: enrichedTask.id,
        executeAt: enrichedTask.executeAt,
        scheduledQueueSize: this.queues.scheduled.length
      });
    } else {
      // 即座キューに追加
      this.queues[priority].push(enrichedTask);
      this.logger.info('Task enqueued', {
        taskId: enrichedTask.id,
        priority,
        queueSize: this.queues[priority].length
      });
    }
    
    this.updateStats();
    this.emit('taskEnqueued', enrichedTask);
    
    return enrichedTask.id;
  }
  
  /**
   * 次のタスクを取得（優先度順）
   */
  async dequeue() {
    if (this.isPaused) {
      return null;
    }
    
    // 優先度順で確認
    const priorities = ['urgent', 'high', 'normal', 'low'];
    
    for (const priority of priorities) {
      if (this.queues[priority].length > 0) {
        const task = this.queues[priority].shift();
        
        // 待機時間を計算
        const waitTime = Date.now() - new Date(task.enqueuedAt).getTime();
        task.waitTime = waitTime;
        
        this.stats.totalProcessed++;
        this.stats.byPriority[priority]++;
        this.updateAverageWaitTime(waitTime);
        
        this.logger.info('Task dequeued', {
          taskId: task.id,
          priority,
          waitTime: `${waitTime}ms`,
          remainingInQueue: this.queues[priority].length
        });
        
        this.updateStats();
        this.emit('taskDequeued', task);
        
        return task;
      }
    }
    
    return null; // キューが空
  }
  
  /**
   * 特定のタスクを削除
   * @param {string} taskId - タスクID
   */
  async removeTask(taskId) {
    let removed = false;
    
    for (const [priority, queue] of Object.entries(this.queues)) {
      const index = queue.findIndex(task => task.id === taskId);
      if (index !== -1) {
        const task = queue.splice(index, 1)[0];
        this.logger.info('Task removed from queue', {
          taskId,
          priority,
          remainingInQueue: queue.length
        });
        this.emit('taskRemoved', task);
        removed = true;
        break;
      }
    }
    
    this.updateStats();
    return removed;
  }
  
  /**
   * キューの一時停止
   */
  pause() {
    this.isPaused = true;
    this.logger.warn('Queue paused');
    this.emit('queuePaused');
  }
  
  /**
   * キューの再開
   */
  resume() {
    this.isPaused = false;
    this.logger.info('Queue resumed');
    this.emit('queueResumed');
  }
  
  /**
   * 指定した優先度のキューをクリア
   * @param {string} priority - 優先度（'all'で全キューをクリア）
   */
  clearQueue(priority = 'all') {
    if (priority === 'all') {
      const totalCleared = this.getTotalQueueSize();
      for (const key of Object.keys(this.queues)) {
        this.queues[key] = [];
      }
      this.logger.warn('All queues cleared', { totalCleared });
      this.emit('allQueuesCleared', totalCleared);
    } else if (this.queues[priority]) {
      const cleared = this.queues[priority].length;
      this.queues[priority] = [];
      this.logger.warn('Queue cleared', { priority, cleared });
      this.emit('queueCleared', { priority, cleared });
    }
    
    this.updateStats();
  }
  
  /**
   * キューの状態取得
   */
  getStatus() {
    return {
      isPaused: this.isPaused,
      queues: Object.fromEntries(
        Object.entries(this.queues).map(([priority, queue]) => [
          priority,
          {
            size: queue.length,
            oldestTask: queue.length > 0 ? queue[0].enqueuedAt : null,
            newestTask: queue.length > 0 ? queue[queue.length - 1].enqueuedAt : null
          }
        ])
      ),
      stats: { ...this.stats },
      totalQueueSize: this.getTotalQueueSize()
    };
  }
  
  /**
   * 統計情報の取得
   */
  getStats() {
    return {
      ...this.stats,
      currentQueueSizes: Object.fromEntries(
        Object.entries(this.queues).map(([priority, queue]) => [priority, queue.length])
      ),
      totalQueueSize: this.getTotalQueueSize(),
      processingRate: this.calculateProcessingRate()
    };
  }
  
  /**
   * タスクの予想待機時間を計算
   * @param {string} priority - 優先度
   */
  getEstimatedWaitTime(priority) {
    const queuePosition = this.queues[priority].length;
    const avgProcessingTime = this.stats.averageProcessingTime || 30000; // デフォルト30秒
    
    // 高優先度キューのタスク数も考慮
    let totalAheadTasks = 0;
    const priorities = ['urgent', 'high', 'normal', 'low'];
    const currentPriorityIndex = priorities.indexOf(priority);
    
    for (let i = 0; i <= currentPriorityIndex; i++) {
      totalAheadTasks += this.queues[priorities[i]].length;
    }
    
    return totalAheadTasks * avgProcessingTime;
  }
  
  /**
   * スケジューラーの開始
   */
  startScheduler() {
    if (this.isSchedulerRunning) return;
    
    this.isSchedulerRunning = true;
    this.schedulerInterval = setInterval(() => {
      this.processScheduledTasks();
    }, this.config.schedulerInterval);
    
    this.logger.info('Scheduler started', {
      interval: this.config.schedulerInterval
    });
  }
  
  /**
   * スケジューラーの停止
   */
  stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
      this.isSchedulerRunning = false;
      this.logger.info('Scheduler stopped');
    }
  }
  
  /**
   * スケジュールされたタスクの処理
   */
  processScheduledTasks() {
    if (this.isPaused) return;
    
    const now = new Date();
    const readyTasks = [];
    
    // 実行時刻が来たタスクを抽出
    this.queues.scheduled = this.queues.scheduled.filter(task => {
      if (new Date(task.executeAt) <= now) {
        readyTasks.push(task);
        return false;
      }
      return true;
    });
    
    // 準備ができたタスクを適切なキューに移動
    for (const task of readyTasks) {
      this.queues[task.priority].push({
        ...task,
        executeAt: null, // スケジュール実行フラグを削除
        movedFromScheduled: true
      });
      
      this.logger.info('Scheduled task moved to execution queue', {
        taskId: task.id,
        priority: task.priority,
        originalExecuteAt: task.executeAt
      });
      
      this.emit('scheduledTaskReady', task);
    }
    
    if (readyTasks.length > 0) {
      this.updateStats();
    }
  }
  
  /**
   * 総キューサイズの取得
   */
  getTotalQueueSize() {
    return Object.values(this.queues).reduce((total, queue) => total + queue.length, 0);
  }
  
  /**
   * 統計情報の更新
   */
  updateStats() {
    this.stats.currentQueueSize = this.getTotalQueueSize();
    this.emit('statsUpdated', this.stats);
  }
  
  /**
   * 平均待機時間の更新
   */
  updateAverageWaitTime(newWaitTime) {
    if (this.stats.totalProcessed === 1) {
      this.stats.averageWaitTime = newWaitTime;
    } else {
      // 移動平均の計算
      const alpha = 0.1; // 平滑化係数
      this.stats.averageWaitTime = 
        alpha * newWaitTime + (1 - alpha) * this.stats.averageWaitTime;
    }
  }
  
  /**
   * 処理レートの計算
   */
  calculateProcessingRate() {
    // 過去1分間の処理数（実装簡略化）
    return this.stats.totalProcessed > 0 ? 
      Math.round(this.stats.totalProcessed / ((Date.now() - this.startTime) / 60000)) : 0;
  }
  
  /**
   * クリーンアップ
   */
  async shutdown() {
    this.stopScheduler();
    this.logger.info('Advanced Queue Manager shutdown', {
      totalProcessed: this.stats.totalProcessed,
      remainingTasks: this.getTotalQueueSize()
    });
  }
}

module.exports = AdvancedQueueManager;