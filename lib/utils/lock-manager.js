/**
 * Lock Manager
 * ファイルベースのロック機構を提供し、競合状態を防ぐ
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

class LockManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      lockTimeout: options.lockTimeout || 30000, // 30秒
      retryInterval: options.retryInterval || 100, // 100ms
      maxRetries: options.maxRetries || 50,
      lockDir: options.lockDir || path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'locks'),
      ...options
    };
    
    this.activeLocks = new Map();
    this.lockWaitQueues = new Map();
  }

  /**
   * Initialize lock manager
   */
  async initialize() {
    // ロックディレクトリの作成
    await fs.mkdir(this.options.lockDir, { recursive: true });
    
    // 既存のロックをクリーンアップ
    await this.cleanupStaleLocks();
  }

  /**
   * Acquire a lock
   * @param {string} resource - Resource identifier to lock
   * @param {Object} options - Lock options
   * @returns {Promise<string>} Lock ID
   */
  async acquire(resource, options = {}) {
    const lockId = crypto.randomUUID();
    const lockFile = this.getLockFilePath(resource);
    const timeout = options.timeout || this.options.lockTimeout;
    const retryInterval = options.retryInterval || this.options.retryInterval;
    const maxRetries = options.maxRetries || this.options.maxRetries;
    
    let retries = 0;
    
    while (retries < maxRetries) {
      try {
        // アトミックなロック取得を試みる
        const lockData = {
          id: lockId,
          pid: process.pid,
          hostname: require('os').hostname(),
          resource,
          acquiredAt: Date.now(),
          timeout,
          metadata: options.metadata || {}
        };
        
        // O_EXCL フラグで排他的にファイルを作成
        const fd = await fs.open(lockFile, 'wx');
        await fd.writeFile(JSON.stringify(lockData, null, 2));
        await fd.close();
        
        // ロック情報を記録
        this.activeLocks.set(resource, {
          id: lockId,
          file: lockFile,
          timeout: timeout,
          timeoutHandle: this.setupTimeout(resource, lockId, timeout)
        });
        
        this.emit('lock-acquired', { resource, lockId });
        return lockId;
        
      } catch (error) {
        if (error.code === 'EEXIST') {
          // ロックが既に存在する場合
          const existingLock = await this.checkExistingLock(lockFile);
          
          if (existingLock && this.isLockStale(existingLock)) {
            // 古いロックを削除
            await this.forceRelease(resource);
            continue;
          }
          
          // ウェイトキューに追加
          if (options.wait) {
            return await this.waitForLock(resource, lockId, options);
          }
          
          retries++;
          if (retries < maxRetries) {
            await this.sleep(retryInterval);
            continue;
          }
        }
        
        throw error;
      }
    }
    
    throw new Error(`Failed to acquire lock for resource: ${resource} after ${maxRetries} retries`);
  }

  /**
   * Release a lock
   * @param {string} resource - Resource identifier
   * @param {string} lockId - Lock ID
   */
  async release(resource, lockId) {
    const lockInfo = this.activeLocks.get(resource);
    
    if (!lockInfo || lockInfo.id !== lockId) {
      throw new Error(`Invalid lock ID for resource: ${resource}`);
    }
    
    try {
      // タイムアウトハンドラーをクリア
      if (lockInfo.timeoutHandle) {
        clearTimeout(lockInfo.timeoutHandle);
      }
      
      // ロックファイルを削除
      await fs.unlink(lockInfo.file);
      
      // 記録から削除
      this.activeLocks.delete(resource);
      
      this.emit('lock-released', { resource, lockId });
      
      // ウェイトキューの処理
      this.processWaitQueue(resource);
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Force release a lock (危険: 慎重に使用すること)
   * @param {string} resource - Resource identifier
   */
  async forceRelease(resource) {
    const lockFile = this.getLockFilePath(resource);
    
    try {
      await fs.unlink(lockFile);
      this.activeLocks.delete(resource);
      this.emit('lock-force-released', { resource });
      this.processWaitQueue(resource);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Check if a resource is locked
   * @param {string} resource - Resource identifier
   * @returns {Promise<boolean>}
   */
  async isLocked(resource) {
    const lockFile = this.getLockFilePath(resource);
    
    try {
      const stats = await fs.stat(lockFile);
      
      // ロックファイルが存在する場合、内容を確認
      const lockData = await this.checkExistingLock(lockFile);
      
      if (lockData && this.isLockStale(lockData)) {
        // 古いロックは削除
        await this.forceRelease(resource);
        return false;
      }
      
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Execute a function with lock
   * @param {string} resource - Resource identifier
   * @param {Function} fn - Function to execute
   * @param {Object} options - Lock options
   */
  async withLock(resource, fn, options = {}) {
    const lockId = await this.acquire(resource, options);
    
    try {
      return await fn();
    } finally {
      await this.release(resource, lockId);
    }
  }

  /**
   * Wait for lock to become available
   * @private
   */
  async waitForLock(resource, lockId, options) {
    return new Promise((resolve, reject) => {
      const timeout = options.waitTimeout || 60000; // 60秒
      
      // タイムアウトの設定
      const timeoutHandle = setTimeout(() => {
        this.removeFromWaitQueue(resource, lockId);
        reject(new Error(`Lock wait timeout for resource: ${resource}`));
      }, timeout);
      
      // ウェイトキューに追加
      if (!this.lockWaitQueues.has(resource)) {
        this.lockWaitQueues.set(resource, []);
      }
      
      this.lockWaitQueues.get(resource).push({
        lockId,
        resolve: async () => {
          clearTimeout(timeoutHandle);
          try {
            const newLockId = await this.acquire(resource, { ...options, wait: false });
            resolve(newLockId);
          } catch (error) {
            reject(error);
          }
        },
        reject,
        options
      });
    });
  }

  /**
   * Process wait queue for a resource
   * @private
   */
  processWaitQueue(resource) {
    const queue = this.lockWaitQueues.get(resource);
    if (!queue || queue.length === 0) return;
    
    // キューから最初の待機者を取得
    const waiter = queue.shift();
    
    if (queue.length === 0) {
      this.lockWaitQueues.delete(resource);
    }
    
    // 次の待機者にロックを付与
    setImmediate(() => waiter.resolve());
  }

  /**
   * Remove from wait queue
   * @private
   */
  removeFromWaitQueue(resource, lockId) {
    const queue = this.lockWaitQueues.get(resource);
    if (!queue) return;
    
    const index = queue.findIndex(w => w.lockId === lockId);
    if (index !== -1) {
      queue.splice(index, 1);
    }
    
    if (queue.length === 0) {
      this.lockWaitQueues.delete(resource);
    }
  }

  /**
   * Check existing lock
   * @private
   */
  async checkExistingLock(lockFile) {
    try {
      const content = await fs.readFile(lockFile, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if lock is stale
   * @private
   */
  isLockStale(lockData) {
    if (!lockData.acquiredAt || !lockData.timeout) {
      return true;
    }
    
    const elapsed = Date.now() - lockData.acquiredAt;
    return elapsed > lockData.timeout;
  }

  /**
   * Setup timeout for automatic lock release
   * @private
   */
  setupTimeout(resource, lockId, timeout) {
    return setTimeout(async () => {
      try {
        await this.release(resource, lockId);
        this.emit('lock-timeout', { resource, lockId });
      } catch (error) {
        // ロックが既に解放されている場合は無視
      }
    }, timeout);
  }

  /**
   * Get lock file path
   * @private
   */
  getLockFilePath(resource) {
    const sanitized = resource.replace(/[^a-zA-Z0-9\-_]/g, '_');
    return path.join(this.options.lockDir, `${sanitized}.lock`);
  }

  /**
   * Cleanup stale locks
   * @private
   */
  async cleanupStaleLocks() {
    try {
      const files = await fs.readdir(this.options.lockDir);
      
      for (const file of files) {
        if (!file.endsWith('.lock')) continue;
        
        const lockFile = path.join(this.options.lockDir, file);
        const lockData = await this.checkExistingLock(lockFile);
        
        if (lockData && this.isLockStale(lockData)) {
          await fs.unlink(lockFile);
          this.emit('stale-lock-cleaned', { file, lockData });
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Sleep utility
   * @private
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get all active locks
   */
  getActiveLocks() {
    const locks = [];
    
    for (const [resource, info] of this.activeLocks) {
      locks.push({
        resource,
        id: info.id,
        file: info.file
      });
    }
    
    return locks;
  }

  /**
   * Cleanup all locks (for shutdown)
   */
  async cleanup() {
    for (const [resource, info] of this.activeLocks) {
      try {
        await this.release(resource, info.id);
      } catch (error) {
        // エラーは無視
      }
    }
    
    this.lockWaitQueues.clear();
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance
 */
function getInstance(options) {
  if (!instance) {
    instance = new LockManager(options);
  }
  return instance;
}

module.exports = {
  LockManager,
  getInstance
};