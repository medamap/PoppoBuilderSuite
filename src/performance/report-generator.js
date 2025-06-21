const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

/**
 * パフォーマンスレポート生成クラス
 * ベンチマーク結果から包括的なレポートを生成
 */
class PerformanceReportGenerator {
  constructor(options = {}) {
    this.outputDir = options.outputDir || path.join(__dirname, '..', '..', 'test', 'performance', 'reports');
    this.baselineFile = options.baselineFile || path.join(this.outputDir, 'baseline.json');
    this.templateDir = options.templateDir || path.join(__dirname, 'templates');
  }

  /**
   * レポートの生成
   */
  async generateReport(benchmarkResults, options = {}) {
    const reportType = options.format || 'html';
    const includeBaseline = options.includeBaseline !== false;
    
    console.log(`📊 ${reportType.toUpperCase()}形式のレポートを生成中...`);
    
    // ベースラインとの比較
    let baselineComparison = null;
    if (includeBaseline) {
      baselineComparison = await this.compareWithBaseline(benchmarkResults);
    }
    
    // レポートデータの準備
    const reportData = {
      metadata: {
        generatedAt: new Date().toISOString(),
        version: this.getVersion(),
        environment: this.getEnvironmentInfo()
      },
      results: benchmarkResults,
      baseline: baselineComparison,
      summary: this.generateSummary(benchmarkResults, baselineComparison),
      recommendations: this.generateRecommendations(benchmarkResults)
    };
    
    // 形式に応じてレポート生成
    let reportPath;
    switch (reportType) {
      case 'html':
        reportPath = await this.generateHtmlReport(reportData);
        break;
      case 'markdown':
        reportPath = await this.generateMarkdownReport(reportData);
        break;
      case 'json':
        reportPath = await this.generateJsonReport(reportData);
        break;
      default:
        throw new Error(`サポートされていないレポート形式: ${reportType}`);
    }
    
    console.log(`✅ レポートを生成しました: ${reportPath}`);
    return reportPath;
  }

  /**
   * HTMLレポートの生成
   */
  async generateHtmlReport(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `performance-report-${timestamp}.html`;
    const filepath = path.join(this.outputDir, filename);
    
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PoppoBuilder Suite パフォーマンスレポート</title>
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
        h1, h2, h3 {
            color: #2c3e50;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 10px;
            margin-bottom: 30px;
        }
        .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .metric-card {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .metric-value {
            font-size: 2em;
            font-weight: bold;
            color: #667eea;
        }
        .metric-label {
            color: #666;
            font-size: 0.9em;
        }
        .status-good { color: #27ae60; }
        .status-warning { color: #f39c12; }
        .status-bad { color: #e74c3c; }
        table {
            width: 100%;
            border-collapse: collapse;
            background: white;
            margin: 20px 0;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #667eea;
            color: white;
            font-weight: 600;
        }
        tr:hover {
            background-color: #f5f5f5;
        }
        .chart-container {
            background: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            margin: 20px 0;
        }
        .recommendation {
            background: #fff3cd;
            padding: 15px;
            border-radius: 8px;
            border-left: 4px solid #f39c12;
            margin: 10px 0;
        }
        .baseline-diff {
            font-size: 0.9em;
            margin-left: 10px;
        }
        .baseline-better { color: #27ae60; }
        .baseline-worse { color: #e74c3c; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="header">
        <h1>🚀 PoppoBuilder Suite パフォーマンスレポート</h1>
        <p>生成日時: ${new Date(data.metadata.generatedAt).toLocaleString('ja-JP')}</p>
        <p>バージョン: ${data.metadata.version}</p>
    </div>

    <h2>📊 サマリー</h2>
    <div class="summary">
        ${this.generateHtmlSummaryCards(data.summary)}
    </div>

    <h2>📈 パフォーマンステスト結果</h2>
    
    <h3>スループット</h3>
    ${this.generateHtmlThroughputTable(data.results)}
    
    <h3>レスポンスタイム</h3>
    ${this.generateHtmlResponseTimeTable(data.results)}
    
    <h3>リソース使用量</h3>
    ${this.generateHtmlResourceTable(data.results)}
    
    ${data.baseline ? `
    <h2>📊 ベースラインとの比較</h2>
    ${this.generateHtmlBaselineComparison(data.baseline)}
    ` : ''}
    
    <h2>💡 推奨事項</h2>
    ${data.recommendations.map(rec => `
        <div class="recommendation">
            <strong>${rec.title}</strong>
            <p>${rec.description}</p>
            ${rec.actions ? `<ul>${rec.actions.map(action => `<li>${action}</li>`).join('')}</ul>` : ''}
        </div>
    `).join('')}
    
    <h2>🖥️ 環境情報</h2>
    <div class="metric-card">
        <pre>${JSON.stringify(data.metadata.environment, null, 2)}</pre>
    </div>

    <script>
        // グラフの描画（必要に応じて追加）
    </script>
</body>
</html>`;
    
    await fs.writeFile(filepath, html, 'utf8');
    return filepath;
  }

  /**
   * HTMLサマリーカードの生成
   */
  generateHtmlSummaryCards(summary) {
    const cards = [];
    
    if (summary.throughput) {
      cards.push(`
        <div class="metric-card">
            <div class="metric-value">${summary.throughput.issuesPerHour.toFixed(0)}</div>
            <div class="metric-label">Issues/時間</div>
            <div class="status-${summary.throughput.status}">${summary.throughput.statusText}</div>
        </div>
      `);
    }
    
    if (summary.responseTime) {
      cards.push(`
        <div class="metric-card">
            <div class="metric-value">${summary.responseTime.avgMs.toFixed(0)}ms</div>
            <div class="metric-label">平均レスポンスタイム</div>
            <div class="status-${summary.responseTime.status}">${summary.responseTime.statusText}</div>
        </div>
      `);
    }
    
    if (summary.cpu) {
      cards.push(`
        <div class="metric-card">
            <div class="metric-value">${summary.cpu.avg.toFixed(1)}%</div>
            <div class="metric-label">平均CPU使用率</div>
            <div class="status-${summary.cpu.status}">${summary.cpu.statusText}</div>
        </div>
      `);
    }
    
    if (summary.memory) {
      cards.push(`
        <div class="metric-card">
            <div class="metric-value">${(summary.memory.avg / 1024 / 1024).toFixed(0)}MB</div>
            <div class="metric-label">平均メモリ使用量</div>
            <div class="status-${summary.memory.status}">${summary.memory.statusText}</div>
        </div>
      `);
    }
    
    return cards.join('');
  }

  /**
   * スループットテーブルの生成
   */
  generateHtmlThroughputTable(results) {
    // 実装省略（結果データ構造に応じて実装）
    return '<table><tr><th>テスト</th><th>結果</th></tr></table>';
  }

  /**
   * レスポンスタイムテーブルの生成
   */
  generateHtmlResponseTimeTable(results) {
    // 実装省略（結果データ構造に応じて実装）
    return '<table><tr><th>エンドポイント</th><th>P50</th><th>P95</th><th>P99</th></tr></table>';
  }

  /**
   * リソース使用量テーブルの生成
   */
  generateHtmlResourceTable(results) {
    // 実装省略（結果データ構造に応じて実装）
    return '<table><tr><th>リソース</th><th>最小</th><th>最大</th><th>平均</th></tr></table>';
  }

  /**
   * ベースライン比較の生成
   */
  generateHtmlBaselineComparison(comparison) {
    // 実装省略
    return '<div>ベースライン比較データ</div>';
  }

  /**
   * Markdownレポートの生成
   */
  async generateMarkdownReport(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `performance-report-${timestamp}.md`;
    const filepath = path.join(this.outputDir, filename);
    
    const markdown = `# PoppoBuilder Suite パフォーマンスレポート

生成日時: ${new Date(data.metadata.generatedAt).toLocaleString('ja-JP')}  
バージョン: ${data.metadata.version}

## 📊 エグゼクティブサマリー

${this.generateMarkdownSummary(data.summary)}

## 📈 詳細結果

### スループットテスト

${this.generateMarkdownThroughputSection(data.results)}

### レスポンスタイムテスト

${this.generateMarkdownResponseTimeSection(data.results)}

### リソース使用量テスト

${this.generateMarkdownResourceSection(data.results)}

${data.baseline ? `## 📊 ベースラインとの比較

${this.generateMarkdownBaselineSection(data.baseline)}` : ''}

## 💡 推奨事項

${data.recommendations.map(rec => `### ${rec.title}

${rec.description}

${rec.actions ? rec.actions.map(action => `- ${action}`).join('\n') : ''}
`).join('\n')}

## 🖥️ 環境情報

\`\`\`json
${JSON.stringify(data.metadata.environment, null, 2)}
\`\`\`
`;
    
    await fs.writeFile(filepath, markdown, 'utf8');
    return filepath;
  }

  /**
   * Markdownサマリーの生成
   */
  generateMarkdownSummary(summary) {
    const items = [];
    
    if (summary.throughput) {
      items.push(`- **スループット**: ${summary.throughput.issuesPerHour.toFixed(0)} Issues/時間 (${summary.throughput.statusText})`);
    }
    
    if (summary.responseTime) {
      items.push(`- **平均レスポンスタイム**: ${summary.responseTime.avgMs.toFixed(0)}ms (${summary.responseTime.statusText})`);
    }
    
    if (summary.cpu) {
      items.push(`- **平均CPU使用率**: ${summary.cpu.avg.toFixed(1)}% (${summary.cpu.statusText})`);
    }
    
    if (summary.memory) {
      items.push(`- **平均メモリ使用量**: ${(summary.memory.avg / 1024 / 1024).toFixed(0)}MB (${summary.memory.statusText})`);
    }
    
    return items.join('\n');
  }

  /**
   * Markdownスループットセクションの生成
   */
  generateMarkdownThroughputSection(results) {
    // 実装省略
    return '| テスト | 結果 |\n|--------|------|\n| 単一Issue処理 | XXX ms |';
  }

  /**
   * Markdownレスポンスタイムセクションの生成
   */
  generateMarkdownResponseTimeSection(results) {
    // 実装省略
    return '| エンドポイント | P50 | P95 | P99 |\n|----------------|-----|-----|-----|';
  }

  /**
   * Markdownリソースセクションの生成
   */
  generateMarkdownResourceSection(results) {
    // 実装省略
    return '| リソース | 最小 | 最大 | 平均 |\n|----------|------|------|------|';
  }

  /**
   * Markdownベースラインセクションの生成
   */
  generateMarkdownBaselineSection(baseline) {
    // 実装省略
    return 'ベースラインとの比較データ';
  }

  /**
   * JSONレポートの生成
   */
  async generateJsonReport(data) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `performance-report-${timestamp}.json`;
    const filepath = path.join(this.outputDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(data, null, 2), 'utf8');
    return filepath;
  }

  /**
   * ベースラインとの比較
   */
  async compareWithBaseline(results) {
    try {
      const baselineData = await fs.readFile(this.baselineFile, 'utf8');
      const baseline = JSON.parse(baselineData);
      
      // 比較ロジック（実装省略）
      return {
        hasBaseline: true,
        baseline: baseline,
        differences: this.calculateDifferences(results, baseline)
      };
    } catch (error) {
      console.log('ℹ️ ベースラインファイルが見つかりません');
      return {
        hasBaseline: false,
        message: 'ベースラインとの比較はスキップされました'
      };
    }
  }

  /**
   * 差分の計算
   */
  calculateDifferences(current, baseline) {
    // 実装省略
    return {};
  }

  /**
   * サマリーの生成
   */
  generateSummary(results, baselineComparison) {
    const summary = {};
    
    // スループットサマリー
    if (results.throughput) {
      const throughput = results.throughput.issuesPerHour || 0;
      summary.throughput = {
        issuesPerHour: throughput,
        status: throughput >= 1000 ? 'good' : throughput >= 500 ? 'warning' : 'bad',
        statusText: throughput >= 1000 ? '目標達成' : throughput >= 500 ? '改善必要' : '要対応'
      };
    }
    
    // 他のメトリクスも同様に処理
    
    return summary;
  }

  /**
   * 推奨事項の生成
   */
  generateRecommendations(results) {
    const recommendations = [];
    
    // スループットに基づく推奨
    if (results.throughput && results.throughput.issuesPerHour < 1000) {
      recommendations.push({
        title: 'スループットの改善',
        description: '現在のスループットが目標値を下回っています。',
        actions: [
          '並行処理数の増加を検討',
          'API呼び出しの最適化',
          'キャッシュの活用'
        ]
      });
    }
    
    // 他の推奨事項も同様に追加
    
    return recommendations;
  }

  /**
   * バージョン情報の取得
   */
  getVersion() {
    try {
      const packageJson = require(path.join(__dirname, '..', '..', 'package.json'));
      return packageJson.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * 環境情報の取得
   */
  getEnvironmentInfo() {
    const os = require('os');
    
    return {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpus: os.cpus().length,
      totalMemory: os.totalmem(),
      hostname: os.hostname()
    };
  }

  /**
   * ベースラインの更新
   */
  async updateBaseline(results) {
    console.log('📝 ベースラインを更新中...');
    
    const baselineData = {
      timestamp: new Date().toISOString(),
      version: this.getVersion(),
      results: results
    };
    
    await fs.writeFile(this.baselineFile, JSON.stringify(baselineData, null, 2), 'utf8');
    console.log('✅ ベースラインを更新しました');
  }
}

module.exports = PerformanceReportGenerator;