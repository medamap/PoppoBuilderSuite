/**
 * エラーレポート生成
 * エラーの集計、トレンド分析、推奨アクションの生成
 */

const fs = require('fs').promises;
const path = require('path');

/**
 * エラーレポーター
 */
class ErrorReporter {
  constructor(errorHandler, recoveryManager, config = {}) {
    this.errorHandler = errorHandler;
    this.recoveryManager = recoveryManager;
    this.config = {
      reportPath: 'reports/errors',
      retentionDays: 30,
      ...config
    };
  }
  
  /**
   * エラーレポートを生成
   */
  async generateReport(options = {}) {
    const {
      format: reportFormat = 'json',
      period = 'daily',
      startDate = null,
      endDate = null,
      includeDetails = true,
      includeRecommendations = true
    } = options;
    
    // 期間を決定
    const { start, end } = this.determinePeriod(period, startDate, endDate);
    
    // データを収集
    const errorStats = this.errorHandler.getStats();
    const recoveryStats = this.recoveryManager.getStats();
    
    // レポートを構築
    const report = {
      metadata: {
        generatedAt: new Date(),
        period: {
          start,
          end,
          type: period
        }
      },
      summary: this.generateSummary(errorStats, recoveryStats, start, end),
      trends: this.analyzeTrends(errorStats, recoveryStats),
      topErrors: this.getTopErrors(errorStats),
      errorCategories: this.categorizeErrors(errorStats),
      recoveryPerformance: this.analyzeRecoveryPerformance(recoveryStats),
      recommendations: includeRecommendations ? this.generateRecommendations(errorStats, recoveryStats) : null,
      details: includeDetails ? {
        recentErrors: errorStats.recent,
        recentRecoveries: recoveryStats.recentRecoveries
      } : null
    };
    
    // フォーマットに応じて出力
    switch (reportFormat) {
      case 'json':
        return await this.saveJsonReport(report);
      case 'markdown':
        return await this.saveMarkdownReport(report);
      case 'html':
        return await this.saveHtmlReport(report);
      default:
        return report;
    }
  }
  
  /**
   * 期間を決定
   */
  determinePeriod(period, startDate, endDate) {
    const now = new Date();
    let start, end;
    
    if (startDate && endDate) {
      start = new Date(startDate);
      end = new Date(endDate);
    } else {
      end = now;
      switch (period) {
        case 'hourly':
          start = new Date(now.getTime() - 60 * 60 * 1000);
          break;
        case 'daily':
          start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
          break;
        case 'weekly':
          start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'monthly':
          start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          start = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      }
    }
    
    return { start, end };
  }
  
  /**
   * サマリーを生成
   */
  generateSummary(errorStats, recoveryStats, start, end) {
    const totalErrors = errorStats.total;
    const errorRate = this.calculateErrorRate(errorStats, start, end);
    const recoveryRate = recoveryStats.total > 0 ?
      (recoveryStats.successful / recoveryStats.total) * 100 : 0;
    
    return {
      totalErrors,
      errorRate: `${errorRate.toFixed(2)}/hour`,
      errorsBySeverity: errorStats.bySeverity,
      errorsByCategory: errorStats.byCategory,
      totalRecoveryAttempts: recoveryStats.total,
      successfulRecoveries: recoveryStats.successful,
      failedRecoveries: recoveryStats.failed,
      recoveryRate: `${recoveryRate.toFixed(1)}%`,
      averageRecoveryTime: `${(recoveryStats.averageDuration / 1000).toFixed(2)}s`
    };
  }
  
  /**
   * エラー率を計算
   */
  calculateErrorRate(errorStats, start, end) {
    const periodHours = (end - start) / (1000 * 60 * 60);
    return errorStats.total / periodHours;
  }
  
  /**
   * トレンドを分析
   */
  analyzeTrends(errorStats, recoveryStats) {
    const trends = {
      errorTrend: 'stable',
      recoveryTrend: 'stable',
      emergingErrors: [],
      improvingErrors: [],
      degradingErrors: []
    };
    
    // エラーコード別のトレンドを分析
    const sortedErrors = Object.entries(errorStats.byCode)
      .sort((a, b) => b[1].count - a[1].count);
    
    for (const [code, stats] of sortedErrors) {
      const recentCount = this.countRecentErrors(errorStats.recent, code);
      const averageCount = stats.count / 24; // 24時間の平均
      
      if (recentCount > averageCount * 1.5) {
        trends.degradingErrors.push({
          code,
          increase: `${((recentCount / averageCount - 1) * 100).toFixed(0)}%`
        });
      } else if (recentCount < averageCount * 0.5) {
        trends.improvingErrors.push({
          code,
          decrease: `${((1 - recentCount / averageCount) * 100).toFixed(0)}%`
        });
      }
      
      // 新しく出現したエラー
      if (stats.count === recentCount && recentCount > 0) {
        trends.emergingErrors.push(code);
      }
    }
    
    // 全体的なトレンドを判定
    if (trends.degradingErrors.length > trends.improvingErrors.length) {
      trends.errorTrend = 'increasing';
    } else if (trends.improvingErrors.length > trends.degradingErrors.length) {
      trends.errorTrend = 'decreasing';
    }
    
    return trends;
  }
  
  /**
   * 最近のエラーをカウント
   */
  countRecentErrors(recentErrors, code) {
    return recentErrors.filter(error => error.code === code).length;
  }
  
  /**
   * トップエラーを取得
   */
  getTopErrors(errorStats) {
    return Object.entries(errorStats.byCode)
      .map(([code, stats]) => ({
        code,
        count: stats.count,
        percentage: (stats.count / errorStats.total * 100).toFixed(1),
        lastOccurrence: stats.lastOccurrence,
        severityBreakdown: stats.severityCounts
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }
  
  /**
   * エラーをカテゴリ分類
   */
  categorizeErrors(errorStats) {
    const categories = {
      network: [],
      system: [],
      api: [],
      process: [],
      data: [],
      business: [],
      unknown: []
    };
    
    for (const [code, stats] of Object.entries(errorStats.byCode)) {
      const category = this.getErrorCategory(code);
      categories[category].push({
        code,
        count: stats.count,
        percentage: (stats.count / errorStats.total * 100).toFixed(1)
      });
    }
    
    // 各カテゴリを件数でソート
    for (const category of Object.keys(categories)) {
      categories[category].sort((a, b) => b.count - a.count);
    }
    
    return categories;
  }
  
  /**
   * エラーコードからカテゴリを判定
   */
  getErrorCategory(code) {
    if (code.startsWith('E_NETWORK_')) return 'network';
    if (code.startsWith('E_SYSTEM_')) return 'system';
    if (code.startsWith('E_API_')) return 'api';
    if (code.startsWith('E_PROCESS_')) return 'process';
    if (code.startsWith('E_DATA_')) return 'data';
    if (code.startsWith('E_BUSINESS_')) return 'business';
    return 'unknown';
  }
  
  /**
   * リカバリーパフォーマンスを分析
   */
  analyzeRecoveryPerformance(recoveryStats) {
    const performance = {
      overall: {
        successRate: recoveryStats.total > 0 ?
          (recoveryStats.successful / recoveryStats.total * 100).toFixed(1) : 0,
        averageTime: (recoveryStats.averageDuration / 1000).toFixed(2)
      },
      byErrorCode: {},
      byAction: {}
    };
    
    // エラーコード別のリカバリー成功率
    for (const [code, stats] of Object.entries(recoveryStats.byErrorCode)) {
      performance.byErrorCode[code] = {
        total: stats.total,
        successRate: stats.total > 0 ?
          (stats.successful / stats.total * 100).toFixed(1) : 0
      };
    }
    
    // アクション別の使用頻度
    const totalActions = Object.values(recoveryStats.byAction).reduce((a, b) => a + b, 0);
    for (const [action, count] of Object.entries(recoveryStats.byAction)) {
      performance.byAction[action] = {
        count,
        percentage: (count / totalActions * 100).toFixed(1)
      };
    }
    
    return performance;
  }
  
  /**
   * 推奨アクションを生成
   */
  generateRecommendations(errorStats, recoveryStats) {
    const recommendations = [];
    
    // 高頻度エラーに対する推奨
    const topErrors = this.getTopErrors(errorStats);
    for (const error of topErrors.slice(0, 3)) {
      if (error.count > 10) {
        recommendations.push({
          priority: 'high',
          type: 'error_frequency',
          title: `High frequency error: ${error.code}`,
          description: `This error occurred ${error.count} times (${error.percentage}% of total errors)`,
          action: this.getRecommendedAction(error.code)
        });
      }
    }
    
    // 低リカバリー成功率に対する推奨
    for (const [code, stats] of Object.entries(recoveryStats.byErrorCode)) {
      const successRate = stats.total > 0 ? (stats.successful / stats.total) * 100 : 0;
      if (successRate < 50 && stats.total > 5) {
        recommendations.push({
          priority: 'medium',
          type: 'recovery_rate',
          title: `Low recovery rate for ${code}`,
          description: `Recovery success rate is only ${successRate.toFixed(1)}% (${stats.successful}/${stats.total})`,
          action: 'Review and update recovery strategy for this error type'
        });
      }
    }
    
    // トレンドに基づく推奨
    const trends = this.analyzeTrends(errorStats, recoveryStats);
    if (trends.degradingErrors.length > 0) {
      recommendations.push({
        priority: 'high',
        type: 'trend',
        title: 'Increasing error trend detected',
        description: `${trends.degradingErrors.length} error types are showing increased frequency`,
        action: 'Investigate root cause of increasing errors',
        details: trends.degradingErrors
      });
    }
    
    // システムリソースエラーに対する推奨
    if (errorStats.byCode['E_SYSTEM_DISK_FULL']?.count > 0) {
      recommendations.push({
        priority: 'critical',
        type: 'system',
        title: 'Disk space issues detected',
        description: 'System reported disk full errors',
        action: 'Immediately free up disk space and implement disk usage monitoring'
      });
    }
    
    // API レート制限に対する推奨
    if (errorStats.byCode['E_API_RATE_LIMIT']?.count > 5) {
      recommendations.push({
        priority: 'medium',
        type: 'api',
        title: 'Frequent API rate limiting',
        description: 'Multiple API rate limit errors detected',
        action: 'Implement better rate limiting strategies or request API limit increase'
      });
    }
    
    return recommendations.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }
  
  /**
   * エラーコードに対する推奨アクション
   */
  getRecommendedAction(errorCode) {
    const recommendations = {
      'E_NETWORK_TIMEOUT': 'Increase timeout values or implement retry with exponential backoff',
      'E_NETWORK_CONNECTION': 'Check network connectivity and implement connection pooling',
      'E_API_RATE_LIMIT': 'Implement request throttling and caching strategies',
      'E_SYSTEM_RESOURCE': 'Monitor system resources and implement resource cleanup',
      'E_PROCESS_TIMEOUT': 'Optimize process performance or increase timeout limits',
      'E_DATA_CORRUPTION': 'Implement data validation and backup strategies',
      'E_CONFIG_INVALID': 'Review and validate configuration files'
    };
    
    return recommendations[errorCode] || 'Investigate error patterns and implement appropriate error handling';
  }
  
  /**
   * JSONレポートを保存
   */
  async saveJsonReport(report) {
    const now = new Date();
    const filename = `error-report-${now.toISOString().slice(0, 19).replace(/[:]/g, '')}.json`;
    const filepath = path.join(this.config.reportPath, filename);
    
    await fs.mkdir(this.config.reportPath, { recursive: true });
    await fs.writeFile(filepath, JSON.stringify(report, null, 2));
    
    return { format: 'json', path: filepath };
  }
  
  /**
   * Markdownレポートを保存
   */
  async saveMarkdownReport(report) {
    const now = new Date();
    const filename = `error-report-${now.toISOString().slice(0, 19).replace(/[:]/g, '')}.md`;
    const filepath = path.join(this.config.reportPath, filename);
    
    const markdown = this.generateMarkdown(report);
    
    await fs.mkdir(this.config.reportPath, { recursive: true });
    await fs.writeFile(filepath, markdown);
    
    return { format: 'markdown', path: filepath };
  }
  
  /**
   * Markdownを生成
   */
  generateMarkdown(report) {
    let md = `# Error Report\n\n`;
    md += `Generated at: ${report.metadata.generatedAt}\n`;
    md += `Period: ${report.metadata.period.start} to ${report.metadata.period.end}\n\n`;
    
    // サマリー
    md += `## Summary\n\n`;
    md += `- Total Errors: ${report.summary.totalErrors}\n`;
    md += `- Error Rate: ${report.summary.errorRate}\n`;
    md += `- Recovery Success Rate: ${report.summary.recoveryRate}\n`;
    md += `- Average Recovery Time: ${report.summary.averageRecoveryTime}\n\n`;
    
    // エラー重要度別
    md += `### Errors by Severity\n\n`;
    for (const [severity, count] of Object.entries(report.summary.errorsBySeverity)) {
      md += `- ${severity}: ${count}\n`;
    }
    md += '\n';
    
    // トップエラー
    md += `## Top Errors\n\n`;
    md += `| Error Code | Count | Percentage | Last Occurrence |\n`;
    md += `|------------|-------|------------|----------------|\n`;
    for (const error of report.topErrors) {
      md += `| ${error.code} | ${error.count} | ${error.percentage}% | ${error.lastOccurrence} |\n`;
    }
    md += '\n';
    
    // トレンド
    md += `## Trends\n\n`;
    md += `- Error Trend: ${report.trends.errorTrend}\n`;
    if (report.trends.degradingErrors.length > 0) {
      md += `- Degrading Errors: ${report.trends.degradingErrors.map(e => e.code).join(', ')}\n`;
    }
    if (report.trends.improvingErrors.length > 0) {
      md += `- Improving Errors: ${report.trends.improvingErrors.map(e => e.code).join(', ')}\n`;
    }
    md += '\n';
    
    // 推奨事項
    if (report.recommendations && report.recommendations.length > 0) {
      md += `## Recommendations\n\n`;
      for (const rec of report.recommendations) {
        md += `### ${rec.priority.toUpperCase()}: ${rec.title}\n\n`;
        md += `${rec.description}\n\n`;
        md += `**Action:** ${rec.action}\n\n`;
      }
    }
    
    return md;
  }
  
  /**
   * HTMLレポートを保存
   */
  async saveHtmlReport(report) {
    const now = new Date();
    const filename = `error-report-${now.toISOString().slice(0, 19).replace(/[:]/g, '')}.html`;
    const filepath = path.join(this.config.reportPath, filename);
    
    const html = this.generateHtml(report);
    
    await fs.mkdir(this.config.reportPath, { recursive: true });
    await fs.writeFile(filepath, html);
    
    return { format: 'html', path: filepath };
  }
  
  /**
   * HTMLを生成
   */
  generateHtml(report) {
    let html = `<!DOCTYPE html>
<html>
<head>
    <title>Error Report - ${report.metadata.generatedAt.toISOString().slice(0, 19).replace('T', ' ')}</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1, h2, h3 { color: #333; }
        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .critical { color: #d32f2f; font-weight: bold; }
        .high { color: #f57c00; font-weight: bold; }
        .medium { color: #fbc02d; }
        .low { color: #689f38; }
        .metric { display: inline-block; margin: 10px 20px 10px 0; }
        .metric-value { font-size: 24px; font-weight: bold; }
        .metric-label { color: #666; }
    </style>
</head>
<body>
    <h1>Error Report</h1>
    <p>Generated at: ${report.metadata.generatedAt.toISOString().slice(0, 19).replace('T', ' ')}</p>
    <p>Period: ${report.metadata.period.start.toISOString().slice(0, 16).replace('T', ' ')} to ${report.metadata.period.end.toISOString().slice(0, 16).replace('T', ' ')}</p>
    
    <h2>Summary</h2>
    <div class="metrics">
        <div class="metric">
            <div class="metric-value">${report.summary.totalErrors}</div>
            <div class="metric-label">Total Errors</div>
        </div>
        <div class="metric">
            <div class="metric-value">${report.summary.errorRate}</div>
            <div class="metric-label">Error Rate</div>
        </div>
        <div class="metric">
            <div class="metric-value">${report.summary.recoveryRate}</div>
            <div class="metric-label">Recovery Rate</div>
        </div>
        <div class="metric">
            <div class="metric-value">${report.summary.averageRecoveryTime}</div>
            <div class="metric-label">Avg Recovery Time</div>
        </div>
    </div>
    
    <h2>Top Errors</h2>
    <table>
        <tr>
            <th>Error Code</th>
            <th>Count</th>
            <th>Percentage</th>
            <th>Last Occurrence</th>
        </tr>
        ${report.topErrors.map(error => `
        <tr>
            <td>${error.code}</td>
            <td>${error.count}</td>
            <td>${error.percentage}%</td>
            <td>${new Date(error.lastOccurrence).toISOString().slice(0, 19).replace('T', ' ')}</td>
        </tr>
        `).join('')}
    </table>
    
    ${report.recommendations && report.recommendations.length > 0 ? `
    <h2>Recommendations</h2>
    ${report.recommendations.map(rec => `
    <div class="recommendation">
        <h3 class="${rec.priority}">${rec.priority.toUpperCase()}: ${rec.title}</h3>
        <p>${rec.description}</p>
        <p><strong>Action:</strong> ${rec.action}</p>
    </div>
    `).join('')}
    ` : ''}
</body>
</html>`;
    
    return html;
  }
  
  /**
   * 古いレポートをクリーンアップ
   */
  async cleanupOldReports() {
    try {
      const files = await fs.readdir(this.config.reportPath);
      const now = Date.now();
      const maxAge = this.config.retentionDays * 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        if (!file.startsWith('error-report-')) continue;
        
        const filepath = path.join(this.config.reportPath, file);
        const stats = await fs.stat(filepath);
        
        if (now - stats.mtimeMs > maxAge) {
          await fs.unlink(filepath);
        }
      }
    } catch (error) {
      // ディレクトリが存在しない場合は無視
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }
}

module.exports = ErrorReporter;