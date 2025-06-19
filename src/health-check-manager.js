const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const Logger = require('./logger');

// モニターのインポート
const ApplicationMonitor = require('./monitors/application-monitor');
const SystemMonitor = require('./monitors/system-monitor');
const NetworkMonitor = require('./monitors/network-monitor');
const DataMonitor = require('./monitors/data-monitor');

// 関連マネージャー
const MetricsStore = require('./health-metrics-store');
const RecoveryManager = require('./recovery-manager');
const AlertManager = require('./alert-manager');

/**
 * ヘルスチェックマネージャー
 * システム全体の健全性を監視し、問題を検出・対処する
 */
class HealthCheckManager extends EventEmitter {
  constructor(config, processManager, notificationManager) {
    super();
    this.config = config.healthCheck || {};
    this.processManager = processManager;
    this.notificationManager = notificationManager;
    this.logger = new Logger('HealthCheckManager');
    
    // デフォルト設定
    this.config = {
      enabled: true,
      interval: 60000, // 1分
      scoring: {
        weights: {
          application: 0.4,
          system: 0.3,
          network: 0.2,
          data: 0.1
        }
      },
      thresholds: {
        healthy: 80,
        degraded: 60
      },
      autoRecovery: {
        enabled: true,
        actions: {
          memoryCleanup: true,
          processRestart: true,
          diskCleanup: true,
          apiRetry: true
        }
      },
      alerts: {
        enabled: true,
        channels: ['log'],
        throttle: 300000 // 5分
      },
      ...this.config
    };
    
    // モニターの初期化
    this.monitors = {
      application: new ApplicationMonitor(this.processManager),
      system: new SystemMonitor(),
      network: new NetworkMonitor(config),
      data: new DataMonitor(config)
    };
    
    // 関連マネージャーの初期化
    this.metricsStore = new MetricsStore();
    this.recoveryManager = new RecoveryManager(this.processManager);
    this.alertManager = new AlertManager(this.notificationManager);
    
    // 状態管理
    this.lastCheck = null;
    this.currentHealth = {
      status: 'unknown',
      score: 0,
      timestamp: null
    };
    
    // チェック間隔タイマー
    this.checkInterval = null;
  }
  
  /**
   * ヘルスチェックマネージャーの開始
   */
  async start() {
    if (!this.config.enabled) {
      this.logger.info('ヘルスチェックは無効化されています');
      return;
    }
    
    this.logger.info('ヘルスチェックマネージャーを開始します');
    
    // 初回チェック
    await this.performHealthCheck();
    
    // 定期チェックの開始
    this.checkInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, this.config.interval);
    
    this.logger.info(`ヘルスチェックを${this.config.interval}ms間隔で実行します`);
  }
  
  /**
   * ヘルスチェックマネージャーの停止
   */
  async stop() {
    this.logger.info('ヘルスチェックマネージャーを停止します');
    
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    
    // メトリクスの保存
    await this.metricsStore.save();
  }
  
  /**
   * ヘルスチェックの実行
   */
  async performHealthCheck() {
    const startTime = Date.now();
    this.logger.debug('ヘルスチェックを開始します');
    
    try {
      // 各モニターからデータを収集
      const results = await this.collectMonitorData();
      
      // スコアの計算
      const score = this.calculateScore(results);
      
      // 健全性ステータスの判定
      const status = this.determineStatus(score);
      
      // 結果の保存
      const healthData = {
        status,
        score,
        timestamp: new Date().toISOString(),
        components: results,
        duration: Date.now() - startTime
      };
      
      this.currentHealth = healthData;
      this.lastCheck = new Date();
      
      // メトリクスストアに記録
      await this.metricsStore.record(healthData);
      
      // 状態変化の検出
      await this.detectStateChanges(healthData);
      
      // 自動回復の実行
      if (this.config.autoRecovery.enabled) {
        await this.performAutoRecovery(healthData);
      }
      
      // イベント発火
      this.emit('health:checked', healthData);
      
      this.logger.info(`ヘルスチェック完了: ${status} (スコア: ${score})`);
      
      return healthData;
      
    } catch (error) {
      this.logger.error('ヘルスチェック中にエラーが発生しました:', error);
      
      // エラー時の健全性データ
      const errorData = {
        status: 'error',
        score: 0,
        timestamp: new Date().toISOString(),
        error: error.message,
        duration: Date.now() - startTime
      };
      
      this.currentHealth = errorData;
      this.emit('health:error', error);
      
      return errorData;
    }
  }
  
  /**
   * 各モニターからデータを収集
   */
  async collectMonitorData() {
    const results = {};
    
    for (const [name, monitor] of Object.entries(this.monitors)) {
      try {
        this.logger.debug(`${name}モニターをチェック中...`);
        const data = await monitor.check();
        results[name] = data;
      } catch (error) {
        this.logger.error(`${name}モニターでエラー:`, error);
        results[name] = {
          status: 'error',
          score: 0,
          error: error.message
        };
      }
    }
    
    return results;
  }
  
  /**
   * 総合スコアの計算
   */
  calculateScore(results) {
    const weights = this.config.scoring.weights;
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const [component, weight] of Object.entries(weights)) {
      if (results[component] && typeof results[component].score === 'number') {
        totalScore += results[component].score * weight;
        totalWeight += weight;
      }
    }
    
    // 重みの正規化
    if (totalWeight > 0) {
      return Math.round(totalScore / totalWeight);
    }
    
    return 0;
  }
  
  /**
   * 健全性ステータスの判定
   */
  determineStatus(score) {
    const { healthy, degraded } = this.config.thresholds;
    
    if (score >= healthy) {
      return 'healthy';
    } else if (score >= degraded) {
      return 'degraded';
    } else {
      return 'unhealthy';
    }
  }
  
  /**
   * 状態変化の検出とアラート
   */
  async detectStateChanges(currentHealth) {
    // 前回のチェック結果を取得
    const previousHealth = await this.metricsStore.getLatest();
    
    if (!previousHealth) {
      return;
    }
    
    // ステータスの変化を検出
    if (previousHealth.status !== currentHealth.status) {
      this.logger.warn(`健全性ステータスが変化しました: ${previousHealth.status} → ${currentHealth.status}`);
      
      // アラート送信
      if (this.config.alerts.enabled) {
        await this.alertManager.sendAlert({
          type: 'health_status_change',
          severity: currentHealth.status === 'unhealthy' ? 'critical' : 'warning',
          title: 'システム健全性ステータス変更',
          message: `システムの健全性が「${previousHealth.status}」から「${currentHealth.status}」に変化しました`,
          details: {
            previousScore: previousHealth.score,
            currentScore: currentHealth.score,
            components: currentHealth.components
          }
        });
      }
      
      // イベント発火
      this.emit('health:statusChanged', {
        previous: previousHealth.status,
        current: currentHealth.status,
        score: currentHealth.score
      });
    }
    
    // スコアの急激な低下を検出（10ポイント以上）
    if (previousHealth.score - currentHealth.score >= 10) {
      this.logger.warn(`健全性スコアが急激に低下しました: ${previousHealth.score} → ${currentHealth.score}`);
      
      if (this.config.alerts.enabled) {
        await this.alertManager.sendAlert({
          type: 'health_score_drop',
          severity: 'warning',
          title: 'システム健全性スコア低下',
          message: `健全性スコアが${previousHealth.score}から${currentHealth.score}に低下しました`,
          details: currentHealth.components
        });
      }
    }
  }
  
  /**
   * 自動回復の実行
   */
  async performAutoRecovery(healthData) {
    const actions = this.config.autoRecovery.actions;
    const recoveryActions = [];
    
    // システムメモリ使用率が高い場合
    if (actions.memoryCleanup && 
        healthData.components.system?.details?.memory > 80) {
      recoveryActions.push(this.recoveryManager.cleanupMemory());
    }
    
    // 応答しないプロセスがある場合
    if (actions.processRestart && 
        healthData.components.application?.details?.unresponsiveAgents?.length > 0) {
      for (const agent of healthData.components.application.details.unresponsiveAgents) {
        recoveryActions.push(this.recoveryManager.restartProcess(agent));
      }
    }
    
    // ディスク容量が少ない場合
    if (actions.diskCleanup && 
        healthData.components.system?.details?.disk > 90) {
      recoveryActions.push(this.recoveryManager.cleanupDisk());
    }
    
    // API接続エラーが多い場合
    if (actions.apiRetry && 
        healthData.components.network?.details?.errorRate > 50) {
      recoveryActions.push(this.recoveryManager.resetApiConnections());
    }
    
    // 回復アクションの実行
    if (recoveryActions.length > 0) {
      this.logger.info(`${recoveryActions.length}個の自動回復アクションを実行します`);
      
      const results = await Promise.allSettled(recoveryActions);
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      this.logger.info(`自動回復完了: 成功=${successful}, 失敗=${failed}`);
      
      // 回復アクションの結果を記録
      this.emit('health:recoveryPerformed', {
        actions: recoveryActions.length,
        successful,
        failed,
        results
      });
    }
  }
  
  /**
   * 現在の健全性データを取得
   */
  getHealth() {
    return this.currentHealth;
  }
  
  /**
   * 詳細な健全性データを取得
   */
  async getDetailedHealth() {
    // 最新のチェックを実行
    if (!this.lastCheck || Date.now() - this.lastCheck > 5000) {
      await this.performHealthCheck();
    }
    
    return {
      ...this.currentHealth,
      uptime: process.uptime(),
      lastCheck: this.lastCheck,
      config: {
        interval: this.config.interval,
        thresholds: this.config.thresholds,
        autoRecovery: this.config.autoRecovery.enabled
      }
    };
  }
  
  /**
   * 準備完了状態のチェック
   */
  async checkReadiness() {
    const checks = {
      database: false,
      agents: false,
      api: false,
      filesystem: false
    };
    
    try {
      // データベースチェック
      checks.database = await this.monitors.data.checkDatabase();
      
      // エージェントチェック
      const appHealth = await this.monitors.application.check();
      checks.agents = appHealth.status !== 'unhealthy';
      
      // APIチェック
      const networkHealth = await this.monitors.network.check();
      checks.api = networkHealth.status !== 'unhealthy';
      
      // ファイルシステムチェック
      const systemHealth = await this.monitors.system.check();
      checks.filesystem = systemHealth.details.disk < 95;
      
    } catch (error) {
      this.logger.error('準備状態チェックエラー:', error);
    }
    
    const ready = Object.values(checks).every(check => check === true);
    
    return {
      ready,
      checks,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * Prometheus形式のメトリクスを生成
   */
  async getPrometheusMetrics() {
    const health = await this.getDetailedHealth();
    const metrics = [];
    
    // 総合スコア
    metrics.push('# HELP poppobuilder_health_score Overall health score');
    metrics.push('# TYPE poppobuilder_health_score gauge');
    metrics.push(`poppobuilder_health_score ${health.score}`);
    
    // コンポーネント別スコア
    metrics.push('# HELP poppobuilder_component_score Component health scores');
    metrics.push('# TYPE poppobuilder_component_score gauge');
    
    for (const [component, data] of Object.entries(health.components || {})) {
      if (data.score !== undefined) {
        metrics.push(`poppobuilder_component_score{component="${component}"} ${data.score}`);
      }
    }
    
    // システムメトリクス
    if (health.components?.system?.details) {
      const { cpu, memory, disk } = health.components.system.details;
      
      metrics.push('# HELP poppobuilder_cpu_usage CPU usage percentage');
      metrics.push('# TYPE poppobuilder_cpu_usage gauge');
      metrics.push(`poppobuilder_cpu_usage ${cpu || 0}`);
      
      metrics.push('# HELP poppobuilder_memory_usage Memory usage percentage');
      metrics.push('# TYPE poppobuilder_memory_usage gauge');
      metrics.push(`poppobuilder_memory_usage ${memory || 0}`);
      
      metrics.push('# HELP poppobuilder_disk_usage Disk usage percentage');
      metrics.push('# TYPE poppobuilder_disk_usage gauge');
      metrics.push(`poppobuilder_disk_usage ${disk || 0}`);
    }
    
    // エージェントステータス
    if (health.components?.application?.details?.agents) {
      metrics.push('# HELP poppobuilder_agent_status Agent status (1=running, 0=stopped)');
      metrics.push('# TYPE poppobuilder_agent_status gauge');
      
      for (const [agent, info] of Object.entries(health.components.application.details.agents)) {
        const status = info.status === 'running' ? 1 : 0;
        metrics.push(`poppobuilder_agent_status{agent="${agent}"} ${status}`);
      }
    }
    
    return metrics.join('\n');
  }
  
  /**
   * 診断レポートの生成
   */
  async generateDiagnosticReport() {
    const report = {
      timestamp: new Date().toISOString(),
      system: {
        platform: process.platform,
        nodeVersion: process.version,
        uptime: process.uptime(),
        pid: process.pid
      },
      health: await this.getDetailedHealth(),
      history: await this.metricsStore.getHistory(24), // 過去24時間
      trends: await this.metricsStore.analyzeTrends(),
      recommendations: []
    };
    
    // 推奨事項の生成
    if (report.health.score < 60) {
      report.recommendations.push('システムの健全性が低下しています。詳細を確認してください。');
    }
    
    if (report.health.components?.system?.details?.memory > 80) {
      report.recommendations.push('メモリ使用率が高くなっています。不要なプロセスを停止するか、メモリを増設してください。');
    }
    
    if (report.health.components?.system?.details?.disk > 85) {
      report.recommendations.push('ディスク容量が不足しています。古いログファイルを削除してください。');
    }
    
    if (report.trends?.declining) {
      report.recommendations.push('健全性スコアが低下傾向にあります。システムの監視を強化してください。');
    }
    
    return report;
  }
}

module.exports = HealthCheckManager;