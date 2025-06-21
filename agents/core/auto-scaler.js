const os = require('os');
const { EventEmitter } = require('events');

class AutoScaler extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      minAgents: config.minAgents || 1,
      maxAgents: config.maxAgents || 10,
      scaleUpThreshold: config.scaleUpThreshold || 0.8,
      scaleDownThreshold: config.scaleDownThreshold || 0.3,
      scaleUpIncrement: config.scaleUpIncrement || 2,
      scaleDownIncrement: config.scaleDownIncrement || 1,
      cooldownPeriod: config.cooldownPeriod || 60000,
      evaluationInterval: config.evaluationInterval || 30000,
      memoryThreshold: config.memoryThreshold || 0.85,
      cpuWindowSize: config.cpuWindowSize || 5,
      ...config
    };
    
    this.currentAgents = this.config.minAgents;
    this.lastScaleAction = null;
    this.cpuHistory = [];
    this.metricsCollector = null;
    this.evaluationTimer = null;
    this.isRunning = false;
    
    this.scalingHistory = [];
    this.maxHistorySize = 100;
  }
  
  setMetricsCollector(metricsCollector) {
    this.metricsCollector = metricsCollector;
  }
  
  start() {
    if (this.isRunning) {
      this.logger.warn('AutoScaler is already running');
      return;
    }
    
    this.isRunning = true;
    this.logger.info('Starting AutoScaler', {
      config: this.config,
      currentAgents: this.currentAgents
    });
    
    this.evaluationTimer = setInterval(() => {
      this.evaluate().catch(err => {
        this.logger.error('Error during auto-scaling evaluation', err);
      });
    }, this.config.evaluationInterval);
    
    this.evaluate();
  }
  
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    
    this.logger.info('AutoScaler stopped');
  }
  
  async evaluate() {
    if (!this.metricsCollector) {
      this.logger.warn('MetricsCollector not set, skipping evaluation');
      return;
    }
    
    try {
      const metrics = await this.metricsCollector.getAggregatedMetrics();
      const decision = this.makeScalingDecision(metrics);
      
      if (decision.action !== 'none') {
        await this.executeScalingAction(decision);
      }
    } catch (error) {
      this.logger.error('Error evaluating scaling needs', error);
    }
  }
  
  makeScalingDecision(metrics) {
    if (!this.canScale()) {
      return { action: 'none', reason: 'cooldown period active' };
    }
    
    const cpuUtilization = this.calculateAverageCPU(metrics.cpu);
    const memoryUtilization = metrics.memory.percentage / 100;
    const queueSize = metrics.taskQueue.size;
    const activeAgents = metrics.agents.active;
    const pendingTasks = metrics.taskQueue.pending;
    
    this.cpuHistory.push(cpuUtilization);
    if (this.cpuHistory.length > this.config.cpuWindowSize) {
      this.cpuHistory.shift();
    }
    
    const avgCPU = this.cpuHistory.reduce((a, b) => a + b, 0) / this.cpuHistory.length;
    
    const loadFactor = this.calculateLoadFactor(avgCPU, memoryUtilization, queueSize, activeAgents);
    
    this.logger.debug('Scaling evaluation', {
      cpuUtilization: avgCPU,
      memoryUtilization,
      queueSize,
      activeAgents,
      pendingTasks,
      loadFactor,
      currentAgents: this.currentAgents
    });
    
    if (memoryUtilization > this.config.memoryThreshold) {
      return {
        action: 'none',
        reason: 'memory threshold exceeded, scaling restricted'
      };
    }
    
    if (loadFactor > this.config.scaleUpThreshold && this.currentAgents < this.config.maxAgents) {
      const increment = Math.min(
        this.config.scaleUpIncrement,
        this.config.maxAgents - this.currentAgents
      );
      return {
        action: 'scale-up',
        increment,
        reason: `high load factor: ${loadFactor.toFixed(2)}`,
        metrics: { cpuUtilization: avgCPU, memoryUtilization, queueSize }
      };
    }
    
    if (loadFactor < this.config.scaleDownThreshold && this.currentAgents > this.config.minAgents) {
      const decrement = Math.min(
        this.config.scaleDownIncrement,
        this.currentAgents - this.config.minAgents
      );
      return {
        action: 'scale-down',
        increment: decrement,
        reason: `low load factor: ${loadFactor.toFixed(2)}`,
        metrics: { cpuUtilization: avgCPU, memoryUtilization, queueSize }
      };
    }
    
    return {
      action: 'none',
      reason: `load factor within normal range: ${loadFactor.toFixed(2)}`
    };
  }
  
  calculateLoadFactor(cpu, memory, queueSize, activeAgents) {
    const cpuWeight = 0.4;
    const memoryWeight = 0.3;
    const queueWeight = 0.3;
    
    const queuePressure = Math.min(queueSize / (activeAgents * 10), 1);
    
    return (cpu * cpuWeight) + (memory * memoryWeight) + (queuePressure * queueWeight);
  }
  
  calculateAverageCPU(cpuMetrics) {
    if (!cpuMetrics || !cpuMetrics.cores || cpuMetrics.cores.length === 0) {
      return 0;
    }
    
    const totalUsage = cpuMetrics.cores.reduce((sum, core) => sum + core, 0);
    return totalUsage / cpuMetrics.cores.length / 100;
  }
  
  canScale() {
    if (!this.lastScaleAction) {
      return true;
    }
    
    const timeSinceLastScale = Date.now() - this.lastScaleAction;
    return timeSinceLastScale >= this.config.cooldownPeriod;
  }
  
  async executeScalingAction(decision) {
    this.lastScaleAction = Date.now();
    
    const scalingEvent = {
      timestamp: new Date().toISOString(),
      action: decision.action,
      increment: decision.increment,
      reason: decision.reason,
      beforeAgents: this.currentAgents,
      afterAgents: this.currentAgents,
      metrics: decision.metrics
    };
    
    try {
      if (decision.action === 'scale-up') {
        this.currentAgents += decision.increment;
        scalingEvent.afterAgents = this.currentAgents;
        
        this.logger.info('Scaling up agents', {
          increment: decision.increment,
          newTotal: this.currentAgents,
          reason: decision.reason
        });
        
        this.emit('scale-up', {
          increment: decision.increment,
          total: this.currentAgents,
          reason: decision.reason
        });
      } else if (decision.action === 'scale-down') {
        this.currentAgents -= decision.increment;
        scalingEvent.afterAgents = this.currentAgents;
        
        this.logger.info('Scaling down agents', {
          decrement: decision.increment,
          newTotal: this.currentAgents,
          reason: decision.reason
        });
        
        this.emit('scale-down', {
          decrement: decision.increment,
          total: this.currentAgents,
          reason: decision.reason
        });
      }
      
      this.addToHistory(scalingEvent);
      
    } catch (error) {
      this.logger.error('Error executing scaling action', error);
      this.currentAgents = scalingEvent.beforeAgents;
      throw error;
    }
  }
  
  addToHistory(event) {
    this.scalingHistory.push(event);
    if (this.scalingHistory.length > this.maxHistorySize) {
      this.scalingHistory.shift();
    }
  }
  
  getScalingHistory(limit = 50) {
    return this.scalingHistory.slice(-limit);
  }
  
  getCurrentScale() {
    return {
      currentAgents: this.currentAgents,
      minAgents: this.config.minAgents,
      maxAgents: this.config.maxAgents,
      lastScaleAction: this.lastScaleAction,
      isInCooldown: !this.canScale()
    };
  }
  
  updateConfig(newConfig) {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...newConfig };
    
    if (this.config.minAgents > this.currentAgents) {
      this.currentAgents = this.config.minAgents;
      this.emit('scale-up', {
        increment: this.currentAgents - oldConfig.minAgents,
        total: this.currentAgents,
        reason: 'minimum agents configuration changed'
      });
    } else if (this.config.maxAgents < this.currentAgents) {
      const decrement = this.currentAgents - this.config.maxAgents;
      this.currentAgents = this.config.maxAgents;
      this.emit('scale-down', {
        decrement,
        total: this.currentAgents,
        reason: 'maximum agents configuration changed'
      });
    }
    
    this.logger.info('AutoScaler configuration updated', {
      oldConfig,
      newConfig: this.config
    });
  }
  
  async forceScale(targetAgents) {
    if (targetAgents < this.config.minAgents || targetAgents > this.config.maxAgents) {
      throw new Error(`Target agents (${targetAgents}) out of range [${this.config.minAgents}, ${this.config.maxAgents}]`);
    }
    
    const difference = targetAgents - this.currentAgents;
    if (difference === 0) {
      this.logger.info('Force scale: already at target', { targetAgents });
      return;
    }
    
    this.lastScaleAction = Date.now();
    const oldAgents = this.currentAgents;
    this.currentAgents = targetAgents;
    
    const scalingEvent = {
      timestamp: new Date().toISOString(),
      action: difference > 0 ? 'scale-up' : 'scale-down',
      increment: Math.abs(difference),
      reason: 'forced scaling',
      beforeAgents: oldAgents,
      afterAgents: this.currentAgents,
      forced: true
    };
    
    this.addToHistory(scalingEvent);
    
    if (difference > 0) {
      this.emit('scale-up', {
        increment: difference,
        total: this.currentAgents,
        reason: 'forced scaling',
        forced: true
      });
    } else {
      this.emit('scale-down', {
        decrement: Math.abs(difference),
        total: this.currentAgents,
        reason: 'forced scaling',
        forced: true
      });
    }
    
    this.logger.info('Forced scaling completed', {
      oldAgents,
      newAgents: this.currentAgents,
      difference
    });
  }
}

module.exports = AutoScaler;