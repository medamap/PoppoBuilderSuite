#!/usr/bin/env node

/**
 * CCSP エージェント起動スクリプト
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * CCSP Agent Phase 4の起動とライフサイクル管理
 */

const path = require('path');
const fs = require('fs');

// プロジェクトルートに移動
process.chdir(path.join(__dirname, '..'));

const CCSPAgent = require('../agents/ccsp/index');
const Logger = require('../src/logger');
const express = require('express');
const http = require('http');
const { Server: SocketIOServer } = require('socket.io');

class CCSPService {
  constructor() {
    this.logger = new Logger('CCSPService');
    this.ccspAgent = null;
    this.expressApp = null;
    this.httpServer = null;
    this.io = null;
    this.isShuttingDown = false;
    
    // 設定の読み込み
    this.loadConfig();
    
    // シグナルハンドリング
    this.setupSignalHandlers();
  }
  
  /**
   * 設定の読み込み
   */
  loadConfig() {
    try {
      const configPath = path.join(__dirname, '../config/config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      this.config = {
        port: process.env.CCSP_PORT || config.ccsp?.port || 3003,
        redisHost: process.env.REDIS_HOST || config.redis?.host || 'localhost',
        redisPort: process.env.REDIS_PORT || config.redis?.port || 6379,
        maxConcurrentRequests: process.env.CCSP_MAX_CONCURRENT || config.ccsp?.maxConcurrentRequests || 5,
        throttleDelay: process.env.CCSP_THROTTLE_DELAY || config.ccsp?.throttleDelay || 1000,
        enableMetrics: process.env.CCSP_ENABLE_METRICS !== 'false',
        enableDashboard: process.env.CCSP_ENABLE_DASHBOARD !== 'false',
        autoOptimization: process.env.CCSP_AUTO_OPTIMIZATION === 'true',
        ...config.ccsp
      };
      
      this.logger.info('Configuration loaded', {
        port: this.config.port,
        redisHost: this.config.redisHost,
        maxConcurrent: this.config.maxConcurrentRequests
      });
      
    } catch (error) {
      this.logger.error('Failed to load configuration', error);
      this.config = {
        port: 3003,
        redisHost: 'localhost',
        redisPort: 6379,
        maxConcurrentRequests: 5,
        throttleDelay: 1000,
        enableMetrics: true,
        enableDashboard: true,
        autoOptimization: false
      };
    }
  }
  
  /**
   * シグナルハンドリングの設定
   */
  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        if (this.isShuttingDown) {
          this.logger.warn('Forced shutdown');
          process.exit(1);
        }
        
        this.logger.info(`Received ${signal}, starting graceful shutdown...`);
        await this.shutdown();
      });
    });
    
    // 未捕捉例外のハンドリング
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught exception', error);
      process.exit(1);
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled rejection', { reason, promise });
      process.exit(1);
    });
  }
  
  /**
   * CCSPサービスの開始
   */
  async start() {
    try {
      this.logger.info('Starting CCSP Service...', {
        version: '4.0.0',
        nodeVersion: process.version,
        platform: process.platform
      });
      
      // Express アプリケーションの設定
      await this.setupExpressApp();
      
      // CCSP エージェントの初期化
      await this.initializeCCSPAgent();
      
      // HTTP サーバーの起動
      await this.startHttpServer();
      
      // CCSP エージェントの開始
      await this.ccspAgent.start();
      
      this.logger.info('CCSP Service started successfully', {
        port: this.config.port,
        dashboardUrl: `http://localhost:${this.config.port}`,
        metricsUrl: `http://localhost:${this.config.port}/metrics`
      });
      
      // 起動通知
      await this.sendStartupNotification();
      
    } catch (error) {
      this.logger.error('Failed to start CCSP Service', error);
      process.exit(1);
    }
  }
  
  /**
   * Express アプリケーションの設定
   */
  async setupExpressApp() {
    this.expressApp = express();
    
    // 基本ミドルウェア
    this.expressApp.use(express.json());
    this.expressApp.use(express.urlencoded({ extended: true }));
    
    // CORS
    this.expressApp.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
      
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
      } else {
        next();
      }
    });
    
    // 基本ルート
    this.expressApp.get('/', (req, res) => {
      res.json({
        service: 'CCSP Agent',
        version: '4.0.0',
        status: 'running',
        timestamp: new Date().toISOString(),
        endpoints: {
          health: '/health',
          metrics: '/metrics',
          api: '/api/ccsp'
        }
      });
    });
    
    // ヘルスチェック
    this.expressApp.get('/health', async (req, res) => {
      try {
        if (this.ccspAgent) {
          const health = await this.ccspAgent.getHealthStatus();
          res.status(health.status === 'healthy' ? 200 : 503).json(health);
        } else {
          res.status(503).json({
            status: 'unhealthy',
            error: 'CCSP Agent not initialized'
          });
        }
      } catch (error) {
        res.status(503).json({
          status: 'unhealthy',
          error: error.message
        });
      }
    });
    
    this.logger.info('Express application configured');
  }
  
  /**
   * CCSP エージェントの初期化
   */
  async initializeCCSPAgent() {
    this.ccspAgent = new CCSPAgent(this.config);
    
    // エージェントイベントのリスニング
    this.ccspAgent.on('emergencyStop', (reason) => {
      this.logger.error('Emergency stop triggered, shutting down service', { reason });
      this.shutdown();
    });
    
    this.ccspAgent.on('agentStarted', () => {
      this.logger.info('CCSP Agent started successfully');
    });
    
    // 管理APIの設定
    if (this.config.enableDashboard) {
      const managementRouter = this.ccspAgent.getManagementRouter();
      this.expressApp.use('/api/ccsp', managementRouter);
      this.logger.info('Management API configured at /api/ccsp');
    }
    
    // Prometheusメトリクスエンドポイント
    if (this.config.enableMetrics) {
      this.expressApp.get('/metrics', async (req, res) => {
        try {
          const metrics = await this.ccspAgent.getPrometheusMetrics();
          res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
          res.send(metrics);
        } catch (error) {
          this.logger.error('Failed to generate metrics', error);
          res.status(500).send('# Failed to generate metrics');
        }
      });
      this.logger.info('Prometheus metrics endpoint configured at /metrics');
    }
    
    this.logger.info('CCSP Agent initialized');
  }
  
  /**
   * HTTP サーバーの起動
   */
  async startHttpServer() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer(this.expressApp);
      
      // Socket.IO の設定
      this.io = new SocketIOServer(this.httpServer, {
        cors: {
          origin: "*",
          methods: ["GET", "POST"]
        }
      });
      
      // WebSocket統合
      if (this.ccspAgent && this.config.enableDashboard) {
        this.ccspAgent.setupWebSocketIntegration(this.io);
        this.logger.info('WebSocket integration configured');
      }
      
      this.httpServer.listen(this.config.port, (error) => {
        if (error) {
          reject(error);
        } else {
          this.logger.info('HTTP server started', { port: this.config.port });
          resolve();
        }
      });
      
      this.httpServer.on('error', (error) => {
        this.logger.error('HTTP server error', error);
      });
    });
  }
  
  /**
   * 起動通知の送信
   */
  async sendStartupNotification() {
    try {
      if (this.ccspAgent && this.ccspAgent.notificationHandler) {
        await this.ccspAgent.notificationHandler.notify({
          type: 'service_started',
          title: 'CCSP Service Started',
          message: `CCSP Agent v4.0.0 has started successfully on port ${this.config.port}`,
          severity: 'info',
          data: {
            version: '4.0.0',
            port: this.config.port,
            features: {
              metrics: this.config.enableMetrics,
              dashboard: this.config.enableDashboard,
              autoOptimization: this.config.autoOptimization
            }
          }
        });
      }
    } catch (error) {
      this.logger.warn('Failed to send startup notification', error);
    }
  }
  
  /**
   * サービスの停止
   */
  async shutdown() {
    if (this.isShuttingDown) {
      return;
    }
    
    this.isShuttingDown = true;
    this.logger.info('Shutting down CCSP Service...');
    
    try {
      // HTTP サーバーの停止
      if (this.httpServer) {
        await new Promise((resolve) => {
          this.httpServer.close(resolve);
        });
        this.logger.info('HTTP server stopped');
      }
      
      // Socket.IO の停止
      if (this.io) {
        this.io.close();
        this.logger.info('Socket.IO stopped');
      }
      
      // CCSP エージェントの停止
      if (this.ccspAgent) {
        await this.ccspAgent.shutdown();
        this.logger.info('CCSP Agent stopped');
      }
      
      this.logger.info('CCSP Service shutdown complete');
      process.exit(0);
      
    } catch (error) {
      this.logger.error('Error during shutdown', error);
      process.exit(1);
    }
  }
}

// メイン実行
async function main() {
  const service = new CCSPService();
  await service.start();
}

// CLI引数の処理
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
CCSP Agent v4.0.0 - Claude Code Specialized Processor

Usage: node scripts/start-ccsp.js [options]

Options:
  --help, -h          Show this help message
  --version, -v       Show version information
  --config <file>     Specify config file (default: config/config.json)

Environment Variables:
  CCSP_PORT                 HTTP server port (default: 3003)
  CCSP_MAX_CONCURRENT      Max concurrent requests (default: 5)
  CCSP_THROTTLE_DELAY      Throttle delay in ms (default: 1000)
  CCSP_ENABLE_METRICS      Enable Prometheus metrics (default: true)
  CCSP_ENABLE_DASHBOARD    Enable management dashboard (default: true)
  CCSP_AUTO_OPTIMIZATION   Enable auto optimization (default: false)
  REDIS_HOST               Redis host (default: localhost)
  REDIS_PORT               Redis port (default: 6379)

Examples:
  node scripts/start-ccsp.js
  CCSP_PORT=3004 node scripts/start-ccsp.js
  CCSP_AUTO_OPTIMIZATION=true node scripts/start-ccsp.js
    `);
    process.exit(0);
  }
  
  if (args.includes('--version') || args.includes('-v')) {
    console.log('CCSP Agent v4.0.0');
    process.exit(0);
  }
  
  main().catch((error) => {
    console.error('Failed to start CCSP Service:', error);
    process.exit(1);
  });
}