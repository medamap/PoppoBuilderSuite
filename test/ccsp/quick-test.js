#!/usr/bin/env node

/**
 * CCSP クイックテスト
 * 
 * 簡易的な動作確認のための軽量テスト
 */

const CCSPTestFramework = require('./framework/test-framework');

class CCSPQuickTest {
  constructor() {
    this.framework = new CCSPTestFramework({
      testTimeout: 10000, // 10秒
      retryAttempts: 1,
      metricsCollection: false
    });
  }
  
  async run() {
    console.log('⚡ CCSP クイックテスト開始\n');
    
    try {
      await this.framework.initialize();
      
      const testSuite = {
        name: 'CCSP Quick Test',
        parallel: false,
        tests: [
          {
            name: 'Mock Services Initialization',
            execute: this.testMockServicesInit.bind(this),
            setup: () => {},
            cleanup: () => {}
          },
          {
            name: 'Basic CCSP Request Format',
            execute: this.testBasicRequestFormat.bind(this),
            setup: () => {},
            cleanup: () => {}
          }
        ]
      };
      
      const results = await this.framework.runTestSuite(testSuite);
      
      console.log('\n📊 クイックテスト結果:');
      console.log(`✅ 成功: ${results.passed}件`);
      console.log(`❌ 失敗: ${results.failed}件`);
      
      if (results.failed === 0) {
        console.log('\n🎉 クイックテストが成功しました！');
        return true;
      } else {
        console.log('\n⚠️  一部のテストが失敗しました。');
        return false;
      }
      
    } finally {
      await this.framework.cleanup();
    }
  }
  
  /**
   * モックサービス初期化テスト
   */
  async testMockServicesInit(environment, mockServices) {
    // Redisモック確認
    const redis = mockServices.get('redis');
    if (!redis) {
      throw new Error('Redis mock not initialized');
    }
    
    // 基本的なRedis操作テスト
    await redis.set('test:key', 'test-value');
    const value = await redis.get('test:key');
    
    if (value !== 'test-value') {
      throw new Error('Redis mock basic operation failed');
    }
    
    // Claude CLIモック確認
    const claudeMock = mockServices.get('claude');
    if (!claudeMock) {
      throw new Error('Claude CLI mock not initialized');
    }
    
    return {
      success: true,
      redisOperations: 1,
      claudeMockAvailable: true
    };
  }
  
  /**
   * 基本リクエスト形式テスト
   */
  async testBasicRequestFormat(environment, mockServices) {
    const redis = mockServices.get('redis');
    
    // 正しい形式のリクエストを作成
    const validRequest = {
      requestId: 'quick-test-1',
      fromAgent: 'quick-test-agent',
      type: 'claude-cli', // これが重要!
      prompt: 'Test prompt for quick test',
      priority: 'normal',
      timestamp: new Date().toISOString()
    };
    
    // リクエストをキューに送信
    await redis.lpush('ccsp:requests', JSON.stringify(validRequest));
    
    // キューの長さを確認
    const queueLength = await redis.llen('ccsp:requests');
    
    if (queueLength !== 1) {
      throw new Error(`Expected queue length 1, got ${queueLength}`);
    }
    
    // リクエストを取得して形式確認
    const result = await redis.rpop('ccsp:requests');
    const parsedRequest = JSON.parse(result);
    
    if (!parsedRequest.type) {
      throw new Error('Request missing required type field');
    }
    
    if (parsedRequest.type !== 'claude-cli') {
      throw new Error('Request type field incorrect');
    }
    
    return {
      success: true,
      requestFormat: 'valid',
      queueOperations: 'working'
    };
  }
}

// CLI実行
if (require.main === module) {
  const quickTest = new CCSPQuickTest();
  quickTest.run().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('💥 クイックテストでエラー:', error.message);
    process.exit(1);
  });
}

module.exports = CCSPQuickTest;