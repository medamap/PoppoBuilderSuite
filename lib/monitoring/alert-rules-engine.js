/**
 * Alert Rules Engine
 * 
 * Advanced alert rules management and evaluation system
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class AlertRulesEngine extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      rulesFile: options.rulesFile || 'config/alert-rules.json',
      evaluationInterval: options.evaluationInterval || 30000, // 30 seconds
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 5000,
      ...options
    };

    this.rules = new Map();
    this.ruleStates = new Map();
    this.evaluationHistory = new Map();
    this.isRunning = false;
    this.evaluationInterval = null;
    
    // Rule evaluation functions
    this.evaluators = new Map([
      ['threshold', this.evaluateThreshold.bind(this)],
      ['rate', this.evaluateRate.bind(this)],
      ['anomaly', this.evaluateAnomaly.bind(this)],
      ['compound', this.evaluateCompound.bind(this)],
      ['time_window', this.evaluateTimeWindow.bind(this)]
    ]);
  }

  /**
   * Start the alert rules engine
   */
  async start() {
    if (this.isRunning) {
      return;
    }

    console.log('Starting Alert Rules Engine...');
    
    try {
      await this.loadRules();
      this.startEvaluation();
      this.isRunning = true;
      this.emit('started');
      console.log('Alert Rules Engine started successfully');
    } catch (error) {
      console.error('Failed to start Alert Rules Engine:', error);
      throw error;
    }
  }

  /**
   * Stop the alert rules engine
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    console.log('Stopping Alert Rules Engine...');
    
    if (this.evaluationInterval) {
      clearInterval(this.evaluationInterval);
      this.evaluationInterval = null;
    }

    this.isRunning = false;
    this.emit('stopped');
    console.log('Alert Rules Engine stopped');
  }

  /**
   * Load alert rules from configuration
   */
  async loadRules() {
    try {
      const rulesPath = path.resolve(this.options.rulesFile);
      const rulesData = await fs.readFile(rulesPath, 'utf8');
      const rulesConfig = JSON.parse(rulesData);

      this.rules.clear();
      this.ruleStates.clear();

      for (const rule of rulesConfig.rules) {
        this.addRule(rule);
      }

      console.log(`Loaded ${this.rules.size} alert rules`);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.log('No rules file found, creating default rules');
        await this.createDefaultRules();
      } else {
        throw error;
      }
    }
  }

  /**
   * Create default alert rules
   */
  async createDefaultRules() {
    const defaultRules = {
      rules: [
        {
          id: 'high_cpu_usage',
          name: 'High CPU Usage',
          description: 'Alert when CPU usage exceeds threshold',
          type: 'threshold',
          metric: 'poppobuilder_cpu_usage_percent',
          condition: {
            operator: '>',
            value: 80,
            duration: 300 // 5 minutes
          },
          severity: 'warning',
          enabled: true,
          labels: {
            component: 'system',
            category: 'resource'
          }
        },
        {
          id: 'high_memory_usage',
          name: 'High Memory Usage',
          description: 'Alert when memory usage exceeds threshold',
          type: 'threshold',
          metric: 'poppobuilder_memory_usage_percent',
          condition: {
            operator: '>',
            value: 85,
            duration: 300
          },
          severity: 'warning',
          enabled: true,
          labels: {
            component: 'system',
            category: 'resource'
          }
        },
        {
          id: 'service_down',
          name: 'Service Down',
          description: 'Alert when a service becomes unhealthy',
          type: 'threshold',
          metric: 'poppobuilder_service_health',
          condition: {
            operator: '==',
            value: 0,
            duration: 60
          },
          severity: 'critical',
          enabled: true,
          labels: {
            component: 'service',
            category: 'availability'
          }
        },
        {
          id: 'high_error_rate',
          name: 'High Error Rate',
          description: 'Alert when error rate exceeds threshold',
          type: 'rate',
          metric: 'poppobuilder_errors_total',
          condition: {
            rate_interval: 300,
            threshold: 0.05, // 5%
            comparison_metric: 'poppobuilder_http_requests_total'
          },
          severity: 'critical',
          enabled: true,
          labels: {
            component: 'application',
            category: 'error'
          }
        },
        {
          id: 'slow_response_time',
          name: 'Slow Response Time',
          description: 'Alert when response time is consistently slow',
          type: 'time_window',
          metric: 'poppobuilder_http_duration_seconds',
          condition: {
            aggregation: 'avg',
            window: 600, // 10 minutes
            threshold: 5.0 // 5 seconds
          },
          severity: 'warning',
          enabled: true,
          labels: {
            component: 'application',
            category: 'performance'
          }
        },
        {
          id: 'github_rate_limit_low',
          name: 'GitHub Rate Limit Low',
          description: 'Alert when GitHub rate limit is running low',
          type: 'threshold',
          metric: 'poppobuilder_github_rate_limit_remaining',
          condition: {
            operator: '<',
            value: 100,
            duration: 60
          },
          severity: 'warning',
          enabled: true,
          labels: {
            component: 'github',
            category: 'rate_limit'
          }
        },
        {
          id: 'large_task_queue',
          name: 'Large Task Queue',
          description: 'Alert when task queue becomes too large',
          type: 'threshold',
          metric: 'poppobuilder_task_queue_size',
          condition: {
            operator: '>',
            value: 1000,
            duration: 300
          },
          severity: 'warning',
          enabled: true,
          labels: {
            component: 'queue',
            category: 'capacity'
          }
        }
      ]
    };

    // Save default rules
    const rulesPath = path.resolve(this.options.rulesFile);
    await fs.mkdir(path.dirname(rulesPath), { recursive: true });
    await fs.writeFile(rulesPath, JSON.stringify(defaultRules, null, 2));

    // Load the default rules
    for (const rule of defaultRules.rules) {
      this.addRule(rule);
    }

    console.log('Created and loaded default alert rules');
  }

  /**
   * Add a rule to the engine
   */
  addRule(rule) {
    // Validate rule
    this.validateRule(rule);

    this.rules.set(rule.id, rule);
    this.ruleStates.set(rule.id, {
      lastEvaluation: null,
      lastTriggered: null,
      consecutiveFailures: 0,
      isActive: false,
      history: []
    });

    console.log(`Added alert rule: ${rule.id} (${rule.name})`);
  }

  /**
   * Remove a rule from the engine
   */
  removeRule(ruleId) {
    this.rules.delete(ruleId);
    this.ruleStates.delete(ruleId);
    this.evaluationHistory.delete(ruleId);
    console.log(`Removed alert rule: ${ruleId}`);
  }

  /**
   * Update a rule
   */
  updateRule(ruleId, updates) {
    const rule = this.rules.get(ruleId);
    if (!rule) {
      throw new Error(`Rule not found: ${ruleId}`);
    }

    const updatedRule = { ...rule, ...updates };
    this.validateRule(updatedRule);
    
    this.rules.set(ruleId, updatedRule);
    console.log(`Updated alert rule: ${ruleId}`);
  }

  /**
   * Validate rule structure
   */
  validateRule(rule) {
    if (!rule.id || !rule.name || !rule.type || !rule.metric) {
      throw new Error('Rule must have id, name, type, and metric properties');
    }

    if (!this.evaluators.has(rule.type)) {
      throw new Error(`Unknown rule type: ${rule.type}`);
    }

    if (!rule.condition) {
      throw new Error('Rule must have condition property');
    }

    if (!rule.severity || !['info', 'warning', 'critical'].includes(rule.severity)) {
      throw new Error('Rule must have valid severity (info, warning, critical)');
    }
  }

  /**
   * Start rule evaluation loop
   */
  startEvaluation() {
    this.evaluationInterval = setInterval(async () => {
      try {
        await this.evaluateAllRules();
      } catch (error) {
        console.error('Error during rule evaluation:', error);
      }
    }, this.options.evaluationInterval);
  }

  /**
   * Evaluate all enabled rules
   */
  async evaluateAllRules() {
    const enabledRules = Array.from(this.rules.values()).filter(rule => rule.enabled);
    
    for (const rule of enabledRules) {
      try {
        await this.evaluateRule(rule);
      } catch (error) {
        console.error(`Error evaluating rule ${rule.id}:`, error);
        this.recordRuleError(rule.id, error);
      }
    }
  }

  /**
   * Evaluate a single rule
   */
  async evaluateRule(rule) {
    const evaluator = this.evaluators.get(rule.type);
    if (!evaluator) {
      throw new Error(`No evaluator for rule type: ${rule.type}`);
    }

    const state = this.ruleStates.get(rule.id);
    const now = Date.now();

    try {
      const result = await evaluator(rule, state);
      
      state.lastEvaluation = now;
      state.consecutiveFailures = 0;
      
      // Add to history
      state.history.push({
        timestamp: now,
        result: result.triggered,
        value: result.value,
        threshold: result.threshold
      });

      // Keep only last 100 evaluations
      if (state.history.length > 100) {
        state.history = state.history.slice(-100);
      }

      // Check if alert should be triggered
      if (result.triggered && !state.isActive) {
        await this.triggerAlert(rule, result);
        state.isActive = true;
        state.lastTriggered = now;
      } else if (!result.triggered && state.isActive) {
        await this.resolveAlert(rule, result);
        state.isActive = false;
      }

    } catch (error) {
      state.consecutiveFailures++;
      throw error;
    }
  }

  /**
   * Threshold-based rule evaluation
   */
  async evaluateThreshold(rule, state) {
    const { operator, value, duration } = rule.condition;
    const metricValue = await this.getMetricValue(rule.metric, rule.labels);
    
    if (metricValue === null) {
      throw new Error(`Metric not found: ${rule.metric}`);
    }

    let triggered = false;
    
    switch (operator) {
      case '>':
        triggered = metricValue > value;
        break;
      case '>=':
        triggered = metricValue >= value;
        break;
      case '<':
        triggered = metricValue < value;
        break;
      case '<=':
        triggered = metricValue <= value;
        break;
      case '==':
        triggered = metricValue === value;
        break;
      case '!=':
        triggered = metricValue !== value;
        break;
      default:
        throw new Error(`Unknown operator: ${operator}`);
    }

    // Check duration if specified
    if (triggered && duration) {
      const durationMs = duration * 1000;
      const now = Date.now();
      
      // Find first triggered evaluation within duration window
      const firstTriggered = state.history
        .slice()
        .reverse()
        .find(h => h.timestamp >= now - durationMs && !h.result);
      
      if (firstTriggered && (now - firstTriggered.timestamp) < durationMs) {
        triggered = false; // Not triggered long enough
      }
    }

    return {
      triggered,
      value: metricValue,
      threshold: value,
      operator,
      duration
    };
  }

  /**
   * Rate-based rule evaluation
   */
  async evaluateRate(rule, state) {
    const { rate_interval, threshold, comparison_metric } = rule.condition;
    
    const metric1Rate = await this.getMetricRate(rule.metric, rate_interval);
    const metric2Rate = comparison_metric ? 
      await this.getMetricRate(comparison_metric, rate_interval) : 1;
    
    const rate = metric2Rate > 0 ? metric1Rate / metric2Rate : 0;
    const triggered = rate > threshold;

    return {
      triggered,
      value: rate,
      threshold,
      rate_interval
    };
  }

  /**
   * Anomaly detection rule evaluation
   */
  async evaluateAnomaly(rule, state) {
    const { window, sensitivity = 2 } = rule.condition;
    const values = await this.getMetricHistory(rule.metric, window);
    
    if (values.length < 10) {
      return { triggered: false, value: null, reason: 'Insufficient data' };
    }

    const current = values[values.length - 1];
    const historical = values.slice(0, -1);
    
    const mean = historical.reduce((a, b) => a + b, 0) / historical.length;
    const variance = historical.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / historical.length;
    const stdDev = Math.sqrt(variance);
    
    const threshold = mean + (sensitivity * stdDev);
    const triggered = current > threshold;

    return {
      triggered,
      value: current,
      threshold,
      mean,
      stdDev,
      sensitivity
    };
  }

  /**
   * Compound rule evaluation (multiple conditions)
   */
  async evaluateCompound(rule, state) {
    const { conditions, operator = 'AND' } = rule.condition;
    const results = [];

    for (const condition of conditions) {
      const subRule = { ...rule, condition };
      const evaluator = this.evaluators.get(condition.type || 'threshold');
      const result = await evaluator(subRule, state);
      results.push(result);
    }

    let triggered;
    if (operator === 'AND') {
      triggered = results.every(r => r.triggered);
    } else if (operator === 'OR') {
      triggered = results.some(r => r.triggered);
    } else {
      throw new Error(`Unknown compound operator: ${operator}`);
    }

    return {
      triggered,
      value: results.map(r => r.value),
      results,
      operator
    };
  }

  /**
   * Time window aggregation rule evaluation
   */
  async evaluateTimeWindow(rule, state) {
    const { aggregation, window, threshold } = rule.condition;
    const values = await this.getMetricHistory(rule.metric, window);
    
    if (values.length === 0) {
      return { triggered: false, value: null, reason: 'No data' };
    }

    let aggregatedValue;
    switch (aggregation) {
      case 'avg':
        aggregatedValue = values.reduce((a, b) => a + b, 0) / values.length;
        break;
      case 'max':
        aggregatedValue = Math.max(...values);
        break;
      case 'min':
        aggregatedValue = Math.min(...values);
        break;
      case 'sum':
        aggregatedValue = values.reduce((a, b) => a + b, 0);
        break;
      default:
        throw new Error(`Unknown aggregation: ${aggregation}`);
    }

    const triggered = aggregatedValue > threshold;

    return {
      triggered,
      value: aggregatedValue,
      threshold,
      aggregation,
      window,
      dataPoints: values.length
    };
  }

  /**
   * Get current metric value
   */
  async getMetricValue(metricName, labels = {}) {
    // This would integrate with your metrics system
    // For now, return a mock value
    return Math.random() * 100;
  }

  /**
   * Get metric rate over time interval
   */
  async getMetricRate(metricName, intervalSeconds) {
    // This would calculate the rate of change for the metric
    // For now, return a mock value
    return Math.random() * 10;
  }

  /**
   * Get metric history over time window
   */
  async getMetricHistory(metricName, windowSeconds) {
    // This would return historical values for the metric
    // For now, return mock data
    const values = [];
    for (let i = 0; i < 20; i++) {
      values.push(Math.random() * 100);
    }
    return values;
  }

  /**
   * Trigger an alert
   */
  async triggerAlert(rule, result) {
    const alert = {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      description: rule.description,
      metric: rule.metric,
      condition: rule.condition,
      result,
      labels: rule.labels || {},
      timestamp: new Date().toISOString(),
      hostname: require('os').hostname()
    };

    console.log(`🚨 Alert triggered: ${rule.name} (${rule.severity})`);
    console.log(`   Value: ${result.value}, Threshold: ${result.threshold}`);

    this.emit('alert', alert);
  }

  /**
   * Resolve an alert
   */
  async resolveAlert(rule, result) {
    const resolution = {
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      metric: rule.metric,
      result,
      timestamp: new Date().toISOString(),
      hostname: require('os').hostname()
    };

    console.log(`✅ Alert resolved: ${rule.name}`);
    
    this.emit('alert_resolved', resolution);
  }

  /**
   * Record rule evaluation error
   */
  recordRuleError(ruleId, error) {
    const state = this.ruleStates.get(ruleId);
    if (state) {
      state.lastError = {
        message: error.message,
        timestamp: Date.now()
      };
    }

    this.emit('rule_error', { ruleId, error: error.message });
  }

  /**
   * Get rule status
   */
  getRuleStatus(ruleId) {
    const rule = this.rules.get(ruleId);
    const state = this.ruleStates.get(ruleId);
    
    if (!rule || !state) {
      return null;
    }

    return {
      rule,
      state: {
        ...state,
        history: state.history.slice(-10) // Last 10 evaluations
      }
    };
  }

  /**
   * Get all rules status
   */
  getAllRulesStatus() {
    const status = {};
    
    for (const [ruleId, rule] of this.rules) {
      status[ruleId] = this.getRuleStatus(ruleId);
    }

    return status;
  }

  /**
   * Get active alerts
   */
  getActiveAlerts() {
    const activeAlerts = [];
    
    for (const [ruleId, state] of this.ruleStates) {
      if (state.isActive) {
        const rule = this.rules.get(ruleId);
        activeAlerts.push({
          ruleId,
          ruleName: rule.name,
          severity: rule.severity,
          lastTriggered: state.lastTriggered,
          description: rule.description
        });
      }
    }

    return activeAlerts;
  }
}

module.exports = AlertRulesEngine;