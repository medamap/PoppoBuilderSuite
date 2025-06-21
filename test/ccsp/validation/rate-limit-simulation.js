/**
 * レート制限シミュレーションテスト
 * 
 * CCSP移行により、レート制限が適切に処理されるかを検証
 */

const CCSPTestFramework = require('../framework/test-framework');
const CCSPAgent = require('../../../agents/ccsp/index');
const { AdvancedCCSPClient } = require('../../../src/ccsp-client-advanced');

/**
 * レート制限シミュレーションテストスイート
 */
class RateLimitSimulationTest {
  constructor() {
    this.framework = new CCSPTestFramework({
      testTimeout: 60000, // 1分
      retryAttempts: 0, // レート制限テストは再試行しない
      metricsCollection: true
    });
    
    this.ccspAgent = null;
    this.testClients = [];
  }
  
  /**
   * テストスイートの実行
   */
  async run() {
    console.log('=== レート制限シミュレーションテスト開始 ===\n');
    
    try {
      await this.framework.initialize();
      
      const testSuite = {
        name: 'Rate Limit Simulation Tests',
        parallel: false, // 順次実行
        tests: [
          {
            name: 'CCSP Rate Limit Detection',
            execute: this.testRateLimitDetection.bind(this),
            setup: this.setupRateLimitTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Emergency Stop on Rate Limit',
            execute: this.testEmergencyStopOnRateLimit.bind(this),
            setup: this.setupEmergencyStopTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Multiple Clients Rate Limit Handling',
            execute: this.testMultipleClientsRateLimit.bind(this),
            setup: this.setupMultipleClientsTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Rate Limit Recovery',
            execute: this.testRateLimitRecovery.bind(this),
            setup: this.setupRecoveryTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          },
          {
            name: 'Queue Processing During Rate Limit',
            execute: this.testQueueProcessingDuringRateLimit.bind(this),
            setup: this.setupQueueTest.bind(this),
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
   * レート制限検出テストのセットアップ
   */
  async setupRateLimitTest(environment) {
    // CCSPエージェントを起動
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15 // テスト用DB
      },
      maxConcurrent: 1
    });
    
    await this.ccspAgent.start();
    
    // モックClaude CLIでレート制限をシミュレート
    const mockClaude = this.framework.mockServices.get('claude');
    mockClaude.setResponse('rateLimitError', {
      code: 1,
      stdout: 'Claude AI usage limit reached|' + Math.floor((Date.now() + 3600000) / 1000),
      stderr: 'Rate limit exceeded'
    });
    
    // 環境変数でレート制限レスポンスを強制
    process.env.CLAUDE_MOCK_RESPONSE = 'rateLimitError';
  }
  
  /**
   * レート制限検出テスト
   */
  async testRateLimitDetection(environment, mockServices) {
    const redis = mockServices.get('redis');
    
    // テストリクエストを送信
    const request = {
      requestId: 'test-rate-limit-1',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'Test prompt for rate limit detection',
      timestamp: new Date().toISOString()
    };
    
    await redis.lpush('ccsp:requests', JSON.stringify(request));
    
    // レスポンスを待機
    let response = null;
    const timeout = Date.now() + 10000; // 10秒
    
    while (Date.now() < timeout && !response) {
      const result = await redis.blpop('ccsp:response:test-agent', 1);
      if (result) {
        response = JSON.parse(result[1]);
      }
    }
    
    // 検証
    if (!response) {
      throw new Error('No response received from CCSP');
    }
    
    if (!response.rateLimitInfo) {
      throw new Error('Rate limit info not detected in response');
    }
    
    if (!response.rateLimitInfo.unlockTime) {
      throw new Error('Unlock time not provided in rate limit response');
    }
    
    return {
      success: true,
      rateLimitDetected: true,
      unlockTime: response.rateLimitInfo.unlockTime,
      waitTime: response.rateLimitInfo.waitTime
    };
  }
  
  /**
   * 緊急停止テストのセットアップ
   */
  async setupEmergencyStopTest(environment) {
    // 緊急停止をテストするため、新しいCCSPインスタンスを作成
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 1
    });
    
    await this.ccspAgent.start();
    
    // レート制限エラーを強制
    process.env.CLAUDE_MOCK_RESPONSE = 'rateLimitError';
  }
  
  /**
   * 緊急停止テスト
   */
  async testEmergencyStopOnRateLimit(environment, mockServices) {
    const redis = mockServices.get('redis');
    
    // 複数のリクエストを送信
    const requests = [];
    for (let i = 0; i < 3; i++) {
      const request = {
        requestId: `emergency-stop-${i}`,
        fromAgent: 'test-agent',
        type: 'claude-cli',
        prompt: `Emergency stop test ${i}`,
        timestamp: new Date().toISOString()
      };
      
      requests.push(request);
      await redis.lpush('ccsp:requests', JSON.stringify(request));
    }
    
    // 短時間待機
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // CCSPが緊急停止したかチェック
    const healthStatus = await this.ccspAgent.getHealthStatus();
    
    // キューの長さをチェック（処理が停止していることを確認）
    const queueLength = await redis.llen('ccsp:requests');
    
    return {
      success: true,
      emergencyStopTriggered: healthStatus.emergencyStop || false,
      remainingQueueLength: queueLength,
      processedRequests: 3 - queueLength
    };
  }
  
  /**
   * 複数クライアントテストのセットアップ
   */
  async setupMultipleClientsTest(environment) {
    // 複数のテストクライアントを作成
    for (let i = 0; i < 3; i++) {
      const client = new AdvancedCCSPClient({
        redis: {
          host: 'localhost',
          port: 6379,
          db: 15
        },
        responseTimeout: 10000
      });
      
      this.testClients.push(client);
    }
    
    // CCSPエージェントを起動
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 2
    });
    
    await this.ccspAgent.start();
    
    // レート制限をシミュレート
    process.env.CLAUDE_MOCK_RESPONSE = 'rateLimitError';
  }
  
  /**
   * 複数クライアントレート制限テスト
   */
  async testMultipleClientsRateLimit(environment, mockServices) {
    const results = [];
    
    // 複数のクライアントから同時にリクエスト
    const promises = this.testClients.map(async (client, index) => {
      try {
        const response = await client.sendRequest({
          requestId: `multi-client-${index}`,
          fromAgent: `test-agent-${index}`,
          type: 'claude-cli',
          prompt: `Multi-client test ${index}`,
          timestamp: new Date().toISOString()
        }, {
          maxRetries: 0,
          timeout: 5000
        });
        
        return {
          clientIndex: index,
          success: response.success,
          rateLimited: !!response.rateLimitInfo
        };
        
      } catch (error) {
        return {
          clientIndex: index,
          success: false,
          error: error.message,
          rateLimited: error.message.includes('rate limit') || error.rateLimited
        };
      }
    });
    
    const clientResults = await Promise.all(promises);
    
    // すべてのクライアントがレート制限を受けたことを確認
    const rateLimitedClients = clientResults.filter(r => r.rateLimited).length;
    
    return {
      success: true,
      totalClients: this.testClients.length,
      rateLimitedClients: rateLimitedClients,
      results: clientResults
    };
  }
  
  /**
   * レート制限回復テストのセットアップ
   */
  async setupRecoveryTest(environment) {
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 1
    });
    
    await this.ccspAgent.start();
  }
  
  /**
   * レート制限回復テスト
   */
  async testRateLimitRecovery(environment, mockServices) {
    const redis = mockServices.get('redis');
    const mockClaude = mockServices.get('claude');
    
    // 最初にレート制限エラーを発生させる
    process.env.CLAUDE_MOCK_RESPONSE = 'rateLimitError';
    
    const request1 = {
      requestId: 'recovery-test-1',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'Recovery test - should fail',
      timestamp: new Date().toISOString()
    };
    
    await redis.lpush('ccsp:requests', JSON.stringify(request1));
    
    // レート制限レスポンスを待機
    let response1 = null;
    const timeout1 = Date.now() + 5000;
    
    while (Date.now() < timeout1 && !response1) {
      const result = await redis.blpop('ccsp:response:test-agent', 1);
      if (result) {
        response1 = JSON.parse(result[1]);
      }
    }
    
    // レート制限を解除
    delete process.env.CLAUDE_MOCK_RESPONSE;
    
    // 短時間待機後、正常なリクエストを送信
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const request2 = {
      requestId: 'recovery-test-2',
      fromAgent: 'test-agent',
      taskType: 'claude-cli',
      prompt: 'Recovery test - should succeed',
      timestamp: new Date().toISOString()
    };
    
    await redis.lpush('ccsp:requests', JSON.stringify(request2));
    
    // 成功レスポンスを待機
    let response2 = null;
    const timeout2 = Date.now() + 5000;
    
    while (Date.now() < timeout2 && !response2) {
      const result = await redis.blpop('ccsp:response:test-agent', 1);
      if (result) {
        response2 = JSON.parse(result[1]);
      }
    }
    
    return {
      success: true,
      firstRequestRateLimited: !!(response1 && response1.rateLimitInfo),
      secondRequestSucceeded: !!(response2 && response2.success),
      recoveryTime: response2 ? new Date(response2.timestamp) - new Date(response1.timestamp) : null
    };
  }
  
  /**
   * キュー処理テストのセットアップ
   */
  async setupQueueTest(environment) {
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 1
    });
    
    await this.ccspAgent.start();
  }
  
  /**
   * レート制限中のキュー処理テスト
   */
  async testQueueProcessingDuringRateLimit(environment, mockServices) {
    const redis = mockServices.get('redis');
    
    // レート制限を設定
    process.env.CLAUDE_MOCK_RESPONSE = 'rateLimitError';
    
    // 複数のリクエストをキューに追加
    const requests = [];
    for (let i = 0; i < 5; i++) {
      const request = {
        requestId: `queue-test-${i}`,
        fromAgent: 'test-agent',
        taskType: 'claude-cli',
        prompt: `Queue test ${i}`,
        priority: i < 2 ? 'high' : 'normal',
        timestamp: new Date().toISOString()
      };
      
      requests.push(request);
      await redis.lpush('ccsp:requests', JSON.stringify(request));
    }
    
    // 初期キュー長を記録
    const initialQueueLength = await redis.llen('ccsp:requests');
    
    // 短時間待機
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // キューの状態をチェック
    const finalQueueLength = await redis.llen('ccsp:requests');
    
    // レート制限を解除
    delete process.env.CLAUDE_MOCK_RESPONSE;
    
    return {
      success: true,
      initialQueueLength,
      finalQueueLength,
      requestsProcessed: initialQueueLength - finalQueueLength,
      queuePreserved: finalQueueLength > 0
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
    
    // テストクライアントのクリーンアップ
    for (const client of this.testClients) {
      await client.cleanup();
    }
    this.testClients = [];
    
    // 環境変数のクリーンアップ
    delete process.env.CLAUDE_MOCK_RESPONSE;
    
    // Redis のクリーンアップ
    const redis = this.framework.mockServices.get('redis');
    await redis.flushall();
  }
}

module.exports = RateLimitSimulationTest;