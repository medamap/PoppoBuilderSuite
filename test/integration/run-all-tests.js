#!/usr/bin/env node
/**
 * すべての統合テストを実行するスクリプト
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

// テストスクリプトのリスト
const testScripts = [
  'test-ccta-integration.js',
  'test-websocket-integration.js',
  'test-github-projects-integration.js'
];

// テスト結果を保存
const results = {
  total: 0,
  passed: 0,
  failed: 0,
  skipped: 0,
  tests: []
};

/**
 * 個別のテストスクリプトを実行
 */
async function runTest(scriptName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🧪 実行中: ${scriptName}`);
  console.log(`${'='.repeat(60)}\n`);

  const startTime = Date.now();
  
  return new Promise((resolve) => {
    const testPath = path.join(__dirname, scriptName);
    const proc = spawn('node', [testPath], {
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test'
      }
    });

    proc.on('close', (code) => {
      const duration = Date.now() - startTime;
      const result = {
        name: scriptName,
        passed: code === 0,
        duration: duration,
        exitCode: code
      };

      results.tests.push(result);
      results.total++;
      
      if (code === 0) {
        results.passed++;
        console.log(`\n✅ ${scriptName} - 成功 (${duration}ms)`);
      } else {
        results.failed++;
        console.log(`\n❌ ${scriptName} - 失敗 (終了コード: ${code}, ${duration}ms)`);
      }

      resolve(result);
    });

    proc.on('error', (error) => {
      const duration = Date.now() - startTime;
      const result = {
        name: scriptName,
        passed: false,
        duration: duration,
        error: error.message
      };

      results.tests.push(result);
      results.total++;
      results.failed++;
      
      console.error(`\n❌ ${scriptName} - エラー: ${error.message}`);
      resolve(result);
    });
  });
}

/**
 * 環境チェック
 */
async function checkEnvironment() {
  console.log('🔍 環境チェック中...\n');

  const checks = {
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd()
  };

  console.log('Node.js バージョン:', checks.nodeVersion);
  console.log('プラットフォーム:', checks.platform);
  console.log('アーキテクチャ:', checks.arch);
  console.log('作業ディレクトリ:', checks.cwd);

  // 必要なモジュールの確認
  const requiredModules = ['ws', 'jest', 'mocha', 'puppeteer'];
  const missingModules = [];

  for (const module of requiredModules) {
    try {
      require.resolve(module);
    } catch (error) {
      missingModules.push(module);
    }
  }

  if (missingModules.length > 0) {
    console.log('\n⚠️  警告: 以下のモジュールがインストールされていません:');
    console.log(missingModules.join(', '));
    console.log('一部のテストがスキップされる可能性があります。');
  }

  console.log('\n✅ 環境チェック完了\n');
  return checks;
}

/**
 * テスト結果レポートを生成
 */
async function generateReport(environment) {
  const reportPath = path.join(__dirname, 'test-report.json');
  const markdownPath = path.join(__dirname, 'test-report.md');

  // JSON形式のレポート
  const jsonReport = {
    timestamp: new Date().toISOString(),
    environment: environment,
    summary: {
      total: results.total,
      passed: results.passed,
      failed: results.failed,
      skipped: results.skipped,
      passRate: results.total > 0 ? 
        ((results.passed / results.total) * 100).toFixed(2) + '%' : '0%'
    },
    tests: results.tests
  };

  await fs.writeFile(reportPath, JSON.stringify(jsonReport, null, 2));

  // Markdown形式のレポート
  const markdown = `# 統合テストレポート

## 実行日時
${new Date().toLocaleString('ja-JP')}

## 環境情報
- Node.js: ${environment.nodeVersion}
- プラットフォーム: ${environment.platform}
- アーキテクチャ: ${environment.arch}

## サマリー
| 項目 | 値 |
|------|-----|
| 総テスト数 | ${results.total} |
| 成功 | ${results.passed} |
| 失敗 | ${results.failed} |
| スキップ | ${results.skipped} |
| 成功率 | ${jsonReport.summary.passRate} |

## テスト結果詳細
| テスト名 | 結果 | 実行時間 |
|----------|------|----------|
${results.tests.map(test => 
  `| ${test.name} | ${test.passed ? '✅ 成功' : '❌ 失敗'} | ${test.duration}ms |`
).join('\n')}

## 失敗したテスト
${results.tests
  .filter(test => !test.passed)
  .map(test => `- **${test.name}**: 終了コード ${test.exitCode || 'N/A'}`)
  .join('\n') || 'なし'}
`;

  await fs.writeFile(markdownPath, markdown);

  console.log(`\n📄 レポートを生成しました:`);
  console.log(`   - JSON: ${reportPath}`);
  console.log(`   - Markdown: ${markdownPath}`);
}

/**
 * メイン処理
 */
async function main() {
  console.log('🚀 PoppoBuilder Suite 統合テスト\n');
  
  // 環境チェック
  const environment = await checkEnvironment();

  // 各テストを順番に実行
  for (const script of testScripts) {
    await runTest(script);
  }

  // 最終結果
  console.log(`\n${'='.repeat(60)}`);
  console.log('📊 最終結果');
  console.log(`${'='.repeat(60)}`);
  console.log(`✅ 成功: ${results.passed}`);
  console.log(`❌ 失敗: ${results.failed}`);
  console.log(`⏭️  スキップ: ${results.skipped}`);
  console.log(`🏁 合計: ${results.total}`);
  console.log(`📈 成功率: ${results.total > 0 ? 
    ((results.passed / results.total) * 100).toFixed(2) : 0}%`);

  // レポート生成
  await generateReport(environment);

  // 終了コード
  process.exit(results.failed > 0 ? 1 : 0);
}

// 実行
main().catch(error => {
  console.error('致命的なエラー:', error);
  process.exit(1);
});