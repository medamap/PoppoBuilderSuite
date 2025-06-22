/**
 * Health System Manager - Issue #128完成版
 * 全ての健康管理コンポーネントを統合するマスターマネージャー
 */

const HealthScheduler = require('./health-scheduler');
const HealthSchedulerIntegration = require('./health-scheduler-integration');
const SelfHealingMonitor = require('../recovery/self-healing-monitor');
const { MonitoringManager } = require('./monitoring-manager');
const { MultiLogger, getInstance: getLoggerInstance } = require('../utils/multi-logger');

class HealthSystemManager {
  constructor(options = {}) {
    this.options = {
      enableHealthScheduler: options.enableHealthScheduler !== false,
      enableSelfHealing: options.enableSelfHealing !== false,
      enableMonitoringManager: options.enableMonitoringManager !== false,
      autoStart: options.autoStart !== false,
      ...options
    };
    
    this.logger = null;
    this.healthScheduler = null;
    this.selfHealingMonitor = null;
    this.integration = null;
    this.monitoringManager = null;
    
    this.isInitialized = false;
    this.isRunning = false;
    this.systemHealth = {
      overall: 'unknown',
      lastCheck: null,
      components: {}
    };
  }

  /**
   * システム全体を初期化
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // ロガーの初期化
      this.logger = getLoggerInstance();
      await this.logger.initialize();
      
      await this.logger.info('Initializing Health System Manager', {
        component: 'health-system-manager',
        options: {
          healthScheduler: this.options.enableHealthScheduler,
          selfHealing: this.options.enableSelfHealing,
          monitoringManager: this.options.enableMonitoringManager
        }
      });

      // 統合システムの初期化
      this.integration = new HealthSchedulerIntegration({
        enableHealthScheduler: this.options.enableHealthScheduler,
        enableMonitoringManager: this.options.enableMonitoringManager,
        ...this.options
      });
      await this.integration.initialize();
      
      // Self-Healing Monitorの初期化
      if (this.options.enableSelfHealing) {
        this.selfHealingMonitor = new SelfHealingMonitor({
          checkInterval: 60000, // 1分間隔
          healingEnabled: true,
          maxHealingAttempts: 3,
          healingCooldown: 300000, // 5分
          ...this.options.selfHealing
        });
        
        this.setupSelfHealingIntegration();
      }

      // コンポーネント参照の設定
      this.healthScheduler = this.integration.healthScheduler;
      this.monitoringManager = this.integration.monitoringManager;
      
      // PoppoBuilder固有のヘルスチェックを設定
      this.setupPoppoBuilderHealthChecks();
      
      // システム全体のイベントハンドラーを設定
      this.setupSystemEventHandlers();
      
      this.isInitialized = true;
      
      await this.logger.info('Health System Manager initialized successfully', {
        component: 'health-system-manager'
      });
      
      // 自動開始オプション
      if (this.options.autoStart) {
        await this.start();
      }
      
    } catch (error) {
      await this.logger.error('Failed to initialize Health System Manager', {
        error,
        component: 'health-system-manager'
      });
      throw error;
    }
  }

  /**
   * システム全体を開始
   */
  async start() {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    if (this.isRunning) {
      return;
    }

    try {
      // 統合システムの開始
      await this.integration.start();
      
      // Self-Healing Monitorの開始
      if (this.selfHealingMonitor) {
        await this.selfHealingMonitor.start();
      }
      
      this.isRunning = true;
      
      await this.logger.info('Health System Manager started', {
        component: 'health-system-manager'
      });
      
      // 初期ヘルスチェックの実行
      setTimeout(async () => {
        await this.performInitialHealthCheck();
      }, 5000); // 5秒後に実行
      
    } catch (error) {
      await this.logger.error('Failed to start Health System Manager', {
        error,
        component: 'health-system-manager'
      });
      throw error;
    }
  }

  /**
   * システム全体を停止
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    try {
      // Self-Healing Monitorの停止
      if (this.selfHealingMonitor) {
        await this.selfHealingMonitor.stop();
      }
      
      // 統合システムの停止
      await this.integration.stop();
      
      this.isRunning = false;
      
      await this.logger.info('Health System Manager stopped', {
        component: 'health-system-manager'
      });
      
    } catch (error) {
      await this.logger.error('Failed to stop Health System Manager', {
        error,
        component: 'health-system-manager'
      });
    }
  }

  /**
   * Self-Healing Monitorとの統合設定
   */
  setupSelfHealingIntegration() {
    if (!this.selfHealingMonitor) {
      return;
    }

    // Self-Healingイベントのリスニング
    this.selfHealingMonitor.on('health-check-completed', async (result) => {
      this.systemHealth.components.selfHealing = result;
      this.systemHealth.lastCheck = new Date().toISOString();
      
      // 重大な問題が検出された場合、緊急診断を実行
      if (result.overallHealth.status === 'critical' && this.healthScheduler) {
        await this.logger.warn('Critical health detected, triggering emergency diagnostic', {
          component: 'health-system-manager',
          healthStatus: result.overallHealth
        });
        
        try {
          await this.healthScheduler.runDiagnostic('daily');
        } catch (error) {
          await this.logger.error('Emergency diagnostic failed', {
            error,
            component: 'health-system-manager'
          });
        }
      }
    });

    this.selfHealingMonitor.on('healing-successful', async (data) => {
      await this.logger.info('Self-healing successful', {
        component: 'health-system-manager',
        healing: data
      });
    });

    this.selfHealingMonitor.on('healing-failed', async (data) => {
      await this.logger.error('Self-healing failed', {
        component: 'health-system-manager',
        healing: data
      });
      
      // 自己修復が失敗した場合、包括的な診断を実行
      if (this.healthScheduler) {
        try {
          await this.healthScheduler.runDiagnostic('weekly');
        } catch (error) {
          await this.logger.error('Comprehensive diagnostic after healing failure failed', {
            error,
            component: 'health-system-manager'
          });
        }
      }
    });
  }

  /**
   * システム全体のイベントハンドラー設定
   */
  setupSystemEventHandlers() {
    // HealthSchedulerからのイベント
    if (this.healthScheduler) {
      this.healthScheduler.on('diagnostic-completed', async (results) => {
        this.systemHealth.components.scheduler = results;
        this.systemHealth.lastCheck = new Date().toISOString();
        
        // 全体的な健康状態を更新
        this.updateOverallHealth();
        
        await this.logger.info('System health updated from scheduler', {
          component: 'health-system-manager',
          overallHealth: this.systemHealth.overall
        });
      });
    }

    // MonitoringManagerからのイベント
    if (this.monitoringManager) {
      this.monitoringManager.on('system-unhealthy', async (status) => {
        await this.logger.warn('System unhealthy detected', {
          component: 'health-system-manager',
          status
        });
        
        // 自己修復を試行
        if (this.selfHealingMonitor) {
          // SelfHealingMonitorに通知（必要に応じて手動でhealth checkを実行）
          try {
            await this.selfHealingMonitor.performHealthCheck();
          } catch (error) {
            await this.logger.error('Failed to trigger self-healing check', {
              error,
              component: 'health-system-manager'
            });
          }
        }
      });
    }
  }

  /**
   * PoppoBuilder固有のヘルスチェックを設定
   */
  setupPoppoBuilderHealthChecks() {
    // 統合システム経由でヘルスチェックを追加
    this.integration.setupPoppoBuilderHealthChecks();
    
    // Self-Healing Monitorにも追加のヘルスチェックを設定
    if (this.selfHealingMonitor) {
      this.selfHealingMonitor.addHealthCheck('poppo-processes', {
        name: 'PoppoBuilder Processes',
        check: async () => {
          const { execSync } = require('child_process');
          try {
            const result = execSync('pgrep -f "node.*poppo"', { encoding: 'utf8' });
            const processCount = result.trim().split('\n').filter(pid => pid).length;
            
            return {
              healthy: processCount > 0,
              metrics: { processCount },
              details: { 
                processes: processCount,
                status: processCount > 0 ? 'running' : 'stopped'
              }
            };
          } catch (error) {
            return {
              healthy: false,
              metrics: { processCount: 0 },
              details: { error: error.message }
            };
          }
        },
        healing: async () => {
          // PoppoBuilderプロセスの再起動ロジック（実装依存）
          return { action: 'process-restart-attempted' };
        },
        enabled: true
      });
    }
  }

  /**
   * 初期ヘルスチェックを実行
   */
  async performInitialHealthCheck() {
    try {
      await this.logger.info('Performing initial health check', {
        component: 'health-system-manager'
      });
      
      // HealthSchedulerで日次診断を実行
      if (this.healthScheduler) {
        await this.healthScheduler.runDiagnostic('daily');
      }
      
      // Self-Healing Monitorでヘルスチェックを実行
      if (this.selfHealingMonitor) {
        await this.selfHealingMonitor.performHealthCheck();
      }
      
    } catch (error) {
      await this.logger.error('Initial health check failed', {
        error,
        component: 'health-system-manager'
      });
    }
  }

  /**
   * 全体的な健康状態を更新
   */
  updateOverallHealth() {
    const components = this.systemHealth.components;
    let overallScore = 100;
    let statusCount = { healthy: 0, warning: 0, critical: 0 };
    
    // HealthSchedulerの結果
    if (components.scheduler) {
      const schedulerStatus = components.scheduler.overallStatus;
      if (schedulerStatus === 'failed') {
        overallScore -= 30;
        statusCount.critical++;
      } else if (schedulerStatus === 'warning') {
        overallScore -= 15;
        statusCount.warning++;
      } else {
        statusCount.healthy++;
      }
    }
    
    // Self-Healing Monitorの結果
    if (components.selfHealing) {
      const healingScore = components.selfHealing.overallHealth.score;
      overallScore = Math.min(overallScore, healingScore);
      
      if (healingScore >= 80) {
        statusCount.healthy++;
      } else if (healingScore >= 60) {
        statusCount.warning++;
      } else {
        statusCount.critical++;
      }
    }
    
    // 全体ステータスの決定
    if (statusCount.critical > 0) {
      this.systemHealth.overall = 'critical';
    } else if (statusCount.warning > 0) {
      this.systemHealth.overall = 'warning';
    } else {
      this.systemHealth.overall = 'healthy';
    }
    
    this.systemHealth.score = Math.max(0, overallScore);
  }

  /**
   * システム全体のステータスを取得
   */
  getSystemStatus() {
    return {
      ...this.systemHealth,
      isRunning: this.isRunning,
      isInitialized: this.isInitialized,
      components: {
        healthScheduler: this.healthScheduler ? this.integration.getIntegratedStatus().healthScheduler : null,
        monitoringManager: this.monitoringManager ? this.integration.getIntegratedStatus().monitoringManager : null,
        selfHealingMonitor: this.selfHealingMonitor ? this.selfHealingMonitor.getHealingStatistics() : null
      }
    };
  }

  /**
   * 包括的なシステムレポートを生成
   */
  async generateSystemReport() {
    const report = {
      timestamp: new Date().toISOString(),
      systemHealth: this.getSystemStatus()
    };
    
    // 統合レポートを追加
    if (this.integration) {
      try {
        report.integration = await this.integration.generateIntegratedReport();
      } catch (error) {
        await this.logger.error('Failed to generate integration report', {
          error,
          component: 'health-system-manager'
        });
      }
    }
    
    // Self-Healing統計を追加
    if (this.selfHealingMonitor) {
      report.selfHealing = this.selfHealingMonitor.getHealingStatistics();
    }
    
    return report;
  }

  /**
   * 緊急診断を実行
   */
  async performEmergencyDiagnostic() {
    await this.logger.info('Performing emergency diagnostic', {
      component: 'health-system-manager'
    });
    
    const results = [];
    
    // HealthSchedulerで月次診断（最も包括的）を実行
    if (this.healthScheduler) {
      try {
        const schedulerResult = await this.healthScheduler.runDiagnostic('monthly');
        results.push({ component: 'scheduler', result: schedulerResult });
      } catch (error) {
        results.push({ component: 'scheduler', error: error.message });
      }
    }
    
    // Self-Healing Monitorでヘルスチェックを実行
    if (this.selfHealingMonitor) {
      try {
        const healingResult = await this.selfHealingMonitor.performHealthCheck();
        results.push({ component: 'selfHealing', result: healingResult });
      } catch (error) {
        results.push({ component: 'selfHealing', error: error.message });
      }
    }
    
    return results;
  }
}

// シングルトンインスタンス
let instance = null;

/**
 * シングルトンインスタンスを取得
 */
function getInstance(options) {
  if (!instance) {
    instance = new HealthSystemManager(options);
  }
  return instance;
}

module.exports = {
  HealthSystemManager,
  getInstance
};