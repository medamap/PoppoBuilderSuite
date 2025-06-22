#!/usr/bin/env node

/**
 * CCSP 簡単なレート制限テスト
 * 
 * タイムアウトを避けるための短時間テスト
 */

const CCSPTestFramework = require('./framework/test-framework');
const { AdvancedCCSPClient } = require('../../src/ccsp-client-advanced');

class SimpleRateLimitTest {
  constructor() {
    this.framework = new CCSPTestFramework({
      testTimeout: 15000, // 15秒
      retryAttempts: 1,
      metricsCollection: false
    });
    
    this.testClient = null;
  }
  
  async run() {
    console.log('⚡ CCSP 簡単レート制限テスト開始\n');
    
    try {
      await this.framework.initialize();
      
      const testSuite = {
        name: 'Simple Rate Limit Test',
        parallel: false,
        tests: [
          {
            name: 'Rate Limit Detection Test',
            execute: this.testRateLimitDetection.bind(this),
            setup: this.setupRateLimitTest.bind(this),
            cleanup: this.cleanupTest.bind(this)
          }
        ]
      };
      
      const results = await this.framework.runTestSuite(testSuite);
      
      console.log('\n📊 簡単レート制限テスト結果:');
      console.log(`✅ 成功: ${results.passed}件`);
      console.log(`❌ 失敗: ${results.failed}件`);
      
      if (results.failed === 0) {
        console.log('\n🎉 レート制限テストが成功しました！');
        return true;
      } else {
        console.log('\n⚠️  レート制限テストが失敗しました。');
        return false;
      }
      
    } finally {
      await this.framework.cleanup();
    }
  }
  
  /**
   * レート制限テストのセットアップ
   */
  async setupRateLimitTest(environment) {
    // CCSPクライアントを作成
    this.testClient = new AdvancedCCSPClient({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 15
      },
      responseTimeout: 8000
    });
    
    environment.testClient = this.testClient;
    
    // Claude CLIモックにレート制限レスポンスを設定
    const mockClaude = this.framework.mockServices.get('claude');
    const unlockTime = Math.floor((Date.now() + 3600000) / 1000);
    
    mockClaude.setResponse('rateLimitError', {
      code: 1,
      stdout: `Claude AI usage limit reached|${unlockTime}`,
      stderr: 'Rate limit exceeded'
    });
    
    // 環境変数設定
    process.env.CLAUDE_MOCK_RESPONSE = 'rateLimitError';
  }
  
  /**
   * レート制限検出テスト
   */
  async testRateLimitDetection(environment, mockServices) {
    const testClient = environment.testClient;
    
    // レート制限が発生するリクエストを送信
    const request = {
      requestId: 'rate-limit-test-1',
      fromAgent: 'simple-test-agent',
      type: 'claude-cli',
      prompt: 'Test prompt for rate limit detection',
      timestamp: new Date().toISOString()
    };
    
    try {
      const response = await testClient.sendRequest(request, {
        maxRetries: 0,
        timeout: 5000
      });
      
      // レスポンスがレート制限を検出したかチェック
      if (!response.rateLimitInfo) {
        throw new Error('Rate limit should have been detected');
      }
      
      if (!response.rateLimitInfo.unlockTime) {
        throw new Error('Unlock time should be provided');
      }
      
      return {
        success: true,
        rateLimitDetected: true,
        unlockTime: response.rateLimitInfo.unlockTime
      };
      
    } catch (error) {
      // エラーメッセージでレート制限が検出されたかチェック
      if (error.message.includes('rate limit') || error.message.includes('usage limit')) {
        return {
          success: true,
          rateLimitDetected: true,
          detectedViaError: true,
          errorMessage: error.message
        };
      }
      
      throw error;
    }
  }
  
  /**
   * テストクリーンアップ
   */
  async cleanupTest(environment) {
    if (this.testClient) {
      try {
        await this.testClient.disconnect();
      } catch (error) {
        console.warn('Client disconnect error:', error.message);
      }
      this.testClient = null;
    }
    
    // 環境変数クリーンアップ
    delete process.env.CLAUDE_MOCK_RESPONSE;
  }
}

// CLI実行
if (require.main === module) {
  const simpleTest = new SimpleRateLimitTest();
  simpleTest.run().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('💥 簡単レート制限テストでエラー:', error.message);
    process.exit(1);
  });
}

module.exports = SimpleRateLimitTest;