/**
 * SLO (Service Level Objective) モニター
 * SLI指標を収集し、SLO達成状況を監視
 */

const { EventEmitter } = require('events');
const { SLADefinitions, SLIDefinitions } = require('./sla-definitions');

class SLOMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      checkInterval: options.checkInterval || 60000,  // 1分ごとにチェック
      windowSize: options.windowSize || 30 * 24 * 60 * 60 * 1000,  // 30日間
      ...options
    };
    
    this.metricsStore = options.metricsStore || null;
    this.alertManager = options.alertManager || null;
    
    // SLO状態
    this.sloStatus = {};
    this.errorBudgets = {};
    
    // 定期チェックのタイマー
    this.checkTimer = null;
    
    // 初期化
    this.initializeSLOStatus();
  }

  /**
   * SLO状態を初期化
   */
  initializeSLOStatus() {
    // 可用性SLOの初期化
    for (const [service, definition] of Object.entries(SLADefinitions.availability)) {
      this.sloStatus[`availability:${service}`] = {
        type: 'availability',
        service,
        target: definition.target,
        window: definition.window,
        description: definition.description,
        current: null,
        compliant: null,
        lastChecked: null
      };
      
      this.errorBudgets[`availability:${service}`] = {
        total: 1 - definition.target,
        consumed: 0,
        remaining: 1 - definition.target,
        percentage: 0
      };
    }
    
    // パフォーマンスSLOの初期化
    for (const [metric, definition] of Object.entries(SLADefinitions.performance)) {
      this.sloStatus[`performance:${metric}`] = {
        type: 'performance',
        metric,
        target: definition.target,
        unit: definition.unit,
        percentile: definition.percentile,
        description: definition.description,
        current: null,
        compliant: null,
        lastChecked: null
      };
    }
    
    // 成功率SLOの初期化
    for (const [metric, definition] of Object.entries(SLADefinitions.success_rate)) {
      this.sloStatus[`success_rate:${metric}`] = {
        type: 'success_rate',
        metric,
        target: definition.target,
        window: definition.window,
        description: definition.description,
        current: null,
        compliant: null,
        lastChecked: null
      };
      
      this.errorBudgets[`success_rate:${metric}`] = {
        total: 1 - definition.target,
        consumed: 0,
        remaining: 1 - definition.target,
        percentage: 0
      };
    }
  }

  /**
   * 監視を開始
   */
  start() {
    this.checkTimer = setInterval(() => {
      this.checkAllSLOs();
    }, this.options.checkInterval);
    
    // 初回チェック
    this.checkAllSLOs();
    
    this.emit('started');
  }

  /**
   * 監視を停止
   */
  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    this.emit('stopped');
  }

  /**
   * すべてのSLOをチェック
   */
  async checkAllSLOs() {
    const checkTime = Date.now();
    
    // 可用性SLOのチェック
    for (const [service, definition] of Object.entries(SLADefinitions.availability)) {
      await this.checkAvailabilitySLO(service, definition, checkTime);
    }
    
    // パフォーマンスSLOのチェック
    for (const [metric, definition] of Object.entries(SLADefinitions.performance)) {
      await this.checkPerformanceSLO(metric, definition, checkTime);
    }
    
    // 成功率SLOのチェック
    for (const [metric, definition] of Object.entries(SLADefinitions.success_rate)) {
      await this.checkSuccessRateSLO(metric, definition, checkTime);
    }
    
    this.emit('check-completed', {
      timestamp: checkTime,
      status: this.getSummary()
    });
  }

  /**
   * 可用性SLOをチェック
   */
  async checkAvailabilitySLO(service, definition, checkTime) {
    const sloKey = `availability:${service}`;
    const sliDef = SLIDefinitions.availability[service];
    
    if (!this.metricsStore || !sliDef) {
      return;
    }
    
    try {
      // 時間窓内のメトリクスを取得
      const window = this.parseWindow(definition.window);
      const metrics = await this.metricsStore.getMetrics({
        metric: sliDef.good_events,
        startTime: checkTime - window,
        endTime: checkTime
      });
      
      const totalMetrics = await this.metricsStore.getMetrics({
        metric: sliDef.total_events,
        startTime: checkTime - window,
        endTime: checkTime
      });
      
      // 可用性を計算
      const goodEvents = this.sumMetrics(metrics);
      const totalEvents = this.sumMetrics(totalMetrics);
      const availability = totalEvents > 0 ? goodEvents / totalEvents : 0;
      
      // SLO状態を更新
      const status = this.sloStatus[sloKey];
      status.current = availability;
      status.compliant = availability >= definition.target;
      status.lastChecked = checkTime;
      
      // エラーバジェットを更新
      this.updateErrorBudget(sloKey, availability, definition.target);
      
      // 違反をチェック
      if (!status.compliant) {
        this.handleSLOViolation(sloKey, status);
      }
      
    } catch (error) {
      console.error(`Error checking availability SLO for ${service}:`, error);
    }
  }

  /**
   * パフォーマンスSLOをチェック
   */
  async checkPerformanceSLO(metric, definition, checkTime) {
    const sloKey = `performance:${metric}`;
    const sliDef = SLIDefinitions.performance[metric];
    
    if (!this.metricsStore || !sliDef) {
      return;
    }
    
    try {
      // 最近のメトリクスを取得
      const window = 3600000; // 1時間
      const metrics = await this.metricsStore.getMetrics({
        metric: sliDef.metric,
        startTime: checkTime - window,
        endTime: checkTime
      });
      
      // パーセンタイルを計算
      const percentileValue = this.calculatePercentile(
        metrics.map(m => m.value),
        sliDef.percentile
      );
      
      // SLO状態を更新
      const status = this.sloStatus[sloKey];
      status.current = percentileValue;
      status.compliant = percentileValue <= definition.target;
      status.lastChecked = checkTime;
      
      // 違反をチェック
      if (!status.compliant) {
        this.handleSLOViolation(sloKey, status);
      }
      
    } catch (error) {
      console.error(`Error checking performance SLO for ${metric}:`, error);
    }
  }

  /**
   * 成功率SLOをチェック
   */
  async checkSuccessRateSLO(metric, definition, checkTime) {
    const sloKey = `success_rate:${metric}`;
    const sliDef = SLIDefinitions.success_rate[metric];
    
    if (!this.metricsStore || !sliDef) {
      return;
    }
    
    try {
      // 時間窓内のメトリクスを取得
      const window = this.parseWindow(definition.window);
      const goodMetrics = await this.metricsStore.getMetrics({
        metric: sliDef.good_events,
        startTime: checkTime - window,
        endTime: checkTime
      });
      
      const totalMetrics = await this.metricsStore.getMetrics({
        metric: sliDef.total_events,
        startTime: checkTime - window,
        endTime: checkTime
      });
      
      // 成功率を計算
      const goodEvents = this.sumMetrics(goodMetrics);
      const totalEvents = this.sumMetrics(totalMetrics);
      const successRate = totalEvents > 0 ? goodEvents / totalEvents : 0;
      
      // SLO状態を更新
      const status = this.sloStatus[sloKey];
      status.current = successRate;
      status.compliant = successRate >= definition.target;
      status.lastChecked = checkTime;
      
      // エラーバジェットを更新
      this.updateErrorBudget(sloKey, successRate, definition.target);
      
      // 違反をチェック
      if (!status.compliant) {
        this.handleSLOViolation(sloKey, status);
      }
      
    } catch (error) {
      console.error(`Error checking success rate SLO for ${metric}:`, error);
    }
  }

  /**
   * エラーバジェットを更新
   */
  updateErrorBudget(sloKey, current, target) {
    const budget = this.errorBudgets[sloKey];
    if (!budget) return;
    
    // エラーバジェットの消費を計算
    const errorRate = 1 - current;
    const allowedErrorRate = 1 - target;
    const consumptionRate = errorRate / allowedErrorRate;
    
    budget.consumed = Math.min(consumptionRate, 1);
    budget.remaining = Math.max(1 - consumptionRate, 0);
    budget.percentage = budget.consumed * 100;
    
    // エラーバジェットアラートをチェック
    this.checkErrorBudgetAlert(sloKey, budget);
  }

  /**
   * エラーバジェットアラートをチェック
   */
  checkErrorBudgetAlert(sloKey, budget) {
    const { alert_threshold, critical_threshold } = SLADefinitions.error_budget;
    
    if (budget.consumed >= critical_threshold) {
      this.emit('error-budget-critical', {
        slo: sloKey,
        budget,
        message: `Critical: Error budget for ${sloKey} is at ${budget.percentage.toFixed(1)}%`
      });
    } else if (budget.consumed >= alert_threshold) {
      this.emit('error-budget-warning', {
        slo: sloKey,
        budget,
        message: `Warning: Error budget for ${sloKey} is at ${budget.percentage.toFixed(1)}%`
      });
    }
  }

  /**
   * SLO違反を処理
   */
  handleSLOViolation(sloKey, status) {
    this.emit('slo-violation', {
      slo: sloKey,
      status,
      message: `SLO violation: ${sloKey} is at ${(status.current * 100).toFixed(2)}% (target: ${(status.target * 100).toFixed(1)}%)`
    });
    
    // アラートマネージャーに通知
    if (this.alertManager) {
      this.alertManager.sendAlert({
        type: 'slo_violation',
        severity: 'critical',
        slo: sloKey,
        current: status.current,
        target: status.target,
        description: status.description
      });
    }
  }

  /**
   * 時間窓をパース
   */
  parseWindow(window) {
    const match = window.match(/rolling_(\d+)d/);
    if (match) {
      return parseInt(match[1]) * 24 * 60 * 60 * 1000;
    }
    return this.options.windowSize;
  }

  /**
   * メトリクスを合計
   */
  sumMetrics(metrics) {
    return metrics.reduce((sum, m) => sum + (m.value || 0), 0);
  }

  /**
   * パーセンタイルを計算
   */
  calculatePercentile(values, percentile) {
    if (values.length === 0) return 0;
    
    const sorted = values.sort((a, b) => a - b);
    const index = Math.ceil(sorted.length * percentile) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * 現在のSLO状態を取得
   */
  getStatus() {
    return { ...this.sloStatus };
  }

  /**
   * エラーバジェットの状態を取得
   */
  getErrorBudgets() {
    return { ...this.errorBudgets };
  }

  /**
   * サマリーを取得
   */
  getSummary() {
    const statuses = Object.values(this.sloStatus);
    const compliant = statuses.filter(s => s.compliant).length;
    const total = statuses.length;
    
    return {
      total,
      compliant,
      violations: total - compliant,
      complianceRate: total > 0 ? compliant / total : 0,
      errorBudgets: this.getErrorBudgets()
    };
  }

  /**
   * 詳細レポートを生成
   */
  generateReport() {
    const timestamp = new Date().toISOString();
    const summary = this.getSummary();
    
    return {
      timestamp,
      summary,
      slos: this.sloStatus,
      errorBudgets: this.errorBudgets,
      recommendations: this.generateRecommendations()
    };
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendations() {
    const recommendations = [];
    
    // SLO違反に基づく推奨事項
    for (const [key, status] of Object.entries(this.sloStatus)) {
      if (!status.compliant) {
        recommendations.push({
          slo: key,
          severity: 'high',
          recommendation: this.getRecommendationForViolation(key, status)
        });
      }
    }
    
    // エラーバジェットに基づく推奨事項
    for (const [key, budget] of Object.entries(this.errorBudgets)) {
      if (budget.consumed > 0.5) {
        recommendations.push({
          slo: key,
          severity: budget.consumed > 0.8 ? 'critical' : 'medium',
          recommendation: `エラーバジェットが${budget.percentage.toFixed(1)}%消費されています。信頼性向上の施策を検討してください。`
        });
      }
    }
    
    return recommendations;
  }

  /**
   * 違反に対する推奨事項を取得
   */
  getRecommendationForViolation(sloKey, status) {
    const [type, metric] = sloKey.split(':');
    
    switch (type) {
      case 'availability':
        return `${metric}の可用性を向上させるため、ヘルスチェックの改善やフェイルオーバー機能の強化を検討してください。`;
      
      case 'performance':
        return `${metric}のパフォーマンスを改善するため、処理の最適化やリソースの増強を検討してください。`;
      
      case 'success_rate':
        return `${metric}の成功率を向上させるため、エラーハンドリングの改善やリトライ機能の強化を検討してください。`;
      
      default:
        return 'SLO目標を達成するため、システムの改善を検討してください。';
    }
  }
}

module.exports = SLOMonitor;