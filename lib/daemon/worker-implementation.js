/**
 * Worker Implementation
 * デーモンワーカープロセスの実装（Cluster Worker）
 */

const EventEmitter = require('events');
const path = require('path');
const { ProcessPoolManager } = require('../core/process-pool-manager');
const { ProjectRegistry, getInstance: getProjectRegistry } = require('../core/project-registry');
const { GlobalConfigManager } = require('../core/global-config-manager');
const { MultiLogger, getInstance: getLoggerInstance } = require('../utils/multi-logger');

/**
 * DaemonWorker class
 * デーモンのワーカープロセスとして動作
 */
class DaemonWorker extends EventEmitter {
  constructor() {
    super();
    
    this.workerId = process.env.POPPOBUILDER_WORKER_ID;
    this.isRunning = false;
    this.configManager = null;
    this.projectRegistry = null;
    this.processPool = null;
    this.currentTasks = new Map();
    this.logger = null;
    
    // Performance metrics
    this.metrics = {
      tasksProcessed: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      startTime: Date.now()
    };
  }

  /**
   * Initialize worker
   */
  async initialize() {
    try {
      await this.logger.info(`Worker ${this.workerId} initializing...`, {
        daemon: true,
        component: 'worker'
      });
      
      // Initialize configuration manager
      this.configManager = new GlobalConfigManager();
      await this.configManager.initialize();
      
      // Initialize logger
      this.logger = getLoggerInstance();
      await this.logger.initialize();
      
      // Initialize project registry
      this.projectRegistry = getProjectRegistry();
      await this.projectRegistry.initialize();
      
      // Get worker configuration
      const config = this.configManager.get('daemon.worker') || {};
      
      // Initialize process pool
      this.processPool = new ProcessPoolManager({
        minWorkers: config.minProcesses || 1,
        maxWorkers: config.maxProcesses || 4,
        workerScript: path.join(__dirname, '..', 'core', 'worker-process.js'),
        autoScale: config.autoScale !== false,
        scaleUpThreshold: config.scaleUpThreshold || 0.8,
        scaleDownThreshold: config.scaleDownThreshold || 0.2
      });
      
      await this.processPool.initialize();
      
      // Set up process pool event handlers
      this.setupProcessPoolHandlers();
      
      // Set up message handlers from master
      this.setupMasterHandlers();
      
      this.isRunning = true;
      
      // Send ready message to master
      process.send({
        type: 'ready',
        workerId: this.workerId,
        pid: process.pid
      });
      
      await this.logger.info(`Worker ${this.workerId} initialized successfully`, {
        daemon: true,
        component: 'worker'
      });
      
    } catch (error) {
      await this.logger.error(`Worker ${this.workerId} initialization failed`, {
        daemon: true,
        component: 'worker',
        error
      });
      process.send({
        type: 'error',
        workerId: this.workerId,
        error: error.message
      });
      process.exit(1);
    }
  }

  /**
   * Set up process pool event handlers
   */
  setupProcessPoolHandlers() {
    this.processPool.on('task-complete', (event) => {
      this.handleTaskComplete(event);
    });
    
    this.processPool.on('task-error', (event) => {
      this.handleTaskError(event);
    });
    
    this.processPool.on('worker-error', (event) => {
      console.error(`Process pool worker error:`, event.error);
      process.send({
        type: 'worker-error',
        workerId: this.workerId,
        details: event
      });
    });
    
    this.processPool.on('scaled-up', (event) => {
      console.log(`Process pool scaled up: ${event.workers} workers added`);
      process.send({
        type: 'pool-scaled',
        workerId: this.workerId,
        direction: 'up',
        details: event
      });
    });
    
    this.processPool.on('scaled-down', (event) => {
      console.log(`Process pool scaled down: ${event.workers} workers removed`);
      process.send({
        type: 'pool-scaled',
        workerId: this.workerId,
        direction: 'down',
        details: event
      });
    });
  }

  /**
   * Set up handlers for messages from master
   */
  setupMasterHandlers() {
    process.on('message', async (message) => {
      try {
        await this.handleMasterMessage(message);
      } catch (error) {
        console.error(`Error handling master message:`, error);
        process.send({
          type: 'error',
          workerId: this.workerId,
          error: error.message,
          messageType: message.type
        });
      }
    });
  }

  /**
   * Handle message from master process
   */
  async handleMasterMessage(message) {
    switch (message.type) {
      case 'execute-task':
        await this.executeTask(message.task);
        break;
        
      case 'get-status':
        this.sendStatus();
        break;
        
      case 'get-metrics':
        this.sendMetrics();
        break;
        
      case 'set-project-limit':
        this.processPool.setProjectLimit(message.projectId, message.limit);
        break;
        
      case 'reload-config':
        await this.reloadConfiguration();
        break;
        
      case 'shutdown':
        await this.shutdown();
        break;
        
      case 'ping':
        process.send({ type: 'pong', workerId: this.workerId });
        break;
        
      default:
        await this.logger.warn(`Unknown message type from master: ${message.type}`, {
        daemon: true,
        component: 'worker'
      });
    }
  }

  /**
   * Execute a task
   */
  async executeTask(taskData) {
    const { id: taskId, projectId, type, payload, options = {} } = taskData;
    
    try {
      // Validate project
      const project = this.projectRegistry.getProject(projectId);
      if (!project || !project.enabled) {
        throw new Error(`Project ${projectId} not found or disabled`);
      }
      
      // Register project with logger if not already done
      if (project.path) {
        await this.logger.registerProject(projectId, project.path);
      }
      
      // Log task start
      await this.logger.info(`Starting task ${taskId}`, {
        projectId,
        component: 'worker',
        metadata: { type, taskId }
      });
      
      // Track task
      this.currentTasks.set(taskId, {
        projectId,
        type,
        startTime: Date.now()
      });
      
      // Create task for process pool
      const poolTask = {
        type: this.mapTaskType(type),
        ...payload
      };
      
      // Submit to process pool
      const result = await this.processPool.submitTask(poolTask, {
        projectId,
        timeout: options.timeout || 300000, // 5 minutes default
        priority: options.priority || 0
      });
      
      // Update metrics
      this.metrics.tasksProcessed++;
      this.metrics.tasksSucceeded++;
      
      // Log task completion
      await this.logger.info(`Task ${taskId} completed successfully`, {
        projectId,
        component: 'worker',
        metadata: { 
          type, 
          taskId,
          duration: Date.now() - this.currentTasks.get(taskId).startTime 
        }
      });
      
      // Send result to master
      process.send({
        type: 'task-result',
        workerId: this.workerId,
        taskId,
        result,
        duration: Date.now() - this.currentTasks.get(taskId).startTime
      });
      
    } catch (error) {
      this.metrics.tasksProcessed++;
      this.metrics.tasksFailed++;
      
      process.send({
        type: 'task-error',
        workerId: this.workerId,
        taskId,
        error: {
          message: error.message,
          stack: error.stack
        }
      });
    } finally {
      this.currentTasks.delete(taskId);
    }
  }

  /**
   * Map task type to process pool handler
   */
  mapTaskType(type) {
    const typeMap = {
      'claude-api': 'execute-module',
      'github-api': 'http-request',
      'shell-command': 'shell-command',
      'code-execution': 'execute-code',
      'custom': 'execute-function'
    };
    
    return typeMap[type] || 'execute-function';
  }

  /**
   * Send current status
   */
  sendStatus() {
    const poolStats = this.processPool.getStats();
    
    process.send({
      type: 'status',
      workerId: this.workerId,
      status: {
        isRunning: this.isRunning,
        currentTasks: this.currentTasks.size,
        processPool: poolStats,
        uptime: Date.now() - this.metrics.startTime
      }
    });
  }

  /**
   * Send metrics
   */
  sendMetrics() {
    const poolStats = this.processPool.getStats();
    
    process.send({
      type: 'metrics',
      workerId: this.workerId,
      metrics: {
        tasks: {
          processed: this.metrics.tasksProcessed,
          succeeded: this.metrics.tasksSucceeded,
          failed: this.metrics.tasksFailed,
          current: this.currentTasks.size
        },
        pool: {
          workers: poolStats.workers,
          queueLength: poolStats.tasks.queued,
          avgTaskTime: poolStats.tasks.avgTime,
          load: poolStats.load
        },
        memory: process.memoryUsage(),
        uptime: Date.now() - this.metrics.startTime
      }
    });
  }

  /**
   * Handle task completion
   */
  handleTaskComplete(event) {
    // Additional logging or processing can be added here
    this.emit('task-complete', event);
  }

  /**
   * Handle task error
   */
  handleTaskError(event) {
    // Additional error handling can be added here
    this.emit('task-error', event);
  }

  /**
   * Reload configuration
   */
  async reloadConfiguration() {
    try {
      await this.configManager.load();
      const config = this.configManager.get('daemon.worker') || {};
      
      // Update process pool settings if changed
      // Note: Some settings may require pool restart
      
      process.send({
        type: 'config-reloaded',
        workerId: this.workerId
      });
      
    } catch (error) {
      throw new Error(`Failed to reload configuration: ${error.message}`);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log(`Worker ${this.workerId} shutting down...`);
    this.isRunning = false;
    
    try {
      // Wait for current tasks to complete (with timeout)
      const timeout = 30000; // 30 seconds
      const startTime = Date.now();
      
      while (this.currentTasks.size > 0 && Date.now() - startTime < timeout) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Shutdown process pool
      if (this.processPool) {
        await this.processPool.shutdown(true);
      }
      
      // Send final metrics
      this.sendMetrics();
      
      console.log(`Worker ${this.workerId} shutdown complete`);
      process.exit(0);
      
    } catch (error) {
      console.error(`Worker ${this.workerId} shutdown error:`, error);
      process.exit(1);
    }
  }
}

// Start worker if this is a cluster worker
if (process.env.POPPOBUILDER_DAEMON === 'true' && process.env.POPPOBUILDER_WORKER_ID !== undefined) {
  const worker = new DaemonWorker();
  worker.initialize().catch((error) => {
    console.error('Worker initialization failed:', error);
    process.exit(1);
  });
}

module.exports = DaemonWorker;