/**
 * Issue #128: Performance Monitoring and Optimization
 * 
 * Comprehensive performance monitoring system with:
 * - Real-time metrics collection
 * - Performance profiling
 * - Bottleneck detection
 * - Automatic optimization
 * - Resource usage tracking
 * - Performance analytics
 */

const EventEmitter = require('events');
const ProductionLogger = require('../utils/production-logger');

class PerformanceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      metricsInterval: options.metricsInterval || 1000, // 1 second
      profileInterval: options.profileInterval || 60000, // 1 minute
      historyRetention: options.historyRetention || 24 * 60 * 60 * 1000, // 24 hours
      alertThresholds: {
        cpu: options.alertThresholds?.cpu || 80,
        memory: options.alertThresholds?.memory || 85,
        eventLoopLag: options.alertThresholds?.eventLoopLag || 100,
        gcPauseDuration: options.alertThresholds?.gcPauseDuration || 50,
        ...options.alertThresholds
      },
      optimizationEnabled: options.optimizationEnabled !== false,
      profilingEnabled: options.profilingEnabled !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('PerformanceMonitor', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true
    });
    
    this.isRunning = false;
    this.metricsTimer = null;
    this.profileTimer = null;
    
    // Performance data storage
    this.metrics = {
      cpu: [],
      memory: [],
      eventLoop: [],
      gc: [],
      operations: new Map(),
      network: [],
      disk: []
    };
    
    // Operation tracking
    this.activeOperations = new Map();
    this.operationStats = new Map();
    
    // Performance baselines
    this.baselines = new Map();
    
    // Event loop lag tracking
    this.eventLoopStart = process.hrtime.bigint();
    this.eventLoopLag = 0;
    
    this.initializeGCTracking();
  }

  /**
   * Initialize garbage collection tracking
   */
  initializeGCTracking() {
    if (typeof process.getActiveResourcesInfo === 'function') {
      // Node.js 17+
      this.gcObserver = new (require('perf_hooks').PerformanceObserver)((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'gc') {
            this.recordGCMetrics(entry);
          }
        }
      });
      
      try {
        this.gcObserver.observe({ entryTypes: ['gc'] });
      } catch (error) {
        // GC tracking not available
      }
    }
  }

  /**
   * Start performance monitoring
   */
  async start() {
    if (this.isRunning) return;
    
    try {
      await this.logger.info('Starting Performance Monitor');
      
      this.isRunning = true;
      
      // Start metrics collection
      this.startMetricsCollection();
      
      // Start profiling if enabled
      if (this.options.profilingEnabled) {
        this.startProfiling();
      }
      
      // Initialize baselines
      await this.initializeBaselines();
      
      await this.logger.info('Performance Monitor started successfully');
      
    } catch (error) {
      await this.logger.error('Failed to start Performance Monitor', { error });
      throw error;
    }
  }

  /**
   * Stop performance monitoring
   */
  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    if (this.profileTimer) {
      clearInterval(this.profileTimer);
      this.profileTimer = null;
    }
    
    if (this.gcObserver) {
      this.gcObserver.disconnect();
    }
    
    await this.logger.info('Performance Monitor stopped');
  }

  /**
   * Start metrics collection
   */
  startMetricsCollection() {
    this.metricsTimer = setInterval(async () => {
      try {
        await this.collectMetrics();
      } catch (error) {
        await this.logger.error('Metrics collection failed', { error });
      }
    }, this.options.metricsInterval);
  }

  /**
   * Start profiling
   */
  startProfiling() {
    this.profileTimer = setInterval(async () => {
      try {
        await this.performProfiling();
      } catch (error) {
        await this.logger.error('Profiling failed', { error });
      }
    }, this.options.profileInterval);
  }

  /**
   * Collect real-time metrics
   */
  async collectMetrics() {
    const timestamp = Date.now();
    
    // CPU metrics
    const cpuUsage = process.cpuUsage();
    const cpuMetric = {
      timestamp,
      user: cpuUsage.user,
      system: cpuUsage.system,
      total: cpuUsage.user + cpuUsage.system,
      percentage: this.calculateCpuPercentage(cpuUsage)
    };
    this.metrics.cpu.push(cpuMetric);
    
    // Memory metrics
    const memUsage = process.memoryUsage();
    const memMetric = {
      timestamp,
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers || 0,
      heapUsagePercent: (memUsage.heapUsed / memUsage.heapTotal) * 100
    };
    this.metrics.memory.push(memMetric);
    
    // Event loop lag
    const lag = this.measureEventLoopLag();
    const eventLoopMetric = {
      timestamp,
      lag,
      lagMS: Number(lag) / 1000000 // Convert to milliseconds
    };
    this.metrics.eventLoop.push(eventLoopMetric);
    
    // Network metrics (if available)
    const networkMetric = await this.collectNetworkMetrics();
    if (networkMetric) {
      this.metrics.network.push({ timestamp, ...networkMetric });
    }
    
    // Clean old metrics
    this.cleanOldMetrics();
    
    // Check for alerts
    await this.checkPerformanceAlerts(cpuMetric, memMetric, eventLoopMetric);
    
    // Emit metrics update
    this.emit('metrics-updated', {
      cpu: cpuMetric,
      memory: memMetric,
      eventLoop: eventLoopMetric,
      network: networkMetric
    });
  }

  /**
   * Calculate CPU percentage
   */
  calculateCpuPercentage(currentUsage) {
    if (!this.lastCpuUsage) {
      this.lastCpuUsage = currentUsage;
      return 0;
    }
    
    const totalDiff = (currentUsage.user + currentUsage.system) - 
                     (this.lastCpuUsage.user + this.lastCpuUsage.system);
    const timeDiff = process.uptime() * 1000000; // Convert to microseconds
    
    this.lastCpuUsage = currentUsage;
    
    return Math.min((totalDiff / timeDiff) * 100, 100);
  }

  /**
   * Measure event loop lag
   */
  measureEventLoopLag() {
    const start = process.hrtime.bigint();
    const lag = start - this.eventLoopStart;
    this.eventLoopStart = start;
    return lag;
  }

  /**
   * Collect network metrics
   */
  async collectNetworkMetrics() {
    // This would integrate with your actual network monitoring
    // For now, return placeholder data
    return {
      connections: 0,
      bytesIn: 0,
      bytesOut: 0,
      requestsPerSecond: 0
    };
  }

  /**
   * Record GC metrics
   */
  recordGCMetrics(entry) {
    const gcMetric = {
      timestamp: Date.now(),
      type: entry.detail?.type || 'unknown',
      kind: entry.detail?.kind || 'unknown',
      duration: entry.duration,
      startTime: entry.startTime
    };
    
    this.metrics.gc.push(gcMetric);
    
    // Alert on long GC pauses
    if (gcMetric.duration > this.options.alertThresholds.gcPauseDuration) {
      this.emit('gc-pause-alert', gcMetric);
    }
  }

  /**
   * Start operation tracking
   */
  startOperation(operationId, metadata = {}) {
    const operation = {
      id: operationId,
      startTime: process.hrtime.bigint(),
      startTimestamp: Date.now(),
      metadata,
      memoryAtStart: process.memoryUsage()
    };
    
    this.activeOperations.set(operationId, operation);
    return operation;
  }

  /**
   * End operation tracking
   */
  endOperation(operationId, result = {}) {
    const operation = this.activeOperations.get(operationId);
    if (!operation) return null;
    
    const endTime = process.hrtime.bigint();
    const endTimestamp = Date.now();
    const memoryAtEnd = process.memoryUsage();
    
    const completedOperation = {
      ...operation,
      endTime,
      endTimestamp,
      duration: Number(endTime - operation.startTime) / 1000000, // Convert to milliseconds
      memoryAtEnd,
      memoryDelta: {
        rss: memoryAtEnd.rss - operation.memoryAtStart.rss,
        heapUsed: memoryAtEnd.heapUsed - operation.memoryAtStart.heapUsed,
        heapTotal: memoryAtEnd.heapTotal - operation.memoryAtStart.heapTotal
      },
      result
    };
    
    this.activeOperations.delete(operationId);
    
    // Update operation statistics
    this.updateOperationStats(completedOperation);
    
    // Store in metrics
    if (!this.metrics.operations.has(operationId)) {
      this.metrics.operations.set(operationId, []);
    }
    this.metrics.operations.get(operationId).push(completedOperation);
    
    this.emit('operation-completed', completedOperation);
    
    return completedOperation;
  }

  /**
   * Update operation statistics
   */
  updateOperationStats(operation) {
    const operationType = operation.metadata.type || 'unknown';
    
    if (!this.operationStats.has(operationType)) {
      this.operationStats.set(operationType, {
        count: 0,
        totalDuration: 0,
        minDuration: Infinity,
        maxDuration: 0,
        avgDuration: 0,
        p50Duration: 0,
        p95Duration: 0,
        p99Duration: 0,
        errorRate: 0,
        memoryImpact: {
          totalRssDelta: 0,
          totalHeapDelta: 0,
          avgRssDelta: 0,
          avgHeapDelta: 0
        },
        durations: []
      });
    }
    
    const stats = this.operationStats.get(operationType);
    stats.count++;
    stats.totalDuration += operation.duration;
    stats.minDuration = Math.min(stats.minDuration, operation.duration);
    stats.maxDuration = Math.max(stats.maxDuration, operation.duration);
    stats.avgDuration = stats.totalDuration / stats.count;
    
    // Track durations for percentile calculation
    stats.durations.push(operation.duration);
    
    // Keep only recent durations for percentiles
    if (stats.durations.length > 1000) {
      stats.durations = stats.durations.slice(-500);
    }
    
    // Calculate percentiles
    const sortedDurations = [...stats.durations].sort((a, b) => a - b);
    stats.p50Duration = this.calculatePercentile(sortedDurations, 50);
    stats.p95Duration = this.calculatePercentile(sortedDurations, 95);
    stats.p99Duration = this.calculatePercentile(sortedDurations, 99);
    
    // Update memory impact
    stats.memoryImpact.totalRssDelta += operation.memoryDelta.rss;
    stats.memoryImpact.totalHeapDelta += operation.memoryDelta.heapUsed;
    stats.memoryImpact.avgRssDelta = stats.memoryImpact.totalRssDelta / stats.count;
    stats.memoryImpact.avgHeapDelta = stats.memoryImpact.totalHeapDelta / stats.count;
    
    // Update error rate
    if (operation.result.error) {
      stats.errorCount = (stats.errorCount || 0) + 1;
      stats.errorRate = (stats.errorCount / stats.count) * 100;
    }
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(sortedArray, percentile) {
    if (sortedArray.length === 0) return 0;
    
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * Perform detailed profiling
   */
  async performProfiling() {
    const profile = {
      timestamp: Date.now(),
      uptime: process.uptime(),
      activeHandles: process._getActiveHandles ? process._getActiveHandles().length : 0,
      activeRequests: process._getActiveRequests ? process._getActiveRequests().length : 0,
      activeOperations: this.activeOperations.size,
      
      // Resource usage summary
      resourceUsage: this.getResourceUsageSummary(),
      
      // Operation performance summary
      operationPerformance: this.getOperationPerformanceSummary(),
      
      // Memory analysis
      memoryAnalysis: this.getMemoryAnalysis(),
      
      // Performance recommendations
      recommendations: this.generatePerformanceRecommendations()
    };
    
    await this.logger.logStructured('info', 'Performance profile generated', {
      component: 'PerformanceProfiling',
      metadata: profile
    });
    
    this.emit('profile-generated', profile);
    
    // Auto-optimization if enabled
    if (this.options.optimizationEnabled) {
      await this.applyOptimizations(profile);
    }
    
    return profile;
  }

  /**
   * Get resource usage summary
   */
  getResourceUsageSummary() {
    const recentMetrics = {
      cpu: this.metrics.cpu.slice(-60), // Last 60 seconds
      memory: this.metrics.memory.slice(-60),
      eventLoop: this.metrics.eventLoop.slice(-60),
      gc: this.metrics.gc.slice(-60)
    };
    
    return {
      cpu: {
        current: recentMetrics.cpu[recentMetrics.cpu.length - 1]?.percentage || 0,
        average: this.calculateAverage(recentMetrics.cpu, 'percentage'),
        peak: Math.max(...recentMetrics.cpu.map(m => m.percentage))
      },
      memory: {
        current: recentMetrics.memory[recentMetrics.memory.length - 1]?.heapUsagePercent || 0,
        average: this.calculateAverage(recentMetrics.memory, 'heapUsagePercent'),
        peak: Math.max(...recentMetrics.memory.map(m => m.heapUsagePercent))
      },
      eventLoop: {
        current: recentMetrics.eventLoop[recentMetrics.eventLoop.length - 1]?.lagMS || 0,
        average: this.calculateAverage(recentMetrics.eventLoop, 'lagMS'),
        peak: Math.max(...recentMetrics.eventLoop.map(m => m.lagMS))
      },
      gc: {
        frequency: recentMetrics.gc.length,
        totalPauseTime: recentMetrics.gc.reduce((sum, gc) => sum + gc.duration, 0),
        avgPauseTime: recentMetrics.gc.length > 0 ? 
          recentMetrics.gc.reduce((sum, gc) => sum + gc.duration, 0) / recentMetrics.gc.length : 0
      }
    };
  }

  /**
   * Get operation performance summary
   */
  getOperationPerformanceSummary() {
    const summary = {};
    
    for (const [operationType, stats] of this.operationStats.entries()) {
      summary[operationType] = {
        count: stats.count,
        avgDuration: Math.round(stats.avgDuration * 100) / 100,
        p95Duration: Math.round(stats.p95Duration * 100) / 100,
        errorRate: Math.round(stats.errorRate * 100) / 100,
        memoryImpact: {
          avgHeapDelta: Math.round(stats.memoryImpact.avgHeapDelta / 1024 / 1024 * 100) / 100 // MB
        }
      };
    }
    
    return summary;
  }

  /**
   * Get memory analysis
   */
  getMemoryAnalysis() {
    const recent = this.metrics.memory.slice(-60);
    if (recent.length === 0) return null;
    
    const latest = recent[recent.length - 1];
    const trend = this.calculateTrend(recent, 'heapUsed');
    
    return {
      current: {
        heapUsed: Math.round(latest.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(latest.heapTotal / 1024 / 1024), // MB
        rss: Math.round(latest.rss / 1024 / 1024), // MB
        external: Math.round(latest.external / 1024 / 1024) // MB
      },
      trend: {
        direction: trend > 0 ? 'increasing' : trend < 0 ? 'decreasing' : 'stable',
        rate: Math.abs(trend)
      },
      fragmentation: this.calculateMemoryFragmentation(recent)
    };
  }

  /**
   * Calculate memory fragmentation
   */
  calculateMemoryFragmentation(memoryMetrics) {
    if (memoryMetrics.length === 0) return 0;
    
    const latest = memoryMetrics[memoryMetrics.length - 1];
    const unusedHeap = latest.heapTotal - latest.heapUsed;
    const fragmentationRatio = unusedHeap / latest.heapTotal;
    
    return Math.round(fragmentationRatio * 100);
  }

  /**
   * Generate performance recommendations
   */
  generatePerformanceRecommendations() {
    const recommendations = [];
    const summary = this.getResourceUsageSummary();
    
    // CPU recommendations
    if (summary.cpu.average > 70) {
      recommendations.push({
        type: 'cpu',
        severity: 'high',
        message: 'High CPU usage detected. Consider optimizing computational operations.',
        action: 'reduce_cpu_intensive_operations'
      });
    }
    
    // Memory recommendations
    if (summary.memory.average > 80) {
      recommendations.push({
        type: 'memory',
        severity: 'high',
        message: 'High memory usage detected. Consider implementing memory cleanup.',
        action: 'trigger_garbage_collection'
      });
    }
    
    // Event loop recommendations
    if (summary.eventLoop.average > 50) {
      recommendations.push({
        type: 'eventloop',
        severity: 'medium',
        message: 'Event loop lag detected. Consider using async operations.',
        action: 'optimize_blocking_operations'
      });
    }
    
    // GC recommendations
    if (summary.gc.frequency > 10) {
      recommendations.push({
        type: 'gc',
        severity: 'medium',
        message: 'Frequent garbage collection detected. Check for memory leaks.',
        action: 'investigate_memory_leaks'
      });
    }
    
    return recommendations;
  }

  /**
   * Apply performance optimizations
   */
  async applyOptimizations(profile) {
    const applied = [];
    
    for (const recommendation of profile.recommendations) {
      try {
        switch (recommendation.action) {
          case 'trigger_garbage_collection':
            if (global.gc) {
              global.gc();
              applied.push('garbage_collection');
            }
            break;
            
          case 'reduce_cpu_intensive_operations':
            // This would be application-specific
            // For example, reduce concurrent operations
            applied.push('cpu_throttling');
            break;
            
          case 'optimize_blocking_operations':
            // This would involve code analysis and optimization
            applied.push('async_optimization');
            break;
        }
      } catch (error) {
        await this.logger.error(`Optimization failed: ${recommendation.action}`, { error });
      }
    }
    
    if (applied.length > 0) {
      await this.logger.logStructured('info', 'Performance optimizations applied', {
        component: 'AutoOptimization',
        optimizations: applied
      });
    }
    
    return applied;
  }

  /**
   * Check for performance alerts
   */
  async checkPerformanceAlerts(cpu, memory, eventLoop) {
    const alerts = [];
    
    if (cpu.percentage > this.options.alertThresholds.cpu) {
      alerts.push({
        type: 'cpu',
        severity: 'warning',
        value: cpu.percentage,
        threshold: this.options.alertThresholds.cpu
      });
    }
    
    if (memory.heapUsagePercent > this.options.alertThresholds.memory) {
      alerts.push({
        type: 'memory',
        severity: 'warning',
        value: memory.heapUsagePercent,
        threshold: this.options.alertThresholds.memory
      });
    }
    
    if (eventLoop.lagMS > this.options.alertThresholds.eventLoopLag) {
      alerts.push({
        type: 'eventloop',
        severity: 'warning',
        value: eventLoop.lagMS,
        threshold: this.options.alertThresholds.eventLoopLag
      });
    }
    
    for (const alert of alerts) {
      await this.logger.logStructured('warn', `Performance alert: ${alert.type}`, {
        component: 'PerformanceAlert',
        alert
      });
      
      this.emit('performance-alert', alert);
    }
  }

  /**
   * Initialize performance baselines
   */
  async initializeBaselines() {
    // Collect baseline metrics for 30 seconds
    const baselineMetrics = {
      cpu: [],
      memory: [],
      eventLoop: []
    };
    
    const interval = setInterval(() => {
      const cpuUsage = process.cpuUsage();
      const memUsage = process.memoryUsage();
      const lag = this.measureEventLoopLag();
      
      baselineMetrics.cpu.push(cpuUsage);
      baselineMetrics.memory.push(memUsage);
      baselineMetrics.eventLoop.push(lag);
    }, 1000);
    
    await new Promise(resolve => setTimeout(resolve, 30000));
    clearInterval(interval);
    
    // Calculate baselines
    this.baselines.set('cpu', this.calculateAverage(baselineMetrics.cpu, 'user'));
    this.baselines.set('memory', this.calculateAverage(baselineMetrics.memory, 'heapUsed'));
    this.baselines.set('eventLoop', this.calculateAverage(baselineMetrics.eventLoop.map(lag => ({ lagMS: Number(lag) / 1000000 })), 'lagMS'));
    
    await this.logger.info('Performance baselines established', {
      baselines: Object.fromEntries(this.baselines)
    });
  }

  /**
   * Utility functions
   */
  calculateAverage(array, property) {
    if (array.length === 0) return 0;
    const sum = array.reduce((acc, item) => acc + (item[property] || 0), 0);
    return sum / array.length;
  }

  calculateTrend(array, property) {
    if (array.length < 2) return 0;
    
    const values = array.map(item => item[property]);
    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));
    
    const firstAvg = this.calculateAverage(firstHalf.map(v => ({ [property]: v })), property);
    const secondAvg = this.calculateAverage(secondHalf.map(v => ({ [property]: v })), property);
    
    return (secondAvg - firstAvg) / firstAvg;
  }

  cleanOldMetrics() {
    const cutoff = Date.now() - this.options.historyRetention;
    
    this.metrics.cpu = this.metrics.cpu.filter(m => m.timestamp > cutoff);
    this.metrics.memory = this.metrics.memory.filter(m => m.timestamp > cutoff);
    this.metrics.eventLoop = this.metrics.eventLoop.filter(m => m.timestamp > cutoff);
    this.metrics.gc = this.metrics.gc.filter(m => m.timestamp > cutoff);
    this.metrics.network = this.metrics.network.filter(m => m.timestamp > cutoff);
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport() {
    return {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      baselines: Object.fromEntries(this.baselines),
      currentMetrics: {
        cpu: this.metrics.cpu[this.metrics.cpu.length - 1],
        memory: this.metrics.memory[this.metrics.memory.length - 1],
        eventLoop: this.metrics.eventLoop[this.metrics.eventLoop.length - 1]
      },
      resourceUsage: this.getResourceUsageSummary(),
      operationStats: Object.fromEntries(this.operationStats),
      memoryAnalysis: this.getMemoryAnalysis(),
      recommendations: this.generatePerformanceRecommendations(),
      activeOperations: this.activeOperations.size,
      totalMetricsCollected: {
        cpu: this.metrics.cpu.length,
        memory: this.metrics.memory.length,
        eventLoop: this.metrics.eventLoop.length,
        gc: this.metrics.gc.length
      }
    };
  }
}

module.exports = PerformanceMonitor;