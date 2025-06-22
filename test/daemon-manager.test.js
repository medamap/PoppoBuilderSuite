/**
 * Daemon Manager Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const cluster = require('cluster');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('DaemonManager', () => {
  let DaemonManager;
  let mockGlobalConfigManager;
  let daemonManager;
  let sandbox;
  let mockPidFile;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Create mock GlobalConfigManager class
    mockGlobalConfigManager = {
      initialize: sandbox.stub().resolves(),
      get: sandbox.stub().returns({}),
      load: sandbox.stub().resolves(),
      cleanup: sandbox.stub().resolves()
    };
    
    // Load DaemonManager
    DaemonManager = require('../lib/daemon/daemon-manager');
    
    daemonManager = new DaemonManager();
    daemonManager.configManager = mockGlobalConfigManager;
    
    // Mock home directory
    mockPidFile = '/tmp/test-poppobuilder/daemon.pid';
    sandbox.stub(os, 'homedir').returns('/tmp/test-home');
    daemonManager.pidFile = mockPidFile;
    
    // Mock cluster
    sandbox.stub(cluster, 'isMaster').value(true);
    sandbox.stub(cluster, 'fork').returns({
      process: { pid: 12345 },
      send: sandbox.stub(),
      kill: sandbox.stub(),
      on: sandbox.stub()
    });
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('initialize', () => {
    it('should initialize global config and create directories', async () => {
      const mkdirStub = sandbox.stub(fs, 'mkdir').resolves();
      mockGlobalConfigManager.get.returns({ maxProcesses: 2 });
      
      await daemonManager.initialize();
      
      expect(mockGlobalConfigManager.initialize.called).to.be.true;
      expect(mockGlobalConfigManager.get.calledWith('daemon')).to.be.true;
      expect(mkdirStub.called).to.be.true;
      expect(daemonManager.config.maxProcesses).to.equal(2);
    });
  });

  describe('start', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      mockGlobalConfigManager.get.returns({ maxProcesses: 2 });
      
      await daemonManager.initialize();
    });

    it('should start master process when not already running', async () => {
      sandbox.stub(daemonManager, 'isRunning').resolves(false);
      sandbox.stub(daemonManager, 'writePidFile').resolves();
      sandbox.stub(daemonManager.signalHandler, 'setup');
      const forkStub = sandbox.stub(daemonManager, 'forkWorker');
      
      await daemonManager.start();
      
      expect(daemonManager.writePidFile.called).to.be.true;
      expect(daemonManager.signalHandler.setup.called).to.be.true;
      expect(forkStub.callCount).to.equal(2); // maxProcesses = 2
    });

    it('should throw error if already running', async () => {
      sandbox.stub(daemonManager, 'isRunning').resolves(true);
      sandbox.stub(daemonManager, 'getPid').resolves(9999);
      
      try {
        await daemonManager.start();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('already running');
      }
    });
  });

  describe('stop', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      mockGlobalConfigManager.get.returns({});
      
      await daemonManager.initialize();
    });

    it('should stop daemon and remove PID file', async () => {
      daemonManager.workers.set(12345, {
        id: 0,
        worker: { send: sandbox.stub(), kill: sandbox.stub() }
      });
      
      const removePidStub = sandbox.stub(daemonManager, 'removePidFile').resolves();
      const waitStub = sandbox.stub(daemonManager, 'waitForWorkersToExit').resolves();
      
      await daemonManager.stop();
      
      expect(daemonManager.isShuttingDown).to.be.true;
      expect(waitStub.called).to.be.true;
      expect(removePidStub.called).to.be.true;
    });
  });

  describe('isRunning', () => {
    it('should return true if process exists', async () => {
      sandbox.stub(fs, 'readFile').resolves('12345');
      sandbox.stub(process, 'kill').returns(true);
      
      const result = await daemonManager.isRunning();
      expect(result).to.be.true;
    });

    it('should return false if PID file does not exist', async () => {
      sandbox.stub(fs, 'readFile').rejects(new Error('ENOENT'));
      
      const result = await daemonManager.isRunning();
      expect(result).to.be.false;
    });

    it('should return false and remove PID file if process does not exist', async () => {
      sandbox.stub(fs, 'readFile').resolves('12345');
      sandbox.stub(process, 'kill').throws(new Error('ESRCH'));
      const unlinkStub = sandbox.stub(fs, 'unlink').resolves();
      
      const result = await daemonManager.isRunning();
      expect(result).to.be.false;
      expect(unlinkStub.called).to.be.true;
    });
  });

  describe('reload', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      mockGlobalConfigManager.get.returns({});
      
      await daemonManager.initialize();
    });

    it('should reload configuration and notify workers', async () => {
      daemonManager.configManager.get.returns({ maxProcesses: 3 });
      
      const worker = { send: sandbox.stub() };
      daemonManager.workers.set(12345, { id: 0, worker });
      
      await daemonManager.reload();
      
      expect(daemonManager.configManager.load.called).to.be.true;
      expect(daemonManager.config.maxProcesses).to.equal(3);
      expect(worker.send.calledWith({ type: 'reload' })).to.be.true;
    });
  });

  describe('worker management', () => {
    beforeEach(async () => {
      sandbox.stub(fs, 'mkdir').resolves();
      mockGlobalConfigManager.get.returns({});
      
      await daemonManager.initialize();
    });

    it('should fork worker with correct environment', () => {
      const worker = daemonManager.forkWorker(0);
      
      expect(cluster.fork.calledWith({
        POPPOBUILDER_WORKER_ID: 0,
        POPPOBUILDER_DAEMON: 'true'
      })).to.be.true;
      
      expect(daemonManager.workers.has(12345)).to.be.true;
      const workerInfo = daemonManager.workers.get(12345);
      expect(workerInfo.id).to.equal(0);
      expect(workerInfo.restarts).to.equal(0);
    });

    it('should handle worker exit and restart', function(done) {
      this.timeout(2000);
      
      const worker = { process: { pid: 12345 } };
      daemonManager.workers.set(12345, {
        id: 0,
        worker: worker,
        restarts: 0
      });
      
      const newWorker = { process: { pid: 54321 } };
      const forkStub = sandbox.stub(daemonManager, 'forkWorker').returns(newWorker);
      
      daemonManager.handleWorkerExit(worker, 1, null);
      
      // Check that worker is removed
      expect(daemonManager.workers.has(12345)).to.be.false;
      
      // Check that restart is scheduled
      setTimeout(() => {
        try {
          expect(forkStub.calledWith(0)).to.be.true;
          done();
        } catch (err) {
          done(err);
        }
      }, 1100);
    });

    it('should not restart worker when shutting down', () => {
      daemonManager.isShuttingDown = true;
      const worker = { process: { pid: 12345 } };
      daemonManager.workers.set(12345, {
        id: 0,
        worker: worker,
        restarts: 0
      });
      
      const forkStub = sandbox.stub(daemonManager, 'forkWorker');
      
      daemonManager.handleWorkerExit(worker, 1, null);
      
      expect(daemonManager.workers.has(12345)).to.be.false;
      expect(forkStub.called).to.be.false;
    });
  });

  describe('getStatus', () => {
    it('should return daemon status', async () => {
      sandbox.stub(daemonManager, 'isRunning').resolves(true);
      sandbox.stub(daemonManager, 'getPid').resolves(12345);
      
      daemonManager.workers.set(54321, {
        id: 0,
        pid: 54321,
        startTime: Date.now() - 60000,
        restarts: 2
      });
      
      const status = await daemonManager.getStatus();
      
      expect(status.running).to.be.true;
      expect(status.pid).to.equal(12345);
      expect(status.workers).to.have.lengthOf(1);
      expect(status.workers[0].id).to.equal(0);
      expect(status.workers[0].restarts).to.equal(2);
    });
  });
});