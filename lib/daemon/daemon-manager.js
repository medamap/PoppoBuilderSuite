/**
 * Daemon Manager
 * Manages PoppoBuilder daemon process lifecycle
 */

const cluster = require('cluster');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { GlobalConfigManager } = require('../core/global-config-manager');
const SignalHandler = require('./signal-handler');
const DaemonAPIServer = require('./api-server');
const { MultiLogger, getInstance: getLoggerInstance } = require('../utils/multi-logger');
const { MonitoringManager, getInstance: getMonitoringInstance } = require('../monitoring/monitoring-manager');

class DaemonManager extends EventEmitter {
  constructor() {
    super();
    this.configManager = null;
    this.pidFile = path.join(os.homedir(), '.poppobuilder', 'daemon.pid');
    this.isShuttingDown = false;
    this.workers = new Map();
    this.signalHandler = new SignalHandler(this);
    this.apiServer = null;
    this.logger = null;
    this.monitoring = null;
  }

  /**
   * Initialize daemon manager
   */
  async initialize() {
    // Initialize global config
    if (!this.configManager) {
      this.configManager = new GlobalConfigManager();
    }
    await this.configManager.initialize();
    
    // Get daemon configuration
    this.config = this.configManager.get('daemon') || {};
    
    // Set up directories
    await this.ensureDirectories();
    
    // Initialize multi-logger
    const globalLogDir = path.join(os.homedir(), '.poppobuilder', 'logs');
    this.logger = getLoggerInstance({
      globalLogDir,
      logLevel: this.config.logLevel || 'info',
      enableRotation: true,
      maxFileSize: 100 * 1024 * 1024, // 100MB
      maxFiles: 10
    });
    await this.logger.initialize();
    
    // Log initialization
    await this.logger.info('Daemon Manager initialized', { daemon: true });
    
    // Initialize monitoring
    this.monitoring = getMonitoringInstance({
      enableHealthCheck: true,
      enableProcessMonitor: true,
      enableAutoRecovery: true,
      ...this.config.monitoring
    });
    await this.monitoring.initialize();
    
    this.emit('initialized');
  }

  /**
   * Start daemon
   */
  async start() {
    try {
      // Check if daemon is already running
      if (await this.isRunning()) {
        const pid = await this.getPid();
        throw new Error(`Daemon is already running (PID: ${pid})`);
      }

      if (cluster.isMaster) {
        await this.startMaster();
      } else {
        await this.startWorker();
      }
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start master process
   */
  async startMaster() {
    await this.logger.info(`Starting PoppoBuilder daemon (PID: ${process.pid})`, { 
      daemon: true,
      component: 'daemon-manager' 
    });
    
    // Write PID file
    await this.writePidFile();
    
    // Set up signal handlers
    this.signalHandler.setup();
    
    // Start API server
    await this.startApiServer();
    
    // Start monitoring
    await this.monitoring.start();
    
    // Fork workers based on configuration
    const numWorkers = this.config.maxProcesses || 2;
    for (let i = 0; i < numWorkers; i++) {
      this.forkWorker(i);
    }
    
    // Set up cluster event handlers
    cluster.on('exit', (worker, code, signal) => {
      this.handleWorkerExit(worker, code, signal);
    });
    
    cluster.on('message', (worker, message) => {
      this.handleWorkerMessage(worker, message);
    });
    
    this.emit('started', { pid: process.pid, workers: numWorkers });
    await this.logger.info(`Daemon started with ${numWorkers} workers`, { 
      daemon: true,
      component: 'daemon-manager',
      metadata: { workers: numWorkers, pid: process.pid }
    });
  }

  /**
   * Start worker process
   */
  async startWorker() {
    // Load and start the worker implementation
    const DaemonWorker = require('./worker-implementation');
    const worker = new DaemonWorker();
    
    try {
      await worker.initialize();
      console.log(`Worker ${process.pid} started successfully`);
    } catch (error) {
      console.error(`Worker ${process.pid} failed to start:`, error);
      process.exit(1);
    }
  }

  /**
   * Fork a new worker
   */
  forkWorker(id) {
    const worker = cluster.fork({
      POPPOBUILDER_WORKER_ID: id,
      POPPOBUILDER_DAEMON: 'true'
    });
    
    const workerInfo = {
      id: id,
      worker: worker,
      startTime: Date.now(),
      restarts: 0
    };
    
    this.workers.set(worker.process.pid, workerInfo);
    
    // Add to monitoring
    if (this.monitoring) {
      this.monitoring.addProcess(worker.process.pid, {
        name: `worker-${id}`,
        type: 'worker',
        startTime: workerInfo.startTime
      });
    }
    
    console.log(`Forked worker ${id} (PID: ${worker.process.pid})`);
    return worker;
  }

  /**
   * Handle worker exit
   */
  handleWorkerExit(worker, code, signal) {
    const workerInfo = this.workers.get(worker.process.pid);
    if (!workerInfo) return;
    
    console.log(`Worker ${workerInfo.id} (PID: ${worker.process.pid}) died (${signal || code})`);
    this.workers.delete(worker.process.pid);
    
    // Restart worker if not shutting down and not marked as noRestart
    if (!this.isShuttingDown && !workerInfo.noRestart) {
      const restartDelay = Math.min(1000 * Math.pow(2, workerInfo.restarts), 30000);
      console.log(`Restarting worker ${workerInfo.id} in ${restartDelay}ms`);
      
      setTimeout(() => {
        if (!this.isShuttingDown) {
          const newWorker = this.forkWorker(workerInfo.id);
          const newWorkerInfo = this.workers.get(newWorker.process.pid);
          if (newWorkerInfo) {
            newWorkerInfo.restarts = workerInfo.restarts + 1;
          }
        }
      }, restartDelay);
    }
  }

  /**
   * Handle worker message
   */
  handleWorkerMessage(worker, message) {
    const workerInfo = this.workers.get(worker.process.pid);
    if (!workerInfo) return;
    
    switch (message.type) {
      case 'ready':
        console.log(`Worker ${workerInfo.id} is ready`);
        this.emit('worker:ready', workerInfo);
        break;
      case 'error':
        console.error(`Worker ${workerInfo.id} error:`, message.error);
        this.emit('worker:error', workerInfo, message.error);
        break;
      case 'metrics':
        this.emit('worker:metrics', workerInfo, message.metrics);
        break;
      default:
        this.emit('worker:message', workerInfo, message);
    }
  }

  /**
   * Handle message from master (in worker process)
   */
  handleMasterMessage(message) {
    switch (message.type) {
      case 'shutdown':
        this.gracefulShutdown();
        break;
      case 'reload':
        this.reload();
        break;
      default:
        this.emit('master:message', message);
    }
  }

  /**
   * Stop daemon
   */
  async stop() {
    if (cluster.isMaster) {
      console.log('Stopping PoppoBuilder daemon...');
      this.isShuttingDown = true;
      
      // Send shutdown signal to all workers
      for (const [pid, workerInfo] of this.workers) {
        workerInfo.worker.send({ type: 'shutdown' });
      }
      
      // Wait for workers to exit gracefully
      await this.waitForWorkersToExit();
      
      // Stop API server
      await this.stopApiServer();
      
      // Remove PID file
      await this.removePidFile();
      
      console.log('Daemon stopped');
      this.emit('stopped');
    } else {
      // Worker process cleanup
      this.emit('stopping');
      process.exit(0);
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown() {
    console.log('Initiating graceful shutdown...');
    
    // Give workers time to finish current tasks
    const shutdownTimeout = this.config.shutdownTimeout || 30000;
    
    setTimeout(() => {
      console.log('Shutdown timeout reached, forcing exit');
      process.exit(0);
    }, shutdownTimeout);
    
    // Clean up resources
    await this.cleanup();
    
    process.exit(0);
  }

  /**
   * Reload configuration
   */
  async reload() {
    console.log('Reloading configuration...');
    
    try {
      // Reload global config
      await this.configManager.load();
      this.config = this.configManager.get('daemon') || {};
      
      // Notify workers if in master
      if (cluster.isMaster) {
        for (const [pid, workerInfo] of this.workers) {
          workerInfo.worker.send({ type: 'reload' });
        }
      }
      
      this.emit('reloaded');
      console.log('Configuration reloaded');
    } catch (error) {
      console.error('Failed to reload configuration:', error);
      this.emit('error', error);
    }
  }

  /**
   * Apply configuration changes without restart
   */
  async applyConfigChanges(changes) {
    console.log('Applying configuration changes...');
    
    try {
      // Update internal config
      this.config = this.configManager.get('daemon') || {};
      
      // Apply changes that can be done without restart
      for (const [key, value] of Object.entries(changes)) {
        switch (key) {
          case 'daemon.maxProcesses':
            await this.adjustWorkerCount(value);
            break;
            
          case 'daemon.schedulingStrategy':
            // Notify workers of scheduling strategy change
            if (cluster.isMaster) {
              for (const [pid, workerInfo] of this.workers) {
                workerInfo.worker.send({ 
                  type: 'config-update',
                  key: 'schedulingStrategy',
                  value: value
                });
              }
            }
            break;
            
          case 'logging.level':
            // Update logging level
            if (this.logger) {
              this.logger.setLevel(value);
            }
            break;
            
          case 'defaults.checkInterval':
          case 'defaults.timeout':
          case 'defaults.retryAttempts':
            // Notify workers of default changes
            if (cluster.isMaster) {
              for (const [pid, workerInfo] of this.workers) {
                workerInfo.worker.send({ 
                  type: 'config-update',
                  key: key.replace('defaults.', ''),
                  value: value
                });
              }
            }
            break;
        }
      }
      
      this.emit('config-applied', changes);
      console.log('Configuration changes applied successfully');
      
      // Notify workers that configuration has been updated
      if (cluster.isMaster) {
        for (const [pid, workerInfo] of this.workers) {
          workerInfo.worker.send({ type: 'config-reloaded' });
        }
      }
      
    } catch (error) {
      console.error('Failed to apply configuration changes:', error);
      throw error;
    }
  }

  /**
   * Adjust worker count based on new maxProcesses configuration
   */
  async adjustWorkerCount(newMaxProcesses) {
    if (!cluster.isMaster) return;
    
    const currentWorkers = this.workers.size;
    
    if (newMaxProcesses > currentWorkers) {
      // Fork additional workers
      const workersToAdd = newMaxProcesses - currentWorkers;
      console.log(`Forking ${workersToAdd} additional workers...`);
      
      for (let i = 0; i < workersToAdd; i++) {
        const workerId = currentWorkers + i;
        this.forkWorker(workerId);
      }
    } else if (newMaxProcesses < currentWorkers) {
      // Gracefully shutdown excess workers
      const workersToRemove = currentWorkers - newMaxProcesses;
      console.log(`Shutting down ${workersToRemove} workers...`);
      
      const workerArray = Array.from(this.workers.entries());
      for (let i = 0; i < workersToRemove; i++) {
        const [pid, workerInfo] = workerArray[workerArray.length - 1 - i];
        workerInfo.worker.send({ type: 'shutdown' });
        
        // Mark worker as not to be restarted
        workerInfo.noRestart = true;
      }
    }
  }

  /**
   * Check if daemon is running
   */
  async isRunning() {
    try {
      const pid = await this.getPid();
      if (!pid) return false;
      
      // Check if process exists
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        // Process doesn't exist
        await this.removePidFile();
        return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * Get daemon PID
   */
  async getPid() {
    try {
      const content = await fs.readFile(this.pidFile, 'utf8');
      return parseInt(content.trim(), 10);
    } catch {
      return null;
    }
  }

  /**
   * Write PID file
   */
  async writePidFile() {
    await fs.writeFile(this.pidFile, process.pid.toString());
  }

  /**
   * Remove PID file
   */
  async removePidFile() {
    try {
      await fs.unlink(this.pidFile);
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Ensure required directories exist
   */
  async ensureDirectories() {
    const dirs = [
      path.dirname(this.pidFile),
      path.join(os.homedir(), '.poppobuilder', 'logs'),
      path.join(os.homedir(), '.poppobuilder', 'sockets')
    ];
    
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }
  }

  /**
   * Wait for all workers to exit
   */
  async waitForWorkersToExit(timeout = 30000) {
    const startTime = Date.now();
    
    while (this.workers.size > 0) {
      if (Date.now() - startTime > timeout) {
        console.log('Timeout waiting for workers to exit, forcing shutdown');
        for (const [pid, workerInfo] of this.workers) {
          workerInfo.worker.kill('SIGKILL');
        }
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    // Clean up event listeners
    this.removeAllListeners();
    
    // Clean up signal handlers
    if (this.signalHandler) {
      this.signalHandler.cleanup();
    }
    
    // Clean up config manager
    if (this.configManager) {
      await this.configManager.cleanup();
    }
  }

  /**
   * Start API server
   */
  async startApiServer() {
    try {
      const apiConfig = this.config.api || {};
      this.apiServer = new DaemonAPIServer(this, apiConfig);
      
      // Set up event forwarding
      this.apiServer.on('started', (info) => {
        this.emit('api-server-started', info);
      });
      
      this.apiServer.on('stopped', () => {
        this.emit('api-server-stopped');
      });
      
      await this.apiServer.start();
      console.log('API server started successfully');
    } catch (error) {
      console.error('Failed to start API server:', error);
      throw error;
    }
  }

  /**
   * Stop API server
   */
  async stopApiServer() {
    if (this.apiServer) {
      try {
        await this.apiServer.stop();
        this.apiServer = null;
        console.log('API server stopped');
      } catch (error) {
        console.error('Error stopping API server:', error);
      }
    }
  }

  /**
   * Restart daemon
   */
  async restart() {
    console.log('Restarting daemon...');
    await this.stop();
    
    // Give some time for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    await this.start();
    console.log('Daemon restarted successfully');
  }

  /**
   * Get worker count
   */
  getWorkerCount() {
    return this.workers.size;
  }

  /**
   * Get workers map
   */
  getWorkers() {
    return this.workers;
  }

  /**
   * Restart specific worker
   */
  restartWorker(pid) {
    const workerInfo = this.workers.get(pid);
    if (!workerInfo) {
      throw new Error(`Worker with PID ${pid} not found`);
    }
    
    console.log(`Restarting worker ${workerInfo.id} (PID: ${pid})`);
    workerInfo.worker.kill('SIGTERM');
    // The exit handler will automatically restart the worker
  }

  /**
   * Get daemon status
   */
  async getStatus() {
    const isRunning = await this.isRunning();
    const pid = await this.getPid();
    
    const status = {
      running: isRunning,
      pid: pid,
      workers: [],
      apiServer: null
    };
    
    if (cluster.isMaster && isRunning) {
      for (const [pid, workerInfo] of this.workers) {
        status.workers.push({
          id: workerInfo.id,
          pid: pid,
          uptime: Date.now() - workerInfo.startTime,
          restarts: workerInfo.restarts
        });
      }
      
      if (this.apiServer) {
        status.apiServer = this.apiServer.getServerInfo();
      }
    }
    
    return status;
  }

  /**
   * Get process pool statistics from all workers
   */
  async getProcessPoolStats() {
    if (!cluster.isMaster) {
      throw new Error('Process pool stats can only be accessed from master');
    }
    
    const allStats = {
      workers: {},
      totals: {
        workers: 0,
        available: 0,
        busy: 0,
        queued: 0,
        completed: 0,
        failed: 0,
        avgTime: 0
      }
    };
    
    // Get stats from each worker
    const statsPromises = [];
    for (const [pid, workerInfo] of this.workers) {
      statsPromises.push(
        this.getWorkerStats(workerInfo.worker).then(stats => ({
          workerId: workerInfo.id,
          stats
        }))
      );
    }
    
    const workerStats = await Promise.all(statsPromises);
    
    // Aggregate stats
    for (const { workerId, stats } of workerStats) {
      if (stats && stats.processPool) {
        allStats.workers[workerId] = stats.processPool;
        
        // Update totals
        allStats.totals.workers += stats.processPool.workers.total || 0;
        allStats.totals.available += stats.processPool.workers.available || 0;
        allStats.totals.busy += stats.processPool.workers.busy || 0;
        allStats.totals.queued += stats.processPool.tasks.queued || 0;
        allStats.totals.completed += stats.processPool.tasks.completed || 0;
        allStats.totals.failed += stats.processPool.tasks.failed || 0;
      }
    }
    
    // Calculate average time across all workers
    if (allStats.totals.completed > 0) {
      let totalTime = 0;
      let totalTasks = 0;
      
      for (const stats of Object.values(allStats.workers)) {
        if (stats.tasks && stats.tasks.avgTime && stats.tasks.completed) {
          totalTime += stats.tasks.avgTime * stats.tasks.completed;
          totalTasks += stats.tasks.completed;
        }
      }
      
      allStats.totals.avgTime = totalTasks > 0 ? Math.round(totalTime / totalTasks) : 0;
    }
    
    return allStats;
  }

  /**
   * Get stats from a specific worker
   */
  async getWorkerStats(worker) {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(null);
      }, 5000);
      
      const messageHandler = (message) => {
        if (message.type === 'status') {
          clearTimeout(timeout);
          worker.removeListener('message', messageHandler);
          resolve(message.status);
        }
      };
      
      worker.on('message', messageHandler);
      worker.send({ type: 'get-status' });
    });
  }

  /**
   * Set project process limit
   */
  async setProjectProcessLimit(projectId, limit) {
    if (!cluster.isMaster) {
      throw new Error('Project limits can only be set from master');
    }
    
    // Broadcast to all workers
    for (const [pid, workerInfo] of this.workers) {
      workerInfo.worker.send({
        type: 'set-project-limit',
        projectId,
        limit
      });
    }
    
    // Store in config for persistence
    const config = this.configManager.get('projects') || {};
    if (!config[projectId]) {
      config[projectId] = {};
    }
    config[projectId].processLimit = limit;
    
    await this.configManager.set('projects', config);
    await this.configManager.save();
  }

  /**
   * Get project process usage across all workers
   */
  async getProjectProcessUsage() {
    const stats = await this.getProcessPoolStats();
    const usage = {};
    
    // Aggregate project usage from all workers
    for (const workerStats of Object.values(stats.workers)) {
      if (workerStats.projectUsage) {
        for (const [projectId, count] of Object.entries(workerStats.projectUsage)) {
          usage[projectId] = (usage[projectId] || 0) + count;
        }
      }
    }
    
    // Add configured limits
    const projectsConfig = this.configManager.get('projects') || {};
    for (const [projectId, config] of Object.entries(projectsConfig)) {
      if (config.processLimit) {
        if (!usage[projectId]) {
          usage[projectId] = 0;
        }
        usage[projectId] = {
          used: usage[projectId],
          limit: config.processLimit,
          available: Math.max(0, config.processLimit - usage[projectId])
        };
      }
    }
    
    return usage;
  }
}

module.exports = DaemonManager;