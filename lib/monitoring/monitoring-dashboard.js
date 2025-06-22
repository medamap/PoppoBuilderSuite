/**
 * Issue #132: Monitoring Dashboard
 * 
 * Real-time monitoring dashboard with:
 * - Live metrics visualization
 * - Alert management interface
 * - System health overview
 * - Performance graphs
 * - Log streaming
 * - Export capabilities
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const ProductionLogger = require('../utils/production-logger');

class MonitoringDashboard {
  constructor(options = {}) {
    this.options = {
      port: options.port || 3004,
      host: options.host || 'localhost',
      updateInterval: options.updateInterval || 5000,
      maxDataPoints: options.maxDataPoints || 100,
      enableAuth: options.enableAuth !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('MonitoringDashboard', {
      enableStructuredLogging: true
    });
    
    this.app = express();
    this.server = null;
    this.wss = null;
    this.clients = new Set();
    
    // Components
    this.metricsCollector = null;
    this.alertManager = null;
    
    // Cached data
    this.cachedMetrics = {
      system: [],
      application: [],
      business: []
    };
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Setup Express middleware
   */
  setupMiddleware() {
    this.app.use(express.json());
    this.app.use(express.static(path.join(__dirname, '../../dashboard/monitoring')));
    
    // CORS for API access
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
      next();
    });
    
    // Basic auth if enabled
    if (this.options.enableAuth) {
      this.app.use((req, res, next) => {
        const auth = req.headers.authorization;
        
        if (!auth || !auth.startsWith('Basic ')) {
          res.status(401).json({ error: 'Authentication required' });
          return;
        }
        
        const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
        const [username, password] = credentials.split(':');
        
        if (username !== this.options.username || password !== this.options.password) {
          res.status(401).json({ error: 'Invalid credentials' });
          return;
        }
        
        next();
      });
    }
  }

  /**
   * Setup API routes
   */
  setupRoutes() {
    // Health check
    this.app.get('/api/health', (req, res) => {
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
    
    // Current metrics
    this.app.get('/api/metrics/current', async (req, res) => {
      try {
        const metrics = await this.getCurrentMetrics();
        res.json(metrics);
      } catch (error) {
        await this.logger.error('Failed to get current metrics', { error });
        res.status(500).json({ error: 'Failed to get metrics' });
      }
    });
    
    // Historical metrics
    this.app.get('/api/metrics/history', async (req, res) => {
      try {
        const { period = '1h', type = 'all' } = req.query;
        const history = await this.getMetricsHistory(period, type);
        res.json(history);
      } catch (error) {
        await this.logger.error('Failed to get metrics history', { error });
        res.status(500).json({ error: 'Failed to get history' });
      }
    });
    
    // Prometheus metrics
    this.app.get('/api/metrics/prometheus', async (req, res) => {
      try {
        if (!this.metricsCollector) {
          res.status(503).send('Metrics collector not available');
          return;
        }
        
        const prometheusMetrics = this.metricsCollector.getPrometheusMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(prometheusMetrics);
      } catch (error) {
        await this.logger.error('Failed to get Prometheus metrics', { error });
        res.status(500).json({ error: 'Failed to get Prometheus metrics' });
      }
    });
    
    // Active alerts
    this.app.get('/api/alerts/active', async (req, res) => {
      try {
        const alerts = await this.getActiveAlerts();
        res.json(alerts);
      } catch (error) {
        await this.logger.error('Failed to get active alerts', { error });
        res.status(500).json({ error: 'Failed to get alerts' });
      }
    });
    
    // Alert history
    this.app.get('/api/alerts/history', async (req, res) => {
      try {
        const { limit = 100 } = req.query;
        const history = await this.getAlertHistory(parseInt(limit));
        res.json(history);
      } catch (error) {
        await this.logger.error('Failed to get alert history', { error });
        res.status(500).json({ error: 'Failed to get alert history' });
      }
    });
    
    // Alert statistics
    this.app.get('/api/alerts/statistics', async (req, res) => {
      try {
        const statistics = await this.getAlertStatistics();
        res.json(statistics);
      } catch (error) {
        await this.logger.error('Failed to get alert statistics', { error });
        res.status(500).json({ error: 'Failed to get alert statistics' });
      }
    });
    
    // Suppress alert
    this.app.post('/api/alerts/:ruleId/suppress', async (req, res) => {
      try {
        const { ruleId } = req.params;
        const { duration = 3600000 } = req.body;
        
        if (!this.alertManager) {
          res.status(503).json({ error: 'Alert manager not available' });
          return;
        }
        
        this.alertManager.suppressAlerts(ruleId, duration);
        res.json({ success: true, ruleId, duration });
      } catch (error) {
        await this.logger.error('Failed to suppress alert', { error });
        res.status(500).json({ error: 'Failed to suppress alert' });
      }
    });
    
    // System information
    this.app.get('/api/system/info', async (req, res) => {
      try {
        const systemInfo = await this.getSystemInfo();
        res.json(systemInfo);
      } catch (error) {
        await this.logger.error('Failed to get system info', { error });
        res.status(500).json({ error: 'Failed to get system info' });
      }
    });
    
    // Export metrics
    this.app.get('/api/export/metrics', async (req, res) => {
      try {
        const { format = 'json', period = '1h' } = req.query;
        const data = await this.exportMetrics(format, period);
        
        if (format === 'csv') {
          res.set('Content-Type', 'text/csv');
          res.set('Content-Disposition', 'attachment; filename="metrics.csv"');
        } else {
          res.set('Content-Type', 'application/json');
        }
        
        res.send(data);
      } catch (error) {
        await this.logger.error('Failed to export metrics', { error });
        res.status(500).json({ error: 'Failed to export metrics' });
      }
    });
    
    // Dashboard report
    this.app.get('/api/report/dashboard', async (req, res) => {
      try {
        const report = await this.generateDashboardReport();
        res.json(report);
      } catch (error) {
        await this.logger.error('Failed to generate dashboard report', { error });
        res.status(500).json({ error: 'Failed to generate report' });
      }
    });
  }

  /**
   * Setup WebSocket server
   */
  setupWebSocket() {
    this.wss = new WebSocket.Server({ noServer: true });
    
    this.wss.on('connection', (ws, request) => {
      this.logger.info('New WebSocket connection', {
        ip: request.socket.remoteAddress
      });
      
      this.clients.add(ws);
      
      // Send initial data
      this.sendInitialData(ws);
      
      // Handle messages
      ws.on('message', async (message) => {
        try {
          const data = JSON.parse(message);
          await this.handleWebSocketMessage(ws, data);
        } catch (error) {
          await this.logger.error('Invalid WebSocket message', { error });
        }
      });
      
      // Handle close
      ws.on('close', () => {
        this.clients.delete(ws);
        this.logger.info('WebSocket connection closed');
      });
      
      // Handle errors
      ws.on('error', (error) => {
        this.logger.error('WebSocket error', { error });
        this.clients.delete(ws);
      });
    });
  }

  /**
   * Start monitoring dashboard
   */
  async start(metricsCollector, alertManager) {
    try {
      await this.logger.info('Starting Monitoring Dashboard', {
        port: this.options.port,
        host: this.options.host
      });
      
      this.metricsCollector = metricsCollector;
      this.alertManager = alertManager;
      
      // Subscribe to updates
      if (this.metricsCollector) {
        this.metricsCollector.on('metrics-collected', (metrics) => {
          this.handleMetricsUpdate(metrics);
        });
      }
      
      if (this.alertManager) {
        this.alertManager.on('alert-triggered', (alert) => {
          this.handleAlertTriggered(alert);
        });
        
        this.alertManager.on('alert-resolved', (alert) => {
          this.handleAlertResolved(alert);
        });
      }
      
      // Create HTTP server
      this.server = http.createServer(this.app);
      
      // Handle WebSocket upgrades
      this.server.on('upgrade', (request, socket, head) => {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      });
      
      // Start server
      await new Promise((resolve, reject) => {
        this.server.listen(this.options.port, this.options.host, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      
      await this.logger.info('Monitoring Dashboard started successfully', {
        url: `http://${this.options.host}:${this.options.port}`
      });
      
      // Start periodic updates
      this.startPeriodicUpdates();
      
    } catch (error) {
      await this.logger.error('Failed to start Monitoring Dashboard', { error });
      throw error;
    }
  }

  /**
   * Stop monitoring dashboard
   */
  async stop() {
    await this.logger.info('Stopping Monitoring Dashboard');
    
    // Close WebSocket connections
    this.clients.forEach(client => {
      client.close();
    });
    this.clients.clear();
    
    if (this.wss) {
      this.wss.close();
    }
    
    // Stop server
    if (this.server) {
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
    }
    
    // Clear intervals
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }
    
    await this.logger.info('Monitoring Dashboard stopped');
  }

  /**
   * Start periodic updates
   */
  startPeriodicUpdates() {
    this.updateInterval = setInterval(async () => {
      try {
        const metrics = await this.getCurrentMetrics();
        const alerts = await this.getActiveAlerts();
        
        this.broadcast({
          type: 'update',
          data: {
            metrics,
            alerts,
            timestamp: Date.now()
          }
        });
      } catch (error) {
        await this.logger.error('Failed to send periodic update', { error });
      }
    }, this.options.updateInterval);
  }

  /**
   * Send initial data to new WebSocket connection
   */
  async sendInitialData(ws) {
    try {
      const [metrics, alerts, systemInfo] = await Promise.all([
        this.getCurrentMetrics(),
        this.getActiveAlerts(),
        this.getSystemInfo()
      ]);
      
      ws.send(JSON.stringify({
        type: 'initial',
        data: {
          metrics,
          alerts,
          systemInfo,
          timestamp: Date.now()
        }
      }));
    } catch (error) {
      await this.logger.error('Failed to send initial data', { error });
    }
  }

  /**
   * Handle WebSocket message
   */
  async handleWebSocketMessage(ws, message) {
    const { type, data } = message;
    
    switch (type) {
      case 'subscribe':
        // Handle subscription to specific metrics
        ws.subscriptions = data.topics || [];
        break;
        
      case 'getHistory':
        const history = await this.getMetricsHistory(data.period, data.type);
        ws.send(JSON.stringify({
          type: 'history',
          data: history
        }));
        break;
        
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        break;
    }
  }

  /**
   * Handle metrics update
   */
  handleMetricsUpdate(metrics) {
    // Update cache
    this.updateMetricsCache(metrics);
    
    // Broadcast to clients
    this.broadcast({
      type: 'metrics',
      data: metrics
    });
  }

  /**
   * Handle alert triggered
   */
  handleAlertTriggered(alert) {
    this.broadcast({
      type: 'alert-triggered',
      data: alert
    });
  }

  /**
   * Handle alert resolved
   */
  handleAlertResolved(alert) {
    this.broadcast({
      type: 'alert-resolved',
      data: alert
    });
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message) {
    const data = JSON.stringify(message);
    
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  /**
   * Update metrics cache
   */
  updateMetricsCache(metrics) {
    if (metrics.system) {
      this.cachedMetrics.system.push({
        ...metrics.system,
        timestamp: metrics.timestamp
      });
      
      // Keep only recent data points
      if (this.cachedMetrics.system.length > this.options.maxDataPoints) {
        this.cachedMetrics.system = this.cachedMetrics.system.slice(-this.options.maxDataPoints);
      }
    }
    
    if (metrics.application) {
      this.cachedMetrics.application.push({
        ...metrics.application,
        timestamp: metrics.timestamp
      });
      
      if (this.cachedMetrics.application.length > this.options.maxDataPoints) {
        this.cachedMetrics.application = this.cachedMetrics.application.slice(-this.options.maxDataPoints);
      }
    }
    
    if (metrics.business) {
      this.cachedMetrics.business.push({
        ...metrics.business,
        timestamp: metrics.timestamp
      });
      
      if (this.cachedMetrics.business.length > this.options.maxDataPoints) {
        this.cachedMetrics.business = this.cachedMetrics.business.slice(-this.options.maxDataPoints);
      }
    }
  }

  /**
   * Get current metrics
   */
  async getCurrentMetrics() {
    if (!this.metricsCollector) {
      return null;
    }
    
    return this.metricsCollector.getMetricsReport();
  }

  /**
   * Get metrics history
   */
  async getMetricsHistory(period, type) {
    const now = Date.now();
    const periodMs = this.parsePeriod(period);
    const cutoff = now - periodMs;
    
    const history = {
      period,
      type,
      startTime: cutoff,
      endTime: now,
      data: {}
    };
    
    if (type === 'all' || type === 'system') {
      history.data.system = this.cachedMetrics.system.filter(m => m.timestamp > cutoff);
    }
    
    if (type === 'all' || type === 'application') {
      history.data.application = this.cachedMetrics.application.filter(m => m.timestamp > cutoff);
    }
    
    if (type === 'all' || type === 'business') {
      history.data.business = this.cachedMetrics.business.filter(m => m.timestamp > cutoff);
    }
    
    return history;
  }

  /**
   * Get active alerts
   */
  async getActiveAlerts() {
    if (!this.alertManager) {
      return [];
    }
    
    return Array.from(this.alertManager.activeAlerts.values());
  }

  /**
   * Get alert history
   */
  async getAlertHistory(limit) {
    if (!this.alertManager) {
      return [];
    }
    
    return this.alertManager.alertHistory.slice(-limit);
  }

  /**
   * Get alert statistics
   */
  async getAlertStatistics() {
    if (!this.alertManager) {
      return null;
    }
    
    return this.alertManager.getAlertStatistics();
  }

  /**
   * Get system information
   */
  async getSystemInfo() {
    const os = require('os');
    
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      nodeVersion: process.version,
      uptime: process.uptime(),
      pid: process.pid
    };
  }

  /**
   * Export metrics
   */
  async exportMetrics(format, period) {
    const history = await this.getMetricsHistory(period, 'all');
    
    if (format === 'csv') {
      return this.convertToCSV(history);
    }
    
    return JSON.stringify(history, null, 2);
  }

  /**
   * Convert metrics to CSV
   */
  convertToCSV(history) {
    const rows = [];
    rows.push('timestamp,type,metric,value');
    
    // System metrics
    if (history.data.system) {
      history.data.system.forEach(metrics => {
        rows.push(`${metrics.timestamp},system,cpu_usage,${metrics.cpu?.usage || 0}`);
        rows.push(`${metrics.timestamp},system,memory_usage,${metrics.memory?.usagePercent || 0}`);
        rows.push(`${metrics.timestamp},system,disk_usage,${metrics.disk?.usagePercent || 0}`);
      });
    }
    
    // Application metrics
    if (history.data.application) {
      history.data.application.forEach(metrics => {
        rows.push(`${metrics.timestamp},application,requests_total,${metrics.requests?.total || 0}`);
        rows.push(`${metrics.timestamp},application,errors_total,${metrics.requests?.errors || 0}`);
        rows.push(`${metrics.timestamp},application,heap_used,${metrics.process?.memory?.heapUsed || 0}`);
      });
    }
    
    // Business metrics
    if (history.data.business) {
      history.data.business.forEach(metrics => {
        rows.push(`${metrics.timestamp},business,issues_processed,${metrics.issues?.processed || 0}`);
        rows.push(`${metrics.timestamp},business,success_rate,${metrics.issues?.successRate || 0}`);
        rows.push(`${metrics.timestamp},business,queue_size,${metrics.issues?.queueSize || 0}`);
      });
    }
    
    return rows.join('\n');
  }

  /**
   * Generate dashboard report
   */
  async generateDashboardReport() {
    const [metrics, alerts, systemInfo] = await Promise.all([
      this.getCurrentMetrics(),
      this.getAlertStatistics(),
      this.getSystemInfo()
    ]);
    
    return {
      generatedAt: new Date().toISOString(),
      system: systemInfo,
      currentMetrics: metrics,
      alertSummary: alerts,
      health: {
        status: this.calculateHealthStatus(metrics, alerts),
        score: this.calculateHealthScore(metrics, alerts)
      }
    };
  }

  /**
   * Calculate health status
   */
  calculateHealthStatus(metrics, alerts) {
    if (!metrics || !alerts) return 'unknown';
    
    const criticalAlerts = alerts.bySeverity?.critical || 0;
    const cpu = metrics.system?.cpu?.usage || 0;
    const memory = metrics.system?.memory?.usagePercent || 0;
    
    if (criticalAlerts > 0 || cpu > 90 || memory > 90) {
      return 'critical';
    }
    
    if (alerts.active > 5 || cpu > 75 || memory > 75) {
      return 'warning';
    }
    
    return 'healthy';
  }

  /**
   * Calculate health score
   */
  calculateHealthScore(metrics, alerts) {
    let score = 100;
    
    if (!metrics || !alerts) return 0;
    
    // Deduct for alerts
    score -= (alerts.bySeverity?.critical || 0) * 20;
    score -= (alerts.bySeverity?.warning || 0) * 10;
    score -= (alerts.bySeverity?.info || 0) * 5;
    
    // Deduct for resource usage
    const cpu = metrics.system?.cpu?.usage || 0;
    const memory = metrics.system?.memory?.usagePercent || 0;
    
    if (cpu > 80) score -= 10;
    if (cpu > 90) score -= 10;
    if (memory > 80) score -= 10;
    if (memory > 90) score -= 10;
    
    // Deduct for errors
    const errorRate = metrics.business?.performance?.errorRate || 0;
    if (errorRate > 5) score -= 10;
    if (errorRate > 10) score -= 10;
    
    return Math.max(0, Math.min(100, score));
  }

  /**
   * Parse period string
   */
  parsePeriod(period) {
    const units = {
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000
    };
    
    const match = period.match(/^(\d+)([mhd])$/);
    if (!match) {
      return 60 * 60 * 1000; // Default 1 hour
    }
    
    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }
}

module.exports = MonitoringDashboard;