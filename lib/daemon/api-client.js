/**
 * Daemon API Client
 * CLIコマンドがデーモンとの通信に使用するクライアント
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const axios = require('axios');
const WebSocket = require('ws');
const EventEmitter = require('events');

class DaemonAPIClient extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      host: options.host || '127.0.0.1',
      port: options.port || 45678,
      timeout: options.timeout || 30000,
      apiKeyFile: options.apiKeyFile || path.join(os.homedir(), '.poppobuilder', 'daemon.key'),
      retries: options.retries || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };
    
    this.apiKey = null;
    this.wsClient = null;
    this.isConnected = false;
    
    // Axios instance with default configuration
    this.http = axios.create({
      baseURL: `http://${this.options.host}:${this.options.port}`,
      timeout: this.options.timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    // Add request interceptor for authentication
    this.http.interceptors.request.use((config) => {
      if (this.apiKey) {
        config.headers['X-API-Key'] = this.apiKey;
      }
      return config;
    });
  }

  /**
   * Initialize client and load API key
   */
  async initialize() {
    try {
      await this.loadApiKey();
      this.emit('initialized');
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize API client: ${error.message}`);
    }
  }

  /**
   * Load API key from file
   */
  async loadApiKey() {
    try {
      const apiKeyData = await fs.readFile(this.options.apiKeyFile, 'utf8');
      this.apiKey = apiKeyData.trim();
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error('Daemon is not running or API key file not found');
      }
      throw error;
    }
  }

  /**
   * Check if daemon is running
   */
  async isRunning() {
    try {
      const response = await this.http.get('/health');
      return response.data.status === 'ok';
    } catch (error) {
      return false;
    }
  }

  /**
   * Wait for daemon to be ready
   */
  async waitForDaemon(timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      if (await this.isRunning()) {
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    throw new Error('Timeout waiting for daemon to be ready');
  }

  /**
   * Get daemon information
   */
  async getInfo() {
    const response = await this.request('GET', '/api/info');
    return response.data;
  }

  /**
   * Get daemon status
   */
  async getStatus() {
    const response = await this.request('GET', '/api/daemon/status');
    return response.data;
  }

  /**
   * Start daemon
   */
  async startDaemon() {
    const response = await this.request('POST', '/api/daemon/start');
    return response.data;
  }

  /**
   * Stop daemon
   */
  async stopDaemon() {
    const response = await this.request('POST', '/api/daemon/stop');
    return response.data;
  }

  /**
   * Restart daemon
   */
  async restartDaemon() {
    const response = await this.request('POST', '/api/daemon/restart');
    return response.data;
  }

  /**
   * Reload daemon configuration
   */
  async reloadDaemon() {
    const response = await this.request('POST', '/api/daemon/reload');
    return response.data;
  }

  /**
   * Get workers
   */
  async getWorkers() {
    const response = await this.request('GET', '/api/workers');
    return response.data;
  }

  /**
   * Restart specific worker
   */
  async restartWorker(pid) {
    const response = await this.request('POST', `/api/workers/${pid}/restart`);
    return response.data;
  }

  /**
   * Get projects
   */
  async getProjects() {
    const response = await this.request('GET', '/api/projects');
    return response.data;
  }

  /**
   * Get specific project
   */
  async getProject(id) {
    const response = await this.request('GET', `/api/projects/${id}`);
    return response.data;
  }

  /**
   * Enable project
   */
  async enableProject(id) {
    const response = await this.request('POST', `/api/projects/${id}/enable`);
    return response.data;
  }

  /**
   * Disable project
   */
  async disableProject(id) {
    const response = await this.request('POST', `/api/projects/${id}/disable`);
    return response.data;
  }

  /**
   * Get global configuration
   */
  async getConfig() {
    const response = await this.request('GET', '/api/config');
    return response.data;
  }

  /**
   * Update global configuration
   */
  async updateConfig(config) {
    const response = await this.request('POST', '/api/config', config);
    return response.data;
  }

  /**
   * Connect to WebSocket for real-time updates
   */
  async connectWebSocket() {
    if (this.wsClient) {
      this.wsClient.close();
    }

    const wsUrl = `ws://${this.options.host}:${this.options.port}/ws?api_key=${this.apiKey}`;
    
    this.wsClient = new WebSocket(wsUrl);
    
    this.wsClient.on('open', () => {
      this.isConnected = true;
      this.emit('ws-connected');
    });
    
    this.wsClient.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        this.emit('ws-message', message);
        
        // Emit specific event types
        if (message.type) {
          this.emit(`ws-${message.type}`, message);
        }
      } catch (error) {
        this.emit('ws-error', error);
      }
    });
    
    this.wsClient.on('close', () => {
      this.isConnected = false;
      this.emit('ws-disconnected');
    });
    
    this.wsClient.on('error', (error) => {
      this.emit('ws-error', error);
    });
    
    return new Promise((resolve, reject) => {
      this.wsClient.once('open', resolve);
      this.wsClient.once('error', reject);
    });
  }

  /**
   * Disconnect WebSocket
   */
  disconnectWebSocket() {
    if (this.wsClient) {
      this.wsClient.close();
      this.wsClient = null;
      this.isConnected = false;
    }
  }

  /**
   * Subscribe to WebSocket events
   */
  subscribeToEvents(events) {
    if (!this.wsClient || !this.isConnected) {
      throw new Error('WebSocket is not connected');
    }
    
    this.wsClient.send(JSON.stringify({
      type: 'subscribe',
      events: events
    }));
  }

  /**
   * Send command via WebSocket
   */
  sendCommand(command, args = {}) {
    if (!this.wsClient || !this.isConnected) {
      throw new Error('WebSocket is not connected');
    }
    
    this.wsClient.send(JSON.stringify({
      type: 'daemon_command',
      command: command,
      args: args
    }));
  }

  /**
   * Make HTTP request with retry logic
   */
  async request(method, url, data = null) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.options.retries; attempt++) {
      try {
        const config = {
          method: method.toLowerCase(),
          url: url
        };
        
        if (data) {
          config.data = data;
        }
        
        return await this.http(config);
        
      } catch (error) {
        lastError = error;
        
        if (error.response) {
          // HTTP error response
          if (error.response.status === 401) {
            throw new Error('Unauthorized: Invalid API key');
          }
          if (error.response.status === 404) {
            throw new Error('API endpoint not found');
          }
          if (error.response.status >= 500) {
            // Server error, retry
            if (attempt < this.options.retries) {
              await new Promise(resolve => 
                setTimeout(resolve, this.options.retryDelay * attempt)
              );
              continue;
            }
          }
          throw new Error(`HTTP ${error.response.status}: ${error.response.data?.error || error.message}`);
        } else if (error.code === 'ECONNREFUSED') {
          // Connection refused
          if (attempt < this.options.retries) {
            await new Promise(resolve => 
              setTimeout(resolve, this.options.retryDelay * attempt)
            );
            continue;
          }
          throw new Error('Cannot connect to daemon (is it running?)');
        } else {
          // Other errors
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Close all connections
   */
  async close() {
    this.disconnectWebSocket();
    this.removeAllListeners();
  }

  /**
   * Get connection info
   */
  getConnectionInfo() {
    return {
      host: this.options.host,
      port: this.options.port,
      apiKeyFile: this.options.apiKeyFile,
      hasApiKey: !!this.apiKey,
      wsConnected: this.isConnected
    };
  }
}

module.exports = DaemonAPIClient;