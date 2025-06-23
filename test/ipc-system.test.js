const { describe, it, before, after, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { IPCServer, IPCClient, Protocol, Commands } = require('../lib/daemon/ipc');

describe('IPC Communication System', function() {
  this.timeout(10000);
  
  let server;
  let client;
  const testSocketPath = process.platform === 'win32' 
    ? '\\\\.\\pipe\\poppobuilder-test'
    : path.join(os.tmpdir(), 'poppobuilder-test.sock');
  
  // Mock daemon context
  const mockDaemon = {
    getInfo: () => ({ version: '1.0.0', pid: process.pid }),
    getStats: async () => ({ uptime: 1000, tasksProcessed: 10 }),
    reloadConfig: async () => ({ success: true }),
    shutdown: async () => ({ stopping: true }),
    
    queueManager: {
      getStats: async () => ({ totalQueued: 5, totalProcessing: 2 }),
      addTask: async (task) => 'task-123',
      removeTask: async (id) => true,
      getQueue: () => [{ id: 'task-1', projectId: 'test' }]
    },
    
    workerPool: {
      getStats: async () => ({ totalWorkers: 2, activeWorkers: 1 }),
      getWorkers: () => [{ id: 1, status: 'idle' }]
    }
  };
  
  const mockRegistry = {
    getAllProjects: () => ({
      'test-project': { name: 'Test Project', path: '/test' }
    }),
    getProject: (id) => ({ id, name: 'Test Project' }),
    register: async (path) => 'test-project',
    unregister: async (id) => true
  };
  
  before(async function() {
    // Clean up any existing socket
    try {
      await fs.unlink(testSocketPath);
    } catch (error) {
      // Ignore if doesn't exist
    }
  });
  
  beforeEach(async function() {
    server = new IPCServer({ socketPath: testSocketPath });
    client = new IPCClient({ socketPath: testSocketPath });
  });
  
  afterEach(async function() {
    if (client && client.isConnected()) {
      await client.disconnect();
    }
    if (server) {
      await server.stop();
    }
  });
  
  describe('Server and Client Connection', function() {
    it('should start server and connect client', async function() {
      await server.start();
      expect(server.isRunning()).to.be.true;
      
      await client.connect();
      expect(client.isConnected()).to.be.true;
    });
    
    it('should handle authentication', async function() {
      server.setAuthToken('test-token');
      await server.start();
      
      // Connect without auth should fail commands
      await client.connect();
      
      try {
        await client.request('daemon.status');
        throw new Error('Should have failed');
      } catch (error) {
        expect(error.message).to.include('Unauthorized');
      }
      
      // Authenticate
      await client.authenticate('test-token');
      
      // Now commands should work
      const response = await client.request('daemon.status', {}, {
        daemon: mockDaemon,
        registry: mockRegistry
      });
      expect(response).to.be.an('object');
    });
    
    it('should handle reconnection', async function() {
      await server.start();
      await client.connect();
      
      // Force disconnect
      client.socket.destroy();
      
      // Should reconnect automatically
      await new Promise(resolve => setTimeout(resolve, 1500));
      expect(client.isConnected()).to.be.true;
    });
  });
  
  describe('Message Protocol', function() {
    it('should encode and decode messages correctly', function() {
      const message = {
        id: '123',
        type: Protocol.MessageType.COMMAND,
        command: 'test.command',
        payload: { data: 'test' }
      };
      
      const encoded = Protocol.encode(message);
      expect(encoded).to.be.instanceOf(Buffer);
      
      const decoded = Protocol.decode(encoded);
      expect(decoded).to.deep.equal(message);
    });
    
    it('should validate message types', function() {
      const validMessage = {
        id: '123',
        type: Protocol.MessageType.COMMAND,
        command: 'test'
      };
      
      expect(() => Protocol.validateMessage(validMessage)).to.not.throw();
      
      const invalidMessage = { type: 'invalid' };
      expect(() => Protocol.validateMessage(invalidMessage)).to.throw();
    });
  });
  
  describe('Command Execution', function() {
    beforeEach(async function() {
      await server.start();
      await client.connect();
      
      // Set up command handlers with mock context
      server.on('command', async (message, connection) => {
        const context = {
          daemon: mockDaemon,
          registry: mockRegistry
        };
        
        try {
          const handler = Commands.handlers[message.command];
          if (!handler) {
            throw new Error(`Unknown command: ${message.command}`);
          }
          
          const result = await handler(message.payload || {}, context);
          server.sendResponse(connection, message.id, result);
        } catch (error) {
          server.sendError(connection, message.id, error.message);
        }
      });
    });
    
    it('should execute daemon status command', async function() {
      const response = await client.getDaemonStatus();
      
      expect(response).to.be.an('object');
      expect(response.info).to.include({ version: '1.0.0' });
      expect(response.stats).to.include({ uptime: 1000 });
    });
    
    it('should execute project list command', async function() {
      const response = await client.request('project.list');
      
      expect(response).to.be.an('object');
      expect(response).to.have.property('test-project');
    });
    
    it('should execute queue status command', async function() {
      const response = await client.request('queue.status');
      
      expect(response).to.be.an('object');
      expect(response.stats).to.include({ totalQueued: 5 });
      expect(response.tasks).to.be.an('array');
    });
    
    it('should handle command errors', async function() {
      try {
        await client.request('invalid.command');
        throw new Error('Should have failed');
      } catch (error) {
        expect(error.message).to.include('Unknown command');
      }
    });
  });
  
  describe('Event Broadcasting', function() {
    beforeEach(async function() {
      await server.start();
      await client.connect();
    });
    
    it('should broadcast events to clients', function(done) {
      client.on('task.completed', (data) => {
        expect(data).to.deep.equal({ taskId: 'task-123', result: 'success' });
        done();
      });
      
      server.broadcast('task.completed', { taskId: 'task-123', result: 'success' });
    });
    
    it('should only broadcast to authenticated clients', async function() {
      server.setAuthToken('test-token');
      
      let received = false;
      client.on('test.event', () => { received = true; });
      
      // Broadcast without auth
      server.broadcast('test.event', {});
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(received).to.be.false;
      
      // Authenticate and broadcast
      await client.authenticate('test-token');
      server.broadcast('test.event', {});
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(received).to.be.true;
    });
  });
  
  describe('Client Helper Methods', function() {
    beforeEach(async function() {
      await server.start();
      await client.connect();
      
      // Set up mock handlers
      server.on('command', async (message, connection) => {
        const context = { daemon: mockDaemon, registry: mockRegistry };
        const handler = Commands.handlers[message.command];
        if (handler) {
          const result = await handler(message.payload || {}, context);
          server.sendResponse(connection, message.id, result);
        }
      });
    });
    
    it('should use helper methods', async function() {
      const status = await client.getDaemonStatus();
      expect(status).to.be.an('object');
      
      const projects = await client.listProjects();
      expect(projects).to.be.an('object');
      
      const queue = await client.getQueueStatus();
      expect(queue).to.be.an('object');
      
      const workers = await client.getWorkerStatus();
      expect(workers).to.be.an('object');
    });
  });
  
  after(async function() {
    // Clean up socket file
    try {
      await fs.unlink(testSocketPath);
    } catch (error) {
      // Ignore
    }
  });
});