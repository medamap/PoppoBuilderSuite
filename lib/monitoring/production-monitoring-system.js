/**
 * Production Monitoring System
 * 
 * Comprehensive monitoring and alerting system for PoppoBuilder production deployments
 */

const EventEmitter = require('events');
const prometheus = require('prom-client');
const nodemailer = require('nodemailer');
const { performance } = require('perf_hooks');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class ProductionMonitoringSystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      metricsPrefix: 'poppobuilder_',
      scrapeInterval: 10000, // 10 seconds
      alertThresholds: {
        cpuUsage: 80,
        memoryUsage: 85,
        diskUsage: 90,
        errorRate: 0.05, // 5%
        responseTime: 5000, // 5 seconds
        queueSize: 1000
      },
      alertCooldown: 300000, // 5 minutes
      emailConfig: {},
      slackWebhook: null,
      discordWebhook: null,
      logLevel: 'info',
      ...options
    };

    this.metrics = this.initializeMetrics();
    this.alerts = new Map();
    this.lastAlerts = new Map();
    this.isRunning = false;
    this.intervals = [];
    
    this.emailTransporter = this.initializeEmailTransporter();
    
    // Bind methods
    this.collectMetrics = this.collectMetrics.bind(this);
    this.checkAlerts = this.checkAlerts.bind(this);
  }

  /**
   * Initialize Prometheus metrics
   */
  initializeMetrics() {
    const register = new prometheus.Registry();
    
    // System metrics
    const cpuUsage = new prometheus.Gauge({
      name: `${this.options.metricsPrefix}cpu_usage_percent`,
      help: 'CPU usage percentage',
      registers: [register]
    });

    const memoryUsage = new prometheus.Gauge({
      name: `${this.options.metricsPrefix}memory_usage_bytes`,
      help: 'Memory usage in bytes',
      labelNames: ['type'],
      registers: [register]
    });

    const diskUsage = new prometheus.Gauge({
      name: `${this.options.metricsPrefix}disk_usage_percent`,
      help: 'Disk usage percentage',
      labelNames: ['mount'],
      registers: [register]
    });

    // Application metrics
    const httpRequests = new prometheus.Counter({
      name: `${this.options.metricsPrefix}http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
      registers: [register]
    });

    const httpDuration = new prometheus.Histogram({
      name: `${this.options.metricsPrefix}http_duration_seconds`,
      help: 'HTTP request duration in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
      registers: [register]
    });

    const taskQueue = new prometheus.Gauge({
      name: `${this.options.metricsPrefix}task_queue_size`,
      help: 'Number of tasks in queue',
      labelNames: ['status'],
      registers: [register]
    });

    const taskDuration = new prometheus.Histogram({
      name: `${this.options.metricsPrefix}task_duration_seconds`,
      help: 'Task execution duration in seconds',
      labelNames: ['type', 'status'],
      buckets: [1, 5, 10, 30, 60, 300, 600],
      registers: [register]
    });

    // Service health metrics
    const serviceHealth = new prometheus.Gauge({
      name: `${this.options.metricsPrefix}service_health`,
      help: 'Service health status (1 = healthy, 0 = unhealthy)',
      labelNames: ['service'],
      registers: [register]
    });

    // Error metrics
    const errorCount = new prometheus.Counter({
      name: `${this.options.metricsPrefix}errors_total`,
      help: 'Total number of errors',
      labelNames: ['type', 'severity'],
      registers: [register]
    });

    // GitHub API metrics
    const githubApiCalls = new prometheus.Counter({
      name: `${this.options.metricsPrefix}github_api_calls_total`,
      help: 'Total GitHub API calls',
      labelNames: ['endpoint', 'status'],
      registers: [register]
    });

    const githubRateLimit = new prometheus.Gauge({
      name: `${this.options.metricsPrefix}github_rate_limit_remaining`,
      help: 'GitHub API rate limit remaining',
      registers: [register]
    });

    // Claude API metrics
    const claudeApiCalls = new prometheus.Counter({
      name: `${this.options.metricsPrefix}claude_api_calls_total`,
      help: 'Total Claude API calls',
      labelNames: ['model', 'status'],
      registers: [register]
    });

    const claudeTokenUsage = new prometheus.Counter({
      name: `${this.options.metricsPrefix}claude_tokens_total`,
      help: 'Total Claude tokens used',
      labelNames: ['type'], // input, output
      registers: [register]
    });

    return {
      register,
      cpuUsage,
      memoryUsage,
      diskUsage,
      httpRequests,
      httpDuration,
      taskQueue,
      taskDuration,
      serviceHealth,
      errorCount,
      githubApiCalls,
      githubRateLimit,
      claudeApiCalls,
      claudeTokenUsage
    };
  }

  /**
   * Initialize email transporter
   */
  initializeEmailTransporter() {
    if (!this.options.emailConfig.host) {
      return null;
    }

    return nodemailer.createTransporter({
      host: this.options.emailConfig.host,
      port: this.options.emailConfig.port || 587,
      secure: this.options.emailConfig.secure || false,
      auth: {
        user: this.options.emailConfig.user,
        pass: this.options.emailConfig.password
      }
    });
  }

  /**
   * Start monitoring system
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Monitoring system is already running');
    }

    this.log('info', 'Starting production monitoring system...');

    this.isRunning = true;

    // Start metrics collection
    const metricsInterval = setInterval(this.collectMetrics, this.options.scrapeInterval);
    this.intervals.push(metricsInterval);

    // Start alert checking
    const alertInterval = setInterval(this.checkAlerts, 30000); // Check every 30 seconds
    this.intervals.push(alertInterval);

    // Register default Node.js metrics
    prometheus.collectDefaultMetrics({ 
      register: this.metrics.register,
      prefix: this.options.metricsPrefix 
    });

    this.emit('started');
    this.log('info', 'Production monitoring system started');
  }

  /**
   * Stop monitoring system
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.log('info', 'Stopping production monitoring system...');

    this.isRunning = false;

    // Clear intervals
    this.intervals.forEach(interval => clearInterval(interval));
    this.intervals = [];

    this.emit('stopped');
    this.log('info', 'Production monitoring system stopped');
  }

  /**
   * Collect system and application metrics
   */
  async collectMetrics() {
    try {
      await this.collectSystemMetrics();
      await this.collectApplicationMetrics();
      await this.collectServiceHealthMetrics();
    } catch (error) {
      this.log('error', `Failed to collect metrics: ${error.message}`);
      this.recordError('metrics_collection', 'error', error);
    }
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    // CPU usage
    const cpuUsage = await this.getCpuUsage();
    this.metrics.cpuUsage.set(cpuUsage);

    // Memory usage
    const memUsage = process.memoryUsage();
    this.metrics.memoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
    this.metrics.memoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
    this.metrics.memoryUsage.set({ type: 'rss' }, memUsage.rss);
    this.metrics.memoryUsage.set({ type: 'external' }, memUsage.external);

    // System memory
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    this.metrics.memoryUsage.set({ type: 'system_used' }, usedMem);
    this.metrics.memoryUsage.set({ type: 'system_total' }, totalMem);

    // Disk usage
    try {
      const diskUsage = await this.getDiskUsage('/');
      this.metrics.diskUsage.set({ mount: '/' }, diskUsage.percent);
    } catch (error) {
      this.log('warn', `Failed to get disk usage: ${error.message}`);
    }
  }

  /**
   * Collect application-specific metrics
   */
  async collectApplicationMetrics() {
    // This would be called by the application to report metrics
    // For now, we'll emit an event that the application can listen to
    this.emit('collect-app-metrics', this.metrics);
  }

  /**
   * Collect service health metrics
   */
  async collectServiceHealthMetrics() {
    const services = ['redis', 'postgres', 'daemon', 'dashboard'];
    
    for (const service of services) {
      const isHealthy = await this.checkServiceHealth(service);
      this.metrics.serviceHealth.set({ service }, isHealthy ? 1 : 0);
    }
  }

  /**
   * Check service health
   */
  async checkServiceHealth(service) {
    try {
      switch (service) {
        case 'redis':
          // Would implement Redis health check
          return true;
        case 'postgres':
          // Would implement PostgreSQL health check
          return true;
        case 'daemon':
          // Would implement daemon health check
          return true;
        case 'dashboard':
          // Would implement dashboard health check
          return true;
        default:
          return false;
      }
    } catch (error) {
      this.log('warn', `Health check failed for ${service}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get CPU usage percentage
   */
  async getCpuUsage() {
    const startUsage = process.cpuUsage();
    const startTime = Date.now();
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const endUsage = process.cpuUsage(startUsage);
    const endTime = Date.now();
    
    const totalTime = (endTime - startTime) * 1000; // Convert to microseconds
    const userTime = endUsage.user;
    const systemTime = endUsage.system;
    
    return ((userTime + systemTime) / totalTime) * 100;
  }

  /**
   * Get disk usage
   */
  async getDiskUsage(path) {
    const { execSync } = require('child_process');
    
    try {
      const output = execSync(`df -h ${path}`, { encoding: 'utf8' });
      const lines = output.trim().split('\n');
      const stats = lines[1].split(/\s+/);
      
      return {
        size: stats[1],
        used: stats[2],
        available: stats[3],
        percent: parseInt(stats[4].replace('%', ''))
      };
    } catch (error) {
      throw new Error(`Failed to get disk usage: ${error.message}`);
    }
  }

  /**
   * Check alerts based on thresholds
   */
  async checkAlerts() {
    const now = Date.now();
    const currentMetrics = await this.getCurrentMetrics();

    // CPU usage alert
    if (currentMetrics.cpuUsage > this.options.alertThresholds.cpuUsage) {
      await this.triggerAlert('high_cpu_usage', 'warning', {
        current: currentMetrics.cpuUsage,
        threshold: this.options.alertThresholds.cpuUsage,
        message: `CPU usage is ${currentMetrics.cpuUsage.toFixed(1)}% (threshold: ${this.options.alertThresholds.cpuUsage}%)`
      });
    }

    // Memory usage alert
    const memoryUsagePercent = (currentMetrics.memoryUsed / currentMetrics.memoryTotal) * 100;
    if (memoryUsagePercent > this.options.alertThresholds.memoryUsage) {
      await this.triggerAlert('high_memory_usage', 'warning', {
        current: memoryUsagePercent,
        threshold: this.options.alertThresholds.memoryUsage,
        message: `Memory usage is ${memoryUsagePercent.toFixed(1)}% (threshold: ${this.options.alertThresholds.memoryUsage}%)`
      });
    }

    // Disk usage alert
    if (currentMetrics.diskUsage > this.options.alertThresholds.diskUsage) {
      await this.triggerAlert('high_disk_usage', 'critical', {
        current: currentMetrics.diskUsage,
        threshold: this.options.alertThresholds.diskUsage,
        message: `Disk usage is ${currentMetrics.diskUsage}% (threshold: ${this.options.alertThresholds.diskUsage}%)`
      });
    }

    // Service health alerts
    for (const [service, health] of Object.entries(currentMetrics.serviceHealth)) {
      if (health === 0) {
        await this.triggerAlert('service_down', 'critical', {
          service,
          message: `Service ${service} is down`
        });
      }
    }
  }

  /**
   * Get current metrics values
   */
  async getCurrentMetrics() {
    const metricsString = await this.metrics.register.metrics();
    const lines = metricsString.split('\n');
    
    const metrics = {
      cpuUsage: 0,
      memoryUsed: 0,
      memoryTotal: os.totalmem(),
      diskUsage: 0,
      serviceHealth: {}
    };

    // Parse metrics (simplified parsing)
    for (const line of lines) {
      if (line.startsWith(this.options.metricsPrefix)) {
        const parts = line.split(' ');
        if (parts.length >= 2) {
          const metricName = parts[0];
          const value = parseFloat(parts[1]);
          
          if (metricName.includes('cpu_usage_percent')) {
            metrics.cpuUsage = value;
          } else if (metricName.includes('memory_usage_bytes') && metricName.includes('system_used')) {
            metrics.memoryUsed = value;
          } else if (metricName.includes('disk_usage_percent')) {
            metrics.diskUsage = value;
          } else if (metricName.includes('service_health')) {
            const serviceMatch = metricName.match(/service="([^"]+)"/);
            if (serviceMatch) {
              metrics.serviceHealth[serviceMatch[1]] = value;
            }
          }
        }
      }
    }

    return metrics;
  }

  /**
   * Trigger alert
   */
  async triggerAlert(alertType, severity, data) {
    const now = Date.now();
    const alertKey = `${alertType}-${JSON.stringify(data)}`;
    
    // Check cooldown
    const lastAlert = this.lastAlerts.get(alertKey);
    if (lastAlert && (now - lastAlert) < this.options.alertCooldown) {
      return;
    }

    this.lastAlerts.set(alertKey, now);

    const alert = {
      type: alertType,
      severity,
      timestamp: new Date().toISOString(),
      data,
      hostname: os.hostname()
    };

    this.log('warn', `Alert triggered: ${alertType} (${severity})`, alert);
    
    // Send notifications
    await this.sendAlertNotifications(alert);
    
    this.emit('alert', alert);
  }

  /**
   * Send alert notifications
   */
  async sendAlertNotifications(alert) {
    const notifications = [];

    // Email notification
    if (this.emailTransporter && this.options.emailConfig.to) {
      notifications.push(this.sendEmailAlert(alert));
    }

    // Slack notification
    if (this.options.slackWebhook) {
      notifications.push(this.sendSlackAlert(alert));
    }

    // Discord notification
    if (this.options.discordWebhook) {
      notifications.push(this.sendDiscordAlert(alert));
    }

    try {
      await Promise.all(notifications);
    } catch (error) {
      this.log('error', `Failed to send alert notifications: ${error.message}`);
    }
  }

  /**
   * Send email alert
   */
  async sendEmailAlert(alert) {
    const subject = `[PoppoBuilder Alert] ${alert.type} - ${alert.severity}`;
    const text = `
Alert: ${alert.type}
Severity: ${alert.severity}
Time: ${alert.timestamp}
Host: ${alert.hostname}

Details:
${JSON.stringify(alert.data, null, 2)}
    `;

    await this.emailTransporter.sendMail({
      from: this.options.emailConfig.from || 'alerts@poppobuilder.local',
      to: this.options.emailConfig.to,
      subject,
      text
    });
  }

  /**
   * Send Slack alert
   */
  async sendSlackAlert(alert) {
    const color = alert.severity === 'critical' ? 'danger' : 'warning';
    
    const payload = {
      attachments: [{
        color,
        title: `PoppoBuilder Alert: ${alert.type}`,
        fields: [
          { title: 'Severity', value: alert.severity, short: true },
          { title: 'Host', value: alert.hostname, short: true },
          { title: 'Time', value: alert.timestamp, short: false },
          { title: 'Details', value: JSON.stringify(alert.data, null, 2), short: false }
        ]
      }]
    };

    const response = await fetch(this.options.slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.statusText}`);
    }
  }

  /**
   * Send Discord alert
   */
  async sendDiscordAlert(alert) {
    const color = alert.severity === 'critical' ? 0xff0000 : 0xffaa00;
    
    const payload = {
      embeds: [{
        title: `PoppoBuilder Alert: ${alert.type}`,
        color,
        fields: [
          { name: 'Severity', value: alert.severity, inline: true },
          { name: 'Host', value: alert.hostname, inline: true },
          { name: 'Time', value: alert.timestamp, inline: false },
          { name: 'Details', value: `\`\`\`json\n${JSON.stringify(alert.data, null, 2)}\n\`\`\``, inline: false }
        ],
        timestamp: alert.timestamp
      }]
    };

    const response = await fetch(this.options.discordWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Discord webhook failed: ${response.statusText}`);
    }
  }

  /**
   * Record HTTP request metric
   */
  recordHttpRequest(method, route, status, duration) {
    this.metrics.httpRequests.inc({ method, route, status });
    this.metrics.httpDuration.observe({ method, route, status }, duration / 1000);
  }

  /**
   * Record task metric
   */
  recordTask(type, status, duration) {
    this.metrics.taskDuration.observe({ type, status }, duration / 1000);
  }

  /**
   * Record error
   */
  recordError(type, severity, error) {
    this.metrics.errorCount.inc({ type, severity });
    
    if (severity === 'critical') {
      this.triggerAlert('error_occurred', severity, {
        type,
        message: error.message,
        stack: error.stack
      });
    }
  }

  /**
   * Record GitHub API call
   */
  recordGitHubApiCall(endpoint, status, rateLimitRemaining) {
    this.metrics.githubApiCalls.inc({ endpoint, status });
    if (rateLimitRemaining !== undefined) {
      this.metrics.githubRateLimit.set(rateLimitRemaining);
    }
  }

  /**
   * Record Claude API call
   */
  recordClaudeApiCall(model, status, inputTokens, outputTokens) {
    this.metrics.claudeApiCalls.inc({ model, status });
    if (inputTokens) {
      this.metrics.claudeTokenUsage.inc({ type: 'input' }, inputTokens);
    }
    if (outputTokens) {
      this.metrics.claudeTokenUsage.inc({ type: 'output' }, outputTokens);
    }
  }

  /**
   * Update task queue metrics
   */
  updateTaskQueue(pending, running, completed, failed) {
    this.metrics.taskQueue.set({ status: 'pending' }, pending);
    this.metrics.taskQueue.set({ status: 'running' }, running);
    this.metrics.taskQueue.set({ status: 'completed' }, completed);
    this.metrics.taskQueue.set({ status: 'failed' }, failed);
  }

  /**
   * Get metrics for Prometheus scraping
   */
  async getMetrics() {
    return this.metrics.register.metrics();
  }

  /**
   * Get metrics as JSON
   */
  async getMetricsJSON() {
    const metricsArray = await this.metrics.register.getMetricsAsJSON();
    return metricsArray;
  }

  /**
   * Log message
   */
  log(level, message, data = null) {
    if (this.shouldLog(level)) {
      const timestamp = new Date().toISOString();
      const logData = { timestamp, level, message };
      if (data) {
        logData.data = data;
      }
      console.log(JSON.stringify(logData));
    }
  }

  /**
   * Check if should log based on level
   */
  shouldLog(level) {
    const levels = { error: 0, warn: 1, info: 2, debug: 3 };
    const currentLevel = levels[this.options.logLevel] || 2;
    const messageLevel = levels[level] || 2;
    return messageLevel <= currentLevel;
  }
}

module.exports = ProductionMonitoringSystem;