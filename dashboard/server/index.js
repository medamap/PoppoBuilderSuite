const express = require('express');
const WebSocket = require('ws');
const http = require('http');
const path = require('path');
const fs = require('fs');
const LogSearchAPI = require('./api/logs');
const AnalyticsAPI = require('./api/analytics');
const i18n = require('../../lib/i18n');
const { Server } = require('socket.io');
const PrometheusExporter = require('../../src/prometheus-exporter');

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
    
    // Initialize Prometheus exporter
    this.prometheusExporter = new PrometheusExporter({
      port: this.config.prometheusPort || 9090,
      host: this.config.host || 'localhost'
    }, logger);
    
    // Initialize i18n if not already done
    if (!i18n.initialized) {
      i18n.init({ language: i18n.getUserLanguage() }).catch(err => {
        console.error('Failed to initialize i18n:', err);
      });
    }
    
    if (!this.config.enabled) {
      this.logger?.info(i18n.t('dashboard.disabled'));
      return;
    }
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    
    // Socket.ioサーバーの初期化
    this.io = new Server(this.server, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });
    
    // ログ検索APIの初期化
    this.logSearchAPI = new LogSearchAPI(this.logger);
    
    this.setupRoutes();
    this.setupWebSocket();
    this.setupSocketIO();
  }

  /**
   * APIルートの設定
   */
  setupRoutes() {
    // 静的ファイルの提供
    this.app.use(express.static(path.join(__dirname, '../client')));
    
    // CCSP dashboard route
    this.app.get('/ccsp', (req, res) => {
      res.sendFile(path.join(__dirname, '../ccsp/index.html'));
    });
    
    // CCSP static files
    this.app.use('/ccsp', express.static(path.join(__dirname, '../ccsp')));
    
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
    
    // Prometheusメトリクスエンドポイント
    this.app.get('/metrics', async (req, res) => {
      try {
        res.set('Content-Type', this.prometheusExporter.registry.contentType);
        const metrics = await this.prometheusExporter.getMetrics();
        res.end(metrics);
      } catch (error) {
        this.logger?.error('Error collecting metrics:', error);
        res.status(500).end('Error collecting metrics');
      }
    });
    
    // ログ検索APIのルートを設定
    this.logSearchAPI.setupRoutes(this.app);
    
    // アナリティクスAPIのルートを設定
    this.app.use(express.json());
    this.app.use('/api/analytics', AnalyticsAPI);
    
    // CCSP API endpoints (モック実装)
    this.setupCCSPRoutes();
  }

  /**
   * CCSP APIルートの設定（モック実装）
   */
  setupCCSPRoutes() {
    // キューステータス
    this.app.get('/api/ccsp/queue/status', (req, res) => {
      res.json({
        success: true,
        data: {
          totalQueueSize: 0,
          isPaused: false,
          queues: {
            urgent: { size: 0, oldestTask: null },
            high: { size: 0, oldestTask: null },
            normal: { size: 0, oldestTask: null },
            low: { size: 0, oldestTask: null },
            scheduled: { size: 0, oldestTask: null }
          }
        }
      });
    });
    
    // 使用統計
    this.app.get('/api/ccsp/stats/usage', (req, res) => {
      res.json({
        success: true,
        data: {
          currentWindow: {
            requests: 0,
            requestsPerMinute: 0,
            successRate: 1.0,
            averageResponseTime: 0,
            errorRate: 0
          },
          rateLimitInfo: {
            limit: 100,
            remaining: 100,
            resetTime: Date.now() + 3600000
          },
          prediction: {
            prediction: {
              requestsPerMinute: 0
            }
          },
          rateLimitPrediction: {
            prediction: {
              minutesToLimit: 999
            },
            recommendation: {
              message: "CCSP未接続（モックモード）"
            }
          }
        }
      });
    });
    
    // エージェント統計
    this.app.get('/api/ccsp/stats/agents', (req, res) => {
      res.json({
        success: true,
        data: {}
      });
    });
    
    // キュー制御エンドポイント
    this.app.post('/api/ccsp/queue/pause', (req, res) => {
      res.json({ success: true, message: 'Queue paused (mock)' });
    });
    
    this.app.post('/api/ccsp/queue/resume', (req, res) => {
      res.json({ success: true, message: 'Queue resumed (mock)' });
    });
    
    this.app.delete('/api/ccsp/queue/clear', (req, res) => {
      res.json({ success: true, message: 'Queue cleared (mock)' });
    });
    
    this.app.post('/api/ccsp/control/emergency-stop', (req, res) => {
      res.json({ success: true, message: 'Emergency stop executed (mock)' });
    });
  }
  
  /**
   * WebSocket通信の設定
   */
  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      this.logger?.info(i18n.t('dashboard.websocket.connected'));
      
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
        this.logger?.info(i18n.t('dashboard.websocket.disconnected'));
      });
      
      // エラーハンドリング
      ws.on('error', (error) => {
        this.logger?.error(i18n.t('dashboard.websocket.error'), error);
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
      const url = `http://${this.config.host}:${this.config.port}`;
      this.logger?.info(i18n.t('dashboard.starting', { url }));
      console.log(`📊 ${i18n.t('dashboard.started', { url })}`);
    });
    
    // Start Prometheus exporter
    this.prometheusExporter.start().then((prometheusUrl) => {
      this.logger?.info(`Prometheus metrics available at ${prometheusUrl}/metrics`);
    }).catch((error) => {
      this.logger?.error('Failed to start Prometheus exporter:', error);
    });
  }

  /**
   * サーバーを停止
   */
  stop() {
    if (this.server) {
      this.server.close(() => {
        this.logger?.info(i18n.t('dashboard.stopped'));
      });
    }
    
    // Stop Prometheus exporter
    if (this.prometheusExporter) {
      this.prometheusExporter.stop().then(() => {
        this.logger?.info('Prometheus exporter stopped');
      }).catch((error) => {
        this.logger?.error('Error stopping Prometheus exporter:', error);
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
   * Socket.io通信の設定（CCSPダッシュボード用）
   */
  setupSocketIO() {
    // CCSP名前空間の作成
    const ccspNamespace = this.io.of('/ccsp');
    
    ccspNamespace.on('connection', (socket) => {
      this.logger?.info('CCSP client connected:', socket.id);
      
      // 初期状態の送信（モックデータ）
      socket.emit('initialState', {
        queue: {
          totalQueueSize: 0,
          isPaused: false,
          queues: {
            urgent: { size: 0, oldestTask: null },
            high: { size: 0, oldestTask: null },
            normal: { size: 0, oldestTask: null },
            low: { size: 0, oldestTask: null },
            scheduled: { size: 0, oldestTask: null }
          }
        },
        usage: {
          currentWindow: {
            requests: 0,
            requestsPerMinute: 0,
            successRate: 1.0,
            averageResponseTime: 0,
            errorRate: 0
          },
          rateLimitInfo: {
            limit: 100,
            remaining: 100,
            resetTime: Date.now() + 3600000
          }
        },
        agents: {}
      });
      
      // 統計情報の購読
      socket.on('subscribeStats', (interval) => {
        this.logger?.info(`CCSP client subscribed to stats with interval: ${interval}ms`);
        
        // 定期的にモックデータを送信
        const statsInterval = setInterval(() => {
          // モック使用量データ
          socket.emit('usageUpdate', {
            currentWindow: {
              requests: Math.floor(Math.random() * 100),
              requestsPerMinute: Math.random() * 20,
              successRate: 0.9 + Math.random() * 0.1,
              averageResponseTime: 800 + Math.random() * 400,
              errorRate: Math.random() * 0.05
            },
            rateLimitInfo: {
              limit: 100,
              remaining: Math.floor(Math.random() * 100),
              resetTime: Date.now() + 3600000
            },
            prediction: {
              prediction: {
                requestsPerMinute: 10 + Math.random() * 10
              }
            },
            rateLimitPrediction: {
              prediction: {
                minutesToLimit: 60 + Math.random() * 60
              },
              recommendation: {
                message: "現在のペースは安全です"
              }
            }
          });
          
          // モックキューデータ
          socket.emit('queueUpdate', {
            totalQueueSize: Math.floor(Math.random() * 10),
            isPaused: false,
            queues: {
              urgent: { size: Math.floor(Math.random() * 2), oldestTask: new Date().toISOString() },
              high: { size: Math.floor(Math.random() * 3), oldestTask: new Date().toISOString() },
              normal: { size: Math.floor(Math.random() * 5), oldestTask: new Date().toISOString() },
              low: { size: 0, oldestTask: null },
              scheduled: { size: 0, oldestTask: null }
            }
          });
        }, interval || 5000);
        
        // 購読解除時にインターバルをクリア
        socket.on('unsubscribeStats', () => {
          clearInterval(statsInterval);
          this.logger?.info('CCSP client unsubscribed from stats');
        });
        
        socket.on('disconnect', () => {
          clearInterval(statsInterval);
          this.logger?.info('CCSP client disconnected:', socket.id);
        });
      });
      
      // エラーハンドリング
      socket.on('error', (error) => {
        this.logger?.error('CCSP socket error:', error);
      });
    });
  }
  
  /**
   * Prometheusメトリクスの更新
   */
  updatePrometheusMetrics() {
    if (!this.prometheusExporter) return;
    
    try {
      // エージェント状態の更新
      const processes = this.stateManager.getAllProcesses();
      processes.forEach(process => {
        const agentName = process.taskId || 'unknown';
        const isRunning = process.status === 'running' ? 1 : 0;
        
        this.prometheusExporter.updateAgentMetrics(agentName, {
          status: isRunning,
          uptime: process.startTime ? (Date.now() - new Date(process.startTime).getTime()) / 1000 : 0,
          memory: {
            rss: process.memory?.rss || 0,
            heapUsed: process.memory?.heapUsed || 0,
            heapTotal: process.memory?.heapTotal || 0
          },
          cpu: process.cpu || 0,
          healthScore: process.healthScore || 100
        });
      });
      
      // キューサイズの更新（モックデータ）
      this.prometheusExporter.updateQueueMetrics('default', 0);
      this.prometheusExporter.updateQueueMetrics('urgent', 0);
      this.prometheusExporter.updateQueueMetrics('high', 0);
      this.prometheusExporter.updateQueueMetrics('normal', 0);
      
    } catch (error) {
      this.logger?.error('Error updating Prometheus metrics:', error);
    }
  }
  
  /**
   * Issue処理メトリクスの記録
   */
  recordIssueProcessing(agentName, issueType, status, duration) {
    if (this.prometheusExporter) {
      this.prometheusExporter.recordIssueProcessing(agentName, issueType, status, duration);
    }
  }
  
  /**
   * エラーメトリクスの記録
   */
  recordError(agentName, errorType) {
    if (this.prometheusExporter) {
      this.prometheusExporter.recordError(agentName, errorType);
    }
  }
  
  /**
   * GitHub APIメトリクスの記録
   */
  recordGitHubApiCall(endpoint, statusCode, responseTime, rateLimit) {
    if (this.prometheusExporter) {
      this.prometheusExporter.recordGitHubApiCall(endpoint, statusCode, responseTime, rateLimit);
    }
  }
  
  /**
   * Claude APIメトリクスの記録
   */
  recordClaudeApiCall(model, status, tokensUsed) {
    if (this.prometheusExporter) {
      this.prometheusExporter.recordClaudeApiCall(model, status, tokensUsed);
    }
  }
}

module.exports = DashboardServer;