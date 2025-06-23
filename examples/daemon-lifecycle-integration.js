/**
 * Example: Integrating Lifecycle Manager with PoppoBuilder Daemon
 * This shows how to use the lifecycle manager for robust daemon operations
 */

const { LifecycleManager, LifecycleStates, ComponentTypes } = require('../lib/daemon/lifecycle-manager');
const { getInstance: getGlobalConfig } = require('../lib/core/global-config-manager');
const { getInstance: getProjectRegistry } = require('../lib/core/project-registry');
const QueueManager = require('../lib/daemon/queue-manager');
const WorkerPool = require('../lib/daemon/worker-pool');
const DaemonAPI = require('../lib/daemon/daemon-api');
const { IPCServer } = require('../lib/daemon/ipc');
const Logger = require('../src/logger');

class EnhancedPoppoDaemon {
  constructor(options = {}) {
    this.options = options;
    this.logger = new Logger('EnhancedDaemon');
    this.lifecycleManager = new LifecycleManager({
      healthCheckInterval: 30000,
      componentTimeout: 30000,
      maxRecoveryAttempts: 3,
      gracefulShutdownTimeout: 60000
    });
    
    this.setupLifecycleHandlers();
  }

  /**
   * Setup lifecycle event handlers
   */
  setupLifecycleHandlers() {
    // State changes
    this.lifecycleManager.on('state-changed', ({ from, to }) => {
      this.logger.info(`Daemon state changed: ${from} -> ${to}`);
    });

    // Component events
    this.lifecycleManager.on('component-started', ({ type }) => {
      this.logger.info(`Component started: ${type}`);
    });

    this.lifecycleManager.on('component-stopped', ({ type }) => {
      this.logger.info(`Component stopped: ${type}`);
    });

    this.lifecycleManager.on('component-unhealthy', ({ type, component, health }) => {
      this.logger.warn(`Component unhealthy: ${type}`, { 
        health: component.health,
        errors: component.errors 
      });
    });

    this.lifecycleManager.on('component-recovered', ({ type }) => {
      this.logger.info(`Component recovered: ${type}`);
    });

    this.lifecycleManager.on('component-recovery-failed', ({ type, attempts }) => {
      this.logger.error(`Component recovery failed: ${type} after ${attempts} attempts`);
    });

    // Lifecycle events
    this.lifecycleManager.on('started', () => {
      this.logger.info('Daemon started successfully');
    });

    this.lifecycleManager.on('stopped', () => {
      this.logger.info('Daemon stopped');
    });

    this.lifecycleManager.on('error', (error) => {
      this.logger.error('Lifecycle error:', error);
    });
  }

  /**
   * Initialize and start the daemon
   */
  async start() {
    try {
      await this.lifecycleManager.initialize();
      
      // Register components with their health checks
      await this.registerComponents();
      
      // Start the lifecycle
      await this.lifecycleManager.start();
      
      // Setup signal handlers
      this.setupSignalHandlers();
      
    } catch (error) {
      this.logger.error('Failed to start daemon:', error);
      throw error;
    }
  }

  /**
   * Register all daemon components
   */
  async registerComponents() {
    // 1. Global Configuration
    const globalConfig = getGlobalConfig();
    this.lifecycleManager.registerComponent(
      ComponentTypes.CONFIG,
      {
        start: async () => {
          await globalConfig.initialize();
          const config = globalConfig.getAll();
          this.options = { ...this.options, ...config.daemon };
        },
        reload: async () => {
          await globalConfig.reload();
          const config = globalConfig.getAll();
          this.options = { ...this.options, ...config.daemon };
        }
      },
      async () => ({
        healthy: true,
        details: { configLoaded: globalConfig.isInitialized() }
      })
    );

    // 2. Project Registry
    const projectRegistry = getProjectRegistry();
    this.lifecycleManager.registerComponent(
      ComponentTypes.REGISTRY,
      {
        start: () => projectRegistry.initialize(),
        reload: () => projectRegistry.reload()
      },
      async () => ({
        healthy: projectRegistry.isInitialized(),
        details: { 
          projectCount: Object.keys(projectRegistry.getEnabledProjects()).length 
        }
      })
    );

    // 3. Queue Manager
    this.queueManager = new QueueManager({
      schedulingStrategy: this.options.schedulingStrategy
    });
    
    this.lifecycleManager.registerComponent(
      ComponentTypes.QUEUE,
      this.queueManager,
      async (instance) => {
        const stats = await instance.getStats();
        return {
          healthy: instance.isRunning,
          details: {
            queued: stats.queued,
            processing: stats.processing,
            completed: stats.completed
          }
        };
      }
    );

    // 4. Worker Pool
    this.workerPool = new WorkerPool({
      maxWorkers: this.options.maxProcesses,
      workerPath: require.resolve('../lib/daemon/worker.js')
    });
    
    // Connect queue and workers
    this.queueManager.on('task-ready', (task) => {
      this.workerPool.assignTask(task);
    });
    
    this.workerPool.on('task-complete', (result) => {
      this.queueManager.completeTask(result.taskId, result);
    });
    
    this.workerPool.on('task-error', (error) => {
      this.queueManager.failTask(error.taskId, error);
    });
    
    this.lifecycleManager.registerComponent(
      ComponentTypes.WORKERS,
      this.workerPool,
      async (instance) => {
        const stats = await instance.getStats();
        return {
          healthy: stats.activeWorkers > 0,
          details: {
            activeWorkers: stats.activeWorkers,
            idleWorkers: stats.idleWorkers,
            tasksProcessed: stats.tasksProcessed
          }
        };
      }
    );

    // 5. API Server
    this.apiServer = new DaemonAPI({
      daemon: this,
      queueManager: this.queueManager,
      workerPool: this.workerPool,
      port: this.options.port,
      host: this.options.host
    });
    
    this.lifecycleManager.registerComponent(
      ComponentTypes.API,
      this.apiServer,
      async (instance) => ({
        healthy: instance.isRunning(),
        details: {
          port: instance.port,
          connections: instance.getConnectionCount()
        }
      })
    );

    // 6. IPC Server
    const socketPath = process.platform === 'win32'
      ? '\\\\.\\pipe\\poppobuilder-daemon'
      : require('path').join(require('os').homedir(), '.poppobuilder', 'daemon.sock');
    
    this.ipcServer = new IPCServer({
      socketPath,
      authToken: this.options.ipcAuthToken
    });
    
    this.lifecycleManager.registerComponent(
      ComponentTypes.IPC,
      this.ipcServer,
      async (instance) => ({
        healthy: instance.isRunning(),
        details: {
          socketPath: instance.socketPath,
          connections: instance.getConnectionCount()
        }
      })
    );
  }

  /**
   * Setup signal handlers
   */
  setupSignalHandlers() {
    // Graceful shutdown
    const shutdown = async (signal) => {
      this.logger.info(`Received ${signal}, shutting down...`);
      try {
        await this.lifecycleManager.stop();
        process.exit(0);
      } catch (error) {
        this.logger.error('Shutdown error:', error);
        process.exit(1);
      }
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Configuration reload
    process.on('SIGHUP', async () => {
      this.logger.info('Received SIGHUP, reloading configuration...');
      try {
        await this.lifecycleManager.reload();
      } catch (error) {
        this.logger.error('Reload error:', error);
      }
    });

    // Status dump
    process.on('SIGUSR1', () => {
      const stats = this.lifecycleManager.getStatistics();
      this.logger.info('=== Daemon Status ===');
      this.logger.info(JSON.stringify(stats, null, 2));
    });

    // Health check
    process.on('SIGUSR2', async () => {
      const components = this.lifecycleManager.getAllComponentsStatus();
      this.logger.info('=== Component Health ===');
      for (const [type, status] of Object.entries(components)) {
        this.logger.info(`${type}: ${status.health} (status: ${status.status})`);
      }
    });
  }

  /**
   * Get daemon status
   */
  async getStatus() {
    return {
      state: this.lifecycleManager.getState(),
      statistics: this.lifecycleManager.getStatistics(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    };
  }

  /**
   * Stop the daemon
   */
  async stop() {
    await this.lifecycleManager.stop();
  }

  /**
   * Reload configuration
   */
  async reload() {
    await this.lifecycleManager.reload();
  }
}

// Example usage
if (require.main === module) {
  const daemon = new EnhancedPoppoDaemon({
    port: 3003,
    host: '127.0.0.1',
    maxProcesses: 2,
    schedulingStrategy: 'weighted-round-robin'
  });

  daemon.start().catch(error => {
    console.error('Failed to start daemon:', error);
    process.exit(1);
  });
}

module.exports = EnhancedPoppoDaemon;