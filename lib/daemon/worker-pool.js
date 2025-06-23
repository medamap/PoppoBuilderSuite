/**
 * Worker Pool Manager for PoppoBuilder Daemon
 * Manages a pool of worker processes for task execution
 */

const EventEmitter = require('events');
const { fork } = require('child_process');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

class WorkerPool extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxWorkers: options.maxWorkers || os.cpus().length,
      minWorkers: options.minWorkers || 1,
      workerScript: options.workerScript || path.join(__dirname, 'worker.js'),
      workerIdleTimeout: options.workerIdleTimeout || 60000, // 60 seconds
      workerRecycleAfter: options.workerRecycleAfter || 100, // Recycle after 100 tasks
      healthCheckInterval: options.healthCheckInterval || 30000, // 30 seconds
      taskTimeout: options.taskTimeout || 600000, // 10 minutes
      ...options
    };
    
    // Worker management
    this.workers = new Map();
    this.availableWorkers = [];
    this.busyWorkers = new Map();
    
    // Task tracking
    this.taskQueue = [];
    this.activeTasks = new Map();
    
    // Pool state
    this.isRunning = false;
    this.isShuttingDown = false;
    this.healthCheckTimer = null;
    
    // Statistics
    this.stats = {
      workersCreated: 0,
      workersDestroyed: 0,
      tasksProcessed: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalTaskTime: 0,
      workerStats: new Map()
    };
  }
  
  /**
   * Start the worker pool
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Worker pool is already running');
    }
    
    this.isRunning = true;
    
    // Create minimum workers
    const promises = [];
    for (let i = 0; i < this.options.minWorkers; i++) {
      promises.push(this.createWorker());
    }
    await Promise.all(promises);
    
    // Start health checks
    this.startHealthChecks();
    
    this.emit('started', {
      workers: this.workers.size,
      minWorkers: this.options.minWorkers,
      maxWorkers: this.options.maxWorkers
    });
  }
  
  /**
   * Create a new worker process
   */
  async createWorker() {
    const workerId = uuidv4();
    
    // Fork worker process
    const worker = fork(this.options.workerScript, [], {
      env: {
        ...process.env,
        POPPOBUILDER_WORKER_ID: workerId,
        POPPOBUILDER_DAEMON: 'true'
      },
      silent: false
    });
    
    // Initialize worker info
    const workerInfo = {
      id: workerId,
      process: worker,
      state: 'initializing',
      tasksProcessed: 0,
      currentTask: null,
      createdAt: Date.now(),
      lastActivity: Date.now(),
      cpu: 0,
      memory: 0
    };
    
    this.workers.set(workerId, workerInfo);
    this.stats.workersCreated++;
    
    // Set up worker event handlers
    this.setupWorkerHandlers(workerId, worker);
    
    // Wait for worker to be ready
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Worker ${workerId} initialization timeout`));
        this.destroyWorker(workerId);
      }, 30000);
      
      const readyHandler = (message) => {
        if (message.type === 'ready' && message.workerId === workerId) {
          clearTimeout(timeout);
          worker.removeListener('message', readyHandler);
          workerInfo.state = 'available';
          this.availableWorkers.push(workerId);
          this.emit('worker-created', { workerId });
          resolve(workerId);
        }
      };
      
      worker.on('message', readyHandler);
    });
  }
  
  /**
   * Set up event handlers for a worker
   */
  setupWorkerHandlers(workerId, worker) {
    const workerInfo = this.workers.get(workerId);
    
    // Handle messages from worker
    worker.on('message', (message) => {
      workerInfo.lastActivity = Date.now();
      
      switch (message.type) {
        case 'task-result':
          this.handleTaskResult(workerId, message);
          break;
          
        case 'task-error':
          this.handleTaskError(workerId, message);
          break;
          
        case 'metrics':
          this.updateWorkerMetrics(workerId, message.metrics);
          break;
          
        case 'error':
          this.emit('worker-error', {
            workerId,
            error: message.error
          });
          break;
      }
    });
    
    // Handle worker exit
    worker.on('exit', (code, signal) => {
      this.handleWorkerExit(workerId, code, signal);
    });
    
    // Handle worker errors
    worker.on('error', (error) => {
      this.emit('worker-error', { workerId, error });
      this.handleWorkerExit(workerId, 1, null);
    });
  }
  
  /**
   * Execute a task on an available worker
   */
  async executeTask(task, options = {}) {
    if (!this.isRunning || this.isShuttingDown) {
      throw new Error('Worker pool is not running');
    }
    
    const taskId = task.id || uuidv4();
    const taskInfo = {
      ...task,
      id: taskId,
      queuedAt: Date.now(),
      timeout: options.timeout || this.options.taskTimeout
    };
    
    // Try to get an available worker
    const workerId = await this.getAvailableWorker();
    
    if (workerId) {
      this.assignTaskToWorker(workerId, taskInfo);
    } else {
      // Queue the task
      this.taskQueue.push(taskInfo);
      this.emit('task-queued', { taskId });
      
      // Try to scale up if possible
      if (this.workers.size < this.options.maxWorkers) {
        this.createWorker().catch(err => {
          this.emit('error', new Error(`Failed to create worker: ${err.message}`));
        });
      }
    }
    
    return taskId;
  }
  
  /**
   * Get an available worker
   */
  async getAvailableWorker() {
    // Remove any workers that are no longer available
    this.availableWorkers = this.availableWorkers.filter(id => {
      const worker = this.workers.get(id);
      return worker && worker.state === 'available';
    });
    
    if (this.availableWorkers.length > 0) {
      return this.availableWorkers.shift();
    }
    
    return null;
  }
  
  /**
   * Assign a task to a worker
   */
  assignTaskToWorker(workerId, task) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    workerInfo.state = 'busy';
    workerInfo.currentTask = task.id;
    workerInfo.lastActivity = Date.now();
    
    this.busyWorkers.set(workerId, task.id);
    this.activeTasks.set(task.id, {
      workerId,
      task,
      startedAt: Date.now()
    });
    
    // Set task timeout
    const timeout = setTimeout(() => {
      this.handleTaskTimeout(workerId, task.id);
    }, task.timeout);
    
    this.activeTasks.get(task.id).timeout = timeout;
    
    // Send task to worker
    workerInfo.process.send({
      type: 'execute-task',
      task
    });
    
    this.emit('task-started', {
      taskId: task.id,
      workerId
    });
  }
  
  /**
   * Handle task result from worker
   */
  handleTaskResult(workerId, message) {
    const { taskId, result, duration } = message;
    const taskInfo = this.activeTasks.get(taskId);
    
    if (!taskInfo) return;
    
    // Clear timeout
    if (taskInfo.timeout) {
      clearTimeout(taskInfo.timeout);
    }
    
    // Update statistics
    this.stats.tasksProcessed++;
    this.stats.tasksSucceeded++;
    this.stats.totalTaskTime += duration;
    
    const workerInfo = this.workers.get(workerId);
    if (workerInfo) {
      workerInfo.tasksProcessed++;
      workerInfo.state = 'available';
      workerInfo.currentTask = null;
      
      // Check if worker needs recycling
      if (workerInfo.tasksProcessed >= this.options.workerRecycleAfter) {
        this.recycleWorker(workerId);
      } else {
        this.availableWorkers.push(workerId);
        this.processQueue();
      }
    }
    
    // Clean up
    this.activeTasks.delete(taskId);
    this.busyWorkers.delete(workerId);
    
    // Emit completion event
    this.emit('task-completed', {
      taskId,
      workerId,
      result,
      duration
    });
  }
  
  /**
   * Handle task error from worker
   */
  handleTaskError(workerId, message) {
    const { taskId, error } = message;
    const taskInfo = this.activeTasks.get(taskId);
    
    if (!taskInfo) return;
    
    // Clear timeout
    if (taskInfo.timeout) {
      clearTimeout(taskInfo.timeout);
    }
    
    // Update statistics
    this.stats.tasksProcessed++;
    this.stats.tasksFailed++;
    
    const workerInfo = this.workers.get(workerId);
    if (workerInfo) {
      workerInfo.state = 'available';
      workerInfo.currentTask = null;
      this.availableWorkers.push(workerId);
      this.processQueue();
    }
    
    // Clean up
    this.activeTasks.delete(taskId);
    this.busyWorkers.delete(workerId);
    
    // Emit error event
    this.emit('task-error', {
      taskId,
      workerId,
      error
    });
  }
  
  /**
   * Handle task timeout
   */
  handleTaskTimeout(workerId, taskId) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    this.emit('task-timeout', {
      taskId,
      workerId
    });
    
    // Restart the worker
    this.restartWorker(workerId);
  }
  
  /**
   * Handle worker exit
   */
  handleWorkerExit(workerId, code, signal) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    this.stats.workersDestroyed++;
    
    // Handle any active task
    if (workerInfo.currentTask) {
      const taskInfo = this.activeTasks.get(workerInfo.currentTask);
      if (taskInfo) {
        this.emit('task-error', {
          taskId: workerInfo.currentTask,
          workerId,
          error: new Error(`Worker exited with code ${code}, signal ${signal}`)
        });
        this.activeTasks.delete(workerInfo.currentTask);
      }
    }
    
    // Remove from pools
    this.workers.delete(workerId);
    this.busyWorkers.delete(workerId);
    this.availableWorkers = this.availableWorkers.filter(id => id !== workerId);
    
    this.emit('worker-exit', {
      workerId,
      code,
      signal
    });
    
    // Restart worker if not shutting down and below minimum
    if (!this.isShuttingDown && this.workers.size < this.options.minWorkers) {
      this.createWorker().catch(err => {
        this.emit('error', new Error(`Failed to restart worker: ${err.message}`));
      });
    }
  }
  
  /**
   * Process queued tasks
   */
  processQueue() {
    while (this.taskQueue.length > 0 && this.availableWorkers.length > 0) {
      const task = this.taskQueue.shift();
      const workerId = this.availableWorkers.shift();
      this.assignTaskToWorker(workerId, task);
    }
  }
  
  /**
   * Recycle a worker after it has processed many tasks
   */
  async recycleWorker(workerId) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    this.emit('worker-recycling', { workerId });
    
    // Create replacement first
    try {
      await this.createWorker();
      this.destroyWorker(workerId);
    } catch (error) {
      // If we can't create replacement, keep the old one
      this.availableWorkers.push(workerId);
      this.processQueue();
    }
  }
  
  /**
   * Restart a worker
   */
  async restartWorker(workerId) {
    this.destroyWorker(workerId);
    
    // Create replacement if needed
    if (this.workers.size < this.options.minWorkers) {
      try {
        await this.createWorker();
      } catch (error) {
        this.emit('error', new Error(`Failed to restart worker: ${error.message}`));
      }
    }
  }
  
  /**
   * Destroy a worker
   */
  destroyWorker(workerId) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    // Send shutdown signal
    try {
      workerInfo.process.send({ type: 'shutdown' });
    } catch (error) {
      // Worker might already be dead
    }
    
    // Force kill after timeout
    setTimeout(() => {
      try {
        workerInfo.process.kill('SIGKILL');
      } catch (error) {
        // Worker already exited
      }
    }, 5000);
  }
  
  /**
   * Update worker metrics
   */
  updateWorkerMetrics(workerId, metrics) {
    const workerInfo = this.workers.get(workerId);
    if (!workerInfo) return;
    
    workerInfo.cpu = metrics.cpu || 0;
    workerInfo.memory = metrics.memory || 0;
    
    // Store detailed stats
    if (!this.stats.workerStats.has(workerId)) {
      this.stats.workerStats.set(workerId, {
        tasksProcessed: 0,
        avgTaskTime: 0,
        cpu: [],
        memory: []
      });
    }
    
    const stats = this.stats.workerStats.get(workerId);
    stats.cpu.push(workerInfo.cpu);
    stats.memory.push(workerInfo.memory);
    
    // Keep only last 60 samples
    if (stats.cpu.length > 60) stats.cpu.shift();
    if (stats.memory.length > 60) stats.memory.shift();
  }
  
  /**
   * Start health checks
   */
  startHealthChecks() {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.options.healthCheckInterval);
  }
  
  /**
   * Perform health check on all workers
   */
  performHealthCheck() {
    const now = Date.now();
    
    for (const [workerId, workerInfo] of this.workers) {
      // Send ping
      try {
        workerInfo.process.send({ type: 'ping' });
      } catch (error) {
        // Worker is dead
        this.handleWorkerExit(workerId, null, null);
        continue;
      }
      
      // Check for idle timeout
      if (workerInfo.state === 'available' && 
          this.workers.size > this.options.minWorkers &&
          now - workerInfo.lastActivity > this.options.workerIdleTimeout) {
        this.destroyWorker(workerId);
      }
    }
    
    // Scale workers based on queue size
    const queuePressure = this.taskQueue.length / this.options.maxWorkers;
    
    if (queuePressure > 0.5 && this.workers.size < this.options.maxWorkers) {
      // Scale up
      const needed = Math.min(
        Math.ceil(this.taskQueue.length / 10),
        this.options.maxWorkers - this.workers.size
      );
      
      for (let i = 0; i < needed; i++) {
        this.createWorker().catch(err => {
          this.emit('error', new Error(`Failed to scale up: ${err.message}`));
        });
      }
    }
  }
  
  /**
   * Get pool statistics
   */
  getStats() {
    const workerDetails = [];
    
    for (const [workerId, workerInfo] of this.workers) {
      const stats = this.stats.workerStats.get(workerId) || {};
      workerDetails.push({
        id: workerId,
        state: workerInfo.state,
        tasksProcessed: workerInfo.tasksProcessed,
        currentTask: workerInfo.currentTask,
        uptime: Date.now() - workerInfo.createdAt,
        cpu: workerInfo.cpu,
        memory: workerInfo.memory,
        avgCpu: stats.cpu ? stats.cpu.reduce((a, b) => a + b, 0) / stats.cpu.length : 0,
        avgMemory: stats.memory ? stats.memory.reduce((a, b) => a + b, 0) / stats.memory.length : 0
      });
    }
    
    return {
      pool: {
        workers: this.workers.size,
        available: this.availableWorkers.length,
        busy: this.busyWorkers.size,
        minWorkers: this.options.minWorkers,
        maxWorkers: this.options.maxWorkers
      },
      queue: {
        length: this.taskQueue.length,
        activeTasks: this.activeTasks.size
      },
      stats: {
        workersCreated: this.stats.workersCreated,
        workersDestroyed: this.stats.workersDestroyed,
        tasksProcessed: this.stats.tasksProcessed,
        tasksSucceeded: this.stats.tasksSucceeded,
        tasksFailed: this.stats.tasksFailed,
        avgTaskTime: this.stats.tasksProcessed > 0 ? 
          this.stats.totalTaskTime / this.stats.tasksProcessed : 0
      },
      workers: workerDetails
    };
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.isRunning = false;
    
    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    // Cancel all timeouts
    for (const taskInfo of this.activeTasks.values()) {
      if (taskInfo.timeout) {
        clearTimeout(taskInfo.timeout);
      }
    }
    
    // Send shutdown to all workers
    const shutdownPromises = [];
    for (const [workerId, workerInfo] of this.workers) {
      shutdownPromises.push(new Promise((resolve) => {
        const timeout = setTimeout(() => {
          workerInfo.process.kill('SIGKILL');
          resolve();
        }, 10000);
        
        workerInfo.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
        
        try {
          workerInfo.process.send({ type: 'shutdown' });
        } catch (error) {
          // Worker might already be dead
          resolve();
        }
      }));
    }
    
    await Promise.all(shutdownPromises);
    
    this.emit('shutdown');
  }
}

module.exports = WorkerPool;