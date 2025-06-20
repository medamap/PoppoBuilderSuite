const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');

/**
 * PoppoBuilder Process Dashboard Server
 */
class DashboardServer {
  constructor(config, processStateManager, logger) {
    this.config = config.dashboard || {
      enabled: true,
      port: 3001,
      host: 'localhost',
      updateInterval: 5000
    };
    
    this.stateManager = processStateManager;
    this.logger = logger;
    
    if (!this.config.enabled) {
      this.logger?.info('ダッシュボードは無効化されています');
      return;
    }
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    
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
    
    // ヘルスチェック
    this.app.get('/api/health', (req, res) => {
      res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
      });
    });
  }

  /**
   * WebSocket通信の設定
   */
  setupWebSocket() {
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
      
      // 定期更新の開始
      const updateInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          const update = {
            type: 'update',
            data: {
              processes: this.stateManager.getRunningProcesses(),
              stats: this.stateManager.getSystemStats(),
              timestamp: new Date().toISOString()
            }
          };
          ws.send(JSON.stringify(update));
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
}

module.exports = DashboardServer;