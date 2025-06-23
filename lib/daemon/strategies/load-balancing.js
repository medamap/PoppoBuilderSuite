/**
 * Load Balancing Strategy
 * Assigns tasks to the least loaded worker based on CPU, memory, and task count
 */

const BaseStrategy = require('./base-strategy');

class LoadBalancingStrategy extends BaseStrategy {
  constructor(options = {}) {
    super({
      name: 'load-balancing',
      description: 'Assigns tasks to least loaded worker',
      ...options
    });
    
    // Strategy configuration
    this.config = {
      // Weight factors for load calculation
      cpuWeight: options.cpuWeight || 0.4,
      memoryWeight: options.memoryWeight || 0.3,
      taskCountWeight: options.taskCountWeight || 0.3,
      
      // Thresholds
      maxCpuThreshold: options.maxCpuThreshold || 80, // Skip workers above 80% CPU
      maxMemoryThreshold: options.maxMemoryThreshold || 0.8, // Skip workers above 80% memory
      
      // Load tracking
      loadHistorySize: options.loadHistorySize || 10,
      ...options
    };
    
    // Worker load history for trend analysis
    this.workerLoadHistory = new Map();
  }
  
  onInitialize() {
    // Set up periodic load history cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupLoadHistory();
    }, 60000); // Every minute
  }
  
  /**
   * Select the least loaded worker
   */
  async doSelectWorker(task, availableWorkers, workerInfoMap) {
    let selectedWorker = null;
    let lowestLoad = Infinity;
    
    // Calculate load for each available worker
    for (const workerId of availableWorkers) {
      const workerInfo = workerInfoMap.get(workerId);
      if (!workerInfo) continue;
      
      // Skip workers that exceed thresholds
      if (this.shouldSkipWorker(workerInfo)) {
        continue;
      }
      
      // Calculate composite load score
      const loadScore = this.calculateLoadScore(workerId, workerInfo);
      
      // Track load history
      this.recordLoadScore(workerId, loadScore);
      
      // Select worker with lowest load
      if (loadScore < lowestLoad) {
        lowestLoad = loadScore;
        selectedWorker = workerId;
      }
    }
    
    // Update metrics
    if (selectedWorker) {
      this.updateStrategyMetric('lastSelectedLoad', lowestLoad);
      this.updateStrategyMetric('avgSelectedLoad', this.calculateAvgSelectedLoad(lowestLoad));
    }
    
    return selectedWorker;
  }
  
  /**
   * Check if worker should be skipped based on thresholds
   */
  shouldSkipWorker(workerInfo) {
    // Skip if CPU exceeds threshold
    if (workerInfo.cpu > this.config.maxCpuThreshold) {
      return true;
    }
    
    // Skip if memory exceeds threshold (assuming memory is in bytes)
    const totalMemory = require('os').totalmem();
    const memoryUsagePercent = (workerInfo.memory / totalMemory);
    if (memoryUsagePercent > this.config.maxMemoryThreshold) {
      return true;
    }
    
    return false;
  }
  
  /**
   * Calculate composite load score for a worker
   * Lower score indicates less load
   */
  calculateLoadScore(workerId, workerInfo) {
    // Normalize values to 0-1 range
    const cpuLoad = workerInfo.cpu / 100;
    const totalMemory = require('os').totalmem();
    const memoryLoad = workerInfo.memory / totalMemory;
    const taskLoad = workerInfo.currentTask ? 1 : 0;
    
    // Consider historical load trend
    const loadTrend = this.getLoadTrend(workerId);
    
    // Calculate weighted score
    const baseScore = (
      this.config.cpuWeight * cpuLoad +
      this.config.memoryWeight * memoryLoad +
      this.config.taskCountWeight * taskLoad
    );
    
    // Adjust for trend (if load is increasing, penalize slightly)
    const trendAdjustment = loadTrend > 0 ? loadTrend * 0.1 : 0;
    
    return baseScore + trendAdjustment;
  }
  
  /**
   * Record load score in history
   */
  recordLoadScore(workerId, loadScore) {
    if (!this.workerLoadHistory.has(workerId)) {
      this.workerLoadHistory.set(workerId, []);
    }
    
    const history = this.workerLoadHistory.get(workerId);
    history.push({
      timestamp: Date.now(),
      load: loadScore
    });
    
    // Keep only recent history
    if (history.length > this.config.loadHistorySize) {
      history.shift();
    }
  }
  
  /**
   * Calculate load trend for a worker
   * Positive value indicates increasing load
   */
  getLoadTrend(workerId) {
    const history = this.workerLoadHistory.get(workerId);
    if (!history || history.length < 2) {
      return 0;
    }
    
    // Simple linear regression on recent load scores
    const n = history.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    history.forEach((entry, index) => {
      sumX += index;
      sumY += entry.load;
      sumXY += index * entry.load;
      sumX2 += index * index;
    });
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope;
  }
  
  /**
   * Calculate average selected load
   */
  calculateAvgSelectedLoad(newLoad) {
    const currentAvg = this.metrics.strategySpecificMetrics.avgSelectedLoad || 0;
    const count = this.metrics.successfulAssignments;
    return (currentAvg * (count - 1) + newLoad) / count;
  }
  
  /**
   * Clean up old load history entries
   */
  cleanupLoadHistory() {
    const now = Date.now();
    const maxAge = 5 * 60 * 1000; // 5 minutes
    
    for (const [workerId, history] of this.workerLoadHistory) {
      // Remove old entries
      const filtered = history.filter(entry => now - entry.timestamp < maxAge);
      
      if (filtered.length === 0) {
        this.workerLoadHistory.delete(workerId);
      } else {
        this.workerLoadHistory.set(workerId, filtered);
      }
    }
  }
  
  /**
   * Handle task completion to update load statistics
   */
  onTaskCompleted(workerId, task, result) {
    // Could track task duration vs load correlation here
    const workerInfo = this.workerPool?.workers.get(workerId);
    if (workerInfo) {
      const loadAtCompletion = this.calculateLoadScore(workerId, workerInfo);
      this.updateStrategyMetric('lastCompletionLoad', loadAtCompletion);
    }
  }
  
  /**
   * Handle worker removal
   */
  onWorkerRemoved(workerId) {
    this.workerLoadHistory.delete(workerId);
  }
  
  /**
   * Get strategy-specific metrics
   */
  getMetrics() {
    const baseMetrics = super.getMetrics();
    
    // Add load distribution metrics
    const loadDistribution = this.calculateLoadDistribution();
    
    return {
      ...baseMetrics,
      loadDistribution,
      activeWorkers: this.workerLoadHistory.size,
      avgWorkerLoad: this.calculateAverageWorkerLoad()
    };
  }
  
  /**
   * Calculate load distribution across workers
   */
  calculateLoadDistribution() {
    if (!this.workerPool) return null;
    
    const loads = [];
    for (const [workerId, workerInfo] of this.workerPool.workers) {
      loads.push(this.calculateLoadScore(workerId, workerInfo));
    }
    
    if (loads.length === 0) return null;
    
    loads.sort((a, b) => a - b);
    
    return {
      min: loads[0],
      max: loads[loads.length - 1],
      median: loads[Math.floor(loads.length / 2)],
      stdDev: this.calculateStdDev(loads)
    };
  }
  
  /**
   * Calculate standard deviation of loads
   */
  calculateStdDev(loads) {
    const mean = loads.reduce((a, b) => a + b, 0) / loads.length;
    const variance = loads.reduce((sum, load) => sum + Math.pow(load - mean, 2), 0) / loads.length;
    return Math.sqrt(variance);
  }
  
  /**
   * Calculate average worker load
   */
  calculateAverageWorkerLoad() {
    if (!this.workerPool || this.workerPool.workers.size === 0) return 0;
    
    let totalLoad = 0;
    let count = 0;
    
    for (const [workerId, workerInfo] of this.workerPool.workers) {
      totalLoad += this.calculateLoadScore(workerId, workerInfo);
      count++;
    }
    
    return count > 0 ? totalLoad / count : 0;
  }
  
  /**
   * Reset strategy state
   */
  onReset() {
    this.workerLoadHistory.clear();
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
}

module.exports = LoadBalancingStrategy;