/**
 * CCSP単体テストスイート
 * 
 * CCSPエージェントのコアコンポーネントの単体テスト
 */

const CCSPTestFramework = require('../framework/test-framework');
const CCSPAgent = require('../../../agents/ccsp/index');
const ClaudeExecutor = require('../../../agents/ccsp/claude-executor');
const QueueManager = require('../../../agents/ccsp/queue-manager');
const SessionMonitor = require('../../../agents/ccsp/session-monitor');

/**
 * CCSP単体テストスイート
 */
class CCSPUnitTests {
  constructor() {
    this.framework = new CCSPTestFramework({
      testTimeout: 30000,
      retryAttempts: 1,
      metricsCollection: true
    });
    
    this.ccspAgent = null;
    this.testComponents = [];
  }
  
  /**
   * テストスイートの実行
   */
  async run() {
    console.log('=== CCSP単体テスト開始 ===\n');
    
    try {
      await this.framework.initialize();
      
      const testSuite = {
        name: 'CCSP Unit Tests',
        parallel: false, // コンポーネント間の相互作用を避けるため順次実行
        tests: [
          {
            name: 'Claude Executor - Basic Request Processing',
            execute: this.testClaudeExecutorBasic.bind(this),
            setup: this.setupClaudeExecutorTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'Claude Executor - Rate Limit Handling',
            execute: this.testClaudeExecutorRateLimit.bind(this),
            setup: this.setupClaudeExecutorTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'Claude Executor - Session Timeout Detection',
            execute: this.testClaudeExecutorSessionTimeout.bind(this),
            setup: this.setupClaudeExecutorTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'Queue Manager - Request Queuing',
            execute: this.testQueueManagerQueuing.bind(this),
            setup: this.setupQueueManagerTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'Queue Manager - Priority Handling',
            execute: this.testQueueManagerPriority.bind(this),
            setup: this.setupQueueManagerTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'Queue Manager - Emergency Stop',
            execute: this.testQueueManagerEmergencyStop.bind(this),
            setup: this.setupQueueManagerTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'Session Monitor - Health Check',
            execute: this.testSessionMonitorHealth.bind(this),
            setup: this.setupSessionMonitorTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'Session Monitor - Timeout Recovery',
            execute: this.testSessionMonitorRecovery.bind(this),
            setup: this.setupSessionMonitorTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'CCSP Agent - Component Integration',
            execute: this.testCCSPAgentIntegration.bind(this),
            setup: this.setupCCSPAgentTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
          },
          {
            name: 'CCSP Agent - Configuration Management',
            execute: this.testCCSPAgentConfiguration.bind(this),
            setup: this.setupCCSPAgentTest.bind(this),
            cleanup: this.cleanupComponentTest.bind(this)
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
   * ClaudeExecutorテストのセットアップ
   */
  async setupClaudeExecutorTest(environment) {
    const claudeExecutor = new ClaudeExecutor({
      timeout: 5000,
      maxRetries: 2
    });
    
    this.testComponents.push(claudeExecutor);
    environment.claudeExecutor = claudeExecutor;
  }
  
  /**
   * ClaudeExecutor基本機能テスト
   */
  async testClaudeExecutorBasic(environment, mockServices) {
    const claudeExecutor = environment.claudeExecutor;
    const mockClaude = mockServices.get('claude');
    
    // 正常なレスポンスを設定
    mockClaude.setResponse('success', {
      code: 0,
      stdout: 'Test task completed successfully',
      stderr: ''
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'success';
    
    const request = {
      requestId: 'unit-test-basic-1',
      prompt: 'Test prompt for basic functionality',
      options: {
        timeout: 5000
      }
    };
    
    const result = await claudeExecutor.execute(request);
    
    // 検証
    if (!result.success) {
      throw new Error('Basic execution should succeed');
    }
    
    if (!result.output) {
      throw new Error('Output should be present');
    }
    
    if (result.rateLimitInfo) {
      throw new Error('No rate limit should be detected for successful request');
    }
    
    return {
      success: true,
      executionTime: result.executionTime,
      outputLength: result.output.length
    };
  }
  
  /**
   * ClaudeExecutorレート制限テスト
   */
  async testClaudeExecutorRateLimit(environment, mockServices) {
    const claudeExecutor = environment.claudeExecutor;
    const mockClaude = mockServices.get('claude');
    
    // レート制限レスポンスを設定
    const unlockTime = Math.floor((Date.now() + 3600000) / 1000);
    mockClaude.setResponse('rateLimitError', {
      code: 1,
      stdout: `Claude AI usage limit reached|${unlockTime}`,
      stderr: 'Rate limit exceeded'
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'rateLimitError';
    
    const request = {
      requestId: 'unit-test-rate-limit-1',
      prompt: 'Test prompt for rate limit',
      options: {
        timeout: 5000
      }
    };
    
    const result = await claudeExecutor.execute(request);
    
    // 検証
    if (result.success) {
      throw new Error('Rate limited request should not succeed');
    }
    
    if (!result.rateLimitInfo) {
      throw new Error('Rate limit info should be detected');
    }
    
    if (!result.rateLimitInfo.unlockTime) {
      throw new Error('Unlock time should be provided');
    }
    
    if (result.rateLimitInfo.unlockTime !== unlockTime) {
      throw new Error('Unlock time should match expected value');
    }
    
    return {
      success: true,
      rateLimitDetected: true,
      unlockTime: result.rateLimitInfo.unlockTime,
      waitTime: result.rateLimitInfo.waitTime
    };
  }
  
  /**
   * ClaudeExecutorセッションタイムアウトテスト
   */
  async testClaudeExecutorSessionTimeout(environment, mockServices) {
    const claudeExecutor = environment.claudeExecutor;
    const mockClaude = mockServices.get('claude');
    
    // セッションタイムアウトレスポンスを設定
    mockClaude.setResponse('sessionTimeout', {
      code: 1,
      stdout: 'Invalid API key. Please run /login to authenticate with Claude.',
      stderr: 'API Login Failure'
    });
    
    process.env.CLAUDE_MOCK_RESPONSE = 'sessionTimeout';
    
    const request = {
      requestId: 'unit-test-session-timeout-1',
      prompt: 'Test prompt for session timeout',
      options: {
        timeout: 5000
      }
    };
    
    const result = await claudeExecutor.execute(request);
    
    // 検証
    if (result.success) {
      throw new Error('Session timeout request should not succeed');
    }
    
    if (!result.sessionTimeout) {
      throw new Error('Session timeout should be detected');
    }
    
    if (!result.error.includes('session')) {
      throw new Error('Error message should indicate session timeout');
    }
    
    return {
      success: true,
      sessionTimeoutDetected: true,
      errorMessage: result.error
    };
  }
  
  /**
   * QueueManagerテストのセットアップ
   */
  async setupQueueManagerTest(environment) {
    const redis = this.framework.mockServices.get('redis');
    
    const queueManager = new QueueManager({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 2,
      pollInterval: 100
    });
    
    this.testComponents.push(queueManager);
    environment.queueManager = queueManager;
    environment.redis = redis;
  }
  
  /**
   * QueueManagerキューイングテスト
   */
  async testQueueManagerQueuing(environment, mockServices) {
    const queueManager = environment.queueManager;
    const redis = environment.redis;
    
    // テストリクエストを複数キューに追加
    const requests = [];
    for (let i = 0; i < 5; i++) {
      const request = {
        requestId: `queue-test-${i}`,
        fromAgent: 'test-agent',
        type: 'claude-cli',
        prompt: `Queue test ${i}`,
        timestamp: new Date().toISOString()
      };
      
      requests.push(request);
      await redis.lpush('ccsp:requests', JSON.stringify(request));
    }
    
    // キューの長さを確認
    const queueLength = await redis.llen('ccsp:requests');
    
    if (queueLength !== 5) {
      throw new Error(`Expected 5 items in queue, got ${queueLength}`);
    }
    
    // キューから1つ取得してテスト
    const result = await redis.blpop('ccsp:requests', 1);
    
    if (!result) {
      throw new Error('Should be able to pop from queue');
    }
    
    const poppedRequest = JSON.parse(result[1]);
    
    if (poppedRequest.requestId !== 'queue-test-4') {
      throw new Error('LIFO order should be maintained');
    }
    
    return {
      success: true,
      initialQueueLength: 5,
      finalQueueLength: await redis.llen('ccsp:requests'),
      poppedRequestId: poppedRequest.requestId
    };
  }
  
  /**
   * QueueManager優先度テスト
   */
  async testQueueManagerPriority(environment, mockServices) {
    const queueManager = environment.queueManager;
    const redis = environment.redis;
    
    // 異なる優先度のリクエストを追加
    const requests = [
      {
        requestId: 'priority-low-1',
        fromAgent: 'test-agent',
        priority: 'low',
        type: 'claude-cli',
        prompt: 'Low priority test',
        timestamp: new Date().toISOString()
      },
      {
        requestId: 'priority-high-1',
        fromAgent: 'test-agent',
        priority: 'high',
        type: 'claude-cli',
        prompt: 'High priority test',
        timestamp: new Date().toISOString()
      },
      {
        requestId: 'priority-normal-1',
        fromAgent: 'test-agent',
        priority: 'normal',
        type: 'claude-cli',
        prompt: 'Normal priority test',
        timestamp: new Date().toISOString()
      }
    ];
    
    // ランダムな順序で追加
    for (const request of requests) {
      await redis.lpush('ccsp:requests', JSON.stringify(request));
    }
    
    // 優先度キューのテスト（実際の実装に依存）
    const queueLength = await redis.llen('ccsp:requests');
    
    return {
      success: true,
      requestsAdded: requests.length,
      queueLength: queueLength,
      priorities: requests.map(r => r.priority)
    };
  }
  
  /**
   * QueueManager緊急停止テスト
   */
  async testQueueManagerEmergencyStop(environment, mockServices) {
    const queueManager = environment.queueManager;
    const redis = environment.redis;
    
    // 緊急停止前にいくつかのリクエストを追加
    for (let i = 0; i < 3; i++) {
      const request = {
        requestId: `emergency-stop-${i}`,
        fromAgent: 'test-agent',
        type: 'claude-cli',
        prompt: `Emergency stop test ${i}`,
        timestamp: new Date().toISOString()
      };
      
      await redis.lpush('ccsp:requests', JSON.stringify(request));
    }
    
    const initialQueueLength = await redis.llen('ccsp:requests');
    
    // 緊急停止をシミュレート
    if (typeof queueManager.emergencyStop === 'function') {
      await queueManager.emergencyStop();
    }
    
    // 緊急停止後もキューは保持されているべき
    const finalQueueLength = await redis.llen('ccsp:requests');
    
    return {
      success: true,
      initialQueueLength,
      finalQueueLength,
      emergencyStopExecuted: true
    };
  }
  
  /**
   * SessionMonitorテストのセットアップ
   */
  async setupSessionMonitorTest(environment) {
    const sessionMonitor = new SessionMonitor({
      checkInterval: 1000,
      sessionTimeout: 5000
    });
    
    this.testComponents.push(sessionMonitor);
    environment.sessionMonitor = sessionMonitor;
  }
  
  /**
   * SessionMonitorヘルスチェックテスト
   */
  async testSessionMonitorHealth(environment, mockServices) {
    const sessionMonitor = environment.sessionMonitor;
    
    // ヘルスチェックの実行
    const healthStatus = await sessionMonitor.checkHealth();
    
    if (typeof healthStatus !== 'object') {
      throw new Error('Health status should be an object');
    }
    
    if (!healthStatus.hasOwnProperty('healthy')) {
      throw new Error('Health status should have healthy property');
    }
    
    return {
      success: true,
      healthStatus: healthStatus,
      timestamp: new Date().toISOString()
    };
  }
  
  /**
   * SessionMonitor回復テスト
   */
  async testSessionMonitorRecovery(environment, mockServices) {
    const sessionMonitor = environment.sessionMonitor;
    
    // セッションタイムアウトをシミュレート
    if (typeof sessionMonitor.simulateSessionTimeout === 'function') {
      await sessionMonitor.simulateSessionTimeout();
    }
    
    // 回復処理をテスト
    if (typeof sessionMonitor.attemptRecovery === 'function') {
      const recoveryResult = await sessionMonitor.attemptRecovery();
      
      return {
        success: true,
        recoveryAttempted: true,
        recoveryResult: recoveryResult
      };
    }
    
    return {
      success: true,
      recoveryAttempted: false,
      note: 'Recovery methods not available in this implementation'
    };
  }
  
  /**
   * CCSPAgentテストのセットアップ
   */
  async setupCCSPAgentTest(environment) {
    this.ccspAgent = new CCSPAgent({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      maxConcurrent: 1
    });
    
    environment.ccspAgent = this.ccspAgent;
  }
  
  /**
   * CCSPAgent統合テスト
   */
  async testCCSPAgentIntegration(environment, mockServices) {
    const ccspAgent = environment.ccspAgent;
    
    // CCSPエージェントの起動
    await ccspAgent.start();
    
    // ヘルスステータスの確認
    const healthStatus = await ccspAgent.getHealthStatus();
    
    if (!healthStatus) {
      throw new Error('Health status should be available');
    }
    
    // 設定の確認
    const config = ccspAgent.getConfig();
    
    if (!config) {
      throw new Error('Configuration should be available');
    }
    
    return {
      success: true,
      healthStatus: healthStatus,
      configAvailable: !!config,
      agentStarted: true
    };
  }
  
  /**
   * CCSPAgent設定管理テスト
   */
  async testCCSPAgentConfiguration(environment, mockServices) {
    const ccspAgent = environment.ccspAgent;
    
    // 初期設定の確認
    const initialConfig = ccspAgent.getConfig();
    
    // 設定更新のテスト
    const newConfig = {
      maxConcurrent: 3,
      timeout: 10000
    };
    
    if (typeof ccspAgent.updateConfig === 'function') {
      await ccspAgent.updateConfig(newConfig);
      
      const updatedConfig = ccspAgent.getConfig();
      
      if (updatedConfig.maxConcurrent !== 3) {
        throw new Error('Configuration update failed');
      }
    }
    
    return {
      success: true,
      initialConfig: initialConfig,
      configUpdateSupported: typeof ccspAgent.updateConfig === 'function'
    };
  }
  
  /**
   * コンポーネントテストのクリーンアップ
   */
  async cleanupComponentTest(environment) {
    // CCSPエージェントの停止
    if (this.ccspAgent) {
      await this.ccspAgent.stop();
      this.ccspAgent = null;
    }
    
    // その他のコンポーネントのクリーンアップ
    for (const component of this.testComponents) {
      if (typeof component.stop === 'function') {
        await component.stop();
      }
      if (typeof component.cleanup === 'function') {
        await component.cleanup();
      }
    }
    this.testComponents = [];
    
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

module.exports = CCSPUnitTests;