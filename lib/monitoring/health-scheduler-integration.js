/**
 * Health Scheduler Integration - Issue #128
 * 既存のMonitoringManagerとHealthSchedulerの統合モジュール
 */

const HealthScheduler = require('./health-scheduler');
const { MonitoringManager } = require('./monitoring-manager');
const { MultiLogger, getInstance: getLoggerInstance } = require('../utils/multi-logger');

class HealthSchedulerIntegration {
  constructor(options = {}) {
    this.options = {
      enableHealthScheduler: options.enableHealthScheduler !== false,
      enableMonitoringManager: options.enableMonitoringManager !== false,
      ...options
    };
    
    this.logger = null;
    this.healthScheduler = null;
    this.monitoringManager = null;
    this.isInitialized = false;
    this.isRunning = false;
  }

  /**
   * 統合システムを初期化
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // ロガーの初期化
      this.logger = getLoggerInstance();
      await this.logger.initialize();
      
      // MonitoringManagerの初期化
      if (this.options.enableMonitoringManager) {
        this.monitoringManager = MonitoringManager.getInstance(this.options.monitoringManager);
        await this.monitoringManager.initialize();
        
        await this.logger.info('MonitoringManager initialized', {
          component: 'health-scheduler-integration'
        });
      }
      
      // HealthSchedulerの初期化
      if (this.options.enableHealthScheduler) {
        this.healthScheduler = new HealthScheduler({
          ...this.options.healthScheduler,
          // MonitoringManagerとの統合設定
          monitoringManager: this.monitoringManager
        });
        await this.healthScheduler.initialize();
        
        await this.logger.info('HealthScheduler initialized', {
          component: 'health-scheduler-integration'
        });
      }
      
      // イベントハンドラーの設定
      this.setupEventHandlers();
      
      this.isInitialized = true;
      
      await this.logger.info('Health Scheduler Integration initialized successfully', {
        component: 'health-scheduler-integration',
        healthSchedulerEnabled: this.options.enableHealthScheduler,
        monitoringManagerEnabled: this.options.enableMonitoringManager
      });
      
    } catch (error) {
      await this.logger.error('Failed to initialize Health Scheduler Integration', {
        error,
        component: 'health-scheduler-integration'
      });
      throw error;
    }
  }

  /**
   * 統合システムを開始
   */
  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      return;
    }

    try {
      // MonitoringManagerの開始
      if (this.monitoringManager) {
        await this.monitoringManager.start();
      }
      
      // HealthSchedulerの開始
      if (this.healthScheduler) {
        await this.healthScheduler.start();
      }
      
      this.isRunning = true;
      
      await this.logger.info('Health Scheduler Integration started', {
        component: 'health-scheduler-integration'
      });
      
    } catch (error) {
      await this.logger.error('Failed to start Health Scheduler Integration', {
        error,
        component: 'health-scheduler-integration'
      });
      throw error;
    }
  }

  /**
   * 統合システムを停止
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      // HealthSchedulerの停止
      if (this.healthScheduler) {
        this.healthScheduler.stop();
      }
      
      // MonitoringManagerの停止
      if (this.monitoringManager) {
        await this.monitoringManager.stop();
      }
      
      this.isRunning = false;
      
      await this.logger.info('Health Scheduler Integration stopped', {
        component: 'health-scheduler-integration'
      });
      
    } catch (error) {
      await this.logger.error('Failed to stop Health Scheduler Integration', {
        error,
        component: 'health-scheduler-integration'
      });
    }
  }

  /**
   * イベントハンドラーの設定
   */
  setupEventHandlers() {
    // HealthSchedulerイベント
    if (this.healthScheduler) {
      this.healthScheduler.on('diagnostic-started', async (data) => {
        await this.logger.info('Health diagnostic started', {
          component: 'health-scheduler-integration',
          diagnostic: data
        });
      });

      this.healthScheduler.on('diagnostic-completed', async (results) => {
        await this.logger.info('Health diagnostic completed', {
          component: 'health-scheduler-integration',
          overallStatus: results.overallStatus,
          duration: results.duration,
          summary: results.summary
        });
        
        // 不健全な状態の場合、MonitoringManagerに通知
        if (results.overallStatus !== 'passed' && this.monitoringManager) {
          this.monitoringManager.emit('health-diagnostic-warning', results);
        }
      });

      this.healthScheduler.on('diagnostic-failed', async (data) => {
        await this.logger.error('Health diagnostic failed', {
          component: 'health-scheduler-integration',
          error: data.error,
          level: data.level
        });
        
        // 診断失敗をMonitoringManagerに通知
        if (this.monitoringManager) {
          this.monitoringManager.emit('health-diagnostic-failed', data);
        }
      });
    }

    // MonitoringManagerイベント
    if (this.monitoringManager) {
      this.monitoringManager.on('system-unhealthy', async (status) => {
        await this.logger.warn('System unhealthy detected by MonitoringManager', {
          component: 'health-scheduler-integration',
          status
        });
        
        // 緊急診断をトリガー
        if (this.healthScheduler) {
          try {
            await this.healthScheduler.runDiagnostic('daily');
          } catch (error) {
            await this.logger.error('Emergency diagnostic failed', {
              error,
              component: 'health-scheduler-integration'
            });
          }
        }
      });

      this.monitoringManager.on('recovery-failed', async (data) => {
        await this.logger.error('Recovery failed in MonitoringManager', {
          component: 'health-scheduler-integration',
          data
        });
        
        // 包括的な診断を実行
        if (this.healthScheduler) {
          try {
            await this.healthScheduler.runDiagnostic('weekly');
          } catch (error) {
            await this.logger.error('Comprehensive diagnostic after recovery failure failed', {
              error,
              component: 'health-scheduler-integration'
            });
          }
        }
      });
    }
  }

  /**
   * カスタムヘルスチェックを登録
   */
  registerHealthCheck(name, checkFunction) {
    if (this.monitoringManager) {
      this.monitoringManager.registerHealthCheck(name, checkFunction);
    }
  }

  /**
   * カスタム回復アクションを登録
   */
  registerRecoveryAction(issue, actionFunction) {
    if (this.monitoringManager) {
      this.monitoringManager.registerRecoveryAction(issue, actionFunction);
    }
  }

  /**
   * 手動診断を実行
   */
  async runManualDiagnostic(level = 'daily') {
    if (!this.healthScheduler) {
      throw new Error('HealthScheduler is not initialized');
    }
    
    return await this.healthScheduler.runManualDiagnostic(level);
  }

  /**
   * 統合ステータスを取得
   */
  getIntegratedStatus() {
    const status = {
      integration: {
        initialized: this.isInitialized,
        running: this.isRunning
      },
      healthScheduler: null,
      monitoringManager: null
    };
    
    if (this.healthScheduler) {
      status.healthScheduler = this.healthScheduler.getScheduleInfo();
    }
    
    if (this.monitoringManager) {
      status.monitoringManager = this.monitoringManager.getStatus();
    }
    
    return status;
  }

  /**
   * 統合レポートを生成
   */
  async generateIntegratedReport() {
    const report = {
      timestamp: new Date().toISOString(),
      integration: this.getIntegratedStatus()
    };
    
    // HealthSchedulerからの診断履歴
    if (this.healthScheduler) {
      const scheduleInfo = this.healthScheduler.getScheduleInfo();
      report.diagnosticHistory = scheduleInfo.lastDiagnostics || [];
    }
    
    // MonitoringManagerからのレポート
    if (this.monitoringManager) {
      try {
        const monitoringReport = await this.monitoringManager.generateReport('json');
        report.monitoring = JSON.parse(monitoringReport);
      } catch (error) {
        await this.logger.error('Failed to generate monitoring report', {
          error,
          component: 'health-scheduler-integration'
        });
      }
    }
    
    return report;
  }

  /**
   * PoppoBuilder固有のヘルスチェックを追加
   */
  setupPoppoBuilderHealthChecks() {
    // GitHubトークンの有効性チェック
    this.registerHealthCheck('github-token', async () => {
      const token = process.env.GITHUB_TOKEN;
      return {
        status: token ? 'healthy' : 'unhealthy',
        metric: token ? 1 : 0,
        details: {
          tokenPresent: !!token,
          tokenLength: token ? token.length : 0
        }
      };
    });

    // ログディレクトリの存在チェック
    this.registerHealthCheck('log-directory', async () => {
      const fs = require('fs').promises;
      const path = require('path');
      
      try {
        const logsDir = path.join(process.cwd(), 'logs');
        await fs.access(logsDir);
        const files = await fs.readdir(logsDir);
        
        return {
          status: 'healthy',
          metric: files.length,
          details: {
            directory: logsDir,
            fileCount: files.length
          }
        };
      } catch (error) {
        return {
          status: 'unhealthy',
          metric: 0,
          details: {
            error: error.message
          }
        };
      }
    });

    // 設定ファイルの存在チェック
    this.registerHealthCheck('config-files', async () => {
      const fs = require('fs').promises;
      const configFiles = ['config/config.json', 'package.json'];
      const results = [];
      
      for (const file of configFiles) {
        try {
          await fs.access(file);
          results.push({ file, exists: true });
        } catch (error) {
          results.push({ file, exists: false, error: error.message });
        }
      }
      
      const missingFiles = results.filter(r => !r.exists);
      
      return {
        status: missingFiles.length === 0 ? 'healthy' : 'unhealthy',
        metric: results.filter(r => r.exists).length,
        details: {
          totalFiles: configFiles.length,
          existingFiles: results.filter(r => r.exists).length,
          missingFiles: missingFiles.map(f => f.file)
        }
      };
    });
  }
}

module.exports = HealthSchedulerIntegration;