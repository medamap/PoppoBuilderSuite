/**
 * Resource-Aware Strategy
 * Assigns tasks based on resource requirements and worker availability
 */

const BaseStrategy = require('./base-strategy');
const os = require('os');

class ResourceAwareStrategy extends BaseStrategy {
  constructor(options = {}) {
    super({
      name: 'resource-aware',
      description: 'Matches task resource requirements with worker capabilities',
      ...options
    });
    
    // Strategy configuration
    this.config = {
      // Resource estimation defaults
      defaultRequirements: options.defaultRequirements || {
        cpu: 20,        // 20% CPU
        memory: 512,    // 512 MB
        timeout: 300000 // 5 minutes
      },
      
      // Task type resource profiles
      taskProfiles: options.taskProfiles || {
        'compile': { cpu: 80, memory: 2048, timeout: 600000 },
        'test': { cpu: 50, memory: 1024, timeout: 300000 },
        'lint': { cpu: 30, memory: 512, timeout: 120000 },
        'build': { cpu: 90, memory: 4096, timeout: 900000 },
        'deploy': { cpu: 40, memory: 1024, timeout: 600000 },
        'analyze': { cpu: 60, memory: 2048, timeout: 600000 }
      },
      
      // Safety margins
      cpuSafetyMargin: options.cpuSafetyMargin || 10,      // Reserve 10% CPU
      memorySafetyMargin: options.memorySafetyMargin || 0.1, // Reserve 10% memory
      
      // Overcommit settings
      allowOvercommit: options.allowOvercommit !== false,
      maxOvercommit: options.maxOvercommit || 1.2, // Allow 20% overcommit
      
      // Resource prediction
      enablePrediction: options.enablePrediction !== false,
      predictionWindow: options.predictionWindow || 300000, // 5 minutes
      
      ...options
    };
    
    // Resource tracking
    this.resourceHistory = new Map(); // worker -> resource samples
    this.taskResourceUsage = new Map(); // task type -> actual usage stats
    this.predictions = new Map(); // worker -> predicted available resources
  }
  
  onInitialize() {
    // Start resource prediction
    if (this.config.enablePrediction) {
      this.predictionInterval = setInterval(() => {
        this.updatePredictions();
      }, 30000); // Every 30 seconds
    }
  }
  
  /**
   * Select worker based on resource matching
   */
  async doSelectWorker(task, availableWorkers, workerInfoMap) {
    // Get task resource requirements
    const requirements = this.getTaskRequirements(task);
    
    // Find workers with sufficient resources
    const candidates = this.findCapableWorkers(
      availableWorkers, 
      workerInfoMap, 
      requirements
    );
    
    if (candidates.length === 0 && this.config.allowOvercommit) {
      // Try with overcommit
      return this.selectWithOvercommit(
        availableWorkers, 
        workerInfoMap, 
        requirements
      );
    }
    
    // Select best match from candidates
    return this.selectBestMatch(candidates, workerInfoMap, requirements);
  }
  
  /**
   * Get resource requirements for a task
   */
  getTaskRequirements(task) {
    // Check explicit requirements
    if (task.requirements) {
      return {
        cpu: task.requirements.cpu || this.config.defaultRequirements.cpu,
        memory: task.requirements.memory || this.config.defaultRequirements.memory,
        timeout: task.requirements.timeout || this.config.defaultRequirements.timeout
      };
    }
    
    // Check task type profile
    const type = task.type || 'default';
    const profile = this.config.taskProfiles[type];
    if (profile) {
      return { ...profile };
    }
    
    // Use learned requirements if available
    if (this.config.enablePrediction) {
      const learned = this.getLearnedRequirements(type);
      if (learned) {
        return learned;
      }
    }
    
    // Default requirements
    return { ...this.config.defaultRequirements };
  }
  
  /**
   * Get learned requirements from historical data
   */
  getLearnedRequirements(taskType) {
    const usage = this.taskResourceUsage.get(taskType);
    if (!usage || usage.samples < 5) {
      return null;
    }
    
    // Use 90th percentile for safety
    return {
      cpu: usage.cpu.p90,
      memory: usage.memory.p90,
      timeout: usage.duration.p90
    };
  }
  
  /**
   * Find workers with sufficient resources
   */
  findCapableWorkers(availableWorkers, workerInfoMap, requirements) {
    const capable = [];
    
    for (const workerId of availableWorkers) {
      const workerInfo = workerInfoMap.get(workerId);
      if (!workerInfo) continue;
      
      const available = this.getAvailableResources(workerId, workerInfo);
      
      if (this.hassufficientResources(available, requirements)) {
        capable.push({
          workerId,
          available,
          score: this.calculateResourceScore(available, requirements)
        });
      }
    }
    
    // Sort by score (best match first)
    return capable.sort((a, b) => b.score - a.score);
  }
  
  /**
   * Get available resources for a worker
   */
  getAvailableResources(workerId, workerInfo) {
    const totalMemory = os.totalmem();
    
    // Current usage
    const currentCpu = workerInfo.cpu || 0;
    const currentMemory = workerInfo.memory || 0;
    
    // Check predictions if enabled
    let predictedCpu = currentCpu;
    let predictedMemory = currentMemory;
    
    if (this.config.enablePrediction && this.predictions.has(workerId)) {
      const prediction = this.predictions.get(workerId);
      predictedCpu = Math.max(currentCpu, prediction.cpu);
      predictedMemory = Math.max(currentMemory, prediction.memory);
    }
    
    // Calculate available with safety margins
    const availableCpu = Math.max(0, 100 - predictedCpu - this.config.cpuSafetyMargin);
    const availableMemory = Math.max(0, 
      totalMemory - predictedMemory - (totalMemory * this.config.memorySafetyMargin)
    );
    
    return {
      cpu: availableCpu,
      memory: availableMemory / (1024 * 1024), // Convert to MB
      memoryBytes: availableMemory
    };
  }
  
  /**
   * Check if resources are sufficient
   */
  hassufficientResources(available, requirements) {
    return available.cpu >= requirements.cpu && 
           available.memory >= requirements.memory;
  }
  
  /**
   * Calculate resource matching score
   */
  calculateResourceScore(available, requirements) {
    // Perfect match is 100, excess resources reduce score slightly
    let score = 100;
    
    // CPU score (penalize excess to avoid waste)
    const cpuRatio = available.cpu / requirements.cpu;
    if (cpuRatio > 2) {
      score -= (cpuRatio - 2) * 5; // Penalty for too much excess
    }
    
    // Memory score
    const memoryRatio = available.memory / requirements.memory;
    if (memoryRatio > 2) {
      score -= (memoryRatio - 2) * 3; // Smaller penalty for memory excess
    }
    
    // Bonus for close matches
    if (cpuRatio >= 1 && cpuRatio <= 1.5) {
      score += 10;
    }
    if (memoryRatio >= 1 && memoryRatio <= 1.5) {
      score += 10;
    }
    
    return Math.max(0, score);
  }
  
  /**
   * Select worker with overcommit
   */
  selectWithOvercommit(availableWorkers, workerInfoMap, requirements) {
    let bestWorker = null;
    let bestOvercommit = Infinity;
    
    for (const workerId of availableWorkers) {
      const workerInfo = workerInfoMap.get(workerId);
      if (!workerInfo) continue;
      
      const available = this.getAvailableResources(workerId, workerInfo);
      
      // Calculate overcommit needed
      const cpuOvercommit = requirements.cpu / (available.cpu || 1);
      const memoryOvercommit = requirements.memory / (available.memory || 1);
      const maxOvercommit = Math.max(cpuOvercommit, memoryOvercommit);
      
      // Check if within allowed overcommit
      if (maxOvercommit <= this.config.maxOvercommit && maxOvercommit < bestOvercommit) {
        bestOvercommit = maxOvercommit;
        bestWorker = workerId;
      }
    }
    
    if (bestWorker) {
      this.updateStrategyMetric('overcommitCount', 
        (this.metrics.strategySpecificMetrics.overcommitCount || 0) + 1
      );
      this.updateStrategyMetric('lastOvercommit', bestOvercommit);
    }
    
    return bestWorker;
  }
  
  /**
   * Select best matching worker
   */
  selectBestMatch(candidates, workerInfoMap, requirements) {
    if (candidates.length === 0) return null;
    
    // Already sorted by score
    const best = candidates[0];
    
    // Update metrics
    this.updateStrategyMetric('avgMatchScore', 
      this.calculateAvgMatchScore(best.score)
    );
    
    return best.workerId;
  }
  
  /**
   * Calculate average match score
   */
  calculateAvgMatchScore(newScore) {
    const current = this.metrics.strategySpecificMetrics.avgMatchScore || 0;
    const count = this.metrics.successfulAssignments;
    return (current * (count - 1) + newScore) / count;
  }
  
  /**
   * Update resource predictions
   */
  updatePredictions() {
    if (!this.workerPool) return;
    
    for (const [workerId, workerInfo] of this.workerPool.workers) {
      const history = this.resourceHistory.get(workerId);
      if (!history || history.length < 3) continue;
      
      // Simple moving average prediction
      const recentSamples = history.slice(-10); // Last 10 samples
      
      const avgCpu = recentSamples.reduce((sum, s) => sum + s.cpu, 0) / recentSamples.length;
      const avgMemory = recentSamples.reduce((sum, s) => sum + s.memory, 0) / recentSamples.length;
      
      // Trend detection
      const trend = this.detectTrend(recentSamples);
      
      // Predict with trend adjustment
      this.predictions.set(workerId, {
        cpu: Math.min(100, avgCpu + trend.cpu * 5),
        memory: avgMemory + trend.memory * 1024 * 1024 * 100 // 100MB trend adjustment
      });
    }
  }
  
  /**
   * Detect resource usage trend
   */
  detectTrend(samples) {
    if (samples.length < 2) {
      return { cpu: 0, memory: 0 };
    }
    
    // Simple linear trend
    const first = samples[0];
    const last = samples[samples.length - 1];
    const duration = last.timestamp - first.timestamp;
    
    if (duration === 0) {
      return { cpu: 0, memory: 0 };
    }
    
    return {
      cpu: (last.cpu - first.cpu) / (duration / 60000), // Per minute
      memory: (last.memory - first.memory) / (duration / 60000)
    };
  }
  
  /**
   * Handle task completion
   */
  onTaskCompleted(workerId, task, result) {
    // Record actual resource usage
    if (result.resourceUsage) {
      this.recordTaskResourceUsage(task, result.resourceUsage);
    }
    
    // Update worker resource history
    const workerInfo = this.workerPool?.workers.get(workerId);
    if (workerInfo) {
      this.recordWorkerResources(workerId, workerInfo);
    }
  }
  
  /**
   * Record task resource usage for learning
   */
  recordTaskResourceUsage(task, usage) {
    const type = task.type || 'default';
    
    if (!this.taskResourceUsage.has(type)) {
      this.taskResourceUsage.set(type, {
        samples: 0,
        cpu: { samples: [], p50: 0, p90: 0 },
        memory: { samples: [], p50: 0, p90: 0 },
        duration: { samples: [], p50: 0, p90: 0 }
      });
    }
    
    const stats = this.taskResourceUsage.get(type);
    stats.samples++;
    
    // Add samples
    stats.cpu.samples.push(usage.cpu || 0);
    stats.memory.samples.push(usage.memory || 0);
    stats.duration.samples.push(usage.duration || 0);
    
    // Keep only recent samples
    const maxSamples = 100;
    if (stats.cpu.samples.length > maxSamples) {
      stats.cpu.samples.shift();
      stats.memory.samples.shift();
      stats.duration.samples.shift();
    }
    
    // Update percentiles
    this.updatePercentiles(stats.cpu);
    this.updatePercentiles(stats.memory);
    this.updatePercentiles(stats.duration);
  }
  
  /**
   * Update percentile values
   */
  updatePercentiles(stat) {
    if (stat.samples.length === 0) return;
    
    const sorted = [...stat.samples].sort((a, b) => a - b);
    const p50Index = Math.floor(sorted.length * 0.5);
    const p90Index = Math.floor(sorted.length * 0.9);
    
    stat.p50 = sorted[p50Index];
    stat.p90 = sorted[p90Index];
  }
  
  /**
   * Record worker resource usage
   */
  recordWorkerResources(workerId, workerInfo) {
    if (!this.resourceHistory.has(workerId)) {
      this.resourceHistory.set(workerId, []);
    }
    
    const history = this.resourceHistory.get(workerId);
    history.push({
      timestamp: Date.now(),
      cpu: workerInfo.cpu || 0,
      memory: workerInfo.memory || 0
    });
    
    // Keep only recent history
    const maxAge = this.config.predictionWindow;
    const now = Date.now();
    const filtered = history.filter(s => now - s.timestamp < maxAge);
    this.resourceHistory.set(workerId, filtered);
  }
  
  /**
   * Handle worker removal
   */
  onWorkerRemoved(workerId) {
    this.resourceHistory.delete(workerId);
    this.predictions.delete(workerId);
  }
  
  /**
   * Get strategy metrics
   */
  getMetrics() {
    const baseMetrics = super.getMetrics();
    
    // Calculate resource utilization
    const utilization = this.calculateResourceUtilization();
    
    return {
      ...baseMetrics,
      resourceUtilization: utilization,
      overcommitRate: this.calculateOvercommitRate(),
      predictionAccuracy: this.calculatePredictionAccuracy(),
      taskProfiles: this.getTaskProfileSummary()
    };
  }
  
  /**
   * Calculate resource utilization across workers
   */
  calculateResourceUtilization() {
    if (!this.workerPool || this.workerPool.workers.size === 0) {
      return { cpu: 0, memory: 0 };
    }
    
    let totalCpu = 0;
    let totalMemory = 0;
    let count = 0;
    
    for (const workerInfo of this.workerPool.workers.values()) {
      totalCpu += workerInfo.cpu || 0;
      totalMemory += (workerInfo.memory || 0) / os.totalmem() * 100;
      count++;
    }
    
    return {
      cpu: count > 0 ? totalCpu / count : 0,
      memory: count > 0 ? totalMemory / count : 0
    };
  }
  
  /**
   * Calculate overcommit rate
   */
  calculateOvercommitRate() {
    const overcommits = this.metrics.strategySpecificMetrics.overcommitCount || 0;
    return this.metrics.totalAssignments > 0 
      ? overcommits / this.metrics.totalAssignments 
      : 0;
  }
  
  /**
   * Calculate prediction accuracy (placeholder)
   */
  calculatePredictionAccuracy() {
    // This would compare predictions with actual usage
    // For now, return a placeholder
    return this.config.enablePrediction ? 0.85 : null;
  }
  
  /**
   * Get task profile summary
   */
  getTaskProfileSummary() {
    const summary = {};
    
    for (const [type, stats] of this.taskResourceUsage) {
      if (stats.samples > 0) {
        summary[type] = {
          samples: stats.samples,
          cpu: { p50: stats.cpu.p50, p90: stats.cpu.p90 },
          memory: { p50: stats.memory.p50, p90: stats.memory.p90 },
          duration: { p50: stats.duration.p50, p90: stats.duration.p90 }
        };
      }
    }
    
    return summary;
  }
  
  /**
   * Reset strategy state
   */
  onReset() {
    this.resourceHistory.clear();
    this.taskResourceUsage.clear();
    this.predictions.clear();
    
    if (this.predictionInterval) {
      clearInterval(this.predictionInterval);
    }
  }
}

module.exports = ResourceAwareStrategy;