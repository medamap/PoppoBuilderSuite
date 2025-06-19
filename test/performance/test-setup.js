#!/usr/bin/env node

/**
 * パフォーマンステストの動作確認スクリプト
 * 各コンポーネントが正しく動作することを検証
 */

const BenchmarkRunner = require('../../src/performance/benchmark-runner');
const MetricsCollector = require('../../src/performance/collectors/metrics-collector');
const PerformanceReportGenerator = require('../../src/performance/report-generator');

async function testBenchmarkRunner() {
  console.log('🧪 BenchmarkRunnerのテスト...');
  
  const benchmark = new BenchmarkRunner({
    name: 'テストベンチマーク',
    iterations: 10,
    warmup: 2
  });
  
  const results = await benchmark.run(async () => {
    // 簡単な遅延処理
    await new Promise(resolve => setTimeout(resolve, Math.random() * 10 + 5));
  });
  
  console.log(benchmark.formatResults());
  console.log('✅ BenchmarkRunner: OK\n');
}

async function testMetricsCollector() {
  console.log('🧪 MetricsCollectorのテスト...');
  
  const collector = new MetricsCollector({
    interval: 100,
    maxSamples: 10
  });
  
  collector.start();
  
  // カスタムメトリクス
  collector.mark('start');
  await new Promise(resolve => setTimeout(resolve, 500));
  collector.mark('end');
  collector.measure('duration', 'start', 'end');
  collector.increment('test_counter', 5);
  
  collector.stop();
  
  const summary = collector.getSummary();
  console.log('収集サンプル数:', summary.sampleCount);
  console.log('カスタムメトリクス:', summary.custom);
  console.log('✅ MetricsCollector: OK\n');
}

async function testReportGenerator() {
  console.log('🧪 ReportGeneratorのテスト...');
  
  const generator = new PerformanceReportGenerator();
  
  const mockResults = {
    throughput: {
      issuesPerHour: 1200,
      single: {
        timing: {
          mean: 150,
          p95: 200
        }
      }
    },
    responseTime: {
      endpoints: {
        '/api/health': {
          statistics: {
            timing: {
              mean: 50,
              p95: 80
            }
          }
        }
      }
    }
  };
  
  // JSON形式でテストレポート生成
  const reportPath = await generator.generateReport(mockResults, {
    format: 'json'
  });
  
  console.log('レポートパス:', reportPath);
  console.log('✅ ReportGenerator: OK\n');
}

async function main() {
  console.log('🚀 PoppoBuilder Suite パフォーマンステスト 動作確認');
  console.log('='.repeat(50));
  
  try {
    await testBenchmarkRunner();
    await testMetricsCollector();
    await testReportGenerator();
    
    console.log('='.repeat(50));
    console.log('✅ すべてのコンポーネントが正常に動作しています！');
    console.log('\n次のコマンドでパフォーマンステストを実行できます:');
    console.log('  npm run test:performance:quick');
    
  } catch (error) {
    console.error('❌ エラーが発生しました:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}