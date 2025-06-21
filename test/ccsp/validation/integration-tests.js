/**
 * CCSP統合テストスイート
 * 
 * PoppoBuilder → CCSP フローの統合テスト
 */

const CCSPTestFramework = require('../framework/test-framework');
const CCSPAgent = require('../../../agents/ccsp/index');
const { AdvancedCCSPClient } = require('../../../src/ccsp-client-advanced');

/**
 * CCSP統合テストスイート
 */
class CCSPIntegrationTests {
  constructor() {
    this.framework = new CCSPTestFramework({
      testTimeout: 60000, // 1分
      retryAttempts: 2,
      metricsCollection: true
    });
    
    this.ccspAgent = null;
    this.testClients = [];
  }
  
  /**
   * テストスイートの実行
   */
  async run() {
    console.log('=== CCSP統合テスト開始 ===\n');
    
    try {
      await this.framework.initialize();
      
      const testSuite = {
        name: 'CCSP Integration Tests',
        parallel: false, // 順次実行でデータの整合性を保つ
        tests: [
          {
            name: 'PoppoBuilder to CCSP Communication',
            execute: this.testPoppoBuilderCommunication.bind(this),
            setup: this.setupIntegrationTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Multi-Agent CCSP Usage',
            execute: this.testMultiAgentUsage.bind(this),
            setup: this.setupMultiAgentTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Error Handling and Recovery',
            execute: this.testErrorHandlingRecovery.bind(this),
            setup: this.setupErrorHandlingTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Concurrent Request Processing',
            execute: this.testConcurrentProcessing.bind(this),
            setup: this.setupConcurrentTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Request Timeout and Retry Logic',
            execute: this.testTimeoutRetry.bind(this),
            setup: this.setupTimeoutTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Performance and Throughput',
            execute: this.testPerformanceThroughput.bind(this),
            setup: this.setupPerformanceTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Data Integrity and Message Format',
            execute: this.testDataIntegrity.bind(this),
            setup: this.setupDataIntegrityTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'CCSP Agent Lifecycle Management',
            execute: this.testAgentLifecycle.bind(this),
            setup: this.setupLifecycleTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          }
        ]
      };
      
      const results = await this.framework.runTestSuite(testSuite);
      await this.framework.generateReports();
      
      return results;
      
    } finally {
      await this.framework.cleanup();
    }
  }
  
  /**
   * 統合テストのセットアップ
   */
  async setupIntegrationTest(environment) {
    // CCSPエージェントを起動
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 3
    });
    
    await this.ccspAgent.start();
    
    // テストクライアントの作成
    const client = new AdvancedCCSPClient({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      responseTimeout: 30000
    });
    
    this.testClients.push(client);
    environment.ccspAgent = this.ccspAgent;
    environment.client = client;
  }
  
  /**
   * PoppoBuilder通信テスト
   */
  async testPoppoBuilderCommunication(environment, mockServices) {
    const client = environment.client;
    const mockClaude = mockServices.get('claude');
    
    // 正常なレスポンスを設定
    mockClaude.setResponse('success', {
      code: 0,
      stdout: 'PoppoBuilder integration test completed successfully',
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    // PoppoBuilderからのリクエストをシミュレート
    const request = {
      requestId: 'integration-poppo-1',
      fromAgent: 'poppo-builder',
      taskType: 'claude-cli',
      prompt: 'Issue #144のテストを実行してください。',
      metadata: {
        issueNumber: 144,
        priority: 'high',
        source: 'github-issue'
      },
      timestamp: new Date().toISOString()
    };
    
    const result = await client.sendRequest(request, {
      timeout: 30000,
      maxRetries: 2
    });
    
    // 検証
    if (!result.success) {
      throw new Error('PoppoBuilder communication should succeed');
    }
    
    if (!result.output) {
      throw new Error('Response should contain output');
    }
    
    if (!result.requestId || result.requestId !== request.requestId) {
      throw new Error('Request ID should be preserved');
    }
    
    return {
      success: true,
      requestId: result.requestId,
      responseTime: result.executionTime,
      outputLength: result.output.length,
      metadataPreserved: !!result.metadata
    };
  }
  
  /**
   * マルチエージェントテストのセットアップ
   */
  async setupMultiAgentTest(environment) {
    await this.setupIntegrationTest(environment);
    
    // 複数のエージェント用クライアントを作成
    const agentTypes = ['ccla', 'ccag', 'ccpm', 'ccqa'];
    
    for (const agentType of agentTypes) {
      const client = new AdvancedCCSPClient({
        redis: {
          host: 'localhost',
          port: 6379,
          db: 15
        },
        responseTimeout: 30000,
        agentId: agentType
      });
      
      this.testClients.push(client);
    }
    
    environment.agentClients = this.testClients.slice(1); // 最初のクライアントを除く
  }
  
  /**
   * マルチエージェント使用テスト
   */
  async testMultiAgentUsage(environment, mockServices) {
    const agentClients = environment.agentClients;
    const mockClaude = mockServices.get('claude');
    
    // 正常なレスポンスを設定
    mockClaude.setResponse('success', {
      code: 0,
      stdout: 'Multi-agent test completed',
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    // 複数エージェントから同時にリクエスト
    const requests = agentClients.map((client, index) => ({
      requestId: `multi-agent-${index}`,
      fromAgent: `test-agent-${index}`,
      taskType: 'claude-cli',
      prompt: `Multi-agent test from agent ${index}`,
      timestamp: new Date().toISOString()
    }));
    
    const startTime = Date.now();
    
    const results = await Promise.all(
      requests.map((request, index) => 
        agentClients[index].sendRequest(request, {
          timeout: 20000,
          maxRetries: 1
        })
      )
    );
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    
    // 検証
    const successfulResults = results.filter(r => r.success);
    
    if (successfulResults.length !== requests.length) {
      throw new Error(`Expected ${requests.length} successful results, got ${successfulResults.length}`);
    }
    
    // すべてのリクエストIDが保持されているか確認
    for (let i = 0; i < results.length; i++) {
      if (results[i].requestId !== requests[i].requestId) {
        throw new Error(`Request ID mismatch for agent ${i}`);
      }
    }
    
    return {
      success: true,
      totalAgents: agentClients.length,
      successfulRequests: successfulResults.length,
      totalTime: totalTime,
      averageResponseTime: successfulResults.reduce((sum, r) => sum + r.executionTime, 0) / successfulResults.length
    };
  }
  
  /**
   * エラーハンドリングテストのセットアップ
   */
  async setupErrorHandlingTest(environment) {
    await this.setupIntegrationTest(environment);
  }
  
  /**
   * エラーハンドリングと回復テスト
   */
  async testErrorHandlingRecovery(environment, mockServices) {
    const client = environment.client;
    const mockClaude = mockServices.get('claude');
    
    // 最初にエラーレスポンスを設定
    mockClaude.setResponse('genericError', {
      code: 1,
      stdout: 'Execute error%',
      stderr: 'Simulated execution error'
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'genericError';
    
    const errorRequest = {
      requestId: 'error-handling-1',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'This should fail initially',
      timestamp: new Date().toISOString()
    };
    
    // エラーレスポンスを確認
    const errorResult = await client.sendRequest(errorRequest, {
      timeout: 10000,
      maxRetries: 0 // リトライなし
    });
    
    if (errorResult.success) {
      throw new Error('Request should fail with generic error');
    }
    
    // 正常なレスポンスに変更
    mockClaude.setResponse('success', {
      code: 0,
      stdout: 'Recovery test completed successfully',
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    // 回復後のリクエスト
    const recoveryRequest = {
      requestId: 'error-recovery-1',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'This should succeed after recovery',
      timestamp: new Date().toISOString()
    };
    
    const recoveryResult = await client.sendRequest(recoveryRequest, {
      timeout: 10000,
      maxRetries: 1
    });
    
    if (!recoveryResult.success) {
      throw new Error('Recovery request should succeed');
    }
    
    return {
      success: true,
      errorDetected: !errorResult.success,
      recoverySuccessful: recoveryResult.success,
      errorMessage: errorResult.error,
      recoveryTime: recoveryResult.executionTime
    };
  }
  
  /**
   * 並行処理テストのセットアップ
   */
  async setupConcurrentTest(environment) {
    // より多くの並行処理を許可
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 5
    });
    
    await this.ccspAgent.start();
    
    const client = new AdvancedCCSPClient({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      responseTimeout: 30000
    });
    
    this.testClients.push(client);
    environment.ccspAgent = this.ccspAgent;
    environment.client = client;
  }
  
  /**
   * 並行リクエスト処理テスト
   */
  async testConcurrentProcessing(environment, mockServices) {
    const client = environment.client;
    const mockClaude = mockServices.get('claude');
    
    // レスポンス時間を設定（リアルな遅延をシミュレート）
    process.env.CLAUDE_MOCK_DELAY = '1000'; // 1秒
    
    mockClaude.setResponse('success', {
      code: 0,
      stdout: 'Concurrent test completed',
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    // 複数の並行リクエストを生成
    const concurrentRequests = [];
    for (let i = 0; i < 8; i++) {
      concurrentRequests.push({
        requestId: `concurrent-${i}`,
        fromAgent: 'test-agent',
        taskType: 'claude-cli',
        prompt: `Concurrent test ${i}`,
        timestamp: new Date().toISOString()
      });
    }
    
    const startTime = Date.now();
    
    // 並行実行
    const results = await Promise.all(
      concurrentRequests.map(request => 
        client.sendRequest(request, {
          timeout: 15000,
          maxRetries: 1
        })
      )
    );
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    
    // 検証
    const successfulResults = results.filter(r => r.success);
    
    if (successfulResults.length !== concurrentRequests.length) {
      throw new Error(`Expected ${concurrentRequests.length} successful results, got ${successfulResults.length}`);
    }
    
    // 並行処理の効果を確認（理論上は8秒かかるが、並行処理により短縮される）
    const expectedSequentialTime = concurrentRequests.length * 1000; // 8秒
    const efficiency = (expectedSequentialTime - totalTime) / expectedSequentialTime;
    
    return {
      success: true,
      totalRequests: concurrentRequests.length,
      successfulRequests: successfulResults.length,
      totalTime: totalTime,
      expectedSequentialTime: expectedSequentialTime,
      efficiency: efficiency,
      averageResponseTime: successfulResults.reduce((sum, r) => sum + r.executionTime, 0) / successfulResults.length
    };
  }
  
  /**
   * タイムアウトテストのセットアップ
   */
  async setupTimeoutTest(environment) {
    await this.setupIntegrationTest(environment);
  }
  
  /**
   * タイムアウトとリトライテスト
   */
  async testTimeoutRetry(environment, mockServices) {
    const client = environment.client;
    const mockClaude = mockServices.get('claude');
    
    // 長い遅延を設定してタイムアウトをシミュレート
    process.env.CLAUDE_MOCK_DELAY = '8000'; // 8秒（タイムアウトより長い）
    
    mockClaude.setResponse('success', {
      code: 0,
      stdout: 'This should timeout',
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    const timeoutRequest = {
      requestId: 'timeout-test-1',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'This request should timeout',
      timestamp: new Date().toISOString()
    };
    
    const startTime = Date.now();
    
    // 短いタイムアウトでリクエスト
    const result = await client.sendRequest(timeoutRequest, {
      timeout: 3000, // 3秒
      maxRetries: 2
    });
    
    const endTime = Date.now();
    const actualTime = endTime - startTime;
    
    // タイムアウトが発生することを確認
    if (result.success) {
      throw new Error('Request should timeout');
    }
    
    if (!result.error.includes('timeout') && !result.error.includes('Timeout')) {
      throw new Error('Error should indicate timeout');
    }
    
    // 遅延をリセット
    delete process.env.CLAUDE_MOCK_DELAY;
    
    // 正常なリクエストでリトライをテスト
    const retryRequest = {
      requestId: 'retry-test-1',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'This should succeed after retry',
      timestamp: new Date().toISOString()
    };
    
    const retryResult = await client.sendRequest(retryRequest, {
      timeout: 10000,
      maxRetries: 3
    });
    
    if (!retryResult.success) {
      throw new Error('Retry request should succeed');
    }
    
    return {
      success: true,
      timeoutDetected: !result.success,
      timeoutTime: actualTime,
      retrySuccessful: retryResult.success,
      errorMessage: result.error
    };
  }
  
  /**
   * パフォーマンステストのセットアップ
   */
  async setupPerformanceTest(environment) {
    await this.setupConcurrentTest(environment); // 並行処理設定を使用
  }
  
  /**
   * パフォーマンスとスループットテスト
   */
  async testPerformanceThroughput(environment, mockServices) {
    const client = environment.client;
    const mockClaude = mockServices.get('claude');
    
    // 短い遅延で多数のリクエストを処理
    process.env.CLAUDE_MOCK_DELAY = '200'; // 200ms
    
    mockClaude.setResponse('success', {
      code: 0,
      stdout: 'Performance test',
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    const numberOfRequests = 20;
    const requests = [];
    
    for (let i = 0; i < numberOfRequests; i++) {
      requests.push({
        requestId: `perf-test-${i}`,
        fromAgent: 'test-agent',
        taskType: 'claude-cli',
        prompt: `Performance test ${i}`,
        timestamp: new Date().toISOString()
      });
    }
    
    const startTime = Date.now();
    
    // バッチ処理でスループットを測定
    const batchSize = 5;
    const results = [];
    
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(request => 
          client.sendRequest(request, {
            timeout: 10000,
            maxRetries: 1
          })
        )
      );
      
      results.push(...batchResults);
    }
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    
    const successfulResults = results.filter(r => r.success);
    const throughput = (successfulResults.length / totalTime) * 1000; // requests/second
    
    return {
      success: true,
      totalRequests: numberOfRequests,
      successfulRequests: successfulResults.length,
      totalTime: totalTime,
      throughput: throughput,
      averageResponseTime: successfulResults.reduce((sum, r) => sum + r.executionTime, 0) / successfulResults.length
    };
  }
  
  /**
   * データ整合性テストのセットアップ
   */
  async setupDataIntegrityTest(environment) {
    await this.setupIntegrationTest(environment);
  }
  
  /**
   * データ整合性とメッセージフォーマットテスト
   */
  async testDataIntegrity(environment, mockServices) {
    const client = environment.client;
    const mockClaude = mockServices.get('claude');
    
    // 複雑なデータ構造を含むレスポンスを設定
    const complexOutput = JSON.stringify({
      analysis: 'Test analysis',
      recommendations: ['Rec 1', 'Rec 2'],
      metrics: {
        performance: 0.95,
        reliability: 0.98
      },
      timestamp: new Date().toISOString()
    });
    
    mockClaude.setResponse('success', {
      code: 0,
      stdout: complexOutput,
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    // 複雑なメタデータを含むリクエスト
    const request = {
      requestId: 'data-integrity-1',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'データ整合性テスト',
      metadata: {
        issueNumber: 144,
        tags: ['test', 'integration'],
        priority: 'high',
        nested: {
          level1: {
            level2: 'deep value'
          }
        },
        unicode: '日本語テスト 🚀',
        special: 'Special chars: !@#$%^&*()'
      },
      timestamp: new Date().toISOString()
    };
    
    const result = await client.sendRequest(request, {
      timeout: 10000,
      maxRetries: 1
    });
    
    if (!result.success) {
      throw new Error('Data integrity test should succeed');
    }
    
    // メタデータの保持確認
    if (!result.metadata) {
      throw new Error('Metadata should be preserved');
    }
    
    if (result.metadata.unicode !== request.metadata.unicode) {
      throw new Error('Unicode characters should be preserved');
    }
    
    if (result.metadata.nested.level1.level2 !== request.metadata.nested.level1.level2) {
      throw new Error('Nested metadata should be preserved');
    }
    
    // 出力データの整合性確認
    let parsedOutput;
    try {
      parsedOutput = JSON.parse(result.output);
    } catch (error) {
      throw new Error('Output should be valid JSON');
    }
    
    if (!parsedOutput.analysis || !parsedOutput.recommendations) {
      throw new Error('Complex output structure should be preserved');
    }
    
    return {
      success: true,
      metadataPreserved: true,
      unicodeHandled: true,
      nestedDataPreserved: true,
      outputStructureValid: true,
      requestId: result.requestId
    };
  }
  
  /**
   * ライフサイクルテストのセットアップ
   */
  async setupLifecycleTest(environment) {
    // このテスト用の新しいエージェントを作成
    environment.lifecycleAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 2
    });
  }
  
  /**
   * CCSPエージェントライフサイクル管理テスト
   */
  async testAgentLifecycle(environment, mockServices) {
    const agent = environment.lifecycleAgent;
    
    // エージェントの起動
    await agent.start();
    
    let healthStatus = await agent.getHealthStatus();
    if (!healthStatus.running) {
      throw new Error('Agent should be running after start');
    }
    
    // 一時停止（実装されている場合）
    if (typeof agent.pause === 'function') {
      await agent.pause();
      
      healthStatus = await agent.getHealthStatus();
      if (healthStatus.running && !healthStatus.paused) {
        throw new Error('Agent should be paused');
      }
      
      // 再開
      if (typeof agent.resume === 'function') {
        await agent.resume();
        
        healthStatus = await agent.getHealthStatus();
        if (!healthStatus.running || healthStatus.paused) {
          throw new Error('Agent should be running after resume');
        }
      }
    }
    
    // エージェントの停止
    await agent.stop();
    
    healthStatus = await agent.getHealthStatus();
    if (healthStatus.running) {
      throw new Error('Agent should not be running after stop');
    }
    
    return {
      success: true,
      startupSuccessful: true,
      shutdownSuccessful: true,
      pauseResumeSupported: typeof agent.pause === 'function',
      finalStatus: healthStatus
    };
  }
  
  /**
   * テストクリーンアップ
   */
  async cleanupTest(environment) {
    // CCSPエージェントの停止
    if (this.ccspAgent) {
      await this.ccspAgent.stop();
      this.ccspAgent = null;
    }
    
    if (environment.lifecycleAgent) {
      await environment.lifecycleAgent.stop();
    }
    
    // テストクライアントのクリーンアップ
    for (const client of this.testClients) {
      if (typeof client.cleanup === 'function') {
        await client.cleanup();
      }
    }
    this.testClients = [];
    
    // 環境変数のクリーンアップ
    delete process.env.CLAUDE_MOCK_RESPONSE;
    delete process.env.CLAUDE_MOCK_DELAY;
    
    // Redis のクリーンアップ
    const redis = this.framework.mockServices.get('redis');
    if (redis) {
      await redis.flushall();
    }
  }
}

module.exports = CCSPIntegrationTests;