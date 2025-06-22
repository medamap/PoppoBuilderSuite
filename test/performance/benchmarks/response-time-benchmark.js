const BenchmarkRunner = require('../../../src/performance/benchmark-runner');
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * レスポンスタイムベンチマーク
 * API応答速度とレイテンシを測定
 */
class ResponseTimeBenchmark {
  constructor(baseUrl = 'http://localhost:3001') {
    this.baseUrl = baseUrl;
    this.endpoints = [
      { path: '/api/health', method: 'GET', name: 'ヘルスチェック' },
      { path: '/api/health/detailed', method: 'GET', name: '詳細ヘルスチェック' },
      { path: '/api/process', method: 'GET', name: 'プロセス一覧' },
      { path: '/api/logs', method: 'GET', name: 'ログ取得' },
      { path: '/api/analytics/statistics/issue-processing', method: 'GET', name: '統計情報' }
    ];
  }

  /**
   * HTTP/HTTPSリクエストの実行
   */
  async makeRequest(url, method = 'GET', data = null) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;
      
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port,
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        }
      };

      const startTime = process.hrtime.bigint();
      let firstByteTime = null;
      
      const req = protocol.request(options, (res) => {
        const chunks = [];
        
        res.once('data', () => {
          firstByteTime = process.hrtime.bigint();
        });
        
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        
        res.on('end', () => {
          const endTime = process.hrtime.bigint();
          const body = Buffer.concat(chunks).toString();
          
          const timings = {
            total: Number(endTime - startTime) / 1000000, // ナノ秒からミリ秒へ
            firstByte: firstByteTime ? Number(firstByteTime - startTime) / 1000000 : null,
            download: firstByteTime ? Number(endTime - firstByteTime) / 1000000 : null
          };
          
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: body,
            timings: timings,
            size: Buffer.byteLength(body)
          });
        });
      });
      
      req.on('error', reject);
      
      if (data) {
        req.write(JSON.stringify(data));
      }
      
      req.end();
    });
  }

  /**
   * エンドポイントのベンチマーク
   */
  async benchmarkEndpoint(endpoint) {
    console.log(`🎯 ${endpoint.name} のベンチマークを開始...`);
    
    const benchmark = new BenchmarkRunner({
      name: endpoint.name,
      iterations: 100,
      warmup: 10,
      timeout: 5000
    });
    
    const url = `${this.baseUrl}${endpoint.path}`;
    
    const results = await benchmark.run(async () => {
      const response = await this.makeRequest(url, endpoint.method);
      
      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.body}`);
      }
      
      return response;
    });
    
    // レスポンスタイムの詳細分析
    this.analyzeResponseTimes(results);
    
    console.log(benchmark.formatResults());
    return results;
  }

  /**
   * レスポンスタイムの詳細分析
   */
  analyzeResponseTimes(results) {
    const successfulResults = results.timings
      .filter(t => t.success && t.result)
      .map(t => t.result);
    
    if (successfulResults.length === 0) return;
    
    // 各タイミングの統計
    const totalTimes = successfulResults.map(r => r.timings.total);
    const firstByteTimes = successfulResults
      .filter(r => r.timings.firstByte !== null)
      .map(r => r.timings.firstByte);
    const downloadTimes = successfulResults
      .filter(r => r.timings.download !== null)
      .map(r => r.timings.download);
    
    // 追加の統計情報
    results.responseAnalysis = {
      timing: {
        total: this.calculateStats(totalTimes),
        firstByte: firstByteTimes.length > 0 ? this.calculateStats(firstByteTimes) : null,
        download: downloadTimes.length > 0 ? this.calculateStats(downloadTimes) : null
      },
      size: {
        avg: successfulResults.reduce((sum, r) => sum + r.size, 0) / successfulResults.length,
        min: Math.min(...successfulResults.map(r => r.size)),
        max: Math.max(...successfulResults.map(r => r.size))
      }
    };
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
   * 全エンドポイントのベンチマーク
   */
  async runAllBenchmarks() {
    console.log('🚀 APIレスポンスタイムベンチマーク');
    console.log('='.repeat(50));
    
    const results = {
      timestamp: new Date().toISOString(),
      baseUrl: this.baseUrl,
      endpoints: {}
    };
    
    for (const endpoint of this.endpoints) {
      try {
        results.endpoints[endpoint.path] = await this.benchmarkEndpoint(endpoint);
      } catch (error) {
        console.error(`❌ ${endpoint.name} のベンチマーク失敗:`, error.message);
        results.endpoints[endpoint.path] = {
          error: error.message,
          failed: true
        };
      }
    }
    
    return results;
  }

  /**
   * ダッシュボードUI表示速度テスト
   */
  async benchmarkDashboardLoad() {
    console.log('🎯 ダッシュボード表示速度のベンチマーク...');
    
    const scenarios = [
      {
        name: '初期表示',
        path: '/',
        expectedSize: 10000 // 10KB以上を期待
      },
      {
        name: 'プロセス一覧（空）',
        path: '/api/process',
        expectedSize: 100
      },
      {
        name: 'プロセス一覧（大量データ）',
        path: '/api/process',
        mockData: this.generateMockProcesses(10000)
      }
    ];
    
    const results = {};
    
    for (const scenario of scenarios) {
      const benchmark = new BenchmarkRunner({
        name: scenario.name,
        iterations: 50,
        warmup: 5
      });
      
      results[scenario.name] = await benchmark.run(async () => {
        if (scenario.mockData) {
          // モックデータのシミュレーション
          const jsonSize = JSON.stringify(scenario.mockData).length;
          await new Promise(resolve => setTimeout(resolve, jsonSize / 100000)); // サイズに応じた遅延
          return { size: jsonSize, simulated: true };
        } else {
          const response = await this.makeRequest(`${this.baseUrl}${scenario.path}`);
          return response;
        }
      });
      
      console.log(benchmark.formatResults());
    }
    
    return results;
  }

  /**
   * モックプロセスデータの生成
   */
  generateMockProcesses(count) {
    const processes = [];
    for (let i = 0; i < count; i++) {
      processes.push({
        taskId: `task-${i}`,
        pid: 10000 + i,
        status: i % 10 === 0 ? 'error' : 'running',
        memory: Math.random() * 100000000,
        cpu: Math.random() * 100,
        startTime: new Date(Date.now() - Math.random() * 3600000).toISOString(),
        issueNumber: i
      });
    }
    return processes;
  }

  /**
   * レイテンシ分析
   */
  async analyzeLatency() {
    console.log('🎯 レイテンシ分析を開始...');
    
    const measurements = [];
    const iterations = 1000;
    const interval = 100; // 100ms間隔
    
    for (let i = 0; i < iterations; i++) {
      const start = process.hrtime.bigint();
      
      try {
        await this.makeRequest(`${this.baseUrl}/api/health`);
        const end = process.hrtime.bigint();
        const latency = Number(end - start) / 1000000;
        
        measurements.push({
          timestamp: Date.now(),
          latency: latency,
          success: true
        });
      } catch (error) {
        measurements.push({
          timestamp: Date.now(),
          latency: null,
          success: false,
          error: error.message
        });
      }
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }
    
    // レイテンシの分析
    const successfulMeasurements = measurements
      .filter(m => m.success)
      .map(m => m.latency);
    
    if (successfulMeasurements.length === 0) {
      return { error: 'すべての測定が失敗しました' };
    }
    
    const stats = this.calculateStats(successfulMeasurements);
    const jitter = this.calculateJitter(successfulMeasurements);
    
    console.log(`
📊 レイテンシ分析結果
========================
測定回数: ${iterations}
成功率: ${(successfulMeasurements.length / iterations * 100).toFixed(2)}%

レイテンシ統計 (ms):
- 最小: ${stats.min.toFixed(2)}
- 最大: ${stats.max.toFixed(2)}
- 平均: ${stats.avg.toFixed(2)}
- P50: ${stats.p50.toFixed(2)}
- P95: ${stats.p95.toFixed(2)}
- P99: ${stats.p99.toFixed(2)}

ジッター: ${jitter.toFixed(2)}ms
========================
`);
    
    return {
      measurements: measurements,
      stats: stats,
      jitter: jitter,
      successRate: successfulMeasurements.length / iterations
    };
  }

  /**
   * ジッターの計算
   */
  calculateJitter(values) {
    if (values.length < 2) return 0;
    
    let sumDiff = 0;
    for (let i = 1; i < values.length; i++) {
      sumDiff += Math.abs(values[i] - values[i - 1]);
    }
    
    return sumDiff / (values.length - 1);
  }

  /**
   * 結果の保存
   */
  async saveResults(results, filename) {
    const path = require('path');
    const fs = require('fs').promises;
    
    const reportDir = path.join(__dirname, '..', 'reports');
    await fs.mkdir(reportDir, { recursive: true });
    
    const filepath = path.join(reportDir, filename);
    await fs.writeFile(filepath, JSON.stringify(results, null, 2));
    
    console.log(`📁 結果を保存しました: ${filepath}`);
  }
}

// スタンドアロン実行
if (require.main === module) {
  const benchmark = new ResponseTimeBenchmark();
  
  (async () => {
    try {
      const results = {
        timestamp: new Date().toISOString(),
        benchmarks: {}
      };
      
      // 1. 全エンドポイントのベンチマーク
      results.benchmarks.endpoints = await benchmark.runAllBenchmarks();
      
      // 2. ダッシュボード表示速度
      results.benchmarks.dashboard = await benchmark.benchmarkDashboardLoad();
      
      // 3. レイテンシ分析
      results.benchmarks.latency = await benchmark.analyzeLatency();
      
      // 結果の保存
      const filename = `response-time-${Date.now()}.json`;
      await benchmark.saveResults(results, filename);
      
      console.log('\n✅ すべてのベンチマークが完了しました');
      
    } catch (error) {
      console.error('❌ ベンチマークエラー:', error);
      process.exit(1);
    }
  })();
}

module.exports = ResponseTimeBenchmark;