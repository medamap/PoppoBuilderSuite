/**
 * SLA管理システム
 * SLA/SLO監視システムの統合管理
 */

const { EventEmitter } = require('events');
const MetricsCollector = require('./metrics-collector');
const SLOMonitor = require('./slo-monitor');
const SLOReportGenerator = require('./slo-report-generator');
const { AlertDefinitions } = require('./sla-definitions');
const Logger = require('../logger');
const path = require('path');

class SLAManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enabled: options.enabled !== false,
      metricsRetentionDays: options.metricsRetentionDays || 30,
      checkInterval: options.checkInterval || 60000,  // 1分
      reportSchedule: options.reportSchedule || {
        weekly: '0 0 * * 0',  // 毎週日曜日の0時
        monthly: '0 0 1 * *'  // 毎月1日の0時
      },
      ...options
    };
    
    this.logger = new Logger('SLAManager');
    this.databaseManager = options.databaseManager || null;
    this.notificationHandler = options.notificationHandler || null;
    
    // コンポーネント
    this.metricsCollector = null;
    this.sloMonitor = null;
    this.reportGenerator = null;
    
    // 状態
    this.isRunning = false;
    this.reportTimer = null;
  }

  /**
   * 初期化
   */
  async initialize() {
    if (!this.options.enabled) {
      this.logger.info('SLA Manager is disabled');
      return;
    }
    
    try {
      // メトリクス収集器を初期化
      this.metricsCollector = new MetricsCollector({
        databaseManager: this.databaseManager,
        retentionDays: this.options.metricsRetentionDays
      });
      await this.metricsCollector.initialize();
      
      // SLOモニターを初期化
      this.sloMonitor = new SLOMonitor({
        metricsStore: this.metricsCollector,
        alertManager: this,
        checkInterval: this.options.checkInterval
      });
      
      // レポート生成器を初期化
      this.reportGenerator = new SLOReportGenerator({
        sloMonitor: this.sloMonitor,
        metricsCollector: this.metricsCollector
      });
      await this.reportGenerator.initialize();
      
      // イベントハンドラーを設定
      this.setupEventHandlers();
      
      this.logger.info('SLA Manager initialized');
      this.emit('initialized');
      
    } catch (error) {
      this.logger.error('Failed to initialize SLA Manager', error);
      throw error;
    }
  }

  /**
   * 開始
   */
  async start() {
    if (!this.options.enabled || this.isRunning) {
      return;
    }
    
    try {
      // メトリクス収集を開始
      this.metricsCollector.start();
      
      // SLO監視を開始
      this.sloMonitor.start();
      
      // レポートスケジュールを設定
      this.scheduleReports();
      
      this.isRunning = true;
      this.logger.info('SLA Manager started');
      this.emit('started');
      
    } catch (error) {
      this.logger.error('Failed to start SLA Manager', error);
      throw error;
    }
  }

  /**
   * 停止
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    try {
      // レポートタイマーを停止
      if (this.reportTimer) {
        clearInterval(this.reportTimer);
        this.reportTimer = null;
      }
      
      // SLO監視を停止
      this.sloMonitor.stop();
      
      // メトリクス収集を停止
      await this.metricsCollector.stop();
      
      this.isRunning = false;
      this.logger.info('SLA Manager stopped');
      this.emit('stopped');
      
    } catch (error) {
      this.logger.error('Failed to stop SLA Manager', error);
      throw error;
    }
  }

  /**
   * イベントハンドラーを設定
   */
  setupEventHandlers() {
    // SLO違反
    this.sloMonitor.on('slo-violation', (data) => {
      this.handleSLOViolation(data);
    });
    
    // エラーバジェット警告
    this.sloMonitor.on('error-budget-warning', (data) => {
      this.handleErrorBudgetWarning(data);
    });
    
    // エラーバジェット緊急
    this.sloMonitor.on('error-budget-critical', (data) => {
      this.handleErrorBudgetCritical(data);
    });
    
    // チェック完了
    this.sloMonitor.on('check-completed', (data) => {
      this.logger.debug('SLO check completed', data);
    });
  }

  /**
   * メトリクスを記録
   */
  recordMetric(type, data) {
    if (!this.metricsCollector) {
      return;
    }
    
    this.metricsCollector.recordSLIMetrics(type, data);
  }

  /**
   * カスタムメトリクスを記録
   */
  recordCustomMetric(name, value, type = 'gauge', tags = {}) {
    if (!this.metricsCollector) {
      return;
    }
    
    switch (type) {
      case 'counter':
        this.metricsCollector.incrementCounter(name, value, tags);
        break;
      case 'gauge':
        this.metricsCollector.setGauge(name, value, tags);
        break;
      case 'histogram':
        this.metricsCollector.recordHistogram(name, value, tags);
        break;
      case 'timing':
        this.metricsCollector.recordTiming(name, value, tags);
        break;
    }
  }

  /**
   * SLO違反を処理
   */
  async handleSLOViolation(data) {
    this.logger.error('SLO violation detected', data);
    
    // アラートを送信
    await this.sendAlert({
      type: 'slo_violation',
      severity: 'critical',
      title: 'SLO違反が発生しました',
      message: data.message,
      details: data
    });
    
    this.emit('slo-violation', data);
  }

  /**
   * エラーバジェット警告を処理
   */
  async handleErrorBudgetWarning(data) {
    this.logger.warn('Error budget warning', data);
    
    // アラートを送信
    await this.sendAlert({
      type: 'error_budget',
      severity: 'warning',
      title: 'エラーバジェット警告',
      message: data.message,
      details: data
    });
    
    this.emit('error-budget-warning', data);
  }

  /**
   * エラーバジェット緊急を処理
   */
  async handleErrorBudgetCritical(data) {
    this.logger.error('Error budget critical', data);
    
    // アラートを送信
    await this.sendAlert({
      type: 'error_budget',
      severity: 'critical',
      title: '緊急: エラーバジェット枯渇',
      message: data.message,
      details: data
    });
    
    this.emit('error-budget-critical', data);
  }

  /**
   * アラートを送信
   */
  async sendAlert(alert) {
    const config = AlertDefinitions[alert.type] || {};
    const channels = config.channels || ['log'];
    
    for (const channel of channels) {
      try {
        switch (channel) {
          case 'log':
            this.logger.error(`[ALERT] ${alert.title}`, alert);
            break;
            
          case 'github-issue':
            await this.createGitHubIssue(alert);
            break;
            
          case 'notification':
            if (this.notificationHandler) {
              await this.notificationHandler.sendNotification({
                type: 'sla_alert',
                severity: alert.severity,
                title: alert.title,
                message: alert.message,
                details: alert.details
              });
            }
            break;
        }
      } catch (error) {
        this.logger.error(`Failed to send alert via ${channel}`, error);
      }
    }
  }

  /**
   * GitHub Issueを作成
   */
  async createGitHubIssue(alert) {
    if (!this.options.githubClient) {
      return;
    }
    
    const labels = ['sla-violation', `severity:${alert.severity}`];
    const body = `
## ${alert.title}

${alert.message}

### 詳細
\`\`\`json
${JSON.stringify(alert.details, null, 2)}
\`\`\`

### 対応方法
1. 影響範囲を確認
2. 根本原因を特定
3. 修正を実施
4. 再発防止策を検討

---
*このIssueはSLA監視システムによって自動的に作成されました。*
`;
    
    try {
      await this.options.githubClient.createIssue({
        title: alert.title,
        body,
        labels
      });
    } catch (error) {
      this.logger.error('Failed to create GitHub issue', error);
    }
  }

  /**
   * レポートをスケジュール
   */
  scheduleReports() {
    // 簡易的な実装（本来はcronライブラリを使用）
    // 毎日0時にチェック
    const checkSchedule = () => {
      const now = new Date();
      
      // 週次レポート（日曜日）
      if (now.getDay() === 0 && now.getHours() === 0 && now.getMinutes() === 0) {
        this.generateWeeklyReport();
      }
      
      // 月次レポート（1日）
      if (now.getDate() === 1 && now.getHours() === 0 && now.getMinutes() === 0) {
        this.generateMonthlyReport();
      }
    };
    
    // 1分ごとにチェック
    this.reportTimer = setInterval(checkSchedule, 60000);
  }

  /**
   * 週次レポートを生成
   */
  async generateWeeklyReport() {
    try {
      this.logger.info('Generating weekly SLO report');
      const report = await this.reportGenerator.generateWeeklyReport();
      
      // 通知を送信
      if (this.notificationHandler) {
        await this.notificationHandler.sendNotification({
          type: 'slo_report',
          title: '週次SLOレポートが生成されました',
          message: `全体コンプライアンス率: ${(report.summary.overall_compliance * 100).toFixed(1)}%`,
          report_path: path.join(this.reportGenerator.options.reportDir, 
            `slo-report-weekly-${new Date().toISOString().split('T')[0]}.md`)
        });
      }
      
      this.emit('report-generated', { type: 'weekly', report });
      
    } catch (error) {
      this.logger.error('Failed to generate weekly report', error);
    }
  }

  /**
   * 月次レポートを生成
   */
  async generateMonthlyReport() {
    try {
      const now = new Date();
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      
      this.logger.info('Generating monthly SLO report');
      const report = await this.reportGenerator.generateMonthlyReport(
        lastMonth.getFullYear(),
        lastMonth.getMonth() + 1
      );
      
      // 通知を送信
      if (this.notificationHandler) {
        await this.notificationHandler.sendNotification({
          type: 'slo_report',
          title: '月次SLOレポートが生成されました',
          message: `全体コンプライアンス率: ${(report.summary.overall_compliance * 100).toFixed(1)}%`,
          report_path: path.join(this.reportGenerator.options.reportDir,
            `slo-report-monthly-${new Date().toISOString().split('T')[0]}.md`)
        });
      }
      
      this.emit('report-generated', { type: 'monthly', report });
      
    } catch (error) {
      this.logger.error('Failed to generate monthly report', error);
    }
  }

  /**
   * 手動でレポートを生成
   */
  async generateReport(type = 'weekly', startDate, endDate) {
    if (!this.reportGenerator) {
      throw new Error('Report generator not initialized');
    }
    
    switch (type) {
      case 'weekly':
        return this.reportGenerator.generateWeeklyReport(endDate);
        
      case 'monthly':
        const date = endDate || new Date();
        return this.reportGenerator.generateMonthlyReport(
          date.getFullYear(),
          date.getMonth() + 1
        );
        
      case 'custom':
        return this.reportGenerator.generateReport('custom', startDate, endDate);
        
      default:
        throw new Error(`Unknown report type: ${type}`);
    }
  }

  /**
   * 現在のSLO状態を取得
   */
  getSLOStatus() {
    if (!this.sloMonitor) {
      return null;
    }
    
    return {
      status: this.sloMonitor.getStatus(),
      summary: this.sloMonitor.getSummary(),
      errorBudgets: this.sloMonitor.getErrorBudgets()
    };
  }

  /**
   * メトリクスの状態を取得
   */
  getMetricsStatus() {
    if (!this.metricsCollector) {
      return null;
    }
    
    return this.metricsCollector.getStatus();
  }

  /**
   * ダッシュボード用のデータを取得
   */
  async getDashboardData() {
    const sloStatus = this.getSLOStatus();
    const metricsStatus = this.getMetricsStatus();
    
    return {
      enabled: this.options.enabled,
      running: this.isRunning,
      slo: sloStatus,
      metrics: metricsStatus,
      lastCheck: this.sloMonitor ? new Date(this.sloMonitor.lastCheckTime) : null
    };
  }
}

// シングルトンインスタンス
let instance = null;

/**
 * シングルトンインスタンスを取得
 */
function getInstance(options) {
  if (!instance) {
    instance = new SLAManager(options);
  }
  return instance;
}

module.exports = {
  SLAManager,
  getInstance
};