/**
 * Performance Benchmark Runner
 * 
 * Comprehensive benchmarking system for PoppoBuilder daemon performance
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');
const { performance } = require('perf_hooks');

class BenchmarkRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      outputDir: options.outputDir || './benchmark-results',
      iterations: options.iterations || 10,
      warmupRounds: options.warmupRounds || 3,
      concurrency: options.concurrency || 1,
      timeout: options.timeout || 30000,
      collectSystemMetrics: options.collectSystemMetrics !== false,
      generateReport: options.generateReport !== false,
      ...options
    };
    
    this.benchmarks = new Map();
    this.results = [];
    this.systemMetrics = [];
    this.isRunning = false;
  }

  /**
   * Register a benchmark
   */
  registerBenchmark(name, benchmarkFn, options = {}) {
    if (typeof benchmarkFn !== 'function') {
      throw new Error('Benchmark function must be a function');
    }

    this.benchmarks.set(name, {
      name,
      fn: benchmarkFn,
      options: {
        iterations: this.options.iterations,
        warmupRounds: this.options.warmupRounds,
        timeout: this.options.timeout,
        concurrent: false,
        ...options
      }
    });

    this.emit('benchmark-registered', { name, options });
  }

  /**
   * Run all registered benchmarks
   */
  async runAll() {
    if (this.isRunning) {
      throw new Error('Benchmarks are already running');
    }

    this.isRunning = true;
    this.results = [];
    this.systemMetrics = [];

    try {
      console.log('🚀 Starting PoppoBuilder Performance Benchmarks');
      console.log(`   Iterations: ${this.options.iterations}`);
      console.log(`   Warmup rounds: ${this.options.warmupRounds}`);
      console.log(`   Concurrency: ${this.options.concurrency}`);
      console.log();

      // System info
      const systemInfo = await this.getSystemInfo();
      console.log('💻 System Information:');
      console.log(`   OS: ${systemInfo.platform} ${systemInfo.release}`);
      console.log(`   CPU: ${systemInfo.cpu.model} (${systemInfo.cpu.cores} cores)`);
      console.log(`   Memory: ${Math.round(systemInfo.memory.total / 1024 / 1024 / 1024)}GB`);
      console.log(`   Node.js: ${systemInfo.nodeVersion}`);
      console.log();

      // Start system monitoring
      if (this.options.collectSystemMetrics) {
        this.startSystemMonitoring();
      }

      // Run benchmarks
      for (const [name, benchmark] of this.benchmarks) {
        await this.runBenchmark(benchmark);
      }

      // Stop system monitoring
      if (this.options.collectSystemMetrics) {
        this.stopSystemMonitoring();
      }

      // Generate report
      if (this.options.generateReport) {
        await this.generateReport();
      }

      this.emit('all-complete', this.results);
      return this.results;

    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Run a specific benchmark
   */
  async runBenchmark(benchmark) {
    console.log(`🔄 Running benchmark: ${benchmark.name}`);
    
    const result = {
      name: benchmark.name,
      timestamp: new Date().toISOString(),
      systemInfo: await this.getSystemInfo(),
      options: benchmark.options,
      warmup: {},
      measurements: [],
      statistics: {},
      errors: []
    };

    try {
      // Warmup rounds
      if (benchmark.options.warmupRounds > 0) {
        console.log(`   Warming up (${benchmark.options.warmupRounds} rounds)...`);
        const warmupStart = performance.now();
        
        for (let i = 0; i < benchmark.options.warmupRounds; i++) {
          try {
            await this.executeBenchmark(benchmark.fn, benchmark.options);
          } catch (error) {
            console.warn(`   Warmup round ${i + 1} failed: ${error.message}`);
          }
        }
        
        result.warmup = {
          rounds: benchmark.options.warmupRounds,
          duration: performance.now() - warmupStart
        };
      }

      // Actual benchmark runs
      console.log(`   Running ${benchmark.options.iterations} iterations...`);
      
      for (let i = 0; i < benchmark.options.iterations; i++) {
        try {
          const measurement = await this.executeBenchmark(benchmark.fn, benchmark.options);
          result.measurements.push({
            iteration: i + 1,
            ...measurement
          });
          
          // Progress indicator
          if ((i + 1) % Math.max(1, Math.floor(benchmark.options.iterations / 10)) === 0) {
            console.log(`   Progress: ${i + 1}/${benchmark.options.iterations}`);
          }
          
        } catch (error) {
          result.errors.push({
            iteration: i + 1,
            error: error.message,
            timestamp: new Date().toISOString()
          });
        }
      }

      // Calculate statistics
      result.statistics = this.calculateStatistics(result.measurements);
      
      // Display results
      this.displayBenchmarkResults(result);
      
      this.results.push(result);
      this.emit('benchmark-complete', result);

    } catch (error) {
      console.error(`   Failed: ${error.message}`);
      result.fatalError = error.message;
      this.results.push(result);
    }
  }

  /**
   * Execute a single benchmark iteration
   */
  async executeBenchmark(benchmarkFn, options) {
    const measurement = {
      startTime: performance.now(),
      memoryBefore: process.memoryUsage(),
      cpuBefore: process.cpuUsage()
    };

    // Execute with timeout
    const result = await Promise.race([
      benchmarkFn(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Benchmark timeout')), options.timeout)
      )
    ]);

    measurement.endTime = performance.now();
    measurement.duration = measurement.endTime - measurement.startTime;
    measurement.memoryAfter = process.memoryUsage();
    measurement.cpuAfter = process.cpuUsage(measurement.cpuBefore);
    measurement.result = result;

    // Calculate derived metrics
    measurement.memoryDelta = {
      heapUsed: measurement.memoryAfter.heapUsed - measurement.memoryBefore.heapUsed,
      heapTotal: measurement.memoryAfter.heapTotal - measurement.memoryBefore.heapTotal,
      external: measurement.memoryAfter.external - measurement.memoryBefore.external,
      rss: measurement.memoryAfter.rss - measurement.memoryBefore.rss
    };

    return measurement;
  }

  /**
   * Calculate statistics from measurements
   */
  calculateStatistics(measurements) {
    if (measurements.length === 0) {
      return {};
    }

    const durations = measurements.map(m => m.duration);
    const memoryDeltas = measurements.map(m => m.memoryDelta.heapUsed);
    
    const stats = {
      count: measurements.length,
      duration: this.calculateStats(durations),
      memoryDelta: this.calculateStats(memoryDeltas),
      throughput: {
        operationsPerSecond: measurements.length / (durations.reduce((a, b) => a + b, 0) / 1000),
        averageLatency: durations.reduce((a, b) => a + b, 0) / durations.length
      }
    };

    // Percentiles for duration
    const sortedDurations = durations.slice().sort((a, b) => a - b);
    stats.duration.percentiles = {
      p50: this.percentile(sortedDurations, 50),
      p75: this.percentile(sortedDurations, 75),
      p90: this.percentile(sortedDurations, 90),
      p95: this.percentile(sortedDurations, 95),
      p99: this.percentile(sortedDurations, 99)
    };

    return stats;
  }

  /**
   * Calculate basic statistics
   */
  calculateStats(values) {
    if (values.length === 0) return {};

    const sum = values.reduce((a, b) => a + b, 0);
    const mean = sum / values.length;
    const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
    
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      mean,
      median: this.percentile(values.slice().sort((a, b) => a - b), 50),
      stdDev: Math.sqrt(variance),
      sum
    };
  }

  /**
   * Calculate percentile
   */
  percentile(sortedValues, p) {
    const index = (p / 100) * (sortedValues.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index % 1;

    if (upper >= sortedValues.length) return sortedValues[sortedValues.length - 1];
    return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
  }

  /**
   * Display benchmark results
   */
  displayBenchmarkResults(result) {
    console.log(`\n📊 Results for ${result.name}:`);
    
    if (result.statistics.duration) {
      const duration = result.statistics.duration;
      console.log(`   Duration: ${duration.mean.toFixed(2)}ms ±${duration.stdDev.toFixed(2)}ms`);
      console.log(`   Min/Max: ${duration.min.toFixed(2)}ms / ${duration.max.toFixed(2)}ms`);
      
      if (duration.percentiles) {
        console.log(`   Percentiles: P50=${duration.percentiles.p50.toFixed(2)}ms P95=${duration.percentiles.p95.toFixed(2)}ms P99=${duration.percentiles.p99.toFixed(2)}ms`);
      }
    }

    if (result.statistics.throughput) {
      const throughput = result.statistics.throughput;
      console.log(`   Throughput: ${throughput.operationsPerSecond.toFixed(2)} ops/sec`);
    }

    if (result.statistics.memoryDelta) {
      const memory = result.statistics.memoryDelta;
      console.log(`   Memory: ${(memory.mean / 1024 / 1024).toFixed(2)}MB avg delta`);
    }

    if (result.errors.length > 0) {
      console.log(`   Errors: ${result.errors.length}/${result.options.iterations}`);
    }
  }

  /**
   * Start system monitoring
   */
  startSystemMonitoring() {
    this.systemMonitorInterval = setInterval(async () => {
      const metrics = {
        timestamp: Date.now(),
        cpu: process.cpuUsage(),
        memory: process.memoryUsage(),
        system: {
          loadavg: os.loadavg(),
          freemem: os.freemem(),
          totalmem: os.totalmem()
        }
      };

      this.systemMetrics.push(metrics);
    }, 1000); // Every second
  }

  /**
   * Stop system monitoring
   */
  stopSystemMonitoring() {
    if (this.systemMonitorInterval) {
      clearInterval(this.systemMonitorInterval);
      this.systemMonitorInterval = null;
    }
  }

  /**
   * Get system information
   */
  async getSystemInfo() {
    const cpus = os.cpus();
    
    return {
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      nodeVersion: process.version,
      cpu: {
        model: cpus[0]?.model || 'Unknown',
        cores: cpus.length,
        speed: cpus[0]?.speed || 0
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem()
      },
      hostname: os.hostname()
    };
  }

  /**
   * Generate comprehensive report
   */
  async generateReport() {
    await fs.mkdir(this.options.outputDir, { recursive: true });

    const reportData = {
      metadata: {
        timestamp: new Date().toISOString(),
        version: require('../../package.json').version,
        systemInfo: await this.getSystemInfo(),
        options: this.options
      },
      results: this.results,
      systemMetrics: this.systemMetrics,
      summary: this.generateSummary()
    };

    // Save JSON report
    const jsonFile = path.join(this.options.outputDir, `benchmark-${Date.now()}.json`);
    await fs.writeFile(jsonFile, JSON.stringify(reportData, null, 2));

    // Generate HTML report
    const htmlFile = path.join(this.options.outputDir, `benchmark-${Date.now()}.html`);
    await this.generateHTMLReport(reportData, htmlFile);

    // Generate CSV summary
    const csvFile = path.join(this.options.outputDir, `benchmark-${Date.now()}.csv`);
    await this.generateCSVReport(reportData, csvFile);

    console.log(`\n📋 Reports generated:`);
    console.log(`   JSON: ${jsonFile}`);
    console.log(`   HTML: ${htmlFile}`);
    console.log(`   CSV: ${csvFile}`);

    return {
      json: jsonFile,
      html: htmlFile,
      csv: csvFile,
      data: reportData
    };
  }

  /**
   * Generate summary statistics
   */
  generateSummary() {
    const summary = {
      totalBenchmarks: this.results.length,
      totalIterations: this.results.reduce((sum, r) => sum + r.measurements.length, 0),
      totalErrors: this.results.reduce((sum, r) => sum + r.errors.length, 0),
      averagePerformance: {},
      recommendations: []
    };

    // Calculate average performance across all benchmarks
    const allDurations = this.results.flatMap(r => r.measurements.map(m => m.duration));
    if (allDurations.length > 0) {
      summary.averagePerformance = this.calculateStats(allDurations);
    }

    // Generate recommendations
    this.results.forEach(result => {
      if (result.statistics.duration) {
        const avgDuration = result.statistics.duration.mean;
        const stdDev = result.statistics.duration.stdDev;
        
        if (stdDev / avgDuration > 0.3) {
          summary.recommendations.push({
            type: 'performance',
            benchmark: result.name,
            issue: 'High variability in performance',
            suggestion: 'Consider optimizing for more consistent performance'
          });
        }

        if (avgDuration > 1000) {
          summary.recommendations.push({
            type: 'performance',
            benchmark: result.name,
            issue: 'Slow average performance',
            suggestion: 'Investigate performance bottlenecks'
          });
        }
      }

      if (result.errors.length / result.options.iterations > 0.05) {
        summary.recommendations.push({
          type: 'reliability',
          benchmark: result.name,
          issue: 'High error rate',
          suggestion: 'Investigate and fix reliability issues'
        });
      }
    });

    return summary;
  }

  /**
   * Generate HTML report
   */
  async generateHTMLReport(reportData, outputFile) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>PoppoBuilder Performance Benchmark Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f0f0f0; padding: 20px; margin-bottom: 20px; }
        .benchmark { border: 1px solid #ddd; margin: 10px 0; padding: 15px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
        .stat { background: #f9f9f9; padding: 10px; border-radius: 4px; }
        .chart { width: 100%; height: 300px; margin: 10px 0; }
        table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        .error { color: red; }
        .success { color: green; }
    </style>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body>
    <div class="header">
        <h1>PoppoBuilder Performance Benchmark Report</h1>
        <p>Generated: ${reportData.metadata.timestamp}</p>
        <p>System: ${reportData.metadata.systemInfo.platform} ${reportData.metadata.systemInfo.arch}</p>
        <p>CPU: ${reportData.metadata.systemInfo.cpu.model} (${reportData.metadata.systemInfo.cpu.cores} cores)</p>
        <p>Memory: ${Math.round(reportData.metadata.systemInfo.memory.total / 1024 / 1024 / 1024)}GB</p>
    </div>

    <div class="summary">
        <h2>Summary</h2>
        <div class="stats">
            <div class="stat">
                <strong>Total Benchmarks:</strong> ${reportData.summary.totalBenchmarks}
            </div>
            <div class="stat">
                <strong>Total Iterations:</strong> ${reportData.summary.totalIterations}
            </div>
            <div class="stat">
                <strong>Total Errors:</strong> ${reportData.summary.totalErrors}
            </div>
            <div class="stat">
                <strong>Success Rate:</strong> ${((reportData.summary.totalIterations - reportData.summary.totalErrors) / reportData.summary.totalIterations * 100).toFixed(2)}%
            </div>
        </div>
    </div>

    ${reportData.results.map(result => `
    <div class="benchmark">
        <h3>${result.name}</h3>
        <div class="stats">
            <div class="stat">
                <strong>Average Duration:</strong> ${result.statistics.duration?.mean?.toFixed(2) || 'N/A'}ms
            </div>
            <div class="stat">
                <strong>Min/Max:</strong> ${result.statistics.duration?.min?.toFixed(2) || 'N/A'}ms / ${result.statistics.duration?.max?.toFixed(2) || 'N/A'}ms
            </div>
            <div class="stat">
                <strong>Throughput:</strong> ${result.statistics.throughput?.operationsPerSecond?.toFixed(2) || 'N/A'} ops/sec
            </div>
            <div class="stat">
                <strong>Errors:</strong> ${result.errors.length}/${result.options.iterations}
            </div>
        </div>
        
        ${result.statistics.duration?.percentiles ? `
        <h4>Percentiles</h4>
        <table>
            <tr><th>P50</th><th>P75</th><th>P90</th><th>P95</th><th>P99</th></tr>
            <tr>
                <td>${result.statistics.duration.percentiles.p50.toFixed(2)}ms</td>
                <td>${result.statistics.duration.percentiles.p75.toFixed(2)}ms</td>
                <td>${result.statistics.duration.percentiles.p90.toFixed(2)}ms</td>
                <td>${result.statistics.duration.percentiles.p95.toFixed(2)}ms</td>
                <td>${result.statistics.duration.percentiles.p99.toFixed(2)}ms</td>
            </tr>
        </table>
        ` : ''}
    </div>
    `).join('')}

    ${reportData.summary.recommendations.length > 0 ? `
    <div class="recommendations">
        <h2>Recommendations</h2>
        <ul>
            ${reportData.summary.recommendations.map(rec => `
            <li><strong>${rec.benchmark}</strong>: ${rec.issue} - ${rec.suggestion}</li>
            `).join('')}
        </ul>
    </div>
    ` : ''}

</body>
</html>`;

    await fs.writeFile(outputFile, html);
  }

  /**
   * Generate CSV report
   */
  async generateCSVReport(reportData, outputFile) {
    const headers = [
      'Benchmark',
      'Iteration',
      'Duration (ms)',
      'Memory Delta (MB)',
      'CPU User (μs)',
      'CPU System (μs)',
      'Error'
    ];

    const rows = [headers.join(',')];

    reportData.results.forEach(result => {
      result.measurements.forEach(measurement => {
        const row = [
          result.name,
          measurement.iteration,
          measurement.duration.toFixed(2),
          (measurement.memoryDelta.heapUsed / 1024 / 1024).toFixed(2),
          measurement.cpuAfter.user,
          measurement.cpuAfter.system,
          ''
        ];
        rows.push(row.join(','));
      });

      result.errors.forEach(error => {
        const row = [
          result.name,
          error.iteration,
          '',
          '',
          '',
          '',
          error.error
        ];
        rows.push(row.join(','));
      });
    });

    await fs.writeFile(outputFile, rows.join('\n'));
  }
}

module.exports = BenchmarkRunner;