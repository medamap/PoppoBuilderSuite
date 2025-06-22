/**
 * SLOレポート生成器
 * 週次・月次のSLOレポートを生成
 */

const fs = require('fs').promises;
const path = require('path');

class SLOReportGenerator {
  constructor(options = {}) {
    this.options = {
      reportDir: options.reportDir || path.join(process.cwd(), 'reports', 'slo'),
      ...options
    };
    
    this.sloMonitor = options.sloMonitor || null;
    this.metricsCollector = options.metricsCollector || null;
  }

  /**
   * 初期化
   */
  async initialize() {
    await fs.mkdir(this.options.reportDir, { recursive: true });
  }

  /**
   * 週次レポートを生成
   */
  async generateWeeklyReport(endDate = new Date()) {
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 7);
    
    return this.generateReport('weekly', startDate, endDate);
  }

  /**
   * 月次レポートを生成
   */
  async generateMonthlyReport(year, month) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0); // 月末
    
    return this.generateReport('monthly', startDate, endDate);
  }

  /**
   * レポートを生成
   */
  async generateReport(type, startDate, endDate) {
    const report = {
      type,
      period: {
        start: startDate.toISOString(),
        end: endDate.toISOString()
      },
      generated_at: new Date().toISOString(),
      summary: await this.generateSummary(startDate, endDate),
      slo_performance: await this.generateSLOPerformance(startDate, endDate),
      incidents: await this.generateIncidentAnalysis(startDate, endDate),
      trends: await this.generateTrends(startDate, endDate),
      recommendations: await this.generateRecommendations(startDate, endDate)
    };
    
    // レポートを保存
    await this.saveReport(report);
    
    return report;
  }

  /**
   * サマリーを生成
   */
  async generateSummary(startDate, endDate) {
    if (!this.sloMonitor) {
      return null;
    }
    
    const currentStatus = this.sloMonitor.getSummary();
    const errorBudgets = this.sloMonitor.getErrorBudgets();
    
    // 期間中の統計を計算
    const sloStats = await this.calculateSLOStats(startDate, endDate);
    
    return {
      overall_compliance: currentStatus.complianceRate,
      total_slos: currentStatus.total,
      compliant_slos: currentStatus.compliant,
      violations: currentStatus.violations,
      period_statistics: sloStats,
      error_budget_status: this.summarizeErrorBudgets(errorBudgets)
    };
  }

  /**
   * SLOパフォーマンスを生成
   */
  async generateSLOPerformance(startDate, endDate) {
    const sloStatus = this.sloMonitor ? this.sloMonitor.getStatus() : {};
    const performance = {};
    
    for (const [sloKey, status] of Object.entries(sloStatus)) {
      const metrics = await this.getSLOMetrics(sloKey, startDate, endDate);
      
      performance[sloKey] = {
        current_value: status.current,
        target_value: status.target,
        compliant: status.compliant,
        achievement_rate: this.calculateAchievementRate(metrics, status.target),
        time_series: this.aggregateTimeSeries(metrics),
        violations: this.countViolations(metrics, status.target)
      };
    }
    
    return performance;
  }

  /**
   * インシデント分析を生成
   */
  async generateIncidentAnalysis(startDate, endDate) {
    const incidents = await this.getIncidents(startDate, endDate);
    
    return {
      total_incidents: incidents.length,
      by_severity: this.groupBySeverity(incidents),
      by_slo: this.groupBySLO(incidents),
      mean_time_to_detect: this.calculateMTTD(incidents),
      mean_time_to_resolve: this.calculateMTTR(incidents),
      top_causes: this.analyzeTopCauses(incidents)
    };
  }

  /**
   * トレンドを生成
   */
  async generateTrends(startDate, endDate) {
    const trends = {};
    
    // 各SLOのトレンドを分析
    const sloStatus = this.sloMonitor ? this.sloMonitor.getStatus() : {};
    
    for (const [sloKey, status] of Object.entries(sloStatus)) {
      const historicalData = await this.getHistoricalData(sloKey, startDate, endDate);
      
      trends[sloKey] = {
        direction: this.calculateTrend(historicalData),
        improvement_rate: this.calculateImprovementRate(historicalData),
        forecast: this.forecastNextPeriod(historicalData)
      };
    }
    
    return trends;
  }

  /**
   * 推奨事項を生成
   */
  async generateRecommendations(startDate, endDate) {
    const recommendations = [];
    const sloPerformance = await this.generateSLOPerformance(startDate, endDate);
    const incidents = await this.getIncidents(startDate, endDate);
    
    // パフォーマンスに基づく推奨事項
    for (const [sloKey, performance] of Object.entries(sloPerformance)) {
      if (!performance.compliant) {
        recommendations.push({
          slo: sloKey,
          priority: 'high',
          type: 'performance',
          recommendation: this.generatePerformanceRecommendation(sloKey, performance)
        });
      }
    }
    
    // インシデントに基づく推奨事項
    const frequentCauses = this.analyzeTopCauses(incidents).slice(0, 3);
    for (const cause of frequentCauses) {
      recommendations.push({
        priority: 'medium',
        type: 'incident_prevention',
        recommendation: `頻発する問題「${cause.cause}」に対する根本的な対策を実施してください。`
      });
    }
    
    // エラーバジェットに基づく推奨事項
    const errorBudgets = this.sloMonitor ? this.sloMonitor.getErrorBudgets() : {};
    for (const [sloKey, budget] of Object.entries(errorBudgets)) {
      if (budget.consumed > 0.7) {
        recommendations.push({
          slo: sloKey,
          priority: 'critical',
          type: 'error_budget',
          recommendation: `${sloKey}のエラーバジェットが残り${(budget.remaining * 100).toFixed(1)}%です。新機能のリリースを延期し、信頼性向上に注力してください。`
        });
      }
    }
    
    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /**
   * SLO統計を計算
   */
  async calculateSLOStats(startDate, endDate) {
    if (!this.metricsCollector) {
      return {};
    }
    
    // 期間中の各SLOの達成率を計算
    const stats = {};
    const sloStatus = this.sloMonitor ? this.sloMonitor.getStatus() : {};
    
    for (const [sloKey, status] of Object.entries(sloStatus)) {
      const metrics = await this.getSLOMetrics(sloKey, startDate, endDate);
      stats[sloKey] = {
        achievement_rate: this.calculateAchievementRate(metrics, status.target),
        availability: this.calculateAvailability(metrics),
        violation_count: this.countViolations(metrics, status.target)
      };
    }
    
    return stats;
  }

  /**
   * SLOメトリクスを取得
   */
  async getSLOMetrics(sloKey, startDate, endDate) {
    if (!this.metricsCollector) {
      return [];
    }
    
    // SLOキーからメトリクス名を決定
    const [type, metric] = sloKey.split(':');
    let metricName;
    
    switch (type) {
      case 'availability':
        metricName = `${metric}_availability`;
        break;
      case 'performance':
        metricName = metric.replace('-', '_');
        break;
      case 'success_rate':
        metricName = `${metric}_success_rate`;
        break;
      default:
        metricName = sloKey;
    }
    
    return this.metricsCollector.getMetrics({
      metric: metricName,
      startTime: startDate.getTime(),
      endTime: endDate.getTime()
    });
  }

  /**
   * インシデントを取得
   */
  async getIncidents(startDate, endDate) {
    // 実装は別途インシデント管理システムと連携
    // ここではモックデータを返す
    return [];
  }

  /**
   * 履歴データを取得
   */
  async getHistoricalData(sloKey, startDate, endDate) {
    const metrics = await this.getSLOMetrics(sloKey, startDate, endDate);
    
    // 日次集計
    const daily = {};
    for (const metric of metrics) {
      const date = new Date(metric.timestamp).toISOString().split('T')[0];
      if (!daily[date]) {
        daily[date] = [];
      }
      daily[date].push(metric.value);
    }
    
    // 日次平均を計算
    return Object.entries(daily).map(([date, values]) => ({
      date,
      value: values.reduce((a, b) => a + b, 0) / values.length
    }));
  }

  /**
   * 達成率を計算
   */
  calculateAchievementRate(metrics, target) {
    if (metrics.length === 0) return 0;
    
    const achieved = metrics.filter(m => m.value >= target).length;
    return achieved / metrics.length;
  }

  /**
   * 可用性を計算
   */
  calculateAvailability(metrics) {
    if (metrics.length === 0) return 0;
    
    const totalUptime = metrics.filter(m => m.value > 0).length;
    return totalUptime / metrics.length;
  }

  /**
   * 違反数をカウント
   */
  countViolations(metrics, target) {
    return metrics.filter(m => m.value < target).length;
  }

  /**
   * 時系列を集計
   */
  aggregateTimeSeries(metrics) {
    // 時間ごとに集計
    const hourly = {};
    
    for (const metric of metrics) {
      const hour = new Date(metric.timestamp);
      hour.setMinutes(0, 0, 0);
      const key = hour.toISOString();
      
      if (!hourly[key]) {
        hourly[key] = { sum: 0, count: 0 };
      }
      
      hourly[key].sum += metric.value;
      hourly[key].count++;
    }
    
    return Object.entries(hourly).map(([timestamp, data]) => ({
      timestamp,
      value: data.sum / data.count
    }));
  }

  /**
   * エラーバジェットをサマライズ
   */
  summarizeErrorBudgets(errorBudgets) {
    const summary = {
      healthy: 0,
      warning: 0,
      critical: 0
    };
    
    for (const budget of Object.values(errorBudgets)) {
      if (budget.consumed < 0.5) {
        summary.healthy++;
      } else if (budget.consumed < 0.8) {
        summary.warning++;
      } else {
        summary.critical++;
      }
    }
    
    return summary;
  }

  /**
   * 重要度でグループ化
   */
  groupBySeverity(incidents) {
    const groups = { critical: 0, high: 0, medium: 0, low: 0 };
    
    for (const incident of incidents) {
      groups[incident.severity || 'medium']++;
    }
    
    return groups;
  }

  /**
   * SLOでグループ化
   */
  groupBySLO(incidents) {
    const groups = {};
    
    for (const incident of incidents) {
      const slo = incident.slo || 'unknown';
      groups[slo] = (groups[slo] || 0) + 1;
    }
    
    return groups;
  }

  /**
   * MTTDを計算
   */
  calculateMTTD(incidents) {
    if (incidents.length === 0) return 0;
    
    const totalTime = incidents.reduce((sum, incident) => {
      if (incident.detected_at && incident.started_at) {
        return sum + (new Date(incident.detected_at) - new Date(incident.started_at));
      }
      return sum;
    }, 0);
    
    return totalTime / incidents.length / 1000 / 60; // 分単位
  }

  /**
   * MTTRを計算
   */
  calculateMTTR(incidents) {
    if (incidents.length === 0) return 0;
    
    const totalTime = incidents.reduce((sum, incident) => {
      if (incident.resolved_at && incident.started_at) {
        return sum + (new Date(incident.resolved_at) - new Date(incident.started_at));
      }
      return sum;
    }, 0);
    
    return totalTime / incidents.length / 1000 / 60; // 分単位
  }

  /**
   * トップ原因を分析
   */
  analyzeTopCauses(incidents) {
    const causes = {};
    
    for (const incident of incidents) {
      const cause = incident.root_cause || 'unknown';
      causes[cause] = (causes[cause] || 0) + 1;
    }
    
    return Object.entries(causes)
      .map(([cause, count]) => ({ cause, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * トレンドを計算
   */
  calculateTrend(historicalData) {
    if (historicalData.length < 2) return 'stable';
    
    // 簡単な線形回帰
    const n = historicalData.length;
    const x = historicalData.map((_, i) => i);
    const y = historicalData.map(d => d.value);
    
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    
    if (slope > 0.01) return 'improving';
    if (slope < -0.01) return 'degrading';
    return 'stable';
  }

  /**
   * 改善率を計算
   */
  calculateImprovementRate(historicalData) {
    if (historicalData.length < 2) return 0;
    
    const first = historicalData[0].value;
    const last = historicalData[historicalData.length - 1].value;
    
    return ((last - first) / first) * 100;
  }

  /**
   * 次期を予測
   */
  forecastNextPeriod(historicalData) {
    if (historicalData.length < 3) {
      return { value: null, confidence: 'low' };
    }
    
    // 単純移動平均
    const recentValues = historicalData.slice(-7).map(d => d.value);
    const forecast = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
    
    // 信頼度を計算（標準偏差に基づく）
    const variance = recentValues.reduce((sum, val) => {
      return sum + Math.pow(val - forecast, 2);
    }, 0) / recentValues.length;
    
    const stdDev = Math.sqrt(variance);
    const confidence = stdDev < 0.1 ? 'high' : stdDev < 0.2 ? 'medium' : 'low';
    
    return { value: forecast, confidence };
  }

  /**
   * パフォーマンス推奨事項を生成
   */
  generatePerformanceRecommendation(sloKey, performance) {
    const achievementRate = performance.achievement_rate * 100;
    const gap = (performance.target_value - performance.current_value) / performance.target_value * 100;
    
    const [type, metric] = sloKey.split(':');
    
    let recommendation = `${sloKey}の達成率が${achievementRate.toFixed(1)}%で目標を下回っています。`;
    
    switch (type) {
      case 'availability':
        recommendation += `システムの安定性を向上させるため、以下を検討してください：\n`;
        recommendation += `- ヘルスチェックの頻度と精度の向上\n`;
        recommendation += `- 自動フェイルオーバー機能の実装\n`;
        recommendation += `- 冗長性の確保`;
        break;
        
      case 'performance':
        recommendation += `パフォーマンスを${gap.toFixed(1)}%改善する必要があります。以下を検討してください：\n`;
        recommendation += `- ボトルネックの特定と最適化\n`;
        recommendation += `- キャッシュ戦略の見直し\n`;
        recommendation += `- リソースの増強`;
        break;
        
      case 'success_rate':
        recommendation += `エラー率を削減するため、以下を検討してください：\n`;
        recommendation += `- エラーパターンの分析\n`;
        recommendation += `- リトライロジックの改善\n`;
        recommendation += `- エラーハンドリングの強化`;
        break;
    }
    
    return recommendation;
  }

  /**
   * レポートを保存
   */
  async saveReport(report) {
    const filename = `slo-report-${report.type}-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(this.options.reportDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    
    // Markdownレポートも生成
    const markdownReport = this.generateMarkdownReport(report);
    const mdFilepath = filepath.replace('.json', '.md');
    await fs.writeFile(mdFilepath, markdownReport);
  }

  /**
   * Markdownレポートを生成
   */
  generateMarkdownReport(report) {
    let md = `# SLOレポート (${report.type})\n\n`;
    md += `期間: ${report.period.start} - ${report.period.end}\n`;
    md += `生成日時: ${report.generated_at}\n\n`;
    
    // サマリー
    md += `## サマリー\n\n`;
    if (report.summary) {
      md += `- 全体コンプライアンス率: ${(report.summary.overall_compliance * 100).toFixed(1)}%\n`;
      md += `- 総SLO数: ${report.summary.total_slos}\n`;
      md += `- 達成SLO数: ${report.summary.compliant_slos}\n`;
      md += `- 違反数: ${report.summary.violations}\n\n`;
    }
    
    // SLOパフォーマンス
    md += `## SLOパフォーマンス\n\n`;
    for (const [slo, perf] of Object.entries(report.slo_performance || {})) {
      md += `### ${slo}\n`;
      md += `- 現在値: ${perf.current_value}\n`;
      md += `- 目標値: ${perf.target_value}\n`;
      md += `- 達成状況: ${perf.compliant ? '達成' : '未達成'}\n`;
      md += `- 達成率: ${(perf.achievement_rate * 100).toFixed(1)}%\n`;
      md += `- 違反回数: ${perf.violations}\n\n`;
    }
    
    // 推奨事項
    md += `## 推奨事項\n\n`;
    for (const rec of report.recommendations || []) {
      md += `### [${rec.priority.toUpperCase()}] ${rec.type}\n`;
      md += `${rec.recommendation}\n\n`;
    }
    
    return md;
  }
}

module.exports = SLOReportGenerator;