/**
 * Worker Process
 * プロセスプール内で実行されるワーカープロセス
 */

const { parentPort, workerData } = require('worker_threads');
const vm = require('vm');
const path = require('path');
const { performance } = require('perf_hooks');

/**
 * WorkerProcess class
 * タスクを実行するワーカープロセス
 */
class WorkerProcess {
  constructor() {
    this.workerId = workerData.workerId;
    this.options = workerData.poolOptions || {};
    this.isRunning = true;
    this.currentTask = null;
    
    // Metrics
    this.metrics = {
      tasksCompleted: 0,
      tasksFailed: 0,
      totalExecutionTime: 0,
      memoryUsage: 0,
      cpuUsage: 0
    };
    
    // Heartbeat interval
    this.heartbeatInterval = null;
    
    // Task handlers registry
    this.taskHandlers = new Map();
    this.registerDefaultHandlers();
    
    // Initialize
    this.initialize();
  }

  /**
   * Initialize worker
   */
  initialize() {
    if (!parentPort) {
      throw new Error('Worker must be run in a worker thread');
    }
    
    // Set up message handler
    parentPort.on('message', (message) => {
      this.handleMessage(message);
    });
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Send ready signal
    parentPort.postMessage({
      type: 'ready',
      workerId: this.workerId
    });
    
    // Handle process termination
    process.on('SIGTERM', () => this.shutdown());
    process.on('SIGINT', () => this.shutdown());
  }

  /**
   * Register default task handlers
   */
  registerDefaultHandlers() {
    // Execute JavaScript code
    this.registerTaskHandler('execute-code', async (task) => {
      const { code, context = {} } = task;
      
      // Create a sandboxed context
      const sandbox = {
        console,
        require,
        process: {
          env: process.env,
          version: process.version,
          platform: process.platform
        },
        ...context
      };
      
      // Execute code in VM
      const script = new vm.Script(code);
      const vmContext = vm.createContext(sandbox);
      
      return script.runInContext(vmContext);
    });
    
    // Execute function
    this.registerTaskHandler('execute-function', async (task) => {
      const { fn, args = [] } = task;
      
      // Recreate function from string if needed
      let func = fn;
      if (typeof fn === 'string') {
        func = new Function('return ' + fn)();
      }
      
      return await func(...args);
    });
    
    // Load and execute module
    this.registerTaskHandler('execute-module', async (task) => {
      const { modulePath, method, args = [] } = task;
      
      const module = require(path.resolve(modulePath));
      
      if (method && typeof module[method] === 'function') {
        return await module[method](...args);
      } else if (typeof module === 'function') {
        return await module(...args);
      } else {
        throw new Error('Module does not export a callable function');
      }
    });
    
    // HTTP request task
    this.registerTaskHandler('http-request', async (task) => {
      const axios = require('axios');
      const { url, method = 'GET', ...options } = task;
      
      const response = await axios({
        url,
        method,
        ...options
      });
      
      return {
        status: response.status,
        data: response.data,
        headers: response.headers
      };
    });
    
    // Shell command execution
    this.registerTaskHandler('shell-command', async (task) => {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { command, options = {} } = task;
      
      const result = await execAsync(command, options);
      
      return {
        stdout: result.stdout,
        stderr: result.stderr
      };
    });
  }

  /**
   * Register a task handler
   */
  registerTaskHandler(type, handler) {
    this.taskHandlers.set(type, handler);
  }

  /**
   * Handle incoming message
   */
  async handleMessage(message) {
    switch (message.type) {
      case 'task':
        await this.executeTask(message.taskId, message.task);
        break;
        
      case 'shutdown':
        this.shutdown();
        break;
        
      case 'ping':
        parentPort.postMessage({ type: 'pong' });
        break;
        
      default:
        console.warn(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Execute a task
   */
  async executeTask(taskId, task) {
    this.currentTask = taskId;
    const startTime = performance.now();
    
    try {
      // Update metrics
      const initialMemory = process.memoryUsage().heapUsed;
      const initialCpu = process.cpuUsage();
      
      // Get task handler
      const handler = this.taskHandlers.get(task.type);
      
      if (!handler) {
        throw new Error(`Unknown task type: ${task.type}`);
      }
      
      // Execute task
      const result = await handler(task);
      
      // Calculate metrics
      const endTime = performance.now();
      const executionTime = endTime - startTime;
      const finalMemory = process.memoryUsage().heapUsed;
      const finalCpu = process.cpuUsage(initialCpu);
      
      // Update metrics
      this.metrics.tasksCompleted++;
      this.metrics.totalExecutionTime += executionTime;
      this.metrics.memoryUsage = finalMemory - initialMemory;
      this.metrics.cpuUsage = (finalCpu.user + finalCpu.system) / 1000; // Convert to ms
      
      // Send result
      parentPort.postMessage({
        type: 'task-complete',
        taskId,
        result,
        metrics: {
          executionTime,
          memoryUsage: this.metrics.memoryUsage,
          cpuUsage: this.metrics.cpuUsage
        }
      });
      
    } catch (error) {
      this.metrics.tasksFailed++;
      
      // Send error
      parentPort.postMessage({
        type: 'task-error',
        taskId,
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        }
      });
    } finally {
      this.currentTask = null;
    }
  }

  /**
   * Start heartbeat
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isRunning) {
        parentPort.postMessage({
          type: 'heartbeat',
          workerId: this.workerId,
          metrics: this.getMetrics()
        });
      }
    }, 30000); // 30 seconds
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      tasksCompleted: this.metrics.tasksCompleted,
      tasksFailed: this.metrics.tasksFailed,
      avgExecutionTime: this.metrics.tasksCompleted > 0 
        ? this.metrics.totalExecutionTime / this.metrics.tasksCompleted 
        : 0,
      memory: {
        rss: memoryUsage.rss,
        heapTotal: memoryUsage.heapTotal,
        heapUsed: memoryUsage.heapUsed,
        external: memoryUsage.external
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      }
    };
  }

  /**
   * Send metrics update
   */
  sendMetrics() {
    parentPort.postMessage({
      type: 'metrics',
      workerId: this.workerId,
      metrics: this.getMetrics()
    });
  }

  /**
   * Shutdown worker
   */
  shutdown() {
    this.isRunning = false;
    
    // Clear heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    
    // Send final metrics
    this.sendMetrics();
    
    // Exit
    process.exit(0);
  }
}

// Create and start worker if this is the main module
if (require.main === module || parentPort) {
  const worker = new WorkerProcess();
}

module.exports = WorkerProcess;