/**
 * Issue #136: Scalability Management System
 * 
 * Central coordinator for all scalability features:
 * - Load testing orchestration
 * - Capacity planning integration
 * - Auto-scaling management
 * - Performance optimization
 * - Scalability metrics and reporting
 */

const EventEmitter = require('events');
const LoadTester = require('./load-tester');
const CapacityPlanner = require('./capacity-planner');
const AutoScaler = require('./auto-scaler');
const ProductionLogger = require('../utils/production-logger');

class ScalabilityManager extends EventEmitter {
  constructor(performanceMonitor, options = {}) {
    super();
    
    this.performanceMonitor = performanceMonitor;
    
    this.options = {
      enabled: options.enabled !== false,
      autoScalingEnabled: options.autoScalingEnabled !== false,
      loadTestingEnabled: options.loadTestingEnabled !== false,
      capacityPlanningEnabled: options.capacityPlanningEnabled !== false,
      reportingInterval: options.reportingInterval || 300000, // 5 minutes
      ...options
    };
    
    this.logger = new ProductionLogger('ScalabilityManager', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true
    });
    
    this.isRunning = false;
    this.reportingTimer = null;
    
    // Initialize components
    this.loadTester = new LoadTester(options.loadTesting || {});
    this.capacityPlanner = new CapacityPlanner(options.capacityPlanning || {});
    this.autoScaler = new AutoScaler(
      this.capacityPlanner, 
      this.performanceMonitor, 
      options.autoScaling || {}
    );
    
    // Scalability metrics
    this.scalabilityMetrics = {
      testResults: [],
      capacityAnalyses: [],
      scalingEvents: [],
      performanceBaselines: new Map(),
      thresholdBreaches: []
    };
    
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers between components
   */
  setupEventHandlers() {
    // Load tester events
    this.loadTester.on('test-completed', (result) => {
      this.handleLoadTestCompleted(result);
    });
    
    this.loadTester.on('metrics-updated', (metrics) => {
      this.handleLoadTestMetrics(metrics);
    });
    
    // Auto-scaler events
    this.autoScaler.on('scaling-executed', (event) => {
      this.handleScalingEvent(event);
    });
    
    // Performance monitor events
    if (this.performanceMonitor) {
      this.performanceMonitor.on('performance-alert', (alert) => {
        this.handlePerformanceAlert(alert);
      });
      
      this.performanceMonitor.on('metrics-updated', (metrics) => {
        this.handlePerformanceMetrics(metrics);
      });
    }
  }

  /**
   * Start scalability management
   */
  async start() {
    if (this.isRunning || !this.options.enabled) return;
    
    try {
      await this.logger.info('Starting Scalability Manager');
      
      this.isRunning = true;
      
      // Start auto-scaling if enabled
      if (this.options.autoScalingEnabled) {
        await this.autoScaler.start();
      }
      
      // Initialize performance baselines
      await this.initializeBaselines();
      
      // Start reporting
      this.startReporting();
      
      await this.logger.info('Scalability Manager started successfully');
      
    } catch (error) {
      await this.logger.error('Failed to start Scalability Manager', { error });
      throw error;
    }
  }

  /**
   * Stop scalability management
   */
  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    // Stop auto-scaler
    await this.autoScaler.stop();
    
    // Stop any running load tests
    if (this.loadTester.getTestStatus().isRunning) {
      await this.loadTester.stopLoadTest();
    }
    
    // Stop reporting
    if (this.reportingTimer) {
      clearInterval(this.reportingTimer);
      this.reportingTimer = null;
    }
    
    await this.logger.info('Scalability Manager stopped');
  }

  /**
   * Initialize performance baselines
   */
  async initializeBaselines() {
    try {
      if (!this.performanceMonitor) return;
      
      const report = this.performanceMonitor.getPerformanceReport();
      const baseline = {
        timestamp: Date.now(),
        metrics: {
          cpu: report.currentMetrics?.cpu?.percentage || 0,
          memory: report.currentMetrics?.memory?.heapUsagePercent || 0,
          responseTime: this.calculateAverageResponseTime(report),
          throughput: this.calculateThroughput(report),
          errorRate: this.calculateErrorRate(report)
        },
        resourceUsage: report.resourceUsage || {}
      };
      
      this.scalabilityMetrics.performanceBaselines.set('initial', baseline);
      
      await this.logger.logStructured('info', 'Performance baseline established', {
        component: 'BaselineInitialization',
        baseline
      });
      
    } catch (error) {
      await this.logger.error('Failed to initialize baselines', { error });
    }
  }

  /**
   * Start reporting
   */
  startReporting() {
    this.reportingTimer = setInterval(async () => {
      try {
        await this.generateScalabilityReport();
      } catch (error) {
        await this.logger.error('Scalability reporting failed', { error });
      }
    }, this.options.reportingInterval);
  }

  /**
   * Run load test
   */
  async runLoadTest(testType = 'load', customScenario = null) {
    if (!this.options.loadTestingEnabled) {
      throw new Error('Load testing is not enabled');
    }
    
    try {
      await this.logger.info(`Starting load test: ${testType}`);
      
      const result = await this.loadTester.startLoadTest(testType, customScenario);
      
      // Analyze results and update capacity planning
      await this.analyzeLoadTestResults(result);
      
      return result;
      
    } catch (error) {
      await this.logger.error('Load test failed', { error, testType });
      throw error;
    }
  }

  /**
   * Analyze capacity requirements
   */
  async analyzeCapacity() {
    if (!this.options.capacityPlanningEnabled) {
      throw new Error('Capacity planning is not enabled');
    }
    
    try {
      const performanceData = this.getPerformanceHistory();
      const analysis = await this.capacityPlanner.analyzeCurrentCapacity(performanceData);
      
      this.scalabilityMetrics.capacityAnalyses.push({
        timestamp: Date.now(),
        analysis
      });
      
      // Keep only recent analyses
      if (this.scalabilityMetrics.capacityAnalyses.length > 50) {
        this.scalabilityMetrics.capacityAnalyses = this.scalabilityMetrics.capacityAnalyses.slice(-25);
      }
      
      this.emit('capacity-analyzed', analysis);
      
      return analysis;
      
    } catch (error) {
      await this.logger.error('Capacity analysis failed', { error });
      throw error;
    }
  }

  /**
   * Get performance history for capacity planning
   */
  getPerformanceHistory() {
    if (!this.performanceMonitor) return [];
    
    const report = this.performanceMonitor.getPerformanceReport();
    const history = [];
    
    // Convert performance metrics to format expected by capacity planner
    const metrics = report.currentMetrics || {};
    const resourceUsage = report.resourceUsage || {};
    
    // Create historical data points (in real implementation, this would come from persistent storage)
    for (let i = 0; i < 60; i++) {
      history.push({
        timestamp: Date.now() - (i * 60000), // 1 minute intervals
        cpu: (metrics.cpu?.percentage || 0) + (Math.random() - 0.5) * 10,
        memory: (metrics.memory?.heapUsagePercent || 0) + (Math.random() - 0.5) * 10,
        throughput: this.calculateThroughput(report) + (Math.random() - 0.5) * 100,
        responseTime: this.calculateAverageResponseTime(report) + (Math.random() - 0.5) * 50
      });
    }
    
    return history.reverse(); // Oldest first
  }

  /**
   * Handle load test completion
   */
  async handleLoadTestCompleted(result) {
    this.scalabilityMetrics.testResults.push({
      timestamp: Date.now(),
      result
    });
    
    // Keep only recent test results
    if (this.scalabilityMetrics.testResults.length > 20) {
      this.scalabilityMetrics.testResults = this.scalabilityMetrics.testResults.slice(-10);
    }
    
    await this.logger.logStructured('info', 'Load test completed', {
      component: 'LoadTestHandler',
      summary: result.summary,
      recommendations: result.recommendations?.length || 0
    });
    
    this.emit('load-test-completed', result);
  }

  /**
   * Handle load test metrics
   */
  handleLoadTestMetrics(metrics) {
    // Update real-time metrics
    this.emit('load-test-metrics', metrics);
  }

  /**
   * Handle scaling events
   */
  async handleScalingEvent(event) {
    this.scalabilityMetrics.scalingEvents.push({
      timestamp: Date.now(),
      ...event
    });
    
    // Keep only recent scaling events
    if (this.scalabilityMetrics.scalingEvents.length > 100) {
      this.scalabilityMetrics.scalingEvents = this.scalabilityMetrics.scalingEvents.slice(-50);
    }
    
    await this.logger.logStructured('info', 'Scaling event recorded', {
      component: 'ScalingEventHandler',
      event
    });
    
    this.emit('scaling-event', event);
  }

  /**
   * Handle performance alerts
   */
  async handlePerformanceAlert(alert) {
    this.scalabilityMetrics.thresholdBreaches.push({
      timestamp: Date.now(),
      alert
    });
    
    // Trigger emergency scaling if needed
    if (alert.severity === 'critical' && this.options.autoScalingEnabled) {
      await this.triggerEmergencyScaling(alert);
    }
    
    this.emit('performance-alert', alert);
  }

  /**
   * Handle performance metrics updates
   */
  handlePerformanceMetrics(metrics) {
    // Update baselines if significant change detected
    this.updateBaselinesIfNeeded(metrics);
    
    this.emit('performance-metrics', metrics);
  }

  /**
   * Trigger emergency scaling
   */
  async triggerEmergencyScaling(alert) {
    try {
      await this.logger.logStructured('warn', 'Triggering emergency scaling', {
        component: 'EmergencyScaling',
        alert
      });
      
      // This would trigger immediate scaling based on the alert type
      // Implementation depends on the specific infrastructure
      
    } catch (error) {
      await this.logger.error('Emergency scaling failed', { error, alert });
    }
  }

  /**
   * Update performance baselines
   */
  updateBaselinesIfNeeded(metrics) {
    const lastBaseline = this.scalabilityMetrics.performanceBaselines.get('current');
    const now = Date.now();
    
    // Update baseline every hour or if significant change detected
    if (!lastBaseline || (now - lastBaseline.timestamp) > 3600000) {
      const newBaseline = {
        timestamp: now,
        metrics: {
          cpu: metrics.cpu?.percentage || 0,
          memory: metrics.memory?.heapUsagePercent || 0,
          eventLoop: metrics.eventLoop?.lagMS || 0
        }
      };
      
      this.scalabilityMetrics.performanceBaselines.set('current', newBaseline);
    }
  }

  /**
   * Analyze load test results
   */
  async analyzeLoadTestResults(result) {
    try {
      // Extract key insights from load test
      const insights = {
        maxSupportedUsers: result.summary.maxConcurrentUsers,
        peakThroughput: result.throughputAnalysis.peakThroughput,
        responseTimeThreshold: result.responseTimeStats.percentiles.p95,
        errorRateThreshold: result.summary.errorRate,
        bottlenecks: result.scalabilityMetrics.bottleneckIndicators
      };
      
      // Update capacity planning with test results
      if (this.options.capacityPlanningEnabled) {
        // This would feed results into capacity planner
        await this.logger.logStructured('info', 'Load test insights extracted', {
          component: 'LoadTestAnalysis',
          insights
        });
      }
      
      // Trigger capacity analysis if critical issues found
      if (result.summary.errorRate > 5 || result.recommendations.some(r => r.severity === 'high')) {
        await this.analyzeCapacity();
      }
      
    } catch (error) {
      await this.logger.error('Load test result analysis failed', { error });
    }
  }

  /**
   * Generate comprehensive scalability report
   */
  async generateScalabilityReport() {
    try {
      const report = {
        timestamp: new Date().toISOString(),
        overview: {
          scalabilityManagerStatus: this.isRunning,
          autoScalingEnabled: this.options.autoScalingEnabled,
          loadTestingEnabled: this.options.loadTestingEnabled,
          capacityPlanningEnabled: this.options.capacityPlanningEnabled
        },
        currentPerformance: this.getCurrentPerformanceSnapshot(),
        scalabilityMetrics: this.getScalabilityMetricsSummary(),
        autoScalingStatus: this.autoScaler.getScalingStatus(),
        loadTestStatus: this.loadTester.getTestStatus(),
        capacityPlanningStatus: this.capacityPlanner.getCapacityReport(),
        recommendations: await this.generateScalabilityRecommendations(),
        trends: this.analyzeTrends()
      };
      
      await this.logger.logStructured('info', 'Scalability report generated', {
        component: 'ScalabilityReporting',
        reportSize: JSON.stringify(report).length,
        recommendations: report.recommendations.length
      });
      
      this.emit('scalability-report', report);
      
      return report;
      
    } catch (error) {
      await this.logger.error('Scalability report generation failed', { error });
      throw error;
    }
  }

  /**
   * Get current performance snapshot
   */
  getCurrentPerformanceSnapshot() {
    if (!this.performanceMonitor) return null;
    
    const report = this.performanceMonitor.getPerformanceReport();
    
    return {
      timestamp: Date.now(),
      cpu: report.currentMetrics?.cpu?.percentage || 0,
      memory: report.currentMetrics?.memory?.heapUsagePercent || 0,
      responseTime: this.calculateAverageResponseTime(report),
      throughput: this.calculateThroughput(report),
      errorRate: this.calculateErrorRate(report),
      activeOperations: report.activeOperations || 0
    };
  }

  /**
   * Get scalability metrics summary
   */
  getScalabilityMetricsSummary() {
    return {
      totalLoadTests: this.scalabilityMetrics.testResults.length,
      totalCapacityAnalyses: this.scalabilityMetrics.capacityAnalyses.length,
      totalScalingEvents: this.scalabilityMetrics.scalingEvents.length,
      thresholdBreaches: this.scalabilityMetrics.thresholdBreaches.length,
      recentLoadTestResults: this.scalabilityMetrics.testResults.slice(-3),
      recentScalingEvents: this.scalabilityMetrics.scalingEvents.slice(-5)
    };
  }

  /**
   * Generate scalability recommendations
   */
  async generateScalabilityRecommendations() {
    const recommendations = [];
    
    // Performance-based recommendations
    const currentPerformance = this.getCurrentPerformanceSnapshot();
    if (currentPerformance) {
      if (currentPerformance.cpu > 80) {
        recommendations.push({
          type: 'performance',
          priority: 'high',
          title: 'High CPU Usage Detected',
          description: `CPU usage at ${currentPerformance.cpu.toFixed(1)}%`,
          action: 'Consider CPU scaling or optimization',
          impact: 'May cause performance degradation'
        });
      }
      
      if (currentPerformance.responseTime > 1000) {
        recommendations.push({
          type: 'performance',
          priority: 'medium',
          title: 'High Response Times',
          description: `Average response time: ${currentPerformance.responseTime.toFixed(1)}ms`,
          action: 'Investigate performance bottlenecks',
          impact: 'Poor user experience'
        });
      }
    }
    
    // Load test recommendations
    const recentTests = this.scalabilityMetrics.testResults.slice(-1);
    if (recentTests.length > 0) {
      const latestTest = recentTests[0];
      recommendations.push(...latestTest.result.recommendations.map(rec => ({
        type: 'load_test',
        priority: rec.severity === 'high' ? 'high' : 'medium',
        title: rec.message,
        action: rec.action,
        source: 'load_test_analysis'
      })));
    }
    
    // Capacity planning recommendations
    const recentAnalyses = this.scalabilityMetrics.capacityAnalyses.slice(-1);
    if (recentAnalyses.length > 0) {
      const latestAnalysis = recentAnalyses[0];
      const costRecs = latestAnalysis.analysis.costAnalysis?.recommendations || [];
      recommendations.push(...costRecs.map(rec => ({
        type: 'cost_optimization',
        priority: 'low',
        title: `Cost Optimization: ${rec.type}`,
        description: rec.action,
        estimatedSavings: rec.estimatedSavings,
        source: 'capacity_planning'
      })));
    }
    
    // Scaling recommendations
    const scalingStats = this.autoScaler.getScalingStatistics();
    if (scalingStats.successRate < 90) {
      recommendations.push({
        type: 'scaling',
        priority: 'medium',
        title: 'Auto-scaling Reliability Issue',
        description: `Scaling success rate: ${scalingStats.successRate.toFixed(1)}%`,
        action: 'Review scaling policies and thresholds',
        impact: 'Reduced scaling effectiveness'
      });
    }
    
    return recommendations.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Analyze trends
   */
  analyzeTrends() {
    const trends = {
      performance: this.analyzePerformanceTrends(),
      scaling: this.analyzeScalingTrends(),
      capacity: this.analyzeCapacityTrends()
    };
    
    return trends;
  }

  /**
   * Analyze performance trends
   */
  analyzePerformanceTrends() {
    const baselines = Array.from(this.scalabilityMetrics.performanceBaselines.values());
    if (baselines.length < 2) return null;
    
    const latest = baselines[baselines.length - 1];
    const previous = baselines[baselines.length - 2];
    
    return {
      cpu: this.calculateTrendDirection(previous.metrics.cpu, latest.metrics.cpu),
      memory: this.calculateTrendDirection(previous.metrics.memory, latest.metrics.memory),
      period: latest.timestamp - previous.timestamp
    };
  }

  /**
   * Analyze scaling trends
   */
  analyzeScalingTrends() {
    const recentEvents = this.scalabilityMetrics.scalingEvents.slice(-20);
    const scaleUps = recentEvents.filter(e => e.decision?.action.includes('scale_up')).length;
    const scaleDowns = recentEvents.filter(e => e.decision?.action.includes('scale_down')).length;
    
    return {
      totalEvents: recentEvents.length,
      scaleUpEvents: scaleUps,
      scaleDownEvents: scaleDowns,
      trend: scaleUps > scaleDowns ? 'scaling_up' : scaleDowns > scaleUps ? 'scaling_down' : 'stable'
    };
  }

  /**
   * Analyze capacity trends
   */
  analyzeCapacityTrends() {
    const analyses = this.scalabilityMetrics.capacityAnalyses.slice(-5);
    if (analyses.length < 2) return null;
    
    // Calculate trend in resource utilization
    const latest = analyses[analyses.length - 1];
    const previous = analyses[0];
    
    const cpuTrend = this.calculateTrendDirection(
      previous.analysis.currentUtilization.cpu,
      latest.analysis.currentUtilization.cpu
    );
    
    return {
      resourceUtilization: {
        cpu: cpuTrend,
        memory: this.calculateTrendDirection(
          previous.analysis.currentUtilization.memory,
          latest.analysis.currentUtilization.memory
        )
      },
      analysisCount: analyses.length
    };
  }

  /**
   * Calculate trend direction
   */
  calculateTrendDirection(oldValue, newValue) {
    if (!oldValue || !newValue) return 'unknown';
    
    const change = ((newValue - oldValue) / oldValue) * 100;
    
    if (change > 10) return 'increasing';
    if (change < -10) return 'decreasing';
    return 'stable';
  }

  /**
   * Utility functions
   */
  calculateAverageResponseTime(report) {
    const operationStats = report.operationStats || {};
    const avgTimes = Object.values(operationStats).map(stats => stats.avgDuration || 0);
    
    return avgTimes.length > 0 ? avgTimes.reduce((sum, time) => sum + time, 0) / avgTimes.length : 0;
  }

  calculateThroughput(report) {
    const operationStats = report.operationStats || {};
    const totalRequests = Object.values(operationStats).reduce((sum, stats) => sum + (stats.count || 0), 0);
    
    return totalRequests * 6; // Rough conversion to requests per minute
  }

  calculateErrorRate(report) {
    const operationStats = report.operationStats || {};
    const errorRates = Object.values(operationStats).map(stats => stats.errorRate || 0);
    
    return errorRates.length > 0 ? errorRates.reduce((sum, rate) => sum + rate, 0) / errorRates.length : 0;
  }

  /**
   * Get comprehensive scalability status
   */
  getScalabilityStatus() {
    return {
      isRunning: this.isRunning,
      components: {
        loadTester: this.loadTester.getTestStatus(),
        autoScaler: this.autoScaler.getScalingStatus(),
        capacityPlanner: this.capacityPlanner.getCapacityReport()
      },
      metrics: this.getScalabilityMetricsSummary(),
      performance: this.getCurrentPerformanceSnapshot(),
      options: this.options
    };
  }
}

module.exports = ScalabilityManager;