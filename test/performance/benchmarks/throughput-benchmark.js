const BenchmarkRunner = require('../../../src/performance/benchmark-runner');
const MetricsCollector = require('../../../src/performance/collectors/metrics-collector');
const path = require('path');
const fs = require('fs').promises;

/**
 * スループットベンチマーク
 * PoppoBuilder Suiteの処理能力を測定
 */
class ThroughputBenchmark {
  constructor() {
    this.mockIssues = [];
    this.mockApiResponses = new Map();
    this.processedCount = 0;
    this.startTime = null;
  }

  /**
   * モックIssueの生成
   */
  generateMockIssues(count) {
    const issues = [];
    for (let i = 1; i <= count; i++) {
      issues.push({
        number: i,
        title: `テストIssue #${i}`,
        body: `これはパフォーマンステスト用のモックIssueです。\n\n## 詳細\nIssue番号: ${i}\n生成時刻: ${new Date().toISOString()}`,
        labels: ['task:test', 'performance-test'],
        state: 'open',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        comments: Math.floor(Math.random() * 5),
        user: {
          login: 'test-user'
        }
      });
    }
    return issues;
  }

  /**
   * Issue処理のシミュレーション
   */
  async simulateIssueProcessing(issue) {
    // GitHub API呼び出しのシミュレーション（10-50ms）
    await this.simulateApiCall(10, 50);
    
    // Claude API呼び出しのシミュレーション（100-500ms）
    await this.simulateApiCall(100, 500);
    
    // ファイル操作のシミュレーション（5-20ms）
    await this.simulateFileOperation();
    
    // データベース操作のシミュレーション（5-15ms）
    await this.simulateDatabaseOperation();
    
    this.processedCount++;
    
    return {
      issueNumber: issue.number,
      processingTime: Date.now() - this.startTime,
      success: true
    };
  }

  /**
   * API呼び出しのシミュレーション
   */
  async simulateApiCall(minMs, maxMs) {
    const delay = Math.random() * (maxMs - minMs) + minMs;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * ファイル操作のシミュレーション
   */
  async simulateFileOperation() {
    const delay = Math.random() * 15 + 5;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * データベース操作のシミュレーション
   */
  async simulateDatabaseOperation() {
    const delay = Math.random() * 10 + 5;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  /**
   * 単一Issue処理のベンチマーク
   */
  async runSingleIssueBenchmark() {
    console.log('🎯 単一Issue処理ベンチマークを開始...');
    
    const benchmark = new BenchmarkRunner({
      name: '単一Issue処理',
      iterations: 100,
      warmup: 10
    });

    const mockIssue = this.generateMockIssues(1)[0];
    
    const results = await benchmark.run(async () => {
      await this.simulateIssueProcessing(mockIssue);
    });

    console.log(benchmark.formatResults());
    return results;
  }

  /**
   * 並行処理ベンチマーク
   */
  async runConcurrentBenchmark(concurrency) {
    console.log(`🎯 並行処理ベンチマークを開始（並行度: ${concurrency}）...`);
    
    const benchmark = new BenchmarkRunner({
      name: `並行処理（${concurrency}並行）`,
      iterations: 100,
      warmup: 5,
      concurrent: concurrency
    });

    const mockIssues = this.generateMockIssues(100);
    let issueIndex = 0;
    
    const results = await benchmark.run(async () => {
      const issue = mockIssues[issueIndex % mockIssues.length];
      issueIndex++;
      await this.simulateIssueProcessing(issue);
    });

    console.log(benchmark.formatResults());
    return results;
  }

  /**
   * スループット計測（Issues/hour）
   */
  async measureThroughput(duration = 60000) { // デフォルト1分
    console.log(`🎯 スループット計測を開始（${duration/1000}秒間）...`);
    
    const collector = new MetricsCollector({
      interval: 1000 // 1秒ごとに収集
    });
    
    collector.start();
    this.processedCount = 0;
    this.startTime = Date.now();
    
    const mockIssues = this.generateMockIssues(10000); // 十分な数を用意
    const concurrency = 10; // 同時実行数
    
    const endTime = Date.now() + duration;
    const promises = [];
    
    // 並行処理でIssueを処理
    for (let i = 0; i < concurrency; i++) {
      promises.push(this.processIssuesUntil(mockIssues, endTime));
    }
    
    await Promise.all(promises);
    
    collector.stop();
    
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const issuesPerSecond = this.processedCount / elapsedSeconds;
    const issuesPerHour = issuesPerSecond * 3600;
    
    const summary = collector.getSummary();
    
    console.log(`
📊 スループット測定結果
========================
処理済みIssue数: ${this.processedCount}
経過時間: ${elapsedSeconds.toFixed(2)}秒
スループット: ${issuesPerSecond.toFixed(2)} Issues/秒
推定スループット: ${issuesPerHour.toFixed(0)} Issues/時間

システムメトリクス:
- CPU使用率: ${summary.cpu ? `${summary.cpu.avg}%` : 'N/A'}
- メモリ使用量: ${summary.memory ? `${(summary.memory.avg / 1024 / 1024).toFixed(2)}MB` : 'N/A'}
========================
`);
    
    return {
      processedCount: this.processedCount,
      duration: elapsedSeconds,
      throughput: {
        perSecond: issuesPerSecond,
        perHour: issuesPerHour
      },
      metrics: summary
    };
  }

  /**
   * 指定時刻までIssueを処理
   */
  async processIssuesUntil(issues, endTime) {
    let index = 0;
    
    while (Date.now() < endTime) {
      const issue = issues[index % issues.length];
      try {
        await this.simulateIssueProcessing(issue);
      } catch (error) {
        console.error(`Issue処理エラー: ${error.message}`);
      }
      index++;
    }
  }

  /**
   * 各エージェントの処理速度測定
   */
  async runAgentBenchmarks() {
    console.log('🎯 エージェント別ベンチマークを開始...');
    
    const agents = [
      { name: 'PoppoBuilder', avgProcessingTime: 200 },
      { name: 'CCLA', avgProcessingTime: 150 },
      { name: 'CCQA', avgProcessingTime: 300 },
      { name: 'CCAG', avgProcessingTime: 250 },
      { name: 'CCPM', avgProcessingTime: 180 }
    ];
    
    const results = {};
    
    for (const agent of agents) {
      const benchmark = new BenchmarkRunner({
        name: `${agent.name}エージェント処理`,
        iterations: 50,
        warmup: 5
      });
      
      const agentResults = await benchmark.run(async () => {
        // エージェント特有の処理をシミュレーション
        const variance = agent.avgProcessingTime * 0.2; // 20%の変動
        const processingTime = agent.avgProcessingTime + (Math.random() - 0.5) * variance;
        await new Promise(resolve => setTimeout(resolve, processingTime));
      });
      
      results[agent.name] = agentResults;
      console.log(benchmark.formatResults());
    }
    
    return results;
  }

  /**
   * ベンチマーク結果の保存
   */
  async saveResults(results, filename) {
    const reportDir = path.join(__dirname, '..', 'reports');
    await fs.mkdir(reportDir, { recursive: true });
    
    const filepath = path.join(reportDir, filename);
    await fs.writeFile(filepath, JSON.stringify(results, null, 2));
    
    console.log(`📁 結果を保存しました: ${filepath}`);
  }
}

// スタンドアロン実行
if (require.main === module) {
  const benchmark = new ThroughputBenchmark();
  
  (async () => {
    try {
      console.log('🚀 PoppoBuilder Suite スループットベンチマーク');
      console.log('='.repeat(50));
      
      const results = {
        timestamp: new Date().toISOString(),
        benchmarks: {}
      };
      
      // 1. 単一Issue処理
      results.benchmarks.single = await benchmark.runSingleIssueBenchmark();
      
      // 2. 並行処理（様々な並行度）
      const concurrencies = [1, 5, 10, 20, 50];
      results.benchmarks.concurrent = {};
      
      for (const c of concurrencies) {
        results.benchmarks.concurrent[`concurrent_${c}`] = await benchmark.runConcurrentBenchmark(c);
      }
      
      // 3. スループット測定（30秒）
      results.benchmarks.throughput = await benchmark.measureThroughput(30000);
      
      // 4. エージェント別ベンチマーク
      results.benchmarks.agents = await benchmark.runAgentBenchmarks();
      
      // 結果の保存
      const filename = `throughput-${Date.now()}.json`;
      await benchmark.saveResults(results, filename);
      
      console.log('\n✅ すべてのベンチマークが完了しました');
      
    } catch (error) {
      console.error('❌ ベンチマークエラー:', error);
      process.exit(1);
    }
  })();
}

module.exports = ThroughputBenchmark;