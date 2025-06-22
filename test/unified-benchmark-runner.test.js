/**
 * Issue #134: Unified Benchmark Runner テスト
 * 統合パフォーマンスベンチマークツールのテストコード
 */

const assert = require('assert');
const UnifiedBenchmarkRunner = require('../lib/performance/unified-benchmark-runner');
const path = require('path');
const fs = require('fs').promises;

describe('UnifiedBenchmarkRunner - Issue #134', function() {
  this.timeout(60000); // 60秒のタイムアウト

  let runner;
  let testOutputDir;

  beforeEach(async () => {
    // テスト用の出力ディレクトリを作成
    testOutputDir = path.join(__dirname, '..', 'test-output', 'benchmarks');
    await fs.mkdir(testOutputDir, { recursive: true });

    // 短時間テスト用の設定
    runner = new UnifiedBenchmarkRunner({
      benchmarkTypes: ['performance', 'system'],
      shortTest: true,
      outputDir: testOutputDir,
      reportFormat: 'json',
      redis: { enabled: false }, // テストではRedisを無効化
      performance: {
        duration: 5000 // 5秒間のテスト
      }
    });
  });

  afterEach(async () => {
    if (runner?.isRunning) {
      await runner.stop();
    }
    
    // テスト用ファイルをクリーンアップ
    try {
      const files = await fs.readdir(testOutputDir);
      for (const file of files) {
        await fs.unlink(path.join(testOutputDir, file));
      }
      await fs.rmdir(testOutputDir);
    } catch (error) {
      // クリーンアップエラーは無視
    }
  });

  describe('1. 基本機能テスト', () => {
    it('UnifiedBenchmarkRunnerが正常に初期化できること', async () => {
      assert.ok(runner instanceof UnifiedBenchmarkRunner);
      assert.equal(runner.isRunning, false);
      assert.deepEqual(runner.options.benchmarkTypes, ['performance', 'system']);
      assert.equal(runner.options.shortTest, true);
    });

    it('初期化が正常に完了すること', async () => {
      await runner.initialize();
      
      assert.ok(runner.performanceMonitor, 'PerformanceMonitorが初期化されている');
      assert.ok(runner.loadTester, 'LoadTesterが初期化されている');
    });
  });

  describe('2. ベンチマーク実行テスト', () => {
    it('パフォーマンスベンチマークが実行できること', async () => {
      await runner.initialize();
      
      const result = await runner.runPerformanceBenchmark();
      
      assert.ok(result, 'ベンチマーク結果が返される');
      assert.equal(result.type, 'performance');
      assert.ok(result.duration > 0, '実行時間が記録されている');
      assert.ok(result.profile, 'プロファイル情報が含まれている');
      assert.ok(result.performanceTests, 'パフォーマンステスト結果が含まれている');
    });

    it('システムベンチマークが実行できること', async () => {
      await runner.initialize();
      
      const result = await runner.runSystemBenchmark();
      
      assert.ok(result, 'ベンチマーク結果が返される');
      assert.equal(result.type, 'system');
      assert.ok(result.results, 'システムテスト結果が含まれている');
      assert.ok(result.summary, 'サマリー情報が含まれている');
    });
  });

  describe('3. フルベンチマークスイート実行テスト', () => {
    it('フルベンチマークスイートが正常に実行できること', async () => {
      await runner.initialize();
      
      const results = await runner.runFullBenchmarkSuite();
      
      assert.ok(results, 'ベンチマーク結果が返される');
      assert.ok(results.title, 'レポートタイトルが設定されている');
      assert.ok(results.executionInfo, '実行情報が含まれている');
      assert.ok(results.results, 'ベンチマーク結果が含まれている');
      assert.ok(typeof results.overallScore === 'number', '総合スコアが計算されている');
      assert.ok(Array.isArray(results.recommendations), '推奨事項が含まれている');
      assert.ok(results.systemInfo, 'システム情報が含まれている');
    });

    it('ベンチマーク結果がファイルに保存されること', async () => {
      await runner.initialize();
      await runner.runFullBenchmarkSuite();
      
      // JSONファイルが作成されているかチェック
      const files = await fs.readdir(testOutputDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      assert.ok(jsonFiles.length > 0, 'JSONレポートが保存されている');
      
      // ファイル内容をチェック
      const reportContent = await fs.readFile(path.join(testOutputDir, jsonFiles[0]), 'utf8');
      const report = JSON.parse(reportContent);
      
      assert.ok(report.title, 'レポートタイトルが保存されている');
      assert.ok(report.overallScore >= 0, '総合スコアが保存されている');
    });
  });

  describe('4. エラーハンドリングテスト', () => {
    it('ベンチマーク実行中にエラーが発生しても適切に処理されること', async () => {
      // 無効な設定でランナーを作成
      const errorRunner = new UnifiedBenchmarkRunner({
        benchmarkTypes: ['invalid-type'],
        shortTest: true,
        outputDir: '/invalid/path'
      });

      try {
        await errorRunner.initialize();
        await errorRunner.runFullBenchmarkSuite();
        assert.fail('エラーが期待されたが発生しなかった');
      } catch (error) {
        assert.ok(error instanceof Error, '適切なエラーがthrowされる');
      }
    });

    it('ベンチマークを中断できること', async () => {
      await runner.initialize();
      
      // ベンチマークを開始
      const benchmarkPromise = runner.runFullBenchmarkSuite();
      
      // 少し待ってから停止
      setTimeout(async () => {
        await runner.stop();
      }, 1000);
      
      try {
        await benchmarkPromise;
      } catch (error) {
        // 中断によるエラーは期待される
      }
      
      assert.equal(runner.isRunning, false, 'ベンチマークが停止している');
    });
  });

  describe('5. 個別機能テスト', () => {
    it('CPU集約処理ベンチマークが動作すること', async () => {
      await runner.initialize();
      
      const result = await runner.benchmarkCpuIntensive();
      
      assert.ok(result.iterations > 0, '反復処理が実行されている');
      assert.ok(result.duration > 0, '実行時間が記録されている');
      assert.ok(result.operationsPerSecond > 0, '秒あたり操作数が計算されている');
    });

    it('メモリ集約処理ベンチマークが動作すること', async () => {
      await runner.initialize();
      
      const result = await runner.benchmarkMemoryIntensive();
      
      assert.ok(result.iterations > 0, '反復処理が実行されている');
      assert.ok(result.memoryUsage, 'メモリ使用量が記録されている');
      assert.ok(result.memoryUsage.start, '開始時メモリが記録されている');
      assert.ok(result.memoryUsage.peak, 'ピーク時メモリが記録されている');
      assert.ok(result.memoryUsage.end, '終了時メモリが記録されている');
    });

    it('ディスクI/Oベンチマークが動作すること', async () => {
      await runner.initialize();
      
      const result = await runner.benchmarkDiskIO();
      
      assert.ok(result.fileCount > 0, 'ファイル数が記録されている');
      assert.ok(result.operations, 'I/O操作結果が含まれている');
      assert.ok(result.operations.write, '書き込み操作が実行されている');
      assert.ok(result.operations.read, '読み込み操作が実行されている');
      assert.ok(result.operations.delete, '削除操作が実行されている');
    });
  });

  describe('6. スコア計算テスト', () => {
    it('総合スコアが正しく計算されること', async () => {
      await runner.initialize();
      
      // テスト用の結果を設定
      runner.benchmarkResults.set('performance', {
        type: 'performance',
        metrics: {
          resourceUsage: {
            cpu: { average: 30 },
            memory: { average: 40 }
          }
        }
      });
      
      runner.benchmarkResults.set('system', {
        type: 'system',
        summary: {
          cpuPerformance: 50000,
          memoryEfficiency: 30000,
          networkThroughput: 20
        }
      });
      
      const score = runner.calculateOverallScore();
      
      assert.ok(typeof score === 'number', 'スコアが数値である');
      assert.ok(score >= 0 && score <= 100, 'スコアが0-100の範囲内である');
    });

    it('推奨事項が生成されること', async () => {
      await runner.initialize();
      
      // 高いCPU使用率のテスト結果を設定
      runner.benchmarkResults.set('performance', {
        type: 'performance',
        metrics: {
          resourceUsage: {
            cpu: { average: 80 }, // 高いCPU使用率
            memory: { average: 40 }
          }
        }
      });
      
      const recommendations = runner.generateRecommendations();
      
      assert.ok(Array.isArray(recommendations), '推奨事項が配列である');
      assert.ok(recommendations.length > 0, '推奨事項が生成されている');
      
      const cpuRecommendation = recommendations.find(r => r.category === 'performance');
      assert.ok(cpuRecommendation, 'CPU関連の推奨事項が含まれている');
    });
  });

  describe('7. レポート生成テスト', () => {
    it('HTMLレポートが生成できること', async () => {
      await runner.initialize();
      
      // テスト用の結果を設定
      runner.overallResults = {
        title: 'Test Report',
        overallScore: 75,
        executionInfo: {
          startTime: new Date().toISOString(),
          endTime: new Date().toISOString(),
          totalDuration: 30000,
          testMode: 'short',
          benchmarkTypes: ['performance', 'system']
        },
        results: {},
        recommendations: [],
        systemInfo: {
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          cpuCount: 4,
          totalMemory: '8GB'
        },
        timestamp: new Date().toISOString()
      };
      
      const html = await runner.generateHtmlReport();
      
      assert.ok(typeof html === 'string', 'HTMLが文字列として生成される');
      assert.ok(html.includes('<!DOCTYPE html>'), 'HTMLドキュメントの形式である');
      assert.ok(html.includes('総合スコア: 75'), 'スコアが含まれている');
      assert.ok(html.includes('PoppoBuilder Suite'), 'タイトルが含まれている');
    });
  });
});