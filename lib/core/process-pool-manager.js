/**
 * Global Process Pool Manager
 * グローバルプロセスプール管理システム
 */

const EventEmitter = require('events');
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * プロセスプール管理クラス
 * 複数プロジェクト間で共有されるワーカープロセスプールを管理
 */
class ProcessPoolManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      minWorkers: options.minWorkers || 1,
      maxWorkers: options.maxWorkers || os.cpus().length,
      maxTasksPerWorker: options.maxTasksPerWorker || 100,
      workerIdleTimeout: options.workerIdleTimeout || 60000, // 60 seconds
      workerScript: options.workerScript || path.join(__dirname, 'worker-process.js'),
      autoScale: options.autoScale !== false,
      scaleUpThreshold: options.scaleUpThreshold || 0.8, // 80% load
      scaleDownThreshold: options.scaleDownThreshold || 0.2, // 20% load
      scaleCheckInterval: options.scaleCheckInterval || 10000, // 10 seconds
      ...options
    };
    
    // Worker pool
    this.workers = new Map();
    this.availableWorkers = [];
    this.busyWorkers = new Set();
    
    // Task queue
    this.taskQueue = [];
    this.taskCallbacks = new Map();
    
    // Metrics
    this.metrics = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      avgTaskTime: 0,
      totalTaskTime: 0,
      workerRestarts: 0
    };
    
    // State
    this.isRunning = false;
    this.scaleCheckInterval = null;
    
    // Resource limits per project
    this.projectLimits = new Map();
    this.projectUsage = new Map();
  }

  /**
   * Initialize the process pool
   */
  async initialize() {
    if (this.isRunning) {
      throw new Error('Process pool is already running');
    }

    this.isRunning = true;
    
    // Create initial workers
    const initialWorkers = this.options.minWorkers;
    for (let i = 0; i < initialWorkers; i++) {
      await this.createWorker();
    }
    
    // Start auto-scaling if enabled
    if (this.options.autoScale) {
      this.startAutoScaling();
    }
    
    this.emit('initialized', {
      workers: this.workers.size,
      minWorkers: this.options.minWorkers,
      maxWorkers: this.options.maxWorkers
    });
  }

  /**
   * Create a new worker
   */
  async createWorker() {
    const workerId = uuidv4();
    
    const worker = new Worker(this.options.workerScript, {
      workerData: {
        workerId,
        poolOptions: this.options
      }
    });
    
    const workerInfo = {
      id: workerId,
      worker,
      state: 'idle',
      taskCount: 0,
      createdAt: Date.now(),
      lastTaskAt: null,
      currentTask: null
    };
    
    // Set up worker event handlers
    worker.on('message', (message) => {
      this.handleWorkerMessage(workerId, message);
    });
    
    worker.on('error', (error) => {
      this.handleWorkerError(workerId, error);
    });
    
    worker.on('exit', (code) => {
      this.handleWorkerExit(workerId, code);
    });
    
    // Wait for worker to be ready
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Worker initialization timeout'));
      }, 10000);
      
      worker.once('message', (message) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    
    this.workers.set(workerId, workerInfo);
    this.availableWorkers.push(workerId);
    
    this.emit('worker-created', { workerId });
    
    return workerId;
  }

  /**
   * Remove a worker
   */
  async removeWorker(workerId, force = false) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    // Remove from available workers
    const availableIndex = this.availableWorkers.indexOf(workerId);
    if (availableIndex > -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }
    
    // Remove from busy workers
    this.busyWorkers.delete(workerId);
    
    // Terminate worker
    if (force) {
      await workerInfo.worker.terminate();
    } else {
      workerInfo.worker.postMessage({ type: 'shutdown' });
      
      // Wait for graceful shutdown
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          workerInfo.worker.terminate();
          resolve();
        }, 5000);
        
        workerInfo.worker.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
    
    this.workers.delete(workerId);
    this.emit('worker-removed', { workerId });
  }

  /**
   * Submit a task to the pool
   */
  async submitTask(task, options = {}) {
    if (!this.isRunning) {
      throw new Error('Process pool is not running');
    }
    
    const taskId = uuidv4();
    const projectId = options.projectId || 'default';
    
    // Check project limits
    if (!this.checkProjectLimit(projectId)) {
      throw new Error(`Project ${projectId} has reached its process limit`);
    }
    
    const taskInfo = {
      id: taskId,
      task,
      projectId,
      priority: options.priority || 0,
      timeout: options.timeout || 300000, // 5 minutes default
      createdAt: Date.now(),
      attempts: 0,
      maxAttempts: options.maxAttempts || 3
    };
    
    return new Promise((resolve, reject) => {
      this.taskCallbacks.set(taskId, { resolve, reject });
      
      // Set timeout
      const timeoutHandle = setTimeout(() => {
        this.taskCallbacks.delete(taskId);
        reject(new Error('Task timeout'));
      }, taskInfo.timeout);
      
      // Store timeout handle for cleanup
      taskInfo.timeoutHandle = timeoutHandle;
      
      // Try to assign task immediately
      if (!this.assignTask(taskInfo)) {
        // Queue the task if no workers available
        this.queueTask(taskInfo);
      }
      
      this.metrics.totalTasks++;
    });
  }

  /**
   * Check if project has available process slots
   */
  checkProjectLimit(projectId) {
    const limit = this.projectLimits.get(projectId);
    if (!limit) return true; // No limit set
    
    const usage = this.projectUsage.get(projectId) || 0;
    return usage < limit;
  }

  /**
   * Set project process limit
   */
  setProjectLimit(projectId, limit) {
    this.projectLimits.set(projectId, limit);
    this.emit('project-limit-set', { projectId, limit });
  }

  /**
   * Queue a task
   */
  queueTask(taskInfo) {
    // Insert based on priority (higher priority first)
    let inserted = false;
    for (let i = 0; i < this.taskQueue.length; i++) {
      if (taskInfo.priority > this.taskQueue[i].priority) {
        this.taskQueue.splice(i, 0, taskInfo);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      this.taskQueue.push(taskInfo);
    }
    
    this.emit('task-queued', { 
      taskId: taskInfo.id,
      queueLength: this.taskQueue.length 
    });
  }

  /**
   * Assign task to available worker
   */
  assignTask(taskInfo) {
    if (this.availableWorkers.length === 0) {
      return false;
    }
    
    const workerId = this.availableWorkers.shift();
    const workerInfo = this.workers.get(workerId);
    
    if (!workerInfo) {
      return false;
    }
    
    // Update worker state
    workerInfo.state = 'busy';
    workerInfo.currentTask = taskInfo.id;
    workerInfo.lastTaskAt = Date.now();
    workerInfo.taskCount++;
    
    // Update project usage
    const currentUsage = this.projectUsage.get(taskInfo.projectId) || 0;
    this.projectUsage.set(taskInfo.projectId, currentUsage + 1);
    
    // Move to busy workers
    this.busyWorkers.add(workerId);
    
    // Send task to worker
    workerInfo.worker.postMessage({
      type: 'task',
      taskId: taskInfo.id,
      task: taskInfo.task
    });
    
    this.emit('task-assigned', {
      taskId: taskInfo.id,
      workerId
    });
    
    return true;
  }

  /**
   * Handle worker message
   */
  handleWorkerMessage(workerId, message) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    switch (message.type) {
      case 'task-complete':
        this.handleTaskComplete(workerId, message.taskId, message.result);
        break;
        
      case 'task-error':
        this.handleTaskError(workerId, message.taskId, message.error);
        break;
        
      case 'heartbeat':
        workerInfo.lastHeartbeat = Date.now();
        break;
        
      case 'metrics':
        this.updateWorkerMetrics(workerId, message.metrics);
        break;
        
      default:
        this.emit('worker-message', { workerId, message });
    }
  }

  /**
   * Update worker metrics
   */
  updateWorkerMetrics(workerId, metrics) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    workerInfo.metrics = {
      ...workerInfo.metrics,
      ...metrics,
      lastUpdate: Date.now()
    };
  }

  /**
   * Handle task completion
   */
  handleTaskComplete(workerId, taskId, result) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    const callback = this.taskCallbacks.get(taskId);
    if (callback) {
      clearTimeout(callback.timeoutHandle);
      callback.resolve(result);
      this.taskCallbacks.delete(taskId);
    }
    
    // Update metrics
    this.metrics.completedTasks++;
    const taskTime = Date.now() - workerInfo.lastTaskAt;
    this.metrics.totalTaskTime += taskTime;
    this.metrics.avgTaskTime = this.metrics.totalTaskTime / this.metrics.completedTasks;
    
    // Update project usage
    const taskInfo = { projectId: workerInfo.currentTask?.projectId || 'default' };
    const currentUsage = this.projectUsage.get(taskInfo.projectId) || 0;
    this.projectUsage.set(taskInfo.projectId, Math.max(0, currentUsage - 1));
    
    // Reset worker state
    workerInfo.state = 'idle';
    workerInfo.currentTask = null;
    
    // Move back to available
    this.busyWorkers.delete(workerId);
    this.availableWorkers.push(workerId);
    
    // Check if worker should be recycled
    if (workerInfo.taskCount >= this.options.maxTasksPerWorker) {
      this.recycleWorker(workerId);
    } else {
      // Try to assign next task
      this.processQueue();
    }
    
    this.emit('task-complete', {
      taskId,
      workerId,
      duration: taskTime
    });
  }

  /**
   * Handle task error
   */
  handleTaskError(workerId, taskId, error) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    const callback = this.taskCallbacks.get(taskId);
    if (callback) {
      clearTimeout(callback.timeoutHandle);
      
      // Check if we should retry
      const taskInfo = callback.taskInfo;
      if (taskInfo && taskInfo.attempts < taskInfo.maxAttempts) {
        taskInfo.attempts++;
        this.queueTask(taskInfo);
      } else {
        callback.reject(new Error(error.message || error));
        this.taskCallbacks.delete(taskId);
        this.metrics.failedTasks++;
      }
    }
    
    // Update project usage
    const taskInfo = { projectId: workerInfo.currentTask?.projectId || 'default' };
    const currentUsage = this.projectUsage.get(taskInfo.projectId) || 0;
    this.projectUsage.set(taskInfo.projectId, Math.max(0, currentUsage - 1));
    
    // Reset worker state
    workerInfo.state = 'idle';
    workerInfo.currentTask = null;
    
    // Move back to available
    this.busyWorkers.delete(workerId);
    this.availableWorkers.push(workerId);
    
    // Process next task
    this.processQueue();
    
    this.emit('task-error', {
      taskId,
      workerId,
      error: error.message || error
    });
  }

  /**
   * Handle worker error
   */
  handleWorkerError(workerId, error) {
    console.error(`Worker ${workerId} error:`, error);
    
    this.emit('worker-error', {
      workerId,
      error: error.message || error
    });
    
    // Restart worker
    this.restartWorker(workerId);
  }

  /**
   * Handle worker exit
   */
  handleWorkerExit(workerId, code) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    this.emit('worker-exit', {
      workerId,
      code
    });
    
    // Handle any pending task
    if (workerInfo.currentTask) {
      const callback = this.taskCallbacks.get(workerInfo.currentTask);
      if (callback) {
        callback.reject(new Error('Worker exited unexpectedly'));
        this.taskCallbacks.delete(workerInfo.currentTask);
      }
    }
    
    // Clean up worker
    this.workers.delete(workerId);
    const availableIndex = this.availableWorkers.indexOf(workerId);
    if (availableIndex > -1) {
      this.availableWorkers.splice(availableIndex, 1);
    }
    this.busyWorkers.delete(workerId);
    
    // Create replacement worker if needed
    if (this.isRunning && this.workers.size < this.options.minWorkers) {
      this.createWorker();
    }
  }

  /**
   * Restart a worker
   */
  async restartWorker(workerId) {
    await this.removeWorker(workerId, true);
    
    if (this.isRunning && this.workers.size < this.options.minWorkers) {
      await this.createWorker();
    }
    
    this.metrics.workerRestarts++;
  }

  /**
   * Recycle a worker after max tasks
   */
  async recycleWorker(workerId) {
    await this.removeWorker(workerId);
    
    if (this.isRunning) {
      await this.createWorker();
    }
  }

  /**
   * Process task queue
   */
  processQueue() {
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const taskInfo = this.taskQueue.shift();
      this.assignTask(taskInfo);
    }
  }

  /**
   * Start auto-scaling
   */
  startAutoScaling() {
    this.scaleCheckInterval = setInterval(() => {
      this.checkScaling();
    }, this.options.scaleCheckInterval);
  }

  /**
   * Check and perform scaling
   */
  async checkScaling() {
    const load = this.calculateLoad();
    
    if (load > this.options.scaleUpThreshold && this.workers.size < this.options.maxWorkers) {
      // Scale up
      const workersToAdd = Math.min(
        Math.ceil((this.workers.size * load) - this.workers.size),
        this.options.maxWorkers - this.workers.size
      );
      
      for (let i = 0; i < workersToAdd; i++) {
        await this.createWorker();
      }
      
      this.emit('scaled-up', {
        workers: workersToAdd,
        totalWorkers: this.workers.size,
        load
      });
      
    } else if (load < this.options.scaleDownThreshold && this.workers.size > this.options.minWorkers) {
      // Scale down
      const workersToRemove = Math.min(
        Math.floor(this.workers.size * (1 - load)),
        this.workers.size - this.options.minWorkers
      );
      
      // Remove idle workers first
      const idleWorkers = Array.from(this.workers.entries())
        .filter(([id, info]) => info.state === 'idle')
        .slice(0, workersToRemove);
      
      for (const [workerId] of idleWorkers) {
        await this.removeWorker(workerId);
      }
      
      this.emit('scaled-down', {
        workers: idleWorkers.length,
        totalWorkers: this.workers.size,
        load
      });
    }
  }

  /**
   * Calculate current load
   */
  calculateLoad() {
    if (this.workers.size === 0) return 0;
    
    const busyCount = this.busyWorkers.size;
    const queuedTasks = this.taskQueue.length;
    
    // Load = (busy workers + queued tasks) / total workers
    const load = (busyCount + queuedTasks) / this.workers.size;
    
    return Math.min(load, 1); // Cap at 100%
  }

  /**
   * Get pool statistics
   */
  getStats() {
    return {
      workers: {
        total: this.workers.size,
        available: this.availableWorkers.length,
        busy: this.busyWorkers.size
      },
      tasks: {
        queued: this.taskQueue.length,
        total: this.metrics.totalTasks,
        completed: this.metrics.completedTasks,
        failed: this.metrics.failedTasks,
        avgTime: Math.round(this.metrics.avgTaskTime)
      },
      load: this.calculateLoad(),
      projectUsage: Object.fromEntries(this.projectUsage),
      uptime: this.isRunning ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Shutdown the pool
   */
  async shutdown(graceful = true) {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // Stop auto-scaling
    if (this.scaleCheckInterval) {
      clearInterval(this.scaleCheckInterval);
      this.scaleCheckInterval = null;
    }
    
    // Cancel pending tasks
    for (const [taskId, callback] of this.taskCallbacks) {
      callback.reject(new Error('Process pool shutting down'));
    }
    this.taskCallbacks.clear();
    this.taskQueue = [];
    
    // Shutdown all workers
    const shutdownPromises = [];
    for (const [workerId] of this.workers) {
      shutdownPromises.push(this.removeWorker(workerId, !graceful));
    }
    
    await Promise.all(shutdownPromises);
    
    this.emit('shutdown');
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance
 */
function getInstance(options) {
  if (!instance) {
    instance = new ProcessPoolManager(options);
  }
  return instance;
}

module.exports = {
  ProcessPoolManager,
  getInstance
};