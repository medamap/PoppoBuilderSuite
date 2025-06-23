/**
 * Affinity Strategy
 * Assigns tasks from the same project/context to the same worker when possible
 * Improves cache utilization and reduces context switching
 */

const BaseStrategy = require('./base-strategy');

class AffinityStrategy extends BaseStrategy {
  constructor(options = {}) {
    super({
      name: 'affinity',
      description: 'Maintains task-worker affinity for better cache utilization',
      ...options
    });
    
    // Strategy configuration
    this.config = {
      // Affinity types (what to group by)
      affinityTypes: options.affinityTypes || ['projectId', 'repository', 'type'],
      
      // How long to maintain affinity (ms)
      affinityDuration: options.affinityDuration || 3600000, // 1 hour
      
      // Maximum workers per affinity group
      maxWorkersPerGroup: options.maxWorkersPerGroup || 3,
      
      // Load threshold before breaking affinity
      loadThreshold: options.loadThreshold || 80, // 80% CPU
      
      // Sticky session support
      enableStickySessions: options.enableStickySessions !== false,
      
      // Cache warmup consideration
      cacheWarmupBonus: options.cacheWarmupBonus || 20, // Score bonus for warm cache
      
      ...options
    };
    
    // Affinity mappings
    this.affinityMap = new Map(); // affinity key -> Set of worker IDs
    this.workerAffinity = new Map(); // worker ID -> Set of affinity keys
    this.lastAssignment = new Map(); // affinity key -> timestamp
    this.sessionMap = new Map(); // session ID -> worker ID
  }
  
  onInitialize() {
    // Set up periodic cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupStaleAffinity();
    }, 300000); // Every 5 minutes
  }
  
  /**
   * Select worker based on affinity
   */
  async doSelectWorker(task, availableWorkers, workerInfoMap) {
    // Get affinity key for this task
    const affinityKey = this.getAffinityKey(task);
    
    // Check for sticky session
    if (this.config.enableStickySessions && task.sessionId) {
      const sessionWorker = this.sessionMap.get(task.sessionId);
      if (sessionWorker && availableWorkers.includes(sessionWorker)) {
        const workerInfo = workerInfoMap.get(sessionWorker);
        if (this.isWorkerSuitable(workerInfo)) {
          return sessionWorker;
        }
      }
    }
    
    // Try to find worker with existing affinity
    const affinityWorker = this.findAffinityWorker(affinityKey, availableWorkers, workerInfoMap);
    if (affinityWorker) {
      this.updateAffinity(affinityKey, affinityWorker);
      if (task.sessionId) {
        this.sessionMap.set(task.sessionId, affinityWorker);
      }
      return affinityWorker;
    }
    
    // No affinity match, select best new worker
    const newWorker = this.selectNewWorker(affinityKey, availableWorkers, workerInfoMap);
    if (newWorker) {
      this.createAffinity(affinityKey, newWorker);
      if (task.sessionId) {
        this.sessionMap.set(task.sessionId, newWorker);
      }
    }
    
    return newWorker;
  }
  
  /**
   * Get affinity key for a task
   */
  getAffinityKey(task) {
    const keyParts = [];
    
    for (const type of this.config.affinityTypes) {
      if (task[type]) {
        keyParts.push(`${type}:${task[type]}`);
      }
    }
    
    // If no affinity attributes found, use a generic key
    return keyParts.length > 0 ? keyParts.join('|') : 'default';
  }
  
  /**
   * Find worker with existing affinity
   */
  findAffinityWorker(affinityKey, availableWorkers, workerInfoMap) {
    const affinityWorkers = this.affinityMap.get(affinityKey);
    if (!affinityWorkers || affinityWorkers.size === 0) {
      return null;
    }
    
    // Score each affinity worker
    let bestWorker = null;
    let bestScore = -Infinity;
    
    for (const workerId of affinityWorkers) {
      if (!availableWorkers.includes(workerId)) continue;
      
      const workerInfo = workerInfoMap.get(workerId);
      if (!workerInfo || !this.isWorkerSuitable(workerInfo)) continue;
      
      const score = this.calculateAffinityScore(workerId, workerInfo, affinityKey);
      if (score > bestScore) {
        bestScore = score;
        bestWorker = workerId;
      }
    }
    
    return bestWorker;
  }
  
  /**
   * Check if worker is suitable for assignment
   */
  isWorkerSuitable(workerInfo) {
    if (!workerInfo) return false;
    
    // Check CPU load threshold
    if (workerInfo.cpu > this.config.loadThreshold) {
      return false;
    }
    
    // Worker is suitable
    return true;
  }
  
  /**
   * Calculate affinity score for a worker
   */
  calculateAffinityScore(workerId, workerInfo, affinityKey) {
    let score = 100; // Base score for having affinity
    
    // Add cache warmup bonus
    const workerAffinities = this.workerAffinity.get(workerId);
    if (workerAffinities && workerAffinities.has(affinityKey)) {
      score += this.config.cacheWarmupBonus;
    }
    
    // Adjust for current load (lower is better)
    score -= workerInfo.cpu * 0.5;
    
    // Adjust for memory usage
    const memoryPercent = (workerInfo.memory / require('os').totalmem()) * 100;
    score -= memoryPercent * 0.3;
    
    // Boost if worker has few affinities (not overloaded)
    const affinityCount = workerAffinities ? workerAffinities.size : 0;
    score += Math.max(0, 10 - affinityCount * 2);
    
    return score;
  }
  
  /**
   * Select new worker for affinity group
   */
  selectNewWorker(affinityKey, availableWorkers, workerInfoMap) {
    // Check if affinity group is at capacity
    const currentWorkers = this.affinityMap.get(affinityKey);
    if (currentWorkers && currentWorkers.size >= this.config.maxWorkersPerGroup) {
      // Group at capacity, use least loaded worker in group
      return this.findAffinityWorker(affinityKey, availableWorkers, workerInfoMap);
    }
    
    // Find best new worker
    let bestWorker = null;
    let bestScore = -Infinity;
    
    for (const workerId of availableWorkers) {
      const workerInfo = workerInfoMap.get(workerId);
      if (!workerInfo || !this.isWorkerSuitable(workerInfo)) continue;
      
      // Skip workers already in this affinity group
      if (currentWorkers && currentWorkers.has(workerId)) continue;
      
      const score = this.calculateNewWorkerScore(workerId, workerInfo);
      if (score > bestScore) {
        bestScore = score;
        bestWorker = workerId;
      }
    }
    
    return bestWorker;
  }
  
  /**
   * Calculate score for new worker selection
   */
  calculateNewWorkerScore(workerId, workerInfo) {
    let score = 50; // Base score
    
    // Prefer workers with fewer affinities
    const affinityCount = this.workerAffinity.get(workerId)?.size || 0;
    score -= affinityCount * 10;
    
    // Adjust for load
    score -= workerInfo.cpu * 0.5;
    score -= (workerInfo.memory / require('os').totalmem()) * 50;
    
    // Prefer newer workers (better distribution)
    const uptime = Date.now() - workerInfo.createdAt;
    score += Math.max(0, 20 - (uptime / 60000)); // Reduce score for older workers
    
    return score;
  }
  
  /**
   * Create new affinity mapping
   */
  createAffinity(affinityKey, workerId) {
    // Add to affinity map
    if (!this.affinityMap.has(affinityKey)) {
      this.affinityMap.set(affinityKey, new Set());
    }
    this.affinityMap.get(affinityKey).add(workerId);
    
    // Add to worker affinity
    if (!this.workerAffinity.has(workerId)) {
      this.workerAffinity.set(workerId, new Set());
    }
    this.workerAffinity.get(workerId).add(affinityKey);
    
    // Update last assignment
    this.lastAssignment.set(affinityKey, Date.now());
    
    // Update metrics
    this.updateStrategyMetric('activeAffinities', this.affinityMap.size);
    this.updateStrategyMetric('totalMappings', this.countTotalMappings());
  }
  
  /**
   * Update existing affinity timestamp
   */
  updateAffinity(affinityKey, workerId) {
    this.lastAssignment.set(affinityKey, Date.now());
    
    // Track affinity hits
    const hits = this.metrics.strategySpecificMetrics.affinityHits || 0;
    this.updateStrategyMetric('affinityHits', hits + 1);
  }
  
  /**
   * Clean up stale affinity mappings
   */
  cleanupStaleAffinity() {
    const now = Date.now();
    const staleKeys = [];
    
    // Find stale affinities
    for (const [key, timestamp] of this.lastAssignment) {
      if (now - timestamp > this.config.affinityDuration) {
        staleKeys.push(key);
      }
    }
    
    // Remove stale mappings
    for (const key of staleKeys) {
      const workers = this.affinityMap.get(key);
      if (workers) {
        for (const workerId of workers) {
          const workerAffinities = this.workerAffinity.get(workerId);
          if (workerAffinities) {
            workerAffinities.delete(key);
            if (workerAffinities.size === 0) {
              this.workerAffinity.delete(workerId);
            }
          }
        }
      }
      
      this.affinityMap.delete(key);
      this.lastAssignment.delete(key);
    }
    
    // Clean up old sessions
    for (const [sessionId, workerId] of this.sessionMap) {
      if (!this.workerPool?.workers.has(workerId)) {
        this.sessionMap.delete(sessionId);
      }
    }
  }
  
  /**
   * Handle task completion
   */
  onTaskCompleted(workerId, task, result) {
    const affinityKey = this.getAffinityKey(task);
    
    // Update affinity success metrics
    if (this.affinityMap.get(affinityKey)?.has(workerId)) {
      const successKey = result.success ? 'affinitySuccess' : 'affinityFailure';
      const current = this.metrics.strategySpecificMetrics[successKey] || 0;
      this.updateStrategyMetric(successKey, current + 1);
    }
  }
  
  /**
   * Handle worker removal
   */
  onWorkerRemoved(workerId) {
    // Remove worker from all affinity groups
    const workerAffinities = this.workerAffinity.get(workerId);
    if (workerAffinities) {
      for (const affinityKey of workerAffinities) {
        const workers = this.affinityMap.get(affinityKey);
        if (workers) {
          workers.delete(workerId);
          if (workers.size === 0) {
            this.affinityMap.delete(affinityKey);
            this.lastAssignment.delete(affinityKey);
          }
        }
      }
    }
    
    this.workerAffinity.delete(workerId);
    
    // Remove from session map
    for (const [sessionId, worker] of this.sessionMap) {
      if (worker === workerId) {
        this.sessionMap.delete(sessionId);
      }
    }
  }
  
  /**
   * Count total mappings across all workers
   */
  countTotalMappings() {
    let total = 0;
    for (const affinities of this.workerAffinity.values()) {
      total += affinities.size;
    }
    return total;
  }
  
  /**
   * Get strategy metrics
   */
  getMetrics() {
    const baseMetrics = super.getMetrics();
    
    // Calculate affinity effectiveness
    const hits = this.metrics.strategySpecificMetrics.affinityHits || 0;
    const affinityRate = this.metrics.totalAssignments > 0 
      ? hits / this.metrics.totalAssignments 
      : 0;
    
    // Calculate success rate for affinity assignments
    const affinitySuccess = this.metrics.strategySpecificMetrics.affinitySuccess || 0;
    const affinityFailure = this.metrics.strategySpecificMetrics.affinityFailure || 0;
    const affinityTotal = affinitySuccess + affinityFailure;
    const affinitySuccessRate = affinityTotal > 0 
      ? affinitySuccess / affinityTotal 
      : 0;
    
    return {
      ...baseMetrics,
      affinityGroups: this.affinityMap.size,
      totalMappings: this.countTotalMappings(),
      activeSessions: this.sessionMap.size,
      affinityHitRate: affinityRate,
      affinitySuccessRate,
      workerDistribution: this.getWorkerDistribution()
    };
  }
  
  /**
   * Get distribution of affinities across workers
   */
  getWorkerDistribution() {
    const distribution = {};
    
    for (const [workerId, affinities] of this.workerAffinity) {
      distribution[workerId] = {
        affinityCount: affinities.size,
        affinities: Array.from(affinities)
      };
    }
    
    return distribution;
  }
  
  /**
   * Reset strategy state
   */
  onReset() {
    this.affinityMap.clear();
    this.workerAffinity.clear();
    this.lastAssignment.clear();
    this.sessionMap.clear();
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
  }
  
  /**
   * Get debug information
   */
  getDebugInfo() {
    return {
      strategy: this.options.name,
      affinityGroups: this.affinityMap.size,
      sessions: this.sessionMap.size,
      mappings: Object.fromEntries(
        Array.from(this.affinityMap).map(([key, workers]) => [
          key, 
          Array.from(workers)
        ])
      )
    };
  }
}

module.exports = AffinityStrategy;