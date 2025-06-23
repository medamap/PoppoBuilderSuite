#!/usr/bin/env node

/**
 * PoppoBuilder Daemon
 * Central daemon process that manages all PoppoBuilder projects
 */

const cluster = require('cluster');
const os = require('os');
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const EventEmitter = require('events');
const http = require('http');
const { getInstance: getGlobalConfig } = require('../core/global-config-manager');
const { getInstance: getProjectRegistry } = require('../core/project-registry');
const QueueManager = require('./queue-manager');
const WorkerPool = require('./worker-pool');
const DaemonAPI = require('./daemon-api');
const DaemonState = require('./daemon-state');
const { IPCServer } = require('./ipc');
const { LifecycleManager } = require('./lifecycle-manager');
const TaskScheduler = require('./task-scheduler');
const { ComponentTypes } = require('./lifecycle-manager');
const TaskExecutor = require('./task-executor');
const TaskResultHandler = require('./task-result-handler');
const TaskRetryManager = require('./task-retry-manager');
const TaskStatusTracker = require('./task-status-tracker');
const TaskPriorityManager = require('./task-priority-manager');
const Logger = require('../../src/logger');

class PoppoDaemon extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.version = require('../../package.json').version;
    this.options = {
      port: 3003,
      host: '127.0.0.1',
      maxProcesses: 2,
      schedulingStrategy: 'weighted-round-robin',
      heartbeatInterval: 30000, // 30 seconds
      ...options
    };
    
    // Create logger with explicit log directory for daemon mode
    const daemonLogDir = path.join(os.homedir(), '.poppobuilder', 'logs');
    if (!fs.existsSync(daemonLogDir)) {
      fs.mkdirSync(daemonLogDir, { recursive: true });
    }
    this.logger = new Logger(daemonLogDir, {
      maxSize: 100 * 1024 * 1024, // 100MB
      maxFiles: 5,
      compress: true
    });
    this.state = new DaemonState();
    this.lifecycleManager = new LifecycleManager();
    this.queueManager = null;
    this.workerPool = null;
    this.apiServer = null;
    this.ipcServer = null;
    this.taskScheduler = null;
    this.taskResultHandler = null;
    this.taskRetryManager = null;
    this.taskStatusTracker = null;
    this.taskPriorityManager = null;
    this.heartbeatTimer = null;
    this.shutdownInProgress = false;
    
    // Track daemon metrics
    this.metrics = {
      startTime: Date.now(),
      tasksProcessed: 0,
      tasksQueued: 0,
      errors: 0,
      restarts: 0
    };
  }

  /**
   * Initialize and start the daemon
   */
  async start() {
    try {
      this.logger.info('Starting PoppoBuilder Daemon...');
      
      // Set up lifecycle manager
      this.setupLifecycleManager();
      
      // Create daemon state file
      await this.state.initialize();
      await this.state.updateState({
        status: 'starting',
        pid: process.pid,
        startTime: new Date().toISOString()
      });
      
      // Start all components using lifecycle manager
      await this.lifecycleManager.start();
      
      // Get configuration after components are started
      const globalConfig = getGlobalConfig();
      const config = globalConfig.getAll();
      
      // Update options from config
      this.options = {
        ...this.options,
        ...config.daemon,
        maxProcesses: config.daemon?.maxProcesses || this.options.maxProcesses,
        schedulingStrategy: config.daemon?.schedulingStrategy || this.options.schedulingStrategy
      };
      
      // Start heartbeat
      this.startHeartbeat();
      
      // Update state
      await this.state.updateState({
        status: 'running',
        components: {
          queue: 'active',
          workers: 'active',
          api: 'active'
        }
      });
      
      // Set up signal handlers
      this.setupSignalHandlers();
      
      this.logger.info(`PoppoBuilder Daemon started successfully on port ${this.options.port}`);
      this.emit('started');
      
    } catch (error) {
      this.logger.error('Failed to start daemon:', error);
      await this.shutdown(1);
    }
  }

  /**
   * Start the API server
   */
  async startAPIServer() {
    this.apiServer = new DaemonAPI({
      daemon: this,
      queueManager: this.queueManager,
      workerPool: this.workerPool,
      port: this.options.port,
      host: this.options.host
    });
    
    await this.apiServer.start();
  }

  /**
   * Start the IPC server
   */
  async startIPCServer() {
    const socketPath = process.platform === 'win32'
      ? '\\\\.\\pipe\\poppobuilder-daemon'
      : path.join(os.homedir(), '.poppobuilder', 'daemon.sock');
    
    this.ipcServer = new IPCServer({
      socketPath,
      authToken: this.options.ipcAuthToken
    });
    
    // Set daemon reference
    this.ipcServer.daemon = this;
    
    // Set up IPC command handlers
    this.ipcServer.on('command', async (message, client) => {
      try {
        this.logger.debug(`IPC command received: ${message.command}`);
        
        const context = {
          daemon: this,
          registry: getProjectRegistry(),
          projectManager: getProjectRegistry(), // Same as registry
          queueManager: this.queueManager,
          workerPool: this.workerPool
        };
        
        // Use the ipcServer's commands instance
        const result = await this.ipcServer.commands.execute(message.command, message.payload || {}, context);
        this.ipcServer.sendResponse(client, message.id, result);
      } catch (error) {
        this.logger.error(`IPC command error: ${error.message}`, error);
        this.ipcServer.sendError(client, message.id, error.message);
      }
    });
    
    await this.ipcServer.start();
    this.logger.info(`IPC server started at ${socketPath}`);
  }


  /**
   * Get daemon status
   */
  async getStatus() {
    return {
      status: this.lifecycleManager?.currentState || 'unknown',
      pid: process.pid,
      uptime: process.uptime(),
      components: {
        config: !!getGlobalConfig(),
        registry: !!getProjectRegistry(),
        queue: !!this.queueManager,
        workers: !!this.workerPool,
        api: this.apiServer?.isRunning === true || false,
        ipc: !!this.ipcServer?.server || false
      }
    };
  }

  /**
   * Start heartbeat monitoring
   */
  startHeartbeat() {
    const heartbeat = async () => {
      try {
        const stats = await this.getStats();
        await this.state.updateState({
          lastHeartbeat: new Date().toISOString(),
          stats
        });
        this.emit('heartbeat', stats);
      } catch (error) {
        this.logger.error('Heartbeat error:', error);
      }
    };
    
    // Initial heartbeat
    heartbeat();
    
    // Schedule regular heartbeats
    this.heartbeatTimer = setInterval(heartbeat, this.options.heartbeatInterval);
  }

  /**
   * Get daemon statistics
   */
  async getStats() {
    const queueStats = await this.queueManager.getStats();
    const workerStats = await this.workerPool.getStats();
    
    return {
      uptime: Date.now() - this.metrics.startTime,
      metrics: this.metrics,
      queue: queueStats,
      workers: workerStats,
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };
  }

  /**
   * Setup signal handlers
   */
  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        this.logger.info(`Received ${signal}, shutting down gracefully...`);
        
        if (signal === 'SIGHUP') {
          // Reload configuration
          await this.reloadConfig();
        } else {
          // Shutdown
          await this.shutdown(0);
        }
      });
    });
    
    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception:', error);
      await this.shutdown(1);
    });
    
    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error('Unhandled rejection:', reason);
      await this.shutdown(1);
    });
  }

  /**
   * Reload configuration
   */
  async reloadConfig() {
    try {
      this.logger.info('Reloading configuration...');
      
      // Use lifecycle manager to reload components
      await this.lifecycleManager.reload();
      
      // Get updated configuration
      const globalConfig = getGlobalConfig();
      const config = globalConfig.getAll();
      
      // Update options
      const oldMaxProcesses = this.options.maxProcesses;
      this.options = {
        ...this.options,
        ...config.daemon
      };
      
      // Update worker pool if max processes changed
      if (this.options.maxProcesses !== oldMaxProcesses && this.workerPool) {
        await this.workerPool.resize(this.options.maxProcesses);
      }
      
      // Update queue manager strategy
      if (this.options.schedulingStrategy !== this.queueManager?.strategy) {
        this.queueManager?.setStrategy(this.options.schedulingStrategy);
      }
      
      this.logger.info('Configuration reloaded successfully');
      this.emit('config-reloaded');
      
    } catch (error) {
      this.logger.error('Failed to reload configuration:', error);
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(exitCode = 0) {
    if (this.shutdownInProgress) {
      return;
    }
    
    this.shutdownInProgress = true;
    this.logger.info('Starting graceful shutdown...');
    
    try {
      // Update state
      await this.state.updateState({
        status: 'shutting-down',
        shutdownTime: new Date().toISOString()
      });
      
      // Stop heartbeat
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
      }
      
      // Stop all components using lifecycle manager
      await this.lifecycleManager.stop();
      
      // Update final state
      await this.state.updateState({
        status: 'stopped',
        exitCode,
        stopTime: new Date().toISOString()
      });
      
      // Close logger
      await this.logger.close();
      
      this.logger.info('Shutdown complete');
      this.emit('shutdown');
      
      process.exit(exitCode);
      
    } catch (error) {
      console.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Get daemon information
   */
  getInfo() {
    return {
      version: require('../../package.json').version,
      pid: process.pid,
      platform: process.platform,
      nodeVersion: process.version,
      options: this.options,
      status: this.state.getState().status || 'unknown'
    };
  }

  /**
   * Set up lifecycle manager with components
   */
  setupLifecycleManager() {
    // Register components with lifecycle manager
    const globalConfig = getGlobalConfig();
    const registry = getProjectRegistry();
    
    // Configuration component
    this.lifecycleManager.registerComponent('config', {
      start: async () => await globalConfig.initialize(),
      reload: async () => await globalConfig.reload(),
      healthCheck: async () => ({ healthy: globalConfig.isInitialized }), 
      supportsReload: true
    }, { critical: true, startupOrder: 1 });
    
    // Registry component
    this.lifecycleManager.registerComponent('registry', {
      start: async () => await registry.initialize(),
      reload: async () => await registry.reload(),
      healthCheck: async () => ({ healthy: registry.isInitialized }),
      supportsReload: true
    }, { critical: true, startupOrder: 2 });
    
    // Queue manager component
    this.lifecycleManager.registerComponent('queue', {
      start: async () => {
        if (!this.queueManager) {
          this.queueManager = new QueueManager({
            schedulingStrategy: this.options.schedulingStrategy
          });
        }
        await this.queueManager.start();
      },
      stop: async () => await this.queueManager?.stop(),
      healthCheck: async () => ({ healthy: !!this.queueManager && this.queueManager.isRunning === true })
    }, { critical: true, startupOrder: 3 });
    
    // Worker pool component
    this.lifecycleManager.registerComponent('workers', {
      start: async () => {
        if (!this.workerPool) {
          this.workerPool = new WorkerPool({
            maxWorkers: this.options.maxProcesses,
            minWorkers: 1,
            workerScript: path.join(__dirname, 'worker.js')
          });
          this.setupWorkerPoolEvents();
        }
        await this.workerPool.start();
      },
      stop: async () => await this.workerPool?.shutdown(),
      healthCheck: async () => {
        const stats = this.workerPool?.getStats();
        return { healthy: (stats?.pool?.workers || 0) > 0 };
      }
    }, { critical: true, startupOrder: 4 });
    
    // API server component
    this.lifecycleManager.registerComponent('api', {
      start: async () => await this.startAPIServer(),
      stop: async () => await this.apiServer?.stop(),
      healthCheck: async () => ({ healthy: !!this.apiServer && this.apiServer.isRunning === true })
    }, { critical: false, startupOrder: 5 });
    
    // IPC server component
    this.lifecycleManager.registerComponent('ipc', {
      start: async () => await this.startIPCServer(),
      stop: async () => await this.ipcServer?.stop(),
      healthCheck: async () => ({ healthy: !!this.ipcServer && !!this.ipcServer.server })
    }, { critical: false, startupOrder: 6 });
    
    // Task management components
    this.lifecycleManager.registerComponent(ComponentTypes.TASK_STATUS_TRACKER, {
      start: async () => {
        this.taskStatusTracker = new TaskStatusTracker();
        await this.taskStatusTracker.initialize();
      },
      stop: async () => await this.taskStatusTracker?.shutdown(),
      healthCheck: async () => ({ healthy: this.taskStatusTracker !== null })
    }, { critical: true, startupOrder: 7 });
    
    this.lifecycleManager.registerComponent(ComponentTypes.TASK_PRIORITY_MANAGER, {
      start: async () => {
        this.taskPriorityManager = new TaskPriorityManager();
      },
      healthCheck: async () => ({ healthy: this.taskPriorityManager !== null })
    }, { critical: true, startupOrder: 8 });
    
    this.lifecycleManager.registerComponent(ComponentTypes.TASK_RETRY_MANAGER, {
      start: async () => {
        this.taskRetryManager = new TaskRetryManager();
        await this.taskRetryManager.initialize();
      },
      stop: async () => await this.taskRetryManager?.shutdown(),
      healthCheck: async () => ({ healthy: this.taskRetryManager !== null })
    }, { critical: false, startupOrder: 9 });
    
    this.lifecycleManager.registerComponent(ComponentTypes.TASK_RESULT_HANDLER, {
      start: async () => {
        this.taskResultHandler = new TaskResultHandler();
        this.taskResultHandler.on('followup-task', (task) => {
          this.queueManager.addTask(task);
        });
      },
      healthCheck: async () => ({ healthy: this.taskResultHandler !== null })
    }, { critical: true, startupOrder: 10 });
    
    this.lifecycleManager.registerComponent(ComponentTypes.TASK_SCHEDULER, {
      start: async () => {
        this.logger.info('Starting TaskScheduler component...');
        this.taskScheduler = new TaskScheduler();
        this.taskScheduler.setQueueManager(this.queueManager);
        this.logger.info('TaskScheduler created and queue manager set');
        this.setupTaskSchedulerProjects();
        this.logger.info('TaskScheduler projects setup complete');
        await this.taskScheduler.start();
        this.logger.info('TaskScheduler started successfully');
      },
      stop: async () => await this.taskScheduler?.stop(),
      healthCheck: async () => ({ healthy: this.taskScheduler?.isRunning || false })
    }, { critical: true, startupOrder: 11 });
    
    // Set up lifecycle events
    this.lifecycleManager.on('state-changed', (oldState, newState) => {
      this.logger.info(`Daemon state changed: ${JSON.stringify(oldState)} -> ${JSON.stringify(newState)}`);
      this.emit('state-changed', oldState, newState);
    });
    
    this.lifecycleManager.on('component-unhealthy', (componentInfo) => {
      const name = typeof componentInfo === 'string' ? componentInfo : componentInfo.type || 'unknown';
      const health = componentInfo.health || {};
      this.logger.warn(`Component unhealthy: ${name}`, { 
        health: health,
        component: componentInfo.component
      });
      this.emit('component-unhealthy', name);
    });
    
    this.lifecycleManager.on('error', (error) => {
      this.logger.error('Lifecycle error:', error);
      this.emit('error', error);
    });
  }

  /**
   * Set up worker pool event handlers
   */
  setupWorkerPoolEvents() {
    this.queueManager.on('task-ready', (task) => {
      // Apply priority management
      if (this.taskPriorityManager) {
        const priority = this.taskPriorityManager.calculatePriority(task);
        task.priority = priority;
      }
      
      // Update status tracker
      if (this.taskStatusTracker) {
        this.taskStatusTracker.updateStatus(task.id, 'assigned');
      }
      
      this.workerPool.executeTask(task);
    });
    
    this.workerPool.on('task-completed', async (result) => {
      this.queueManager.completeTask(result.taskId, result);
      this.metrics.tasksProcessed++;
      
      // Handle task result
      if (this.taskResultHandler) {
        await this.taskResultHandler.processResult(result);
      }
      
      // Update status tracker
      if (this.taskStatusTracker) {
        this.taskStatusTracker.completeTask(result.taskId, result);
      }
    });
    
    this.workerPool.on('task-error', async (error) => {
      // Check if we should retry
      if (this.taskRetryManager) {
        const retryDecision = await this.taskRetryManager.processFailure(error.task, error.error);
        if (retryDecision.retry) {
          setTimeout(() => {
            this.queueManager.addTask(error.task);
          }, retryDecision.delay);
          return;
        }
      }
      
      this.queueManager.failTask(error.taskId, error);
      this.metrics.errors++;
      
      // Update status tracker
      if (this.taskStatusTracker) {
        this.taskStatusTracker.failTask(error.taskId, error.error);
      }
    });
  }

  /**
   * Set up task scheduler projects
   */
  setupTaskSchedulerProjects() {
    const registry = getProjectRegistry();
    const projects = registry.getEnabledProjects();
    
    this.logger.info(`Setting up task scheduler with ${Object.keys(projects).length} projects`);
    
    Object.entries(projects).forEach(([projectId, project]) => {
      this.logger.info(`Registering project ${projectId} with scheduler`, {
        owner: project.config?.github?.owner,
        repo: project.config?.github?.repo,
        enabled: project.enabled,
        path: project.path
      });
      
      this.taskScheduler.registerProject({
        id: projectId,
        owner: project.config?.github?.owner,
        repo: project.config?.github?.repo,
        path: project.path, // Add project path
        pollingInterval: project.config?.pollingInterval || 300000, // 5 minutes default
        priority: project.config?.priority || 50,
        weight: project.config?.weight || 1.0,
        enabled: project.enabled !== false
      });
    });
    
    this.logger.info('Task scheduler projects setup complete');
  }
}

// Handle daemon startup
if (require.main === module) {
  const daemon = new PoppoDaemon();
  
  // Check if daemon is already running
  DaemonState.checkExisting().then(existing => {
    if (existing) {
      console.error(`Daemon is already running (PID: ${existing.pid})`);
      process.exit(1);
    }
    
    // Start daemon
    daemon.start().catch(error => {
      console.error('Failed to start daemon:', error);
      process.exit(1);
    });
  });
}

module.exports = PoppoDaemon;