#!/usr/bin/env node

/**
 * CCSP統合テストスイート実行スクリプト
 * 
 * Issue #144: CCSP移行の統合テストとバリデーション計画の実行
 */

const path = require('path');
const fs = require('fs').promises;

// テストスイートクラスのインポート
const RateLimitSimulationTest = require('./validation/rate-limit-simulation');
const CCSPUnitTests = require('./validation/unit-tests');
const CCSPIntegrationTests = require('./validation/integration-tests');
const CCSPEndToEndScenarios = require('./validation/e2e-scenarios');

class CCSPTestRunner {
  constructor() {
    this.testSuites = [
      { name: 'Rate Limit Simulation', class: RateLimitSimulationTest, enabled: true },
      { name: 'Unit Tests', class: CCSPUnitTests, enabled: true },
      { name: 'Integration Tests', class: CCSPIntegrationTests, enabled: true },
      { name: 'End-to-End Scenarios', class: CCSPEndToEndScenarios, enabled: true }
    ];
    
    this.results = [];
    this.startTime = null;
    this.endTime = null;
  }
  
  /**
   * 全テストスイートの実行
   */
  async runAllTests(options = {}) {
    console.log('🚀 CCSP統合テスト開始\n');
    console.log('=' .repeat(80));
    console.log('Issue #144: CCSP移行の統合テストとバリデーション計画');
    console.log('=' .repeat(80));
    console.log();
    
    this.startTime = Date.now();
    
    try {
      // オプション処理
      if (options.suite) {
        this.testSuites = this.testSuites.filter(suite => 
          suite.name.toLowerCase().includes(options.suite.toLowerCase())
        );
      }
      
      if (options.skip) {
        const skipSuites = options.skip.split(',').map(s => s.trim().toLowerCase());
        this.testSuites = this.testSuites.filter(suite => 
          !skipSuites.some(skip => suite.name.toLowerCase().includes(skip))
        );
      }
      
      // 各テストスイートを順次実行
      for (const suiteConfig of this.testSuites) {
        if (!suiteConfig.enabled) {
          console.log(`⏭️  ${suiteConfig.name} - スキップ\n`);
          continue;
        }
        
        console.log(`🧪 ${suiteConfig.name} 実行中...`);
        console.log('-'.repeat(50));
        
        const suiteStartTime = Date.now();
        
        try {
          const TestSuiteClass = suiteConfig.class;
          const testSuite = new TestSuiteClass();
          
          const result = await testSuite.run();
          
          const suiteEndTime = Date.now();
          const suiteDuration = suiteEndTime - suiteStartTime;
          
          this.results.push({
            name: suiteConfig.name,
            success: true,
            result: result,
            duration: suiteDuration,
            error: null
          });
          
          console.log(`✅ ${suiteConfig.name} 完了 (${(suiteDuration / 1000).toFixed(2)}s)`);
          
          if (result.passed !== undefined && result.failed !== undefined) {
            console.log(`   📊 結果: ${result.passed}件成功, ${result.failed}件失敗`);
          }
          
        } catch (error) {
          const suiteEndTime = Date.now();
          const suiteDuration = suiteEndTime - suiteStartTime;
          
          this.results.push({
            name: suiteConfig.name,
            success: false,
            result: null,
            duration: suiteDuration,
            error: error.message
          });
          
          console.log(`❌ ${suiteConfig.name} 失敗 (${(suiteDuration / 1000).toFixed(2)}s)`);
          console.log(`   🚨 エラー: ${error.message}`);
          
          if (options.bail) {
            console.log('\n🛑 --bail オプションが指定されているため、テストを中止します');
            break;
          }
        }
        
        console.log();
      }
      
      this.endTime = Date.now();
      
      // 結果サマリーの表示
      await this.displaySummary();
      
      // レポート生成
      if (options.report !== false) {
        await this.generateReports();
      }
      
      // 終了コードの決定
      const hasFailures = this.results.some(r => !r.success);
      process.exit(hasFailures ? 1 : 0);
      
    } catch (error) {
      console.error('\n💥 テストランナーでエラーが発生しました:');
      console.error(error);
      process.exit(1);
    }
  }
  
  /**
   * 結果サマリーの表示
   */
  async displaySummary() {
    const totalDuration = this.endTime - this.startTime;
    const successfulSuites = this.results.filter(r => r.success);
    const failedSuites = this.results.filter(r => !r.success);
    
    console.log('📋 テスト実行サマリー');
    console.log('=' .repeat(80));
    
    // 全体統計
    console.log(`🕐 総実行時間: ${(totalDuration / 1000).toFixed(2)}秒`);
    console.log(`📊 実行スイート: ${this.results.length}個`);
    console.log(`✅ 成功: ${successfulSuites.length}個`);
    console.log(`❌ 失敗: ${failedSuites.length}個`);
    console.log();
    
    // 詳細結果
    console.log('詳細結果:');
    for (const result of this.results) {
      const status = result.success ? '✅' : '❌';
      const duration = (result.duration / 1000).toFixed(2);
      
      console.log(`  ${status} ${result.name} (${duration}s)`);
      
      if (!result.success) {
        console.log(`     💥 ${result.error}`);
      } else if (result.result) {
        // 個別テスト統計
        if (result.result.passed !== undefined) {
          console.log(`     📈 ${result.result.passed}件成功, ${result.result.failed || 0}件失敗`);
        }
        if (result.result.tests && Array.isArray(result.result.tests)) {
          console.log(`     🧪 ${result.result.tests.length}個のテスト実行`);
        }
      }
    }
    
    console.log();
    
    // 全体的な評価
    if (failedSuites.length === 0) {
      console.log('🎉 全てのテストスイートが成功しました！');
      console.log('✨ CCSP移行の準備が整いました。');
    } else {
      console.log('⚠️  一部のテストスイートで問題が発生しました。');
      console.log('🔧 失敗したテストを確認して修正してください。');
    }
    
    console.log();
  }
  
  /**
   * レポート生成
   */
  async generateReports() {
    console.log('📄 レポート生成中...');
    
    const reportData = {
      summary: {
        totalSuites: this.results.length,
        successfulSuites: this.results.filter(r => r.success).length,
        failedSuites: this.results.filter(r => !r.success).length,
        totalDuration: this.endTime - this.startTime,
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date(this.endTime).toISOString()
      },
      suites: this.results,
      environment: {
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd(),
        timestamp: new Date().toISOString()
      }
    };
    
    const reportsDir = path.join(__dirname, 'reports');
    await fs.mkdir(reportsDir, { recursive: true });
    
    // JSON レポート
    await this.generateJSONReport(reportData, reportsDir);
    
    // HTML レポート
    await this.generateHTMLReport(reportData, reportsDir);
    
    // Markdown レポート
    await this.generateMarkdownReport(reportData, reportsDir);
    
    console.log(`📁 レポートが生成されました: ${reportsDir}`);
  }
  
  /**
   * JSONレポート生成
   */
  async generateJSONReport(data, reportsDir) {
    const reportPath = path.join(reportsDir, 'ccsp-test-results.json');
    await fs.writeFile(reportPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * HTMLレポート生成
   */
  async generateHTMLReport(data, reportsDir) {
    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CCSP統合テスト結果</title>
    <style>
        body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 0; padding: 20px; 
            background-color: #f5f5f5;
        }
        .container { 
            max-width: 1200px; 
            margin: 0 auto; 
            background: white; 
            padding: 30px; 
            border-radius: 8px; 
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header { 
            text-align: center; 
            margin-bottom: 30px; 
            padding-bottom: 20px; 
            border-bottom: 2px solid #eee;
        }
        .summary { 
            display: grid; 
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); 
            gap: 20px; 
            margin-bottom: 30px;
        }
        .stat-card { 
            background: #f8f9fa; 
            padding: 20px; 
            border-radius: 8px; 
            text-align: center;
            border-left: 4px solid #007bff;
        }
        .stat-value { 
            font-size: 2em; 
            font-weight: bold; 
            color: #333;
        }
        .stat-label { 
            color: #666; 
            font-size: 0.9em;
        }
        .success { color: #28a745; border-left-color: #28a745; }
        .failure { color: #dc3545; border-left-color: #dc3545; }
        .info { color: #17a2b8; border-left-color: #17a2b8; }
        .suite-results { margin-top: 30px; }
        .suite-item { 
            background: #fff; 
            border: 1px solid #dee2e6; 
            border-radius: 8px; 
            margin-bottom: 15px; 
            overflow: hidden;
        }
        .suite-header { 
            padding: 15px 20px; 
            background: #f8f9fa; 
            border-bottom: 1px solid #dee2e6;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .suite-content { 
            padding: 20px; 
        }
        .status-badge { 
            padding: 4px 12px; 
            border-radius: 20px; 
            font-size: 0.8em; 
            font-weight: bold;
        }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-failure { background: #f8d7da; color: #721c24; }
        .error-details { 
            background: #f8f9fa; 
            border-left: 4px solid #dc3545; 
            padding: 15px; 
            margin-top: 15px; 
            border-radius: 4px;
        }
        .timestamp { 
            color: #6c757d; 
            font-size: 0.9em; 
            text-align: center; 
            margin-top: 30px; 
            padding-top: 20px; 
            border-top: 1px solid #eee;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🚀 CCSP統合テスト結果</h1>
            <p>Issue #144: CCSP移行の統合テストとバリデーション計画</p>
        </div>
        
        <div class="summary">
            <div class="stat-card info">
                <div class="stat-value">${data.summary.totalSuites}</div>
                <div class="stat-label">総テストスイート</div>
            </div>
            <div class="stat-card success">
                <div class="stat-value">${data.summary.successfulSuites}</div>
                <div class="stat-label">成功</div>
            </div>
            <div class="stat-card failure">
                <div class="stat-value">${data.summary.failedSuites}</div>
                <div class="stat-label">失敗</div>
            </div>
            <div class="stat-card info">
                <div class="stat-value">${(data.summary.totalDuration / 1000).toFixed(1)}s</div>
                <div class="stat-label">総実行時間</div>
            </div>
        </div>
        
        <div class="suite-results">
            <h2>📊 テストスイート詳細</h2>
            ${data.suites.map(suite => `
                <div class="suite-item">
                    <div class="suite-header">
                        <h3>${suite.name}</h3>
                        <span class="status-badge ${suite.success ? 'badge-success' : 'badge-failure'}">
                            ${suite.success ? '✅ 成功' : '❌ 失敗'}
                        </span>
                    </div>
                    <div class="suite-content">
                        <p><strong>実行時間:</strong> ${(suite.duration / 1000).toFixed(2)}秒</p>
                        ${suite.result && suite.result.passed !== undefined ? 
                            `<p><strong>テスト結果:</strong> ${suite.result.passed}件成功, ${suite.result.failed || 0}件失敗</p>` : ''}
                        ${!suite.success ? 
                            `<div class="error-details">
                                <h4>❌ エラー詳細</h4>
                                <p>${suite.error}</p>
                            </div>` : ''}
                    </div>
                </div>
            `).join('')}
        </div>
        
        <div class="timestamp">
            生成日時: ${new Date(data.environment.timestamp).toLocaleString('ja-JP')}
        </div>
    </div>
</body>
</html>`;
    
    const reportPath = path.join(reportsDir, 'ccsp-test-results.html');
    await fs.writeFile(reportPath, html);
  }
  
  /**
   * Markdownレポート生成
   */
  async generateMarkdownReport(data, reportsDir) {
    const markdown = `# CCSP統合テスト結果

Issue #144: CCSP移行の統合テストとバリデーション計画

## 📊 実行サマリー

- **総テストスイート**: ${data.summary.totalSuites}個
- **成功**: ${data.summary.successfulSuites}個 ✅
- **失敗**: ${data.summary.failedSuites}個 ❌
- **総実行時間**: ${(data.summary.totalDuration / 1000).toFixed(2)}秒
- **実行開始**: ${new Date(data.summary.startTime).toLocaleString('ja-JP')}
- **実行終了**: ${new Date(data.summary.endTime).toLocaleString('ja-JP')}

## 🧪 テストスイート詳細

| スイート名 | ステータス | 実行時間 | 結果 |
|-----------|----------|---------|------|
${data.suites.map(suite => {
  const status = suite.success ? '✅ 成功' : '❌ 失敗';
  const duration = (suite.duration / 1000).toFixed(2) + 's';
  const result = suite.result && suite.result.passed !== undefined 
    ? `${suite.result.passed}件成功, ${suite.result.failed || 0}件失敗`
    : '-';
  return `| ${suite.name} | ${status} | ${duration} | ${result} |`;
}).join('\n')}

## 📋 詳細結果

${data.suites.map(suite => `
### ${suite.name}

- **ステータス**: ${suite.success ? '✅ 成功' : '❌ 失敗'}
- **実行時間**: ${(suite.duration / 1000).toFixed(2)}秒
${suite.result && suite.result.passed !== undefined ? 
  `- **テスト結果**: ${suite.result.passed}件成功, ${suite.result.failed || 0}件失敗` : ''}
${!suite.success ? `- **エラー**: ${suite.error}` : ''}
`).join('')}

## 🔧 環境情報

- **Node.js**: ${data.environment.nodeVersion}
- **プラットフォーム**: ${data.environment.platform}
- **作業ディレクトリ**: ${data.environment.cwd}

## 📄 生成情報

このレポートは ${new Date(data.environment.timestamp).toLocaleString('ja-JP')} に自動生成されました。

---

**Issue #144 関連リンク**: [CCSP移行の統合テストとバリデーション計画](https://github.com/medamap/PoppoBuilderSuite/issues/144)
`;
    
    const reportPath = path.join(reportsDir, 'ccsp-test-results.md');
    await fs.writeFile(reportPath, markdown);
  }
}

/**
 * CLI実行部分
 */
if (require.main === module) {
  // コマンドライン引数の解析
  const args = process.argv.slice(2);
  const options = {};
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    
    if (arg === '--suite' && i + 1 < args.length) {
      options.suite = args[i + 1];
      i++;
    } else if (arg === '--skip' && i + 1 < args.length) {
      options.skip = args[i + 1];
      i++;
    } else if (arg === '--bail') {
      options.bail = true;
    } else if (arg === '--no-report') {
      options.report = false;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
CCSP統合テストランナー

使用方法:
  node run-all-tests.js [オプション]

オプション:
  --suite <name>    特定のテストスイートのみ実行
  --skip <names>    指定したテストスイートをスキップ (カンマ区切り)
  --bail           最初のエラーで実行を停止
  --no-report      レポート生成を無効化
  --help, -h       このヘルプを表示

例:
  node run-all-tests.js
  node run-all-tests.js --suite "Unit Tests"
  node run-all-tests.js --skip "e2e,integration"
  node run-all-tests.js --bail --no-report
`);
      process.exit(0);
    }
  }
  
  // テストランナーの実行
  const runner = new CCSPTestRunner();
  runner.runAllTests(options);
}

module.exports = CCSPTestRunner;