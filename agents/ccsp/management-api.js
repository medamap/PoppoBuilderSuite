/**
 * CCSP管理API
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * CCSPエージェントの制御と監視のためのRESTful API
 */

const express = require('express');
const Logger = require('../../src/logger');

class CCSPManagementAPI {
  constructor(ccspAgent, options = {}) {
    this.ccspAgent = ccspAgent;
    this.logger = new Logger('CCSPManagementAPI');
    this.router = express.Router();
    
    this.config = {
      rateLimit: options.rateLimit || 100, // requests per minute
      authRequired: options.authRequired || false,
      ...options
    };
    
    this.setupRoutes();
    this.setupMiddleware();
    
    this.logger.info('CCSP Management API initialized');
  }
  
  /**
   * ミドルウェアのセットアップ
   */
  setupMiddleware() {
    // JSON解析
    this.router.use(express.json());
    
    // CORS設定
    this.router.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });
    
    // リクエストログ
    this.router.use((req, res, next) => {
      this.logger.debug('API Request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      });
      next();
    });
    
    // エラーハンドリング
    this.router.use((error, req, res, next) => {
      this.logger.error('API Error', {
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method
      });
      
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        timestamp: new Date().toISOString()
      });
    });
  }
  
  /**
   * ルートのセットアップ
   */
  setupRoutes() {
    // キュー管理エンドポイント
    this.setupQueueRoutes();
    
    // 統計情報エンドポイント
    this.setupStatsRoutes();
    
    // 制御エンドポイント
    this.setupControlRoutes();
    
    // ヘルスチェックエンドポイント
    this.setupHealthRoutes();
    
    // 設定管理エンドポイント
    this.setupConfigRoutes();
  }
  
  /**
   * キュー管理ルート
   */
  setupQueueRoutes() {
    // キュー状態取得
    this.router.get('/queue/status', async (req, res) => {
      try {
        const status = await this.ccspAgent.getQueueStatus();
        res.json({
          success: true,
          data: status,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get queue status');
      }
    });
    
    // キュー一時停止
    this.router.post('/queue/pause', async (req, res) => {
      try {
        await this.ccspAgent.pauseQueue();
        this.logger.info('Queue paused via API');
        
        res.json({
          success: true,
          message: 'Queue paused successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to pause queue');
      }
    });
    
    // キュー再開
    this.router.post('/queue/resume', async (req, res) => {
      try {
        await this.ccspAgent.resumeQueue();
        this.logger.info('Queue resumed via API');
        
        res.json({
          success: true,
          message: 'Queue resumed successfully',
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to resume queue');
      }
    });
    
    // キュークリア
    this.router.delete('/queue/clear', async (req, res) => {
      try {
        const { priority = 'all' } = req.query;
        const result = await this.ccspAgent.clearQueue(priority);
        
        this.logger.warn('Queue cleared via API', { priority, result });
        
        res.json({
          success: true,
          message: `Queue cleared: ${priority}`,
          data: result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to clear queue');
      }
    });
    
    // 特定タスクの削除
    this.router.delete('/queue/task/:taskId', async (req, res) => {
      try {
        const { taskId } = req.params;
        const removed = await this.ccspAgent.removeTask(taskId);
        
        if (removed) {
          this.logger.info('Task removed via API', { taskId });
          res.json({
            success: true,
            message: 'Task removed successfully',
            taskId
          });
        } else {
          res.status(404).json({
            success: false,
            error: 'Task not found',
            taskId
          });
        }
      } catch (error) {
        this.handleError(res, error, 'Failed to remove task');
      }
    });
    
    // タスクの追加
    this.router.post('/queue/task', async (req, res) => {
      try {
        const { task, priority = 'normal', executeAt } = req.body;
        
        if (!task) {
          return res.status(400).json({
            success: false,
            error: 'Task data is required'
          });
        }
        
        const taskId = await this.ccspAgent.enqueueTask(task, priority, executeAt);
        
        this.logger.info('Task added via API', { taskId, priority });
        
        res.status(201).json({
          success: true,
          message: 'Task added successfully',
          taskId,
          priority,
          executeAt
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to add task');
      }
    });
  }
  
  /**
   * 統計情報ルート
   */
  setupStatsRoutes() {
    // 使用量統計
    this.router.get('/stats/usage', async (req, res) => {
      try {
        const { minutes = 60 } = req.query;
        const stats = await this.ccspAgent.getUsageStats(parseInt(minutes));
        
        res.json({
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get usage stats');
      }
    });
    
    // エージェント別統計
    this.router.get('/stats/agents', async (req, res) => {
      try {
        const { agent } = req.query;
        const stats = await this.ccspAgent.getAgentStats(agent);
        
        res.json({
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get agent stats');
      }
    });
    
    // エラー統計
    this.router.get('/stats/errors', async (req, res) => {
      try {
        const { hours = 24 } = req.query;
        const stats = await this.ccspAgent.getErrorStats(parseInt(hours));
        
        res.json({
          success: true,
          data: stats,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get error stats');
      }
    });
    
    // パフォーマンス統計
    this.router.get('/stats/performance', async (req, res) => {
      try {
        const performance = await this.ccspAgent.getPerformanceStats();
        
        res.json({
          success: true,
          data: performance,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get performance stats');
      }
    });
    
    // 予測統計
    this.router.get('/stats/prediction', async (req, res) => {
      try {
        const { minutesAhead = 30 } = req.query;
        const prediction = await this.ccspAgent.getPrediction(parseInt(minutesAhead));
        
        res.json({
          success: true,
          data: prediction,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get prediction');
      }
    });
  }
  
  /**
   * 制御ルート
   */
  setupControlRoutes() {
    // スロットリング設定
    this.router.post('/control/throttle', async (req, res) => {
      try {
        const { enabled, delay, mode } = req.body;
        
        const result = await this.ccspAgent.setThrottling({
          enabled: enabled !== undefined ? enabled : true,
          delay: delay || 1000,
          mode: mode || 'fixed'
        });
        
        this.logger.info('Throttling configured via API', { enabled, delay, mode });
        
        res.json({
          success: true,
          message: 'Throttling configured successfully',
          data: result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to configure throttling');
      }
    });
    
    // 優先度設定
    this.router.post('/control/priority', async (req, res) => {
      try {
        const { agent, priority } = req.body;
        
        if (!agent || !priority) {
          return res.status(400).json({
            success: false,
            error: 'Agent and priority are required'
          });
        }
        
        await this.ccspAgent.setAgentPriority(agent, priority);
        
        this.logger.info('Agent priority set via API', { agent, priority });
        
        res.json({
          success: true,
          message: 'Priority set successfully',
          agent,
          priority
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to set priority');
      }
    });
    
    // 緊急停止
    this.router.post('/control/emergency-stop', async (req, res) => {
      try {
        const { reason } = req.body;
        
        await this.ccspAgent.emergencyShutdown(reason);
        
        this.logger.error('Emergency stop triggered via API', { reason });
        
        res.json({
          success: true,
          message: 'Emergency stop executed',
          reason,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to execute emergency stop');
      }
    });
  }
  
  /**
   * ヘルスチェックルート
   */
  setupHealthRoutes() {
    // 基本ヘルスチェック
    this.router.get('/health', async (req, res) => {
      try {
        const health = await this.ccspAgent.getHealthStatus();
        
        res.status(health.status === 'healthy' ? 200 : 503).json({
          success: health.status === 'healthy',
          data: health,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        res.status(503).json({
          success: false,
          error: 'Health check failed',
          timestamp: new Date().toISOString()
        });
      }
    });
    
    // 詳細ヘルスチェック
    this.router.get('/health/detailed', async (req, res) => {
      try {
        const health = await this.ccspAgent.getDetailedHealth();
        
        res.json({
          success: true,
          data: health,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get detailed health');
      }
    });
  }
  
  /**
   * 設定管理ルート
   */
  setupConfigRoutes() {
    // 設定取得
    this.router.get('/config', async (req, res) => {
      try {
        const config = await this.ccspAgent.getConfig();
        
        res.json({
          success: true,
          data: config,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to get config');
      }
    });
    
    // 設定更新
    this.router.put('/config', async (req, res) => {
      try {
        const { config } = req.body;
        
        if (!config) {
          return res.status(400).json({
            success: false,
            error: 'Config data is required'
          });
        }
        
        const result = await this.ccspAgent.updateConfig(config);
        
        this.logger.info('Config updated via API', { config });
        
        res.json({
          success: true,
          message: 'Config updated successfully',
          data: result,
          timestamp: new Date().toISOString()
        });
      } catch (error) {
        this.handleError(res, error, 'Failed to update config');
      }
    });
  }
  
  /**
   * エラーハンドリング
   */
  handleError(res, error, message) {
    this.logger.error(message, { error: error.message });
    
    const statusCode = error.statusCode || 500;
    
    res.status(statusCode).json({
      success: false,
      error: message,
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
  
  /**
   * メトリクスエンドポイント（Prometheus形式）
   */
  getMetricsEndpoint() {
    return async (req, res) => {
      try {
        const metrics = await this.ccspAgent.getPrometheusMetrics();
        
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(metrics);
      } catch (error) {
        this.logger.error('Failed to generate metrics', error);
        res.status(500).send('# Failed to generate metrics');
      }
    };
  }
  
  /**
   * WebSocket統合（リアルタイム更新用）
   */
  setupWebSocketIntegration(io) {
    const namespace = io.of('/ccsp');
    
    // クライアント接続時
    namespace.on('connection', (socket) => {
      this.logger.info('CCSP WebSocket client connected', { 
        socketId: socket.id,
        clientIp: socket.handshake.address 
      });
      
      // 初期状態を送信
      this.sendInitialState(socket);
      
      // イベントリスナーの設定
      this.setupSocketListeners(socket);
      
      socket.on('disconnect', () => {
        this.logger.info('CCSP WebSocket client disconnected', { socketId: socket.id });
      });
    });
    
    // CCSPエージェントからのイベントをWebSocketで中継
    this.ccspAgent.on('queueUpdated', (data) => {
      namespace.emit('queueUpdate', data);
    });
    
    this.ccspAgent.on('usageUpdated', (data) => {
      namespace.emit('usageUpdate', data);
    });
    
    this.ccspAgent.on('alert', (alert) => {
      namespace.emit('alert', alert);
    });
    
    this.logger.info('CCSP WebSocket integration setup complete');
  }
  
  /**
   * 初期状態の送信
   */
  async sendInitialState(socket) {
    try {
      const [queueStatus, usageStats, health] = await Promise.all([
        this.ccspAgent.getQueueStatus(),
        this.ccspAgent.getUsageStats(),
        this.ccspAgent.getHealthStatus()
      ]);
      
      socket.emit('initialState', {
        queue: queueStatus,
        usage: usageStats,
        health,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      this.logger.error('Failed to send initial state', error);
    }
  }
  
  /**
   * WebSocketリスナーの設定
   */
  setupSocketListeners(socket) {
    // クライアントからのコマンド
    socket.on('pauseQueue', async () => {
      try {
        await this.ccspAgent.pauseQueue();
        socket.emit('commandResult', { success: true, action: 'pauseQueue' });
      } catch (error) {
        socket.emit('commandResult', { success: false, action: 'pauseQueue', error: error.message });
      }
    });
    
    socket.on('resumeQueue', async () => {
      try {
        await this.ccspAgent.resumeQueue();
        socket.emit('commandResult', { success: true, action: 'resumeQueue' });
      } catch (error) {
        socket.emit('commandResult', { success: false, action: 'resumeQueue', error: error.message });
      }
    });
    
    // 統計情報の購読
    socket.on('subscribeStats', (interval = 5000) => {
      socket.statsInterval = setInterval(async () => {
        try {
          const stats = await this.ccspAgent.getUsageStats();
          socket.emit('statsUpdate', stats);
        } catch (error) {
          this.logger.error('Failed to send stats update', error);
        }
      }, interval);
    });
    
    socket.on('unsubscribeStats', () => {
      if (socket.statsInterval) {
        clearInterval(socket.statsInterval);
        socket.statsInterval = null;
      }
    });
  }
  
  /**
   * Express Routerの取得
   */
  getRouter() {
    return this.router;
  }
}

module.exports = CCSPManagementAPI;