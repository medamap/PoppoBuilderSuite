/**
 * Issue #128: Optimization Engine
 * 
 * Automatic optimization engine that applies performance improvements
 */

const ProductionLogger = require('../utils/production-logger');

class OptimizationEngine {
  constructor(performanceMonitor, options = {}) {
    this.performanceMonitor = performanceMonitor;
    this.options = {
      enableAutoOptimization: options.enableAutoOptimization !== false,
      optimizationInterval: options.optimizationInterval || 300000, // 5 minutes
      aggressiveness: options.aggressiveness || 'moderate', // conservative, moderate, aggressive
      learningEnabled: options.learningEnabled !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('OptimizationEngine', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true
    });
    
    this.optimizationHistory = [];
    this.optimizationRules = new Map();
    this.learningData = new Map();
    
    this.isRunning = false;
    this.optimizationTimer = null;
    
    this.initializeOptimizationRules();
  }

  /**
   * Initialize optimization rules
   */
  initializeOptimizationRules() {
    // Memory optimization rules
    this.optimizationRules.set('memory-pressure', {
      condition: (metrics) => metrics.memory.heapUsagePercent > 75,
      action: this.optimizeMemory.bind(this),
      priority: 'high',
      cooldown: 60000 // 1 minute
    });
    
    // CPU optimization rules
    this.optimizationRules.set('cpu-pressure', {
      condition: (metrics) => metrics.cpu.percentage > 70,
      action: this.optimizeCpu.bind(this),
      priority: 'high',
      cooldown: 120000 // 2 minutes
    });
    
    // Event loop optimization rules
    this.optimizationRules.set('eventloop-lag', {
      condition: (metrics) => metrics.eventLoop.lagMS > 50,
      action: this.optimizeEventLoop.bind(this),
      priority: 'medium',
      cooldown: 30000 // 30 seconds
    });
    
    // GC optimization rules
    this.optimizationRules.set('gc-frequency', {
      condition: (metrics) => this.isFrequentGC(metrics),
      action: this.optimizeGarbageCollection.bind(this),
      priority: 'medium',
      cooldown: 180000 // 3 minutes
    });
    
    // Operation optimization rules
    this.optimizationRules.set('slow-operations', {
      condition: () => this.hasSlowOperations(),
      action: this.optimizeOperations.bind(this),
      priority: 'low',
      cooldown: 300000 // 5 minutes
    });
  }

  /**
   * Start optimization engine
   */
  async start() {
    if (this.isRunning) return;
    
    try {
      await this.logger.info('Starting Optimization Engine');
      
      this.isRunning = true;
      
      // Start optimization cycle
      this.optimizationTimer = setInterval(async () => {
        try {
          await this.runOptimizationCycle();
        } catch (error) {
          await this.logger.error('Optimization cycle failed', { error });
        }
      }, this.options.optimizationInterval);
      
      await this.logger.info('Optimization Engine started successfully');
      
    } catch (error) {
      await this.logger.error('Failed to start Optimization Engine', { error });
      throw error;
    }
  }

  /**
   * Stop optimization engine
   */
  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.optimizationTimer) {
      clearInterval(this.optimizationTimer);
      this.optimizationTimer = null;
    }
    
    await this.logger.info('Optimization Engine stopped');
  }

  /**
   * Run optimization cycle
   */
  async runOptimizationCycle() {
    if (!this.options.enableAutoOptimization) return;
    
    const startTime = Date.now();
    const appliedOptimizations = [];
    
    // Get current performance metrics
    const report = this.performanceMonitor.getPerformanceReport();
    const currentMetrics = report.currentMetrics;
    
    await this.logger.logStructured('debug', 'Starting optimization cycle', {
      component: 'OptimizationCycle',
      metrics: currentMetrics
    });
    
    // Check each optimization rule
    for (const [ruleId, rule] of this.optimizationRules.entries()) {
      try {
        // Check cooldown
        if (this.isRuleInCooldown(ruleId)) {
          continue;
        }
        
        // Check condition
        if (rule.condition(currentMetrics)) {
          await this.logger.logStructured('info', `Applying optimization: ${ruleId}`, {
            component: 'OptimizationApplication',
            rule: ruleId,
            priority: rule.priority
          });
          
          const optimizationResult = await rule.action(currentMetrics, report);
          
          if (optimizationResult && optimizationResult.applied) {
            appliedOptimizations.push({
              rule: ruleId,
              result: optimizationResult,
              timestamp: Date.now()
            });
            
            // Record in history
            this.recordOptimization(ruleId, optimizationResult);
            
            // Learn from optimization
            if (this.options.learningEnabled) {
              this.recordLearningData(ruleId, currentMetrics, optimizationResult);
            }
          }
        }
      } catch (error) {
        await this.logger.error(`Optimization rule failed: ${ruleId}`, { error });
      }
    }
    
    const duration = Date.now() - startTime;
    
    if (appliedOptimizations.length > 0) {
      await this.logger.logStructured('info', 'Optimization cycle completed', {
        component: 'OptimizationCycle',
        duration,
        optimizationsApplied: appliedOptimizations.length,
        optimizations: appliedOptimizations
      });
    }
    
    return {
      duration,
      optimizationsApplied: appliedOptimizations.length,
      optimizations: appliedOptimizations
    };
  }

  /**
   * Check if rule is in cooldown
   */
  isRuleInCooldown(ruleId) {
    const rule = this.optimizationRules.get(ruleId);
    if (!rule) return false;
    
    const lastApplication = this.optimizationHistory
      .filter(h => h.rule === ruleId)
      .sort((a, b) => b.timestamp - a.timestamp)[0];
    
    if (!lastApplication) return false;
    
    return (Date.now() - lastApplication.timestamp) < rule.cooldown;
  }

  /**
   * Memory optimization implementation
   */
  async optimizeMemory(metrics, report) {
    const actions = [];
    
    try {
      // Force garbage collection if available
      if (global.gc) {
        const beforeGC = process.memoryUsage();
        global.gc();
        const afterGC = process.memoryUsage();
        
        actions.push({
          action: 'forced_gc',
          memoryFreed: beforeGC.heapUsed - afterGC.heapUsed
        });
      }
      
      // Clear internal caches if available
      if (this.clearInternalCaches) {
        const cleared = await this.clearInternalCaches();
        actions.push({
          action: 'cache_cleanup',
          cleared
        });
      }
      
      // Suggest memory optimization strategies based on aggressiveness
      if (this.options.aggressiveness === 'aggressive') {
        actions.push({
          action: 'memory_limit_suggestion',
          recommendation: 'Consider implementing memory limits for operations'
        });
      }
      
      return {
        applied: true,
        actions,
        type: 'memory_optimization',
        severity: metrics.memory.heapUsagePercent > 85 ? 'critical' : 'warning'
      };
      
    } catch (error) {
      await this.logger.error('Memory optimization failed', { error });
      return { applied: false, error: error.message };
    }
  }

  /**
   * CPU optimization implementation
   */
  async optimizeCpu(metrics, report) {
    const actions = [];
    
    try {
      // Reduce concurrent operations
      const concurrentOps = this.performanceMonitor.activeOperations.size;
      if (concurrentOps > 5) {
        actions.push({
          action: 'concurrent_operation_limit',
          currentCount: concurrentOps,
          suggestedLimit: Math.max(2, Math.floor(concurrentOps * 0.7))
        });
      }
      
      // Suggest CPU optimization based on operation stats
      const slowOperations = Object.entries(report.operationStats)
        .filter(([type, stats]) => stats.p95Duration > 1000)
        .map(([type, stats]) => ({ type, p95Duration: stats.p95Duration }));
      
      if (slowOperations.length > 0) {
        actions.push({
          action: 'slow_operation_analysis',
          slowOperations
        });
      }
      
      return {
        applied: true,
        actions,
        type: 'cpu_optimization',
        severity: metrics.cpu.percentage > 85 ? 'critical' : 'warning'
      };
      
    } catch (error) {
      await this.logger.error('CPU optimization failed', { error });
      return { applied: false, error: error.message };
    }
  }

  /**
   * Event loop optimization implementation
   */
  async optimizeEventLoop(metrics, report) {
    const actions = [];
    
    try {
      // Analyze blocking operations
      const blockingOps = Object.entries(report.operationStats)
        .filter(([type, stats]) => stats.avgDuration > 100) // Operations taking more than 100ms
        .map(([type, stats]) => ({ type, avgDuration: stats.avgDuration }));
      
      if (blockingOps.length > 0) {
        actions.push({
          action: 'blocking_operation_analysis',
          blockingOperations: blockingOps,
          recommendation: 'Consider making these operations asynchronous'
        });
      }
      
      // Suggest setImmediate for long-running operations
      if (this.options.aggressiveness === 'aggressive') {
        actions.push({
          action: 'async_strategy_suggestion',
          recommendation: 'Use setImmediate() to yield control back to event loop'
        });
      }
      
      return {
        applied: true,
        actions,
        type: 'eventloop_optimization',
        severity: metrics.eventLoop.lagMS > 100 ? 'critical' : 'warning'
      };
      
    } catch (error) {
      await this.logger.error('Event loop optimization failed', { error });
      return { applied: false, error: error.message };
    }
  }

  /**
   * Garbage collection optimization implementation
   */
  async optimizeGarbageCollection(metrics, report) {
    const actions = [];
    
    try {
      // Analyze GC patterns
      const gcMetrics = this.performanceMonitor.metrics.gc.slice(-60); // Last minute
      const avgGCDuration = gcMetrics.reduce((sum, gc) => sum + gc.duration, 0) / gcMetrics.length;
      
      actions.push({
        action: 'gc_pattern_analysis',
        frequency: gcMetrics.length,
        averageDuration: avgGCDuration,
        recommendation: gcMetrics.length > 10 ? 
          'Consider optimizing object allocation patterns' : 
          'GC frequency is acceptable'
      });
      
      // Suggest memory pool optimization
      if (this.options.aggressiveness === 'aggressive') {
        actions.push({
          action: 'memory_pool_suggestion',
          recommendation: 'Consider implementing object pools for frequently allocated objects'
        });
      }
      
      return {
        applied: true,
        actions,
        type: 'gc_optimization',
        severity: avgGCDuration > 50 ? 'warning' : 'info'
      };
      
    } catch (error) {
      await this.logger.error('GC optimization failed', { error });
      return { applied: false, error: error.message };
    }
  }

  /**
   * Operation optimization implementation
   */
  async optimizeOperations(metrics, report) {
    const actions = [];
    
    try {
      // Find the slowest operations
      const operationStats = Object.entries(report.operationStats)
        .sort((a, b) => b[1].p95Duration - a[1].p95Duration)
        .slice(0, 5);
      
      for (const [operationType, stats] of operationStats) {
        if (stats.p95Duration > 500) { // Slower than 500ms
          actions.push({
            action: 'slow_operation_optimization',
            operationType,
            p95Duration: stats.p95Duration,
            errorRate: stats.errorRate,
            recommendations: this.generateOperationRecommendations(stats)
          });
        }
      }
      
      return {
        applied: actions.length > 0,
        actions,
        type: 'operation_optimization'
      };
      
    } catch (error) {
      await this.logger.error('Operation optimization failed', { error });
      return { applied: false, error: error.message };
    }
  }

  /**
   * Generate operation-specific recommendations
   */
  generateOperationRecommendations(stats) {
    const recommendations = [];
    
    if (stats.p95Duration > 1000) {
      recommendations.push('Consider breaking down into smaller operations');
    }
    
    if (stats.errorRate > 5) {
      recommendations.push('High error rate detected - investigate error handling');
    }
    
    if (stats.memoryImpact.avgHeapDelta > 10) { // 10MB
      recommendations.push('High memory impact - consider memory optimization');
    }
    
    return recommendations;
  }

  /**
   * Check for frequent GC
   */
  isFrequentGC(metrics) {
    const recentGC = this.performanceMonitor.metrics.gc.slice(-60); // Last minute
    return recentGC.length > 8; // More than 8 GC events per minute
  }

  /**
   * Check for slow operations
   */
  hasSlowOperations() {
    const stats = this.performanceMonitor.operationStats;
    
    for (const [type, operationStats] of stats.entries()) {
      if (operationStats.p95Duration > 1000) { // Slower than 1 second
        return true;
      }
    }
    
    return false;
  }

  /**
   * Record optimization attempt
   */
  recordOptimization(ruleId, result) {
    this.optimizationHistory.push({
      rule: ruleId,
      result,
      timestamp: Date.now(),
      success: result.applied
    });
    
    // Keep only recent history
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    this.optimizationHistory = this.optimizationHistory.filter(h => h.timestamp > cutoff);
  }

  /**
   * Record learning data
   */
  recordLearningData(ruleId, metricsBefore, optimizationResult) {
    if (!this.learningData.has(ruleId)) {
      this.learningData.set(ruleId, []);
    }
    
    const data = this.learningData.get(ruleId);
    data.push({
      metricsBefore,
      optimizationResult,
      timestamp: Date.now()
    });
    
    // Keep only recent learning data
    if (data.length > 100) {
      this.learningData.set(ruleId, data.slice(-50));
    }
  }

  /**
   * Get optimization statistics
   */
  getOptimizationStatistics() {
    const total = this.optimizationHistory.length;
    const successful = this.optimizationHistory.filter(h => h.success).length;
    
    const byRule = {};
    for (const optimization of this.optimizationHistory) {
      if (!byRule[optimization.rule]) {
        byRule[optimization.rule] = { total: 0, successful: 0 };
      }
      byRule[optimization.rule].total++;
      if (optimization.success) {
        byRule[optimization.rule].successful++;
      }
    }
    
    return {
      total,
      successful,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      byRule,
      recentOptimizations: this.optimizationHistory.slice(-10)
    };
  }

  /**
   * Add custom optimization rule
   */
  addOptimizationRule(ruleId, rule) {
    this.optimizationRules.set(ruleId, {
      condition: rule.condition,
      action: rule.action,
      priority: rule.priority || 'low',
      cooldown: rule.cooldown || 300000,
      enabled: rule.enabled !== false
    });
  }

  /**
   * Remove optimization rule
   */
  removeOptimizationRule(ruleId) {
    this.optimizationRules.delete(ruleId);
  }

  /**
   * Enable/disable rule
   */
  toggleOptimizationRule(ruleId, enabled) {
    const rule = this.optimizationRules.get(ruleId);
    if (rule) {
      rule.enabled = enabled;
    }
  }
}

module.exports = OptimizationEngine;