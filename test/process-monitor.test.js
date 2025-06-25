const { expect } = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');
const ProcessMonitor = require('../src/process-monitor');

describe('ProcessMonitor', () => {
  let processMonitor;
  let clock;
  let mockLogger;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    mockLogger = {
      info: sinon.stub(),
      warn: sinon.stub(),
      error: sinon.stub()
    };
    
    processMonitor = new ProcessMonitor({
      checkInterval: 5000,
      thresholds: {
        processCount: 5,
        queueSize: 10,
        lockFailureRate: 0.3,
        errorRate: 0.1,
        memoryUsage: 0.8,
        cpuUsage: 0.9
      },
      alertCooldown: 10000,
      logger: mockLogger
    });
  });

  afterEach(() => {
    clock.restore();
    processMonitor.stop();
  });

  describe('Initialization', () => {
    it('should initialize with default configuration', () => {
      const monitor = new ProcessMonitor();
      expect(monitor.config.checkInterval).to.equal(30000);
      expect(monitor.config.thresholds.processCount).to.equal(10);
    });

    it('should accept custom configuration', () => {
      expect(processMonitor.config.checkInterval).to.equal(5000);
      expect(processMonitor.config.thresholds.processCount).to.equal(5);
    });
  });

  describe('Component Setup', () => {
    it('should set monitored components', () => {
      const mockComponents = {
        processManager: {},
        taskQueue: {},
        lockManager: {},
        retryManager: {}
      };
      
      processMonitor.setComponents(mockComponents);
      expect(processMonitor.monitoredComponents).to.deep.equal(mockComponents);
    });
  });

  describe('Monitoring', () => {
    it('should start monitoring', () => {
      processMonitor.start();
      expect(mockLogger.info.calledWith('Starting process monitoring...')).to.be.true;
    });

    it('should not start if already running', () => {
      processMonitor.start();
      mockLogger.info.reset();
      processMonitor.start();
      expect(mockLogger.warn.calledWith('Process monitoring is already running')).to.be.true;
    });

    it('should perform health checks at intervals', () => {
      const performHealthCheckStub = sinon.stub(processMonitor, 'performHealthCheck');
      
      processMonitor.start();
      expect(performHealthCheckStub.calledOnce).to.be.true; // Initial check
      
      clock.tick(5000);
      expect(performHealthCheckStub.calledTwice).to.be.true;
      
      clock.tick(5000);
      expect(performHealthCheckStub.calledThrice).to.be.true;
    });

    it('should stop monitoring', () => {
      processMonitor.start();
      processMonitor.stop();
      expect(mockLogger.info.calledWith('Process monitoring stopped')).to.be.true;
    });
  });

  describe('Metrics Recording', () => {
    it('should record task attempts', () => {
      processMonitor.recordTaskAttempt();
      processMonitor.recordTaskAttempt();
      expect(processMonitor.metrics.taskAttempts).to.equal(2);
    });

    it('should record task errors', () => {
      processMonitor.recordTaskError();
      processMonitor.recordTaskError();
      processMonitor.recordTaskError();
      expect(processMonitor.metrics.taskErrors).to.equal(3);
    });

    it('should record lock attempts and failures', () => {
      processMonitor.recordLockAttempt();
      processMonitor.recordLockAttempt();
      processMonitor.recordLockFailure();
      
      expect(processMonitor.metrics.lockAttempts).to.equal(2);
      expect(processMonitor.metrics.lockFailures).to.equal(1);
    });
  });

  describe('Rate Calculations', () => {
    it('should calculate error rate correctly', () => {
      processMonitor.recordTaskAttempt();
      processMonitor.recordTaskAttempt();
      processMonitor.recordTaskError();
      
      const errorRate = processMonitor.calculateErrorRate();
      expect(errorRate).to.equal(0.5); // 1 error / 2 attempts
    });

    it('should return 0 error rate when no attempts', () => {
      const errorRate = processMonitor.calculateErrorRate();
      expect(errorRate).to.equal(0);
    });

    it('should calculate lock failure rate correctly', () => {
      processMonitor.recordLockAttempt();
      processMonitor.recordLockAttempt();
      processMonitor.recordLockAttempt();
      processMonitor.recordLockFailure();
      
      const failureRate = processMonitor.calculateLockFailureRate();
      expect(failureRate).to.be.closeTo(0.333, 0.001); // 1 failure / 3 attempts
    });
  });

  describe('Alerts', () => {
    it('should raise alert when threshold exceeded', () => {
      const alertSpy = sinon.spy();
      processMonitor.on('alert', alertSpy);
      
      // Set high error rate
      processMonitor.metrics.taskAttempts = 10;
      processMonitor.metrics.taskErrors = 2; // 20% error rate > 10% threshold
      
      processMonitor.checkThresholds();
      
      expect(alertSpy.calledOnce).to.be.true;
      expect(alertSpy.args[0][0].type).to.equal('ERROR_RATE_HIGH');
    });

    it('should respect cooldown period for alerts', () => {
      const alertSpy = sinon.spy();
      processMonitor.on('alert', alertSpy);
      
      // Set high process count
      processMonitor.metrics.processCount = 10; // > 5 threshold
      
      processMonitor.checkThresholds();
      expect(alertSpy.calledOnce).to.be.true;
      
      // Try again immediately
      alertSpy.reset();
      processMonitor.checkThresholds();
      expect(alertSpy.called).to.be.false; // Should not alert due to cooldown
      
      // Wait for cooldown period
      clock.tick(10001);
      processMonitor.checkThresholds();
      expect(alertSpy.calledOnce).to.be.true; // Should alert after cooldown
    });

    it('should clear alerts when threshold returns to normal', () => {
      const alertClearedSpy = sinon.spy();
      processMonitor.on('alertCleared', alertClearedSpy);
      
      // First raise an alert
      processMonitor.metrics.processCount = 10;
      processMonitor.checkThresholds();
      
      // Then lower the metric
      processMonitor.metrics.processCount = 3;
      processMonitor.checkThresholds();
      
      expect(alertClearedSpy.calledOnce).to.be.true;
      expect(alertClearedSpy.args[0][0].type).to.equal('PROCESS_COUNT_HIGH');
    });
  });

  describe('Status and Trends', () => {
    it('should return current status', () => {
      processMonitor.metrics.processCount = 3;
      processMonitor.metrics.queueSize = 5;
      
      const status = processMonitor.getStatus();
      
      expect(status.metrics.processCount).to.equal(3);
      expect(status.metrics.queueSize).to.equal(5);
      expect(status.activeAlerts).to.be.an('array');
      expect(status.thresholds).to.be.an('object');
      expect(status.trends).to.be.an('object');
    });

    it('should calculate trends correctly', () => {
      // Add historical data
      processMonitor.history.processCount = [
        { timestamp: Date.now() - 5000, value: 2 },
        { timestamp: Date.now() - 4000, value: 3 },
        { timestamp: Date.now() - 3000, value: 4 },
        { timestamp: Date.now() - 2000, value: 5 },
        { timestamp: Date.now() - 1000, value: 6 }
      ];
      
      const trends = processMonitor.calculateTrends();
      
      expect(trends.processCount.direction).to.equal('up');
      expect(trends.processCount.change).to.equal(4); // 6 - 2
      expect(trends.processCount.average).to.equal(4); // (2+3+4+5+6)/5
    });
  });

  describe('Health Check Integration', () => {
    it('should emit healthCheck events', (done) => {
      const mockProcessManager = {
        getRunningProcesses: sinon.stub().resolves([{}, {}, {}])
      };
      
      const mockTaskQueue = {
        getQueueSize: sinon.stub().returns(7)
      };
      
      processMonitor.setComponents({
        processManager: mockProcessManager,
        taskQueue: mockTaskQueue
      });
      
      processMonitor.on('healthCheck', (data) => {
        expect(data.metrics.processCount).to.equal(3);
        expect(data.metrics.queueSize).to.equal(7);
        expect(data.alerts).to.be.an('array');
        done();
      });
      
      processMonitor.performHealthCheck();
    });
  });
});