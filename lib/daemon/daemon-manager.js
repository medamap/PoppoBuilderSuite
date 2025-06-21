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

class DaemonManager extends EventEmitter {
  constructor() {
    super();
    this.configManager = null;
    this.pidFile = path.join(os.homedir(), '.poppobuilder', 'daemon.pid');
    this.isShuttingDown = false;
    this.workers = new Map();
    this.signalHandler = new SignalHandler(this);
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
    console.log(`Starting PoppoBuilder daemon (PID: ${process.pid})`);
    
    // Write PID file
    await this.writePidFile();
    
    // Set up signal handlers
    this.signalHandler.setup();
    
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
    console.log(`Daemon started with ${numWorkers} workers`);
  }

  /**
   * Start worker process
   */
  async startWorker() {
    // Workers will be implemented in the next phase
    console.log(`Worker ${process.pid} started`);
    
    // Send ready message to master
    process.send({ type: 'ready', pid: process.pid });
    
    // Handle messages from master
    process.on('message', (message) => {
      this.handleMasterMessage(message);
    });
  }

  /**
   * Fork a new worker
   */
  forkWorker(id) {
    const worker = cluster.fork({
      POPPOBUILDER_WORKER_ID: id,
      POPPOBUILDER_DAEMON: 'true'
    });
    
    this.workers.set(worker.process.pid, {
      id: id,
      worker: worker,
      startTime: Date.now(),
      restarts: 0
    });
    
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
    
    // Restart worker if not shutting down
    if (!this.isShuttingDown) {
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
   * Get daemon status
   */
  async getStatus() {
    const isRunning = await this.isRunning();
    const pid = await this.getPid();
    
    const status = {
      running: isRunning,
      pid: pid,
      workers: []
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
    }
    
    return status;
  }
}

module.exports = DaemonManager;