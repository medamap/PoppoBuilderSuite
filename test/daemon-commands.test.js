const { describe, it, before, after, beforeEach } = require('mocha');
const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const { spawn } = require('child_process');
const os = require('os');

// Import commands
const startCommand = require('../lib/cli/commands/daemon/start');
const stopCommand = require('../lib/cli/commands/daemon/stop');
const statusCommand = require('../lib/cli/commands/daemon/status');
const restartCommand = require('../lib/cli/commands/daemon/restart');
const reloadCommand = require('../lib/cli/commands/daemon/reload');

describe('Daemon CLI Commands', function() {
  this.timeout(10000);
  
  let mockClient;
  let consoleStub;
  let processExitStub;
  
  beforeEach(function() {
    // Mock IPC client
    mockClient = {
      connect: sinon.stub().resolves(),
      disconnect: sinon.stub().resolves(),
      getDaemonStatus: sinon.stub().resolves({
        info: {
          version: '1.0.0',
          pid: 12345,
          uptime: 3600000
        },
        stats: {
          queue: { totalQueued: 5 },
          workers: { totalWorkers: 2 }
        }
      }),
      request: sinon.stub().resolves({}),
      stopDaemon: sinon.stub().resolves({ stopping: true }),
      reloadDaemon: sinon.stub().resolves({ reloaded: true })
    };
    
    // Stub console methods
    consoleStub = {
      log: sinon.stub(console, 'log'),
      error: sinon.stub(console, 'error')
    };
    
    // Stub process.exit
    processExitStub = sinon.stub(process, 'exit');
  });
  
  afterEach(function() {
    // Restore stubs
    sinon.restore();
  });
  
  describe('Status Command', function() {
    it('should display daemon status when running', async function() {
      // Mock the IPC client module
      const IPCClient = sinon.stub().returns(mockClient);
      const statusModule = { ...statusCommand };
      
      // Execute status command
      await statusModule.action({ json: false });
      
      // Verify client was connected
      expect(mockClient.connect.called).to.be.true;
      expect(mockClient.getDaemonStatus.called).to.be.true;
      
      // Verify output
      const output = consoleStub.log.args.map(args => args.join(' ')).join('\n');
      expect(output).to.include('RUNNING');
      expect(output).to.include('12345');
      expect(output).to.include('1.0.0');
    });
    
    it('should handle daemon not running', async function() {
      mockClient.connect.rejects(new Error('ECONNREFUSED'));
      
      const statusModule = { ...statusCommand };
      await statusModule.action({ json: false });
      
      const output = consoleStub.log.args.map(args => args.join(' ')).join('\n');
      expect(output).to.include('STOPPED');
    });
    
    it('should output JSON format when requested', async function() {
      const statusModule = { ...statusCommand };
      await statusModule.action({ json: true });
      
      const jsonOutput = consoleStub.log.firstCall.args[0];
      const parsed = JSON.parse(jsonOutput);
      
      expect(parsed).to.have.property('running', true);
      expect(parsed).to.have.property('daemon');
      expect(parsed.daemon).to.have.property('pid', 12345);
    });
  });
  
  describe('Stop Command', function() {
    it('should stop daemon gracefully', async function() {
      const stopModule = { ...stopCommand };
      await stopModule.action({ force: false, timeout: 30 });
      
      expect(mockClient.connect.called).to.be.true;
      expect(mockClient.stopDaemon.called).to.be.true;
      expect(mockClient.stopDaemon.firstCall.args[0]).to.deep.equal({
        force: false,
        timeout: 30
      });
    });
    
    it('should support force stop', async function() {
      const stopModule = { ...stopCommand };
      await stopModule.action({ force: true });
      
      expect(mockClient.stopDaemon.firstCall.args[0]).to.have.property('force', true);
    });
    
    it('should handle daemon not running', async function() {
      mockClient.connect.rejects(new Error('ECONNREFUSED'));
      
      const stopModule = { ...stopCommand };
      await stopModule.action({});
      
      const output = consoleStub.log.args.map(args => args.join(' ')).join('\n');
      expect(output).to.include('not running');
    });
  });
  
  describe('Reload Command', function() {
    it('should reload daemon configuration', async function() {
      mockClient.request.withArgs('daemon.reload').resolves({
        reloaded: true,
        changes: {
          'daemon.maxProcesses': { old: 2, new: 4 }
        }
      });
      
      const reloadModule = { ...reloadCommand };
      await reloadModule.action({});
      
      expect(mockClient.connect.called).to.be.true;
      expect(mockClient.request.calledWith('daemon.reload')).to.be.true;
      
      const output = consoleStub.log.args.map(args => args.join(' ')).join('\n');
      expect(output).to.include('reloaded successfully');
    });
    
    it('should show configuration changes', async function() {
      mockClient.request.withArgs('daemon.reload').resolves({
        reloaded: true,
        changes: {
          'daemon.maxProcesses': { old: 2, new: 4 },
          'daemon.schedulingStrategy': { old: 'fifo', new: 'priority' }
        }
      });
      
      const reloadModule = { ...reloadCommand };
      await reloadModule.action({ showDiff: true });
      
      const output = consoleStub.log.args.map(args => args.join(' ')).join('\n');
      expect(output).to.include('maxProcesses');
      expect(output).to.include('2');
      expect(output).to.include('4');
    });
  });
  
  describe('Start Command', function() {
    let spawnStub;
    
    beforeEach(function() {
      spawnStub = sinon.stub();
      // Mock spawn to simulate daemon starting
      spawnStub.returns({
        on: sinon.stub(),
        unref: sinon.stub(),
        pid: 12345
      });
    });
    
    it('should check if daemon is already running', async function() {
      // Daemon is already running
      const startModule = { ...startCommand };
      await startModule.action({});
      
      expect(mockClient.connect.called).to.be.true;
      const output = consoleStub.log.args.map(args => args.join(' ')).join('\n');
      expect(output).to.include('already running');
    });
    
    it('should start daemon in background mode', async function() {
      // Daemon is not running
      mockClient.connect.onFirstCall().rejects(new Error('ECONNREFUSED'));
      mockClient.connect.onSecondCall().resolves();
      
      const startModule = { ...startCommand };
      // We need to mock the spawn behavior
      const originalSpawn = require('child_process').spawn;
      require('child_process').spawn = spawnStub;
      
      await startModule.action({ foreground: false });
      
      // Restore spawn
      require('child_process').spawn = originalSpawn;
      
      expect(spawnStub.called).to.be.true;
      const spawnArgs = spawnStub.firstCall.args;
      expect(spawnArgs[1]).to.include('start');
    });
  });
  
  describe('Restart Command', function() {
    it('should restart daemon', async function() {
      mockClient.request.withArgs('daemon.restart').resolves({
        restarted: true,
        preservedQueue: true
      });
      
      const restartModule = { ...restartCommand };
      await restartModule.action({ preserveQueue: true });
      
      expect(mockClient.connect.called).to.be.true;
      expect(mockClient.request.calledWith('daemon.restart')).to.be.true;
      
      const output = consoleStub.log.args.map(args => args.join(' ')).join('\n');
      expect(output).to.include('restarted successfully');
    });
    
    it('should handle force restart', async function() {
      mockClient.request.withArgs('daemon.restart').rejects(new Error('Cannot restart in-place'));
      
      const restartModule = { ...restartCommand };
      await restartModule.action({ force: true });
      
      // Should fall back to stop/start
      expect(mockClient.stopDaemon.called).to.be.true;
    });
  });
  
  describe('Error Handling', function() {
    it('should handle connection errors gracefully', async function() {
      mockClient.connect.rejects(new Error('Connection timeout'));
      
      const statusModule = { ...statusCommand };
      await statusModule.action({});
      
      const errorOutput = consoleStub.error.args.map(args => args.join(' ')).join('\n');
      expect(errorOutput).to.include('Error');
    });
    
    it('should handle unexpected errors', async function() {
      mockClient.getDaemonStatus.rejects(new Error('Unexpected error'));
      
      const statusModule = { ...statusCommand };
      await statusModule.action({});
      
      expect(processExitStub.calledWith(1)).to.be.true;
    });
  });
});