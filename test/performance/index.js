#!/usr/bin/env node

const ThroughputBenchmark = require('./benchmarks/throughput-benchmark');
const ResponseTimeBenchmark = require('./benchmarks/response-time-benchmark');
const ResourceUsageBenchmark = require('./benchmarks/resource-usage-benchmark');
const PerformanceReportGenerator = require('../../src/performance/report-generator');
const path = require('path');
const fs = require('fs').promises;

/**
 * PoppoBuilder Suite 統合パフォーマンステストランナー
 */
class PerformanceTestRunner {
  constructor(options = {}) {
    this.options = {
      skipThroughput: options.skipThroughput || false,
      skipResponseTime: options.skipResponseTime || false,
      skipResourceUsage: options.skipResourceUsage || false,
      reportFormat: options.reportFormat || 'html',
      updateBaseline: options.updateBaseline || false,
      quickMode: options.quickMode || false, // 高速モード（時間短縮）
      ...options
    };
    
    this.results = {
      timestamp: new Date().toISOString(),
      duration: 0,
      tests: {}
    };
    
    this.reportGenerator = new PerformanceReportGenerator();
  }

  /**
   * 全パフォーマンステストの実行
   */
  async runAll() {
    console.log('🚀 PoppoBuilder Suite 統合パフォーマンステスト');
    console.log('='.repeat(60));
    console.log(`実行モード: ${this.options.quickMode ? '高速' : '通常'}`);
    console.log(`レポート形式: ${this.options.reportFormat}`);
    console.log('='.repeat(60));
    
    const startTime = Date.now();
    
    try {
      // 1. スループットテスト
      if (!this.options.skipThroughput) {
        console.log('\n[1/3] スループットテスト');
        console.log('-'.repeat(40));
        this.results.tests.throughput = await this.runThroughputTests();
      }
      
      // 2. レスポンスタイムテスト
      if (!this.options.skipResponseTime) {
        console.log('\n[2/3] レスポンスタイムテスト');
        console.log('-'.repeat(40));
        this.results.tests.responseTime = await this.runResponseTimeTests();
      }
      
      // 3. リソース使用量テスト
      if (!this.options.skipResourceUsage) {
        console.log('\n[3/3] リソース使用量テスト');
        console.log('-'.repeat(40));
        this.results.tests.resourceUsage = await this.runResourceUsageTests();
      }
      
      this.results.duration = Date.now() - startTime;
      
      // レポート生成
      const reportPath = await this.generateReport();
      
      // ベースライン更新
      if (this.options.updateBaseline) {
        await this.reportGenerator.updateBaseline(this.results);
      }
      
      console.log('\n' + '='.repeat(60));
      console.log('✅ すべてのテストが完了しました');
      console.log(`実行時間: ${(this.results.duration / 1000).toFixed(1)}秒`);
      console.log(`レポート: ${reportPath}`);
      console.log('='.repeat(60));
      
      return {
        success: true,
        duration: this.results.duration,
        reportPath: reportPath,
        results: this.results
      };
      
    } catch (error) {
      console.error('\n❌ テスト実行エラー:', error);
      this.results.error = error.message;
      
      // エラーレポートも生成
      await this.generateReport();
      
      return {
        success: false,
        error: error.message,
        results: this.results
      };
    }
  }

  /**
   * スループットテストの実行
   */
  async runThroughputTests() {
    const benchmark = new ThroughputBenchmark();
    const results = {};
    
    try {
      // 単一Issue処理
      if (!this.options.quickMode) {
        results.single = await benchmark.runSingleIssueBenchmark();
      }
      
      // 並行処理（選択的な並行度）
      const concurrencies = this.options.quickMode ? [10] : [1, 5, 10, 20];
      results.concurrent = {};
      
      for (const c of concurrencies) {
        results.concurrent[`concurrent_${c}`] = await benchmark.runConcurrentBenchmark(c);
      }
      
      // スループット測定
      const duration = this.options.quickMode ? 30000 : 60000;
      results.throughput = await benchmark.measureThroughput(duration);
      
      // エージェント別（quickModeではスキップ）
      if (!this.options.quickMode) {
        results.agents = await benchmark.runAgentBenchmarks();
      }
      
      return results;
      
    } catch (error) {
      console.error('スループットテストエラー:', error);
      return { error: error.message };
    }
  }

  /**
   * レスポンスタイムテストの実行
   */
  async runResponseTimeTests() {
    const benchmark = new ResponseTimeBenchmark();
    const results = {};
    
    try {
      // APIエンドポイントテスト
      results.endpoints = await benchmark.runAllBenchmarks();
      
      // ダッシュボード表示速度（quickModeではスキップ）
      if (!this.options.quickMode) {
        results.dashboard = await benchmark.benchmarkDashboardLoad();
      }
      
      // レイテンシ分析（quickModeでは短縮）
      if (!this.options.quickMode) {
        results.latency = await benchmark.analyzeLatency();
      }
      
      return results;
      
    } catch (error) {
      console.error('レスポンスタイムテストエラー:', error);
      return { error: error.message };
    }
  }

  /**
   * リソース使用量テストの実行
   */
  async runResourceUsageTests() {
    const benchmark = new ResourceUsageBenchmark();
    const results = {};
    
    try {
      // アイドル時
      const idleDuration = this.options.quickMode ? 20000 : 60000;
      results.idle = await benchmark.measureIdleResources(idleDuration);
      
      // 通常負荷
      const loadDuration = this.options.quickMode ? 20000 : 60000;
      results.normalLoad = await benchmark.measureLoadResources(10, loadDuration);
      
      // 高負荷（quickModeではスキップ）
      if (!this.options.quickMode) {
        results.highLoad = await benchmark.measureLoadResources(100, loadDuration);
      }
      
      // メモリリーク検出（quickModeではスキップ）
      if (!this.options.quickMode) {
        results.memoryLeak = await benchmark.detectMemoryLeak(120000);
      }
      
      return results;
      
    } catch (error) {
      console.error('リソース使用量テストエラー:', error);
      return { error: error.message };
    }
  }

  /**
   * レポートの生成
   */
  async generateReport() {
    // 結果の整形
    const formattedResults = this.formatResults();
    
    // レポート生成
    const reportPath = await this.reportGenerator.generateReport(formattedResults, {
      format: this.options.reportFormat,
      includeBaseline: !this.options.updateBaseline
    });
    
    return reportPath;
  }

  /**
   * 結果の整形
   */
  formatResults() {
    const formatted = {
      metadata: {
        timestamp: this.results.timestamp,
        duration: this.results.duration,
        mode: this.options.quickMode ? 'quick' : 'full'
      }
    };
    
    // スループット結果の整形
    if (this.results.tests.throughput) {
      const throughput = this.results.tests.throughput;
      formatted.throughput = {
        issuesPerHour: throughput.throughput?.throughput?.perHour || 0,
        single: throughput.single?.statistics,
        concurrent: throughput.concurrent,
        agents: throughput.agents
      };
    }
    
    // レスポンスタイム結果の整形
    if (this.results.tests.responseTime) {
      formatted.responseTime = this.results.tests.responseTime;
    }
    
    // リソース使用量結果の整形
    if (this.results.tests.resourceUsage) {
      formatted.resourceUsage = this.results.tests.resourceUsage;
    }
    
    return formatted;
  }
}

/**
 * CLIエントリーポイント
 */
if (require.main === module) {
  const args = process.argv.slice(2);
  const options = {};
  
  // コマンドライン引数の解析
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--quick':
      case '-q':
        options.quickMode = true;
        break;
      case '--format':
      case '-f':
        options.reportFormat = args[++i] || 'html';
        break;
      case '--update-baseline':
      case '-u':
        options.updateBaseline = true;
        break;
      case '--skip-throughput':
        options.skipThroughput = true;
        break;
      case '--skip-response-time':
        options.skipResponseTime = true;
        break;
      case '--skip-resource-usage':
        options.skipResourceUsage = true;
        break;
      case '--help':
      case '-h':
        console.log(`
PoppoBuilder Suite パフォーマンステスト

使用方法:
  node test/performance/index.js [オプション]

オプション:
  -q, --quick              高速モード（テストを短縮）
  -f, --format <type>      レポート形式 (html|markdown|json) [デフォルト: html]
  -u, --update-baseline    ベースラインを更新
  --skip-throughput        スループットテストをスキップ
  --skip-response-time     レスポンスタイムテストをスキップ
  --skip-resource-usage    リソース使用量テストをスキップ
  -h, --help              ヘルプを表示

例:
  # フルテストを実行
  node test/performance/index.js

  # 高速モードでMarkdownレポート生成
  node test/performance/index.js --quick --format markdown

  # ベースラインを更新
  node test/performance/index.js --update-baseline
        `);
        process.exit(0);
    }
  }
  
  // テスト実行
  const runner = new PerformanceTestRunner(options);
  
  runner.runAll().then(result => {
    process.exit(result.success ? 0 : 1);
  }).catch(error => {
    console.error('予期しないエラー:', error);
    process.exit(1);
  });
}

module.exports = PerformanceTestRunner;