/**
 * Redis Storage Adapter
 * Implements Redis-based persistence for queue data
 */

const BaseStorage = require('./base-storage');

class RedisStorage extends BaseStorage {
  constructor(options = {}) {
    super(options);
    
    this.options = {
      host: 'localhost',
      port: 6379,
      password: null,
      db: 0,
      keyPrefix: 'poppobuilder:queue:',
      ttl: null, // No expiration by default
      ...options
    };
    
    this.client = null;
    this.redis = null;
  }

  /**
   * Initialize storage
   */
  async initialize() {
    try {
      // Lazy load redis
      this.redis = require('redis');
      
      // Create client
      this.client = this.redis.createClient({
        host: this.options.host,
        port: this.options.port,
        password: this.options.password,
        db: this.options.db,
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            // End reconnecting on a specific error
            return new Error('Redis connection refused');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            // End reconnecting after a specific timeout
            return new Error('Redis retry time exhausted');
          }
          if (options.attempt > 10) {
            // End reconnecting with max attempts
            return undefined;
          }
          // Reconnect after
          return Math.min(options.attempt * 100, 3000);
        }
      });
      
      // Promisify methods
      const { promisify } = require('util');
      this.getAsync = promisify(this.client.get).bind(this.client);
      this.setAsync = promisify(this.client.set).bind(this.client);
      this.delAsync = promisify(this.client.del).bind(this.client);
      this.existsAsync = promisify(this.client.exists).bind(this.client);
      this.keysAsync = promisify(this.client.keys).bind(this.client);
      this.hsetAsync = promisify(this.client.hset).bind(this.client);
      this.hgetAsync = promisify(this.client.hget).bind(this.client);
      this.hgetallAsync = promisify(this.client.hgetall).bind(this.client);
      this.zaddAsync = promisify(this.client.zadd).bind(this.client);
      this.zrangeAsync = promisify(this.client.zrange).bind(this.client);
      this.zremAsync = promisify(this.client.zrem).bind(this.client);
      this.multiAsync = () => {
        const multi = this.client.multi();
        multi.execAsync = promisify(multi.exec).bind(multi);
        return multi;
      };
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        this.client.on('ready', resolve);
        this.client.on('error', reject);
      });
      
      this.isInitialized = true;
    } catch (error) {
      throw new Error(`Failed to initialize Redis storage: ${error.message}`);
    }
  }

  /**
   * Save queue data
   */
  async save(data) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const dataWithMeta = this.addMetadata(data);
    const mainKey = this.getKey('main');
    
    const multi = this.multiAsync();
    
    try {
      // Save main queue data
      multi.set(mainKey, JSON.stringify(dataWithMeta));
      
      if (this.options.ttl) {
        multi.expire(mainKey, this.options.ttl);
      }
      
      // Save individual tasks in sorted sets for efficient querying
      const queueKey = this.getKey('tasks:queue');
      const processingKey = this.getKey('tasks:processing');
      
      // Clear existing sets
      multi.del(queueKey);
      multi.del(processingKey);
      
      // Add queued tasks sorted by priority
      for (const task of data.queue) {
        const score = task.priority || 0;
        multi.zadd(queueKey, score, JSON.stringify(task));
      }
      
      // Add processing tasks
      for (const [taskId, task] of Object.entries(data.processing || {})) {
        multi.hset(processingKey, taskId, JSON.stringify(task));
      }
      
      // Save project stats
      const statsKey = this.getKey('stats');
      multi.del(statsKey);
      for (const [projectId, stats] of Object.entries(data.projectStats || {})) {
        multi.hset(statsKey, projectId, JSON.stringify(stats));
      }
      
      // Execute transaction
      await multi.execAsync();
      
      // Create backup
      await this.createBackup();
      
    } catch (error) {
      throw new Error(`Failed to save queue data: ${error.message}`);
    }
  }

  /**
   * Load queue data
   */
  async load() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      const mainKey = this.getKey('main');
      const mainData = await this.getAsync(mainKey);
      
      if (mainData) {
        const data = JSON.parse(mainData);
        
        if (!this.validateData(data)) {
          throw new Error('Invalid queue data format');
        }
        
        return data;
      }
      
      // Build from individual components
      const queueKey = this.getKey('tasks:queue');
      const processingKey = this.getKey('tasks:processing');
      const statsKey = this.getKey('stats');
      
      // Get queued tasks (sorted by priority)
      const queuedTasks = await this.zrangeAsync(queueKey, 0, -1, 'WITHSCORES');
      const queue = [];
      for (let i = 0; i < queuedTasks.length; i += 2) {
        queue.push(JSON.parse(queuedTasks[i]));
      }
      
      // Get processing tasks
      const processingData = await this.hgetallAsync(processingKey) || {};
      const processing = {};
      for (const [taskId, taskData] of Object.entries(processingData)) {
        processing[taskId] = JSON.parse(taskData);
      }
      
      // Get project stats
      const statsData = await this.hgetallAsync(statsKey) || {};
      const projectStats = {};
      for (const [projectId, stats] of Object.entries(statsData)) {
        projectStats[projectId] = JSON.parse(stats);
      }
      
      return {
        queue,
        processing,
        projectStats,
        savedAt: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('Failed to load queue data:', error);
      return {
        queue: [],
        processing: {},
        projectStats: {},
        savedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(snapshotId, data) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const snapshotKey = this.getKey(`snapshots:${snapshotId}`);
    const dataWithMeta = {
      ...this.addMetadata(data),
      snapshotId,
      snapshotCreatedAt: new Date().toISOString()
    };
    
    await this.setAsync(snapshotKey, JSON.stringify(dataWithMeta));
    
    // Add to snapshots index
    const indexKey = this.getKey('snapshots:index');
    await this.zaddAsync(indexKey, Date.now(), snapshotId);
  }

  /**
   * Restore from snapshot
   */
  async restoreSnapshot(snapshotId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const snapshotKey = this.getKey(`snapshots:${snapshotId}`);
    const snapshotData = await this.getAsync(snapshotKey);
    
    if (!snapshotData) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }
    
    const data = JSON.parse(snapshotData);
    
    if (!this.validateData(data)) {
      throw new Error('Invalid snapshot data format');
    }
    
    return data;
  }

  /**
   * List available snapshots
   */
  async listSnapshots() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const indexKey = this.getKey('snapshots:index');
    const snapshotIds = await this.zrangeAsync(indexKey, 0, -1, 'WITHSCORES');
    
    const snapshots = [];
    for (let i = 0; i < snapshotIds.length; i += 2) {
      const id = snapshotIds[i];
      const timestamp = parseInt(snapshotIds[i + 1]);
      
      snapshots.push({
        id,
        createdAt: new Date(timestamp).toISOString()
      });
    }
    
    // Sort by creation date, newest first
    return snapshots.reverse();
  }

  /**
   * Delete a snapshot
   */
  async deleteSnapshot(snapshotId) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const snapshotKey = this.getKey(`snapshots:${snapshotId}`);
    const indexKey = this.getKey('snapshots:index');
    
    const multi = this.multiAsync();
    multi.del(snapshotKey);
    multi.zrem(indexKey, snapshotId);
    await multi.execAsync();
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const stats = {
      type: 'redis',
      connected: this.client.connected,
      keys: {},
      memory: {}
    };
    
    // Count keys
    const pattern = `${this.options.keyPrefix}*`;
    const keys = await this.keysAsync(pattern);
    stats.keys.total = keys.length;
    
    // Count specific types
    stats.keys.snapshots = keys.filter(k => k.includes('snapshots:')).length;
    stats.keys.tasks = keys.filter(k => k.includes('tasks:')).length;
    
    // Get memory info if available
    try {
      const info = await new Promise((resolve, reject) => {
        this.client.info('memory', (err, res) => {
          if (err) reject(err);
          else resolve(res);
        });
      });
      
      const memoryUsed = info.match(/used_memory:(\d+)/);
      if (memoryUsed) {
        stats.memory.used = parseInt(memoryUsed[1]);
      }
    } catch (error) {
      // Ignore memory stats errors
    }
    
    return stats;
  }

  /**
   * Clear all stored data
   */
  async clear() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const pattern = `${this.options.keyPrefix}*`;
    const keys = await this.keysAsync(pattern);
    
    if (keys.length > 0) {
      await this.delAsync(...keys);
    }
  }

  /**
   * Close Redis connection
   */
  async close() {
    if (this.client) {
      return new Promise((resolve) => {
        this.client.quit(() => {
          this.client = null;
          resolve();
        });
      });
    }
  }

  /**
   * Create backup
   */
  async createBackup() {
    const backupKey = this.getKey('backup');
    const mainKey = this.getKey('main');
    
    // Copy main to backup
    const mainData = await this.getAsync(mainKey);
    if (mainData) {
      await this.setAsync(backupKey, mainData);
    }
  }

  /**
   * Get prefixed key
   */
  getKey(suffix) {
    return `${this.options.keyPrefix}${suffix}`;
  }

  /**
   * Additional Redis-specific methods
   */
  async addTaskToQueue(task) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const queueKey = this.getKey('tasks:queue');
    const score = task.priority || 0;
    await this.zaddAsync(queueKey, score, JSON.stringify(task));
  }

  async getNextTask() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const queueKey = this.getKey('tasks:queue');
    
    // Get highest priority task
    const tasks = await this.zrangeAsync(queueKey, -1, -1);
    if (tasks.length > 0) {
      // Remove and return
      await this.zremAsync(queueKey, tasks[0]);
      return JSON.parse(tasks[0]);
    }
    
    return null;
  }

  async getQueueLength() {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const queueKey = this.getKey('tasks:queue');
    return new Promise((resolve, reject) => {
      this.client.zcard(queueKey, (err, count) => {
        if (err) reject(err);
        else resolve(count);
      });
    });
  }
}

module.exports = RedisStorage;