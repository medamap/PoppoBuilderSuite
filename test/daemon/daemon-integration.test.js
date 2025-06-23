/**
 * Daemon Integration Tests
 * 
 * Comprehensive test suite for the PoppoBuilder daemon architecture
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { spawn } = require('child_process');
const PoppoDaemon = require('../../lib/daemon/poppo-daemon');
const { IPCClient } = require('../../lib/daemon/ipc');
const DaemonState = require('../../lib/daemon/daemon-state');
const { getInstance: getGlobalConfig } = require('../../lib/core/global-config-manager');
const { getInstance: getProjectRegistry } = require('../../lib/core/project-registry');

describe('Daemon Integration Tests', function() {
  this.timeout(30000); // 30 seconds for integration tests
  
  let testConfigDir;
  let daemon;
  let ipcClient;
  
  before(async function() {
    // Create temporary test configuration directory
    testConfigDir = path.join(os.tmpdir(), `poppo-test-${Date.now()}`);
    await fs.mkdir(testConfigDir, { recursive: true });
    
    // Set test environment
    process.env.POPPO_CONFIG_DIR = testConfigDir;
    
    // Initialize test configuration
    const globalConfig = getGlobalConfig();
    await globalConfig.initialize();
    
    const testConfig = {
      version: '3.0.0',
      daemon: {
        enabled: true,
        port: 3103, // Use different port for testing
        host: '127.0.0.1',
        maxProcesses: 2,
        schedulingStrategy: 'round-robin'
      },
      taskQueue: {
        maxQueueSize: 100,
        priorityManagement: {
          enabled: true
        }
      }
    };
    
    await globalConfig.updateConfig(testConfig);
    
    // Initialize project registry
    const registry = getProjectRegistry();
    await registry.initialize();
  });
  
  after(async function() {
    // Cleanup
    if (daemon) {
      await daemon.shutdown(0);
    }
    
    if (ipcClient) {
      await ipcClient.disconnect();
    }
    
    // Remove test directory
    try {
      await fs.rmdir(testConfigDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }
    
    delete process.env.POPPO_CONFIG_DIR;
  });
  
  beforeEach(function() {
    ipcClient = new IPCClient();
  });
  
  afterEach(async function() {
    if (ipcClient) {
      try {
        await ipcClient.disconnect();
      } catch (error) {
        // Ignore disconnect errors
      }
    }
  });
  
  describe('Daemon Lifecycle', function() {
    it('should start daemon successfully', async function() {
      daemon = new PoppoDaemon({
        port: 3103,
        host: '127.0.0.1',
        maxProcesses: 2
      });
      
      // Start daemon
      const startPromise = daemon.start();
      
      // Wait for daemon to be ready
      await new Promise(resolve => {
        daemon.on('started', resolve);
      });
      
      // Verify daemon state
      const state = await DaemonState.checkExisting();
      expect(state).to.exist;
      expect(state.status).to.equal('running');
      expect(state.pid).to.equal(process.pid);
    });
    
    it('should accept IPC connections', async function() {
      await ipcClient.connect();
      
      const response = await ipcClient.sendCommand('ping');
      expect(response).to.deep.equal({ success: true, message: 'pong' });
    });
    
    it('should provide status information', async function() {
      await ipcClient.connect();
      
      const status = await ipcClient.sendCommand('status');
      expect(status).to.have.property('daemon');
      expect(status).to.have.property('projects');
      expect(status).to.have.property('workers');
      expect(status).to.have.property('queue');
      
      expect(status.daemon.status).to.equal('running');
      expect(status.daemon.pid).to.equal(process.pid);
    });
    
    it('should reload configuration', async function() {
      await ipcClient.connect();
      
      const response = await ipcClient.sendCommand('reload');
      expect(response.success).to.be.true;
    });
    
    it('should shutdown gracefully', async function() {
      await ipcClient.connect();
      
      // Send shutdown command
      const shutdownPromise = ipcClient.sendCommand('shutdown', { graceful: true });
      
      // Wait for daemon to shutdown
      await new Promise(resolve => {
        daemon.on('shutdown', resolve);
      });
      
      // Verify state is cleaned up
      const state = await DaemonState.checkExisting();
      expect(state).to.be.null;
      
      daemon = null; // Prevent double cleanup
    });
  });
  
  describe('Project Management', function() {
    before(async function() {
      // Start fresh daemon for project tests
      daemon = new PoppoDaemon({
        port: 3103,
        maxProcesses: 2
      });
      
      await daemon.start();
      await new Promise(resolve => daemon.on('started', resolve));
    });
    
    it('should register project', async function() {
      await ipcClient.connect();
      
      const projectData = {
        id: 'test-project',
        name: 'Test Project',
        path: '/tmp/test-project',
        config: {
          priority: 50,
          weight: 1.0,
          pollingInterval: 300000,
          enabled: true
        }
      };
      
      const response = await ipcClient.sendCommand('register-project', projectData);
      expect(response.success).to.be.true;
      
      // Verify project is registered
      const status = await ipcClient.sendCommand('status');
      expect(status.projects).to.have.property('test-project');
    });
    
    it('should enable/disable project', async function() {
      await ipcClient.connect();
      
      // Disable project
      let response = await ipcClient.sendCommand('disable-project', { 
        projectId: 'test-project' 
      });
      expect(response.success).to.be.true;
      
      // Verify project is disabled
      let status = await ipcClient.sendCommand('status');
      expect(status.projects['test-project'].enabled).to.be.false;
      
      // Enable project
      response = await ipcClient.sendCommand('enable-project', { 
        projectId: 'test-project' 
      });
      expect(response.success).to.be.true;
      
      // Verify project is enabled
      status = await ipcClient.sendCommand('status');
      expect(status.projects['test-project'].enabled).to.be.true;
    });
    
    it('should get project information', async function() {
      await ipcClient.connect();
      
      const response = await ipcClient.sendCommand('get-project-info', { 
        projectId: 'test-project' 
      });
      
      expect(response.project).to.exist;
      expect(response.project.id).to.equal('test-project');
      expect(response.project.name).to.equal('Test Project');
    });
    
    it('should unregister project', async function() {
      await ipcClient.connect();
      
      const response = await ipcClient.sendCommand('unregister-project', { 
        projectId: 'test-project' 
      });
      expect(response.success).to.be.true;
      
      // Verify project is removed
      const status = await ipcClient.sendCommand('status');
      expect(status.projects).to.not.have.property('test-project');
    });
  });
  
  describe('Task Queue Management', function() {
    before(async function() {
      if (!daemon) {
        daemon = new PoppoDaemon({ port: 3103 });
        await daemon.start();
        await new Promise(resolve => daemon.on('started', resolve));
      }
    });
    
    it('should queue tasks', async function() {
      await ipcClient.connect();
      
      const task = {
        id: 'test-task-1',
        type: 'issue-processing',
        projectId: 'test-project',
        data: {
          issueNumber: 123,
          action: 'process'
        },
        priority: 50
      };
      
      const response = await ipcClient.sendCommand('queue-task', task);
      expect(response.success).to.be.true;
      expect(response.taskId).to.exist;
    });
    
    it('should get queue status', async function() {
      await ipcClient.connect();
      
      const status = await ipcClient.sendCommand('get-queue-status');
      expect(status).to.have.property('totalTasks');
      expect(status).to.have.property('pendingTasks');
      expect(status).to.have.property('runningTasks');
    });
    
    it('should handle task completion', async function() {
      await ipcClient.connect();
      
      const result = {
        taskId: 'test-task-1',
        status: 'completed',
        result: { success: true },
        duration: 1000
      };
      
      const response = await ipcClient.sendCommand('complete-task', result);
      expect(response.success).to.be.true;
    });
  });
  
  describe('Worker Pool Management', function() {
    it('should manage worker pool', async function() {
      await ipcClient.connect();
      
      const status = await ipcClient.sendCommand('status');
      expect(status.workers).to.have.property('totalWorkers');
      expect(status.workers).to.have.property('activeWorkers');
      expect(status.workers).to.have.property('idleWorkers');
      
      expect(status.workers.totalWorkers).to.be.at.least(1);
    });
    
    it('should scale worker pool', async function() {
      await ipcClient.connect();
      
      const response = await ipcClient.sendCommand('scale-workers', { 
        targetWorkers: 3 
      });
      expect(response.success).to.be.true;
      
      // Verify scaling
      const status = await ipcClient.sendCommand('status');
      expect(status.workers.totalWorkers).to.equal(3);
    });
  });
  
  describe('Error Handling', function() {
    it('should handle invalid commands', async function() {
      await ipcClient.connect();
      
      try {
        await ipcClient.sendCommand('invalid-command');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Unknown command');
      }
    });
    
    it('should handle connection errors gracefully', async function() {
      // Don't connect
      try {
        await ipcClient.sendCommand('ping');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.code).to.equal('ECONNREFUSED');
      }
    });
    
    it('should recover from worker failures', async function() {
      await ipcClient.connect();
      
      // Simulate worker failure
      const response = await ipcClient.sendCommand('simulate-worker-failure', {
        workerId: 'worker-1'
      });
      
      expect(response.success).to.be.true;
      
      // Verify worker is replaced
      await new Promise(resolve => setTimeout(resolve, 1000));
      const status = await ipcClient.sendCommand('status');
      expect(status.workers.totalWorkers).to.be.at.least(1);
    });
  });
  
  describe('Performance and Stress Testing', function() {
    it('should handle multiple concurrent connections', async function() {
      const clients = [];
      const connectionPromises = [];
      
      // Create multiple IPC clients
      for (let i = 0; i < 5; i++) {
        const client = new IPCClient();
        clients.push(client);
        connectionPromises.push(client.connect());
      }
      
      await Promise.all(connectionPromises);
      
      // Send concurrent commands
      const commandPromises = clients.map(client => 
        client.sendCommand('ping')
      );
      
      const responses = await Promise.all(commandPromises);
      
      // Verify all responses
      responses.forEach(response => {
        expect(response).to.deep.equal({ success: true, message: 'pong' });
      });
      
      // Cleanup
      await Promise.all(clients.map(client => client.disconnect()));
    });
    
    it('should handle high task volume', async function() {
      await ipcClient.connect();
      
      // Queue multiple tasks rapidly
      const taskPromises = [];
      for (let i = 0; i < 50; i++) {
        const task = {
          id: `stress-test-${i}`,
          type: 'test-task',
          priority: Math.floor(Math.random() * 100)
        };
        
        taskPromises.push(
          ipcClient.sendCommand('queue-task', task)
        );
      }
      
      const responses = await Promise.all(taskPromises);
      
      // Verify all tasks were queued
      responses.forEach(response => {
        expect(response.success).to.be.true;
      });
      
      // Check queue status
      const status = await ipcClient.sendCommand('get-queue-status');
      expect(status.totalTasks).to.be.at.least(50);
    });
  });
});

describe('CLI Integration Tests', function() {
  this.timeout(20000);
  
  let testConfigDir;
  
  before(async function() {
    testConfigDir = path.join(os.tmpdir(), `poppo-cli-test-${Date.now()}`);
    await fs.mkdir(testConfigDir, { recursive: true });
    process.env.POPPO_CONFIG_DIR = testConfigDir;
  });
  
  after(async function() {
    try {
      await fs.rmdir(testConfigDir, { recursive: true });
    } catch (error) {
      // Ignore
    }
    delete process.env.POPPO_CONFIG_DIR;
  });
  
  it('should initialize global configuration', function(done) {
    const cli = spawn(process.execPath, [
      path.join(__dirname, '../../bin/poppobuilder'),
      'init',
      '--force',
      '--skip-daemon',
      '--skip-projects'
    ], {
      stdio: 'pipe',
      env: { ...process.env, POPPO_CONFIG_DIR: testConfigDir }
    });
    
    cli.on('close', (code) => {
      expect(code).to.equal(0);
      
      // Verify configuration was created
      const configFile = path.join(testConfigDir, 'config.json');
      fs.access(configFile).then(() => {
        done();
      }).catch(done);
    });
    
    cli.on('error', done);
  });
  
  it('should register project via CLI', function(done) {
    // Create temporary project directory
    const projectDir = path.join(os.tmpdir(), 'test-cli-project');
    
    fs.mkdir(projectDir, { recursive: true }).then(() => {
      const packageJson = {
        name: 'test-cli-project',
        version: '1.0.0'
      };
      
      return fs.writeFile(
        path.join(projectDir, 'package.json'),
        JSON.stringify(packageJson, null, 2)
      );
    }).then(() => {
      const cli = spawn(process.execPath, [
        path.join(__dirname, '../../bin/poppobuilder'),
        'register',
        projectDir,
        '--name', 'Test CLI Project',
        '--priority', '60'
      ], {
        stdio: 'pipe',
        env: { ...process.env, POPPO_CONFIG_DIR: testConfigDir }
      });
      
      cli.on('close', (code) => {
        expect(code).to.equal(0);
        done();
      });
      
      cli.on('error', done);
    }).catch(done);
  });
});

// Test utilities
function createMockProject(id, config = {}) {
  return {
    id,
    name: `Test Project ${id}`,
    path: `/tmp/test-${id}`,
    version: '1.0.0',
    config: {
      priority: 50,
      weight: 1.0,
      pollingInterval: 300000,
      enabled: true,
      ...config
    }
  };
}

function createMockTask(id, projectId, data = {}) {
  return {
    id,
    type: 'issue-processing',
    projectId,
    priority: 50,
    createdAt: new Date().toISOString(),
    data: {
      issueNumber: 123,
      action: 'process',
      ...data
    }
  };
}