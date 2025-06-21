const { performance } = require('perf_hooks');
const os = require('os');
const v8 = require('v8');

/**
 * カスタムベンチマークランナー
 * PoppoBuilder Suite用の高精度パフォーマンス測定ツール
 */
class BenchmarkRunner {
  constructor(options = {}) {
    this.name = options.name || 'Unnamed Benchmark';
    this.iterations = options.iterations || 100;
    this.warmup = options.warmup || 10;
    this.concurrent = options.concurrent || 1;
    this.timeout = options.timeout || 60000; // 60秒
    this.collectSystemMetrics = options.collectSystemMetrics !== false;
    
    this.results = {
      name: this.name,
      timestamp: new Date().toISOString(),
      config: {
        iterations: this.iterations,
        warmup: this.warmup,
        concurrent: this.concurrent
      },
      timings: [],
      memory: [],
      errors: [],
      systemMetrics: {
        before: null,
        after: null
      }
    };
  }

  /**
   * ベンチマークの実行
   * @param {Function} fn - 測定対象の関数
   * @param {Object} context - 関数実行時のコンテキスト
   * @returns {Object} ベンチマーク結果
   */
  async run(fn, context = {}) {
    console.log(`🚀 ベンチマーク開始: ${this.name}`);
    
    try {
      // システムメトリクスの初期状態を記録
      if (this.collectSystemMetrics) {
        this.results.systemMetrics.before = this.getSystemMetrics();
      }

      // ウォームアップ実行
      console.log(`⏳ ウォームアップ中... (${this.warmup}回)`);
      await this.warmupPhase(fn, context);

      // 本番実行
      console.log(`📊 計測開始... (${this.iterations}回, 並行度: ${this.concurrent})`);
      await this.measurementPhase(fn, context);

      // システムメトリクスの最終状態を記録
      if (this.collectSystemMetrics) {
        this.results.systemMetrics.after = this.getSystemMetrics();
      }

      // 統計計算
      this.calculateStatistics();

      console.log(`✅ ベンチマーク完了: ${this.name}`);
      return this.results;

    } catch (error) {
      console.error(`❌ ベンチマークエラー: ${error.message}`);
      this.results.errors.push({
        message: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString()
      });
      return this.results;
    }
  }

  /**
   * ウォームアップフェーズ
   */
  async warmupPhase(fn, context) {
    for (let i = 0; i < this.warmup; i++) {
      try {
        await this.executeWithTimeout(fn, context);
      } catch (error) {
        // ウォームアップ中のエラーは記録のみ
        console.warn(`ウォームアップエラー: ${error.message}`);
      }
    }
    
    // GCを強制実行してクリーンな状態にする
    if (global.gc) {
      global.gc();
    }
  }

  /**
   * 計測フェーズ
   */
  async measurementPhase(fn, context) {
    const batchSize = Math.min(this.concurrent, this.iterations);
    const batches = Math.ceil(this.iterations / batchSize);

    for (let batch = 0; batch < batches; batch++) {
      const promises = [];
      const remainingIterations = Math.min(
        batchSize,
        this.iterations - batch * batchSize
      );

      for (let i = 0; i < remainingIterations; i++) {
        promises.push(this.measureSingleExecution(fn, context));
      }

      await Promise.all(promises);
      
      // バッチ間でGCを実行（メモリプレッシャーを軽減）
      if (global.gc && batch < batches - 1) {
        global.gc();
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * 単一実行の計測
   */
  async measureSingleExecution(fn, context) {
    const memBefore = process.memoryUsage();
    const startTime = performance.now();
    const startCpu = process.cpuUsage();

    try {
      const result = await this.executeWithTimeout(fn, context);
      
      const endTime = performance.now();
      const endCpu = process.cpuUsage(startCpu);
      const memAfter = process.memoryUsage();

      this.results.timings.push({
        duration: endTime - startTime,
        cpu: {
          user: endCpu.user / 1000, // マイクロ秒をミリ秒に変換
          system: endCpu.system / 1000
        },
        timestamp: new Date().toISOString(),
        success: true,
        result: result
      });

      this.results.memory.push({
        heapUsed: memAfter.heapUsed - memBefore.heapUsed,
        heapTotal: memAfter.heapTotal - memBefore.heapTotal,
        external: memAfter.external - memBefore.external,
        rss: memAfter.rss - memBefore.rss
      });

    } catch (error) {
      const endTime = performance.now();
      
      this.results.timings.push({
        duration: endTime - startTime,
        timestamp: new Date().toISOString(),
        success: false,
        error: error.message
      });

      this.results.errors.push({
        message: error.message,
        iteration: this.results.timings.length,
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * タイムアウト付き関数実行
   */
  async executeWithTimeout(fn, context) {
    return Promise.race([
      fn(context),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('実行タイムアウト')), this.timeout)
      )
    ]);
  }

  /**
   * システムメトリクスの取得
   */
  getSystemMetrics() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    return {
      timestamp: new Date().toISOString(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpu: {
        model: cpus[0].model,
        count: cpus.length,
        speed: cpus[0].speed,
        usage: this.calculateCpuUsage(cpus)
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usage: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
      },
      loadAverage: {
        '1min': loadAvg[0],
        '5min': loadAvg[1],
        '15min': loadAvg[2]
      },
      heap: v8.getHeapStatistics()
    };
  }

  /**
   * CPU使用率の計算
   */
  calculateCpuUsage(cpus) {
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    return ((1 - totalIdle / totalTick) * 100).toFixed(2);
  }

  /**
   * 統計情報の計算
   */
  calculateStatistics() {
    const successfulTimings = this.results.timings
      .filter(t => t.success)
      .map(t => t.duration);

    if (successfulTimings.length === 0) {
      this.results.statistics = {
        success: false,
        message: 'すべての実行が失敗しました'
      };
      return;
    }

    // ソート（統計計算用）
    successfulTimings.sort((a, b) => a - b);

    // 基本統計
    const sum = successfulTimings.reduce((a, b) => a + b, 0);
    const mean = sum / successfulTimings.length;
    
    // 分散と標準偏差
    const variance = successfulTimings.reduce((acc, val) => {
      return acc + Math.pow(val - mean, 2);
    }, 0) / successfulTimings.length;
    const stdDev = Math.sqrt(variance);

    // パーセンタイル計算
    const percentile = (p) => {
      const index = Math.ceil(successfulTimings.length * p) - 1;
      return successfulTimings[Math.max(0, index)];
    };

    // スループット計算（実行/秒）
    const totalDuration = this.results.timings[this.results.timings.length - 1].timestamp - 
                         this.results.timings[0].timestamp;
    const throughput = successfulTimings.length / (new Date(totalDuration).getTime() / 1000);

    this.results.statistics = {
      count: successfulTimings.length,
      successful: successfulTimings.length,
      failed: this.results.timings.length - successfulTimings.length,
      successRate: (successfulTimings.length / this.results.timings.length * 100).toFixed(2),
      timing: {
        min: Math.min(...successfulTimings),
        max: Math.max(...successfulTimings),
        mean: mean,
        median: percentile(0.5),
        stdDev: stdDev,
        variance: variance,
        percentiles: {
          p50: percentile(0.5),
          p75: percentile(0.75),
          p90: percentile(0.9),
          p95: percentile(0.95),
          p99: percentile(0.99)
        }
      },
      throughput: {
        opsPerSecond: throughput,
        msPerOp: mean
      },
      memory: this.calculateMemoryStats()
    };
  }

  /**
   * メモリ統計の計算
   */
  calculateMemoryStats() {
    if (this.results.memory.length === 0) {
      return null;
    }

    const heapUsed = this.results.memory.map(m => m.heapUsed);
    const avgHeapUsed = heapUsed.reduce((a, b) => a + b, 0) / heapUsed.length;
    
    return {
      avgHeapUsed: avgHeapUsed,
      maxHeapUsed: Math.max(...heapUsed),
      minHeapUsed: Math.min(...heapUsed)
    };
  }

  /**
   * 結果のフォーマット済み出力
   */
  formatResults() {
    const stats = this.results.statistics;
    if (!stats || !stats.success) {
      return `❌ ベンチマーク失敗: ${stats?.message || '不明なエラー'}`;
    }

    return `
📊 ベンチマーク結果: ${this.name}
${'='.repeat(50)}

実行統計:
  - 成功: ${stats.successful}/${stats.count} (${stats.successRate}%)
  - エラー: ${stats.failed}

実行時間 (ms):
  - 最小: ${stats.timing.min.toFixed(2)}
  - 最大: ${stats.timing.max.toFixed(2)}
  - 平均: ${stats.timing.mean.toFixed(2)}
  - 中央値: ${stats.timing.median.toFixed(2)}
  - 標準偏差: ${stats.timing.stdDev.toFixed(2)}

パーセンタイル (ms):
  - P50: ${stats.timing.percentiles.p50.toFixed(2)}
  - P75: ${stats.timing.percentiles.p75.toFixed(2)}
  - P90: ${stats.timing.percentiles.p90.toFixed(2)}
  - P95: ${stats.timing.percentiles.p95.toFixed(2)}
  - P99: ${stats.timing.percentiles.p99.toFixed(2)}

スループット:
  - ${stats.throughput.opsPerSecond.toFixed(2)} ops/sec
  - ${stats.throughput.msPerOp.toFixed(2)} ms/op

${stats.memory ? `
メモリ使用量:
  - 平均: ${(stats.memory.avgHeapUsed / 1024 / 1024).toFixed(2)} MB
  - 最大: ${(stats.memory.maxHeapUsed / 1024 / 1024).toFixed(2)} MB
` : ''}
${'='.repeat(50)}
`;
  }
}

module.exports = BenchmarkRunner;