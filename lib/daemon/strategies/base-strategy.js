/**
 * Base Strategy Interface for Worker Assignment
 * All worker assignment strategies must extend this class
 */

const EventEmitter = require('events');

class BaseStrategy extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      name: 'base',
      description: 'Base strategy interface',
      ...options
    };
    
    // Metrics collection
    this.metrics = {
      totalAssignments: 0,
      successfulAssignments: 0,
      failedAssignments: 0,
      avgAssignmentTime: 0,
      strategySpecificMetrics: {}
    };
    
    this.lastAssignmentTime = 0;
  }
  
  /**
   * Initialize the strategy with worker pool reference
   * @param {WorkerPool} workerPool - Reference to the worker pool
   */
  initialize(workerPool) {
    this.workerPool = workerPool;
    this.onInitialize();
  }
  
  /**
   * Strategy-specific initialization
   * Override in child classes
   */
  onInitialize() {
    // Override in child classes
  }
  
  /**
   * Select a worker for the given task
   * @param {Object} task - Task to be assigned
   * @param {Array} availableWorkers - List of available worker IDs
   * @param {Map} workerInfoMap - Map of worker ID to worker info
   * @returns {Promise<string|null>} - Selected worker ID or null if none suitable
   */
  async selectWorker(task, availableWorkers, workerInfoMap) {
    const startTime = Date.now();
    
    try {
      // Validate inputs
      if (!availableWorkers || availableWorkers.length === 0) {
        this.recordFailedAssignment('No available workers');
        return null;
      }
      
      // Call strategy-specific selection logic
      const workerId = await this.doSelectWorker(task, availableWorkers, workerInfoMap);
      
      if (workerId) {
        this.recordSuccessfulAssignment(Date.now() - startTime);
        this.emit('worker-selected', { 
          strategy: this.options.name, 
          workerId, 
          task: task.id 
        });
      } else {
        this.recordFailedAssignment('Strategy could not select worker');
      }
      
      return workerId;
      
    } catch (error) {
      this.recordFailedAssignment(error.message);
      this.emit('selection-error', { 
        strategy: this.options.name, 
        error: error.message,
        task: task.id 
      });
      return null;
    }
  }
  
  /**
   * Strategy-specific worker selection logic
   * Must be implemented by child classes
   * @param {Object} task - Task to be assigned
   * @param {Array} availableWorkers - List of available worker IDs
   * @param {Map} workerInfoMap - Map of worker ID to worker info
   * @returns {Promise<string|null>} - Selected worker ID or null
   */
  async doSelectWorker(task, availableWorkers, workerInfoMap) {
    throw new Error('doSelectWorker must be implemented by child class');
  }
  
  /**
   * Update strategy state after task completion
   * @param {string} workerId - Worker that completed the task
   * @param {Object} task - Completed task
   * @param {Object} result - Task result (success/failure, duration, etc.)
   */
  onTaskCompleted(workerId, task, result) {
    // Override in child classes to update strategy-specific state
  }
  
  /**
   * Update strategy state when worker is added
   * @param {string} workerId - New worker ID
   * @param {Object} workerInfo - Worker information
   */
  onWorkerAdded(workerId, workerInfo) {
    // Override in child classes
  }
  
  /**
   * Update strategy state when worker is removed
   * @param {string} workerId - Removed worker ID
   */
  onWorkerRemoved(workerId) {
    // Override in child classes
  }
  
  /**
   * Get strategy metrics
   * @returns {Object} - Strategy metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      successRate: this.metrics.totalAssignments > 0 
        ? this.metrics.successfulAssignments / this.metrics.totalAssignments 
        : 0
    };
  }
  
  /**
   * Reset strategy state and metrics
   */
  reset() {
    this.metrics = {
      totalAssignments: 0,
      successfulAssignments: 0,
      failedAssignments: 0,
      avgAssignmentTime: 0,
      strategySpecificMetrics: {}
    };
    this.onReset();
  }
  
  /**
   * Strategy-specific reset logic
   * Override in child classes
   */
  onReset() {
    // Override in child classes
  }
  
  // Helper methods for worker selection
  
  /**
   * Get worker load (number of current tasks)
   * @param {string} workerId - Worker ID
   * @param {Map} workerInfoMap - Worker info map
   * @returns {number} - Current load
   */
  getWorkerLoad(workerId, workerInfoMap) {
    const workerInfo = workerInfoMap.get(workerId);
    return workerInfo ? (workerInfo.currentTask ? 1 : 0) : 0;
  }
  
  /**
   * Get worker CPU usage
   * @param {string} workerId - Worker ID
   * @param {Map} workerInfoMap - Worker info map
   * @returns {number} - CPU usage percentage
   */
  getWorkerCpu(workerId, workerInfoMap) {
    const workerInfo = workerInfoMap.get(workerId);
    return workerInfo ? workerInfo.cpu : 0;
  }
  
  /**
   * Get worker memory usage
   * @param {string} workerId - Worker ID
   * @param {Map} workerInfoMap - Worker info map
   * @returns {number} - Memory usage in bytes
   */
  getWorkerMemory(workerId, workerInfoMap) {
    const workerInfo = workerInfoMap.get(workerId);
    return workerInfo ? workerInfo.memory : 0;
  }
  
  /**
   * Get worker uptime
   * @param {string} workerId - Worker ID
   * @param {Map} workerInfoMap - Worker info map
   * @returns {number} - Uptime in milliseconds
   */
  getWorkerUptime(workerId, workerInfoMap) {
    const workerInfo = workerInfoMap.get(workerId);
    return workerInfo ? Date.now() - workerInfo.createdAt : 0;
  }
  
  /**
   * Get worker task count
   * @param {string} workerId - Worker ID
   * @param {Map} workerInfoMap - Worker info map
   * @returns {number} - Total tasks processed
   */
  getWorkerTaskCount(workerId, workerInfoMap) {
    const workerInfo = workerInfoMap.get(workerId);
    return workerInfo ? workerInfo.tasksProcessed : 0;
  }
  
  /**
   * Calculate worker score based on multiple factors
   * @param {string} workerId - Worker ID
   * @param {Map} workerInfoMap - Worker info map
   * @param {Object} weights - Weight factors for scoring
   * @returns {number} - Worker score (higher is better)
   */
  calculateWorkerScore(workerId, workerInfoMap, weights = {}) {
    const defaultWeights = {
      cpu: -0.5,      // Negative because lower CPU is better
      memory: -0.3,   // Negative because lower memory is better
      uptime: 0.1,    // Positive because stable workers are preferred
      taskCount: 0.1  // Positive for experience, but not too high to avoid overuse
    };
    
    const finalWeights = { ...defaultWeights, ...weights };
    
    const cpu = this.getWorkerCpu(workerId, workerInfoMap);
    const memory = this.getWorkerMemory(workerId, workerInfoMap);
    const uptime = Math.min(this.getWorkerUptime(workerId, workerInfoMap) / 3600000, 24); // Cap at 24 hours
    const taskCount = Math.min(this.getWorkerTaskCount(workerId, workerInfoMap), 100); // Cap at 100
    
    return (
      finalWeights.cpu * cpu +
      finalWeights.memory * (memory / 1024 / 1024 / 1024) + // Convert to GB
      finalWeights.uptime * uptime +
      finalWeights.taskCount * Math.log(taskCount + 1) // Logarithmic scale
    );
  }
  
  // Metrics recording methods
  
  recordSuccessfulAssignment(duration) {
    this.metrics.totalAssignments++;
    this.metrics.successfulAssignments++;
    
    // Update average assignment time
    const currentAvg = this.metrics.avgAssignmentTime;
    const currentTotal = this.metrics.successfulAssignments;
    this.metrics.avgAssignmentTime = 
      (currentAvg * (currentTotal - 1) + duration) / currentTotal;
    
    this.lastAssignmentTime = Date.now();
  }
  
  recordFailedAssignment(reason) {
    this.metrics.totalAssignments++;
    this.metrics.failedAssignments++;
    
    this.emit('assignment-failed', {
      strategy: this.options.name,
      reason,
      timestamp: Date.now()
    });
  }
  
  /**
   * Update strategy-specific metrics
   * @param {string} key - Metric key
   * @param {any} value - Metric value
   */
  updateStrategyMetric(key, value) {
    this.metrics.strategySpecificMetrics[key] = value;
  }
}

module.exports = BaseStrategy;