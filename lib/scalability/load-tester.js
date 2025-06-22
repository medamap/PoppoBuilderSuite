/**
 * Issue #136: Load Testing Framework
 * 
 * Comprehensive load testing system with:
 * - Concurrent request simulation
 * - Stress testing
 * - Capacity planning
 * - Performance bottleneck identification
 * - Load pattern simulation
 * - Resource exhaustion testing
 */

const EventEmitter = require('events');
const ProductionLogger = require('../utils/production-logger');

class LoadTester extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxConcurrentUsers: options.maxConcurrentUsers || 100,
      maxDuration: options.maxDuration || 300000, // 5 minutes
      rampUpTime: options.rampUpTime || 30000, // 30 seconds
      rampDownTime: options.rampDownTime || 15000, // 15 seconds
      testTypes: options.testTypes || ['load', 'stress', 'spike', 'endurance'],
      reportingInterval: options.reportingInterval || 5000, // 5 seconds
      ...options
    };
    
    this.logger = new ProductionLogger('LoadTester', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true
    });
    
    this.isRunning = false;
    this.currentTest = null;
    this.testResults = new Map();
    this.activeWorkers = new Map();
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimeSum: 0,
      responseTimes: [],
      concurrentUsers: 0,
      throughputHistory: [],
      errorHistory: []
    };
    
    this.testScenarios = new Map();
    this.initializeTestScenarios();
  }

  /**
   * Initialize predefined test scenarios
   */
  initializeTestScenarios() {
    // Load test scenario
    this.testScenarios.set('load', {
      name: 'Load Test',
      description: 'Test normal expected load',
      userCount: Math.min(50, this.options.maxConcurrentUsers),
      duration: 120000, // 2 minutes
      rampUp: 30000,
      rampDown: 15000,
      thinkTime: 1000,
      pattern: 'steady'
    });
    
    // Stress test scenario
    this.testScenarios.set('stress', {
      name: 'Stress Test',
      description: 'Test beyond normal capacity',
      userCount: this.options.maxConcurrentUsers,
      duration: 180000, // 3 minutes
      rampUp: 60000,
      rampDown: 30000,
      thinkTime: 500,
      pattern: 'increasing'
    });
    
    // Spike test scenario
    this.testScenarios.set('spike', {
      name: 'Spike Test',
      description: 'Test sudden load spikes',
      userCount: Math.floor(this.options.maxConcurrentUsers * 0.8),
      duration: 60000, // 1 minute
      rampUp: 5000, // Very fast ramp up
      rampDown: 10000,
      thinkTime: 200,
      pattern: 'spike'
    });
    
    // Endurance test scenario
    this.testScenarios.set('endurance', {
      name: 'Endurance Test',
      description: 'Test sustained load over time',
      userCount: Math.floor(this.options.maxConcurrentUsers * 0.6),
      duration: this.options.maxDuration,
      rampUp: 45000,
      rampDown: 30000,
      thinkTime: 2000,
      pattern: 'sustained'
    });
  }

  /**
   * Start load testing
   */
  async startLoadTest(testType = 'load', customScenario = null) {
    if (this.isRunning) {
      throw new Error('Load test is already running');
    }
    
    try {
      const scenario = customScenario || this.testScenarios.get(testType);
      if (!scenario) {
        throw new Error(`Unknown test type: ${testType}`);
      }
      
      await this.logger.info(`Starting ${scenario.name}`, { scenario });
      
      this.isRunning = true;
      this.currentTest = {
        type: testType,
        scenario,
        startTime: Date.now(),
        phase: 'ramp-up'
      };
      
      // Reset metrics
      this.resetMetrics();
      
      // Start test execution
      await this.executeLoadTest(scenario);
      
      await this.logger.info('Load test completed successfully');
      
    } catch (error) {
      await this.logger.error('Load test failed', { error });
      throw error;
    } finally {
      this.isRunning = false;
      this.currentTest = null;
    }
  }

  /**
   * Execute load test scenario
   */
  async executeLoadTest(scenario) {
    const testId = `test_${Date.now()}`;
    const startTime = Date.now();
    
    // Start metrics collection
    const metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, this.options.reportingInterval);
    
    try {
      // Ramp-up phase
      await this.logger.logStructured('info', 'Starting ramp-up phase', {
        component: 'LoadTest',
        phase: 'ramp-up',
        targetUsers: scenario.userCount,
        rampUpTime: scenario.rampUp
      });
      
      await this.rampUpUsers(scenario);
      
      // Steady state phase
      this.currentTest.phase = 'steady-state';
      await this.logger.logStructured('info', 'Entering steady state phase', {
        component: 'LoadTest',
        phase: 'steady-state',
        duration: scenario.duration - scenario.rampUp - scenario.rampDown
      });
      
      await this.sustainLoad(scenario);
      
      // Ramp-down phase
      this.currentTest.phase = 'ramp-down';
      await this.logger.logStructured('info', 'Starting ramp-down phase', {
        component: 'LoadTest',
        phase: 'ramp-down',
        rampDownTime: scenario.rampDown
      });
      
      await this.rampDownUsers(scenario);
      
    } finally {
      clearInterval(metricsInterval);
      
      // Generate final report
      const testResult = await this.generateTestReport(testId, scenario, startTime);
      this.testResults.set(testId, testResult);
      
      this.emit('test-completed', testResult);
    }
  }

  /**
   * Ramp up virtual users
   */
  async rampUpUsers(scenario) {
    const usersPerInterval = Math.max(1, Math.floor(scenario.userCount / (scenario.rampUp / 1000)));
    const intervalTime = scenario.rampUp / Math.ceil(scenario.userCount / usersPerInterval);
    
    let currentUsers = 0;
    
    return new Promise((resolve) => {
      const rampUpInterval = setInterval(async () => {
        const usersToAdd = Math.min(usersPerInterval, scenario.userCount - currentUsers);
        
        for (let i = 0; i < usersToAdd; i++) {
          await this.spawnVirtualUser(scenario, `user_${currentUsers + i}`);
        }
        
        currentUsers += usersToAdd;
        this.metrics.concurrentUsers = currentUsers;
        
        if (currentUsers >= scenario.userCount) {
          clearInterval(rampUpInterval);
          resolve();
        }
      }, intervalTime);
    });
  }

  /**
   * Sustain load during steady state
   */
  async sustainLoad(scenario) {
    const steadyDuration = scenario.duration - scenario.rampUp - scenario.rampDown;
    
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve();
      }, steadyDuration);
    });
  }

  /**
   * Ramp down virtual users
   */
  async rampDownUsers(scenario) {
    const usersPerInterval = Math.max(1, Math.floor(this.metrics.concurrentUsers / (scenario.rampDown / 1000)));
    const intervalTime = scenario.rampDown / Math.ceil(this.metrics.concurrentUsers / usersPerInterval);
    
    return new Promise((resolve) => {
      const rampDownInterval = setInterval(async () => {
        const usersToRemove = Math.min(usersPerInterval, this.metrics.concurrentUsers);
        
        // Stop users
        let removed = 0;
        for (const [userId, worker] of this.activeWorkers.entries()) {
          if (removed >= usersToRemove) break;
          
          worker.stop();
          this.activeWorkers.delete(userId);
          removed++;
        }
        
        this.metrics.concurrentUsers -= removed;
        
        if (this.metrics.concurrentUsers <= 0) {
          clearInterval(rampDownInterval);
          resolve();
        }
      }, intervalTime);
    });
  }

  /**
   * Spawn virtual user
   */
  async spawnVirtualUser(scenario, userId) {
    const worker = new VirtualUser(userId, scenario, this);
    this.activeWorkers.set(userId, worker);
    
    // Start user simulation
    worker.start();
    
    return worker;
  }

  /**
   * Record request result
   */
  recordRequest(result) {
    this.metrics.totalRequests++;
    
    if (result.success) {
      this.metrics.successfulRequests++;
    } else {
      this.metrics.failedRequests++;
      this.metrics.errorHistory.push({
        timestamp: Date.now(),
        error: result.error,
        userId: result.userId
      });
    }
    
    if (result.responseTime) {
      this.metrics.responseTimeSum += result.responseTime;
      this.metrics.responseTimes.push(result.responseTime);
      
      // Keep only recent response times for percentile calculations
      if (this.metrics.responseTimes.length > 10000) {
        this.metrics.responseTimes = this.metrics.responseTimes.slice(-5000);
      }
    }
  }

  /**
   * Collect real-time metrics
   */
  collectMetrics() {
    const now = Date.now();
    const throughput = this.calculateThroughput();
    const errorRate = this.calculateErrorRate();
    
    this.metrics.throughputHistory.push({
      timestamp: now,
      throughput,
      errorRate,
      concurrentUsers: this.metrics.concurrentUsers,
      avgResponseTime: this.calculateAverageResponseTime()
    });
    
    // Keep only recent history
    if (this.metrics.throughputHistory.length > 1000) {
      this.metrics.throughputHistory = this.metrics.throughputHistory.slice(-500);
    }
    
    this.emit('metrics-updated', {
      throughput,
      errorRate,
      concurrentUsers: this.metrics.concurrentUsers,
      totalRequests: this.metrics.totalRequests,
      avgResponseTime: this.calculateAverageResponseTime()
    });
  }

  /**
   * Calculate throughput (requests per second)
   */
  calculateThroughput() {
    if (this.metrics.throughputHistory.length === 0) return 0;
    
    const recentHistory = this.metrics.throughputHistory.slice(-12); // Last minute
    if (recentHistory.length < 2) return 0;
    
    const timeSpan = (recentHistory[recentHistory.length - 1].timestamp - recentHistory[0].timestamp) / 1000;
    const requestsDiff = this.metrics.totalRequests - (this.lastRequestCount || 0);
    this.lastRequestCount = this.metrics.totalRequests;
    
    return timeSpan > 0 ? requestsDiff / timeSpan : 0;
  }

  /**
   * Calculate error rate
   */
  calculateErrorRate() {
    return this.metrics.totalRequests > 0 ? 
      (this.metrics.failedRequests / this.metrics.totalRequests) * 100 : 0;
  }

  /**
   * Calculate average response time
   */
  calculateAverageResponseTime() {
    return this.metrics.totalRequests > 0 ? 
      this.metrics.responseTimeSum / this.metrics.totalRequests : 0;
  }

  /**
   * Calculate response time percentiles
   */
  calculatePercentiles() {
    if (this.metrics.responseTimes.length === 0) return {};
    
    const sorted = [...this.metrics.responseTimes].sort((a, b) => a - b);
    
    return {
      p50: this.getPercentile(sorted, 50),
      p75: this.getPercentile(sorted, 75),
      p90: this.getPercentile(sorted, 90),
      p95: this.getPercentile(sorted, 95),
      p99: this.getPercentile(sorted, 99)
    };
  }

  /**
   * Get percentile value
   */
  getPercentile(sortedArray, percentile) {
    const index = Math.ceil((percentile / 100) * sortedArray.length) - 1;
    return sortedArray[Math.max(0, Math.min(index, sortedArray.length - 1))];
  }

  /**
   * Generate comprehensive test report
   */
  async generateTestReport(testId, scenario, startTime) {
    const endTime = Date.now();
    const duration = endTime - startTime;
    const percentiles = this.calculatePercentiles();
    
    const report = {
      testId,
      scenario: scenario.name,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      duration,
      summary: {
        totalRequests: this.metrics.totalRequests,
        successfulRequests: this.metrics.successfulRequests,
        failedRequests: this.metrics.failedRequests,
        errorRate: this.calculateErrorRate(),
        averageResponseTime: this.calculateAverageResponseTime(),
        throughput: this.calculateThroughput(),
        maxConcurrentUsers: scenario.userCount
      },
      responseTimeStats: {
        min: Math.min(...this.metrics.responseTimes),
        max: Math.max(...this.metrics.responseTimes),
        average: this.calculateAverageResponseTime(),
        percentiles
      },
      throughputAnalysis: {
        averageThroughput: this.calculateAverageThroughput(),
        peakThroughput: this.calculatePeakThroughput(),
        throughputHistory: this.metrics.throughputHistory
      },
      errorAnalysis: {
        totalErrors: this.metrics.failedRequests,
        errorRate: this.calculateErrorRate(),
        errorTypes: this.analyzeErrorTypes(),
        errorHistory: this.metrics.errorHistory
      },
      recommendations: this.generateRecommendations(),
      scalabilityMetrics: this.calculateScalabilityMetrics()
    };
    
    await this.logger.logStructured('info', 'Load test report generated', {
      component: 'LoadTestReport',
      report
    });
    
    return report;
  }

  /**
   * Calculate average throughput
   */
  calculateAverageThroughput() {
    if (this.metrics.throughputHistory.length === 0) return 0;
    
    const sum = this.metrics.throughputHistory.reduce((acc, item) => acc + item.throughput, 0);
    return sum / this.metrics.throughputHistory.length;
  }

  /**
   * Calculate peak throughput
   */
  calculatePeakThroughput() {
    if (this.metrics.throughputHistory.length === 0) return 0;
    
    return Math.max(...this.metrics.throughputHistory.map(item => item.throughput));
  }

  /**
   * Analyze error types
   */
  analyzeErrorTypes() {
    const errorTypes = {};
    
    for (const error of this.metrics.errorHistory) {
      const errorType = error.error.type || 'unknown';
      errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
    }
    
    return errorTypes;
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations() {
    const recommendations = [];
    const errorRate = this.calculateErrorRate();
    const avgResponseTime = this.calculateAverageResponseTime();
    const percentiles = this.calculatePercentiles();
    
    if (errorRate > 5) {
      recommendations.push({
        type: 'error_rate',
        severity: 'high',
        message: `High error rate detected (${errorRate.toFixed(2)}%). Investigate error handling and system capacity.`,
        action: 'optimize_error_handling'
      });
    }
    
    if (avgResponseTime > 1000) {
      recommendations.push({
        type: 'response_time',
        severity: 'medium',
        message: `High average response time (${avgResponseTime.toFixed(2)}ms). Consider performance optimization.`,
        action: 'optimize_response_time'
      });
    }
    
    if (percentiles.p95 > 2000) {
      recommendations.push({
        type: 'latency_tail',
        severity: 'medium',
        message: `High P95 response time (${percentiles.p95.toFixed(2)}ms). Investigate latency tail issues.`,
        action: 'optimize_latency_tail'
      });
    }
    
    const throughputVariability = this.calculateThroughputVariability();
    if (throughputVariability > 0.3) {
      recommendations.push({
        type: 'throughput_stability',
        severity: 'low',
        message: 'High throughput variability detected. Consider load balancing improvements.',
        action: 'improve_load_balancing'
      });
    }
    
    return recommendations;
  }

  /**
   * Calculate throughput variability
   */
  calculateThroughputVariability() {
    if (this.metrics.throughputHistory.length < 2) return 0;
    
    const throughputs = this.metrics.throughputHistory.map(item => item.throughput);
    const mean = throughputs.reduce((sum, val) => sum + val, 0) / throughputs.length;
    const variance = throughputs.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / throughputs.length;
    const stdDev = Math.sqrt(variance);
    
    return mean > 0 ? stdDev / mean : 0;
  }

  /**
   * Calculate scalability metrics
   */
  calculateScalabilityMetrics() {
    const peakThroughput = this.calculatePeakThroughput();
    const scenario = this.currentTest?.scenario;
    
    return {
      maxSupportedUsers: scenario?.userCount || 0,
      throughputPerUser: scenario?.userCount > 0 ? peakThroughput / scenario.userCount : 0,
      scalabilityFactor: this.calculateScalabilityFactor(),
      bottleneckIndicators: this.identifyBottlenecks()
    };
  }

  /**
   * Calculate scalability factor
   */
  calculateScalabilityFactor() {
    // Linear scalability would be 1.0
    // Sub-linear scalability is < 1.0
    // Super-linear scalability is > 1.0 (rare)
    
    if (this.metrics.throughputHistory.length < 10) return 1.0;
    
    const early = this.metrics.throughputHistory.slice(0, 5);
    const late = this.metrics.throughputHistory.slice(-5);
    
    const earlyAvgThroughput = early.reduce((sum, item) => sum + item.throughput, 0) / early.length;
    const lateAvgThroughput = late.reduce((sum, item) => sum + item.throughput, 0) / late.length;
    const earlyAvgUsers = early.reduce((sum, item) => sum + item.concurrentUsers, 0) / early.length;
    const lateAvgUsers = late.reduce((sum, item) => sum + item.concurrentUsers, 0) / late.length;
    
    if (earlyAvgUsers === 0 || earlyAvgThroughput === 0) return 1.0;
    
    const userScaling = lateAvgUsers / earlyAvgUsers;
    const throughputScaling = lateAvgThroughput / earlyAvgThroughput;
    
    return throughputScaling / userScaling;
  }

  /**
   * Identify performance bottlenecks
   */
  identifyBottlenecks() {
    const bottlenecks = [];
    const errorRate = this.calculateErrorRate();
    const scalabilityFactor = this.calculateScalabilityFactor();
    
    if (errorRate > 1 && scalabilityFactor < 0.8) {
      bottlenecks.push({
        type: 'capacity_limit',
        description: 'System appears to be hitting capacity limits',
        evidence: { errorRate, scalabilityFactor }
      });
    }
    
    const responseTimeIncrease = this.calculateResponseTimeIncrease();
    if (responseTimeIncrease > 2.0) {
      bottlenecks.push({
        type: 'performance_degradation',
        description: 'Response time increases significantly under load',
        evidence: { responseTimeIncrease }
      });
    }
    
    return bottlenecks;
  }

  /**
   * Calculate response time increase under load
   */
  calculateResponseTimeIncrease() {
    if (this.metrics.throughputHistory.length < 10) return 1.0;
    
    const early = this.metrics.throughputHistory.slice(0, 5);
    const late = this.metrics.throughputHistory.slice(-5);
    
    const earlyAvgResponseTime = early.reduce((sum, item) => sum + item.avgResponseTime, 0) / early.length;
    const lateAvgResponseTime = late.reduce((sum, item) => sum + item.avgResponseTime, 0) / late.length;
    
    return earlyAvgResponseTime > 0 ? lateAvgResponseTime / earlyAvgResponseTime : 1.0;
  }

  /**
   * Reset metrics for new test
   */
  resetMetrics() {
    this.metrics = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      responseTimeSum: 0,
      responseTimes: [],
      concurrentUsers: 0,
      throughputHistory: [],
      errorHistory: []
    };
    this.lastRequestCount = 0;
  }

  /**
   * Stop load test
   */
  async stopLoadTest() {
    if (!this.isRunning) return;
    
    await this.logger.info('Stopping load test');
    
    // Stop all active workers
    for (const [userId, worker] of this.activeWorkers.entries()) {
      worker.stop();
    }
    
    this.activeWorkers.clear();
    this.isRunning = false;
    this.currentTest = null;
    
    await this.logger.info('Load test stopped');
  }

  /**
   * Get test status
   */
  getTestStatus() {
    return {
      isRunning: this.isRunning,
      currentTest: this.currentTest,
      metrics: {
        ...this.metrics,
        averageResponseTime: this.calculateAverageResponseTime(),
        errorRate: this.calculateErrorRate(),
        throughput: this.calculateThroughput()
      },
      activeWorkers: this.activeWorkers.size
    };
  }

  /**
   * Get available test scenarios
   */
  getTestScenarios() {
    return Array.from(this.testScenarios.entries()).map(([id, scenario]) => ({
      id,
      ...scenario
    }));
  }
}

/**
 * Virtual User class for simulating user behavior
 */
class VirtualUser {
  constructor(userId, scenario, loadTester) {
    this.userId = userId;
    this.scenario = scenario;
    this.loadTester = loadTester;
    this.isActive = false;
    this.requestCount = 0;
  }

  /**
   * Start user simulation
   */
  start() {
    this.isActive = true;
    this.simulateUserBehavior();
  }

  /**
   * Stop user simulation
   */
  stop() {
    this.isActive = false;
  }

  /**
   * Simulate user behavior
   */
  async simulateUserBehavior() {
    while (this.isActive) {
      try {
        const startTime = Date.now();
        
        // Simulate request
        const result = await this.makeRequest();
        
        const responseTime = Date.now() - startTime;
        
        // Record result
        this.loadTester.recordRequest({
          userId: this.userId,
          requestCount: ++this.requestCount,
          responseTime,
          success: result.success,
          error: result.error
        });
        
        // Think time between requests
        if (this.isActive && this.scenario.thinkTime > 0) {
          await this.sleep(this.scenario.thinkTime + Math.random() * 1000);
        }
        
      } catch (error) {
        this.loadTester.recordRequest({
          userId: this.userId,
          requestCount: ++this.requestCount,
          success: false,
          error: { type: 'simulation_error', message: error.message }
        });
      }
    }
  }

  /**
   * Simulate making a request
   */
  async makeRequest() {
    // Simulate different types of requests with varying complexity
    const requestTypes = ['simple', 'medium', 'complex'];
    const requestType = requestTypes[Math.floor(Math.random() * requestTypes.length)];
    
    let processingTime;
    let errorRate;
    
    switch (requestType) {
      case 'simple':
        processingTime = 50 + Math.random() * 100; // 50-150ms
        errorRate = 0.01; // 1% error rate
        break;
      case 'medium':
        processingTime = 100 + Math.random() * 300; // 100-400ms
        errorRate = 0.02; // 2% error rate
        break;
      case 'complex':
        processingTime = 200 + Math.random() * 800; // 200-1000ms
        errorRate = 0.05; // 5% error rate
        break;
    }
    
    // Simulate processing time
    await this.sleep(processingTime);
    
    // Simulate random errors
    const success = Math.random() > errorRate;
    
    return {
      success,
      error: success ? null : { 
        type: 'simulated_error', 
        message: `Simulated ${requestType} request error`,
        requestType 
      }
    };
  }

  /**
   * Sleep utility
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = LoadTester;