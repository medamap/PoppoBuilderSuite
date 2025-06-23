/**
 * Priority-Based Strategy
 * Assigns tasks based on priority levels and worker capabilities
 */

const BaseStrategy = require('./base-strategy');

class PriorityBasedStrategy extends BaseStrategy {
  constructor(options = {}) {
    super({
      name: 'priority-based',
      description: 'Assigns tasks based on priority and worker tiers',
      ...options
    });
    
    // Strategy configuration
    this.config = {
      // Worker tier thresholds
      tiers: options.tiers || {
        premium: { minCpu: 4, minMemory: 8 * 1024 * 1024 * 1024 }, // 8GB
        standard: { minCpu: 2, minMemory: 4 * 1024 * 1024 * 1024 }, // 4GB
        basic: { minCpu: 1, minMemory: 2 * 1024 * 1024 * 1024 }     // 2GB
      },
      
      // Priority levels
      priorityLevels: options.priorityLevels || {
        urgent: 10,
        high: 7,
        normal: 5,
        low: 3,
        background: 1
      },
      
      // Tier assignment rules
      tierAssignment: options.tierAssignment || {
        urgent: ['premium', 'standard'],     // Urgent tasks can use premium or standard
        high: ['premium', 'standard'],        // High priority similar to urgent
        normal: ['standard', 'basic'],        // Normal tasks use standard or basic
        low: ['basic'],                       // Low priority only uses basic
        background: ['basic']                 // Background tasks only use basic
      },
      
      // Performance tracking
      performanceWindow: options.performanceWindow || 3600000, // 1 hour
      performanceThreshold: options.performanceThreshold || 0.8, // 80% success rate
      
      ...options
    };
    
    // Worker classifications
    this.workerTiers = new Map();
    this.workerPerformance = new Map();
    this.priorityQueue = new Map(); // Track priority distribution
  }
  
  onInitialize() {
    // Classify existing workers
    if (this.workerPool) {
      for (const [workerId, workerInfo] of this.workerPool.workers) {
        this.classifyWorker(workerId, workerInfo);
      }
    }
    
    // Set up performance tracking cleanup
    this.performanceCleanupInterval = setInterval(() => {
      this.cleanupPerformanceData();
    }, 300000); // Every 5 minutes
  }
  
  /**
   * Select worker based on task priority and worker capabilities
   */
  async doSelectWorker(task, availableWorkers, workerInfoMap) {
    // Determine task priority
    const priority = this.getTaskPriority(task);
    
    // Get allowed tiers for this priority
    const allowedTiers = this.config.tierAssignment[priority] || ['basic'];
    
    // Filter workers by tier and availability
    const candidates = this.filterWorkersByTier(availableWorkers, allowedTiers, workerInfoMap);
    
    if (candidates.length === 0) {
      // No workers in preferred tiers, fallback to any available
      return this.selectFallbackWorker(availableWorkers, workerInfoMap);
    }
    
    // Select best worker from candidates
    const selectedWorker = this.selectBestWorker(candidates, workerInfoMap, priority);
    
    // Update metrics
    if (selectedWorker) {
      this.recordPriorityAssignment(priority, this.workerTiers.get(selectedWorker));
    }
    
    return selectedWorker;
  }
  
  /**
   * Get task priority from task object
   */
  getTaskPriority(task) {
    // Check explicit priority
    if (task.priority && this.config.priorityLevels[task.priority] !== undefined) {
      return task.priority;
    }
    
    // Check priority level number
    if (typeof task.priority === 'number') {
      // Map number to closest priority level
      const levels = Object.entries(this.config.priorityLevels)
        .sort((a, b) => b[1] - a[1]);
      
      for (const [level, value] of levels) {
        if (task.priority >= value) {
          return level;
        }
      }
    }
    
    // Check for priority indicators in task type or labels
    if (task.type) {
      const type = task.type.toLowerCase();
      if (type.includes('urgent') || type.includes('emergency')) return 'urgent';
      if (type.includes('high') || type.includes('important')) return 'high';
      if (type.includes('low') || type.includes('background')) return 'low';
    }
    
    // Default to normal priority
    return 'normal';
  }
  
  /**
   * Classify worker into tier based on resources
   */
  classifyWorker(workerId, workerInfo) {
    const cpuCount = require('os').cpus().length;
    const totalMemory = require('os').totalmem();
    
    // Check each tier from highest to lowest
    for (const [tierName, requirements] of Object.entries(this.config.tiers)) {
      if (cpuCount >= requirements.minCpu && totalMemory >= requirements.minMemory) {
        this.workerTiers.set(workerId, tierName);
        return tierName;
      }
    }
    
    // Default to basic tier
    this.workerTiers.set(workerId, 'basic');
    return 'basic';
  }
  
  /**
   * Filter workers by allowed tiers
   */
  filterWorkersByTier(availableWorkers, allowedTiers, workerInfoMap) {
    return availableWorkers.filter(workerId => {
      const tier = this.workerTiers.get(workerId);
      return tier && allowedTiers.includes(tier);
    });
  }
  
  /**
   * Select best worker from candidates
   */
  selectBestWorker(candidates, workerInfoMap, priority) {
    let bestWorker = null;
    let bestScore = -Infinity;
    
    for (const workerId of candidates) {
      const workerInfo = workerInfoMap.get(workerId);
      if (!workerInfo) continue;
      
      // Calculate worker score
      const score = this.calculatePriorityScore(workerId, workerInfo, priority);
      
      if (score > bestScore) {
        bestScore = score;
        bestWorker = workerId;
      }
    }
    
    return bestWorker;
  }
  
  /**
   * Calculate priority-based score for worker
   */
  calculatePriorityScore(workerId, workerInfo, priority) {
    let score = 0;
    
    // Base score from tier (higher tier = higher score)
    const tier = this.workerTiers.get(workerId);
    const tierScore = tier === 'premium' ? 3 : tier === 'standard' ? 2 : 1;
    score += tierScore * 10;
    
    // Adjust for current load (less load = higher score)
    const loadScore = 100 - workerInfo.cpu;
    score += loadScore * 0.5;
    
    // Adjust for performance history
    const performance = this.getWorkerPerformance(workerId);
    score += performance * 20;
    
    // Boost score for underutilized premium workers on high priority tasks
    if ((priority === 'urgent' || priority === 'high') && tier === 'premium') {
      if (!workerInfo.currentTask) {
        score += 30; // Significant boost for idle premium workers
      }
    }
    
    // Penalty for overloaded workers
    if (workerInfo.cpu > 70) {
      score -= (workerInfo.cpu - 70) * 2;
    }
    
    return score;
  }
  
  /**
   * Select fallback worker when no tier-appropriate workers available
   */
  selectFallbackWorker(availableWorkers, workerInfoMap) {
    // Use simple load-based selection
    let selected = null;
    let lowestCpu = Infinity;
    
    for (const workerId of availableWorkers) {
      const workerInfo = workerInfoMap.get(workerId);
      if (workerInfo && workerInfo.cpu < lowestCpu) {
        lowestCpu = workerInfo.cpu;
        selected = workerId;
      }
    }
    
    return selected;
  }
  
  /**
   * Get worker performance score (0-1)
   */
  getWorkerPerformance(workerId) {
    const history = this.workerPerformance.get(workerId);
    if (!history || history.length === 0) {
      return 0.5; // Default neutral performance
    }
    
    // Calculate success rate in performance window
    const now = Date.now();
    const recentTasks = history.filter(task => 
      now - task.timestamp < this.config.performanceWindow
    );
    
    if (recentTasks.length === 0) {
      return 0.5;
    }
    
    const successCount = recentTasks.filter(task => task.success).length;
    return successCount / recentTasks.length;
  }
  
  /**
   * Record priority assignment for metrics
   */
  recordPriorityAssignment(priority, tier) {
    // Update priority distribution
    const key = `${priority}_${tier}`;
    const current = this.metrics.strategySpecificMetrics[key] || 0;
    this.updateStrategyMetric(key, current + 1);
    
    // Track priority queue depth
    if (!this.priorityQueue.has(priority)) {
      this.priorityQueue.set(priority, 0);
    }
    this.priorityQueue.set(priority, this.priorityQueue.get(priority) + 1);
  }
  
  /**
   * Handle task completion
   */
  onTaskCompleted(workerId, task, result) {
    // Record performance
    if (!this.workerPerformance.has(workerId)) {
      this.workerPerformance.set(workerId, []);
    }
    
    this.workerPerformance.get(workerId).push({
      timestamp: Date.now(),
      taskId: task.id,
      priority: this.getTaskPriority(task),
      success: result.success !== false,
      duration: result.duration || 0
    });
    
    // Update priority queue
    const priority = this.getTaskPriority(task);
    if (this.priorityQueue.has(priority)) {
      const count = this.priorityQueue.get(priority);
      if (count > 1) {
        this.priorityQueue.set(priority, count - 1);
      } else {
        this.priorityQueue.delete(priority);
      }
    }
  }
  
  /**
   * Handle worker addition
   */
  onWorkerAdded(workerId, workerInfo) {
    this.classifyWorker(workerId, workerInfo);
  }
  
  /**
   * Handle worker removal
   */
  onWorkerRemoved(workerId) {
    this.workerTiers.delete(workerId);
    this.workerPerformance.delete(workerId);
  }
  
  /**
   * Clean up old performance data
   */
  cleanupPerformanceData() {
    const now = Date.now();
    
    for (const [workerId, history] of this.workerPerformance) {
      const filtered = history.filter(task => 
        now - task.timestamp < this.config.performanceWindow * 2
      );
      
      if (filtered.length === 0) {
        this.workerPerformance.delete(workerId);
      } else {
        this.workerPerformance.set(workerId, filtered);
      }
    }
  }
  
  /**
   * Get strategy metrics
   */
  getMetrics() {
    const baseMetrics = super.getMetrics();
    
    // Calculate tier distribution
    const tierDistribution = {};
    for (const tier of this.workerTiers.values()) {
      tierDistribution[tier] = (tierDistribution[tier] || 0) + 1;
    }
    
    // Calculate priority distribution
    const priorityDistribution = {};
    for (const [key, value] of Object.entries(this.metrics.strategySpecificMetrics)) {
      if (key.includes('_')) {
        const [priority, tier] = key.split('_');
        if (!priorityDistribution[priority]) {
          priorityDistribution[priority] = {};
        }
        priorityDistribution[priority][tier] = value;
      }
    }
    
    return {
      ...baseMetrics,
      tierDistribution,
      priorityDistribution,
      currentQueueDepth: Object.fromEntries(this.priorityQueue),
      workerPerformance: this.getAggregatePerformance()
    };
  }
  
  /**
   * Get aggregate performance metrics
   */
  getAggregatePerformance() {
    const aggregate = {
      overall: 0,
      byTier: {},
      byPriority: {}
    };
    
    let totalTasks = 0;
    let totalSuccess = 0;
    
    for (const [workerId, history] of this.workerPerformance) {
      const tier = this.workerTiers.get(workerId);
      if (!tier) continue;
      
      for (const task of history) {
        totalTasks++;
        if (task.success) totalSuccess++;
        
        // By tier
        if (!aggregate.byTier[tier]) {
          aggregate.byTier[tier] = { total: 0, success: 0 };
        }
        aggregate.byTier[tier].total++;
        if (task.success) aggregate.byTier[tier].success++;
        
        // By priority
        if (!aggregate.byPriority[task.priority]) {
          aggregate.byPriority[task.priority] = { total: 0, success: 0 };
        }
        aggregate.byPriority[task.priority].total++;
        if (task.success) aggregate.byPriority[task.priority].success++;
      }
    }
    
    // Calculate rates
    aggregate.overall = totalTasks > 0 ? totalSuccess / totalTasks : 0;
    
    for (const tier of Object.keys(aggregate.byTier)) {
      const data = aggregate.byTier[tier];
      aggregate.byTier[tier].rate = data.total > 0 ? data.success / data.total : 0;
    }
    
    for (const priority of Object.keys(aggregate.byPriority)) {
      const data = aggregate.byPriority[priority];
      aggregate.byPriority[priority].rate = data.total > 0 ? data.success / data.total : 0;
    }
    
    return aggregate;
  }
  
  /**
   * Reset strategy state
   */
  onReset() {
    this.workerTiers.clear();
    this.workerPerformance.clear();
    this.priorityQueue.clear();
    
    if (this.performanceCleanupInterval) {
      clearInterval(this.performanceCleanupInterval);
    }
  }
}

module.exports = PriorityBasedStrategy;