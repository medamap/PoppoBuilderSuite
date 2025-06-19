const fs = require('fs').promises;
const path = require('path');
const Logger = require('../../src/logger');

/**
 * レポート生成モジュール
 */
class ReportGenerator {
  constructor(config = {}) {
    this.config = config;
    this.logger = new Logger('CCQA-ReportGenerator');
    
    // レポート形式の設定
    this.formats = config.formats || ['markdown', 'json'];
    this.includeDetails = config.includeDetails !== false;
    this.includeRecommendations = config.includeRecommendations !== false;
  }
  
  /**
   * レポートの生成
   */
  async generateReport(results) {
    this.logger.info('品質保証レポートを生成中...');
    
    const report = {
      markdown: await this.generateMarkdownReport(results),
      json: await this.generateJSONReport(results),
      summary: this.generateSummary(results)
    };
    
    return report;
  }
  
  /**
   * Markdownレポートの生成
   */
  async generateMarkdownReport(results) {
    const sections = [];
    
    // ヘッダー
    sections.push(this.generateHeader(results));
    
    // サマリー
    sections.push(this.generateMarkdownSummary(results));
    
    // テスト結果
    if (results.results.tests) {
      sections.push(this.generateTestSection(results.results.tests));
    }
    
    // コード品質
    if (results.results.quality) {
      sections.push(this.generateQualitySection(results.results.quality));
    }
    
    // セキュリティ
    if (results.results.security) {
      sections.push(this.generateSecuritySection(results.results.security));
    }
    
    // パフォーマンス
    if (results.results.performance) {
      sections.push(this.generatePerformanceSection(results.results.performance));
    }
    
    // 推奨事項
    if (this.includeRecommendations && results.recommendations) {
      sections.push(this.generateRecommendationsSection(results.recommendations));
    }
    
    return sections.join('\n\n');
  }
  
  /**
   * レポートヘッダーの生成
   */
  generateHeader(results) {
    const timestamp = new Date().toLocaleString('ja-JP');
    const qualityEmoji = this.getQualityEmoji(results.qualityScore);
    
    return `# 🔍 Code Quality Assurance Report

**品質スコア**: ${qualityEmoji} ${results.qualityScore}/100

- **リポジトリ**: ${results.repository || 'N/A'}
- **Issue**: #${results.issue || 'N/A'}
- **PR**: #${results.pullRequest || 'N/A'}
- **実行日時**: ${timestamp}`;
  }
  
  /**
   * 品質スコアに応じた絵文字
   */
  getQualityEmoji(score) {
    if (score >= 90) return '🌟';
    if (score >= 80) return '✅';
    if (score >= 70) return '⚠️';
    if (score >= 60) return '⚡';
    return '❌';
  }
  
  /**
   * Markdownサマリーの生成
   */
  generateMarkdownSummary(results) {
    const summary = [`## 📊 サマリー`];
    
    // テストサマリー
    if (results.results.tests) {
      const tests = results.results.tests;
      const testEmoji = tests.failed === 0 ? '✅' : '❌';
      summary.push(`- **テスト**: ${testEmoji} ${tests.passed}/${tests.total} 成功 (カバレッジ: ${tests.coverage}%)`);
    }
    
    // 品質サマリー
    if (results.results.quality) {
      const issues = results.results.quality.issues || [];
      const qualityEmoji = issues.length === 0 ? '✅' : '⚠️';
      summary.push(`- **コード品質**: ${qualityEmoji} ${issues.length} 件の問題`);
    }
    
    // セキュリティサマリー
    if (results.results.security) {
      const vulns = results.results.security.vulnerabilities || [];
      const creds = results.results.security.credentials || [];
      const totalIssues = vulns.length + creds.length;
      const securityEmoji = totalIssues === 0 ? '✅' : '🚨';
      summary.push(`- **セキュリティ**: ${securityEmoji} ${totalIssues} 件の問題`);
    }
    
    // パフォーマンスサマリー
    if (results.results.performance) {
      const regressions = results.results.performance.regressions || [];
      const perfEmoji = regressions.length === 0 ? '✅' : '⚡';
      summary.push(`- **パフォーマンス**: ${perfEmoji} ${regressions.length} 件の回帰`);
    }
    
    return summary.join('\n');
  }
  
  /**
   * テストセクションの生成
   */
  generateTestSection(testResults) {
    const sections = ['## 🧪 テスト結果'];
    
    // 基本情報
    sections.push(`
### 概要
- **総テスト数**: ${testResults.total}
- **成功**: ${testResults.passed} ✅
- **失敗**: ${testResults.failed} ❌
- **スキップ**: ${testResults.skipped || 0} ⏭️
- **カバレッジ**: ${testResults.coverage}%
- **実行時間**: ${testResults.duration}ms`);
    
    // カバレッジ詳細
    if (testResults.coverageDetails) {
      sections.push(`
### カバレッジ詳細
| 項目 | カバレッジ |
|------|-----------|
| 行 | ${testResults.coverageDetails.lines?.pct || 0}% |
| 文 | ${testResults.coverageDetails.statements?.pct || 0}% |
| 関数 | ${testResults.coverageDetails.functions?.pct || 0}% |
| 分岐 | ${testResults.coverageDetails.branches?.pct || 0}% |`);
    }
    
    // 失敗したテスト
    if (testResults.failedTests && testResults.failedTests.length > 0) {
      sections.push(`
### ❌ 失敗したテスト
${testResults.failedTests.map(test => `- ${test}`).join('\n')}`);
    }
    
    return sections.join('\n');
  }
  
  /**
   * 品質セクションの生成
   */
  generateQualitySection(qualityResults) {
    const sections = ['## 📏 コード品質'];
    
    const issues = qualityResults.issues || [];
    const errorCount = issues.filter(i => i.severity === 'error').length;
    const warningCount = issues.filter(i => i.severity === 'warning').length;
    const infoCount = issues.filter(i => i.severity === 'info').length;
    
    sections.push(`
### 概要
- **エラー**: ${errorCount} ❌
- **警告**: ${warningCount} ⚠️
- **情報**: ${infoCount} ℹ️`);
    
    // メトリクス
    if (qualityResults.metrics) {
      sections.push(`
### メトリクス`);
      
      if (qualityResults.metrics.complexity) {
        sections.push(`- **平均複雑度**: ${qualityResults.metrics.complexity.averageComplexity?.toFixed(2) || 'N/A'}`);
        sections.push(`- **最大複雑度**: ${qualityResults.metrics.complexity.maxComplexity || 'N/A'}`);
      }
      
      if (qualityResults.metrics.duplication) {
        sections.push(`- **重複ブロック**: ${qualityResults.metrics.duplication.duplicateBlocks || 0}`);
        sections.push(`- **重複行数**: ${qualityResults.metrics.duplication.duplicateLines || 0}`);
      }
    }
    
    // 詳細な問題リスト
    if (this.includeDetails && issues.length > 0) {
      sections.push(`
### 詳細な問題`);
      
      // 重要度別にグループ化
      const groupedIssues = this.groupIssuesBySeverity(issues);
      
      for (const [severity, severityIssues] of Object.entries(groupedIssues)) {
        if (severityIssues.length > 0) {
          const emoji = severity === 'error' ? '❌' : severity === 'warning' ? '⚠️' : 'ℹ️';
          sections.push(`
#### ${emoji} ${severity.toUpperCase()}
${severityIssues.slice(0, 10).map(issue => 
  `- **${issue.file}:${issue.line || 'N/A'}** - ${issue.message} ${issue.fixable ? '(自動修正可能)' : ''}`
).join('\n')}`);
          
          if (severityIssues.length > 10) {
            sections.push(`... 他 ${severityIssues.length - 10} 件`);
          }
        }
      }
    }
    
    return sections.join('\n');
  }
  
  /**
   * セキュリティセクションの生成
   */
  generateSecuritySection(securityResults) {
    const sections = ['## 🔒 セキュリティ'];
    
    const summary = securityResults.summary || {};
    
    sections.push(`
### 概要
- **クリティカル**: ${summary.critical || 0} 🚨
- **高**: ${summary.high || 0} ❗
- **中**: ${summary.medium || 0} ⚠️
- **低**: ${summary.low || 0} ℹ️
- **セキュリティスコア**: ${securityResults.securityScore || 0}/100`);
    
    // 依存関係の脆弱性
    if (securityResults.dependencies && securityResults.dependencies.length > 0) {
      sections.push(`
### 📦 依存関係の脆弱性
${securityResults.dependencies.slice(0, 5).map(dep => 
  `- **${dep.package}** - ${dep.title} (${dep.severity}) ${dep.fixAvailable ? '✅ 修正可能' : '❌ 修正なし'}`
).join('\n')}`);
      
      if (securityResults.dependencies.length > 5) {
        sections.push(`... 他 ${securityResults.dependencies.length - 5} 件`);
      }
    }
    
    // ハードコードされた認証情報
    if (securityResults.credentials && securityResults.credentials.length > 0) {
      sections.push(`
### 🔑 ハードコードされた認証情報
${securityResults.credentials.map(cred => 
  `- **${cred.file}:${cred.line}** - ${cred.credentialType} が検出されました`
).join('\n')}`);
    }
    
    // コードの脆弱性
    if (securityResults.vulnerabilities && securityResults.vulnerabilities.length > 0) {
      sections.push(`
### 🐛 コードの脆弱性
${securityResults.vulnerabilities.slice(0, 5).map(vuln => 
  `- **${vuln.file}:${vuln.line}** - ${vuln.vulnerabilityType} (${vuln.category})`
).join('\n')}`);
      
      if (securityResults.vulnerabilities.length > 5) {
        sections.push(`... 他 ${securityResults.vulnerabilities.length - 5} 件`);
      }
    }
    
    return sections.join('\n');
  }
  
  /**
   * パフォーマンスセクションの生成
   */
  generatePerformanceSection(performanceResults) {
    const sections = ['## ⚡ パフォーマンス'];
    
    // 実行時間
    if (performanceResults.executionTime) {
      sections.push(`
### 実行時間
- **総実行時間**: ${performanceResults.executionTime.totalTime}ms
- **クリティカルパス**: ${performanceResults.executionTime.criticalPaths?.length || 0} 件`);
      
      if (performanceResults.executionTime.criticalPaths?.length > 0) {
        sections.push(`
#### 遅い関数
${performanceResults.executionTime.criticalPaths.slice(0, 5).map(path => 
  `- **${path.file}** - ${path.function} (${path.time}ms)`
).join('\n')}`);
      }
    }
    
    // メモリ使用量
    if (performanceResults.memoryProfile) {
      sections.push(`
### メモリ使用量
- **ヒープ使用量**: ${performanceResults.memoryProfile.heapUsed} MB
- **ヒープ合計**: ${performanceResults.memoryProfile.heapTotal} MB
- **外部メモリ**: ${performanceResults.memoryProfile.external} MB`);
    }
    
    // メモリリーク
    if (performanceResults.memoryLeaks && performanceResults.memoryLeaks.length > 0) {
      sections.push(`
### 💧 潜在的なメモリリーク
${performanceResults.memoryLeaks.map(leak => 
  `- **${leak.file}:${leak.line}** - ${leak.type}: ${leak.message}`
).join('\n')}`);
    }
    
    // バンドルサイズ
    if (performanceResults.bundleSize && performanceResults.bundleSize.totalSize > 0) {
      const sizeInMB = (performanceResults.bundleSize.totalSize / 1024 / 1024).toFixed(2);
      sections.push(`
### 📦 バンドルサイズ
- **合計サイズ**: ${sizeInMB} MB`);
      
      if (performanceResults.bundleSize.largeModules?.length > 0) {
        sections.push(`
#### 大きなモジュール
${performanceResults.bundleSize.largeModules.slice(0, 5).map(mod => 
  `- **${mod.name}** - ${(mod.size / 1024).toFixed(2)} KB`
).join('\n')}`);
      }
    }
    
    // パフォーマンス回帰
    if (performanceResults.regressions && performanceResults.regressions.length > 0) {
      sections.push(`
### 📉 パフォーマンス回帰
${performanceResults.regressions.map(reg => 
  `- **${reg.metric}** - ${reg.increase} 増加 (${reg.previous} → ${reg.current})`
).join('\n')}`);
    }
    
    return sections.join('\n');
  }
  
  /**
   * 推奨事項セクションの生成
   */
  generateRecommendationsSection(recommendations) {
    if (!recommendations || recommendations.length === 0) {
      return '';
    }
    
    const sections = ['## 💡 推奨事項'];
    
    // 優先度別にグループ化
    const grouped = this.groupRecommendationsByPriority(recommendations);
    
    for (const [priority, recs] of Object.entries(grouped)) {
      if (recs.length > 0) {
        const emoji = priority === 'critical' ? '🚨' : priority === 'high' ? '❗' : '💡';
        sections.push(`
### ${emoji} ${priority.toUpperCase()}
${recs.map(rec => `- **${rec.message}**\n  - 対処法: ${rec.action}`).join('\n')}`);
      }
    }
    
    return sections.join('\n');
  }
  
  /**
   * JSONレポートの生成
   */
  async generateJSONReport(results) {
    return {
      metadata: {
        timestamp: new Date().toISOString(),
        repository: results.repository,
        issue: results.issue,
        pullRequest: results.pullRequest
      },
      summary: {
        qualityScore: results.qualityScore,
        testsTotal: results.results.tests?.total || 0,
        testsPassed: results.results.tests?.passed || 0,
        testsFailed: results.results.tests?.failed || 0,
        testCoverage: results.results.tests?.coverage || 0,
        qualityIssues: results.results.quality?.issues?.length || 0,
        securityIssues: (results.results.security?.vulnerabilities?.length || 0) + 
                       (results.results.security?.credentials?.length || 0),
        performanceRegressions: results.results.performance?.regressions?.length || 0
      },
      details: {
        tests: results.results.tests || {},
        quality: results.results.quality || {},
        security: results.results.security || {},
        performance: results.results.performance || {}
      },
      recommendations: results.recommendations || []
    };
  }
  
  /**
   * サマリーの生成
   */
  generateSummary(results) {
    const summary = [];
    
    // 品質スコア
    summary.push(`品質スコア: ${results.qualityScore}/100`);
    
    // テスト
    if (results.results.tests) {
      const tests = results.results.tests;
      summary.push(`テスト: ${tests.passed}/${tests.total} (${tests.coverage}%)`);
    }
    
    // 問題の総数
    let totalIssues = 0;
    if (results.results.quality?.issues) {
      totalIssues += results.results.quality.issues.length;
    }
    if (results.results.security) {
      totalIssues += (results.results.security.vulnerabilities?.length || 0);
      totalIssues += (results.results.security.credentials?.length || 0);
    }
    
    summary.push(`検出された問題: ${totalIssues}件`);
    
    // クリティカルな問題
    const criticalCount = results.recommendations?.filter(r => r.priority === 'critical').length || 0;
    if (criticalCount > 0) {
      summary.push(`⚠️ クリティカルな問題: ${criticalCount}件`);
    }
    
    return summary.join(' | ');
  }
  
  /**
   * 問題を重要度別にグループ化
   */
  groupIssuesBySeverity(issues) {
    return issues.reduce((grouped, issue) => {
      const severity = issue.severity || 'info';
      if (!grouped[severity]) {
        grouped[severity] = [];
      }
      grouped[severity].push(issue);
      return grouped;
    }, {});
  }
  
  /**
   * 推奨事項を優先度別にグループ化
   */
  groupRecommendationsByPriority(recommendations) {
    return recommendations.reduce((grouped, rec) => {
      const priority = rec.priority || 'medium';
      if (!grouped[priority]) {
        grouped[priority] = [];
      }
      grouped[priority].push(rec);
      return grouped;
    }, {});
  }
}

module.exports = ReportGenerator;