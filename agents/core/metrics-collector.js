const os = require('os');
const { EventEmitter } = require('events');

class MetricsCollector extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      collectionInterval: config.collectionInterval || 10000,
      historySize: config.historySize || 60,
      aggregationWindow: config.aggregationWindow || 5,
      ...config
    };
    
    this.metrics = {
      cpu: [],
      memory: [],
      taskQueue: [],
      agents: [],
      errors: [],
      performance: []
    };
    
    this.agentMetrics = new Map();
    this.collectionTimer = null;
    this.isRunning = false;
    this.startTime = Date.now();
  }
  
  start() {
    if (this.isRunning) {
      this.logger.warn('MetricsCollector is already running');
      return;
    }
    
    this.isRunning = true;
    this.startTime = Date.now();
    this.logger.info('Starting MetricsCollector', { config: this.config });
    
    this.collect();
    
    this.collectionTimer = setInterval(() => {
      this.collect();
    }, this.config.collectionInterval);
  }
  
  stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.isRunning = false;
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }
    
    this.logger.info('MetricsCollector stopped');
  }
  
  collect() {
    try {
      const timestamp = Date.now();
      
      const cpuMetrics = this.collectCPUMetrics();
      const memoryMetrics = this.collectMemoryMetrics();
      
      this.addMetric('cpu', { timestamp, ...cpuMetrics });
      this.addMetric('memory', { timestamp, ...memoryMetrics });
      
      this.emit('metrics-collected', {
        timestamp,
        cpu: cpuMetrics,
        memory: memoryMetrics
      });
      
    } catch (error) {
      this.logger.error('Error collecting metrics', error);
    }
  }
  
  collectCPUMetrics() {
    const cpus = os.cpus();
    const cores = [];
    
    cpus.forEach((cpu, index) => {
      const total = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const idle = cpu.times.idle;
      const usage = ((total - idle) / total) * 100;
      cores.push(usage);
    });
    
    const avgUsage = cores.reduce((a, b) => a + b, 0) / cores.length;
    
    return {
      cores,
      average: avgUsage,
      count: cpus.length,
      loadAvg: os.loadavg()
    };
  }
  
  collectMemoryMetrics() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const percentage = (usedMem / totalMem) * 100;
    
    const processMemory = process.memoryUsage();
    
    return {
      total: totalMem,
      free: freeMem,
      used: usedMem,
      percentage,
      process: {
        rss: processMemory.rss,
        heapTotal: processMemory.heapTotal,
        heapUsed: processMemory.heapUsed,
        external: processMemory.external
      }
    };
  }
  
  updateTaskQueueMetrics(metrics) {
    const timestamp = Date.now();
    this.addMetric('taskQueue', {
      timestamp,
      size: metrics.size || 0,
      pending: metrics.pending || 0,
      processing: metrics.processing || 0,
      completed: metrics.completed || 0,
      failed: metrics.failed || 0,
      avgProcessingTime: metrics.avgProcessingTime || 0
    });
  }
  
  updateAgentMetrics(agentId, metrics) {
    const timestamp = Date.now();
    const agentMetric = {
      timestamp,
      agentId,
      status: metrics.status || 'unknown',
      tasksProcessed: metrics.tasksProcessed || 0,
      errors: metrics.errors || 0,
      uptime: metrics.uptime || 0,
      lastActivity: metrics.lastActivity || timestamp,
      cpu: metrics.cpu || 0,
      memory: metrics.memory || 0
    };
    
    this.agentMetrics.set(agentId, agentMetric);
    
    const allAgentMetrics = Array.from(this.agentMetrics.values());
    const activeAgents = allAgentMetrics.filter(a => a.status === 'active').length;
    const totalAgents = allAgentMetrics.length;
    
    this.addMetric('agents', {
      timestamp,
      total: totalAgents,
      active: activeAgents,
      idle: totalAgents - activeAgents,
      agents: allAgentMetrics
    });
  }
  
  recordError(error, context = {}) {
    const timestamp = Date.now();
    this.addMetric('errors', {
      timestamp,
      message: error.message,
      stack: error.stack,
      type: error.constructor.name,
      context,
      severity: context.severity || 'error'
    });
  }
  
  recordPerformance(operation, duration, metadata = {}) {
    const timestamp = Date.now();
    this.addMetric('performance', {
      timestamp,
      operation,
      duration,
      success: metadata.success !== false,
      metadata
    });
  }
  
  addMetric(type, metric) {
    if (!this.metrics[type]) {
      this.metrics[type] = [];
    }
    
    this.metrics[type].push(metric);
    
    if (this.metrics[type].length > this.config.historySize) {
      this.metrics[type].shift();
    }
  }
  
  async getAggregatedMetrics() {
    const now = Date.now();
    const windowStart = now - (this.config.aggregationWindow * 60 * 1000);
    
    const result = {
      timestamp: now,
      window: {
        start: windowStart,
        end: now,
        duration: this.config.aggregationWindow * 60 * 1000
      },
      cpu: this.aggregateCPUMetrics(windowStart),
      memory: this.aggregateMemoryMetrics(windowStart),
      taskQueue: this.aggregateTaskQueueMetrics(windowStart),
      agents: this.aggregateAgentMetrics(windowStart),
      errors: this.aggregateErrorMetrics(windowStart),
      performance: this.aggregatePerformanceMetrics(windowStart)
    };
    
    return result;
  }
  
  aggregateCPUMetrics(windowStart) {
    const recentMetrics = this.metrics.cpu.filter(m => m.timestamp >= windowStart);
    
    if (recentMetrics.length === 0) {
      return { average: 0, cores: [], loadAvg: [0, 0, 0] };
    }
    
    const avgCPU = recentMetrics.reduce((sum, m) => sum + m.average, 0) / recentMetrics.length;
    const latest = recentMetrics[recentMetrics.length - 1];
    
    return {
      average: avgCPU,
      cores: latest.cores,
      loadAvg: latest.loadAvg,
      samples: recentMetrics.length
    };
  }
  
  aggregateMemoryMetrics(windowStart) {
    const recentMetrics = this.metrics.memory.filter(m => m.timestamp >= windowStart);
    
    if (recentMetrics.length === 0) {
      return { percentage: 0, used: 0, free: 0, total: 0 };
    }
    
    const latest = recentMetrics[recentMetrics.length - 1];
    const avgPercentage = recentMetrics.reduce((sum, m) => sum + m.percentage, 0) / recentMetrics.length;
    
    return {
      percentage: avgPercentage,
      used: latest.used,
      free: latest.free,
      total: latest.total,
      process: latest.process,
      samples: recentMetrics.length
    };
  }
  
  aggregateTaskQueueMetrics(windowStart) {
    const recentMetrics = this.metrics.taskQueue.filter(m => m.timestamp >= windowStart);
    
    if (recentMetrics.length === 0) {
      return { size: 0, pending: 0, processing: 0, completed: 0, failed: 0 };
    }
    
    const latest = recentMetrics[recentMetrics.length - 1];
    const avgSize = recentMetrics.reduce((sum, m) => sum + m.size, 0) / recentMetrics.length;
    const totalCompleted = recentMetrics.reduce((sum, m) => sum + (m.completed || 0), 0);
    const totalFailed = recentMetrics.reduce((sum, m) => sum + (m.failed || 0), 0);
    
    return {
      size: latest.size,
      pending: latest.pending,
      processing: latest.processing,
      completed: totalCompleted,
      failed: totalFailed,
      avgSize,
      avgProcessingTime: latest.avgProcessingTime || 0,
      samples: recentMetrics.length
    };
  }
  
  aggregateAgentMetrics(windowStart) {
    const recentMetrics = this.metrics.agents.filter(m => m.timestamp >= windowStart);
    
    if (recentMetrics.length === 0) {
      return { total: 0, active: 0, idle: 0, agents: [] };
    }
    
    const latest = recentMetrics[recentMetrics.length - 1];
    return latest;
  }
  
  aggregateErrorMetrics(windowStart) {
    const recentErrors = this.metrics.errors.filter(m => m.timestamp >= windowStart);
    
    const errorsByType = {};
    const errorsBySeverity = {};
    
    recentErrors.forEach(error => {
      errorsByType[error.type] = (errorsByType[error.type] || 0) + 1;
      errorsBySeverity[error.severity] = (errorsBySeverity[error.severity] || 0) + 1;
    });
    
    return {
      total: recentErrors.length,
      byType: errorsByType,
      bySeverity: errorsBySeverity,
      recent: recentErrors.slice(-10)
    };
  }
  
  aggregatePerformanceMetrics(windowStart) {
    const recentMetrics = this.metrics.performance.filter(m => m.timestamp >= windowStart);
    
    const operationStats = {};
    
    recentMetrics.forEach(metric => {
      if (!operationStats[metric.operation]) {
        operationStats[metric.operation] = {
          count: 0,
          totalDuration: 0,
          minDuration: Infinity,
          maxDuration: 0,
          failures: 0
        };
      }
      
      const stats = operationStats[metric.operation];
      stats.count++;
      stats.totalDuration += metric.duration;
      stats.minDuration = Math.min(stats.minDuration, metric.duration);
      stats.maxDuration = Math.max(stats.maxDuration, metric.duration);
      if (!metric.success) {
        stats.failures++;
      }
    });
    
    Object.keys(operationStats).forEach(op => {
      const stats = operationStats[op];
      stats.avgDuration = stats.totalDuration / stats.count;
      stats.successRate = ((stats.count - stats.failures) / stats.count) * 100;
    });
    
    return {
      operations: operationStats,
      totalOperations: recentMetrics.length
    };
  }
  
  getMetricsSummary() {
    const uptime = Date.now() - this.startTime;
    const totalErrors = this.metrics.errors.length;
    const totalOperations = this.metrics.performance.length;
    
    return {
      uptime,
      totalErrors,
      totalOperations,
      metricsCollected: {
        cpu: this.metrics.cpu.length,
        memory: this.metrics.memory.length,
        taskQueue: this.metrics.taskQueue.length,
        agents: this.metrics.agents.length,
        errors: this.metrics.errors.length,
        performance: this.metrics.performance.length
      },
      collectionInterval: this.config.collectionInterval,
      historySize: this.config.historySize
    };
  }
  
  clearMetrics(type = null) {
    if (type && this.metrics[type]) {
      this.metrics[type] = [];
      this.logger.info(`Cleared metrics for type: ${type}`);
    } else if (!type) {
      Object.keys(this.metrics).forEach(key => {
        this.metrics[key] = [];
      });
      this.agentMetrics.clear();
      this.logger.info('Cleared all metrics');
    }
  }
}

module.exports = MetricsCollector;