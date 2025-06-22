/**
 * Unified Benchmark Runner - Issue #134
 * 統合パフォーマンスベンチマークツール
 * 
 * 既存のPerformanceMonitor、LoadTester、CCSPベンチマークを統合し、
 * PoppoBuilder Suite全体の包括的なパフォーマンス測定を実行
 */

const EventEmitter = require('events');
const PerformanceMonitor = require('./performance-monitor');
const LoadTester = require('../scalability/load-tester');
const path = require('path');
const fs = require('fs').promises;

class UnifiedBenchmarkRunner extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      // ベンチマーク設定
      benchmarkTypes: options.benchmarkTypes || ['performance', 'load', 'agents', 'redis', 'system'],
      reportFormat: options.reportFormat || 'json',
      outputDir: options.outputDir || './reports/benchmarks',
      
      // 実行時間制御
      shortTest: options.shortTest || false, // 短時間テスト（開発用）
      fullTest: options.fullTest || false,   // 完全テスト（CI/CD用）
      
      // コンポーネント別設定
      performance: {
        duration: options.performance?.duration || (options.shortTest ? 30000 : 120000),
        metricsInterval: options.performance?.metricsInterval || 1000,
        ...options.performance
      },
      
      load: {
        maxUsers: options.load?.maxUsers || (options.shortTest ? 10 : 50),
        duration: options.load?.duration || (options.shortTest ? 60000 : 180000),
        scenarios: options.load?.scenarios || ['load', 'stress'],
        ...options.load
      },
      
      agents: {
        testAgents: options.agents?.testAgents || ['ccla', 'ccag', 'ccpm'],
        requestCount: options.agents?.requestCount || (options.shortTest ? 100 : 1000),
        ...options.agents
      },
      
      redis: {
        enabled: options.redis?.enabled !== false,
        operationTypes: options.redis?.operationTypes || ['set', 'get', 'queue'],
        dataSize: options.redis?.dataSize || [1024, 10240, 102400], // 1KB, 10KB, 100KB
        ...options.redis
      },
      
      system: {
        includeMemoryProfiling: options.system?.includeMemoryProfiling !== false,
        includeCpuProfiling: options.system?.includeCpuProfiling !== false,
        includeNetworkTest: options.system?.includeNetworkTest !== false,
        ...options.system
      },
      
      ...options
    };
    
    // コンポーネントの初期化
    this.performanceMonitor = null;
    this.loadTester = null;
    
    // 結果格納
    this.benchmarkResults = new Map();
    this.overallResults = null;
    
    this.isRunning = false;
    this.currentBenchmark = null;
    this.startTime = null;
  }

  /**
   * ベンチマークシステムを初期化
   */
  async initialize() {
    try {
      console.log('📊 統合ベンチマークシステムを初期化中...');
      
      // 出力ディレクトリの作成
      await fs.mkdir(this.options.outputDir, { recursive: true });
      
      // PerformanceMonitorの初期化
      this.performanceMonitor = new PerformanceMonitor({
        metricsInterval: this.options.performance.metricsInterval,
        profilingEnabled: true,
        optimizationEnabled: false // ベンチマーク中は自動最適化を無効化
      });
      
      // LoadTesterの初期化
      this.loadTester = new LoadTester({
        maxConcurrentUsers: this.options.load.maxUsers,
        maxDuration: this.options.load.duration
      });
      
      console.log('✅ 統合ベンチマークシステムが初期化されました');
      
    } catch (error) {
      console.error('❌ ベンチマークシステムの初期化に失敗:', error);
      throw error;
    }
  }

  /**
   * 完全ベンチマークスイートを実行
   */
  async runFullBenchmarkSuite() {
    if (this.isRunning) {
      throw new Error('ベンチマークは既に実行中です');
    }

    this.isRunning = true;
    this.startTime = Date.now();
    
    try {
      console.log('🚀 統合ベンチマークスイートを開始します');
      console.log(`⏱️  テストタイプ: ${this.options.shortTest ? '短時間' : '完全'}`);
      console.log(`📋 実行項目: ${this.options.benchmarkTypes.join(', ')}`);
      
      // 結果の初期化
      this.benchmarkResults.clear();
      
      // 各ベンチマークを順次実行
      for (const benchmarkType of this.options.benchmarkTypes) {
        this.currentBenchmark = benchmarkType;
        
        console.log(`\n🔍 ${benchmarkType} ベンチマークを実行中...`);
        
        let result;
        switch (benchmarkType) {
          case 'performance':
            result = await this.runPerformanceBenchmark();
            break;
          case 'load':
            result = await this.runLoadBenchmark();
            break;
          case 'agents':
            result = await this.runAgentsBenchmark();
            break;
          case 'redis':
            result = await this.runRedisBenchmark();
            break;
          case 'system':
            result = await this.runSystemBenchmark();
            break;
          default:
            console.log(`⚠️  未知のベンチマークタイプ: ${benchmarkType}`);
            continue;
        }
        
        this.benchmarkResults.set(benchmarkType, result);
        
        console.log(`✅ ${benchmarkType} ベンチマーク完了`);
        
        this.emit('benchmark-completed', { type: benchmarkType, result });
      }
      
      // 総合レポートの生成
      this.overallResults = await this.generateOverallReport();
      
      // レポートの保存
      await this.saveResults();
      
      console.log('\n🎉 統合ベンチマークスイートが完了しました');
      
      return this.overallResults;
      
    } catch (error) {
      console.error('❌ ベンチマーク実行に失敗:', error);
      throw error;
    } finally {
      this.isRunning = false;
      this.currentBenchmark = null;
    }
  }

  /**
   * パフォーマンスベンチマークを実行
   */
  async runPerformanceBenchmark() {
    const startTime = Date.now();
    
    // PerformanceMonitorを開始
    await this.performanceMonitor.start();
    
    // ベンチマーク実行時間だけ待機（システム負荷測定）
    await new Promise(resolve => setTimeout(resolve, this.options.performance.duration));
    
    // 詳細プロファイルを実行
    const profile = await this.performanceMonitor.performProfiling();
    
    // PerformanceMonitorを停止
    await this.performanceMonitor.stop();
    
    // パフォーマンステストの実行
    const performanceTests = await this.runPerformanceTests();
    
    return {
      type: 'performance',
      duration: Date.now() - startTime,
      profile,
      performanceTests,
      metrics: this.performanceMonitor.getPerformanceReport(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 負荷ベンチマークを実行
   */
  async runLoadBenchmark() {
    const results = [];
    
    for (const scenario of this.options.load.scenarios) {
      console.log(`  📈 負荷テスト実行中: ${scenario}`);
      
      try {
        await this.loadTester.startLoadTest(scenario);
        
        // テスト結果を取得
        const testResults = Array.from(this.loadTester.testResults.values());
        const latestResult = testResults[testResults.length - 1];
        
        if (latestResult) {
          results.push(latestResult);
        }
        
      } catch (error) {
        console.error(`  ❌ ${scenario} テストに失敗:`, error.message);
        results.push({
          scenario,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      }
    }
    
    return {
      type: 'load',
      scenarios: results,
      summary: this.summarizeLoadResults(results),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * エージェントベンチマークを実行
   */
  async runAgentsBenchmark() {
    const results = {};
    
    for (const agentType of this.options.agents.testAgents) {
      console.log(`  🤖 エージェントテスト実行中: ${agentType}`);
      
      try {
        const agentResult = await this.benchmarkAgent(agentType);
        results[agentType] = agentResult;
      } catch (error) {
        console.error(`  ❌ ${agentType} エージェントテストに失敗:`, error.message);
        results[agentType] = {
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }
    
    return {
      type: 'agents',
      results,
      summary: this.summarizeAgentResults(results),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Redisベンチマークを実行
   */
  async runRedisBenchmark() {
    if (!this.options.redis.enabled) {
      return {
        type: 'redis',
        skipped: true,
        reason: 'Redis benchmarks disabled',
        timestamp: new Date().toISOString()
      };
    }
    
    const results = {};
    
    for (const operation of this.options.redis.operationTypes) {
      console.log(`  🔄 Redis操作テスト: ${operation}`);
      
      try {
        const operationResult = await this.benchmarkRedisOperation(operation);
        results[operation] = operationResult;
      } catch (error) {
        console.error(`  ❌ Redis ${operation} テストに失敗:`, error.message);
        results[operation] = {
          error: error.message,
          timestamp: new Date().toISOString()
        };
      }
    }
    
    return {
      type: 'redis',
      results,
      summary: this.summarizeRedisResults(results),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * システムベンチマークを実行
   */
  async runSystemBenchmark() {
    const results = {};
    
    // CPUベンチマーク
    if (this.options.system.includeCpuProfiling) {
      console.log('  🖥️  CPU集約処理ベンチマーク');
      results.cpu = await this.benchmarkCpuIntensive();
    }
    
    // メモリベンチマーク
    if (this.options.system.includeMemoryProfiling) {
      console.log('  🧠 メモリ集約処理ベンチマーク');
      results.memory = await this.benchmarkMemoryIntensive();
    }
    
    // ネットワークベンチマーク
    if (this.options.system.includeNetworkTest) {
      console.log('  🌐 ネットワークI/Oベンチマーク');
      results.network = await this.benchmarkNetworkIO();
    }
    
    // ディスクI/Oベンチマーク
    console.log('  💾 ディスクI/Oベンチマーク');
    results.disk = await this.benchmarkDiskIO();
    
    return {
      type: 'system',
      results,
      summary: this.summarizeSystemResults(results),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * パフォーマンステストを実行
   */
  async runPerformanceTests() {
    const tests = [];
    
    // 操作追跡テスト
    for (let i = 0; i < 10; i++) {
      const operationId = `test-operation-${i}`;
      this.performanceMonitor.startOperation(operationId, { type: 'benchmark', iteration: i });
      
      // CPU集約的な処理をシミュレート
      await this.simulateCpuIntensiveOperation(50);
      
      const result = this.performanceMonitor.endOperation(operationId, { success: true });
      tests.push(result);
    }
    
    return tests;
  }

  /**
   * CPU集約的な処理をシミュレート
   */
  async simulateCpuIntensiveOperation(durationMs) {
    const start = Date.now();
    while (Date.now() - start < durationMs) {
      Math.sqrt(Math.random() * 1000000);
    }
  }

  /**
   * 個別エージェントのベンチマーク
   */
  async benchmarkAgent(agentType) {
    const startTime = Date.now();
    const requestCount = this.options.agents.requestCount;
    const results = [];
    
    // 模擬リクエストを実行
    for (let i = 0; i < requestCount; i++) {
      const reqStart = Date.now();
      
      try {
        // エージェント処理をシミュレート
        await this.simulateAgentOperation(agentType);
        
        const responseTime = Date.now() - reqStart;
        results.push({
          success: true,
          responseTime,
          timestamp: Date.now()
        });
        
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          timestamp: Date.now()
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const responseTimes = results.filter(r => r.success).map(r => r.responseTime);
    
    return {
      agentType,
      totalRequests: requestCount,
      successfulRequests: successCount,
      failedRequests: requestCount - successCount,
      successRate: (successCount / requestCount) * 100,
      averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length || 0,
      minResponseTime: Math.min(...responseTimes) || 0,
      maxResponseTime: Math.max(...responseTimes) || 0,
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * エージェント操作をシミュレート
   */
  async simulateAgentOperation(agentType) {
    // エージェントタイプに応じた処理時間をシミュレート
    const processingTimes = {
      ccla: 200 + Math.random() * 300,  // 200-500ms
      ccag: 500 + Math.random() * 1000, // 500-1500ms
      ccpm: 300 + Math.random() * 700   // 300-1000ms
    };
    
    const processingTime = processingTimes[agentType] || 100 + Math.random() * 200;
    
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // 5%の確率でエラーをシミュレート
    if (Math.random() < 0.05) {
      throw new Error(`Simulated ${agentType} error`);
    }
  }

  /**
   * Redis操作のベンチマーク
   */
  async benchmarkRedisOperation(operation) {
    const iterations = 1000;
    const results = [];
    
    for (let i = 0; i < iterations; i++) {
      const start = Date.now();
      
      try {
        await this.simulateRedisOperation(operation);
        
        const responseTime = Date.now() - start;
        results.push({
          success: true,
          responseTime,
          operation,
          iteration: i
        });
        
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          operation,
          iteration: i
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const responseTimes = results.filter(r => r.success).map(r => r.responseTime);
    
    return {
      operation,
      totalOperations: iterations,
      successfulOperations: successCount,
      failedOperations: iterations - successCount,
      successRate: (successCount / iterations) * 100,
      averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length || 0,
      throughput: successCount / (results[results.length - 1]?.timestamp - results[0]?.timestamp) * 1000 || 0,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Redis操作をシミュレート
   */
  async simulateRedisOperation(operation) {
    // 操作タイプに応じた処理時間
    const operationTimes = {
      set: 1 + Math.random() * 5,    // 1-6ms
      get: 0.5 + Math.random() * 2,  // 0.5-2.5ms
      queue: 2 + Math.random() * 8   // 2-10ms
    };
    
    const processingTime = operationTimes[operation] || 1 + Math.random() * 3;
    
    await new Promise(resolve => setTimeout(resolve, processingTime));
    
    // 1%の確率でエラーをシミュレート
    if (Math.random() < 0.01) {
      throw new Error(`Simulated Redis ${operation} error`);
    }
  }

  /**
   * CPU集約処理ベンチマーク
   */
  async benchmarkCpuIntensive() {
    const startTime = Date.now();
    const iterations = 1000000;
    
    // 数学計算集約処理
    let result = 0;
    for (let i = 0; i < iterations; i++) {
      result += Math.sqrt(i) * Math.sin(i) * Math.cos(i);
    }
    
    const duration = Date.now() - startTime;
    
    return {
      iterations,
      duration,
      operationsPerSecond: iterations / (duration / 1000),
      result: result.toFixed(2),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * メモリ集約処理ベンチマーク
   */
  async benchmarkMemoryIntensive() {
    const startMemory = process.memoryUsage();
    const startTime = Date.now();
    
    // 大量のオブジェクトを作成
    const largeArray = [];
    const iterations = 100000;
    
    for (let i = 0; i < iterations; i++) {
      largeArray.push({
        id: i,
        data: 'x'.repeat(100),
        timestamp: Date.now(),
        nested: {
          value1: Math.random(),
          value2: Math.random(),
          array: new Array(10).fill(Math.random())
        }
      });
    }
    
    const midMemory = process.memoryUsage();
    
    // ガベージコレクションを促す
    if (global.gc) {
      global.gc();
    }
    
    // 配列をクリア
    largeArray.length = 0;
    
    const endMemory = process.memoryUsage();
    const duration = Date.now() - startTime;
    
    return {
      iterations,
      duration,
      memoryUsage: {
        start: {
          heapUsed: Math.round(startMemory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(startMemory.heapTotal / 1024 / 1024)
        },
        peak: {
          heapUsed: Math.round(midMemory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(midMemory.heapTotal / 1024 / 1024)
        },
        end: {
          heapUsed: Math.round(endMemory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(endMemory.heapTotal / 1024 / 1024)
        }
      },
      memoryAllocatedMB: Math.round((midMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024),
      objectsPerSecond: iterations / (duration / 1000),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * ネットワークI/Oベンチマーク
   */
  async benchmarkNetworkIO() {
    const startTime = Date.now();
    const requests = 50;
    const results = [];
    
    // 複数の並行HTTP リクエストをシミュレート
    const promises = Array.from({ length: requests }, async (_, i) => {
      const reqStart = Date.now();
      
      try {
        // ネットワークリクエストをシミュレート
        await this.simulateNetworkRequest(i);
        
        const responseTime = Date.now() - reqStart;
        return {
          success: true,
          responseTime,
          requestId: i
        };
      } catch (error) {
        return {
          success: false,
          error: error.message,
          requestId: i
        };
      }
    });
    
    const requestResults = await Promise.all(promises);
    const successCount = requestResults.filter(r => r.success).length;
    const responseTimes = requestResults.filter(r => r.success).map(r => r.responseTime);
    
    return {
      totalRequests: requests,
      successfulRequests: successCount,
      failedRequests: requests - successCount,
      averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length || 0,
      minResponseTime: Math.min(...responseTimes) || 0,
      maxResponseTime: Math.max(...responseTimes) || 0,
      requestsPerSecond: successCount / ((Date.now() - startTime) / 1000),
      duration: Date.now() - startTime,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * ネットワークリクエストをシミュレート
   */
  async simulateNetworkRequest(requestId) {
    // ネットワーク遅延をシミュレート
    const networkDelay = 50 + Math.random() * 200; // 50-250ms
    await new Promise(resolve => setTimeout(resolve, networkDelay));
    
    // 2%の確率でエラーをシミュレート
    if (Math.random() < 0.02) {
      throw new Error(`Network request ${requestId} failed`);
    }
  }

  /**
   * ディスクI/Oベンチマーク
   */
  async benchmarkDiskIO() {
    const fs = require('fs').promises;
    const path = require('path');
    const startTime = Date.now();
    
    // 一時ファイル作成とI/O操作
    const tempDir = path.join(this.options.outputDir, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    
    const fileOperations = [];
    const fileCount = 100;
    const fileSize = 1024; // 1KB per file
    
    // ファイル書き込みテスト
    const writeStart = Date.now();
    for (let i = 0; i < fileCount; i++) {
      const filePath = path.join(tempDir, `test-file-${i}.txt`);
      const content = 'x'.repeat(fileSize);
      await fs.writeFile(filePath, content);
    }
    const writeTime = Date.now() - writeStart;
    
    // ファイル読み込みテスト
    const readStart = Date.now();
    for (let i = 0; i < fileCount; i++) {
      const filePath = path.join(tempDir, `test-file-${i}.txt`);
      await fs.readFile(filePath, 'utf8');
    }
    const readTime = Date.now() - readStart;
    
    // ファイル削除テスト
    const deleteStart = Date.now();
    for (let i = 0; i < fileCount; i++) {
      const filePath = path.join(tempDir, `test-file-${i}.txt`);
      await fs.unlink(filePath);
    }
    const deleteTime = Date.now() - deleteStart;
    
    // 一時ディレクトリ削除
    await fs.rmdir(tempDir);
    
    const totalTime = Date.now() - startTime;
    
    return {
      fileCount,
      fileSizeKB: fileSize / 1024,
      operations: {
        write: {
          duration: writeTime,
          throughputMBps: (fileCount * fileSize) / (writeTime / 1000) / (1024 * 1024),
          filesPerSecond: fileCount / (writeTime / 1000)
        },
        read: {
          duration: readTime,
          throughputMBps: (fileCount * fileSize) / (readTime / 1000) / (1024 * 1024),
          filesPerSecond: fileCount / (readTime / 1000)
        },
        delete: {
          duration: deleteTime,
          filesPerSecond: fileCount / (deleteTime / 1000)
        }
      },
      totalDuration: totalTime,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * 負荷テスト結果のサマリー
   */
  summarizeLoadResults(results) {
    const successfulTests = results.filter(r => !r.error);
    
    if (successfulTests.length === 0) {
      return { error: 'No successful load tests' };
    }
    
    const averageThroughput = successfulTests.reduce((sum, r) => 
      sum + (r.summary?.throughput || 0), 0) / successfulTests.length;
    
    const averageResponseTime = successfulTests.reduce((sum, r) => 
      sum + (r.summary?.averageResponseTime || 0), 0) / successfulTests.length;
    
    return {
      testsExecuted: results.length,
      successfulTests: successfulTests.length,
      failedTests: results.length - successfulTests.length,
      averageThroughput,
      averageResponseTime,
      scenarios: successfulTests.map(r => r.scenario)
    };
  }

  /**
   * エージェントテスト結果のサマリー
   */
  summarizeAgentResults(results) {
    const agents = Object.keys(results).filter(agent => !results[agent].error);
    
    if (agents.length === 0) {
      return { error: 'No successful agent tests' };
    }
    
    const summary = {
      testedAgents: agents.length,
      failedAgents: Object.keys(results).length - agents.length,
      totalRequests: 0,
      totalSuccessful: 0,
      averageResponseTime: 0,
      averageSuccessRate: 0
    };
    
    agents.forEach(agent => {
      const result = results[agent];
      summary.totalRequests += result.totalRequests || 0;
      summary.totalSuccessful += result.successfulRequests || 0;
      summary.averageResponseTime += result.averageResponseTime || 0;
      summary.averageSuccessRate += result.successRate || 0;
    });
    
    summary.averageResponseTime /= agents.length;
    summary.averageSuccessRate /= agents.length;
    
    return summary;
  }

  /**
   * Redis結果のサマリー
   */
  summarizeRedisResults(results) {
    const operations = Object.keys(results).filter(op => !results[op].error);
    
    if (operations.length === 0) {
      return { error: 'No successful Redis tests' };
    }
    
    const summary = {
      testedOperations: operations.length,
      failedOperations: Object.keys(results).length - operations.length,
      totalOperations: 0,
      averageResponseTime: 0,
      averageThroughput: 0
    };
    
    operations.forEach(op => {
      const result = results[op];
      summary.totalOperations += result.totalOperations || 0;
      summary.averageResponseTime += result.averageResponseTime || 0;
      summary.averageThroughput += result.throughput || 0;
    });
    
    summary.averageResponseTime /= operations.length;
    summary.averageThroughput /= operations.length;
    
    return summary;
  }

  /**
   * システム結果のサマリー
   */
  summarizeSystemResults(results) {
    const summary = {
      testsExecuted: Object.keys(results).length,
      cpuPerformance: results.cpu?.operationsPerSecond || 0,
      memoryEfficiency: results.memory?.objectsPerSecond || 0,
      networkThroughput: results.network?.requestsPerSecond || 0,
      diskIOPerformance: {
        writeSpeed: results.disk?.operations?.write?.throughputMBps || 0,
        readSpeed: results.disk?.operations?.read?.throughputMBps || 0
      }
    };
    
    return summary;
  }

  /**
   * 総合レポートを生成
   */
  async generateOverallReport() {
    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;
    
    const report = {
      title: 'PoppoBuilder Suite - 統合パフォーマンスベンチマーク',
      executionInfo: {
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        totalDuration: totalDuration,
        testMode: this.options.shortTest ? 'short' : 'full',
        benchmarkTypes: this.options.benchmarkTypes
      },
      results: Object.fromEntries(this.benchmarkResults),
      overallScore: this.calculateOverallScore(),
      recommendations: this.generateRecommendations(),
      systemInfo: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCount: require('os').cpus().length,
        totalMemory: Math.round(require('os').totalmem() / 1024 / 1024 / 1024) + 'GB'
      },
      timestamp: new Date().toISOString()
    };
    
    return report;
  }

  /**
   * 総合スコアを計算
   */
  calculateOverallScore() {
    let totalScore = 0;
    let validTests = 0;
    
    // 各ベンチマークタイプのスコアを計算
    this.benchmarkResults.forEach((result, type) => {
      if (result.error || result.skipped) return;
      
      let score = 0;
      
      switch (type) {
        case 'performance':
          // CPU、メモリ、イベントループ性能に基づくスコア
          const perfMetrics = result.metrics?.resourceUsage;
          if (perfMetrics) {
            score = Math.max(0, 100 - perfMetrics.cpu.average - (perfMetrics.memory.average * 0.5));
          }
          break;
          
        case 'load':
          // スループットとエラー率に基づくスコア
          const loadSummary = result.summary;
          if (loadSummary && !loadSummary.error) {
            score = Math.min(100, loadSummary.averageThroughput * 10) * 
                   (loadSummary.averageResponseTime < 1000 ? 1 : 0.8);
          }
          break;
          
        case 'agents':
          // エージェント成功率と応答時間に基づくスコア
          const agentSummary = result.summary;
          if (agentSummary && !agentSummary.error) {
            score = agentSummary.averageSuccessRate * 
                   (agentSummary.averageResponseTime < 500 ? 1 : 0.8);
          }
          break;
          
        case 'redis':
          // Redis操作のスループットに基づくスコア
          const redisSummary = result.summary;
          if (redisSummary && !redisSummary.error) {
            score = Math.min(100, redisSummary.averageThroughput / 10);
          }
          break;
          
        case 'system':
          // システムリソース効率に基づくスコア
          const systemSummary = result.summary;
          if (systemSummary) {
            score = (systemSummary.cpuPerformance / 10000) + 
                   (systemSummary.memoryEfficiency / 10000) + 
                   (systemSummary.networkThroughput * 2);
            score = Math.min(100, score);
          }
          break;
      }
      
      if (score > 0) {
        totalScore += score;
        validTests++;
      }
    });
    
    return validTests > 0 ? Math.round(totalScore / validTests) : 0;
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendations() {
    const recommendations = [];
    
    this.benchmarkResults.forEach((result, type) => {
      switch (type) {
        case 'performance':
          const perfMetrics = result.metrics?.resourceUsage;
          if (perfMetrics?.cpu.average > 70) {
            recommendations.push({
              category: 'performance',
              severity: 'medium',
              message: 'CPU使用率が高いです。処理の最適化を検討してください。',
              suggestion: 'CPU集約的な処理の分散化やキャッシュ機能の追加'
            });
          }
          if (perfMetrics?.memory.average > 80) {
            recommendations.push({
              category: 'performance',
              severity: 'high',
              message: 'メモリ使用率が高いです。メモリリークの確認とガベージコレクションの最適化が必要です。',
              suggestion: 'メモリプロファイリングとオブジェクトライフサイクルの見直し'
            });
          }
          break;
          
        case 'load':
          const loadSummary = result.summary;
          if (loadSummary?.averageResponseTime > 2000) {
            recommendations.push({
              category: 'scalability',
              severity: 'medium',
              message: '負荷テストでの応答時間が長いです。スケーラビリティの改善が必要です。',
              suggestion: 'ロードバランサーの導入や並列処理の最適化'
            });
          }
          break;
          
        case 'agents':
          const agentSummary = result.summary;
          if (agentSummary?.averageSuccessRate < 95) {
            recommendations.push({
              category: 'reliability',
              severity: 'high',
              message: 'エージェントの成功率が低いです。エラーハンドリングの改善が必要です。',
              suggestion: 'リトライ機能の強化とエラー監視の改善'
            });
          }
          break;
      }
    });
    
    return recommendations;
  }

  /**
   * 結果を保存
   */
  async saveResults() {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      // JSON形式で保存
      if (this.options.reportFormat === 'json' || this.options.reportFormat === 'both') {
        const jsonPath = path.join(this.options.outputDir, `benchmark-${Date.now()}.json`);
        // BigIntを文字列に変換してからシリアライズ
        const jsonContent = JSON.stringify(this.overallResults, (key, value) => {
          return typeof value === 'bigint' ? value.toString() : value;
        }, 2);
        await fs.writeFile(jsonPath, jsonContent);
        console.log(`📄 JSONレポートを保存: ${jsonPath}`);
      }
      
      // HTML形式で保存
      if (this.options.reportFormat === 'html' || this.options.reportFormat === 'both') {
        const htmlPath = path.join(this.options.outputDir, `benchmark-${Date.now()}.html`);
        const htmlContent = await this.generateHtmlReport();
        await fs.writeFile(htmlPath, htmlContent);
        console.log(`📄 HTMLレポートを保存: ${htmlPath}`);
      }
      
    } catch (error) {
      console.error('❌ レポート保存に失敗:', error);
    }
  }

  /**
   * HTMLレポートを生成
   */
  async generateHtmlReport() {
    const results = this.overallResults;
    
    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>PoppoBuilder Suite - ベンチマークレポート</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
        h1, h2 { color: #333; }
        .score { font-size: 3em; font-weight: bold; text-align: center; margin: 20px 0; }
        .score.excellent { color: #4CAF50; }
        .score.good { color: #8BC34A; }
        .score.fair { color: #FF9800; }
        .score.poor { color: #F44336; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 20px; margin: 20px 0; }
        .card { background: #f9f9f9; padding: 15px; border-radius: 5px; border-left: 4px solid #2196F3; }
        .metric { display: flex; justify-content: space-between; margin: 10px 0; }
        .recommendations { background: #FFF3E0; padding: 15px; border-radius: 5px; margin: 20px 0; }
        .recommendation { background: white; padding: 10px; margin: 10px 0; border-radius: 3px; border-left: 3px solid #FF9800; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { text-align: left; padding: 12px; border-bottom: 1px solid #ddd; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <div class="container">
        <h1>🚀 PoppoBuilder Suite ベンチマークレポート</h1>
        
        <div class="score ${this.getScoreClass(results.overallScore)}">
            総合スコア: ${results.overallScore}/100
        </div>
        
        <h2>📊 実行情報</h2>
        <div class="card">
            <div class="metric"><strong>実行開始:</strong> <span>${results.executionInfo.startTime}</span></div>
            <div class="metric"><strong>実行終了:</strong> <span>${results.executionInfo.endTime}</span></div>
            <div class="metric"><strong>総実行時間:</strong> <span>${Math.round(results.executionInfo.totalDuration / 1000)}秒</span></div>
            <div class="metric"><strong>テストモード:</strong> <span>${results.executionInfo.testMode}</span></div>
            <div class="metric"><strong>実行項目:</strong> <span>${results.executionInfo.benchmarkTypes.join(', ')}</span></div>
        </div>
        
        <h2>📈 ベンチマーク結果</h2>
        <div class="grid">
            ${Object.entries(results.results).map(([type, result]) => this.generateResultCard(type, result)).join('')}
        </div>
        
        ${results.recommendations.length > 0 ? `
        <h2>💡 推奨事項</h2>
        <div class="recommendations">
            ${results.recommendations.map(rec => `
            <div class="recommendation">
                <strong>[${rec.category}] ${rec.severity}</strong><br>
                ${rec.message}<br>
                <em>推奨: ${rec.suggestion}</em>
            </div>
            `).join('')}
        </div>
        ` : ''}
        
        <h2>💻 システム情報</h2>
        <div class="card">
            <div class="metric"><strong>Node.js:</strong> <span>${results.systemInfo.nodeVersion}</span></div>
            <div class="metric"><strong>プラットフォーム:</strong> <span>${results.systemInfo.platform}</span></div>
            <div class="metric"><strong>アーキテクチャ:</strong> <span>${results.systemInfo.arch}</span></div>
            <div class="metric"><strong>CPU数:</strong> <span>${results.systemInfo.cpuCount}</span></div>
            <div class="metric"><strong>総メモリ:</strong> <span>${results.systemInfo.totalMemory}</span></div>
        </div>
        
        <p style="text-align: center; color: #666; margin-top: 30px;">
            Generated by PoppoBuilder Suite Unified Benchmark Runner<br>
            ${results.timestamp}
        </p>
    </div>
</body>
</html>`;
  }

  /**
   * スコアクラスを取得
   */
  getScoreClass(score) {
    if (score >= 80) return 'excellent';
    if (score >= 60) return 'good';
    if (score >= 40) return 'fair';
    return 'poor';
  }

  /**
   * 結果カードのHTMLを生成
   */
  generateResultCard(type, result) {
    if (result.error || result.skipped) {
      return `
        <div class="card">
            <h3>${type.toUpperCase()}</h3>
            <p style="color: #666;">${result.skipped ? 'スキップされました' : 'エラーが発生しました'}</p>
            ${result.error ? `<p style="color: #f44336;">${result.error}</p>` : ''}
        </div>
      `;
    }
    
    let content = `<h3>${type.toUpperCase()}</h3>`;
    
    switch (type) {
      case 'performance':
        const perfSummary = result.metrics?.resourceUsage;
        if (perfSummary) {
          content += `
            <div class="metric"><strong>CPU平均:</strong> <span>${perfSummary.cpu.average.toFixed(1)}%</span></div>
            <div class="metric"><strong>メモリ平均:</strong> <span>${perfSummary.memory.average.toFixed(1)}%</span></div>
            <div class="metric"><strong>イベントループ遅延:</strong> <span>${perfSummary.eventLoop.average.toFixed(2)}ms</span></div>
          `;
        }
        break;
        
      case 'load':
        const loadSummary = result.summary;
        if (loadSummary && !loadSummary.error) {
          content += `
            <div class="metric"><strong>成功テスト:</strong> <span>${loadSummary.successfulTests}/${loadSummary.testsExecuted}</span></div>
            <div class="metric"><strong>平均スループット:</strong> <span>${loadSummary.averageThroughput.toFixed(2)} req/s</span></div>
            <div class="metric"><strong>平均応答時間:</strong> <span>${loadSummary.averageResponseTime.toFixed(2)}ms</span></div>
          `;
        }
        break;
        
      case 'agents':
        const agentSummary = result.summary;
        if (agentSummary && !agentSummary.error) {
          content += `
            <div class="metric"><strong>テスト済みエージェント:</strong> <span>${agentSummary.testedAgents}</span></div>
            <div class="metric"><strong>総成功率:</strong> <span>${agentSummary.averageSuccessRate.toFixed(1)}%</span></div>
            <div class="metric"><strong>平均応答時間:</strong> <span>${agentSummary.averageResponseTime.toFixed(2)}ms</span></div>
          `;
        }
        break;
        
      case 'system':
        const systemSummary = result.summary;
        if (systemSummary) {
          content += `
            <div class="metric"><strong>CPU性能:</strong> <span>${systemSummary.cpuPerformance.toFixed(0)} ops/s</span></div>
            <div class="metric"><strong>メモリ効率:</strong> <span>${systemSummary.memoryEfficiency.toFixed(0)} obj/s</span></div>
            <div class="metric"><strong>ネットワーク:</strong> <span>${systemSummary.networkThroughput.toFixed(1)} req/s</span></div>
          `;
        }
        break;
    }
    
    return `<div class="card">${content}</div>`;
  }

  /**
   * 現在の状況を取得
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      currentBenchmark: this.currentBenchmark,
      startTime: this.startTime,
      completedBenchmarks: Array.from(this.benchmarkResults.keys()),
      overallScore: this.overallResults?.overallScore || null
    };
  }

  /**
   * ベンチマークを停止
   */
  async stop() {
    if (!this.isRunning) return;
    
    console.log('⏹️  ベンチマークを停止中...');
    
    // 実行中のコンポーネントを停止
    if (this.performanceMonitor?.isRunning) {
      await this.performanceMonitor.stop();
    }
    
    if (this.loadTester?.isRunning) {
      await this.loadTester.stopLoadTest();
    }
    
    this.isRunning = false;
    this.currentBenchmark = null;
    
    console.log('✅ ベンチマークが停止されました');
  }
}

module.exports = UnifiedBenchmarkRunner;
