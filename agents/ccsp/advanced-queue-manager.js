/**
 * Advanced Queue Manager for CCSP
 * Provides priority-based queue management, scheduling, and advanced control features
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class AdvancedQueueManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxQueueSize: options.maxQueueSize || 1000,
      persistPath: options.persistPath || path.join(__dirname, '.poppobuilder/ccsp/queues'),
      schedulerInterval: options.schedulerInterval || 10000, // 10秒ごとにスケジュールチェック
      ...options
    };
    
    // 優先度別キュー
    this.queues = {
      urgent: [],      // 緊急タスク（即座に実行）
      high: [],        // 高優先度（通常の2倍速）
      normal: [],      // 通常優先度
      low: [],         // 低優先度（アイドル時のみ）
      scheduled: []    // スケジュール実行
    };
    
    // キューの統計情報
    this.stats = {
      totalProcessed: 0,
      byPriority: {
        urgent: 0,
        high: 0,
        normal: 0,
        low: 0,
        scheduled: 0
      },
      avgProcessingTime: 0,
      lastProcessedAt: null
    };
    
    // キューの状態
    this.state = {
      paused: false,
      pausedAt: null,
      pausedBy: null,
      throttleDelay: 0,
      maxConcurrent: 1
    };
    
    // スケジューラー
    this.schedulerTimer = null;
    
    // 初期化
    this.initialize();
  }
  
  async initialize() {
    try {
      // 永続化ディレクトリの作成
      await fs.mkdir(this.options.persistPath, { recursive: true });
      
      // 既存のキューを読み込み
      await this.loadQueues();
      
      // スケジューラーの開始
      this.startScheduler();
      
      this.emit('initialized');
    } catch (error) {
      this.emit('error', error);
    }
  }
  
  /**
   * タスクをキューに追加
   * @param {Object} task - タスクオブジェクト
   * @param {string} task.id - タスクID
   * @param {string} task.type - タスクタイプ
   * @param {Object} task.data - タスクデータ
   * @param {string} priority - 優先度 (urgent/high/normal/low)
   * @param {Date} scheduleAt - スケジュール実行時刻（オプション）
   */
  async enqueue(task, priority = 'normal', scheduleAt = null) {
    if (\!task || \!task.id) {
      throw new Error('Invalid task: id is required');
    }
    
    // キューサイズチェック
    const totalSize = this.getTotalQueueSize();
    if (totalSize >= this.options.maxQueueSize) {
      throw new Error(`Queue size limit exceeded: ${totalSize}/${this.options.maxQueueSize}`);
    }
    
    // タスクに追加情報を付与
    const enrichedTask = {
      ...task,
      priority,
      enqueuedAt: new Date().toISOString(),
      scheduleAt: scheduleAt ? new Date(scheduleAt).toISOString() : null,
      attempts: 0,
      status: 'queued'
    };
    
    // 適切なキューに追加
    if (scheduleAt && new Date(scheduleAt) > new Date()) {
      this.queues.scheduled.push(enrichedTask);
      this.emit('task:scheduled', enrichedTask);
    } else {
      if (\!this.queues[priority]) {
        throw new Error(`Invalid priority: ${priority}`);
      }
      this.queues[priority].push(enrichedTask);
      this.emit('task:enqueued', enrichedTask);
    }
    
    // キューを永続化
    await this.saveQueues();
    
    return enrichedTask;
  }
  
  /**
   * 次のタスクを取得（優先度を考慮）
   * @returns {Object|null} タスクまたはnull
   */
  async getNextTask() {
    if (this.state.paused) {
      return null;
    }
    
    // スケジュールされたタスクをチェック
    this.processScheduledTasks();
    
    // 優先度順にチェック
    const priorities = ['urgent', 'high', 'normal', 'low'];
    
    for (const priority of priorities) {
      if (this.queues[priority].length > 0) {
        const task = this.queues[priority].shift();
        task.status = 'processing';
        task.startedAt = new Date().toISOString();
        
        await this.saveQueues();
        this.emit('task:dequeued', task);
        
        return task;
      }
    }
    
    return null;
  }
  
  /**
   * タスクの完了を記録
   * @param {string} taskId - タスクID
   * @param {Object} result - 実行結果
   */
  async completeTask(taskId, result = {}) {
    const completedAt = new Date();
    
    // 統計情報の更新
    this.stats.totalProcessed++;
    this.stats.lastProcessedAt = completedAt.toISOString();
    
    // 処理時間の計算（簡易版）
    if (result.startedAt) {
      const processingTime = completedAt - new Date(result.startedAt);
      this.updateAverageProcessingTime(processingTime);
    }
    
    // 優先度別の統計
    if (result.priority && this.stats.byPriority[result.priority] \!== undefined) {
      this.stats.byPriority[result.priority]++;
    }
    
    await this.saveStats();
    this.emit('task:completed', { taskId, result });
  }
  
  /**
   * タスクの失敗を記録
   * @param {string} taskId - タスクID
   * @param {Error} error - エラーオブジェクト
   * @param {Object} task - タスクオブジェクト
   */
  async failTask(taskId, error, task) {
    if (task && task.attempts < 3) {
      // リトライ
      task.attempts++;
      task.status = 'retry';
      task.lastError = error.message;
      
      // 優先度を下げてリキュー
      const retryPriority = task.priority === 'urgent' ? 'high' : 
                          task.priority === 'high' ? 'normal' : 'low';
      
      await this.enqueue(task, retryPriority);
      this.emit('task:retry', { taskId, attempts: task.attempts });
    } else {
      // 最終的に失敗
      this.emit('task:failed', { taskId, error: error.message });
    }
  }
  
  /**
   * スケジュールされたタスクを処理
   */
  processScheduledTasks() {
    const now = new Date();
    const readyTasks = [];
    
    // 実行時刻に達したタスクを取得
    this.queues.scheduled = this.queues.scheduled.filter(task => {
      if (new Date(task.scheduleAt) <= now) {
        readyTasks.push(task);
        return false;
      }
      return true;
    });
    
    // 優先度キューに移動
    for (const task of readyTasks) {
      const priority = task.priority || 'normal';
      this.queues[priority].push(task);
      this.emit('task:scheduled:ready', task);
    }
  }
  
  /**
   * スケジューラーの開始
   */
  startScheduler() {
    if (this.schedulerTimer) {
      return;
    }
    
    this.schedulerTimer = setInterval(() => {
      this.processScheduledTasks();
    }, this.options.schedulerInterval);
  }
  
  /**
   * スケジューラーの停止
   */
  stopScheduler() {
    if (this.schedulerTimer) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }
  
  /**
   * キューの一時停止
   * @param {string} reason - 一時停止の理由
   */
  async pause(reason = 'Manual pause') {
    this.state.paused = true;
    this.state.pausedAt = new Date().toISOString();
    this.state.pausedBy = reason;
    
    await this.saveState();
    this.emit('queue:paused', { reason });
  }
  
  /**
   * キューの再開
   */
  async resume() {
    this.state.paused = false;
    this.state.pausedAt = null;
    this.state.pausedBy = null;
    
    await this.saveState();
    this.emit('queue:resumed');
  }
  
  /**
   * スロットリング設定
   * @param {number} delay - 遅延時間（ミリ秒）
   */
  async setThrottle(delay) {
    this.state.throttleDelay = Math.max(0, delay);
    await this.saveState();
    this.emit('throttle:updated', { delay });
  }
  
  /**
   * 同時実行数の設定
   * @param {number} count - 同時実行数
   */
  async setConcurrency(count) {
    this.state.maxConcurrent = Math.max(1, count);
    await this.saveState();
    this.emit('concurrency:updated', { count });
  }
  
  /**
   * キューのクリア
   * @param {string} priority - クリアする優先度（省略時は全て）
   */
  async clearQueue(priority = null) {
    if (priority) {
      if (\!this.queues[priority]) {
        throw new Error(`Invalid priority: ${priority}`);
      }
      const count = this.queues[priority].length;
      this.queues[priority] = [];
      this.emit('queue:cleared', { priority, count });
    } else {
      let totalCount = 0;
      for (const p of Object.keys(this.queues)) {
        totalCount += this.queues[p].length;
        this.queues[p] = [];
      }
      this.emit('queue:cleared', { priority: 'all', count: totalCount });
    }
    
    await this.saveQueues();
  }
  
  /**
   * キューの状態を取得
   */
  getQueueStatus() {
    const status = {
      state: this.state,
      queues: {},
      stats: this.stats,
      totalSize: 0
    };
    
    for (const [priority, queue] of Object.entries(this.queues)) {
      status.queues[priority] = {
        size: queue.length,
        oldest: queue[0] ? queue[0].enqueuedAt : null,
        newest: queue[queue.length - 1] ? queue[queue.length - 1].enqueuedAt : null
      };
      status.totalSize += queue.length;
    }
    
    return status;
  }
  
  /**
   * 全キューサイズの取得
   */
  getTotalQueueSize() {
    return Object.values(this.queues).reduce((total, queue) => total + queue.length, 0);
  }
  
  /**
   * 平均処理時間の更新
   */
  updateAverageProcessingTime(newTime) {
    const count = this.stats.totalProcessed;
    const currentAvg = this.stats.avgProcessingTime;
    
    // 移動平均の計算
    this.stats.avgProcessingTime = ((currentAvg * (count - 1)) + newTime) / count;
  }
  
  /**
   * キューの永続化
   */
  async saveQueues() {
    try {
      const data = JSON.stringify(this.queues, null, 2);
      await fs.writeFile(path.join(this.options.persistPath, 'queues.json'), data);
    } catch (error) {
      this.emit('error', { type: 'save:queues', error });
    }
  }
  
  /**
   * キューの読み込み
   */
  async loadQueues() {
    try {
      const filePath = path.join(this.options.persistPath, 'queues.json');
      const data = await fs.readFile(filePath, 'utf8');
      this.queues = JSON.parse(data);
    } catch (error) {
      if (error.code \!== 'ENOENT') {
        this.emit('error', { type: 'load:queues', error });
      }
    }
  }
  
  /**
   * 状態の永続化
   */
  async saveState() {
    try {
      const data = JSON.stringify(this.state, null, 2);
      await fs.writeFile(path.join(this.options.persistPath, 'state.json'), data);
    } catch (error) {
      this.emit('error', { type: 'save:state', error });
    }
  }
  
  /**
   * 統計情報の永続化
   */
  async saveStats() {
    try {
      const data = JSON.stringify(this.stats, null, 2);
      await fs.writeFile(path.join(this.options.persistPath, 'stats.json'), data);
    } catch (error) {
      this.emit('error', { type: 'save:stats', error });
    }
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    this.stopScheduler();
    await this.saveQueues();
    await this.saveState();
    await this.saveStats();
  }
}

module.exports = AdvancedQueueManager;
EOF < /dev/null