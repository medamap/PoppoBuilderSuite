/**
 * Worker Process Implementation for PoppoBuilder Daemon
 * Executes tasks in an isolated process
 */

const path = require('path');
const os = require('os');
const fs = require('fs');

// Set process title for identification
process.title = `PoppoBuilder-Worker-${process.env.POPPOBUILDER_WORKER_ID || 'unknown'}`;

// Load PoppoBuilder components
const TaskExecutor = require('./task-executor');
const Logger = require('../../src/logger');
const ConfigLoader = require('../../src/config-loader');

class PoppoBuilderWorker {
  constructor() {
    this.workerId = process.env.POPPOBUILDER_WORKER_ID || 'unknown';
    this.isShuttingDown = false;
    this.currentTask = null;
    
    // Metrics tracking
    this.metrics = {
      cpu: 0,
      memory: 0,
      lastUpdate: Date.now()
    };
    
    // Initialize components
    this.config = null;
    this.logger = null;
    this.taskExecutor = null;
    
    this.setupProcessHandlers();
    this.startMetricsCollection();
  }
  
  /**
   * Initialize PoppoBuilder components
   */
  async initialize() {
    try {
      // Load configuration
      const configLoader = new ConfigLoader();
      this.config = configLoader.loadConfig();
      
      // Initialize logger with daemon log directory
      const logDir = path.join(os.homedir(), '.poppobuilder', 'logs');
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }
      this.logger = new Logger(logDir, {
        maxSize: 100 * 1024 * 1024, // 100MB
        maxFiles: 5,
        compress: true
      });
      
      this.logger.info(`Worker ${this.workerId} initializing`);
      
      // Initialize task executor
      this.taskExecutor = new TaskExecutor({
        workerId: this.workerId,
        logDir: path.join(__dirname, '../../logs'),
        tempDir: path.join(__dirname, '../../temp')
      });
      
      // Set up task executor event handlers
      this.setupExecutorHandlers();
      
      this.logger.info(`Worker ${this.workerId} initialized successfully`);
      
      // Send ready signal
      this.sendMessage({
        type: 'ready',
        workerId: this.workerId
      });
      
    } catch (error) {
      this.logger?.error(`Worker ${this.workerId} initialization failed:`, error);
      this.sendMessage({
        type: 'error',
        workerId: this.workerId,
        error: {
          message: error.message,
          stack: error.stack
        }
      });
      process.exit(1);
    }
  }
  
  /**
   * Set up process event handlers
   */
  setupProcessHandlers() {
    // Handle messages from parent
    process.on('message', async (message) => {
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.sendMessage({
          type: 'error',
          workerId: this.workerId,
          error: {
            message: error.message,
            stack: error.stack
          }
        });
      }
    });
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
    
    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      this.logger?.error(`Worker ${this.workerId} uncaught exception:`, error);
      this.sendMessage({
        type: 'error',
        workerId: this.workerId,
        error: {
          message: error.message,
          stack: error.stack
        }
      });
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      this.logger?.error(`Worker ${this.workerId} unhandled rejection:`, reason);
      this.sendMessage({
        type: 'error',
        workerId: this.workerId,
        error: {
          message: reason?.message || String(reason),
          stack: reason?.stack
        }
      });
    });
  }
  
  /**
   * Handle messages from parent process
   */
  async handleMessage(message) {
    switch (message.type) {
      case 'execute-task':
        await this.executeTask(message.task);
        break;
        
      case 'ping':
        this.sendMessage({
          type: 'pong',
          workerId: this.workerId,
          timestamp: Date.now()
        });
        break;
        
      case 'shutdown':
        await this.shutdown();
        break;
        
      default:
        this.logger?.warn(`Unknown message type: ${message.type}`);
    }
  }
  
  /**
   * Set up task executor event handlers
   */
  setupExecutorHandlers() {
    // Handle task completion
    this.taskExecutor.on('task-completed', ({ task, result, duration }) => {
      this.sendMessage({
        type: 'task-result',
        workerId: this.workerId,
        taskId: task.id,
        result,
        duration
      });
    });
    
    // Handle task failure
    this.taskExecutor.on('task-failed', ({ task, error, duration }) => {
      this.sendMessage({
        type: 'task-error',
        workerId: this.workerId,
        taskId: task.id,
        error: {
          message: error.message,
          stack: error.stack,
          code: error.code
        }
      });
    });
    
    // Handle progress updates
    this.taskExecutor.on('progress', (progress) => {
      this.sendMessage({
        type: 'task-progress',
        workerId: this.workerId,
        taskId: progress.task.id,
        stage: progress.stage,
        message: progress.message
      });
    });
    
    // Handle errors
    this.taskExecutor.on('error', (error) => {
      this.logger?.error(`Task executor error:`, error);
    });
  }
  
  /**
   * Execute a task
   */
  async executeTask(task) {
    this.currentTask = task;
    
    try {
      console.log(`[Worker Debug] Task content:`, JSON.stringify(task, null, 2));
      
      this.logger?.info(`Worker ${this.workerId} executing task ${task.id}`, {
        type: task.type,
        projectId: task.projectId,
        projectPath: task.projectPath
      });
      
      // Execute task using TaskExecutor
      const result = await this.taskExecutor.execute(task);
      
      this.logger?.info(`Worker ${this.workerId} completed task ${task.id}`);
      
    } catch (error) {
      this.logger?.error(`Worker ${this.workerId} task ${task.id} failed:`, error);
      // Error is already handled by the executor event handlers
    } finally {
      this.currentTask = null;
    }
  }
  
  
  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    setInterval(() => {
      this.collectMetrics();
    }, 5000); // Every 5 seconds
  }
  
  /**
   * Collect and send metrics
   */
  collectMetrics() {
    const usage = process.cpuUsage();
    const memUsage = process.memoryUsage();
    
    // Calculate CPU percentage (rough estimate)
    const cpuPercent = (usage.user + usage.system) / 1000000 / 5 * 100;
    
    this.metrics = {
      cpu: Math.min(cpuPercent, 100),
      memory: memUsage.heapUsed,
      rss: memUsage.rss,
      external: memUsage.external,
      lastUpdate: Date.now()
    };
    
    this.sendMessage({
      type: 'metrics',
      workerId: this.workerId,
      metrics: this.metrics
    });
  }
  
  /**
   * Send message to parent process
   */
  sendMessage(message) {
    if (process.send) {
      process.send(message);
    }
  }
  
  /**
   * Graceful shutdown
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    
    this.isShuttingDown = true;
    this.logger?.info(`Worker ${this.workerId} shutting down`);
    
    // Cancel current task if any
    if (this.currentTask) {
      this.logger?.warn(`Worker ${this.workerId} interrupting task ${this.currentTask.id}`);
      // Cancel task executor if running
      if (this.taskExecutor) {
        try {
          await this.taskExecutor.cancel();
        } catch (error) {
          this.logger?.error('Failed to cancel task:', error);
        }
      }
    }
    
    // Clean up components
    try {
      // Close logger
      if (this.logger && typeof this.logger.close === 'function') {
        await this.logger.close();
      }
      
      // Other cleanup...
    } catch (error) {
      console.error('Error during shutdown:', error);
    }
    
    process.exit(0);
  }
}

// Start worker
const worker = new PoppoBuilderWorker();
worker.initialize().catch(error => {
  console.error('Worker initialization failed:', error);
  process.exit(1);
});