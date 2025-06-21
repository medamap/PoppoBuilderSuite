const fs = require('fs').promises;
const path = require('path');

/**
 * レポートジェネレーター - テスト結果のレポート生成
 */
class ReportGenerator {
  constructor(config = {}) {
    this.config = config;
    this.reportsDir = config.reportsDir || 'test-reports';
  }
  
  /**
   * レポートの生成
   */
  async generate(result, task) {
    const report = {
      timestamp: new Date().toISOString(),
      taskId: task.id,
      taskType: task.type,
      success: result.success,
      summary: this.generateSummary(result),
      details: result
    };
    
    // Markdownレポート
    const markdown = this.generateMarkdown(report);
    
    // JSONレポート
    const json = JSON.stringify(report, null, 2);
    
    // HTMLレポート（オプション）
    const html = this.config.generateHtml ? this.generateHtml(report) : null;
    
    // レポートの保存
    await this.saveReports({ markdown, json, html }, task.id);
    
    return {
      markdown,
      json,
      html,
      summary: report.summary
    };
  }
  
  /**
   * サマリーの生成
   */
  generateSummary(result) {
    const summary = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      coverage: null,
      performance: null,
      duration: 0,
      status: 'unknown'
    };
    
    // テスト結果のサマリー
    if (result.tests) {
      summary.totalTests = result.tests.total || 0;
      summary.passedTests = result.tests.passed || 0;
      summary.failedTests = result.tests.failed || 0;
      summary.skippedTests = summary.totalTests - summary.passedTests - summary.failedTests;
      summary.duration = result.tests.duration || 0;
    }
    
    // カバレッジのサマリー
    if (result.coverage && result.coverage.summary) {
      summary.coverage = {
        lines: `${result.coverage.summary.lines.toFixed(2)}%`,
        statements: `${result.coverage.summary.statements.toFixed(2)}%`,
        functions: `${result.coverage.summary.functions.toFixed(2)}%`,
        branches: `${result.coverage.summary.branches.toFixed(2)}%`,
        meetsThreshold: result.coverage.meetsThreshold
      };
    }
    
    // パフォーマンスのサマリー
    if (result.performance) {
      summary.performance = {
        violations: result.performance.violations || [],
        trends: result.performance.trends || null
      };
    }
    
    // 全体のステータス判定
    if (result.success && summary.failedTests === 0) {
      if (summary.coverage && !summary.coverage.meetsThreshold) {
        summary.status = 'coverage_failed';
      } else if (summary.performance && summary.performance.violations.length > 0) {
        summary.status = 'performance_failed';
      } else {
        summary.status = 'passed';
      }
    } else {
      summary.status = 'failed';
    }
    
    return summary;
  }
  
  /**
   * Markdownレポートの生成
   */
  generateMarkdown(report) {
    const { summary, details, taskType, timestamp } = report;
    const status = this.getStatusEmoji(summary.status);
    
    let markdown = `# ${status} テストレポート\n\n`;
    markdown += `**実行日時**: ${new Date(timestamp).toLocaleString('ja-JP')}\n`;
    markdown += `**タスクタイプ**: ${taskType}\n`;
    markdown += `**ステータス**: ${this.getStatusText(summary.status)}\n\n`;
    
    // テスト結果セクション
    markdown += `## 📊 テスト結果\n\n`;
    markdown += `| メトリクス | 値 |\n`;
    markdown += `|------------|----|\n`;
    markdown += `| 総テスト数 | ${summary.totalTests} |\n`;
    markdown += `| 成功 | ${summary.passedTests} |\n`;
    markdown += `| 失敗 | ${summary.failedTests} |\n`;
    markdown += `| スキップ | ${summary.skippedTests} |\n`;
    markdown += `| 実行時間 | ${this.formatDuration(summary.duration)} |\n\n`;
    
    // カバレッジセクション
    if (summary.coverage) {
      markdown += `## 📈 カバレッジ\n\n`;
      markdown += `| タイプ | カバレッジ |\n`;
      markdown += `|--------|------------|\n`;
      markdown += `| 行 | ${summary.coverage.lines} |\n`;
      markdown += `| 文 | ${summary.coverage.statements} |\n`;
      markdown += `| 関数 | ${summary.coverage.functions} |\n`;
      markdown += `| 分岐 | ${summary.coverage.branches} |\n`;
      markdown += `| 閾値達成 | ${summary.coverage.meetsThreshold ? '✅' : '❌'} |\n\n`;
      
      // カバレッジ違反
      if (details.coverage && details.coverage.violations && details.coverage.violations.length > 0) {
        markdown += `### ⚠️ カバレッジ閾値違反\n\n`;
        for (const violation of details.coverage.violations) {
          markdown += `- **${violation.metric}**: ${violation.actual}% (必要: ${violation.required}%)\n`;
        }
        markdown += '\n';
      }
    }
    
    // パフォーマンスセクション
    if (summary.performance && summary.performance.violations.length > 0) {
      markdown += `## ⚡ パフォーマンス\n\n`;
      markdown += `### ⚠️ パフォーマンス閾値違反\n\n`;
      for (const violation of summary.performance.violations) {
        markdown += `- **${violation.metric}**: ${violation.actual} (閾値: ${violation.threshold})\n`;
      }
      markdown += '\n';
    }
    
    // 失敗したテストの詳細
    if (details.tests && details.tests.failures && details.tests.failures.length > 0) {
      markdown += `## ❌ 失敗したテスト\n\n`;
      for (const failure of details.tests.failures.slice(0, 10)) { // 最大10件
        markdown += `### ${failure.test}\n`;
        markdown += `**ファイル**: ${failure.file}\n`;
        markdown += `**エラー**:\n\`\`\`\n${failure.error}\n\`\`\`\n\n`;
      }
      
      if (details.tests.failures.length > 10) {
        markdown += `_他 ${details.tests.failures.length - 10} 件の失敗..._\n\n`;
      }
    }
    
    // 影響を受けたファイル（PR/コミットテストの場合）
    if (details.affectedFiles && details.affectedFiles.length > 0) {
      markdown += `## 📝 影響を受けたファイル\n\n`;
      for (const file of details.affectedFiles) {
        markdown += `- ${file}\n`;
      }
      markdown += '\n';
    }
    
    // 推奨事項
    const recommendations = this.generateRecommendations(report);
    if (recommendations.length > 0) {
      markdown += `## 💡 推奨事項\n\n`;
      for (const rec of recommendations) {
        markdown += `- ${rec}\n`;
      }
      markdown += '\n';
    }
    
    markdown += `---\n\n`;
    markdown += `🤖 Generated by CCTA (クーちゃん) - PoppoBuilder Suite\n`;
    
    return markdown;
  }
  
  /**
   * HTMLレポートの生成
   */
  generateHtml(report) {
    const { summary, details, taskType, timestamp } = report;
    
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>テストレポート - ${new Date(timestamp).toLocaleString('ja-JP')}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1, h2 {
            color: #2c3e50;
        }
        .status-passed { color: #27ae60; }
        .status-failed { color: #e74c3c; }
        .status-coverage_failed { color: #f39c12; }
        .status-performance_failed { color: #e67e22; }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
        }
        .metric-card {
            display: inline-block;
            background: #f8f9fa;
            padding: 20px;
            margin: 10px;
            border-radius: 4px;
            text-align: center;
            min-width: 150px;
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #2c3e50;
        }
        .metric-label {
            color: #7f8c8d;
            margin-top: 5px;
        }
        .failure-box {
            background: #fee;
            border-left: 4px solid #e74c3c;
            padding: 15px;
            margin: 10px 0;
        }
        pre {
            background: #f4f4f4;
            padding: 10px;
            border-radius: 4px;
            overflow-x: auto;
        }
        .progress-bar {
            width: 100%;
            height: 20px;
            background: #ecf0f1;
            border-radius: 10px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            background: #27ae60;
            transition: width 0.3s ease;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1 class="status-${summary.status}">${this.getStatusEmoji(summary.status)} テストレポート</h1>
        
        <p><strong>実行日時:</strong> ${new Date(timestamp).toLocaleString('ja-JP')}</p>
        <p><strong>タスクタイプ:</strong> ${taskType}</p>
        <p><strong>ステータス:</strong> <span class="status-${summary.status}">${this.getStatusText(summary.status)}</span></p>
        
        <h2>📊 テスト結果</h2>
        <div class="metrics">
            <div class="metric-card">
                <div class="metric-value">${summary.totalTests}</div>
                <div class="metric-label">総テスト数</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" style="color: #27ae60;">${summary.passedTests}</div>
                <div class="metric-label">成功</div>
            </div>
            <div class="metric-card">
                <div class="metric-value" style="color: #e74c3c;">${summary.failedTests}</div>
                <div class="metric-label">失敗</div>
            </div>
            <div class="metric-card">
                <div class="metric-value">${this.formatDuration(summary.duration)}</div>
                <div class="metric-label">実行時間</div>
            </div>
        </div>
        
        ${summary.coverage ? this.generateCoverageHtml(summary.coverage, details.coverage) : ''}
        ${this.generateFailuresHtml(details.tests)}
        ${this.generateRecommendationsHtml(report)}
    </div>
</body>
</html>`;
  }
  
  /**
   * カバレッジHTMLの生成
   */
  generateCoverageHtml(coverage, details) {
    let html = '<h2>📈 カバレッジ</h2>';
    
    const metrics = ['lines', 'statements', 'functions', 'branches'];
    html += '<div class="coverage-metrics">';
    
    for (const metric of metrics) {
      const value = parseFloat(coverage[metric]);
      html += `
        <div class="metric-card">
            <div class="metric-value">${coverage[metric]}</div>
            <div class="metric-label">${this.getMetricLabel(metric)}</div>
            <div class="progress-bar">
                <div class="progress-fill" style="width: ${value}%"></div>
            </div>
        </div>
      `;
    }
    
    html += '</div>';
    
    if (details && details.violations && details.violations.length > 0) {
      html += '<h3>⚠️ カバレッジ閾値違反</h3><ul>';
      for (const violation of details.violations) {
        html += `<li><strong>${violation.metric}</strong>: ${violation.actual}% (必要: ${violation.required}%)</li>`;
      }
      html += '</ul>';
    }
    
    return html;
  }
  
  /**
   * 失敗テストHTMLの生成
   */
  generateFailuresHtml(tests) {
    if (!tests || !tests.failures || tests.failures.length === 0) {
      return '';
    }
    
    let html = '<h2>❌ 失敗したテスト</h2>';
    
    for (const failure of tests.failures.slice(0, 10)) {
      html += `
        <div class="failure-box">
            <h3>${failure.test}</h3>
            <p><strong>ファイル:</strong> ${failure.file}</p>
            <pre>${this.escapeHtml(failure.error)}</pre>
        </div>
      `;
    }
    
    if (tests.failures.length > 10) {
      html += `<p><em>他 ${tests.failures.length - 10} 件の失敗...</em></p>`;
    }
    
    return html;
  }
  
  /**
   * 推奨事項HTMLの生成
   */
  generateRecommendationsHtml(report) {
    const recommendations = this.generateRecommendations(report);
    
    if (recommendations.length === 0) {
      return '';
    }
    
    let html = '<h2>💡 推奨事項</h2><ul>';
    for (const rec of recommendations) {
      html += `<li>${rec}</li>`;
    }
    html += '</ul>';
    
    return html;
  }
  
  /**
   * 推奨事項の生成
   */
  generateRecommendations(report) {
    const recommendations = [];
    const { summary, details } = report;
    
    // テスト失敗に関する推奨事項
    if (summary.failedTests > 0) {
      recommendations.push(`${summary.failedTests}個のテストが失敗しています。エラーメッセージを確認して修正してください。`);
      
      if (summary.failedTests > summary.totalTests * 0.2) {
        recommendations.push('失敗率が20%を超えています。大規模な問題がある可能性があります。');
      }
    }
    
    // カバレッジに関する推奨事項
    if (summary.coverage && !summary.coverage.meetsThreshold) {
      recommendations.push('カバレッジが閾値を下回っています。新しいコードにテストを追加してください。');
      
      if (details.coverage && details.coverage.uncoveredLines > 100) {
        recommendations.push(`${details.coverage.uncoveredLines}行がテストされていません。重要な機能から優先的にテストを追加することを推奨します。`);
      }
    }
    
    // パフォーマンスに関する推奨事項
    if (summary.performance && summary.performance.violations.length > 0) {
      for (const violation of summary.performance.violations) {
        if (violation.metric === 'loadTime') {
          recommendations.push('ページロード時間が閾値を超えています。バンドルサイズの最適化を検討してください。');
        } else if (violation.metric === 'memoryUsage') {
          recommendations.push('メモリ使用量が多すぎます。メモリリークや大きなオブジェクトの保持を確認してください。');
        } else if (violation.metric === 'bundleSize') {
          recommendations.push('バンドルサイズが大きすぎます。コード分割や不要な依存関係の削除を検討してください。');
        }
      }
    }
    
    // 実行時間に関する推奨事項
    if (summary.duration > 300000) { // 5分以上
      recommendations.push('テスト実行時間が長すぎます。並列実行やテストの最適化を検討してください。');
    }
    
    // 成功時の推奨事項
    if (summary.status === 'passed' && recommendations.length === 0) {
      recommendations.push('すべてのテストが成功しました！継続的な品質維持を心がけてください。');
    }
    
    return recommendations;
  }
  
  /**
   * ステータス絵文字の取得
   */
  getStatusEmoji(status) {
    const emojis = {
      passed: '✅',
      failed: '❌',
      coverage_failed: '📉',
      performance_failed: '⚡',
      unknown: '❓'
    };
    return emojis[status] || emojis.unknown;
  }
  
  /**
   * ステータステキストの取得
   */
  getStatusText(status) {
    const texts = {
      passed: '成功',
      failed: 'テスト失敗',
      coverage_failed: 'カバレッジ不足',
      performance_failed: 'パフォーマンス問題',
      unknown: '不明'
    };
    return texts[status] || texts.unknown;
  }
  
  /**
   * メトリックラベルの取得
   */
  getMetricLabel(metric) {
    const labels = {
      lines: '行',
      statements: '文',
      functions: '関数',
      branches: '分岐'
    };
    return labels[metric] || metric;
  }
  
  /**
   * 実行時間のフォーマット
   */
  formatDuration(duration) {
    if (duration < 1000) {
      return `${duration}ms`;
    } else if (duration < 60000) {
      return `${(duration / 1000).toFixed(1)}s`;
    } else {
      return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
    }
  }
  
  /**
   * HTMLエスケープ
   */
  escapeHtml(text) {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
  }
  
  /**
   * レポートの保存
   */
  async saveReports(reports, taskId) {
    try {
      await fs.mkdir(this.reportsDir, { recursive: true });
      
      const timestamp = new Date().toISOString().replace(/:/g, '-');
      
      // Markdownレポート
      if (reports.markdown) {
        const mdFile = path.join(this.reportsDir, `report-${taskId}-${timestamp}.md`);
        await fs.writeFile(mdFile, reports.markdown);
      }
      
      // JSONレポート
      if (reports.json) {
        const jsonFile = path.join(this.reportsDir, `report-${taskId}-${timestamp}.json`);
        await fs.writeFile(jsonFile, reports.json);
      }
      
      // HTMLレポート
      if (reports.html) {
        const htmlFile = path.join(this.reportsDir, `report-${taskId}-${timestamp}.html`);
        await fs.writeFile(htmlFile, reports.html);
      }
    } catch (error) {
      console.error('レポート保存エラー:', error);
    }
  }
}

module.exports = ReportGenerator;