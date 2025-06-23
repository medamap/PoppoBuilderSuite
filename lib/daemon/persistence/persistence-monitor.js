/**
 * Persistence Monitor
 * Tracks storage operations and provides monitoring capabilities
 */

const EventEmitter = require('events');

class PersistenceMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      metricsInterval: 60000, // 1 minute
      maxOperationTime: 5000, // 5 seconds
      alertThresholds: {
        saveTime: 3000,
        loadTime: 2000,
        snapshotTime: 5000,
        errorRate: 0.05, // 5%
        storageSize: 100 * 1024 * 1024 // 100MB
      },
      ...options
    };
    
    this.metrics = {
      operations: {
        save: { count: 0, errors: 0, totalTime: 0, lastTime: 0 },
        load: { count: 0, errors: 0, totalTime: 0, lastTime: 0 },
        snapshot: { count: 0, errors: 0, totalTime: 0, lastTime: 0 },
        restore: { count: 0, errors: 0, totalTime: 0, lastTime: 0 }
      },
      storage: {
        size: 0,
        lastChecked: null
      },
      alerts: []
    };
    
    this.metricsTimer = null;
  }

  /**
   * Start monitoring
   */
  start() {
    this.metricsTimer = setInterval(() => {
      this.checkMetrics();
    }, this.options.metricsInterval);
    
    this.emit('monitoring-started');
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (this.metricsTimer) {
      clearInterval(this.metricsTimer);
      this.metricsTimer = null;
    }
    
    this.emit('monitoring-stopped');
  }

  /**
   * Track an operation
   */
  async trackOperation(operation, fn) {
    const startTime = Date.now();
    const metric = this.metrics.operations[operation];
    
    if (!metric) {
      throw new Error(`Unknown operation: ${operation}`);
    }
    
    try {
      const result = await fn();
      
      const duration = Date.now() - startTime;
      metric.count++;
      metric.totalTime += duration;
      metric.lastTime = duration;
      
      // Check for slow operations
      if (duration > this.options.alertThresholds[`${operation}Time`]) {
        this.addAlert('slow-operation', {
          operation,
          duration,
          threshold: this.options.alertThresholds[`${operation}Time`]
        });
      }
      
      this.emit('operation-completed', {
        operation,
        duration,
        success: true
      });
      
      return result;
      
    } catch (error) {
      const duration = Date.now() - startTime;
      metric.count++;
      metric.errors++;
      metric.totalTime += duration;
      metric.lastTime = duration;
      
      this.addAlert('operation-error', {
        operation,
        error: error.message,
        duration
      });
      
      this.emit('operation-completed', {
        operation,
        duration,
        success: false,
        error: error.message
      });
      
      throw error;
    }
  }

  /**
   * Update storage size
   */
  updateStorageSize(size) {
    this.metrics.storage.size = size;
    this.metrics.storage.lastChecked = new Date().toISOString();
    
    // Check size threshold
    if (size > this.options.alertThresholds.storageSize) {
      this.addAlert('storage-size', {
        currentSize: size,
        threshold: this.options.alertThresholds.storageSize
      });
    }
  }

  /**
   * Add an alert
   */
  addAlert(type, details) {
    const alert = {
      type,
      details,
      timestamp: new Date().toISOString()
    };
    
    this.metrics.alerts.push(alert);
    
    // Keep only last 100 alerts
    if (this.metrics.alerts.length > 100) {
      this.metrics.alerts = this.metrics.alerts.slice(-100);
    }
    
    this.emit('alert', alert);
  }

  /**
   * Check metrics and generate alerts
   */
  checkMetrics() {
    // Check error rates
    for (const [operation, metric] of Object.entries(this.metrics.operations)) {
      if (metric.count > 0) {
        const errorRate = metric.errors / metric.count;
        if (errorRate > this.options.alertThresholds.errorRate) {
          this.addAlert('high-error-rate', {
            operation,
            errorRate,
            threshold: this.options.alertThresholds.errorRate
          });
        }
      }
    }
    
    this.emit('metrics-checked', this.getMetrics());
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    const metrics = {
      operations: {},
      storage: this.metrics.storage,
      alerts: this.metrics.alerts.slice(-10), // Last 10 alerts
      summary: {
        totalOperations: 0,
        totalErrors: 0,
        averageTimes: {}
      }
    };
    
    // Calculate operation metrics
    for (const [operation, metric] of Object.entries(this.metrics.operations)) {
      metrics.operations[operation] = {
        ...metric,
        averageTime: metric.count > 0 ? metric.totalTime / metric.count : 0,
        errorRate: metric.count > 0 ? metric.errors / metric.count : 0
      };
      
      metrics.summary.totalOperations += metric.count;
      metrics.summary.totalErrors += metric.errors;
      metrics.summary.averageTimes[operation] = metrics.operations[operation].averageTime;
    }
    
    metrics.summary.overallErrorRate = metrics.summary.totalOperations > 0
      ? metrics.summary.totalErrors / metrics.summary.totalOperations
      : 0;
    
    return metrics;
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    for (const metric of Object.values(this.metrics.operations)) {
      metric.count = 0;
      metric.errors = 0;
      metric.totalTime = 0;
      metric.lastTime = 0;
    }
    
    this.metrics.alerts = [];
    this.emit('metrics-reset');
  }

  /**
   * Get performance report
   */
  getPerformanceReport() {
    const metrics = this.getMetrics();
    const report = {
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      operations: {},
      issues: [],
      recommendations: []
    };
    
    // Analyze each operation
    for (const [operation, data] of Object.entries(metrics.operations)) {
      report.operations[operation] = {
        totalCalls: data.count,
        successRate: data.count > 0 ? ((data.count - data.errors) / data.count * 100).toFixed(2) + '%' : 'N/A',
        averageTime: data.averageTime.toFixed(2) + 'ms',
        lastTime: data.lastTime + 'ms'
      };
      
      // Check for issues
      if (data.errorRate > this.options.alertThresholds.errorRate) {
        report.issues.push({
          type: 'high-error-rate',
          operation,
          severity: 'high',
          message: `${operation} has ${(data.errorRate * 100).toFixed(2)}% error rate`
        });
      }
      
      if (data.averageTime > this.options.alertThresholds[`${operation}Time`]) {
        report.issues.push({
          type: 'slow-operation',
          operation,
          severity: 'medium',
          message: `${operation} average time (${data.averageTime.toFixed(2)}ms) exceeds threshold`
        });
      }
    }
    
    // Storage analysis
    if (metrics.storage.size > this.options.alertThresholds.storageSize) {
      report.issues.push({
        type: 'storage-size',
        severity: 'medium',
        message: `Storage size (${(metrics.storage.size / 1024 / 1024).toFixed(2)}MB) exceeds threshold`
      });
      
      report.recommendations.push('Consider cleaning up old snapshots or implementing compression');
    }
    
    // General recommendations
    if (report.issues.length > 0) {
      if (report.issues.some(i => i.type === 'high-error-rate')) {
        report.recommendations.push('Investigate error logs and consider implementing retry logic');
      }
      
      if (report.issues.some(i => i.type === 'slow-operation')) {
        report.recommendations.push('Consider optimizing storage operations or switching to a faster storage backend');
      }
    }
    
    return report;
  }
}

module.exports = PersistenceMonitor;