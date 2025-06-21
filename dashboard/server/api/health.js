const express = require('express');
const router = express.Router();

/**
 * ヘルスチェックAPI
 * システムの健全性情報を提供
 */
class HealthAPI {
  constructor(healthCheckManager) {
    this.healthCheckManager = healthCheckManager;
    this.setupRoutes();
  }
  
  setupRoutes() {
    // 基本的なヘルスチェック
    router.get('/', async (req, res) => {
      try {
        const health = this.healthCheckManager 
          ? this.healthCheckManager.getHealth()
          : {
              status: 'unknown',
              score: 0,
              timestamp: new Date().toISOString(),
              message: 'HealthCheckManagerが利用できません'
            };
        
        res.json(health);
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // 詳細なヘルスチェック
    router.get('/detailed', async (req, res) => {
      try {
        if (!this.healthCheckManager) {
          return res.status(503).json({
            status: 'error',
            message: 'HealthCheckManagerが利用できません'
          });
        }
        
        const detailed = await this.healthCheckManager.getDetailedHealth();
        res.json(detailed);
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // 準備完了状態
    router.get('/ready', async (req, res) => {
      try {
        if (!this.healthCheckManager) {
          return res.json({
            ready: false,
            message: 'HealthCheckManagerが利用できません'
          });
        }
        
        const readiness = await this.healthCheckManager.checkReadiness();
        
        // 準備ができていない場合は503を返す
        if (!readiness.ready) {
          res.status(503);
        }
        
        res.json(readiness);
        
      } catch (error) {
        res.status(500).json({
          ready: false,
          error: error.message
        });
      }
    });
    
    // Prometheusメトリクス
    router.get('/metrics', async (req, res) => {
      try {
        if (!this.healthCheckManager) {
          return res.status(503).send('# HealthCheckManager not available\n');
        }
        
        const metrics = await this.healthCheckManager.getPrometheusMetrics();
        
        res.set('Content-Type', 'text/plain; version=0.0.4');
        res.send(metrics);
        
      } catch (error) {
        res.status(500).send(`# Error: ${error.message}\n`);
      }
    });
    
    // 診断レポート
    router.get('/diagnostic', async (req, res) => {
      try {
        if (!this.healthCheckManager) {
          return res.status(503).json({
            status: 'error',
            message: 'HealthCheckManagerが利用できません'
          });
        }
        
        const report = await this.healthCheckManager.generateDiagnosticReport();
        res.json(report);
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // 手動ヘルスチェック実行
    router.post('/check', async (req, res) => {
      try {
        if (!this.healthCheckManager) {
          return res.status(503).json({
            status: 'error',
            message: 'HealthCheckManagerが利用できません'
          });
        }
        
        const result = await this.healthCheckManager.performHealthCheck();
        res.json(result);
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // メトリクス履歴
    router.get('/history', async (req, res) => {
      try {
        if (!this.healthCheckManager || !this.healthCheckManager.metricsStore) {
          return res.status(503).json({
            status: 'error',
            message: 'MetricsStoreが利用できません'
          });
        }
        
        const hours = parseInt(req.query.hours) || 24;
        const history = await this.healthCheckManager.metricsStore.getHistory(hours);
        
        res.json({
          period: `${hours}時間`,
          dataPoints: history.length,
          history
        });
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // トレンド分析
    router.get('/trends', async (req, res) => {
      try {
        if (!this.healthCheckManager || !this.healthCheckManager.metricsStore) {
          return res.status(503).json({
            status: 'error',
            message: 'MetricsStoreが利用できません'
          });
        }
        
        const trends = await this.healthCheckManager.metricsStore.analyzeTrends();
        res.json(trends);
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // 統計サマリー
    router.get('/summary', async (req, res) => {
      try {
        if (!this.healthCheckManager || !this.healthCheckManager.metricsStore) {
          return res.status(503).json({
            status: 'error',
            message: 'MetricsStoreが利用できません'
          });
        }
        
        const hours = parseInt(req.query.hours) || 24;
        const summary = await this.healthCheckManager.metricsStore.generateSummary(hours);
        
        res.json(summary);
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // リカバリー統計
    router.get('/recovery/stats', async (req, res) => {
      try {
        if (!this.healthCheckManager || !this.healthCheckManager.recoveryManager) {
          return res.status(503).json({
            status: 'error',
            message: 'RecoveryManagerが利用できません'
          });
        }
        
        const stats = this.healthCheckManager.recoveryManager.getStatistics();
        res.json(stats);
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
    
    // アラート統計
    router.get('/alerts/stats', async (req, res) => {
      try {
        if (!this.healthCheckManager || !this.healthCheckManager.alertManager) {
          return res.status(503).json({
            status: 'error',
            message: 'AlertManagerが利用できません'
          });
        }
        
        const stats = this.healthCheckManager.alertManager.getStatistics();
        res.json(stats);
        
      } catch (error) {
        res.status(500).json({
          status: 'error',
          error: error.message
        });
      }
    });
  }
  
  getRouter() {
    return router;
  }
}

module.exports = HealthAPI;