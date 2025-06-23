/**
 * Round Robin Strategy
 * Simple circular assignment of tasks to workers
 */

const BaseStrategy = require('./base-strategy');

class RoundRobinStrategy extends BaseStrategy {
  constructor(options = {}) {
    super({
      name: 'round-robin',
      description: 'Assigns tasks to workers in circular order',
      ...options
    });
    
    // Strategy configuration
    this.config = {
      skipBusyWorkers: options.skipBusyWorkers !== false, // Default true
      maxSkipAttempts: options.maxSkipAttempts || 10,
      resetOnWorkerChange: options.resetOnWorkerChange !== false, // Default true
      ...options
    };
    
    // Round robin state
    this.currentIndex = 0;
    this.workerOrder = [];
    this.lastWorkerCount = 0;
    this.rotationCount = 0;
  }
  
  onInitialize() {
    // Initialize worker order
    this.updateWorkerOrder();
  }
  
  /**
   * Select next worker in round robin order
   */
  async doSelectWorker(task, availableWorkers, workerInfoMap) {
    // Update worker order if needed
    if (this.shouldUpdateWorkerOrder(availableWorkers)) {
      this.updateWorkerOrder(availableWorkers);
    }
    
    // Find next available worker
    let attempts = 0;
    let selectedWorker = null;
    const startIndex = this.currentIndex;
    
    while (attempts < this.config.maxSkipAttempts && !selectedWorker) {
      const workerId = this.workerOrder[this.currentIndex];
      
      // Check if worker is available
      if (availableWorkers.includes(workerId)) {
        const workerInfo = workerInfoMap.get(workerId);
        
        // Skip busy workers if configured
        if (!this.config.skipBusyWorkers || !workerInfo?.currentTask) {
          selectedWorker = workerId;
        }
      }
      
      // Move to next worker
      this.incrementIndex();
      attempts++;
      
      // Prevent infinite loop
      if (this.currentIndex === startIndex && attempts > 1) {
        break;
      }
    }
    
    // Update metrics
    if (selectedWorker) {
      this.updateStrategyMetric('rotationCount', this.rotationCount);
      this.updateStrategyMetric('skippedWorkers', attempts - 1);
      this.updateStrategyMetric('currentPosition', this.currentIndex);
    } else {
      // No suitable worker found, reset to start
      this.currentIndex = 0;
    }
    
    return selectedWorker;
  }
  
  /**
   * Check if worker order needs updating
   */
  shouldUpdateWorkerOrder(availableWorkers) {
    // Update if worker count changed
    if (this.config.resetOnWorkerChange && 
        availableWorkers.length !== this.lastWorkerCount) {
      return true;
    }
    
    // Update if order is empty
    if (this.workerOrder.length === 0) {
      return true;
    }
    
    // Check if current workers match our order
    const currentSet = new Set(availableWorkers);
    const orderSet = new Set(this.workerOrder);
    
    if (currentSet.size !== orderSet.size) {
      return true;
    }
    
    for (const worker of currentSet) {
      if (!orderSet.has(worker)) {
        return true;
      }
    }
    
    return false;
  }
  
  /**
   * Update the worker order
   */
  updateWorkerOrder(availableWorkers) {
    if (!availableWorkers && this.workerPool) {
      // Get all workers from pool
      availableWorkers = Array.from(this.workerPool.workers.keys());
    }
    
    if (!availableWorkers || availableWorkers.length === 0) {
      this.workerOrder = [];
      this.currentIndex = 0;
      return;
    }
    
    // Sort workers to ensure consistent ordering
    this.workerOrder = [...availableWorkers].sort();
    this.lastWorkerCount = this.workerOrder.length;
    
    // Reset or adjust index
    if (this.currentIndex >= this.workerOrder.length) {
      this.currentIndex = 0;
    }
    
    this.emit('order-updated', {
      workerOrder: this.workerOrder,
      currentIndex: this.currentIndex
    });
  }
  
  /**
   * Increment the current index
   */
  incrementIndex() {
    this.currentIndex = (this.currentIndex + 1) % this.workerOrder.length;
    
    // Track full rotations
    if (this.currentIndex === 0) {
      this.rotationCount++;
      this.updateStrategyMetric('totalRotations', this.rotationCount);
    }
  }
  
  /**
   * Handle worker addition
   */
  onWorkerAdded(workerId, workerInfo) {
    if (this.config.resetOnWorkerChange) {
      // Will update on next selection
      this.lastWorkerCount = -1; // Force update
    } else {
      // Add to end of order
      if (!this.workerOrder.includes(workerId)) {
        this.workerOrder.push(workerId);
        this.lastWorkerCount = this.workerOrder.length;
      }
    }
  }
  
  /**
   * Handle worker removal
   */
  onWorkerRemoved(workerId) {
    const index = this.workerOrder.indexOf(workerId);
    if (index !== -1) {
      // Remove from order
      this.workerOrder.splice(index, 1);
      
      // Adjust current index if needed
      if (this.currentIndex > index) {
        this.currentIndex--;
      } else if (this.currentIndex >= this.workerOrder.length) {
        this.currentIndex = 0;
      }
      
      this.lastWorkerCount = this.workerOrder.length;
    }
  }
  
  /**
   * Get strategy-specific metrics
   */
  getMetrics() {
    const baseMetrics = super.getMetrics();
    
    // Calculate fairness metric
    const fairness = this.calculateFairness();
    
    return {
      ...baseMetrics,
      currentPosition: this.currentIndex,
      workerCount: this.workerOrder.length,
      totalRotations: this.rotationCount,
      fairnessIndex: fairness,
      workerOrder: [...this.workerOrder]
    };
  }
  
  /**
   * Calculate fairness of distribution
   * Returns value between 0 and 1, where 1 is perfectly fair
   */
  calculateFairness() {
    if (!this.workerPool || this.workerPool.workers.size === 0) {
      return 1;
    }
    
    // Count tasks per worker
    const taskCounts = new Map();
    let totalTasks = 0;
    
    for (const [workerId, workerInfo] of this.workerPool.workers) {
      const count = workerInfo.tasksProcessed || 0;
      taskCounts.set(workerId, count);
      totalTasks += count;
    }
    
    if (totalTasks === 0) {
      return 1; // No tasks yet, perfectly fair
    }
    
    // Calculate expected tasks per worker
    const expectedPerWorker = totalTasks / taskCounts.size;
    
    // Calculate variance from expected
    let variance = 0;
    for (const count of taskCounts.values()) {
      variance += Math.pow(count - expectedPerWorker, 2);
    }
    
    // Normalize variance to 0-1 scale
    const maxVariance = Math.pow(totalTasks - expectedPerWorker, 2) * (taskCounts.size - 1);
    const normalizedVariance = maxVariance > 0 ? variance / maxVariance : 0;
    
    // Fairness is inverse of variance
    return 1 - normalizedVariance;
  }
  
  /**
   * Reset strategy state
   */
  onReset() {
    this.currentIndex = 0;
    this.workerOrder = [];
    this.lastWorkerCount = 0;
    this.rotationCount = 0;
  }
  
  /**
   * Get current state for debugging
   */
  getDebugInfo() {
    return {
      strategy: this.options.name,
      currentIndex: this.currentIndex,
      workerOrder: [...this.workerOrder],
      rotationCount: this.rotationCount,
      nextWorker: this.workerOrder[this.currentIndex] || null
    };
  }
}

module.exports = RoundRobinStrategy;