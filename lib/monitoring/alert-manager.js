/**
 * Issue #132: Alert Management System
 * 
 * Intelligent alerting system with:
 * - Rule-based alerting
 * - Alert aggregation and deduplication
 * - Multi-channel notifications
 * - Alert severity levels
 * - Alert suppression and scheduling
 * - Escalation policies
 */

const EventEmitter = require('events');
const ProductionLogger = require('../utils/production-logger');

class AlertManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      evaluationInterval: options.evaluationInterval || 30000, // 30 seconds
      aggregationWindow: options.aggregationWindow || 300000, // 5 minutes
      cooldownPeriod: options.cooldownPeriod || 3600000, // 1 hour
      maxAlertsPerRule: options.maxAlertsPerRule || 10,
      enableNotifications: options.enableNotifications !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('AlertManager', {
      enableStructuredLogging: true,
      enableSecurityAudit: true
    });
    
    this.isRunning = false;
    this.evaluationTimer = null;
    
    // Alert management
    this.alertRules = new Map();
    this.activeAlerts = new Map();
    this.alertHistory = [];
    this.suppressedAlerts = new Set();
    this.alertGroups = new Map();
    
    // Notification channels
    this.notificationChannels = new Map();
    this.escalationPolicies = new Map();
    
    this.initializeDefaultRules();
    this.initializeNotificationChannels();
  }

  /**
   * Initialize default alert rules
   */
  initializeDefaultRules() {
    // System alerts
    this.addAlertRule({
      id: 'high_cpu_usage',
      name: 'High CPU Usage',
      condition: (metrics) => metrics.system?.cpu?.usage > 80,
      severity: 'warning',
      threshold: 80,
      description: 'CPU usage is above 80%',
      annotations: {
        summary: 'High CPU usage detected',
        runbook: 'Check for CPU-intensive processes'
      },
      labels: {
        category: 'system',
        resource: 'cpu'
      }
    });
    
    this.addAlertRule({
      id: 'critical_cpu_usage',
      name: 'Critical CPU Usage',
      condition: (metrics) => metrics.system?.cpu?.usage > 95,
      severity: 'critical',
      threshold: 95,
      description: 'CPU usage is above 95%',
      labels: {
        category: 'system',
        resource: 'cpu'
      }
    });
    
    this.addAlertRule({
      id: 'high_memory_usage',
      name: 'High Memory Usage',
      condition: (metrics) => metrics.system?.memory?.usagePercent > 85,
      severity: 'warning',
      threshold: 85,
      description: 'Memory usage is above 85%',
      labels: {
        category: 'system',
        resource: 'memory'
      }
    });
    
    this.addAlertRule({
      id: 'disk_space_low',
      name: 'Low Disk Space',
      condition: (metrics) => metrics.system?.disk?.usagePercent > 90,
      severity: 'critical',
      threshold: 90,
      description: 'Disk usage is above 90%',
      labels: {
        category: 'system',
        resource: 'disk'
      }
    });
    
    // Application alerts
    this.addAlertRule({
      id: 'high_error_rate',
      name: 'High Error Rate',
      condition: (metrics) => {
        const errors = metrics.application?.requests?.errors || 0;
        const total = metrics.application?.requests?.total || 1;
        return (errors / total) * 100 > 5;
      },
      severity: 'warning',
      threshold: 5,
      description: 'Error rate is above 5%',
      labels: {
        category: 'application',
        metric: 'error_rate'
      }
    });
    
    this.addAlertRule({
      id: 'high_response_time',
      name: 'High Response Time',
      condition: (metrics) => metrics.business?.performance?.avgProcessingTime > 5,
      severity: 'warning',
      threshold: 5,
      description: 'Average response time is above 5 seconds',
      labels: {
        category: 'application',
        metric: 'response_time'
      }
    });
    
    // Business alerts
    this.addAlertRule({
      id: 'low_success_rate',
      name: 'Low Success Rate',
      condition: (metrics) => {
        const successRate = metrics.business?.issues?.successRate || 100;
        return successRate < 90;
      },
      severity: 'warning',
      threshold: 90,
      description: 'Success rate is below 90%',
      labels: {
        category: 'business',
        metric: 'success_rate'
      }
    });
    
    this.addAlertRule({
      id: 'large_queue_size',
      name: 'Large Queue Size',
      condition: (metrics) => metrics.business?.issues?.queueSize > 50,
      severity: 'info',
      threshold: 50,
      description: 'Queue size is above 50 items',
      labels: {
        category: 'business',
        metric: 'queue_size'
      }
    });
    
    // Security alerts
    this.addAlertRule({
      id: 'authentication_failures',
      name: 'Multiple Authentication Failures',
      condition: (metrics) => metrics.security?.authFailures > 5,
      severity: 'critical',
      threshold: 5,
      description: 'Multiple authentication failures detected',
      labels: {
        category: 'security',
        type: 'authentication'
      }
    });
  }

  /**
   * Initialize notification channels
   */
  initializeNotificationChannels() {
    // Console channel (always enabled)
    this.addNotificationChannel({
      id: 'console',
      name: 'Console Logger',
      type: 'console',
      enabled: true,
      send: async (alert) => {
        const severityIcons = {
          critical: '🚨',
          warning: '⚠️',
          info: 'ℹ️'
        };
        
        console.log(`${severityIcons[alert.severity]} [${alert.severity.toUpperCase()}] ${alert.name}: ${alert.description}`);
        console.log(`   Rule: ${alert.ruleId}`);
        console.log(`   Time: ${new Date(alert.timestamp).toISOString()}`);
        if (alert.value !== undefined) {
          console.log(`   Value: ${alert.value}`);
        }
      }
    });
    
    // Log file channel
    this.addNotificationChannel({
      id: 'log',
      name: 'Log File',
      type: 'log',
      enabled: true,
      send: async (alert) => {
        await this.logger.logStructured(alert.severity === 'critical' ? 'error' : 'warn', 'Alert triggered', {
          component: 'Alert',
          alert
        });
      }
    });
    
    // GitHub Issues channel (placeholder)
    this.addNotificationChannel({
      id: 'github',
      name: 'GitHub Issues',
      type: 'github',
      enabled: false,
      config: {
        createIssueOnCritical: true,
        labelPrefix: 'alert'
      },
      send: async (alert) => {
        if (alert.severity === 'critical' && this.options.githubClient) {
          // Create GitHub issue for critical alerts
          await this.logger.info('Would create GitHub issue for critical alert', { alert });
        }
      }
    });
    
    // Email channel (placeholder)
    this.addNotificationChannel({
      id: 'email',
      name: 'Email',
      type: 'email',
      enabled: false,
      config: {
        recipients: ['admin@poppobuilder.com'],
        smtpServer: 'smtp.example.com'
      },
      send: async (alert) => {
        await this.logger.info('Would send email alert', { alert });
      }
    });
    
    // Slack channel (placeholder)
    this.addNotificationChannel({
      id: 'slack',
      name: 'Slack',
      type: 'slack',
      enabled: false,
      config: {
        webhookUrl: process.env.SLACK_WEBHOOK_URL,
        channel: '#alerts'
      },
      send: async (alert) => {
        await this.logger.info('Would send Slack alert', { alert });
      }
    });
  }

  /**
   * Start alert manager
   */
  async start(metricsCollector) {
    if (this.isRunning) return;
    
    try {
      await this.logger.info('Starting Alert Manager');
      
      this.metricsCollector = metricsCollector;
      this.isRunning = true;
      
      // Subscribe to metrics updates
      if (this.metricsCollector) {
        this.metricsCollector.on('metrics-collected', (metrics) => {
          this.evaluateAlerts(metrics);
        });
      }
      
      // Start periodic evaluation
      this.evaluationTimer = setInterval(() => {
        this.cleanupAlerts();
        this.checkEscalations();
      }, this.options.evaluationInterval);
      
      await this.logger.info('Alert Manager started successfully');
      
    } catch (error) {
      await this.logger.error('Failed to start Alert Manager', { error });
      throw error;
    }
  }

  /**
   * Stop alert manager
   */
  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.evaluationTimer) {
      clearInterval(this.evaluationTimer);
      this.evaluationTimer = null;
    }
    
    await this.logger.info('Alert Manager stopped');
  }

  /**
   * Add alert rule
   */
  addAlertRule(rule) {
    const alertRule = {
      id: rule.id,
      name: rule.name,
      condition: rule.condition,
      severity: rule.severity || 'info',
      threshold: rule.threshold,
      description: rule.description,
      annotations: rule.annotations || {},
      labels: rule.labels || {},
      enabled: rule.enabled !== false,
      cooldown: rule.cooldown || this.options.cooldownPeriod,
      groupBy: rule.groupBy || [],
      notificationChannels: rule.notificationChannels || ['console', 'log'],
      escalationPolicy: rule.escalationPolicy,
      createdAt: Date.now()
    };
    
    this.alertRules.set(rule.id, alertRule);
    
    return alertRule;
  }

  /**
   * Remove alert rule
   */
  removeAlertRule(ruleId) {
    this.alertRules.delete(ruleId);
    
    // Remove active alerts for this rule
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      if (alert.ruleId === ruleId) {
        this.activeAlerts.delete(alertId);
      }
    }
  }

  /**
   * Add notification channel
   */
  addNotificationChannel(channel) {
    this.notificationChannels.set(channel.id, {
      ...channel,
      sentCount: 0,
      lastSent: null
    });
  }

  /**
   * Evaluate alerts based on metrics
   */
  async evaluateAlerts(metrics) {
    if (!this.isRunning) return;
    
    for (const [ruleId, rule] of this.alertRules.entries()) {
      if (!rule.enabled) continue;
      
      try {
        const shouldAlert = rule.condition(metrics);
        
        if (shouldAlert) {
          await this.triggerAlert(rule, metrics);
        } else {
          // Clear alert if condition is no longer met
          this.clearAlert(ruleId);
        }
      } catch (error) {
        await this.logger.error(`Alert rule evaluation failed: ${ruleId}`, { error });
      }
    }
  }

  /**
   * Trigger alert
   */
  async triggerAlert(rule, metrics) {
    const alertId = `${rule.id}_${Date.now()}`;
    
    // Check if alert is suppressed
    if (this.isAlertSuppressed(rule.id)) {
      return;
    }
    
    // Check if alert is in cooldown
    if (this.isAlertInCooldown(rule.id)) {
      return;
    }
    
    // Check if we've exceeded max alerts per rule
    const ruleAlerts = Array.from(this.activeAlerts.values()).filter(a => a.ruleId === rule.id);
    if (ruleAlerts.length >= this.options.maxAlertsPerRule) {
      return;
    }
    
    const alert = {
      id: alertId,
      ruleId: rule.id,
      name: rule.name,
      severity: rule.severity,
      description: rule.description,
      timestamp: Date.now(),
      value: this.extractAlertValue(rule, metrics),
      labels: { ...rule.labels },
      annotations: { ...rule.annotations },
      state: 'active',
      notifiedChannels: [],
      escalationLevel: 0
    };
    
    // Add to active alerts
    this.activeAlerts.set(alertId, alert);
    
    // Add to alert history
    this.alertHistory.push({
      ...alert,
      triggeredAt: alert.timestamp
    });
    
    // Group alert if needed
    if (rule.groupBy && rule.groupBy.length > 0) {
      this.groupAlert(alert, rule);
    }
    
    // Send notifications
    if (this.options.enableNotifications) {
      await this.sendNotifications(alert, rule);
    }
    
    // Record last alert time for cooldown
    rule.lastAlertTime = Date.now();
    
    await this.logger.logStructured('warn', 'Alert triggered', {
      component: 'Alert',
      alert
    });
    
    this.emit('alert-triggered', alert);
  }

  /**
   * Clear alert
   */
  clearAlert(ruleId) {
    const clearedAlerts = [];
    
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      if (alert.ruleId === ruleId && alert.state === 'active') {
        alert.state = 'resolved';
        alert.resolvedAt = Date.now();
        clearedAlerts.push(alert);
        
        // Remove from active alerts
        this.activeAlerts.delete(alertId);
        
        // Notify resolution
        this.notifyResolution(alert);
      }
    }
    
    if (clearedAlerts.length > 0) {
      this.emit('alerts-resolved', clearedAlerts);
    }
  }

  /**
   * Send notifications for alert
   */
  async sendNotifications(alert, rule) {
    const channels = rule.notificationChannels || ['console', 'log'];
    
    for (const channelId of channels) {
      const channel = this.notificationChannels.get(channelId);
      
      if (!channel || !channel.enabled) continue;
      
      try {
        await channel.send(alert);
        
        channel.sentCount++;
        channel.lastSent = Date.now();
        alert.notifiedChannels.push(channelId);
        
      } catch (error) {
        await this.logger.error(`Failed to send notification to channel: ${channelId}`, { error });
      }
    }
  }

  /**
   * Notify alert resolution
   */
  async notifyResolution(alert) {
    const resolution = {
      ...alert,
      message: `Alert resolved: ${alert.name}`,
      duration: alert.resolvedAt - alert.timestamp
    };
    
    // Send to same channels that received the alert
    for (const channelId of alert.notifiedChannels) {
      const channel = this.notificationChannels.get(channelId);
      
      if (channel && channel.enabled) {
        try {
          await channel.send({
            ...resolution,
            type: 'resolution'
          });
        } catch (error) {
          await this.logger.error(`Failed to send resolution notification: ${channelId}`, { error });
        }
      }
    }
    
    this.emit('alert-resolved', resolution);
  }

  /**
   * Group alert
   */
  groupAlert(alert, rule) {
    const groupKey = rule.groupBy.map(field => alert.labels[field] || '').join(':');
    
    if (!this.alertGroups.has(groupKey)) {
      this.alertGroups.set(groupKey, {
        key: groupKey,
        alerts: [],
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        count: 0
      });
    }
    
    const group = this.alertGroups.get(groupKey);
    group.alerts.push(alert.id);
    group.lastSeen = Date.now();
    group.count++;
    
    // Keep only recent alerts in group
    if (group.alerts.length > 100) {
      group.alerts = group.alerts.slice(-50);
    }
  }

  /**
   * Check escalations
   */
  async checkEscalations() {
    for (const [alertId, alert] of this.activeAlerts.entries()) {
      const rule = this.alertRules.get(alert.ruleId);
      
      if (!rule || !rule.escalationPolicy) continue;
      
      const escalationPolicy = this.escalationPolicies.get(rule.escalationPolicy);
      if (!escalationPolicy) continue;
      
      const alertAge = Date.now() - alert.timestamp;
      const nextLevel = escalationPolicy.levels[alert.escalationLevel + 1];
      
      if (nextLevel && alertAge >= nextLevel.afterMinutes * 60000) {
        await this.escalateAlert(alert, nextLevel);
      }
    }
  }

  /**
   * Escalate alert
   */
  async escalateAlert(alert, escalationLevel) {
    alert.escalationLevel++;
    
    await this.logger.logStructured('warn', 'Alert escalated', {
      component: 'AlertEscalation',
      alertId: alert.id,
      escalationLevel: alert.escalationLevel
    });
    
    // Send escalation notifications
    if (escalationLevel.notificationChannels) {
      const rule = this.alertRules.get(alert.ruleId);
      await this.sendNotifications(alert, {
        ...rule,
        notificationChannels: escalationLevel.notificationChannels
      });
    }
    
    this.emit('alert-escalated', alert);
  }

  /**
   * Cleanup old alerts
   */
  cleanupAlerts() {
    const cutoff = Date.now() - 86400000; // 24 hours
    
    // Clean alert history
    this.alertHistory = this.alertHistory.filter(alert => alert.timestamp > cutoff);
    
    // Clean alert groups
    for (const [groupKey, group] of this.alertGroups.entries()) {
      if (group.lastSeen < cutoff) {
        this.alertGroups.delete(groupKey);
      }
    }
  }

  /**
   * Utility methods
   */
  isAlertSuppressed(ruleId) {
    return this.suppressedAlerts.has(ruleId);
  }

  isAlertInCooldown(ruleId) {
    const rule = this.alertRules.get(ruleId);
    if (!rule || !rule.lastAlertTime) return false;
    
    return (Date.now() - rule.lastAlertTime) < rule.cooldown;
  }

  extractAlertValue(rule, metrics) {
    try {
      // Try to extract the actual value that triggered the alert
      if (rule.id === 'high_cpu_usage' || rule.id === 'critical_cpu_usage') {
        return metrics.system?.cpu?.usage;
      } else if (rule.id === 'high_memory_usage') {
        return metrics.system?.memory?.usagePercent;
      } else if (rule.id === 'high_error_rate') {
        const errors = metrics.application?.requests?.errors || 0;
        const total = metrics.application?.requests?.total || 1;
        return (errors / total) * 100;
      }
      // Add more cases as needed
    } catch (error) {
      // Ignore extraction errors
    }
    
    return undefined;
  }

  /**
   * Suppress alerts for a rule
   */
  suppressAlerts(ruleId, duration = 3600000) {
    this.suppressedAlerts.add(ruleId);
    
    setTimeout(() => {
      this.suppressedAlerts.delete(ruleId);
    }, duration);
  }

  /**
   * Add escalation policy
   */
  addEscalationPolicy(policy) {
    this.escalationPolicies.set(policy.id, {
      id: policy.id,
      name: policy.name,
      levels: policy.levels || []
    });
  }

  /**
   * Get alert statistics
   */
  getAlertStatistics() {
    const stats = {
      total: this.alertHistory.length,
      active: this.activeAlerts.size,
      bySeverity: {
        critical: 0,
        warning: 0,
        info: 0
      },
      byCategory: {},
      recentAlerts: []
    };
    
    // Count by severity
    for (const alert of this.activeAlerts.values()) {
      stats.bySeverity[alert.severity]++;
    }
    
    // Count by category
    for (const alert of this.alertHistory) {
      const category = alert.labels.category || 'other';
      stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
    }
    
    // Recent alerts
    stats.recentAlerts = this.alertHistory
      .slice(-10)
      .sort((a, b) => b.timestamp - a.timestamp);
    
    return stats;
  }

  /**
   * Get alert report
   */
  getAlertReport() {
    return {
      timestamp: new Date().toISOString(),
      statistics: this.getAlertStatistics(),
      activeAlerts: Array.from(this.activeAlerts.values()),
      rules: Array.from(this.alertRules.values()).map(rule => ({
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        enabled: rule.enabled,
        lastAlertTime: rule.lastAlertTime
      })),
      channels: Array.from(this.notificationChannels.values()).map(channel => ({
        id: channel.id,
        name: channel.name,
        type: channel.type,
        enabled: channel.enabled,
        sentCount: channel.sentCount,
        lastSent: channel.lastSent
      })),
      suppressedRules: Array.from(this.suppressedAlerts)
    };
  }
}

module.exports = AlertManager;