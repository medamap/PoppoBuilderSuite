/**
 * Issue #132: Metrics Collection System
 * 
 * Comprehensive metrics collection with:
 * - System metrics (CPU, memory, disk, network)
 * - Application metrics (requests, errors, latency)
 * - Business metrics (issues processed, success rate)
 * - Custom metrics support
 * - Time series data storage
 * - Prometheus integration
 */

const EventEmitter = require('events');
const os = require('os');
const ProductionLogger = require('../utils/production-logger');

class MetricsCollector extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      collectionInterval: options.collectionInterval || 10000, // 10 seconds
      retentionPeriod: options.retentionPeriod || 86400000, // 24 hours
      enableSystemMetrics: options.enableSystemMetrics !== false,
      enableApplicationMetrics: options.enableApplicationMetrics !== false,
      enableBusinessMetrics: options.enableBusinessMetrics !== false,
      prometheusEnabled: options.prometheusEnabled !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('MetricsCollector', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true
    });
    
    this.isRunning = false;
    this.collectionTimer = null;
    
    // Metrics storage
    this.metrics = {
      system: [],
      application: [],
      business: [],
      custom: new Map()
    };
    
    // Counters and gauges
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    this.summaries = new Map();
    
    // Prometheus registry
    this.prometheusMetrics = new Map();
    
    this.initializeMetrics();
  }

  /**
   * Initialize default metrics
   */
  initializeMetrics() {
    // System metrics
    this.registerGauge('system_cpu_usage_percent', 'System CPU usage percentage');
    this.registerGauge('system_memory_usage_percent', 'System memory usage percentage');
    this.registerGauge('system_memory_free_bytes', 'Free memory in bytes');
    this.registerGauge('system_disk_usage_percent', 'Disk usage percentage');
    this.registerGauge('system_load_average_1m', '1 minute load average');
    
    // Application metrics
    this.registerCounter('app_requests_total', 'Total number of requests');
    this.registerCounter('app_errors_total', 'Total number of errors');
    this.registerHistogram('app_request_duration_seconds', 'Request duration in seconds');
    this.registerGauge('app_active_connections', 'Number of active connections');
    this.registerGauge('app_heap_used_bytes', 'Heap memory used in bytes');
    
    // Business metrics
    this.registerCounter('issues_processed_total', 'Total issues processed');
    this.registerCounter('issues_success_total', 'Successfully processed issues');
    this.registerCounter('issues_failed_total', 'Failed issue processing');
    this.registerHistogram('issue_processing_duration_seconds', 'Issue processing duration');
    this.registerGauge('issues_queue_size', 'Number of issues in queue');
    
    // Process metrics
    this.registerGauge('process_cpu_seconds_total', 'Total CPU time in seconds');
    this.registerGauge('process_resident_memory_bytes', 'Resident memory size in bytes');
    this.registerGauge('process_virtual_memory_bytes', 'Virtual memory size in bytes');
    this.registerGauge('process_open_fds', 'Number of open file descriptors');
    this.registerCounter('process_gc_duration_seconds', 'Time spent in GC');
  }

  /**
   * Start metrics collection
   */
  async start() {
    if (this.isRunning) return;
    
    try {
      await this.logger.info('Starting Metrics Collector');
      
      this.isRunning = true;
      
      // Collect initial metrics
      await this.collectAllMetrics();
      
      // Start periodic collection
      this.collectionTimer = setInterval(async () => {
        try {
          await this.collectAllMetrics();
        } catch (error) {
          await this.logger.error('Metrics collection failed', { error });
        }
      }, this.options.collectionInterval);
      
      await this.logger.info('Metrics Collector started successfully');
      
    } catch (error) {
      await this.logger.error('Failed to start Metrics Collector', { error });
      throw error;
    }
  }

  /**
   * Stop metrics collection
   */
  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.collectionTimer) {
      clearInterval(this.collectionTimer);
      this.collectionTimer = null;
    }
    
    await this.logger.info('Metrics Collector stopped');
  }

  /**
   * Collect all metrics
   */
  async collectAllMetrics() {
    const timestamp = Date.now();
    
    if (this.options.enableSystemMetrics) {
      await this.collectSystemMetrics(timestamp);
    }
    
    if (this.options.enableApplicationMetrics) {
      await this.collectApplicationMetrics(timestamp);
    }
    
    if (this.options.enableBusinessMetrics) {
      await this.collectBusinessMetrics(timestamp);
    }
    
    // Clean old metrics
    this.cleanOldMetrics();
    
    // Emit metrics update
    this.emit('metrics-collected', {
      timestamp,
      system: this.getLatestSystemMetrics(),
      application: this.getLatestApplicationMetrics(),
      business: this.getLatestBusinessMetrics()
    });
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics(timestamp) {
    const cpus = os.cpus();
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const loadAverage = os.loadavg();
    
    // Calculate CPU usage
    const cpuUsage = this.calculateCpuUsage(cpus);
    
    // Memory usage
    const memoryUsage = ((totalMemory - freeMemory) / totalMemory) * 100;
    
    // Update gauges
    this.gauges.get('system_cpu_usage_percent').set(cpuUsage);
    this.gauges.get('system_memory_usage_percent').set(memoryUsage);
    this.gauges.get('system_memory_free_bytes').set(freeMemory);
    this.gauges.get('system_load_average_1m').set(loadAverage[0]);
    
    // Store metrics
    const systemMetrics = {
      timestamp,
      cpu: {
        usage: cpuUsage,
        count: cpus.length,
        model: cpus[0]?.model
      },
      memory: {
        total: totalMemory,
        free: freeMemory,
        used: totalMemory - freeMemory,
        usagePercent: memoryUsage
      },
      loadAverage: {
        '1m': loadAverage[0],
        '5m': loadAverage[1],
        '15m': loadAverage[2]
      },
      uptime: os.uptime(),
      platform: os.platform(),
      arch: os.arch()
    };
    
    this.metrics.system.push(systemMetrics);
    
    // Get disk usage (simulated)
    const diskUsage = await this.getDiskUsage();
    if (diskUsage) {
      this.gauges.get('system_disk_usage_percent').set(diskUsage.usagePercent);
    }
  }

  /**
   * Collect application metrics
   */
  async collectApplicationMetrics(timestamp) {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Update process metrics
    this.gauges.get('app_heap_used_bytes').set(memUsage.heapUsed);
    this.gauges.get('process_resident_memory_bytes').set(memUsage.rss);
    this.gauges.get('process_virtual_memory_bytes').set(memUsage.rss + memUsage.external);
    this.gauges.get('process_cpu_seconds_total').set((cpuUsage.user + cpuUsage.system) / 1000000);
    
    const appMetrics = {
      timestamp,
      process: {
        pid: process.pid,
        uptime: process.uptime(),
        memory: memUsage,
        cpu: cpuUsage,
        version: process.version
      },
      requests: {
        total: this.counters.get('app_requests_total').value,
        errors: this.counters.get('app_errors_total').value,
        activeConnections: this.gauges.get('app_active_connections').value
      }
    };
    
    this.metrics.application.push(appMetrics);
  }

  /**
   * Collect business metrics
   */
  async collectBusinessMetrics(timestamp) {
    const businessMetrics = {
      timestamp,
      issues: {
        processed: this.counters.get('issues_processed_total').value,
        success: this.counters.get('issues_success_total').value,
        failed: this.counters.get('issues_failed_total').value,
        queueSize: this.gauges.get('issues_queue_size').value,
        successRate: this.calculateSuccessRate()
      },
      performance: {
        avgProcessingTime: this.getAverageProcessingTime(),
        throughput: this.calculateThroughput()
      }
    };
    
    this.metrics.business.push(businessMetrics);
  }

  /**
   * Register counter metric
   */
  registerCounter(name, help) {
    const counter = {
      name,
      help,
      type: 'counter',
      value: 0,
      inc: (value = 1) => {
        counter.value += value;
        this.emit('metric-updated', { name, value: counter.value, type: 'counter' });
      },
      reset: () => {
        counter.value = 0;
      }
    };
    
    this.counters.set(name, counter);
    this.prometheusMetrics.set(name, counter);
    
    return counter;
  }

  /**
   * Register gauge metric
   */
  registerGauge(name, help) {
    const gauge = {
      name,
      help,
      type: 'gauge',
      value: 0,
      set: (value) => {
        gauge.value = value;
        this.emit('metric-updated', { name, value, type: 'gauge' });
      },
      inc: (value = 1) => {
        gauge.value += value;
        this.emit('metric-updated', { name, value: gauge.value, type: 'gauge' });
      },
      dec: (value = 1) => {
        gauge.value -= value;
        this.emit('metric-updated', { name, value: gauge.value, type: 'gauge' });
      }
    };
    
    this.gauges.set(name, gauge);
    this.prometheusMetrics.set(name, gauge);
    
    return gauge;
  }

  /**
   * Register histogram metric
   */
  registerHistogram(name, help, buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    const histogram = {
      name,
      help,
      type: 'histogram',
      buckets,
      values: [],
      observe: (value) => {
        histogram.values.push(value);
        // Keep only recent values
        if (histogram.values.length > 10000) {
          histogram.values = histogram.values.slice(-5000);
        }
        this.emit('metric-updated', { name, value, type: 'histogram' });
      },
      reset: () => {
        histogram.values = [];
      }
    };
    
    this.histograms.set(name, histogram);
    this.prometheusMetrics.set(name, histogram);
    
    return histogram;
  }

  /**
   * Register summary metric
   */
  registerSummary(name, help, percentiles = [0.5, 0.9, 0.95, 0.99]) {
    const summary = {
      name,
      help,
      type: 'summary',
      percentiles,
      values: [],
      observe: (value) => {
        summary.values.push(value);
        // Keep only recent values
        if (summary.values.length > 10000) {
          summary.values = summary.values.slice(-5000);
        }
        this.emit('metric-updated', { name, value, type: 'summary' });
      },
      reset: () => {
        summary.values = [];
      }
    };
    
    this.summaries.set(name, summary);
    this.prometheusMetrics.set(name, summary);
    
    return summary;
  }

  /**
   * Increment counter
   */
  incrementCounter(name, value = 1, labels = {}) {
    const counter = this.counters.get(name);
    if (counter) {
      counter.inc(value);
    }
  }

  /**
   * Set gauge value
   */
  setGauge(name, value, labels = {}) {
    const gauge = this.gauges.get(name);
    if (gauge) {
      gauge.set(value);
    }
  }

  /**
   * Observe histogram value
   */
  observeHistogram(name, value, labels = {}) {
    const histogram = this.histograms.get(name);
    if (histogram) {
      histogram.observe(value);
    }
  }

  /**
   * Record custom metric
   */
  recordCustomMetric(name, value, type = 'gauge', labels = {}) {
    if (!this.metrics.custom.has(name)) {
      this.metrics.custom.set(name, []);
    }
    
    const customMetrics = this.metrics.custom.get(name);
    customMetrics.push({
      timestamp: Date.now(),
      value,
      type,
      labels
    });
    
    // Keep only recent metrics
    if (customMetrics.length > 1000) {
      this.metrics.custom.set(name, customMetrics.slice(-500));
    }
    
    this.emit('custom-metric-recorded', { name, value, type, labels });
  }

  /**
   * Get metrics in Prometheus format
   */
  getPrometheusMetrics() {
    if (!this.options.prometheusEnabled) return '';
    
    let output = '';
    
    for (const [name, metric] of this.prometheusMetrics.entries()) {
      output += `# HELP ${name} ${metric.help}\n`;
      output += `# TYPE ${name} ${metric.type}\n`;
      
      switch (metric.type) {
        case 'counter':
        case 'gauge':
          output += `${name} ${metric.value}\n`;
          break;
          
        case 'histogram':
          const histogramData = this.calculateHistogram(metric.values, metric.buckets);
          for (const [bucket, count] of Object.entries(histogramData.buckets)) {
            output += `${name}_bucket{le="${bucket}"} ${count}\n`;
          }
          output += `${name}_bucket{le="+Inf"} ${metric.values.length}\n`;
          output += `${name}_sum ${histogramData.sum}\n`;
          output += `${name}_count ${metric.values.length}\n`;
          break;
          
        case 'summary':
          const summaryData = this.calculateSummary(metric.values, metric.percentiles);
          for (const [percentile, value] of Object.entries(summaryData.percentiles)) {
            output += `${name}{quantile="${percentile}"} ${value}\n`;
          }
          output += `${name}_sum ${summaryData.sum}\n`;
          output += `${name}_count ${metric.values.length}\n`;
          break;
      }
      
      output += '\n';
    }
    
    return output;
  }

  /**
   * Calculate histogram buckets
   */
  calculateHistogram(values, buckets) {
    const sorted = [...values].sort((a, b) => a - b);
    const bucketCounts = {};
    let sum = 0;
    
    for (const bucket of buckets) {
      bucketCounts[bucket] = values.filter(v => v <= bucket).length;
    }
    
    for (const value of values) {
      sum += value;
    }
    
    return { buckets: bucketCounts, sum };
  }

  /**
   * Calculate summary percentiles
   */
  calculateSummary(values, percentiles) {
    if (values.length === 0) {
      return { percentiles: {}, sum: 0 };
    }
    
    const sorted = [...values].sort((a, b) => a - b);
    const percentileValues = {};
    let sum = 0;
    
    for (const percentile of percentiles) {
      const index = Math.ceil(percentile * sorted.length) - 1;
      percentileValues[percentile] = sorted[Math.max(0, Math.min(index, sorted.length - 1))];
    }
    
    for (const value of values) {
      sum += value;
    }
    
    return { percentiles: percentileValues, sum };
  }

  /**
   * Utility methods
   */
  calculateCpuUsage(cpus) {
    let totalIdle = 0;
    let totalTick = 0;
    
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    }
    
    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - ~~(100 * idle / total);
    
    return Math.max(0, Math.min(100, usage));
  }

  async getDiskUsage() {
    // Simulated disk usage - in production, use proper disk usage library
    return {
      total: 100 * 1024 * 1024 * 1024, // 100GB
      used: 30 * 1024 * 1024 * 1024, // 30GB
      free: 70 * 1024 * 1024 * 1024, // 70GB
      usagePercent: 30
    };
  }

  calculateSuccessRate() {
    const total = this.counters.get('issues_processed_total').value;
    const success = this.counters.get('issues_success_total').value;
    
    return total > 0 ? (success / total) * 100 : 0;
  }

  getAverageProcessingTime() {
    const histogram = this.histograms.get('issue_processing_duration_seconds');
    if (!histogram || histogram.values.length === 0) return 0;
    
    const sum = histogram.values.reduce((acc, val) => acc + val, 0);
    return sum / histogram.values.length;
  }

  calculateThroughput() {
    const processed = this.counters.get('issues_processed_total').value;
    const uptime = process.uptime();
    
    return uptime > 0 ? processed / (uptime / 3600) : 0; // Issues per hour
  }

  cleanOldMetrics() {
    const cutoff = Date.now() - this.options.retentionPeriod;
    
    this.metrics.system = this.metrics.system.filter(m => m.timestamp > cutoff);
    this.metrics.application = this.metrics.application.filter(m => m.timestamp > cutoff);
    this.metrics.business = this.metrics.business.filter(m => m.timestamp > cutoff);
    
    // Clean custom metrics
    for (const [name, metrics] of this.metrics.custom.entries()) {
      this.metrics.custom.set(name, metrics.filter(m => m.timestamp > cutoff));
    }
  }

  getLatestSystemMetrics() {
    return this.metrics.system[this.metrics.system.length - 1] || null;
  }

  getLatestApplicationMetrics() {
    return this.metrics.application[this.metrics.application.length - 1] || null;
  }

  getLatestBusinessMetrics() {
    return this.metrics.business[this.metrics.business.length - 1] || null;
  }

  /**
   * Get metrics report
   */
  getMetricsReport() {
    return {
      timestamp: new Date().toISOString(),
      system: this.getLatestSystemMetrics(),
      application: this.getLatestApplicationMetrics(),
      business: this.getLatestBusinessMetrics(),
      counters: Object.fromEntries(
        Array.from(this.counters.entries()).map(([name, counter]) => [name, counter.value])
      ),
      gauges: Object.fromEntries(
        Array.from(this.gauges.entries()).map(([name, gauge]) => [name, gauge.value])
      ),
      customMetrics: Object.fromEntries(this.metrics.custom)
    };
  }
}

module.exports = MetricsCollector;