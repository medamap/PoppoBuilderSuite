#!/usr/bin/env node

/**
 * CCSP統合の実際の動作テスト
 * 
 * 使用方法:
 *   node test/integration/test-ccsp-integration.js
 */

const Redis = require('ioredis');
const AgentIntegration = require('../../src/agent-integration');
const Logger = require('../../src/logger');

// テスト用のIssue
const testIssue = {
  number: 999,
  title: 'CCSP統合テスト',
  body: `このIssueはCCSP統合のテスト用です。

以下のタスクを実行してください：
1. 現在の日時を表示
2. PoppoBuilder Suiteのバージョンを確認
3. "Hello from CCSP Integration!" というメッセージを出力

これはテスト実行なので、実際のコード変更は行わないでください。`,
  labels: [
    { name: 'task:misc' },
    { name: 'test' }
  ]
};

async function testCCSPIntegration() {
  console.log('=== CCSP統合テスト開始 ===\n');
  
  const logger = new Logger('CCSP-Integration-Test');
  const redis = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379
  });
  
  try {
    // Redis接続確認
    await redis.ping();
    console.log('✓ Redis接続確認OK\n');
    
    // AgentIntegration設定
    const config = {
      agentMode: {
        enabled: true,
        taskMapping: {
          labels: {
            'task:misc': ['claude-cli']
          }
        }
      },
      ccsp: {
        enabled: true,
        responseTimeout: 60000 // 1分
      },
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379
      },
      claude: {
        modelPreference: {
          primary: 'claude-3-opus-20240229',
          fallback: 'claude-3-sonnet-20240229'
        }
      }
    };
    
    const agentIntegration = new AgentIntegration(config);
    
    // 初期化
    console.log('AgentIntegrationを初期化中...');
    await agentIntegration.initialize();
    console.log('✓ 初期化完了\n');
    
    // CCSPクライアントの確認
    if (!agentIntegration.ccspClient) {
      throw new Error('CCSPクライアントが初期化されていません');
    }
    console.log('✓ CCSPクライアント確認OK\n');
    
    // プロンプト構築のテスト
    console.log('=== プロンプト構築テスト ===');
    const prompt = agentIntegration.buildClaudePrompt(testIssue);
    console.log('生成されたプロンプト:');
    console.log('---');
    console.log(prompt);
    console.log('---\n');
    
    const systemPrompt = agentIntegration.buildSystemPrompt(testIssue);
    console.log('システムプロンプト:');
    console.log('---');
    console.log(systemPrompt);
    console.log('---\n');
    
    // ペイロード準備のテスト
    console.log('=== ペイロード準備テスト ===');
    const payload = agentIntegration.preparePayload('claude-cli', testIssue);
    console.log('生成されたペイロード:');
    console.log(JSON.stringify(payload, null, 2));
    console.log();
    
    // CCSP実行のテスト（実際の実行はスキップ）
    console.log('=== CCSP実行テスト（シミュレーション） ===');
    console.log('注意: 実際のClaude実行は行いません（レート制限保護のため）\n');
    
    // CCSPキューの状態確認
    const queueLength = await redis.llen('ccsp:requests');
    console.log(`現在のCCSPキュー長: ${queueLength}`);
    
    // ヘルスチェック
    console.log('\n=== CCSPクライアントヘルスチェック ===');
    const health = await agentIntegration.ccspClient.healthCheck();
    console.log('ヘルスステータス:');
    console.log(JSON.stringify(health, null, 2));
    
    // メトリクス確認
    console.log('\n=== メトリクス ===');
    const metrics = agentIntegration.ccspClient.getMetrics();
    console.log(JSON.stringify(metrics, null, 2));
    
    console.log('\n✅ すべてのテストが正常に完了しました！');
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error.message);
    console.error(error.stack);
  } finally {
    // クリーンアップ
    if (agentIntegration) {
      await agentIntegration.shutdown();
    }
    await redis.quit();
    console.log('\n=== テスト終了 ===');
  }
}

// テスト実行
if (require.main === module) {
  testCCSPIntegration().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { testCCSPIntegration };