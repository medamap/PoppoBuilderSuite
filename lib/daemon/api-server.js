/**
 * Daemon API Server
 * CLIとデーモンプロセス間の通信を管理するAPIサーバー
 */

const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const EventEmitter = require('events');

class DaemonAPIServer extends EventEmitter {
  constructor(daemonManager, options = {}) {
    super();
    
    this.daemonManager = daemonManager;
    this.options = {
      port: options.port || 45678,
      host: options.host || '127.0.0.1',
      enableWebSocket: options.enableWebSocket !== false,
      enableAuth: options.enableAuth !== false,
      apiKeyFile: options.apiKeyFile || path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'daemon.key'),
      ...options
    };
    
    this.app = express();
    this.server = null;
    this.wsServer = null;
    this.isRunning = false;
    this.connections = new Map();
    this.apiKey = null;
    
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * APIサーバーを開始
   */
  async start() {
    try {
      // API キーの初期化
      await this.initializeApiKey();
      
      // HTTPサーバーの作成
      this.server = createServer(this.app);
      
      // WebSocketサーバーの設定
      if (this.options.enableWebSocket) {
        this.setupWebSocket();
      }
      
      // サーバー開始
      await new Promise((resolve, reject) => {
        this.server.listen(this.options.port, this.options.host, (error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
      
      this.isRunning = true;
      console.log(`Daemon API Server started on ${this.options.host}:${this.options.port}`);
      console.log(`API Key file: ${this.options.apiKeyFile}`);
      
      this.emit('started', { 
        host: this.options.host, 
        port: this.options.port,
        apiKeyFile: this.options.apiKeyFile
      });
      
    } catch (error) {
      console.error('Failed to start Daemon API Server:', error);
      throw error;
    }
  }

  /**
   * APIサーバーを停止
   */
  async stop() {
    try {
      if (this.wsServer) {
        this.wsServer.close();
      }
      
      if (this.server) {
        await new Promise((resolve) => {
          this.server.close(resolve);
        });
      }
      
      this.isRunning = false;
      this.emit('stopped');
      console.log('Daemon API Server stopped');
      
    } catch (error) {
      console.error('Error stopping Daemon API Server:', error);
      throw error;
    }
  }

  /**
   * API キーの初期化
   */
  async initializeApiKey() {
    try {
      // 既存のAPI キーを読み込み
      const apiKeyData = await fs.readFile(this.options.apiKeyFile, 'utf8');
      this.apiKey = apiKeyData.trim();
    } catch (error) {
      // API キーファイルが存在しない場合は新規作成
      this.apiKey = this.generateApiKey();
      
      // ディレクトリの作成
      const keyDir = path.dirname(this.options.apiKeyFile);
      await fs.mkdir(keyDir, { recursive: true });
      
      // API キーファイルの保存
      await fs.writeFile(this.options.apiKeyFile, this.apiKey, 'utf8');
      await fs.chmod(this.options.apiKeyFile, 0o600); // 読み取り専用
      
      console.log('Generated new API key for daemon authentication');
    }
  }

  /**
   * API キーの生成
   */
  generateApiKey() {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Express ミドルウェアの設定
   */
  setupMiddleware() {
    // JSON パーサー
    this.app.use(express.json({ limit: '10mb' }));
    
    // CORS設定（ローカルのみ）
    this.app.use((req, res, next) => {
      const origin = req.get('origin');
      if (!origin || origin.includes('127.0.0.1') || origin.includes('localhost')) {
        res.header('Access-Control-Allow-Origin', origin || '*');
        res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
      }
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });

    // 認証ミドルウェア
    if (this.options.enableAuth) {
      this.app.use('/api', this.authenticateRequest.bind(this));
    }

    // リクエストログ
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });
  }

  /**
   * APIルートの設定
   */
  setupRoutes() {
    // ヘルスチェック
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        daemon: {
          running: this.daemonManager.isRunning(),
          workers: this.daemonManager.getWorkerCount()
        }
      });
    });

    // API情報
    this.app.get('/api/info', (req, res) => {
      res.json({
        version: '1.0.0',
        daemon: {
          running: this.daemonManager.isRunning(),
          pid: process.pid,
          uptime: process.uptime(),
          workers: this.daemonManager.getWorkerCount()
        },
        api: {
          host: this.options.host,
          port: this.options.port,
          websocket: this.options.enableWebSocket
        }
      });
    });

    // デーモン制御
    this.app.post('/api/daemon/start', async (req, res) => {
      try {
        if (this.daemonManager.isRunning()) {
          return res.status(400).json({ error: 'Daemon is already running' });
        }
        
        await this.daemonManager.start();
        res.json({ message: 'Daemon started successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/daemon/stop', async (req, res) => {
      try {
        if (!this.daemonManager.isRunning()) {
          return res.status(400).json({ error: 'Daemon is not running' });
        }
        
        await this.daemonManager.stop();
        res.json({ message: 'Daemon stopped successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/daemon/restart', async (req, res) => {
      try {
        await this.daemonManager.restart();
        res.json({ message: 'Daemon restarted successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/daemon/reload', async (req, res) => {
      try {
        await this.daemonManager.reload();
        res.json({ message: 'Configuration reloaded successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // デーモン状態取得
    this.app.get('/api/daemon/status', async (req, res) => {
      try {
        const status = await this.daemonManager.getStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ワーカー管理
    this.app.get('/api/workers', (req, res) => {
      try {
        const workers = this.daemonManager.getWorkers();
        const workerList = Array.from(workers.entries()).map(([pid, info]) => ({
          pid,
          id: info.id,
          startTime: info.startTime,
          restarts: info.restarts,
          uptime: Date.now() - info.startTime
        }));
        
        res.json(workerList);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/workers/:pid/restart', (req, res) => {
      try {
        const pid = parseInt(req.params.pid);
        this.daemonManager.restartWorker(pid);
        res.json({ message: `Worker ${pid} restart initiated` });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // プロジェクト管理（ProjectRegistryとの統合）
    this.app.get('/api/projects', async (req, res) => {
      try {
        const { getInstance } = require('../core/project-registry');
        const projectRegistry = getInstance();
        await projectRegistry.initialize();
        
        const projects = projectRegistry.getAllProjects();
        res.json(projects);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/projects/:id', async (req, res) => {
      try {
        const { getInstance } = require('../core/project-registry');
        const projectRegistry = getInstance();
        await projectRegistry.initialize();
        
        const project = projectRegistry.getProject(req.params.id);
        if (!project) {
          return res.status(404).json({ error: 'Project not found' });
        }
        
        res.json(project);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/projects/:id/enable', async (req, res) => {
      try {
        const { getInstance } = require('../core/project-registry');
        const projectRegistry = getInstance();
        await projectRegistry.initialize();
        
        await projectRegistry.setEnabled(req.params.id, true);
        res.json({ message: 'Project enabled successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/projects/:id/disable', async (req, res) => {
      try {
        const { getInstance } = require('../core/project-registry');
        const projectRegistry = getInstance();
        await projectRegistry.initialize();
        
        await projectRegistry.setEnabled(req.params.id, false);
        res.json({ message: 'Project disabled successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // グローバル設定管理
    this.app.get('/api/config', async (req, res) => {
      try {
        const { getInstance } = require('../core/global-config-manager');
        const configManager = getInstance();
        const config = configManager.getAll();
        res.json(config);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/config', async (req, res) => {
      try {
        const { getInstance } = require('../core/global-config-manager');
        const configManager = getInstance();
        await configManager.update(req.body);
        res.json({ message: 'Configuration updated successfully' });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // Configuration update with live reload support
    this.app.post('/api/config/update', async (req, res) => {
      try {
        const { changes } = req.body;
        if (!changes || typeof changes !== 'object') {
          return res.status(400).json({ error: 'Invalid request: changes object required' });
        }

        const ConfigUpdater = require('../utils/config-updater');
        const { getInstance } = require('../core/global-config-manager');
        const configManager = getInstance();

        // Apply changes to configuration
        for (const [key, value] of Object.entries(changes)) {
          await configManager.set(key, value);
        }

        // Check which changes can be applied without restart
        const restartRequired = ConfigUpdater.getRestartRequiredChanges(changes);
        const applicable = ConfigUpdater.getApplicableChanges(changes);

        // Apply live changes if daemon is running
        if (this.daemonManager.isRunning() && applicable.length > 0) {
          await this.daemonManager.applyConfigChanges(changes);
        }

        res.json({
          success: true,
          applied: applicable,
          restartRequired: restartRequired,
          requiresRestart: restartRequired.length > 0,
          message: restartRequired.length > 0 
            ? 'Some configuration changes require daemon restart' 
            : 'Configuration applied successfully'
        });

      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // ログ管理
    this.app.get('/api/logs', async (req, res) => {
      try {
        const LogAggregator = require('../utils/log-aggregator');
        const { GlobalConfig } = require('../core/global-config');
        
        const globalConfig = new GlobalConfig();
        await globalConfig.initialize();
        const globalLogDir = path.join(globalConfig.getGlobalDir(), 'logs');
        
        const aggregator = new LogAggregator({ globalLogDir });
        await aggregator.initialize();
        
        // Register projects
        const registry = globalConfig.getProjectRegistry();
        for (const [projectId, projectInfo] of Object.entries(registry.projects || {})) {
          if (projectInfo.path) {
            aggregator.registerProject(projectId, projectInfo.path);
          }
        }
        
        // Build search criteria from query params
        const criteria = {
          level: req.query.level,
          projectId: req.query.project,
          component: req.query.component,
          query: req.query.q,
          limit: req.query.limit ? parseInt(req.query.limit, 10) : 100,
          includeGlobal: req.query.global !== 'false',
          includeProjects: req.query.projects !== 'false',
          includeDaemon: req.query.daemon !== 'false'
        };
        
        if (req.query.since) {
          criteria.startTime = new Date(req.query.since);
        }
        if (req.query.until) {
          criteria.endTime = new Date(req.query.until);
        }
        
        const logs = await aggregator.search(criteria);
        res.json(logs);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/logs/aggregate', async (req, res) => {
      try {
        const LogAggregator = require('../utils/log-aggregator');
        const { GlobalConfig } = require('../core/global-config');
        
        const globalConfig = new GlobalConfig();
        await globalConfig.initialize();
        const globalLogDir = path.join(globalConfig.getGlobalDir(), 'logs');
        
        const aggregator = new LogAggregator({ globalLogDir });
        await aggregator.initialize();
        
        // Register projects
        const registry = globalConfig.getProjectRegistry();
        for (const [projectId, projectInfo] of Object.entries(registry.projects || {})) {
          if (projectInfo.path) {
            aggregator.registerProject(projectId, projectInfo.path);
          }
        }
        
        const result = await aggregator.aggregate({
          groupBy: req.query.groupBy || 'level',
          startTime: req.query.since ? new Date(req.query.since) : undefined,
          endTime: req.query.until ? new Date(req.query.until) : undefined,
          includeStats: req.query.stats !== 'false'
        });
        
        res.json(result);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/logs/errors', async (req, res) => {
      try {
        const LogAggregator = require('../utils/log-aggregator');
        const { GlobalConfig } = require('../core/global-config');
        
        const globalConfig = new GlobalConfig();
        await globalConfig.initialize();
        const globalLogDir = path.join(globalConfig.getGlobalDir(), 'logs');
        
        const aggregator = new LogAggregator({ globalLogDir });
        await aggregator.initialize();
        
        // Register projects
        const registry = globalConfig.getProjectRegistry();
        for (const [projectId, projectInfo] of Object.entries(registry.projects || {})) {
          if (projectInfo.path) {
            aggregator.registerProject(projectId, projectInfo.path);
          }
        }
        
        const summary = await aggregator.getErrorSummary({
          startTime: req.query.since ? new Date(req.query.since) : undefined,
          endTime: req.query.until ? new Date(req.query.until) : undefined,
          groupByComponent: req.query.groupByComponent !== 'false'
        });
        
        res.json(summary);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // モニタリング
    this.app.get('/api/monitoring/status', async (req, res) => {
      try {
        const monitoring = this.daemonManager.monitoring;
        if (!monitoring) {
          return res.status(503).json({ error: 'Monitoring not available' });
        }
        
        const status = monitoring.getStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/monitoring/health', async (req, res) => {
      try {
        const monitoring = this.daemonManager.monitoring;
        if (!monitoring || !monitoring.healthChecker) {
          return res.status(503).json({ error: 'Health checker not available' });
        }
        
        const health = monitoring.healthChecker.getStatus();
        const statusCode = health.overall === 'healthy' ? 200 : 503;
        res.status(statusCode).json(health);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/monitoring/processes', async (req, res) => {
      try {
        const monitoring = this.daemonManager.monitoring;
        if (!monitoring || !monitoring.processMonitor) {
          return res.status(503).json({ error: 'Process monitor not available' });
        }
        
        const processes = monitoring.processMonitor.getAllProcesses();
        res.json(processes);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/monitoring/processes/:pid', async (req, res) => {
      try {
        const monitoring = this.daemonManager.monitoring;
        if (!monitoring || !monitoring.processMonitor) {
          return res.status(503).json({ error: 'Process monitor not available' });
        }
        
        const pid = parseInt(req.params.pid);
        const process = monitoring.processMonitor.getProcess(pid);
        
        if (!process) {
          return res.status(404).json({ error: 'Process not found' });
        }
        
        const stats = monitoring.processMonitor.getProcessStats(pid);
        const history = monitoring.processMonitor.getHistory(pid, 100);
        
        res.json({
          process,
          stats,
          history
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/monitoring/metrics', async (req, res) => {
      try {
        const monitoring = this.daemonManager.monitoring;
        if (!monitoring || !monitoring.healthChecker) {
          return res.status(503).json({ error: 'Monitoring not available' });
        }
        
        const format = req.query.format || 'json';
        
        if (format === 'prometheus') {
          const metrics = await monitoring.healthChecker.exportStatus('prometheus');
          res.type('text/plain').send(metrics);
        } else {
          const report = await monitoring.generateReport('json');
          res.json(JSON.parse(report));
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/monitoring/recovery', async (req, res) => {
      try {
        const monitoring = this.daemonManager.monitoring;
        if (!monitoring || !monitoring.autoRecovery) {
          return res.status(503).json({ error: 'Auto recovery not available' });
        }
        
        const stats = monitoring.autoRecovery.getRecoveryStats();
        const history = monitoring.autoRecovery.getRecoveryHistory();
        
        res.json({
          stats,
          history
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/monitoring/recovery/:issue', async (req, res) => {
      try {
        const monitoring = this.daemonManager.monitoring;
        if (!monitoring) {
          return res.status(503).json({ error: 'Monitoring not available' });
        }
        
        const issue = req.params.issue;
        const context = req.body || {};
        
        const result = await monitoring.attemptRecovery(issue, context);
        
        if (result) {
          res.json(result);
        } else {
          res.status(503).json({ 
            error: 'Recovery not possible',
            message: 'Recovery disabled, in cooldown, or max retries reached'
          });
        }
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // プロセスプール管理
    this.app.get('/api/process-pool/stats', async (req, res) => {
      try {
        const stats = await this.daemonManager.getProcessPoolStats();
        res.json(stats);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.post('/api/process-pool/project-limit', async (req, res) => {
      try {
        const { projectId, limit } = req.body;
        if (!projectId || typeof limit !== 'number') {
          return res.status(400).json({ 
            error: 'projectId and limit (number) are required' 
          });
        }
        
        await this.daemonManager.setProjectProcessLimit(projectId, limit);
        res.json({ 
          message: 'Project process limit updated successfully',
          projectId,
          limit 
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/process-pool/project-usage', async (req, res) => {
      try {
        const usage = await this.daemonManager.getProjectProcessUsage();
        res.json(usage);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // エラーハンドリング
    this.app.use((error, req, res, next) => {
      console.error('API Error:', error);
      res.status(500).json({ 
        error: 'Internal server error',
        message: error.message 
      });
    });

    // 404ハンドリング
    this.app.use((req, res) => {
      res.status(404).json({ error: 'API endpoint not found' });
    });
  }

  /**
   * WebSocketサーバーの設定
   */
  setupWebSocket() {
    this.wsServer = new WebSocketServer({ 
      server: this.server,
      path: '/ws'
    });

    this.wsServer.on('connection', (ws, req) => {
      const connectionId = crypto.randomUUID();
      
      console.log(`WebSocket connected: ${connectionId}`);
      
      this.connections.set(connectionId, {
        ws,
        connectedAt: new Date(),
        lastPing: new Date()
      });

      // 認証（WebSocket）
      if (this.options.enableAuth) {
        const apiKey = new URL(req.url, 'http://localhost').searchParams.get('api_key');
        if (apiKey !== this.apiKey) {
          ws.close(1008, 'Invalid API key');
          return;
        }
      }

      // Ping/Pong
      const pingInterval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.ping();
        }
      }, 30000);

      ws.on('pong', () => {
        const connection = this.connections.get(connectionId);
        if (connection) {
          connection.lastPing = new Date();
        }
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleWebSocketMessage(ws, message, connectionId);
        } catch (error) {
          ws.send(JSON.stringify({ 
            type: 'error', 
            error: 'Invalid JSON message' 
          }));
        }
      });

      ws.on('close', () => {
        clearInterval(pingInterval);
        this.connections.delete(connectionId);
        console.log(`WebSocket disconnected: ${connectionId}`);
      });

      // 接続確認メッセージ
      ws.send(JSON.stringify({
        type: 'connected',
        connectionId,
        timestamp: new Date().toISOString()
      }));
    });
  }

  /**
   * WebSocketメッセージの処理
   */
  handleWebSocketMessage(ws, message, connectionId) {
    switch (message.type) {
      case 'subscribe':
        // イベント購読の設定
        this.subscribeToEvents(ws, message.events || []);
        break;
        
      case 'daemon_command':
        // デーモンコマンドの実行
        this.executeDaemonCommand(ws, message.command, message.args);
        break;
        
      default:
        ws.send(JSON.stringify({
          type: 'error',
          error: `Unknown message type: ${message.type}`
        }));
    }
  }

  /**
   * イベント購読の設定
   */
  subscribeToEvents(ws, events) {
    // デーモンイベントの転送
    if (events.includes('daemon')) {
      const forwardEvent = (eventName, data) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({
            type: 'event',
            event: eventName,
            data
          }));
        }
      };

      this.daemonManager.on('worker-started', (data) => forwardEvent('worker-started', data));
      this.daemonManager.on('worker-stopped', (data) => forwardEvent('worker-stopped', data));
      this.daemonManager.on('config-reloaded', (data) => forwardEvent('config-reloaded', data));
    }

    ws.send(JSON.stringify({
      type: 'subscribed',
      events
    }));
  }

  /**
   * デーモンコマンドの実行
   */
  async executeDaemonCommand(ws, command, args = {}) {
    try {
      let result;
      
      switch (command) {
        case 'status':
          result = await this.daemonManager.getStatus();
          break;
        case 'reload':
          await this.daemonManager.reload();
          result = { message: 'Configuration reloaded' };
          break;
        default:
          throw new Error(`Unknown command: ${command}`);
      }
      
      ws.send(JSON.stringify({
        type: 'command_result',
        command,
        result
      }));
      
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'command_error',
        command,
        error: error.message
      }));
    }
  }

  /**
   * リクエスト認証
   */
  authenticateRequest(req, res, next) {
    const apiKey = req.headers['x-api-key'] || req.headers['authorization']?.replace('Bearer ', '');
    
    if (!apiKey || apiKey !== this.apiKey) {
      return res.status(401).json({ 
        error: 'Unauthorized',
        message: 'Valid API key required' 
      });
    }
    
    next();
  }

  /**
   * WebSocketクライアントにブロードキャスト
   */
  broadcast(message) {
    const messageString = JSON.stringify(message);
    
    this.connections.forEach((connection, connectionId) => {
      if (connection.ws.readyState === 1) { // WebSocket.OPEN = 1
        connection.ws.send(messageString);
      } else {
        this.connections.delete(connectionId);
      }
    });
  }

  /**
   * サーバー情報の取得
   */
  getServerInfo() {
    return {
      running: this.isRunning,
      host: this.options.host,
      port: this.options.port,
      websocket: this.options.enableWebSocket,
      connections: this.connections.size,
      apiKeyFile: this.options.apiKeyFile
    };
  }
}

module.exports = DaemonAPIServer;