#!/usr/bin/env node

/**
 * Worker Strategy Demo
 * Demonstrates how to use different worker assignment strategies
 */

const WorkerPool = require('../lib/daemon/worker-pool');
const StrategyManager = require('../lib/daemon/strategies');

// Extend WorkerPool to use strategies
class StrategyAwareWorkerPool extends WorkerPool {
  constructor(options = {}) {
    super(options);
    
    // Initialize strategy manager
    this.strategyManager = new StrategyManager({
      defaultStrategy: options.strategy || 'round-robin',
      enableDynamicSwitching: options.dynamicSwitching || false,
      ...options.strategyOptions
    });
    
    // Set up event forwarding
    this.strategyManager.on('worker-selected', (data) => {
      this.emit('strategy-worker-selected', data);
    });
    
    this.strategyManager.on('strategy-changed', (data) => {
      this.emit('strategy-changed', data);
    });
  }
  
  async start() {
    await super.start();
    
    // Initialize strategy manager with worker pool
    this.strategyManager.initialize(this);
  }
  
  /**
   * Override getAvailableWorker to use strategy
   */
  async getAvailableWorker(task) {
    // Get list of available workers
    const availableWorkers = this.availableWorkers.filter(id => {
      const worker = this.workers.get(id);
      return worker && worker.state === 'available';
    });
    
    // Use strategy to select worker
    const selectedWorker = await this.strategyManager.selectWorker(
      task,
      availableWorkers,
      this.workers
    );
    
    if (selectedWorker) {
      // Remove from available list
      const index = this.availableWorkers.indexOf(selectedWorker);
      if (index > -1) {
        this.availableWorkers.splice(index, 1);
      }
    }
    
    return selectedWorker;
  }
  
  /**
   * Override executeTask to pass task to strategy selection
   */
  async executeTask(task, options = {}) {
    if (!this.isRunning || this.isShuttingDown) {
      throw new Error('Worker pool is not running');
    }
    
    const taskId = task.id || require('uuid').v4();
    const taskInfo = {
      ...task,
      id: taskId,
      queuedAt: Date.now(),
      timeout: options.timeout || this.options.taskTimeout
    };
    
    // Try to get an available worker using strategy
    const workerId = await this.getAvailableWorker(taskInfo);
    
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
   * Override task completion to notify strategy
   */
  handleTaskResult(workerId, message) {
    super.handleTaskResult(workerId, message);
    
    // Notify strategy of task completion
    const task = this.activeTasks.get(message.taskId)?.task;
    if (task) {
      this.strategyManager.onTaskCompleted(workerId, task, {
        success: true,
        duration: message.duration
      });
    }
  }
  
  handleTaskError(workerId, message) {
    super.handleTaskError(workerId, message);
    
    // Notify strategy of task failure
    const task = this.activeTasks.get(message.taskId)?.task;
    if (task) {
      this.strategyManager.onTaskCompleted(workerId, task, {
        success: false,
        error: message.error
      });
    }
  }
  
  /**
   * Set worker assignment strategy
   */
  setStrategy(strategyName, options) {
    this.strategyManager.setStrategy(strategyName, options);
  }
  
  /**
   * Get strategy metrics
   */
  getStrategyMetrics() {
    return this.strategyManager.getAllMetrics();
  }
}

// Demo function
async function runDemo() {
  console.log('Worker Pool Strategy Demo\n');
  
  // Create worker pool with different strategies
  const strategies = ['round-robin', 'load-balancing', 'priority-based', 'affinity', 'resource-aware'];
  
  for (const strategy of strategies) {
    console.log(`\n=== Testing ${strategy} strategy ===`);
    
    const pool = new StrategyAwareWorkerPool({
      maxWorkers: 4,
      minWorkers: 2,
      strategy: strategy,
      workerScript: require('path').join(__dirname, '../lib/daemon/worker.js')
    });
    
    // Set up monitoring
    pool.on('worker-created', ({ workerId }) => {
      console.log(`Worker created: ${workerId}`);
    });
    
    pool.on('strategy-worker-selected', ({ strategy, workerId, task }) => {
      console.log(`[${strategy}] Selected worker ${workerId.substr(0, 8)} for task ${task}`);
    });
    
    pool.on('task-completed', ({ taskId, workerId, duration }) => {
      console.log(`Task ${taskId} completed by ${workerId.substr(0, 8)} in ${duration}ms`);
    });
    
    try {
      // Start the pool
      await pool.start();
      console.log(`Pool started with ${pool.workers.size} workers`);
      
      // Submit various tasks
      const tasks = [
        { type: 'compile', priority: 'high', projectId: 'project-a' },
        { type: 'test', priority: 'normal', projectId: 'project-a' },
        { type: 'lint', priority: 'low', projectId: 'project-b' },
        { type: 'build', priority: 'urgent', projectId: 'project-a' },
        { type: 'analyze', priority: 'normal', projectId: 'project-c' },
        { type: 'test', priority: 'high', projectId: 'project-b' }
      ];
      
      const taskIds = [];
      for (const task of tasks) {
        const taskId = await pool.executeTask(task);
        taskIds.push(taskId);
      }
      
      // Wait a bit for tasks to complete
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Show metrics
      const metrics = pool.getStrategyMetrics();
      console.log('\nStrategy Metrics:');
      console.log(JSON.stringify(metrics, null, 2));
      
      // Shutdown
      await pool.shutdown();
      console.log('Pool shut down');
      
    } catch (error) {
      console.error('Error:', error);
    }
  }
  
  // Test composite strategy
  console.log('\n=== Testing composite strategy ===');
  
  const compositePool = new StrategyAwareWorkerPool({
    maxWorkers: 4,
    minWorkers: 2,
    strategy: 'composite',
    strategyOptions: {
      strategies: {
        'load-balancing': { cpuWeight: 0.5 },
        'affinity': { affinityTypes: ['projectId'] }
      },
      weights: {
        'load-balancing': 0.6,
        'affinity': 0.4
      }
    }
  });
  
  try {
    await compositePool.start();
    console.log('Composite strategy pool started');
    
    // Submit tasks
    const projectTasks = [];
    for (let i = 0; i < 10; i++) {
      projectTasks.push({
        type: 'compile',
        projectId: `project-${i % 3}`,
        priority: i % 2 === 0 ? 'high' : 'normal'
      });
    }
    
    for (const task of projectTasks) {
      await compositePool.executeTask(task);
    }
    
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const compositeMetrics = compositePool.getStrategyMetrics();
    console.log('\nComposite Strategy Metrics:');
    console.log(JSON.stringify(compositeMetrics, null, 2));
    
    await compositePool.shutdown();
    
  } catch (error) {
    console.error('Composite strategy error:', error);
  }
  
  console.log('\nDemo completed!');
}

// Run demo if executed directly
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = StrategyAwareWorkerPool;