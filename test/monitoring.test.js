/**
 * Monitoring Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const os = require('os');
const HealthChecker = require('../lib/monitoring/health-checker');
const ProcessMonitor = require('../lib/monitoring/process-monitor');
const AutoRecovery = require('../lib/monitoring/auto-recovery');
const { MonitoringManager } = require('../lib/monitoring/monitoring-manager');

describe('Monitoring Components', function() {
  this.timeout(10000);
  
  describe('HealthChecker', () => {
    let healthChecker;
    let sandbox;
    
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      healthChecker = new HealthChecker({
        checkInterval: 100,
        responseTimeout: 500
      });
    });
    
    afterEach(() => {
      healthChecker.stop();
      sandbox.restore();
    });
    
    it('should initialize with default checks', () => {
      expect(healthChecker.healthChecks.size).to.be.at.least(4);
      expect(healthChecker.healthChecks.has('memory')).to.be.true;
      expect(healthChecker.healthChecks.has('cpu')).to.be.true;
      expect(healthChecker.healthChecks.has('disk')).to.be.true;
      expect(healthChecker.healthChecks.has('load')).to.be.true;
    });
    
    it('should register custom health check', () => {
      const customCheck = async () => ({ status: 'healthy', metric: 0.5 });
      healthChecker.registerCheck('custom', customCheck);
      
      expect(healthChecker.healthChecks.has('custom')).to.be.true;
    });
    
    it('should perform health check', async () => {
      const result = await healthChecker.performHealthCheck();
      
      expect(result).to.have.property('overall');
      expect(result).to.have.property('checks');
      expect(result).to.have.property('lastUpdate');
      expect(result.checks).to.have.property('memory');
      expect(result.checks).to.have.property('cpu');
    });
    
    it('should emit unhealthy event when threshold exceeded', async () => {
      const eventSpy = sandbox.spy();
      healthChecker.on('unhealthy', eventSpy);
      
      // オーバーライドして必ず不健全にする
      healthChecker.registerCheck('test', async () => ({
        status: 'unhealthy',
        metric: 0.95,
        threshold: 0.9
      }));
      
      await healthChecker.performHealthCheck();
      
      expect(eventSpy.calledOnce).to.be.true;
    });
    
    it('should export status in Prometheus format', async () => {
      await healthChecker.performHealthCheck();
      const prometheusData = await healthChecker.exportStatus('prometheus');
      
      expect(prometheusData).to.include('# HELP health_status');
      expect(prometheusData).to.include('# TYPE health_status gauge');
      expect(prometheusData).to.include('health_status');
    });
  });
  
  describe('ProcessMonitor', () => {
    let processMonitor;
    let sandbox;
    
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      processMonitor = new ProcessMonitor({
        updateInterval: 100
      });
    });
    
    afterEach(() => {
      processMonitor.stop();
      sandbox.restore();
    });
    
    it('should add and track processes', () => {
      processMonitor.addProcess(12345, {
        name: 'test-process',
        type: 'worker'
      });
      
      expect(processMonitor.processes.has(12345)).to.be.true;
      const info = processMonitor.getProcess(12345);
      expect(info.name).to.equal('test-process');
      expect(info.type).to.equal('worker');
    });
    
    it('should remove process', () => {
      processMonitor.addProcess(12345, { name: 'test' });
      processMonitor.removeProcess(12345);
      
      expect(processMonitor.processes.has(12345)).to.be.false;
      expect(processMonitor.history.has(12345)).to.be.false;
    });
    
    it('should emit events for high resource usage', () => {
      const highCpuSpy = sandbox.spy();
      const highMemorySpy = sandbox.spy();
      
      processMonitor.on('high-cpu', highCpuSpy);
      processMonitor.on('high-memory', highMemorySpy);
      
      processMonitor.checkAnomalies(12345, {
        cpu: 95,
        memory: 85
      });
      
      expect(highCpuSpy.calledOnce).to.be.true;
      expect(highMemorySpy.calledOnce).to.be.true;
    });
    
    it('should calculate process statistics', () => {
      processMonitor.addProcess(12345, { name: 'test' });
      
      // 履歴を追加
      const history = [
        { timestamp: Date.now() - 3000, cpu: 10, memory: 20, rss: 100000 },
        { timestamp: Date.now() - 2000, cpu: 15, memory: 25, rss: 110000 },
        { timestamp: Date.now() - 1000, cpu: 20, memory: 30, rss: 120000 },
        { timestamp: Date.now(), cpu: 25, memory: 35, rss: 130000 }
      ];
      
      processMonitor.history.set(12345, history);
      
      const stats = processMonitor.getProcessStats(12345);
      
      expect(stats.cpu.current).to.equal(25);
      expect(stats.cpu.average).to.equal(17.5);
      expect(stats.cpu.max).to.equal(25);
      expect(stats.cpu.min).to.equal(10);
    });
    
    it('should export metrics in JSON format', async () => {
      processMonitor.addProcess(12345, { name: 'test' });
      
      const jsonData = await processMonitor.exportMetrics('json');
      const data = JSON.parse(jsonData);
      
      expect(data).to.have.property('timestamp');
      expect(data).to.have.property('overall');
      expect(data).to.have.property('processes');
      expect(data.processes).to.be.an('array');
    });
  });
  
  describe('AutoRecovery', () => {
    let autoRecovery;
    let sandbox;
    
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      autoRecovery = new AutoRecovery({
        maxRetries: 3,
        retryInterval: 100,
        cooldownPeriod: 500
      });
    });
    
    afterEach(() => {
      sandbox.restore();
    });
    
    it('should register recovery actions', () => {
      const customAction = async () => ({ success: true });
      autoRecovery.registerAction('custom-issue', customAction);
      
      expect(autoRecovery.recoveryActions.has('custom-issue')).to.be.true;
    });
    
    it('should attempt recovery for registered issue', async () => {
      const actionStub = sandbox.stub().resolves({
        success: true,
        actions: ['Test action'],
        message: 'Recovery successful'
      });
      
      autoRecovery.registerAction('test-issue', actionStub);
      
      const result = await autoRecovery.attemptRecovery('test-issue', { test: true });
      
      expect(result.success).to.be.true;
      expect(actionStub.calledOnce).to.be.true;
      expect(actionStub.firstCall.args[0]).to.deep.include({ test: true });
    });
    
    it('should respect max retries', async () => {
      const actionStub = sandbox.stub().resolves({
        success: false,
        message: 'Failed'
      });
      
      autoRecovery.registerAction('test-issue', actionStub);
      
      // 最大リトライ数まで試行
      for (let i = 0; i < 3; i++) {
        await autoRecovery.attemptRecovery('test-issue');
      }
      
      // 次の試行はnullを返すべき
      const result = await autoRecovery.attemptRecovery('test-issue');
      expect(result).to.be.null;
      expect(actionStub.callCount).to.equal(3);
    });
    
    it('should handle cooldown period', async () => {
      autoRecovery.setCooldown('test-issue');
      
      const result = await autoRecovery.attemptRecovery('test-issue');
      expect(result).to.be.null;
      
      expect(autoRecovery.isInCooldown('test-issue')).to.be.true;
      
      // クールダウン期間後
      await new Promise(resolve => setTimeout(resolve, 600));
      expect(autoRecovery.isInCooldown('test-issue')).to.be.false;
    });
    
    it('should get recovery statistics', async () => {
      const successAction = sandbox.stub().resolves({ success: true });
      const failAction = sandbox.stub().resolves({ success: false });
      
      autoRecovery.registerAction('success-issue', successAction);
      autoRecovery.registerAction('fail-issue', failAction);
      
      await autoRecovery.attemptRecovery('success-issue');
      await autoRecovery.attemptRecovery('fail-issue');
      
      const stats = autoRecovery.getRecoveryStats();
      
      expect(stats.totalAttempts).to.equal(2);
      expect(stats.successfulRecoveries).to.equal(1);
      expect(stats.failedRecoveries).to.equal(1);
    });
  });
  
  describe('MonitoringManager', () => {
    let monitoringManager;
    let sandbox;
    
    beforeEach(async () => {
      sandbox = sinon.createSandbox();
      monitoringManager = new MonitoringManager({
        healthCheckInterval: 100,
        processUpdateInterval: 100
      });
      
      await monitoringManager.initialize();
    });
    
    afterEach(async () => {
      await monitoringManager.stop();
      sandbox.restore();
    });
    
    it('should initialize all components', () => {
      expect(monitoringManager.healthChecker).to.exist;
      expect(monitoringManager.processMonitor).to.exist;
      expect(monitoringManager.autoRecovery).to.exist;
      expect(monitoringManager.logger).to.exist;
    });
    
    it('should start and stop monitoring', async () => {
      const startedSpy = sandbox.spy();
      const stoppedSpy = sandbox.spy();
      
      monitoringManager.on('started', startedSpy);
      monitoringManager.on('stopped', stoppedSpy);
      
      await monitoringManager.start();
      expect(monitoringManager.isRunning).to.be.true;
      expect(startedSpy.calledOnce).to.be.true;
      
      await monitoringManager.stop();
      expect(monitoringManager.isRunning).to.be.false;
      expect(stoppedSpy.calledOnce).to.be.true;
    });
    
    it('should add and remove processes', () => {
      monitoringManager.addProcess(12345, { name: 'test' });
      expect(monitoringManager.processMonitor.processes.has(12345)).to.be.true;
      
      monitoringManager.removeProcess(12345);
      expect(monitoringManager.processMonitor.processes.has(12345)).to.be.false;
    });
    
    it('should get current status', async () => {
      await monitoringManager.start();
      
      const status = monitoringManager.getStatus();
      
      expect(status).to.have.property('running', true);
      expect(status).to.have.property('uptime');
      expect(status).to.have.property('health');
      expect(status).to.have.property('processes');
      expect(status).to.have.property('recovery');
    });
    
    it('should generate report', async () => {
      await monitoringManager.start();
      
      const report = await monitoringManager.generateReport('json');
      const data = JSON.parse(report);
      
      expect(data).to.have.property('timestamp');
      expect(data).to.have.property('status');
      expect(data).to.have.property('health');
      expect(data).to.have.property('processes');
      expect(data).to.have.property('recovery');
    });
  });
});