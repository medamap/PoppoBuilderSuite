/**
 * Monitoring Manager
 * ヘルスチェック、プロセス監視、自動回復を統合管理
 */

const { EventEmitter } = require('events');
const HealthChecker = require('./health-checker');
const ProcessMonitor = require('./process-monitor');
const AutoRecovery = require('./auto-recovery');
const { MultiLogger, getInstance: getLoggerInstance } = require('../utils/multi-logger');
const path = require('path');
const os = require('os');

class MonitoringManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enableHealthCheck: options.enableHealthCheck !== false,
      enableProcessMonitor: options.enableProcessMonitor !== false,
      enableAutoRecovery: options.enableAutoRecovery !== false,
      healthCheckInterval: options.healthCheckInterval || 30000,
      processUpdateInterval: options.processUpdateInterval || 5000,
      ...options
    };
    
    // コンポーネントの初期化
    this.healthChecker = null;
    this.processMonitor = null;
    this.autoRecovery = null;
    this.logger = null;
    
    this.isRunning = false;
    this.startTime = null;
    
    // 統合メトリクス
    this.metrics = {
      health: {},
      processes: {},
      recovery: {},
      lastUpdate: null
    };
  }

  /**
   * モニタリングマネージャーを初期化
   */
  async initialize() {
    // ロガーの初期化
    this.logger = getLoggerInstance();
    await this.logger.initialize();
    
    // ヘルスチェッカーの初期化
    if (this.options.enableHealthCheck) {
      this.healthChecker = new HealthChecker({
        checkInterval: this.options.healthCheckInterval,
        ...this.options.healthCheck
      });
      
      this.setupHealthCheckHandlers();
    }
    
    // プロセスモニターの初期化
    if (this.options.enableProcessMonitor) {
      this.processMonitor = new ProcessMonitor({
        updateInterval: this.options.processUpdateInterval,
        ...this.options.processMonitor
      });
      
      this.setupProcessMonitorHandlers();
    }
    
    // 自動回復の初期化
    if (this.options.enableAutoRecovery) {
      this.autoRecovery = new AutoRecovery({
        ...this.options.autoRecovery
      });
      
      this.setupAutoRecoveryHandlers();
    }
    
    await this.logger.info('Monitoring Manager initialized', {
      component: 'monitoring-manager',
      daemon: true
    });
    
    this.emit('initialized');
  }

  /**
   * モニタリングを開始
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Monitoring Manager is already running');
    }
    
    this.startTime = Date.now();
    this.isRunning = true;
    
    // 各コンポーネントを開始
    const startPromises = [];
    
    if (this.healthChecker) {
      startPromises.push(this.healthChecker.start());
    }
    
    if (this.processMonitor) {
      startPromises.push(this.processMonitor.start());
    }
    
    await Promise.all(startPromises);
    
    await this.logger.info('Monitoring Manager started', {
      component: 'monitoring-manager',
      daemon: true
    });
    
    this.emit('started');
  }

  /**
   * モニタリングを停止
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    // 各コンポーネントを停止
    if (this.healthChecker) {
      this.healthChecker.stop();
    }
    
    if (this.processMonitor) {
      this.processMonitor.stop();
    }
    
    this.isRunning = false;
    
    await this.logger.info('Monitoring Manager stopped', {
      component: 'monitoring-manager',
      daemon: true,
      metadata: {
        uptime: Date.now() - this.startTime
      }
    });
    
    this.emit('stopped');
  }

  /**
   * ヘルスチェックハンドラーの設定
   */
  setupHealthCheckHandlers() {
    // ヘルスチェック完了
    this.healthChecker.on('health-check-completed', async (status) => {
      this.metrics.health = status;
      this.metrics.lastUpdate = Date.now();
      
      await this.logger.debug('Health check completed', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: {
          overall: status.overall,
          duration: status.duration
        }
      });
      
      this.emit('health-updated', status);
    });
    
    // 不健全な状態
    this.healthChecker.on('unhealthy', async (status) => {
      await this.logger.warn('System unhealthy', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: status
      });
      
      this.emit('system-unhealthy', status);
    });
    
    // 回復が必要
    this.healthChecker.on('recovery-needed', async (status) => {
      if (this.autoRecovery) {
        // 不健全なチェックごとに回復を試行
        for (const [checkName, check] of Object.entries(status.checks)) {
          if (check.status === 'unhealthy') {
            await this.attemptRecovery(checkName, check);
          }
        }
      }
    });
  }

  /**
   * プロセスモニターハンドラーの設定
   */
  setupProcessMonitorHandlers() {
    // プロセス追加
    this.processMonitor.on('process-added', async (info) => {
      await this.logger.info('Process added to monitoring', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: info
      });
    });
    
    // プロセス削除
    this.processMonitor.on('process-removed', async (info) => {
      await this.logger.info('Process removed from monitoring', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: info
      });
    });
    
    // プロセス死亡
    this.processMonitor.on('process-dead', async (data) => {
      await this.logger.error('Process died', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data
      });
      
      if (this.autoRecovery) {
        await this.attemptRecovery('process-dead', data);
      }
    });
    
    // 高CPU使用
    this.processMonitor.on('high-cpu', async (data) => {
      await this.logger.warn('High CPU usage detected', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data
      });
      
      if (this.autoRecovery) {
        await this.attemptRecovery('high-cpu', data);
      }
    });
    
    // 高メモリ使用
    this.processMonitor.on('high-memory', async (data) => {
      await this.logger.warn('High memory usage detected', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data
      });
      
      if (this.autoRecovery) {
        await this.attemptRecovery('high-memory', data);
      }
    });
    
    // ゾンビプロセス
    this.processMonitor.on('zombie-process', async (data) => {
      await this.logger.warn('Zombie process detected', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data
      });
      
      if (this.autoRecovery) {
        await this.attemptRecovery('zombie-process', data);
      }
    });
    
    // メトリクス更新
    this.processMonitor.on('metrics-updated', (metrics) => {
      this.metrics.processes = metrics;
      this.emit('process-metrics-updated', metrics);
    });
  }

  /**
   * 自動回復ハンドラーの設定
   */
  setupAutoRecoveryHandlers() {
    // 回復開始
    this.autoRecovery.on('recovery-started', async (data) => {
      await this.logger.info('Recovery started', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data
      });
    });
    
    // 回復成功
    this.autoRecovery.on('recovery-success', async (data) => {
      await this.logger.info('Recovery successful', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data
      });
      
      this.emit('recovery-success', data);
    });
    
    // 回復失敗
    this.autoRecovery.on('recovery-failed', async (data) => {
      await this.logger.error('Recovery failed', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data
      });
      
      this.emit('recovery-failed', data);
    });
    
    // 回復エラー
    this.autoRecovery.on('recovery-error', async (data) => {
      await this.logger.error('Recovery error', {
        component: 'monitoring-manager',
        daemon: true,
        metadata: data,
        error: data.error
      });
    });
  }

  /**
   * 回復を試行
   */
  async attemptRecovery(issue, context) {
    if (!this.autoRecovery) {
      return;
    }
    
    // コンテキストに必要な関数を追加
    const enrichedContext = {
      ...context,
      clearCache: this.clearCache.bind(this),
      pauseQueue: this.pauseQueue.bind(this),
      restartProcess: this.restartProcess.bind(this)
    };
    
    const result = await this.autoRecovery.attemptRecovery(issue, enrichedContext);
    
    if (result) {
      this.metrics.recovery = this.autoRecovery.getRecoveryStats();
    }
    
    return result;
  }

  /**
   * プロセスを監視に追加
   */
  addProcess(pid, info = {}) {
    if (this.processMonitor) {
      this.processMonitor.addProcess(pid, info);
    }
  }

  /**
   * プロセスを監視から削除
   */
  removeProcess(pid) {
    if (this.processMonitor) {
      this.processMonitor.removeProcess(pid);
    }
  }

  /**
   * カスタムヘルスチェックを登録
   */
  registerHealthCheck(name, checkFunction) {
    if (this.healthChecker) {
      this.healthChecker.registerCheck(name, checkFunction);
    }
  }

  /**
   * カスタム回復アクションを登録
   */
  registerRecoveryAction(issue, actionFunction) {
    if (this.autoRecovery) {
      this.autoRecovery.registerAction(issue, actionFunction);
    }
  }

  /**
   * 現在のステータスを取得
   */
  getStatus() {
    const status = {
      running: this.isRunning,
      uptime: this.isRunning ? Date.now() - this.startTime : 0,
      health: this.healthChecker ? this.healthChecker.getStatus() : null,
      processes: this.processMonitor ? {
        count: this.processMonitor.processes.size,
        metrics: this.metrics.processes
      } : null,
      recovery: this.autoRecovery ? this.autoRecovery.getRecoveryStats() : null
    };
    
    return status;
  }

  /**
   * 統合レポートを生成
   */
  async generateReport(format = 'json') {
    const report = {
      timestamp: new Date().toISOString(),
      status: this.getStatus(),
      health: this.healthChecker ? await this.healthChecker.exportStatus(format) : null,
      processes: this.processMonitor ? await this.processMonitor.exportMetrics(format) : null,
      recovery: this.autoRecovery ? this.autoRecovery.getRecoveryHistory() : null
    };
    
    if (format === 'json') {
      return JSON.stringify(report, null, 2);
    }
    
    return report;
  }

  /**
   * キャッシュをクリア（回復アクション用）
   */
  async clearCache() {
    // 実装はアプリケーション固有
    await this.logger.info('Cache cleared', {
      component: 'monitoring-manager',
      daemon: true
    });
  }

  /**
   * キューを一時停止（回復アクション用）
   */
  async pauseQueue(duration) {
    // 実装はアプリケーション固有
    await this.logger.info(`Queue paused for ${duration}ms`, {
      component: 'monitoring-manager',
      daemon: true
    });
    
    setTimeout(() => {
      this.logger.info('Queue resumed', {
        component: 'monitoring-manager',
        daemon: true
      });
    }, duration);
  }

  /**
   * プロセスを再起動（回復アクション用）
   */
  async restartProcess(pid) {
    // 実装はアプリケーション固有
    const newPid = process.pid; // 仮の実装
    
    await this.logger.info(`Process restarted: ${pid} -> ${newPid}`, {
      component: 'monitoring-manager',
      daemon: true
    });
    
    return newPid;
  }
}

// シングルトンインスタンス
let instance = null;

/**
 * シングルトンインスタンスを取得
 */
function getInstance(options) {
  if (!instance) {
    instance = new MonitoringManager(options);
  }
  return instance;
}

module.exports = {
  MonitoringManager,
  getInstance
};