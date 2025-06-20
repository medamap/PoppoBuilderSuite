/**
 * ヘルスチェックAPI
 * 
 * HTTPエンドポイントでCCSPの状態を確認
 */

const express = require('express');

class HealthAPI {
  constructor(ccspAgent, port = 3010) {
    this.agent = ccspAgent;
    this.port = port;
    this.app = express();
    this.server = null;
    
    this.setupRoutes();
  }
  
  setupRoutes() {
    // ヘルスチェックエンドポイント
    this.app.get('/health', async (req, res) => {
      try {
        const health = await this.agent.getHealthStatus();
        res.json(health);
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // メトリクスエンドポイント
    this.app.get('/metrics', async (req, res) => {
      try {
        const metrics = this.agent.metricsCollector.getMetrics();
        res.json(metrics);
      } catch (error) {
        res.status(500).json({
          error: error.message
        });
      }
    });
    
    // キューステータスエンドポイント
    this.app.get('/queue/status', async (req, res) => {
      try {
        const status = await this.agent.queueManager.getQueueStatus();
        res.json(status);
      } catch (error) {
        res.status(500).json({
          error: error.message
        });
      }
    });
    
    // レート制限ステータス
    this.app.get('/ratelimit/status', (req, res) => {
      const status = this.agent.rateLimiter.getStatus();
      res.json(status);
    });
    
    // ルートエンドポイント
    this.app.get('/', (req, res) => {
      res.json({
        service: 'CCSP Agent (Pai-chan)',
        version: '1.0.0',
        endpoints: [
          '/health',
          '/metrics',
          '/queue/status',
          '/ratelimit/status'
        ]
      });
    });
  }
  
  start() {
    this.server = this.app.listen(this.port, () => {
      this.agent.logger.info(`Health API listening on port ${this.port}`);
    });
  }
  
  stop() {
    if (this.server) {
      this.server.close();
    }
  }
}

module.exports = HealthAPI;