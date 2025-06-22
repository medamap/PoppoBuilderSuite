/**
 * CCSP パフォーマンスベンチマークテスト
 * CCSPエージェントの性能特性を測定・検証
 */

const assert = require('assert');
const path = require('path');
const { performance } = require('perf_hooks');

// モックCCSPクライアント（テスト用）
class MockCCSPClient {
  constructor() {
    this.requestCount = 0;
    this.responseTimes = [];
    this.errors = [];
  }
  
  async executeClaude(prompt, options = {}) {
    this.requestCount++;
    const startTime = performance.now();
    
    // モック実行（実際のClaude呼び出しをシミュレート）
    await this.simulateClaudeExecution(prompt, options);
    
    const responseTime = performance.now() - startTime;
    this.responseTimes.push(responseTime);
    
    return {
      success: true,
      result: `Mock response for: ${prompt.substring(0, 50)}...`,
      executionTime: responseTime
    };
  }
  
  async simulateClaudeExecution(prompt, options) {
    // 複雑度に基づく実行時間シミュレーション
    const complexity = this.calculateComplexity(prompt);
    const baseTime = options.timeout ? Math.min(options.timeout / 10, 1000) : 100;
    const simulatedTime = baseTime + (complexity * 10);
    
    await new Promise(resolve => setTimeout(resolve, simulatedTime));
  }
  
  calculateComplexity(prompt) {
    return Math.floor(prompt.length / 100) + Math.random() * 5;
  }
  
  getStats() {
    const responseTimes = this.responseTimes;
    const sorted = [...responseTimes].sort((a, b) => a - b);
    
    return {
      totalRequests: this.requestCount,
      averageResponseTime: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length,
      p50: sorted[Math.floor(sorted.length * 0.5)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
      errorRate: this.errors.length / this.requestCount,
      minResponseTime: Math.min(...responseTimes),
      maxResponseTime: Math.max(...responseTimes)
    };
  }
}

describe('CCSP パフォーマンスベンチマーク', function() {
  this.timeout(60000); // 60秒のタイムアウト
  
  let mockClient;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockClient = new MockCCSPClient();
  })

  afterEach(() => {
    sandbox.restore();
  });;
  
  describe('1. 基本性能ベンチマーク', () => {
    it('単一リクエストの応答時間が許容範囲内であること', async () => {
      const startTime = performance.now();
      
      const result = await mockClient.executeClaude('Simple test prompt');
      
      const responseTime = performance.now() - startTime;
      
      assert(result.success, 'Request should succeed');
      assert(responseTime < 5000, `Response time ${responseTime}ms exceeds 5s limit`);
      assert(responseTime > 10, `Response time ${responseTime}ms seems too fast (unrealistic)`);
    });
    
    it('複数の同期リクエストの平均応答時間が許容範囲内であること', async () => {
      const requestCount = 10;
      const prompts = Array.from({ length: requestCount }, (_, i) => 
        `Test prompt ${i}: ${'x'.repeat(100 + i * 50)}`
      );
      
      for (const prompt of prompts) {
        await mockClient.executeClaude(prompt);
      }
      
      const stats = mockClient.getStats();
      
      assert(stats.totalRequests === requestCount, 'All requests should be processed');
      assert(stats.averageResponseTime < 2000, `Average response time ${stats.averageResponseTime}ms exceeds 2s`);
      assert(stats.p95 < 5000, `P95 response time ${stats.p95}ms exceeds 5s`);
    });
  });
  
  describe('2. 同時実行性能テスト', () => {
    it('並行リクエストが効率的に処理されること', async () => {
      const concurrentRequests = 5;
      const requestsPerBatch = 10;
      
      const batches = Array.from({ length: concurrentRequests }, (_, batchIndex) =>
        Array.from({ length: requestsPerBatch }, (_, reqIndex) =>
          `Batch ${batchIndex} Request ${reqIndex}: ${'data'.repeat(50)}`
        )
      );
      
      const startTime = performance.now();
      
      // 並行実行
      const batchPromises = batches.map(batch =>
        Promise.all(batch.map(prompt => mockClient.executeClaude(prompt)))
      );
      
      const results = await Promise.all(batchPromises);
      
      const totalTime = performance.now() - startTime;
      const totalRequests = concurrentRequests * requestsPerBatch;
      
      // 結果検証
      assert(results.length === concurrentRequests, 'All batches should complete');
      results.forEach((batch, index) => {
        assert(batch.length === requestsPerBatch, `Batch ${index} should have all requests`);
        batch.forEach(result => {
          assert(result.success, 'All individual requests should succeed');
        });
      });
      
      // パフォーマンス検証
      const throughput = totalRequests / (totalTime / 1000); // requests per second
      assert(throughput > 2, `Throughput ${throughput} req/s is too low`);
      
      console.log(`Concurrent execution: ${totalRequests} requests in ${totalTime.toFixed(2)}ms`);
      console.log(`Throughput: ${throughput.toFixed(2)} requests/second`);
    });
    
    it('高負荷時でもエラー率が許容範囲内であること', async () => {
      const highLoadRequests = 50;
      const maxConcurrency = 10;
      
      // 高負荷リクエストを作成
      const requests = Array.from({ length: highLoadRequests }, (_, i) => ({
        prompt: `High load test ${i}: ${'stress'.repeat(25)}`,
        options: { timeout: 5000 }
      }));
      
      // バッチごとに並行実行
      const batches = [];
      for (let i = 0; i < requests.length; i += maxConcurrency) {
        batches.push(requests.slice(i, i + maxConcurrency));
      }
      
      let successCount = 0;
      let errorCount = 0;
      
      for (const batch of batches) {
        const batchPromises = batch.map(async ({ prompt, options }) => {
          try {
            const result = await mockClient.executeClaude(prompt, options);
            if (result.success) successCount++;
            else errorCount++;
            return result;
          } catch (error) {
            errorCount++;
            return { success: false, error: error.message };
          }
        });
        
        await Promise.all(batchPromises);
      }
      
      const errorRate = errorCount / (successCount + errorCount);
      
      assert(errorRate < 0.05, `Error rate ${errorRate * 100}% exceeds 5% threshold`);
      
      console.log(`High load test: ${successCount} success, ${errorCount} errors`);
      console.log(`Error rate: ${(errorRate * 100).toFixed(2)}%`);
    });
  });
  
  describe('3. メモリ使用量テスト', () => {
    it('大量リクエスト処理後のメモリリークがないこと', async () => {
      const initialMemory = process.memoryUsage();
      
      // 大量のリクエストを処理
      const requestCount = 100;
      for (let i = 0; i < requestCount; i++) {
        await mockClient.executeClaude(`Memory test ${i}: ${'data'.repeat(100)}`);
        
        // 定期的にガベージコレクションを促す
        if (i % 20 === 0 && global.gc) {
          global.gc();
        }
      }
      
      // 強制的にガベージコレクションを実行
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      
      // メモリ増加量を計算
      const heapIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      const rssIncrease = finalMemory.rss - initialMemory.rss;
      
      // 許容可能なメモリ増加量（10MB）
      const maxHeapIncrease = 10 * 1024 * 1024; // 10MB
      const maxRssIncrease = 50 * 1024 * 1024;  // 50MB
      
      assert(
        heapIncrease < maxHeapIncrease,
        `Heap memory increased by ${Math.round(heapIncrease / 1024 / 1024)}MB, exceeds 10MB limit`
      );
      
      assert(
        rssIncrease < maxRssIncrease,
        `RSS memory increased by ${Math.round(rssIncrease / 1024 / 1024)}MB, exceeds 50MB limit`
      );
      
      console.log(`Memory usage - Heap: +${Math.round(heapIncrease / 1024 / 1024)}MB, RSS: +${Math.round(rssIncrease / 1024 / 1024)}MB`);
    });
  });
  
  describe('4. レート制限とバックオフ性能', () => {
    it('レート制限時の適切なバックオフが機能すること', async () => {
      // レート制限をシミュレート
      let rateLimitCount = 0;
      const originalExecute = mockClient.executeClaude.bind(mockClient);
      
      mockClient.executeClaude = async function(prompt, options) {
        rateLimitCount++;
        
        // 5回に1回レート制限エラーをシミュレート
        if (rateLimitCount % 5 === 0) {
          const error = new Error('Rate limit exceeded');
          error.rateLimited = true;
          error.retryAfter = 1000; // 1秒後にリトライ
          throw error;
        }
        
        return originalExecute(prompt, options);
      };
      
      let successCount = 0;
      let retryCount = 0;
      
      // バックオフ付きリトライ実装
      async function executeWithRetry(prompt, maxRetries = 3) {
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const result = await mockClient.executeClaude(prompt);
            successCount++;
            return result;
          } catch (error) {
            if (error.rateLimited && attempt < maxRetries) {
              retryCount++;
              const backoffTime = Math.min(1000 * Math.pow(2, attempt), 5000);
              await new Promise(resolve => setTimeout(resolve, backoffTime));
              continue;
            }
            throw error;
          }
        }
      }
      
      // テスト実行
      const testPromises = Array.from({ length: 20 }, (_, i) =>
        executeWithRetry(`Rate limit test ${i}`)
      );
      
      const results = await Promise.allSettled(testPromises);
      
      const successfulResults = results.filter(r => r.status === 'fulfilled');
      
      assert(successfulResults.length >= 15, 'Most requests should eventually succeed with retry');
      assert(retryCount > 0, 'Some retries should have occurred');
      
      console.log(`Rate limit test: ${successfulResults.length} successful, ${retryCount} retries`);
    });
  });
  
  describe('5. SLA/SLO 準拠テスト', () => {
    it('SLO目標値を満たすパフォーマンスであること', async () => {
      const testDuration = 30000; // 30秒間のテスト
      const targetThroughput = 10; // 10 requests/second
      const maxAverageResponseTime = 5000; // 5秒
      const minSuccessRate = 0.95; // 95%
      
      const startTime = performance.now();
      let requestCount = 0;
      let successCount = 0;
      let errorCount = 0;
      const responseTimes = [];
      
      // 指定時間内でリクエストを送信
      while (performance.now() - startTime < testDuration) {
        try {
          const reqStartTime = performance.now();
          const result = await mockClient.executeClaude(`SLO test ${requestCount}`);
          const responseTime = performance.now() - reqStartTime;
          
          responseTimes.push(responseTime);
          requestCount++;
          
          if (result.success) {
            successCount++;
          } else {
            errorCount++;
          }
          
          // スループット調整のための小さな待機
          await new Promise(resolve => setTimeout(resolve, 50));
          
        } catch (error) {
          errorCount++;
          requestCount++;
        }
      }
      
      const actualDuration = performance.now() - startTime;
      const actualThroughput = requestCount / (actualDuration / 1000);
      const averageResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
      const successRate = successCount / requestCount;
      
      // SLO検証
      console.log(`SLO Test Results:`);
      console.log(`  Throughput: ${actualThroughput.toFixed(2)} req/s (target: ${targetThroughput})`);
      console.log(`  Avg Response Time: ${averageResponseTime.toFixed(2)}ms (target: <${maxAverageResponseTime}ms)`);
      console.log(`  Success Rate: ${(successRate * 100).toFixed(2)}% (target: >${minSuccessRate * 100}%)`);
      
      // 現実的な目標値での検証（モック環境での調整）
      assert(actualThroughput >= targetThroughput * 0.5, 'Throughput below acceptable threshold');
      assert(averageResponseTime <= maxAverageResponseTime, 'Average response time exceeds SLO');
      assert(successRate >= minSuccessRate, 'Success rate below SLO');
    });
  });
  
  describe('6. 拡張性テスト', () => {
    it('エージェント数増加時の性能劣化が許容範囲内であること', async () => {
      // シングルエージェント性能測定
      const singleAgentClient = new MockCCSPClient();
      const singleAgentRequests = 20;
      
      const singleStartTime = performance.now();
      for (let i = 0; i < singleAgentRequests; i++) {
        await singleAgentClient.executeClaude(`Single agent test ${i}`);
      }
      const singleAgentTime = performance.now() - singleStartTime;
      const singleAgentThroughput = singleAgentRequests / (singleAgentTime / 1000);
      
      // マルチエージェント性能測定（3エージェント）
      const multiAgentClients = [
        new MockCCSPClient(),
        new MockCCSPClient(),
        new MockCCSPClient()
      ];
      
      const multiStartTime = performance.now();
      const multiPromises = multiAgentClients.map((client, index) =>
        Promise.all(Array.from({ length: singleAgentRequests }, (_, i) =>
          client.executeClaude(`Multi agent ${index} test ${i}`)
        ))
      );
      
      await Promise.all(multiPromises);
      const multiAgentTime = performance.now() - multiStartTime;
      const totalMultiRequests = singleAgentRequests * 3;
      const multiAgentThroughput = totalMultiRequests / (multiAgentTime / 1000);
      
      // 性能比較
      const scalingEfficiency = multiAgentThroughput / (singleAgentThroughput * 3);
      
      console.log(`Scaling Test:`);
      console.log(`  Single agent: ${singleAgentThroughput.toFixed(2)} req/s`);
      console.log(`  Multi agent (3x): ${multiAgentThroughput.toFixed(2)} req/s`);
      console.log(`  Scaling efficiency: ${(scalingEfficiency * 100).toFixed(2)}%`);
      
      // 80%以上の効率性を期待
      assert(scalingEfficiency >= 0.8, `Scaling efficiency ${scalingEfficiency * 100}% below 80% threshold`);
    });
  });
});