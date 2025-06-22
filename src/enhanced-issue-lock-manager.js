/**
 * Enhanced Issue Lock Manager
 * Issue #130: 並行処理ロック機構の改善とデッドロック対策
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

class EnhancedIssueLockManager extends EventEmitter {
  constructor(lockDir = '.poppo/locks', logger = console) {
    super();
    this.lockDir = lockDir;
    this.logger = logger;
    this.locks = new Map(); // メモリキャッシュ
    this.waitingQueue = new Map(); // issueNumber -> Array of waiting tasks
    this.lockDependencies = new Map(); // PID -> Set of waiting issue numbers
    
    // 設定
    this.defaultTTL = 3600000; // 1時間
    this.cleanupInterval = 300000; // 5分ごとにクリーンアップ
    this.lockTimeout = 30000; // 30秒のロック取得タイムアウト
    this.deadlockCheckInterval = 60000; // 1分ごとにデッドロックチェック
    this.maxRetries = 3; // ロック取得の最大リトライ回数
    this.retryDelay = 1000; // リトライ間隔（ミリ秒）
    
    // タイマー
    this.cleanupTimer = null;
    this.deadlockTimer = null;
    
    // 統計情報
    this.stats = {
      lockAcquired: 0,
      lockReleased: 0,
      lockTimeout: 0,
      lockConflict: 0,
      deadlockDetected: 0,
      queueWaiting: 0
    };
  }

  async initialize() {
    try {
      await fs.mkdir(this.lockDir, { recursive: true });
      await this.loadExistingLocks();
      this.startCleanupTimer();
      this.startDeadlockDetection();
      this.logger.info('EnhancedIssueLockManager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize EnhancedIssueLockManager:', error);
      throw error;
    }
  }

  /**
   * タイムアウト付きロック取得
   */
  async acquireLockWithTimeout(issueNumber, lockInfo = {}, timeout = null) {
    const actualTimeout = timeout || this.lockTimeout;
    const startTime = Date.now();
    
    // タイムアウト用のPromise
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Lock acquisition timeout for Issue #${issueNumber} after ${actualTimeout}ms`));
      }, actualTimeout);
    });
    
    // ロック取得用のPromise
    const lockPromise = this._acquireLockWithRetry(issueNumber, lockInfo);
    
    try {
      const result = await Promise.race([lockPromise, timeoutPromise]);
      const duration = Date.now() - startTime;
      this.logger.info(`Lock acquired for Issue #${issueNumber} in ${duration}ms`);
      return result;
    } catch (error) {
      this.stats.lockTimeout++;
      this.emit('lock-timeout', { issueNumber, timeout: actualTimeout, error });
      throw error;
    }
  }

  /**
   * リトライ機構付きロック取得
   */
  async _acquireLockWithRetry(issueNumber, lockInfo = {}) {
    let lastError = null;
    
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const acquired = await this._attemptLockAcquisition(issueNumber, lockInfo);
        if (acquired) {
          this.stats.lockAcquired++;
          return true;
        }
        
        // ロックが取得できない場合は待機キューに追加
        return await this._waitForLock(issueNumber, lockInfo);
        
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries - 1) {
          // 指数バックオフでリトライ
          const delay = this.retryDelay * Math.pow(2, attempt);
          this.logger.debug(`Retrying lock acquisition for Issue #${issueNumber} after ${delay}ms (attempt ${attempt + 1}/${this.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError || new Error(`Failed to acquire lock for Issue #${issueNumber} after ${this.maxRetries} attempts`);
  }

  /**
   * ロック取得の実際の処理
   */
  async _attemptLockAcquisition(issueNumber, lockInfo = {}) {
    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      // 既存のロックをチェック
      const existingLock = await this.checkLock(issueNumber);
      if (existingLock && this.isLockValid(existingLock)) {
        this.stats.lockConflict++;
        this.logger.debug(`Issue #${issueNumber} is already locked by PID ${existingLock.lockedBy.pid}`);
        return false;
      }

      // 新しいロックデータ
      const lockData = {
        issueNumber,
        lockedAt: new Date().toISOString(),
        lockedBy: {
          pid: lockInfo.pid || process.pid,
          sessionId: lockInfo.sessionId || process.env.CLAUDE_SESSION_ID || `session_${Date.now()}`,
          taskId: lockInfo.taskId || `issue-${issueNumber}`,
          hostname: os.hostname()
        },
        type: lockInfo.type || 'issue_processing',
        ttl: lockInfo.ttl || this.defaultTTL,
        expiresAt: new Date(Date.now() + (lockInfo.ttl || this.defaultTTL)).toISOString(),
        priority: lockInfo.priority || 'normal'
      };

      // ロックファイルの作成（アトミック操作）
      await fs.writeFile(lockFile, JSON.stringify(lockData, null, 2), { flag: 'wx' });
      
      // メモリキャッシュに保存
      this.locks.set(issueNumber, lockData);
      
      // 待機キューの処理
      this._processWaitingQueue(issueNumber);
      
      this.emit('lock-acquired', { issueNumber, lockData });
      return true;
      
    } catch (error) {
      if (error.code === 'EEXIST') {
        // ロックファイルが既に存在する
        return false;
      }
      throw error;
    }
  }

  /**
   * ロック待機キューに追加して待機
   */
  async _waitForLock(issueNumber, lockInfo) {
    return new Promise((resolve, reject) => {
      const waitingTask = {
        resolve,
        reject,
        lockInfo,
        timestamp: Date.now(),
        pid: lockInfo.pid || process.pid
      };
      
      // 待機キューに追加
      if (!this.waitingQueue.has(issueNumber)) {
        this.waitingQueue.set(issueNumber, []);
      }
      this.waitingQueue.get(issueNumber).push(waitingTask);
      
      // デッドロック検出用の依存関係を記録
      const pid = lockInfo.pid || process.pid;
      if (!this.lockDependencies.has(pid)) {
        this.lockDependencies.set(pid, new Set());
      }
      this.lockDependencies.get(pid).add(issueNumber);
      
      this.stats.queueWaiting++;
      this.emit('lock-waiting', { issueNumber, queueLength: this.waitingQueue.get(issueNumber).length });
      
      this.logger.debug(`Task added to waiting queue for Issue #${issueNumber} (queue length: ${this.waitingQueue.get(issueNumber).length})`);
    });
  }

  /**
   * ロック解放
   */
  async releaseLock(issueNumber, pid = process.pid) {
    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      const lockData = await this.checkLock(issueNumber);
      
      if (!lockData) {
        this.logger.warn(`No lock found for Issue #${issueNumber}`);
        return false;
      }

      // PIDチェック（自分のロックか確認）
      if (lockData.lockedBy.pid !== pid) {
        this.logger.warn(`Cannot release lock for Issue #${issueNumber}: locked by different PID ${lockData.lockedBy.pid}`);
        return false;
      }

      // ロックファイルの削除
      await fs.unlink(lockFile);
      
      // メモリキャッシュから削除
      this.locks.delete(issueNumber);
      
      // デッドロック検出用の依存関係をクリア
      if (this.lockDependencies.has(pid)) {
        this.lockDependencies.get(pid).delete(issueNumber);
        if (this.lockDependencies.get(pid).size === 0) {
          this.lockDependencies.delete(pid);
        }
      }
      
      this.stats.lockReleased++;
      this.emit('lock-released', { issueNumber, pid });
      this.logger.info(`Lock released for Issue #${issueNumber} by PID ${pid}`);
      
      // 待機キューの処理
      this._processWaitingQueue(issueNumber);
      
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // ファイルが存在しない
        this.locks.delete(issueNumber);
        this._processWaitingQueue(issueNumber);
        return true;
      }
      this.logger.error(`Failed to release lock for Issue #${issueNumber}:`, error);
      throw error;
    }
  }

  /**
   * 待機キューの処理
   */
  _processWaitingQueue(issueNumber) {
    const queue = this.waitingQueue.get(issueNumber);
    if (!queue || queue.length === 0) {
      return;
    }
    
    // 優先度に基づいてソート
    queue.sort((a, b) => {
      const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
      const aPriority = priorityOrder[a.lockInfo.priority || 'normal'];
      const bPriority = priorityOrder[b.lockInfo.priority || 'normal'];
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      // 同じ優先度の場合は待機時間順
      return a.timestamp - b.timestamp;
    });
    
    // 最高優先度のタスクのみ処理（1つずつ）
    const nextTask = queue.shift();
    if (nextTask) {
      this.stats.queueWaiting--;
      
      // 同期的にロック取得を試行
      try {
        const acquired = this._attemptLockAcquisition(issueNumber, nextTask.lockInfo);
        if (acquired) {
          nextTask.resolve(true);
        } else {
          // 再度キューに戻す
          queue.unshift(nextTask);
          this.stats.queueWaiting++;
        }
      } catch (error) {
        nextTask.reject(error);
      }
    }
    
    // キューが空になったら削除
    if (queue.length === 0) {
      this.waitingQueue.delete(issueNumber);
    }
  }

  /**
   * デッドロック検出
   */
  async detectDeadlocks() {
    const activeLocks = await this.getActiveLocks();
    const locksByPid = new Map();
    
    // PIDごとに保持しているロックを整理
    for (const lock of activeLocks) {
      const pid = lock.lockedBy.pid;
      if (!locksByPid.has(pid)) {
        locksByPid.set(pid, new Set());
      }
      locksByPid.get(pid).add(lock.issueNumber);
    }
    
    // 循環依存をチェック
    const visited = new Set();
    const recursionStack = new Set();
    
    for (const [pid, waiting] of this.lockDependencies) {
      if (this._hasCycle(pid, locksByPid, this.lockDependencies, visited, recursionStack)) {
        this.stats.deadlockDetected++;
        this.logger.error(`Deadlock detected involving PID ${pid}`);
        this.emit('deadlock-detected', { pid, locks: locksByPid.get(pid), waiting });
        
        // デッドロック解決：最も古いロックを強制解放
        await this._resolveDeadlock(pid, locksByPid);
      }
    }
  }

  /**
   * 循環依存の検出（DFSアルゴリズム）
   */
  _hasCycle(node, locksByPid, dependencies, visited, recursionStack) {
    visited.add(node);
    recursionStack.add(node);
    
    const waiting = dependencies.get(node) || new Set();
    for (const issueNumber of waiting) {
      // このIssueをロックしているPIDを探す
      for (const [pid, locks] of locksByPid) {
        if (locks.has(issueNumber)) {
          if (!visited.has(pid)) {
            if (this._hasCycle(pid, locksByPid, dependencies, visited, recursionStack)) {
              return true;
            }
          } else if (recursionStack.has(pid)) {
            return true;
          }
        }
      }
    }
    
    recursionStack.delete(node);
    return false;
  }

  /**
   * デッドロック解決
   */
  async _resolveDeadlock(pid, locksByPid) {
    const locks = Array.from(locksByPid.get(pid) || []);
    if (locks.length === 0) return;
    
    // 最も古いロックを見つける
    let oldestLock = null;
    let oldestTime = Date.now();
    
    for (const issueNumber of locks) {
      const lockData = await this.checkLock(issueNumber);
      if (lockData) {
        const lockTime = new Date(lockData.lockedAt).getTime();
        if (lockTime < oldestTime) {
          oldestTime = lockTime;
          oldestLock = issueNumber;
        }
      }
    }
    
    if (oldestLock !== null) {
      this.logger.warn(`Resolving deadlock by releasing lock for Issue #${oldestLock}`);
      await this.forceReleaseLock(oldestLock);
    }
  }

  /**
   * ロック状態の可視化
   */
  async getLockStatus() {
    const activeLocks = await this.getActiveLocks();
    const waitingTasks = [];
    
    for (const [issueNumber, queue] of this.waitingQueue) {
      waitingTasks.push({
        issueNumber,
        queueLength: queue.length,
        tasks: queue.map(task => ({
          pid: task.pid,
          priority: task.lockInfo.priority || 'normal',
          waitingTime: Date.now() - task.timestamp
        }))
      });
    }
    
    return {
      activeLocks: activeLocks.map(lock => ({
        issueNumber: lock.issueNumber,
        pid: lock.lockedBy.pid,
        taskId: lock.lockedBy.taskId,
        lockedAt: lock.lockedAt,
        expiresAt: lock.expiresAt,
        ttl: lock.ttl
      })),
      waitingQueues: waitingTasks,
      stats: { ...this.stats },
      deadlockRisk: this.lockDependencies.size > 0
    };
  }

  /**
   * 定期的なデッドロックチェックを開始
   */
  startDeadlockDetection() {
    this.deadlockTimer = setInterval(() => {
      this.detectDeadlocks().catch(error => {
        this.logger.error('Error during deadlock detection:', error);
      });
    }, this.deadlockCheckInterval);
  }

  /**
   * デッドロックチェックを停止
   */
  stopDeadlockDetection() {
    if (this.deadlockTimer) {
      clearInterval(this.deadlockTimer);
      this.deadlockTimer = null;
    }
  }

  // 既存のメソッドは継承
  async checkLock(issueNumber) {
    // メモリキャッシュを先にチェック
    const cached = this.locks.get(issueNumber);
    if (cached && this.isLockValid(cached)) {
      return cached;
    }

    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      const data = await fs.readFile(lockFile, 'utf8');
      const lockData = JSON.parse(data);
      
      // メモリキャッシュを更新
      this.locks.set(issueNumber, lockData);
      
      return lockData;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // ファイルが存在しない
        this.locks.delete(issueNumber);
        return null;
      }
      if (error instanceof SyntaxError) {
        // 破損したロックファイル
        this.logger.warn(`Corrupted lock file for Issue #${issueNumber}, removing...`);
        await this.forceReleaseLock(issueNumber);
        return null;
      }
      throw error;
    }
  }

  isLockValid(lockData) {
    if (!lockData || !lockData.expiresAt) {
      return false;
    }

    // TTLチェック
    if (new Date(lockData.expiresAt) < new Date()) {
      return false;
    }

    // プロセス生存確認（同一ホストの場合のみ）
    if (lockData.lockedBy.hostname === os.hostname()) {
      try {
        // プロセスにシグナル0を送信して存在確認
        process.kill(lockData.lockedBy.pid, 0);
        return true;
      } catch (error) {
        // プロセスが存在しない
        return false;
      }
    }

    // 他のホストのロックは有効期限のみで判断
    return true;
  }

  async forceReleaseLock(issueNumber) {
    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      await fs.unlink(lockFile);
      this.locks.delete(issueNumber);
      this._processWaitingQueue(issueNumber);
      this.logger.debug(`Force released lock for Issue #${issueNumber}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.locks.delete(issueNumber);
        this._processWaitingQueue(issueNumber);
        return true;
      }
      throw error;
    }
  }

  async cleanup() {
    const lockFiles = await fs.readdir(this.lockDir);
    let cleaned = 0;

    for (const file of lockFiles) {
      if (!file.endsWith('.lock')) continue;

      const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
      if (isNaN(issueNumber)) continue;

      try {
        const lockData = await this.checkLock(issueNumber);
        if (lockData && !this.isLockValid(lockData)) {
          await this.forceReleaseLock(issueNumber);
          cleaned++;
        }
      } catch (error) {
        this.logger.error(`Error during cleanup of Issue #${issueNumber}:`, error);
      }
    }

    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} expired locks`);
    }
  }

  async loadExistingLocks() {
    try {
      const files = await fs.readdir(this.lockDir);
      for (const file of files) {
        if (file.endsWith('.lock')) {
          const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
          if (!isNaN(issueNumber)) {
            await this.checkLock(issueNumber);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('Error loading existing locks:', error);
      }
    }
  }

  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        this.logger.error('Error during periodic cleanup:', error);
      });
    }, this.cleanupInterval);
  }

  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  getLockFilePath(issueNumber) {
    return path.join(this.lockDir, `issue-${issueNumber}.lock`);
  }

  async releaseAllLocks(pid = process.pid) {
    const lockFiles = await fs.readdir(this.lockDir);
    let released = 0;

    for (const file of lockFiles) {
      if (!file.endsWith('.lock')) continue;

      const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
      if (isNaN(issueNumber)) continue;

      try {
        const lockData = await this.checkLock(issueNumber);
        if (lockData && lockData.lockedBy.pid === pid) {
          await this.releaseLock(issueNumber, pid);
          released++;
        }
      } catch (error) {
        this.logger.error(`Error releasing lock for Issue #${issueNumber}:`, error);
      }
    }

    this.logger.info(`Released ${released} locks for PID ${pid}`);
    return released;
  }

  async getActiveLocks() {
    await this.cleanup(); // 期限切れのロックをクリーンアップ

    const locks = [];
    const lockFiles = await fs.readdir(this.lockDir);

    for (const file of lockFiles) {
      if (!file.endsWith('.lock')) continue;

      const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
      if (isNaN(issueNumber)) continue;

      const lockData = await this.checkLock(issueNumber);
      if (lockData && this.isLockValid(lockData)) {
        locks.push(lockData);
      }
    }

    return locks;
  }

  async shutdown() {
    this.stopCleanupTimer();
    this.stopDeadlockDetection();
    
    // 待機中のタスクをすべて拒否
    for (const [issueNumber, queue] of this.waitingQueue) {
      for (const task of queue) {
        task.reject(new Error('Lock manager is shutting down'));
      }
    }
    this.waitingQueue.clear();
    this.lockDependencies.clear();
    
    await this.releaseAllLocks();
    this.logger.info('EnhancedIssueLockManager shut down');
  }
}

module.exports = EnhancedIssueLockManager;