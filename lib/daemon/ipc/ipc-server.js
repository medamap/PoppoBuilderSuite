/**
 * IPC Server for PoppoBuilder Daemon
 * Provides Unix domain socket/named pipe server for local communication
 */

const net = require('net');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const Protocol = require('./protocol');
const Commands = require('./commands');

class IPCServer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.socketPath = options.socketPath || this._getDefaultSocketPath();
    this.authToken = options.authToken; // Optional authentication
    this.server = null;
    this.clients = new Map();
    this.commands = new Commands();
    this.protocol = new Protocol();
    this.logger = options.logger || console;
    this.daemon = null; // Will be set by daemon
    
    // Cleanup on exit
    process.on('exit', () => this.stop());
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
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
   * Start the IPC server
   */
  async start() {
    try {
      // Ensure socket directory exists
      const socketDir = path.dirname(this.socketPath);
      await fs.mkdir(socketDir, { recursive: true });
      
      // Clean up any existing socket file
      await this._cleanupSocket();
      
      this.server = net.createServer((socket) => {
        this._handleClient(socket);
      });
      
      this.server.on('error', (err) => {
        this.logger.error('IPC server error:', err);
        this.emit('error', err);
      });
      
      await new Promise((resolve, reject) => {
        this.server.listen(this.socketPath, () => {
          this.logger.info(`IPC server listening on ${this.socketPath}`);
          this.emit('listening', this.socketPath);
          resolve();
        });
        
        this.server.once('error', reject);
      });
      
      // Set permissions for Unix sockets
      if (process.platform !== 'win32') {
        await fs.chmod(this.socketPath, 0o600);
      }
      
    } catch (error) {
      this.logger.error('Failed to start IPC server:', error);
      throw error;
    }
  }
  
  /**
   * Stop the IPC server
   */
  async stop() {
    if (!this.server) return;
    
    try {
      // Close all client connections
      for (const [clientId, client] of this.clients) {
        client.socket.end();
      }
      this.clients.clear();
      
      // Close the server
      await new Promise((resolve) => {
        this.server.close(resolve);
      });
      
      // Clean up socket file
      await this._cleanupSocket();
      
      this.server = null;
      this.logger.info('IPC server stopped');
      this.emit('stopped');
      
    } catch (error) {
      this.logger.error('Error stopping IPC server:', error);
    }
  }
  
  /**
   * Handle new client connection
   */
  _handleClient(socket) {
    const clientId = uuidv4();
    const client = {
      id: clientId,
      socket,
      authenticated: !this.authToken, // Auto-authenticate if no auth required
      buffer: Buffer.alloc(0)
    };
    
    this.clients.set(clientId, client);
    this.logger.debug(`Client ${clientId} connected`);
    
    socket.on('data', (data) => {
      this._handleClientData(client, data);
    });
    
    socket.on('error', (err) => {
      this.logger.error(`Client ${clientId} error:`, err);
      this.clients.delete(clientId);
    });
    
    socket.on('close', () => {
      this.logger.debug(`Client ${clientId} disconnected`);
      this.clients.delete(clientId);
      this.emit('client-disconnected', clientId);
    });
    
    // Send welcome message
    this._sendMessage(socket, {
      type: 'welcome',
      version: '1.0.0',
      authRequired: !!this.authToken
    });
  }
  
  /**
   * Handle data from client
   */
  async _handleClientData(client, data) {
    try {
      // Append to buffer
      client.buffer = Buffer.concat([client.buffer, data]);
      
      // Try to parse messages
      let message;
      while ((message = this.protocol.parseMessage(client.buffer))) {
        client.buffer = message.remaining;
        
        // Process the message
        await this._processMessage(client, message.data);
      }
      
    } catch (error) {
      this.logger.error(`Error handling client data:`, error);
      this._sendError(client.socket, null, error);
    }
  }
  
  /**
   * Process a client message
   */
  async _processMessage(client, message) {
    try {
      // Check authentication for non-auth messages (only if auth is enabled)
      if (this.authToken && message.type !== 'auth' && !client.authenticated) {
        throw new Error('Authentication required');
      }
      
      // Handle authentication
      if (message.type === 'auth') {
        if (message.token === this.authToken) {
          client.authenticated = true;
          this._sendMessage(client.socket, {
            type: 'auth-success',
            id: message.id
          });
          this.emit('client-authenticated', client.id);
        } else {
          throw new Error('Invalid authentication token');
        }
        return;
      }
      
      // Handle commands
      if (message.type === 'command') {
        // Emit command event to be handled by daemon
        this.emit('command', message, client);
        return;
        
      } else {
        throw new Error(`Unknown message type: ${message.type}`);
      }
      
    } catch (error) {
      this._sendError(client.socket, message.id, error);
    }
  }
  
  /**
   * Send message to client
   */
  _sendMessage(socket, message) {
    if (!socket.writable) return;
    
    const encoded = this.protocol.encodeMessage(message);
    socket.write(encoded);
  }
  
  /**
   * Send error to client
   */
  _sendError(socket, messageId, error) {
    this._sendMessage(socket, {
      type: 'error',
      id: messageId,
      error: {
        message: error.message,
        code: error.code || 'UNKNOWN_ERROR',
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
      }
    });
  }
  
  /**
   * Broadcast message to all authenticated clients
   */
  broadcast(message) {
    for (const [clientId, client] of this.clients) {
      if (client.authenticated) {
        this._sendMessage(client.socket, message);
      }
    }
  }
  
  /**
   * Send message to specific client
   */
  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.authenticated) {
      this._sendMessage(client.socket, message);
    }
  }
  
  /**
   * Send response to client
   */
  sendResponse(client, messageId, result) {
    this._sendMessage(client.socket, {
      type: 'response',
      id: messageId,
      success: true,
      result
    });
  }
  
  /**
   * Send error to client
   */
  sendError(client, messageId, error) {
    this._sendError(client.socket, messageId, error);
  }
  
  /**
   * Clean up socket file
   */
  async _cleanupSocket() {
    if (process.platform === 'win32') return;
    
    try {
      await fs.unlink(this.socketPath);
    } catch (error) {
      // Ignore if file doesn't exist
      if (error.code !== 'ENOENT') {
        this.logger.debug('Socket cleanup error:', error);
      }
    }
  }
  
  /**
   * Get server info
   */
  getInfo() {
    return {
      socketPath: this.socketPath,
      authToken: this.authToken,
      clients: this.clients.size,
      authenticatedClients: Array.from(this.clients.values())
        .filter(c => c.authenticated).length
    };
  }
}

module.exports = IPCServer;