/**
 * Strategy Manager
 * Factory for creating and managing worker assignment strategies
 */

const EventEmitter = require('events');
const BaseStrategy = require('./base-strategy');
const LoadBalancingStrategy = require('./load-balancing');
const RoundRobinStrategy = require('./round-robin');
const PriorityBasedStrategy = require('./priority-based');
const AffinityStrategy = require('./affinity');
const ResourceAwareStrategy = require('./resource-aware');

// Strategy registry
const STRATEGIES = {
  'load-balancing': LoadBalancingStrategy,
  'round-robin': RoundRobinStrategy,
  'priority-based': PriorityBasedStrategy,
  'affinity': AffinityStrategy,
  'resource-aware': ResourceAwareStrategy
};

class StrategyManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      defaultStrategy: options.defaultStrategy || 'round-robin',
      enableComposite: options.enableComposite !== false,
      enableDynamicSwitching: options.enableDynamicSwitching || false,
      switchingThreshold: options.switchingThreshold || 0.7, // Performance threshold
      evaluationWindow: options.evaluationWindow || 300000, // 5 minutes
      ...options
    };
    
    // Current strategy
    this.currentStrategy = null;
    this.currentStrategyName = null;
    
    // Strategy instances (for switching)
    this.strategies = new Map();
    
    // Performance tracking
    this.performanceHistory = new Map();
    this.lastEvaluation = Date.now();
    
    // Composite strategy support
    this.compositeWeights = new Map();
  }
  
  /**
   * Initialize with worker pool reference
   */
  initialize(workerPool) {
    this.workerPool = workerPool;
    
    // Create default strategy
    this.setStrategy(this.options.defaultStrategy);
    
    // Set up dynamic switching if enabled
    if (this.options.enableDynamicSwitching) {
      this.evaluationInterval = setInterval(() => {
        this.evaluateAndSwitch();
      }, this.options.evaluationWindow);
    }
  }
  
  /**
   * Create a strategy instance
   */
  createStrategy(name, options = {}) {
    const StrategyClass = STRATEGIES[name];
    if (!StrategyClass) {
      throw new Error(`Unknown strategy: ${name}`);
    }
    
    const strategy = new StrategyClass(options);
    
    // Set up event forwarding
    strategy.on('worker-selected', (data) => {
      this.emit('worker-selected', {
        ...data,
        strategy: name
      });
    });
    
    strategy.on('selection-error', (data) => {
      this.emit('selection-error', {
        ...data,
        strategy: name
      });
    });
    
    strategy.on('assignment-failed', (data) => {
      this.emit('assignment-failed', {
        ...data,
        strategy: name
      });
    });
    
    // Initialize with worker pool
    if (this.workerPool) {
      strategy.initialize(this.workerPool);
    }
    
    return strategy;
  }
  
  /**
   * Set the active strategy
   */
  setStrategy(name, options = {}) {
    if (!STRATEGIES[name] && name !== 'composite') {
      throw new Error(`Unknown strategy: ${name}`);
    }
    
    // Handle composite strategy
    if (name === 'composite') {
      this.setupCompositeStrategy(options);
      return;
    }
    
    // Get or create strategy instance
    let strategy = this.strategies.get(name);
    if (!strategy) {
      strategy = this.createStrategy(name, options);
      this.strategies.set(name, strategy);
    }
    
    // Switch active strategy
    const previousStrategy = this.currentStrategyName;
    this.currentStrategy = strategy;
    this.currentStrategyName = name;
    
    this.emit('strategy-changed', {
      previous: previousStrategy,
      current: name
    });
  }
  
  /**
   * Set up composite strategy with multiple strategies
   */
  setupCompositeStrategy(options) {
    const { strategies = {}, weights = {} } = options;
    
    // Ensure we have strategies
    for (const [name, strategyOptions] of Object.entries(strategies)) {
      if (!this.strategies.has(name)) {
        const strategy = this.createStrategy(name, strategyOptions);
        this.strategies.set(name, strategy);
      }
    }
    
    // Set weights
    this.compositeWeights.clear();
    let totalWeight = 0;
    
    for (const [name, weight] of Object.entries(weights)) {
      if (this.strategies.has(name)) {
        this.compositeWeights.set(name, weight);
        totalWeight += weight;
      }
    }
    
    // Normalize weights
    if (totalWeight > 0) {
      for (const [name, weight] of this.compositeWeights) {
        this.compositeWeights.set(name, weight / totalWeight);
      }
    }
    
    this.currentStrategyName = 'composite';
    this.currentStrategy = null; // Composite doesn't have a single strategy
  }
  
  /**
   * Select a worker using the current strategy
   */
  async selectWorker(task, availableWorkers, workerInfoMap) {
    if (!availableWorkers || availableWorkers.length === 0) {
      return null;
    }
    
    // Handle composite strategy
    if (this.currentStrategyName === 'composite') {
      return this.selectWorkerComposite(task, availableWorkers, workerInfoMap);
    }
    
    // Use single strategy
    if (!this.currentStrategy) {
      throw new Error('No strategy configured');
    }
    
    const startTime = Date.now();
    const worker = await this.currentStrategy.selectWorker(task, availableWorkers, workerInfoMap);
    
    // Track performance
    this.recordSelection(this.currentStrategyName, worker !== null, Date.now() - startTime);
    
    return worker;
  }
  
  /**
   * Select worker using composite strategy
   */
  async selectWorkerComposite(task, availableWorkers, workerInfoMap) {
    const candidates = new Map();
    
    // Get recommendations from each strategy
    for (const [name, weight] of this.compositeWeights) {
      const strategy = this.strategies.get(name);
      if (!strategy) continue;
      
      const worker = await strategy.selectWorker(task, availableWorkers, workerInfoMap);
      if (worker) {
        const score = candidates.get(worker) || 0;
        candidates.set(worker, score + weight);
      }
    }
    
    // Select worker with highest composite score
    let bestWorker = null;
    let bestScore = 0;
    
    for (const [worker, score] of candidates) {
      if (score > bestScore) {
        bestScore = score;
        bestWorker = worker;
      }
    }
    
    // Track composite performance
    this.recordSelection('composite', bestWorker !== null, 0);
    
    return bestWorker;
  }
  
  /**
   * Record selection performance
   */
  recordSelection(strategyName, success, duration) {
    if (!this.performanceHistory.has(strategyName)) {
      this.performanceHistory.set(strategyName, {
        selections: 0,
        successes: 0,
        totalDuration: 0,
        recentSuccess: []
      });
    }
    
    const perf = this.performanceHistory.get(strategyName);
    perf.selections++;
    if (success) perf.successes++;
    perf.totalDuration += duration;
    
    // Track recent success rate
    perf.recentSuccess.push(success);
    if (perf.recentSuccess.length > 100) {
      perf.recentSuccess.shift();
    }
  }
  
  /**
   * Evaluate strategies and switch if needed
   */
  evaluateAndSwitch() {
    if (!this.options.enableDynamicSwitching) return;
    
    const currentPerf = this.getCurrentPerformance();
    if (!currentPerf || currentPerf.successRate >= this.options.switchingThreshold) {
      return; // Current strategy is performing well
    }
    
    // Find best performing strategy
    let bestStrategy = null;
    let bestRate = currentPerf.successRate;
    
    for (const [name, perf] of this.performanceHistory) {
      if (name === this.currentStrategyName) continue;
      
      const recentRate = this.calculateRecentSuccessRate(perf);
      if (recentRate > bestRate) {
        bestRate = recentRate;
        bestStrategy = name;
      }
    }
    
    // Switch if we found a better strategy
    if (bestStrategy && bestRate > currentPerf.successRate + 0.1) {
      this.emit('auto-switching', {
        from: this.currentStrategyName,
        to: bestStrategy,
        reason: `Performance improvement: ${currentPerf.successRate.toFixed(2)} -> ${bestRate.toFixed(2)}`
      });
      
      this.setStrategy(bestStrategy);
    }
  }
  
  /**
   * Get current strategy performance
   */
  getCurrentPerformance() {
    if (!this.currentStrategyName) return null;
    
    const perf = this.performanceHistory.get(this.currentStrategyName);
    if (!perf || perf.selections === 0) return null;
    
    return {
      strategy: this.currentStrategyName,
      selections: perf.selections,
      successRate: perf.successes / perf.selections,
      avgDuration: perf.totalDuration / perf.selections,
      recentSuccessRate: this.calculateRecentSuccessRate(perf)
    };
  }
  
  /**
   * Calculate recent success rate
   */
  calculateRecentSuccessRate(perf) {
    if (!perf.recentSuccess || perf.recentSuccess.length === 0) {
      return 0;
    }
    
    const successes = perf.recentSuccess.filter(s => s).length;
    return successes / perf.recentSuccess.length;
  }
  
  /**
   * Forward task completion to current strategy
   */
  onTaskCompleted(workerId, task, result) {
    if (this.currentStrategyName === 'composite') {
      // Forward to all strategies in composite
      for (const strategy of this.strategies.values()) {
        strategy.onTaskCompleted(workerId, task, result);
      }
    } else if (this.currentStrategy) {
      this.currentStrategy.onTaskCompleted(workerId, task, result);
    }
  }
  
  /**
   * Forward worker addition to strategies
   */
  onWorkerAdded(workerId, workerInfo) {
    for (const strategy of this.strategies.values()) {
      strategy.onWorkerAdded(workerId, workerInfo);
    }
  }
  
  /**
   * Forward worker removal to strategies
   */
  onWorkerRemoved(workerId) {
    for (const strategy of this.strategies.values()) {
      strategy.onWorkerRemoved(workerId);
    }
  }
  
  /**
   * Get all available strategies
   */
  static getAvailableStrategies() {
    return Object.keys(STRATEGIES);
  }
  
  /**
   * Register a custom strategy
   */
  static registerStrategy(name, StrategyClass) {
    if (!StrategyClass.prototype instanceof BaseStrategy) {
      throw new Error('Strategy must extend BaseStrategy');
    }
    STRATEGIES[name] = StrategyClass;
  }
  
  /**
   * Get metrics for all strategies
   */
  getAllMetrics() {
    const metrics = {
      current: this.currentStrategyName,
      strategies: {}
    };
    
    for (const [name, strategy] of this.strategies) {
      metrics.strategies[name] = {
        ...strategy.getMetrics(),
        performance: this.performanceHistory.get(name) || null
      };
    }
    
    if (this.currentStrategyName === 'composite') {
      metrics.composite = {
        weights: Object.fromEntries(this.compositeWeights),
        performance: this.performanceHistory.get('composite') || null
      };
    }
    
    return metrics;
  }
  
  /**
   * Get current strategy metrics
   */
  getCurrentMetrics() {
    if (this.currentStrategyName === 'composite') {
      return {
        strategy: 'composite',
        weights: Object.fromEntries(this.compositeWeights),
        performance: this.getCurrentPerformance()
      };
    }
    
    if (!this.currentStrategy) return null;
    
    return {
      strategy: this.currentStrategyName,
      ...this.currentStrategy.getMetrics(),
      performance: this.getCurrentPerformance()
    };
  }
  
  /**
   * Reset all strategies
   */
  reset() {
    for (const strategy of this.strategies.values()) {
      strategy.reset();
    }
    
    this.performanceHistory.clear();
    this.compositeWeights.clear();
  }
  
  /**
   * Shutdown and cleanup
   */
  shutdown() {
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
    }
    
    this.reset();
    this.strategies.clear();
    this.currentStrategy = null;
    this.currentStrategyName = null;
  }
}

// Export manager and strategies
module.exports = StrategyManager;
module.exports.BaseStrategy = BaseStrategy;
module.exports.strategies = STRATEGIES;