const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const LogSearchAPI = require('./api/logs');
const AnalyticsAPI = require('./api/analytics');
const HealthAPI = require('./api/health');
const ProcessAPI = require('./api/process');

/**
 * PoppoBuilder Process Dashboard Server
 */
class DashboardServer {
  constructor(config, processStateManager, logger, healthCheckManager = null, independentProcessManager = null) {
    this.config = config.dashboard || {
      enabled: true,
      port: 3001,
      host: 'localhost',
      updateInterval: 5000
    };
    
    this.stateManager = processStateManager;
    this.logger = logger;
    this.healthCheckManager = healthCheckManager;
    this.independentProcessManager = independentProcessManager;
    
    if (!this.config.enabled) {
      this.logger?.info('ダッシュボードは無効化されています');
      return;
    }
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    
    // ログ検索APIの初期化
    this.logSearchAPI = new LogSearchAPI(this.logger);
    
    // ヘルスチェックAPIの初期化
    this.healthAPI = new HealthAPI(this.healthCheckManager);
    
    // プロセス管理APIの初期化
    this.processAPI = this.independentProcessManager ? 
      new ProcessAPI(this.stateManager, this.independentProcessManager, this.logger) : null;
    
    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * APIルートの設定
   */
  setupRoutes() {
    // 静的ファイルの提供
    this.app.use(express.static(path.join(__dirname, '../client')));
    
    // CORS設定（開発用）
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      next();
    });
    
    // プロセス一覧API
    this.app.get('/api/processes', (req, res) => {
      const processes = this.stateManager.getAllProcesses();
      res.json(processes);
    });
    
    // 実行中プロセス一覧API
    this.app.get('/api/processes/running', (req, res) => {
      const processes = this.stateManager.getRunningProcesses();
      res.json(processes);
    });
    
    // 特定プロセスの詳細API
    this.app.get('/api/processes/:processId', (req, res) => {
      const process = this.stateManager.getProcess(req.params.processId);
      if (process) {
        res.json(process);
      } else {
        res.status(404).json({ error: 'Process not found' });
      }
    });
    
    // システム統計API
    this.app.get('/api/system/stats', (req, res) => {
      const stats = this.stateManager.getSystemStats();
      res.json(stats);
    });
    
    // ログ取得API（最新のログファイルから）
    this.app.get('/api/logs/:processId', (req, res) => {
      const logDir = path.join(__dirname, '../../logs');
      const logFile = path.join(logDir, `${req.params.processId}.log`);
      
      if (fs.existsSync(logFile)) {
        const logs = fs.readFileSync(logFile, 'utf8');
        res.json({ 
          processId: req.params.processId,
          content: logs.split('\n').slice(-100) // 最新100行
        });
      } else {
        res.status(404).json({ error: 'Log file not found' });
      }
    });
    
    // 基本的なヘルスチェック（HealthAPIが無い場合のフォールバック）
    this.app.get('/api/health', (req, res, next) => {
      if (this.healthAPI) {
        // HealthAPIが存在する場合は次のミドルウェアへ
        next();
      } else {
        // フォールバック
        res.json({ 
          status: 'ok',
          timestamp: new Date().toISOString(),
          uptime: process.uptime()
        });
      }
    });
    
    // JSONパーサーミドルウェア（すべてのAPIルートの前に設定）
    this.app.use(express.json());
    
    // ログ検索APIのルートを設定
    this.logSearchAPI.setupRoutes(this.app);
    
    // アナリティクスAPIのルートを設定
    this.app.use('/api/analytics', AnalyticsAPI);
    
    // ヘルスチェックAPIのルートを設定
    if (this.healthAPI) {
      this.app.use('/api/health', this.healthAPI.getRouter());
    }
    
    // プロセス管理APIのルートを設定
    if (this.processAPI) {
      this.app.use('/api', this.processAPI.getRouter());
    }
  }

  /**
   * WebSocket通信の設定
   */
  setupWebSocket() {
    // プロセス状態の追跡（差分検出用）
    this.processStates = new Map();
    
    this.wss.on('connection', (ws) => {
      this.logger?.info('WebSocket接続が確立されました');
      
      // 初回接続時に現在の状態を送信
      const currentState = {
        type: 'initial',
        data: {
          processes: this.stateManager.getAllProcesses(),
          stats: this.stateManager.getSystemStats()
        }
      };
      ws.send(JSON.stringify(currentState));
      
      // クライアントからのメッセージを処理
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          
          switch (data.type) {
            case 'ping':
              // Ping応答
              ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
              break;
              
            case 'subscribe-logs':
              // ログ購読（将来の拡張用）
              this.subscribeToLogs(ws, data.processId);
              break;
              
            case 'unsubscribe-logs':
              // ログ購読解除（将来の拡張用）
              this.unsubscribeFromLogs(ws, data.processId);
              break;
          }
        } catch (error) {
          this.logger?.error('WebSocketメッセージ処理エラー', error);
        }
      });
      
      // 定期更新の開始（差分更新対応）
      const updateInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.sendDifferentialUpdates(ws);
        }
      }, this.config.updateInterval);
      
      // 切断時のクリーンアップ
      ws.on('close', () => {
        clearInterval(updateInterval);
        this.logger?.info('WebSocket接続が切断されました');
      });
      
      // エラーハンドリング
      ws.on('error', (error) => {
        this.logger?.error('WebSocketエラー', error);
      });
    });
  }
  
  /**
   * 差分更新を送信
   */
  sendDifferentialUpdates(ws) {
    const currentProcesses = this.stateManager.getAllProcesses();
    const currentProcessMap = new Map(currentProcesses.map(p => [p.processId, p]));
    
    // 新規プロセスの検出
    currentProcesses.forEach(process => {
      const oldProcess = this.processStates.get(process.processId);
      if (!oldProcess) {
        // 新規プロセス
        ws.send(JSON.stringify({
          type: 'process-added',
          process: process,
          timestamp: new Date().toISOString()
        }));
      } else if (JSON.stringify(oldProcess) !== JSON.stringify(process)) {
        // 更新されたプロセス
        ws.send(JSON.stringify({
          type: 'process-updated',
          process: process,
          timestamp: new Date().toISOString()
        }));
      }
    });
    
    // 削除されたプロセスの検出
    this.processStates.forEach((process, processId) => {
      if (!currentProcessMap.has(processId)) {
        ws.send(JSON.stringify({
          type: 'process-removed',
          processId: processId,
          timestamp: new Date().toISOString()
        }));
      }
    });
    
    // 現在の状態を保存
    this.processStates = currentProcessMap;
    
    // 統計情報も送信
    ws.send(JSON.stringify({
      type: 'update',
      data: {
        stats: this.stateManager.getSystemStats(),
        timestamp: new Date().toISOString()
      }
    }));
  }
  
  /**
   * ログ購読（将来の実装用）
   */
  subscribeToLogs(ws, processId) {
    // TODO: プロセスのログをリアルタイムで配信
    this.logger?.info(`ログ購読開始: ${processId}`);
  }
  
  /**
   * ログ購読解除（将来の実装用）
   */
  unsubscribeFromLogs(ws, processId) {
    // TODO: ログ配信の停止
    this.logger?.info(`ログ購読解除: ${processId}`);
  }

  /**
   * サーバーを起動
   */
  start() {
    if (!this.config.enabled) {
      return;
    }
    
    this.server.listen(this.config.port, this.config.host, () => {
      this.logger?.info(`ダッシュボードサーバーが起動しました: http://${this.config.host}:${this.config.port}`);
      console.log(`📊 プロセスダッシュボード: http://${this.config.host}:${this.config.port}`);
    });
  }

  /**
   * サーバーを停止
   */
  stop() {
    if (this.server) {
      this.server.close(() => {
        this.logger?.info('ダッシュボードサーバーが停止しました');
      });
    }
  }
  
  /**
   * プロセスイベントを通知
   */
  notifyProcessEvent(event) {
    const message = JSON.stringify({
      type: 'process-event',
      event: event,
      timestamp: new Date().toISOString()
    });
    
    // 全接続中のクライアントに通知
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  /**
   * 通知メッセージを送信
   */
  sendNotification(notification) {
    const message = JSON.stringify({
      type: 'notification',
      notification: notification,
      timestamp: new Date().toISOString()
    });
    
    // 全接続中のクライアントに通知
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  /**
   * ログメッセージを送信
   */
  sendLogMessage(log) {
    const message = JSON.stringify({
      type: 'log',
      log: log,
      timestamp: new Date().toISOString()
    });
    
    // 全接続中のクライアントに通知
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  /**
   * プロセス追加を通知
   */
  notifyProcessAdded(process) {
    const message = JSON.stringify({
      type: 'process-added',
      process: process,
      timestamp: new Date().toISOString()
    });
    
    // 全接続中のクライアントに通知
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
    
    // 通知も送信
    this.sendNotification({
      type: 'info',
      message: `新しいプロセスが開始されました: Issue #${process.issueNumber}`
    });
  }
  
  /**
   * プロセス更新を通知
   */
  notifyProcessUpdated(process) {
    const message = JSON.stringify({
      type: 'process-updated',
      process: process,
      timestamp: new Date().toISOString()
    });
    
    // 全接続中のクライアントに通知
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  /**
   * プロセス削除を通知
   */
  notifyProcessRemoved(processId) {
    const message = JSON.stringify({
      type: 'process-removed',
      processId: processId,
      timestamp: new Date().toISOString()
    });
    
    // 全接続中のクライアントに通知
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
}

module.exports = DashboardServer;