/**
 * Issue #136: Auto-Scaling Engine
 * 
 * Intelligent auto-scaling system with:
 * - Real-time scaling decisions
 * - Multi-metric scaling triggers
 * - Predictive scaling
 * - Cost-aware scaling
 * - Circuit breaker patterns
 * - Scaling cooldowns
 */

const EventEmitter = require('events');
const ProductionLogger = require('../utils/production-logger');

class AutoScaler extends EventEmitter {
  constructor(capacityPlanner, performanceMonitor, options = {}) {
    super();
    
    this.capacityPlanner = capacityPlanner;
    this.performanceMonitor = performanceMonitor;
    
    this.options = {
      enabled: options.enabled !== false,
      evaluationInterval: options.evaluationInterval || 60000, // 1 minute
      scaleUpCooldown: options.scaleUpCooldown || 300000, // 5 minutes
      scaleDownCooldown: options.scaleDownCooldown || 600000, // 10 minutes
      maxScaleUpEvents: options.maxScaleUpEvents || 3, // per hour
      maxScaleDownEvents: options.maxScaleDownEvents || 2, // per hour
      emergencyScalingEnabled: options.emergencyScalingEnabled !== false,
      predictiveScalingEnabled: options.predictiveScalingEnabled !== false,
      costOptimizationEnabled: options.costOptimizationEnabled !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('AutoScaler', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true
    });
    
    this.isRunning = false;
    this.evaluationTimer = null;
    this.scalingHistory = [];
    this.lastScaleEvent = new Map(); // Track last scaling per resource
    this.scalingBlocked = new Map(); // Circuit breaker state
    this.currentInstances = new Map(); // Track current instance counts
    
    // Scaling policies
    this.scalingPolicies = new Map();
    this.scalingRules = new Map();
    
    this.initializeDefaultPolicies();
    this.initializeScalingRules();
  }

  /**
   * Initialize default scaling policies
   */
  initializeDefaultPolicies() {
    // CPU scaling policy
    this.scalingPolicies.set('cpu', {
      name: 'CPU Auto-scaling',
      enabled: true,
      scaleUpThreshold: 75,
      scaleDownThreshold: 45,
      scaleUpFactor: 1.5,
      scaleDownFactor: 0.7,
      minInstances: 1,
      maxInstances: 10,
      evaluationPeriods: 2,
      cooldown: {
        scaleUp: 300000,
        scaleDown: 600000
      }
    });
    
    // Memory scaling policy
    this.scalingPolicies.set('memory', {
      name: 'Memory Auto-scaling',
      enabled: true,
      scaleUpThreshold: 80,
      scaleDownThreshold: 50,
      scaleUpFactor: 1.3,
      scaleDownFactor: 0.8,
      minInstances: 1,
      maxInstances: 8,
      evaluationPeriods: 2,
      cooldown: {
        scaleUp: 300000,
        scaleDown: 600000
      }
    });
    
    // Request rate scaling policy
    this.scalingPolicies.set('request_rate', {
      name: 'Request Rate Auto-scaling',
      enabled: true,
      scaleUpThreshold: 1000, // requests per minute
      scaleDownThreshold: 300,
      scaleUpFactor: 2.0,
      scaleDownFactor: 0.5,
      minInstances: 1,
      maxInstances: 15,
      evaluationPeriods: 1,
      cooldown: {
        scaleUp: 180000, // 3 minutes
        scaleDown: 900000 // 15 minutes
      }
    });
    
    // Response time scaling policy
    this.scalingPolicies.set('response_time', {
      name: 'Response Time Auto-scaling',
      enabled: true,
      scaleUpThreshold: 800, // milliseconds
      scaleDownThreshold: 200,
      scaleUpFactor: 1.8,
      scaleDownFactor: 0.6,
      minInstances: 1,
      maxInstances: 12,
      evaluationPeriods: 3,
      cooldown: {
        scaleUp: 240000, // 4 minutes
        scaleDown: 720000 // 12 minutes
      }
    });
  }

  /**
   * Initialize scaling rules
   */
  initializeScalingRules() {
    // Composite scaling rules that consider multiple metrics
    
    // High load rule
    this.scalingRules.set('high_load', {
      name: 'High Load Scaling',
      condition: (metrics) => 
        metrics.cpu > 70 && metrics.memory > 75 && metrics.request_rate > 800,
      action: 'scale_up_aggressive',
      priority: 'high',
      factor: 2.0
    });
    
    // Emergency scaling rule
    this.scalingRules.set('emergency', {
      name: 'Emergency Scaling',
      condition: (metrics) => 
        metrics.cpu > 90 || metrics.memory > 95 || metrics.response_time > 2000,
      action: 'emergency_scale_up',
      priority: 'critical',
      factor: 3.0
    });
    
    // Cost optimization rule
    this.scalingRules.set('cost_optimization', {
      name: 'Cost Optimization Scaling',
      condition: (metrics) => 
        metrics.cpu < 30 && metrics.memory < 40 && metrics.request_rate < 200,
      action: 'scale_down_gradual',
      priority: 'low',
      factor: 0.7
    });
    
    // Predictive scaling rule
    this.scalingRules.set('predictive', {
      name: 'Predictive Scaling',
      condition: (metrics, forecast) => 
        forecast && forecast.predicted > metrics.current * 1.5,
      action: 'preemptive_scale_up',
      priority: 'medium',
      factor: 1.3
    });
  }

  /**
   * Start auto-scaling engine
   */
  async start() {
    if (this.isRunning || !this.options.enabled) return;
    
    try {
      await this.logger.info('Starting Auto-Scaling Engine');
      
      this.isRunning = true;
      
      // Initialize current instance counts
      await this.initializeInstanceCounts();
      
      // Start evaluation cycle
      this.evaluationTimer = setInterval(async () => {
        try {
          await this.evaluateScaling();
        } catch (error) {
          await this.logger.error('Scaling evaluation failed', { error });
        }
      }, this.options.evaluationInterval);
      
      await this.logger.info('Auto-Scaling Engine started successfully');
      
    } catch (error) {
      await this.logger.error('Failed to start Auto-Scaling Engine', { error });
      throw error;
    }
  }

  /**
   * Stop auto-scaling engine
   */
  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    
    await this.logger.info('Auto-Scaling Engine stopped');
  }

  /**
   * Initialize current instance counts
   */
  async initializeInstanceCounts() {
    // In a real implementation, this would query actual infrastructure
    // For now, initialize with default values
    
    for (const [resourceType] of this.scalingPolicies.entries()) {
      this.currentInstances.set(resourceType, 1);
    }
  }

  /**
   * Evaluate scaling decisions
   */
  async evaluateScaling() {
    if (!this.isRunning) return;
    
    const startTime = Date.now();
    
    try {
      // Get current performance metrics
      const performanceReport = this.performanceMonitor.getPerformanceReport();
      const metrics = this.extractScalingMetrics(performanceReport);
      
      await this.logger.logStructured('debug', 'Evaluating scaling decisions', {
        component: 'ScalingEvaluation',
        metrics
      });
      
      // Check composite scaling rules first
      const ruleDecisions = await this.evaluateScalingRules(metrics);
      
      // Check individual policy decisions
      const policyDecisions = await this.evaluatePolicyDecisions(metrics);
      
      // Combine and prioritize decisions
      const scalingDecisions = this.prioritizeScalingDecisions([...ruleDecisions, ...policyDecisions]);
      
      // Execute scaling decisions
      const executedScalings = await this.executeScalingDecisions(scalingDecisions);
      
      // Predictive scaling if enabled
      if (this.options.predictiveScalingEnabled) {
        await this.evaluatePredictiveScaling(metrics);
      }
      
      const duration = Date.now() - startTime;
      
      if (executedScalings.length > 0) {
        await this.logger.logStructured('info', 'Scaling evaluation completed', {
          component: 'ScalingEvaluation',
          duration,
          decisions: scalingDecisions.length,
          executed: executedScalings.length
        });
      }
      
    } catch (error) {
      await this.logger.error('Scaling evaluation failed', { error });
    }
  }

  /**
   * Extract scaling-relevant metrics
   */
  extractScalingMetrics(performanceReport) {
    const currentMetrics = performanceReport.currentMetrics || {};
    const resourceUsage = performanceReport.resourceUsage || {};
    
    return {
      cpu: currentMetrics.cpu?.percentage || resourceUsage.cpu?.current || 0,
      memory: currentMetrics.memory?.heapUsagePercent || resourceUsage.memory?.current || 0,
      request_rate: this.calculateRequestRate(performanceReport),
      response_time: this.calculateAverageResponseTime(performanceReport),
      error_rate: this.calculateErrorRate(performanceReport),
      active_operations: performanceReport.activeOperations || 0,
      timestamp: Date.now()
    };
  }

  /**
   * Calculate request rate from performance report
   */
  calculateRequestRate(performanceReport) {
    // Extract request rate from operation stats
    const operationStats = performanceReport.operationStats || {};
    const totalRequests = Object.values(operationStats).reduce((sum, stats) => sum + (stats.count || 0), 0);
    
    // Convert to requests per minute (rough approximation)
    return totalRequests * 6; // Assuming 10-second collection interval
  }

  /**
   * Calculate average response time
   */
  calculateAverageResponseTime(performanceReport) {
    const operationStats = performanceReport.operationStats || {};
    const avgTimes = Object.values(operationStats).map(stats => stats.avgDuration || 0);
    
    return avgTimes.length > 0 ? avgTimes.reduce((sum, time) => sum + time, 0) / avgTimes.length : 0;
  }

  /**
   * Calculate error rate
   */
  calculateErrorRate(performanceReport) {
    const operationStats = performanceReport.operationStats || {};
    const errorRates = Object.values(operationStats).map(stats => stats.errorRate || 0);
    
    return errorRates.length > 0 ? errorRates.reduce((sum, rate) => sum + rate, 0) / errorRates.length : 0;
  }

  /**
   * Evaluate scaling rules
   */
  async evaluateScalingRules(metrics) {
    const decisions = [];
    
    for (const [ruleId, rule] of this.scalingRules.entries()) {
      try {
        // Get forecast for predictive rules
        const forecast = this.options.predictiveScalingEnabled ? 
          await this.getForecast(metrics) : null;
        
        if (rule.condition(metrics, forecast)) {
          decisions.push({
            type: 'rule',
            ruleId,
            ruleName: rule.name,
            action: rule.action,
            priority: rule.priority,
            factor: rule.factor,
            reason: `Rule triggered: ${rule.name}`,
            metrics: { ...metrics }
          });
        }
      } catch (error) {
        await this.logger.error(`Scaling rule evaluation failed: ${ruleId}`, { error });
      }
    }
    
    return decisions;
  }

  /**
   * Evaluate policy-based decisions
   */
  async evaluatePolicyDecisions(metrics) {
    const decisions = [];
    
    for (const [resourceType, policy] of this.scalingPolicies.entries()) {
      if (!policy.enabled) continue;
      
      try {
        const metricValue = metrics[resourceType];
        if (metricValue === undefined) continue;
        
        const decision = this.evaluateResourcePolicy(resourceType, metricValue, policy, metrics);
        if (decision) {
          decisions.push(decision);
        }
      } catch (error) {
        await this.logger.error(`Policy evaluation failed: ${resourceType}`, { error });
      }
    }
    
    return decisions;
  }

  /**
   * Evaluate individual resource policy
   */
  evaluateResourcePolicy(resourceType, metricValue, policy, allMetrics) {
    const currentInstances = this.currentInstances.get(resourceType) || 1;
    
    // Check scale up conditions
    if (metricValue > policy.scaleUpThreshold) {
      if (this.canScaleUp(resourceType, policy)) {
        return {
          type: 'policy',
          resourceType,
          action: 'scale_up',
          priority: this.getScalingPriority(metricValue, policy.scaleUpThreshold),
          factor: policy.scaleUpFactor,
          currentInstances,
          targetInstances: Math.min(
            Math.ceil(currentInstances * policy.scaleUpFactor),
            policy.maxInstances
          ),
          reason: `${resourceType} at ${metricValue.toFixed(1)} > threshold ${policy.scaleUpThreshold}`,
          metrics: allMetrics
        };
      }
    }
    
    // Check scale down conditions
    if (metricValue < policy.scaleDownThreshold) {
      if (this.canScaleDown(resourceType, policy)) {
        return {
          type: 'policy',
          resourceType,
          action: 'scale_down',
          priority: 'low',
          factor: policy.scaleDownFactor,
          currentInstances,
          targetInstances: Math.max(
            Math.floor(currentInstances * policy.scaleDownFactor),
            policy.minInstances
          ),
          reason: `${resourceType} at ${metricValue.toFixed(1)} < threshold ${policy.scaleDownThreshold}`,
          metrics: allMetrics
        };
      }
    }
    
    return null;
  }

  /**
   * Get scaling priority based on severity
   */
  getScalingPriority(value, threshold) {
    const ratio = value / threshold;
    
    if (ratio > 1.5) return 'critical';
    if (ratio > 1.3) return 'high';
    if (ratio > 1.1) return 'medium';
    return 'low';
  }

  /**
   * Check if scaling up is allowed
   */
  canScaleUp(resourceType, policy) {
    const currentInstances = this.currentInstances.get(resourceType) || 1;
    
    // Check instance limits
    if (currentInstances >= policy.maxInstances) return false;
    
    // Check cooldown
    if (!this.isCooldownExpired(resourceType, 'scale_up', policy.cooldown.scaleUp)) return false;
    
    // Check scaling rate limits
    if (!this.isWithinScalingLimits(resourceType, 'scale_up')) return false;
    
    // Check circuit breaker
    if (this.scalingBlocked.get(`${resourceType}_scale_up`)) return false;
    
    return true;
  }

  /**
   * Check if scaling down is allowed
   */
  canScaleDown(resourceType, policy) {
    const currentInstances = this.currentInstances.get(resourceType) || 1;
    
    // Check instance limits
    if (currentInstances <= policy.minInstances) return false;
    
    // Check cooldown
    if (!this.isCooldownExpired(resourceType, 'scale_down', policy.cooldown.scaleDown)) return false;
    
    // Check scaling rate limits
    if (!this.isWithinScalingLimits(resourceType, 'scale_down')) return false;
    
    // Don't scale down during high load
    const lastScaleUp = this.getLastScaleEvent(resourceType, 'scale_up');
    if (lastScaleUp && (Date.now() - lastScaleUp) < 900000) return false; // 15 minutes
    
    return true;
  }

  /**
   * Check if cooldown period has expired
   */
  isCooldownExpired(resourceType, action, cooldownMs) {
    const lastEvent = this.getLastScaleEvent(resourceType, action);
    return !lastEvent || (Date.now() - lastEvent) >= cooldownMs;
  }

  /**
   * Check scaling rate limits
   */
  isWithinScalingLimits(resourceType, action) {
    const now = Date.now();
    const oneHourAgo = now - 3600000;
    
    const recentEvents = this.scalingHistory.filter(event => 
      event.resourceType === resourceType &&
      event.action === action &&
      event.timestamp > oneHourAgo
    );
    
    const maxEvents = action === 'scale_up' ? 
      this.options.maxScaleUpEvents : 
      this.options.maxScaleDownEvents;
    
    return recentEvents.length < maxEvents;
  }

  /**
   * Get last scaling event timestamp
   */
  getLastScaleEvent(resourceType, action) {
    const key = `${resourceType}_${action}`;
    return this.lastScaleEvent.get(key);
  }

  /**
   * Prioritize scaling decisions
   */
  prioritizeScalingDecisions(decisions) {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    
    return decisions.sort((a, b) => {
      // First sort by priority
      const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      
      // Then by type (rules take precedence over policies)
      if (a.type === 'rule' && b.type === 'policy') return -1;
      if (a.type === 'policy' && b.type === 'rule') return 1;
      
      return 0;
    });
  }

  /**
   * Execute scaling decisions
   */
  async executeScalingDecisions(decisions) {
    const executed = [];
    
    for (const decision of decisions) {
      try {
        const result = await this.executeScalingDecision(decision);
        if (result.success) {
          executed.push(result);
        }
      } catch (error) {
        await this.logger.error('Scaling execution failed', { error, decision });
      }
    }
    
    return executed;
  }

  /**
   * Execute individual scaling decision
   */
  async executeScalingDecision(decision) {
    const scalingId = `scaling_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await this.logger.logStructured('info', 'Executing scaling decision', {
      component: 'ScalingExecution',
      scalingId,
      decision
    });
    
    try {
      // Simulate scaling execution (in real implementation, this would call infrastructure APIs)
      const result = await this.simulateScalingExecution(decision);
      
      if (result.success) {
        // Update instance count
        if (decision.targetInstances !== undefined) {
          this.currentInstances.set(decision.resourceType, decision.targetInstances);
        }
        
        // Record scaling event
        this.recordScalingEvent(decision, result, scalingId);
        
        // Update last scaling time
        const key = `${decision.resourceType || 'composite'}_${decision.action}`;
        this.lastScaleEvent.set(key, Date.now());
        
        this.emit('scaling-executed', {
          scalingId,
          decision,
          result
        });
      }
      
      return { ...result, scalingId };
      
    } catch (error) {
      await this.logger.error('Scaling execution failed', { error, scalingId, decision });
      return {
        success: false,
        error: error.message,
        scalingId
      };
    }
  }

  /**
   * Simulate scaling execution
   */
  async simulateScalingExecution(decision) {
    // Simulate processing time
    const processingTime = 100 + Math.random() * 500;
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // Simulate occasional failures
    const failureRate = 0.05; // 5% failure rate
    if (Math.random() < failureRate) {
      throw new Error('Simulated scaling failure');
    }
    
    return {
      success: true,
      action: decision.action,
      resourceType: decision.resourceType,
      previousInstances: decision.currentInstances,
      newInstances: decision.targetInstances,
      factor: decision.factor,
      processingTime: Math.round(processingTime)
    };
  }

  /**
   * Record scaling event
   */
  recordScalingEvent(decision, result, scalingId) {
    const event = {
      scalingId,
      timestamp: Date.now(),
      type: decision.type,
      resourceType: decision.resourceType,
      action: decision.action,
      priority: decision.priority,
      reason: decision.reason,
      metrics: decision.metrics,
      result,
      success: result.success
    };
    
    this.scalingHistory.push(event);
    
    // Keep only recent history
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days
    this.scalingHistory = this.scalingHistory.filter(e => e.timestamp > cutoff);
  }

  /**
   * Evaluate predictive scaling
   */
  async evaluatePredictiveScaling(metrics) {
    try {
      const forecast = await this.getForecast(metrics);
      
      if (forecast && forecast.confidence > 0.7) {
        // Check if predicted load requires preemptive scaling
        for (const [resourceType, policy] of this.scalingPolicies.entries()) {
          const currentValue = metrics[resourceType];
          const predictedValue = forecast.metrics?.[resourceType];
          
          if (predictedValue && predictedValue > policy.scaleUpThreshold) {
            const timeToPeak = forecast.timeToPeak || 3600000; // 1 hour default
            
            if (timeToPeak < 1800000 && this.canScaleUp(resourceType, policy)) { // 30 minutes
              await this.executeScalingDecision({
                type: 'predictive',
                resourceType,
                action: 'preemptive_scale_up',
                priority: 'medium',
                factor: 1.2,
                currentInstances: this.currentInstances.get(resourceType),
                targetInstances: Math.ceil((this.currentInstances.get(resourceType) || 1) * 1.2),
                reason: `Predictive scaling: ${resourceType} predicted to reach ${predictedValue.toFixed(1)}`,
                metrics
              });
            }
          }
        }
      }
    } catch (error) {
      await this.logger.error('Predictive scaling evaluation failed', { error });
    }
  }

  /**
   * Get forecast from capacity planner
   */
  async getForecast(metrics) {
    try {
      // This would integrate with the capacity planner
      // For now, return a simple prediction based on current trends
      
      return {
        confidence: 0.8,
        timeToPeak: 1800000, // 30 minutes
        metrics: {
          cpu: metrics.cpu * 1.2,
          memory: metrics.memory * 1.1,
          request_rate: metrics.request_rate * 1.5
        }
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Get auto-scaling status
   */
  getScalingStatus() {
    const recentEvents = this.scalingHistory.slice(-10);
    
    return {
      isRunning: this.isRunning,
      enabled: this.options.enabled,
      currentInstances: Object.fromEntries(this.currentInstances),
      activePolicies: Array.from(this.scalingPolicies.entries())
        .filter(([, policy]) => policy.enabled)
        .map(([id, policy]) => ({ id, ...policy })),
      recentScalingEvents: recentEvents,
      scalingBlockedResources: Array.from(this.scalingBlocked.entries()),
      statistics: this.getScalingStatistics()
    };
  }

  /**
   * Get scaling statistics
   */
  getScalingStatistics() {
    const total = this.scalingHistory.length;
    const successful = this.scalingHistory.filter(e => e.success).length;
    const scaleUps = this.scalingHistory.filter(e => e.action.includes('scale_up')).length;
    const scaleDowns = this.scalingHistory.filter(e => e.action.includes('scale_down')).length;
    
    return {
      totalEvents: total,
      successfulEvents: successful,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      scaleUpEvents: scaleUps,
      scaleDownEvents: scaleDowns,
      averageInstanceCount: this.calculateAverageInstanceCount()
    };
  }

  /**
   * Calculate average instance count
   */
  calculateAverageInstanceCount() {
    const counts = Array.from(this.currentInstances.values());
    return counts.length > 0 ? counts.reduce((sum, count) => sum + count, 0) / counts.length : 0;
  }

  /**
   * Update scaling policy
   */
  updateScalingPolicy(resourceType, updates) {
    const policy = this.scalingPolicies.get(resourceType);
    if (policy) {
      Object.assign(policy, updates);
      return policy;
    }
    return null;
  }

  /**
   * Enable/disable auto-scaling
   */
  setEnabled(enabled) {
    this.options.enabled = enabled;
    
    if (enabled && !this.isRunning) {
      this.start();
    } else if (!enabled && this.isRunning) {
      this.stop();
    }
  }

  /**
   * Block scaling for a resource (circuit breaker)
   */
  blockScaling(resourceType, action, duration = 300000) {
    const key = `${resourceType}_${action}`;
    this.scalingBlocked.set(key, true);
    
    setTimeout(() => {
      this.scalingBlocked.delete(key);
    }, duration);
  }
}

module.exports = AutoScaler;