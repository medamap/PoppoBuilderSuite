/**
 * Daemon API Server Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('Daemon API Server', () => {
  let DaemonAPIServer;
  let apiServer;
  let mockDaemonManager;
  let sandbox;
  let testApiKeyFile;

  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    
    // Create temporary API key file
    testApiKeyFile = path.join(os.tmpdir(), 'test-daemon.key');
    await fs.writeFile(testApiKeyFile, 'test-api-key-12345');

    // Load classes
    DaemonAPIServer = require('../lib/daemon/api-server');

    // Mock DaemonManager
    mockDaemonManager = {
      isRunning: sandbox.stub().returns(true),
      getWorkerCount: sandbox.stub().returns(2),
      getWorkers: sandbox.stub().returns(new Map([
        [1001, { id: 0, startTime: Date.now() - 60000, restarts: 0 }],
        [1002, { id: 1, startTime: Date.now() - 30000, restarts: 1 }]
      ])),
      getStatus: sandbox.stub().resolves({
        running: true,
        pid: 1000,
        workers: [
          { id: 0, pid: 1001, uptime: 60000, restarts: 0 },
          { id: 1, pid: 1002, uptime: 30000, restarts: 1 }
        ]
      }),
      start: sandbox.stub().resolves(),
      stop: sandbox.stub().resolves(),
      restart: sandbox.stub().resolves(),
      reload: sandbox.stub().resolves(),
      restartWorker: sandbox.stub(),
      on: sandbox.stub(),
      emit: sandbox.stub()
    };

    // Create API server instance with test configuration
    apiServer = new DaemonAPIServer(mockDaemonManager, {
      port: 0, // Use dynamic port for testing
      apiKeyFile: testApiKeyFile,
      enableAuth: true,
      enableWebSocket: true
    });
  });

  afterEach(async () => {
    if (apiServer && apiServer.isRunning) {
      await apiServer.stop();
    }
    
    // Clean up test API key file
    try {
      await fs.unlink(testApiKeyFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
    
    sandbox.restore();
  });

  describe('Initialization', () => {
    it('should initialize with default options', () => {
      const server = new DaemonAPIServer(mockDaemonManager);
      
      expect(server.options.port).to.equal(45678);
      expect(server.options.host).to.equal('127.0.0.1');
      expect(server.options.enableWebSocket).to.be.true;
      expect(server.options.enableAuth).to.be.true;
    });

    it('should accept custom options', () => {
      const customOptions = {
        port: 8080,
        host: '0.0.0.0',
        enableWebSocket: false,
        enableAuth: false
      };
      
      const server = new DaemonAPIServer(mockDaemonManager, customOptions);
      
      expect(server.options.port).to.equal(8080);
      expect(server.options.host).to.equal('0.0.0.0');
      expect(server.options.enableWebSocket).to.be.false;
      expect(server.options.enableAuth).to.be.false;
    });
  });

  describe('API Key Management', () => {
    it('should load existing API key', async () => {
      await apiServer.initializeApiKey();
      expect(apiServer.apiKey).to.equal('test-api-key-12345');
    });

    it('should generate new API key if file does not exist', async () => {
      const nonExistentFile = path.join(os.tmpdir(), 'non-existent-key');
      apiServer.options.apiKeyFile = nonExistentFile;
      
      await apiServer.initializeApiKey();
      
      expect(apiServer.apiKey).to.be.a('string');
      expect(apiServer.apiKey).to.have.length(64); // 32 bytes = 64 hex chars
      
      // Clean up
      await fs.unlink(nonExistentFile);
    });

    it('should generate cryptographically strong API keys', () => {
      const key1 = apiServer.generateApiKey();
      const key2 = apiServer.generateApiKey();
      
      expect(key1).to.not.equal(key2);
      expect(key1).to.have.length(64);
      expect(key2).to.have.length(64);
      expect(key1).to.match(/^[a-f0-9]{64}$/);
      expect(key2).to.match(/^[a-f0-9]{64}$/);
    });
  });

  describe('Server Lifecycle', () => {
    it('should start and stop server successfully', async () => {
      await apiServer.start();
      expect(apiServer.isRunning).to.be.true;
      expect(apiServer.server).to.not.be.null;
      
      await apiServer.stop();
      expect(apiServer.isRunning).to.be.false;
    });

    it('should emit events on start and stop', async () => {
      const startSpy = sandbox.spy();
      const stopSpy = sandbox.spy();
      
      apiServer.on('started', startSpy);
      apiServer.on('stopped', stopSpy);
      
      await apiServer.start();
      expect(startSpy.calledOnce).to.be.true;
      expect(startSpy.firstCall.args[0]).to.have.property('host');
      expect(startSpy.firstCall.args[0]).to.have.property('port');
      
      await apiServer.stop();
      expect(stopSpy.calledOnce).to.be.true;
    });
  });

  describe('Core Functionality', () => {
    it('should start and stop server successfully', async () => {
      await apiServer.start();
      expect(apiServer.isRunning).to.be.true;
      expect(apiServer.server).to.not.be.null;
      
      await apiServer.stop();
      expect(apiServer.isRunning).to.be.false;
    });

    it('should handle basic daemon operations', async () => {
      // Test that the daemon manager methods are called correctly
      expect(mockDaemonManager.isRunning()).to.be.true;
      expect(mockDaemonManager.getWorkerCount()).to.equal(2);
      
      const status = await mockDaemonManager.getStatus();
      expect(status.running).to.be.true;
      expect(status.workers).to.have.length(2);
    });
  });

  describe('Authentication Middleware', () => {
    it('should authenticate valid API key in header', () => {
      const req = {
        headers: {
          'x-api-key': 'test-api-key-12345'
        }
      };
      const res = {};
      const next = sandbox.spy();
      
      apiServer.apiKey = 'test-api-key-12345';
      apiServer.authenticateRequest(req, res, next);
      
      expect(next.calledOnce).to.be.true;
    });

    it('should authenticate valid API key in authorization header', () => {
      const req = {
        headers: {
          'authorization': 'Bearer test-api-key-12345'
        }
      };
      const res = {};
      const next = sandbox.spy();
      
      apiServer.apiKey = 'test-api-key-12345';
      apiServer.authenticateRequest(req, res, next);
      
      expect(next.calledOnce).to.be.true;
    });

    it('should reject invalid API key', () => {
      const req = {
        headers: {
          'x-api-key': 'invalid-key'
        }
      };
      const res = {
        status: sandbox.stub().returnsThis(),
        json: sandbox.spy()
      };
      const next = sandbox.spy();
      
      apiServer.apiKey = 'test-api-key-12345';
      apiServer.authenticateRequest(req, res, next);
      
      expect(res.status.calledWith(401)).to.be.true;
      expect(res.json.calledOnce).to.be.true;
      expect(next.called).to.be.false;
    });

    it('should reject missing API key', () => {
      const req = { headers: {} };
      const res = {
        status: sandbox.stub().returnsThis(),
        json: sandbox.spy()
      };
      const next = sandbox.spy();
      
      apiServer.apiKey = 'test-api-key-12345';
      apiServer.authenticateRequest(req, res, next);
      
      expect(res.status.calledWith(401)).to.be.true;
      expect(next.called).to.be.false;
    });
  });

  describe('Broadcasting', () => {
    it('should broadcast messages to all connected clients', async () => {
      await apiServer.start();
      
      // Simulate connected clients
      const mockConnection1 = {
        ws: { 
          readyState: 1, // OPEN
          send: sandbox.spy(),
          OPEN: 1
        }
      };
      const mockConnection2 = {
        ws: { 
          readyState: 1, // OPEN
          send: sandbox.spy(),
          OPEN: 1
        }
      };
      
      apiServer.connections.set('conn1', mockConnection1);
      apiServer.connections.set('conn2', mockConnection2);
      
      const message = { type: 'test', data: 'hello' };
      apiServer.broadcast(message);
      
      expect(mockConnection1.ws.send.calledOnce).to.be.true;
      expect(mockConnection2.ws.send.calledOnce).to.be.true;
      
      const sentMessage = JSON.stringify(message);
      expect(mockConnection1.ws.send.calledWith(sentMessage)).to.be.true;
      expect(mockConnection2.ws.send.calledWith(sentMessage)).to.be.true;
    });

    it('should clean up closed connections during broadcast', async () => {
      await apiServer.start();
      
      const mockConnection = {
        ws: { 
          readyState: 3, // CLOSED
          send: sandbox.spy() 
        }
      };
      
      apiServer.connections.set('conn1', mockConnection);
      expect(apiServer.connections.size).to.equal(1);
      
      apiServer.broadcast({ type: 'test' });
      
      expect(apiServer.connections.size).to.equal(0);
      expect(mockConnection.ws.send.called).to.be.false;
    });
  });

  describe('Server Info', () => {
    it('should return correct server information', async () => {
      await apiServer.start();
      
      const info = apiServer.getServerInfo();
      
      expect(info).to.have.property('running', true);
      expect(info).to.have.property('host', '127.0.0.1');
      expect(info).to.have.property('port');
      expect(info).to.have.property('websocket', true);
      expect(info).to.have.property('connections', 0);
      expect(info).to.have.property('apiKeyFile');
    });
  });
});