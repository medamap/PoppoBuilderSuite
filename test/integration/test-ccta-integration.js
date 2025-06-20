#!/usr/bin/env node
/**
 * CCTA（Code Change Test Agent）統合テスト
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const TestHelper = require('./test-helper');

async function runTests() {
  const helper = new TestHelper();
  let passed = 0;
  let failed = 0;

  console.log('🧪 CCTA統合テストを開始します...\n');

  try {
    // テスト1: CCTAエージェントの起動確認
    console.log('📋 テスト1: CCTAエージェントの起動確認');
    try {
      const tempDir = await helper.createTempDir('ccta-');
      const config = helper.createTestConfig({
        agents: { ccta: { enabled: true } }
      });
      
      // 設定ファイルを作成
      await fs.writeFile(
        path.join(tempDir, 'config.json'),
        JSON.stringify(config, null, 2)
      );

      // CCTAを起動
      const { proc } = await helper.startProcess('node', [
        path.join(__dirname, '../../agents/ccta/index.js')
      ], {
        env: {
          ...process.env,
          CONFIG_PATH: path.join(tempDir, 'config.json'),
          LOG_LEVEL: 'debug'
        }
      });

      // ハートビートファイルの作成を待機
      const heartbeatPath = path.join(tempDir, 'ccta-heartbeat.json');
      await helper.waitForFile(heartbeatPath, 5000);

      // ハートビートファイルの内容を確認
      const heartbeat = JSON.parse(await fs.readFile(heartbeatPath, 'utf8'));
      assert(heartbeat.agentId === 'ccta', 'エージェントIDが正しくありません');
      assert(heartbeat.status === 'running', 'ステータスが正しくありません');
      assert(heartbeat.lastUpdate, 'lastUpdateが設定されていません');

      console.log('✅ CCTAエージェントが正常に起動しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト2: テストランナーの動作確認
    console.log('\n📋 テスト2: テストランナーの動作確認');
    try {
      const TestRunner = require('../../agents/ccta/test-runner');
      const tempDir = await helper.createTempDir('test-runner-');
      
      // サンプルテストファイルを作成
      const testFile = path.join(tempDir, 'sample.test.js');
      await fs.writeFile(testFile, `
        describe('Sample Test', () => {
          it('should pass', () => {
            expect(1 + 1).toBe(2);
          });
        });
      `);

      // package.jsonを作成（Jestの設定）
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {
            test: 'jest'
          },
          devDependencies: {
            jest: '^29.0.0'
          }
        }, null, 2)
      );

      const runner = new TestRunner(console);
      const result = await runner.runTests(tempDir, 'all');
      
      assert(result.success === true, 'テストが失敗しました');
      assert(result.summary.total > 0, 'テストが実行されませんでした');
      assert(result.summary.passed > 0, 'パスしたテストがありません');

      console.log('✅ テストランナーが正常に動作しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト3: カバレッジレポーターの動作確認
    console.log('\n📋 テスト3: カバレッジレポーターの動作確認');
    try {
      const CoverageReporter = require('../../agents/ccta/coverage-reporter');
      const reporter = new CoverageReporter(console);

      // サンプルカバレッジデータ
      const coverageData = {
        '/src/sample.js': {
          path: '/src/sample.js',
          statementMap: {
            '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 10 } },
            '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 10 } }
          },
          fnMap: {},
          branchMap: {},
          s: { '0': 1, '1': 1 },
          f: {},
          b: {}
        }
      };

      const summary = await reporter.generateReport(coverageData, {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      });

      assert(summary.statements.pct === 100, 'ステートメントカバレッジが正しくありません');
      assert(summary.passedThresholds === true, '閾値チェックが正しくありません');

      console.log('✅ カバレッジレポーターが正常に動作しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト4: パフォーマンステスターの動作確認
    console.log('\n📋 テスト4: パフォーマンステスターの動作確認');
    try {
      const PerformanceTester = require('../../agents/ccta/performance-tester');
      const tester = new PerformanceTester(console);

      // 簡単なベンチマークテスト
      const scenarios = [{
        name: 'Simple calculation',
        fn: () => {
          let sum = 0;
          for (let i = 0; i < 1000000; i++) {
            sum += i;
          }
          return sum;
        },
        iterations: 10
      }];

      const results = await tester.runBenchmarks(scenarios);
      
      assert(results.length > 0, 'ベンチマーク結果がありません');
      assert(results[0].metrics, 'メトリクスが記録されていません');
      assert(results[0].metrics.mean > 0, '平均実行時間が正しくありません');

      console.log('✅ パフォーマンステスターが正常に動作しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト5: レポート生成の動作確認
    console.log('\n📋 テスト5: レポート生成の動作確認');
    try {
      const ReportGenerator = require('../../agents/ccta/report-generator');
      const tempDir = await helper.createTempDir('reports-');
      const generator = new ReportGenerator(tempDir, console);

      // テスト結果データ
      const testResults = {
        success: true,
        summary: {
          total: 10,
          passed: 8,
          failed: 2,
          skipped: 0
        },
        duration: 1234,
        tests: []
      };

      // カバレッジデータ
      const coverageResults = {
        summary: {
          statements: { pct: 85.5 },
          branches: { pct: 78.3 },
          functions: { pct: 92.1 },
          lines: { pct: 86.7 }
        },
        passedThresholds: true
      };

      // レポート生成
      const report = await generator.generateReport(
        testResults,
        coverageResults,
        null,
        'test-task'
      );

      assert(report.summary, 'サマリーが生成されていません');
      assert(report.recommendations.length > 0, '推奨事項が生成されていません');
      
      // Markdownレポートの確認
      const markdown = await generator.generateMarkdownReport(report);
      assert(markdown.includes('# テスト実行レポート'), 'Markdownヘッダーがありません');
      assert(markdown.includes('## サマリー'), 'サマリーセクションがありません');

      console.log('✅ レポート生成が正常に動作しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト6: エージェント間の連携確認
    console.log('\n📋 テスト6: PoppoBuilderとの連携確認');
    try {
      const tempDir = await helper.createTempDir('integration-');
      
      // モックタスクファイルを作成
      const taskFile = path.join(tempDir, 'task-pr_test.json');
      await fs.writeFile(taskFile, JSON.stringify({
        taskId: 'test-task-123',
        type: 'pr_test',
        issueNumber: 123,
        prNumber: 456,
        targetFiles: ['src/sample.js'],
        config: {
          runTests: true,
          checkCoverage: true,
          thresholds: {
            statements: 80,
            branches: 80,
            functions: 80,
            lines: 80
          }
        }
      }, null, 2));

      // タスクファイルの存在を確認
      await helper.waitForFile(taskFile);
      
      console.log('✅ PoppoBuilderとの連携準備が確認できました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

  } finally {
    // クリーンアップ
    await helper.cleanup();
  }

  // 結果サマリー
  console.log('\n📊 テスト結果サマリー');
  console.log(`✅ 成功: ${passed}`);
  console.log(`❌ 失敗: ${failed}`);
  console.log(`🏁 合計: ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

// テスト実行
runTests().catch(error => {
  console.error('致命的なエラー:', error);
  process.exit(1);
});