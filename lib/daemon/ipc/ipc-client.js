/**
 * IPC Client for PoppoBuilder Daemon
 * Provides client-side communication with the daemon via Unix socket/named pipe
 */

const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const Protocol = require('./protocol');

class IPCClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.socketPath = options.socketPath || this._getDefaultSocketPath();
    this.authToken = options.authToken;
    this.socket = null;
    this.connected = false;
    this.authenticated = false;
    this.protocol = new Protocol();
    this.pendingRequests = new Map();
    this.buffer = Buffer.alloc(0);
    this.reconnectDelay = options.reconnectDelay || 1000;
    this.maxReconnectDelay = options.maxReconnectDelay || 30000;
    this.currentReconnectDelay = this.reconnectDelay;
    this.autoReconnect = options.autoReconnect !== false;
    this.reconnectTimer = null;
    this.logger = options.logger || console;
  }
  
  /**
   * Get default socket path based on platform
   */
  _getDefaultSocketPath() {
    if (process.platform === 'win32') {
      return '\\\\.\\pipe\\poppobuilder-daemon';
    }
    
    return path.join(os.homedir(), '.poppobuilder', 'daemon.sock');
  }
  
  /**
   * Connect to daemon
   */
  async connect() {
    if (this.connected) return;
    
    try {
      await this._connect();
    } catch (error) {
      this.logger.error('Failed to connect:', error);
      
      if (this.autoReconnect) {
        this._scheduleReconnect();
      }
      
      throw error;
    }
  }
  
  /**
   * Internal connect implementation
   */
  async _connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.socketPath);
      
      const onConnect = () => {
        this.connected = true;
        this.currentReconnectDelay = this.reconnectDelay;
        this.logger.info('Connected to daemon');
        this.emit('connected');
        
        // Clean up listeners
        this.socket.removeListener('error', onError);
        
        // Set up socket handlers
        this._setupSocketHandlers();
        
        resolve();
      };
      
      const onError = (err) => {
        this.socket.removeListener('connect', onConnect);
        reject(err);
      };
      
      this.socket.once('connect', onConnect);
      this.socket.once('error', onError);
    });
  }
  
  /**
   * Disconnect from daemon
   */
  async disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (!this.socket) return;
    
    return new Promise((resolve) => {
      this.socket.once('close', () => {
        this.connected = false;
        this.authenticated = false;
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        
        // Reject all pending requests
        for (const [id, request] of this.pendingRequests) {
          request.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
        
        this.emit('disconnected');
        resolve();
      });
      
      this.socket.end();
    });
  }
  
  /**
   * Setup socket event handlers
   */
  _setupSocketHandlers() {
    this.socket.on('data', (data) => {
      this._handleData(data);
    });
    
    this.socket.on('error', (err) => {
      this.logger.error('Socket error:', err);
      this.emit('error', err);
    });
    
    this.socket.on('close', () => {
      this.connected = false;
      this.authenticated = false;
      this.emit('disconnected');
      
      // Reject pending requests
      for (const [id, request] of this.pendingRequests) {
        request.reject(new Error('Connection lost'));
      }
      this.pendingRequests.clear();
      
      // Schedule reconnect
      if (this.autoReconnect) {
        this._scheduleReconnect();
      }
    });
  }
  
  /**
   * Handle incoming data
   */
  _handleData(data) {
    try {
      // Append to buffer
      this.buffer = Buffer.concat([this.buffer, data]);
      
      // Try to parse messages
      let message;
      while ((message = this.protocol.parseMessage(this.buffer))) {
        this.buffer = message.remaining;
        
        // Process the message
        this._processMessage(message.data);
      }
      
    } catch (error) {
      this.logger.error('Error handling data:', error);
      this.emit('error', error);
    }
  }
  
  /**
   * Process incoming message
   */
  async _processMessage(message) {
    try {
      switch (message.type) {
        case 'welcome':
          if (message.authRequired && this.authToken) {
            await this._authenticate();
          } else if (!message.authRequired) {
            // No authentication required
            this.authenticated = true;
            this.emit('authenticated');
          }
          break;
          
        case 'auth-success':
          this.authenticated = true;
          this.emit('authenticated');
          
          // Resolve pending auth request
          const authRequest = this.pendingRequests.get(message.id);
          if (authRequest) {
            authRequest.resolve();
            this.pendingRequests.delete(message.id);
          }
          break;
          
        case 'response':
          const request = this.pendingRequests.get(message.id);
          if (request) {
            if (message.success) {
              request.resolve(message.result);
            } else {
              request.reject(new Error(message.error || 'Command failed'));
            }
            this.pendingRequests.delete(message.id);
          }
          break;
          
        case 'error':
          const errorRequest = this.pendingRequests.get(message.id);
          if (errorRequest) {
            errorRequest.reject(new Error(message.error.message));
            this.pendingRequests.delete(message.id);
          } else {
            this.emit('error', new Error(message.error.message));
          }
          break;
          
        case 'event':
          this.emit('daemon-event', message.event, message.data);
          break;
          
        default:
          this.logger.warn('Unknown message type:', message.type);
      }
      
    } catch (error) {
      this.logger.error('Error processing message:', error);
      this.emit('error', error);
    }
  }
  
  /**
   * Authenticate with daemon
   */
  async _authenticate() {
    if (!this.authToken) {
      throw new Error('No authentication token provided');
    }
    
    const id = uuidv4();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error('Authentication timeout'));
      }, 5000);
      
      this.pendingRequests.set(id, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        }
      });
      
      this._sendMessage({
        type: 'auth',
        id,
        token: this.authToken
      });
    });
  }
  
  /**
   * Send command to daemon
   */
  async sendCommand(command, args = {}, options = {}) {
    if (!this.connected) {
      throw new Error('Not connected to daemon');
    }
    
    // Only require authentication if token is provided
    if (this.authToken && !this.authenticated) {
      throw new Error('Authentication required');
    }
    
    const id = uuidv4();
    const timeout = options.timeout || 30000;
    
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Command timeout: ${command}`));
      }, timeout);
      
      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        }
      });
      
      this._sendMessage({
        type: 'command',
        id,
        command,
        args
      });
    });
  }
  
  /**
   * Send message through socket
   */
  _sendMessage(message) {
    if (!this.socket || !this.socket.writable) {
      throw new Error('Socket not writable');
    }
    
    const encoded = this.protocol.encodeMessage(message);
    this.socket.write(encoded);
  }
  
  /**
   * Schedule reconnection attempt
   */
  _scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      
      try {
        await this.connect();
      } catch (error) {
        // Exponential backoff
        this.currentReconnectDelay = Math.min(
          this.currentReconnectDelay * 2,
          this.maxReconnectDelay
        );
        
        this.logger.debug(`Reconnect failed, trying again in ${this.currentReconnectDelay}ms`);
      }
    }, this.currentReconnectDelay);
  }
  
  /**
   * Helper methods for common commands
   */
  
  async getDaemonStatus() {
    return this.sendCommand('daemon.status');
  }
  
  async stopDaemon() {
    return this.sendCommand('daemon.stop');
  }
  
  async reloadConfig() {
    return this.sendCommand('daemon.reload');
  }
  
  async listProjects() {
    return this.sendCommand('project.list');
  }
  
  async getProjectStatus(projectId) {
    return this.sendCommand('project.status', { projectId });
  }
  
  async startProject(projectId) {
    return this.sendCommand('project.start', { projectId });
  }
  
  async stopProject(projectId) {
    return this.sendCommand('project.stop', { projectId });
  }
  
  async getQueueStatus() {
    return this.sendCommand('queue.status');
  }
  
  async pauseQueue(queueName) {
    return this.sendCommand('queue.pause', { queue: queueName });
  }
  
  async resumeQueue(queueName) {
    return this.sendCommand('queue.resume', { queue: queueName });
  }
  
  async getWorkerStatus() {
    return this.sendCommand('worker.status');
  }
  
  async scaleWorkers(count) {
    return this.sendCommand('worker.scale', { count });
  }
}

module.exports = IPCClient;