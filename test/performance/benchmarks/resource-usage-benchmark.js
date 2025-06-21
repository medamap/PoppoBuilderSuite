const MetricsCollector = require('../../../src/performance/collectors/metrics-collector');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

/**
 * リソース使用量ベンチマーク
 * CPU、メモリ、ディスクI/O、ネットワークの使用量を測定
 */
class ResourceUsageBenchmark {
  constructor() {
    this.processes = new Map();
    this.collector = null;
  }

  /**
   * PoppoBuilder Suiteプロセスの起動
   */
  async startPoppoBuilder(config = {}) {
    const scriptPath = path.join(__dirname, '..', '..', '..', 'src', 'minimal-poppo.js');
    
    const env = Object.assign({}, process.env, {
      POPPO_TEST_MODE: 'true',
      POPPO_LOG_LEVEL: 'error',
      ...config.env
    });
    
    const poppoProcess = spawn('node', [scriptPath], {
      env: env,
      cwd: path.join(__dirname, '..', '..', '..'),
      detached: false
    });
    
    this.processes.set('poppo-main', {
      process: poppoProcess,
      pid: poppoProcess.pid,
      startTime: Date.now()
    });
    
    // プロセスが安定するまで待機
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    return poppoProcess;
  }

  /**
   * アイドル時のリソース使用量測定
   */
  async measureIdleResources(duration = 60000) {
    console.log(`🎯 アイドル時リソース使用量測定（${duration/1000}秒間）...`);
    
    this.collector = new MetricsCollector({
      interval: 1000,
      collectSystemMetrics: true,
      collectProcessMetrics: true
    });
    
    // PoppoBuilder起動
    const poppoProcess = await this.startPoppoBuilder();
    
    // カスタムコレクター追加（プロセス別メトリクス）
    this.collector.addCollector('poppoProcess', async () => {
      return await this.getProcessMetrics(poppoProcess.pid);
    });
    
    this.collector.start();
    
    // 指定時間待機
    await new Promise(resolve => setTimeout(resolve, duration));
    
    this.collector.stop();
    
    const summary = this.collector.getSummary();
    const samples = this.collector.samples;
    
    // リソース使用量の統計
    const stats = this.calculateResourceStats(samples);
    
    console.log(this.formatResourceStats(stats, 'アイドル時'));
    
    // プロセス終了
    poppoProcess.kill();
    
    return {
      scenario: 'idle',
      duration: duration,
      stats: stats,
      summary: summary
    };
  }

  /**
   * 負荷時のリソース使用量測定
   */
  async measureLoadResources(issuesPerMinute, duration = 60000) {
    console.log(`🎯 負荷時リソース使用量測定（${issuesPerMinute} Issues/分、${duration/1000}秒間）...`);
    
    this.collector = new MetricsCollector({
      interval: 1000,
      collectSystemMetrics: true,
      collectProcessMetrics: true
    });
    
    // PoppoBuilder起動
    const poppoProcess = await this.startPoppoBuilder({
      env: {
        POPPO_SIMULATION_MODE: 'true',
        POPPO_SIMULATION_RATE: String(issuesPerMinute)
      }
    });
    
    // カスタムコレクター追加
    this.collector.addCollector('poppoProcess', async () => {
      return await this.getProcessMetrics(poppoProcess.pid);
    });
    
    this.collector.start();
    
    // 負荷生成
    const loadGenerator = this.startLoadGenerator(issuesPerMinute);
    
    // 指定時間待機
    await new Promise(resolve => setTimeout(resolve, duration));
    
    // 負荷生成停止
    clearInterval(loadGenerator);
    
    this.collector.stop();
    
    const summary = this.collector.getSummary();
    const samples = this.collector.samples;
    
    // リソース使用量の統計
    const stats = this.calculateResourceStats(samples);
    
    console.log(this.formatResourceStats(stats, `負荷時（${issuesPerMinute} Issues/分）`));
    
    // プロセス終了
    poppoProcess.kill();
    
    return {
      scenario: `load_${issuesPerMinute}`,
      duration: duration,
      issuesPerMinute: issuesPerMinute,
      stats: stats,
      summary: summary
    };
  }

  /**
   * 負荷生成器
   */
  startLoadGenerator(issuesPerMinute) {
    const interval = 60000 / issuesPerMinute;
    let issueCount = 0;
    
    return setInterval(() => {
      // Issue処理のシミュレーション
      this.collector.increment('issues_processed');
      issueCount++;
      
      if (issueCount % 10 === 0) {
        console.log(`  📊 処理済みIssue数: ${issueCount}`);
      }
    }, interval);
  }

  /**
   * プロセスメトリクスの取得
   */
  async getProcessMetrics(pid) {
    try {
      if (process.platform === 'darwin' || process.platform === 'linux') {
        const { execSync } = require('child_process');
        const psOutput = execSync(`ps -p ${pid} -o %cpu,%mem,rss,vsz`, { encoding: 'utf8' });
        const lines = psOutput.trim().split('\n');
        
        if (lines.length < 2) {
          return null;
        }
        
        const values = lines[1].trim().split(/\s+/);
        
        return {
          cpu: parseFloat(values[0]),
          memoryPercent: parseFloat(values[1]),
          rss: parseInt(values[2]) * 1024, // KB to bytes
          vsz: parseInt(values[3]) * 1024
        };
      }
    } catch (error) {
      return null;
    }
  }

  /**
   * リソース統計の計算
   */
  calculateResourceStats(samples) {
    const stats = {
      cpu: { system: [], process: [], poppo: [] },
      memory: { system: [], process: [], poppo: [] },
      disk: { usage: [] },
      samples: samples.length
    };
    
    samples.forEach(sample => {
      // システムCPU
      if (sample.system?.cpu?.usage) {
        stats.cpu.system.push(parseFloat(sample.system.cpu.usage));
      }
      
      // プロセスCPU
      if (sample.process?.cpu?.percent) {
        stats.cpu.process.push(parseFloat(sample.process.cpu.percent));
      }
      
      // PoppoプロセスCPU
      if (sample.poppoProcess?.cpu) {
        stats.cpu.poppo.push(sample.poppoProcess.cpu);
      }
      
      // システムメモリ
      if (sample.system?.memory?.usagePercent) {
        stats.memory.system.push(parseFloat(sample.system.memory.usagePercent));
      }
      
      // プロセスメモリ
      if (sample.process?.memory?.heapUsed) {
        stats.memory.process.push(sample.process.memory.heapUsed);
      }
      
      // Poppoプロセスメモリ
      if (sample.poppoProcess?.rss) {
        stats.memory.poppo.push(sample.poppoProcess.rss);
      }
      
      // ディスク使用量
      if (sample.system?.disk?.usagePercent) {
        stats.disk.usage.push(parseFloat(sample.system.disk.usagePercent));
      }
    });
    
    // 統計値を計算
    const result = {};
    
    for (const [category, data] of Object.entries(stats)) {
      if (category === 'samples') continue;
      
      result[category] = {};
      
      for (const [type, values] of Object.entries(data)) {
        if (values.length > 0) {
          result[category][type] = this.calculateStats(values);
        }
      }
    }
    
    result.samples = stats.samples;
    
    return result;
  }

  /**
   * 統計値の計算
   */
  calculateStats(values) {
    if (values.length === 0) return null;
    
    values.sort((a, b) => a - b);
    
    return {
      min: values[0],
      max: values[values.length - 1],
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)]
    };
  }

  /**
   * リソース統計のフォーマット
   */
  formatResourceStats(stats, scenario) {
    let output = `
📊 リソース使用量統計: ${scenario}
${'='.repeat(50)}
サンプル数: ${stats.samples}

CPU使用率 (%):`;
    
    if (stats.cpu?.system) {
      output += `
  システム全体:
    - 最小: ${stats.cpu.system.min.toFixed(2)}%
    - 最大: ${stats.cpu.system.max.toFixed(2)}%
    - 平均: ${stats.cpu.system.avg.toFixed(2)}%
    - P95: ${stats.cpu.system.p95.toFixed(2)}%`;
    }
    
    if (stats.cpu?.poppo) {
      output += `
  PoppoBuilderプロセス:
    - 最小: ${stats.cpu.poppo.min.toFixed(2)}%
    - 最大: ${stats.cpu.poppo.max.toFixed(2)}%
    - 平均: ${stats.cpu.poppo.avg.toFixed(2)}%
    - P95: ${stats.cpu.poppo.p95.toFixed(2)}%`;
    }
    
    output += `

メモリ使用量:`;
    
    if (stats.memory?.system) {
      output += `
  システム全体:
    - 最小: ${stats.memory.system.min.toFixed(2)}%
    - 最大: ${stats.memory.system.max.toFixed(2)}%
    - 平均: ${stats.memory.system.avg.toFixed(2)}%`;
    }
    
    if (stats.memory?.poppo) {
      output += `
  PoppoBuilderプロセス:
    - 最小: ${(stats.memory.poppo.min / 1024 / 1024).toFixed(2)} MB
    - 最大: ${(stats.memory.poppo.max / 1024 / 1024).toFixed(2)} MB
    - 平均: ${(stats.memory.poppo.avg / 1024 / 1024).toFixed(2)} MB`;
    }
    
    if (stats.disk?.usage) {
      output += `

ディスク使用率:
    - 最小: ${stats.disk.usage.min.toFixed(2)}%
    - 最大: ${stats.disk.usage.max.toFixed(2)}%
    - 平均: ${stats.disk.usage.avg.toFixed(2)}%`;
    }
    
    output += `
${'='.repeat(50)}`;
    
    return output;
  }

  /**
   * メモリリーク検出テスト
   */
  async detectMemoryLeak(duration = 300000) { // 5分
    console.log(`🎯 メモリリーク検出テスト（${duration/1000}秒間）...`);
    
    this.collector = new MetricsCollector({
      interval: 5000, // 5秒ごと
      collectSystemMetrics: false,
      collectProcessMetrics: true
    });
    
    const poppoProcess = await this.startPoppoBuilder();
    
    this.collector.addCollector('poppoProcess', async () => {
      return await this.getProcessMetrics(poppoProcess.pid);
    });
    
    this.collector.start();
    
    // 定期的に負荷をかける
    const loadInterval = setInterval(() => {
      // バースト的な負荷
      for (let i = 0; i < 100; i++) {
        this.collector.increment('burst_operations');
      }
    }, 10000); // 10秒ごと
    
    await new Promise(resolve => setTimeout(resolve, duration));
    
    clearInterval(loadInterval);
    this.collector.stop();
    
    // メモリ使用量の傾向を分析
    const memoryTrend = this.analyzeMemoryTrend(this.collector.samples);
    
    console.log(`
📊 メモリリーク分析結果
========================
測定期間: ${duration/1000}秒
サンプル数: ${this.collector.samples.length}

メモリ使用量の傾向:
- 開始時: ${(memoryTrend.start / 1024 / 1024).toFixed(2)} MB
- 終了時: ${(memoryTrend.end / 1024 / 1024).toFixed(2)} MB
- 増加量: ${(memoryTrend.increase / 1024 / 1024).toFixed(2)} MB
- 増加率: ${memoryTrend.increaseRate.toFixed(2)}%

リーク判定: ${memoryTrend.leakDetected ? '⚠️ 可能性あり' : '✅ 検出されず'}
${memoryTrend.leakDetected ? `理由: ${memoryTrend.leakReason}` : ''}
========================
`);
    
    poppoProcess.kill();
    
    return memoryTrend;
  }

  /**
   * メモリトレンドの分析
   */
  analyzeMemoryTrend(samples) {
    const memoryValues = samples
      .filter(s => s.process?.memory?.heapUsed)
      .map(s => ({
        time: s.timestamp,
        memory: s.process.memory.heapUsed
      }));
    
    if (memoryValues.length < 10) {
      return { error: 'サンプル数が不足しています' };
    }
    
    const start = memoryValues[0].memory;
    const end = memoryValues[memoryValues.length - 1].memory;
    const increase = end - start;
    const increaseRate = (increase / start) * 100;
    
    // 線形回帰で傾向を分析
    const regression = this.linearRegression(
      memoryValues.map((v, i) => i),
      memoryValues.map(v => v.memory)
    );
    
    // リーク判定基準
    let leakDetected = false;
    let leakReason = '';
    
    if (increaseRate > 50) {
      leakDetected = true;
      leakReason = 'メモリ使用量が50%以上増加';
    } else if (regression.slope > 1000000) { // 1MB/サンプル以上の増加
      leakDetected = true;
      leakReason = '継続的なメモリ増加傾向';
    }
    
    return {
      start: start,
      end: end,
      increase: increase,
      increaseRate: increaseRate,
      slope: regression.slope,
      r2: regression.r2,
      leakDetected: leakDetected,
      leakReason: leakReason
    };
  }

  /**
   * 線形回帰
   */
  linearRegression(x, y) {
    const n = x.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
    
    for (let i = 0; i < n; i++) {
      sumX += x[i];
      sumY += y[i];
      sumXY += x[i] * y[i];
      sumX2 += x[i] * x[i];
      sumY2 += y[i] * y[i];
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    // 決定係数
    const yMean = sumY / n;
    let ssTotal = 0, ssResidual = 0;
    
    for (let i = 0; i < n; i++) {
      const yPred = slope * x[i] + intercept;
      ssTotal += (y[i] - yMean) ** 2;
      ssResidual += (y[i] - yPred) ** 2;
    }
    
    const r2 = 1 - (ssResidual / ssTotal);
    
    return { slope, intercept, r2 };
  }

  /**
   * 結果の保存
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
  const benchmark = new ResourceUsageBenchmark();
  
  (async () => {
    try {
      console.log('🚀 PoppoBuilder Suite リソース使用量ベンチマーク');
      console.log('='.repeat(50));
      
      const results = {
        timestamp: new Date().toISOString(),
        benchmarks: {}
      };
      
      // 1. アイドル時のリソース使用量（30秒）
      results.benchmarks.idle = await benchmark.measureIdleResources(30000);
      
      // 2. 通常負荷時（10 Issues/分、30秒）
      results.benchmarks.normalLoad = await benchmark.measureLoadResources(10, 30000);
      
      // 3. 高負荷時（100 Issues/分、30秒）
      results.benchmarks.highLoad = await benchmark.measureLoadResources(100, 30000);
      
      // 4. メモリリーク検出（2分）
      results.benchmarks.memoryLeak = await benchmark.detectMemoryLeak(120000);
      
      // 結果の保存
      const filename = `resource-usage-${Date.now()}.json`;
      await benchmark.saveResults(results, filename);
      
      console.log('\n✅ すべてのベンチマークが完了しました');
      
      // すべてのプロセスを確実に終了
      for (const [name, info] of benchmark.processes) {
        try {
          info.process.kill();
        } catch (e) {}
      }
      
    } catch (error) {
      console.error('❌ ベンチマークエラー:', error);
      process.exit(1);
    }
  })();
}

module.exports = ResourceUsageBenchmark;