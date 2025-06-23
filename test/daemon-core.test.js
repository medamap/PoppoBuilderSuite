const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const http = require('http');
const PoppoDaemon = require('../lib/daemon/poppo-daemon');
const DaemonState = require('../lib/daemon/daemon-state');

describe('Daemon Core Components Test', function() {
  this.timeout(30000); // 30 second timeout for daemon operations
  
  let daemon;
  const testPort = 3333; // Use different port to avoid conflicts
  
  before(async function() {
    // Ensure no existing daemon
    const existing = await DaemonState.checkExisting();
    if (existing) {
      console.log('Cleaning up existing daemon...');
      await DaemonState.forceStop(existing.pid);
    }
    
    // Create daemon with test configuration
    daemon = new PoppoDaemon({
      port: testPort,
      maxProcesses: 1,
      heartbeatInterval: 1000 // 1 second for faster tests
    });
  });
  
  after(async function() {
    if (daemon) {
      await daemon.shutdown();
    }
  });
  
  describe('Daemon Lifecycle', function() {
    it('should start successfully', async function() {
      await daemon.start();
      
      const state = daemon.state.getState();
      expect(state.status).to.equal('running');
      expect(state.pid).to.equal(process.pid);
    });
    
    it('should provide daemon info', function() {
      const info = daemon.getInfo();
      
      expect(info).to.be.an('object');
      expect(info.pid).to.equal(process.pid);
      expect(info.status).to.equal('running');
      expect(info.platform).to.equal(process.platform);
      expect(info.nodeVersion).to.equal(process.version);
    });
    
    it('should track statistics', async function() {
      const stats = await daemon.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.uptime).to.be.a('number');
      expect(stats.metrics).to.be.an('object');
      expect(stats.queue).to.be.an('object');
      expect(stats.workers).to.be.an('object');
      expect(stats.memory).to.be.an('object');
    });
    
    it('should emit heartbeat events', function(done) {
      daemon.once('heartbeat', (stats) => {
        expect(stats).to.be.an('object');
        expect(stats.uptime).to.be.a('number');
        done();
      });
    });
  });
  
  describe('API Server', function() {
    it('should respond to health check', function(done) {
      const options = {
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/health',
        method: 'GET'
      };
      
      const req = http.request(options, (res) => {
        expect(res.statusCode).to.equal(200);
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const health = JSON.parse(data);
          expect(health.status).to.equal('ok');
          expect(health.daemon).to.equal('running');
          done();
        });
      });
      
      req.on('error', done);
      req.end();
    });
    
    it('should return daemon status', function(done) {
      const options = {
        hostname: '127.0.0.1',
        port: testPort,
        path: '/api/daemon/status',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer test-token'
        }
      };
      
      const req = http.request(options, (res) => {
        expect(res.statusCode).to.equal(200);
        
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          const status = JSON.parse(data);
          expect(status.running).to.be.true;
          expect(status.uptime).to.be.a('number');
          done();
        });
      });
      
      req.on('error', done);
      req.end();
    });
  });
  
  describe('Queue Manager', function() {
    it('should add tasks to queue', async function() {
      const taskId = await daemon.queueManager.addTask({
        projectId: 'test-project',
        type: 'test',
        payload: { test: true }
      });
      
      expect(taskId).to.be.a('string');
      expect(taskId).to.match(/^task-/);
      
      const stats = await daemon.queueManager.getStats();
      expect(stats.totalQueued).to.be.at.least(0);
    });
    
    it('should track project statistics', async function() {
      const stats = await daemon.queueManager.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.strategy).to.equal('weighted-round-robin');
      expect(stats.projectStats).to.be.an('array');
    });
  });
  
  describe('Worker Pool', function() {
    it('should have worker statistics', async function() {
      const stats = await daemon.workerPool.getStats();
      
      expect(stats).to.be.an('object');
      expect(stats.totalWorkers).to.be.a('number');
      expect(stats.activeWorkers).to.be.a('number');
      expect(stats.availableWorkers).to.be.a('number');
      expect(stats.poolStats).to.be.an('object');
    });
  });
  
  describe('Configuration Reload', function() {
    it('should reload configuration', async function() {
      const oldStrategy = daemon.queueManager.strategy;
      
      await daemon.reloadConfig();
      
      // Strategy should remain the same since config hasn't changed
      expect(daemon.queueManager.strategy).to.equal(oldStrategy);
    });
  });
});