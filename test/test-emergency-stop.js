/**
 * CCSPの緊急停止機能テスト
 * 
 * 警告: このテストは実際にはClaude APIを呼び出しません（モックを使用）
 */

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

// Redisクライアント
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379
});

// テストシナリオ
async function testEmergencyStop() {
  console.log('🧪 CCSPの緊急停止機能テストを開始します...\n');
  
  // テスト1: レート制限エラーのシミュレーション
  console.log('Test 1: レート制限エラーのシミュレーション');
  const rateLimitRequest = {
    requestId: uuidv4(),
    fromAgent: 'test-script',
    taskType: 'claude-cli',
    prompt: 'SIMULATE_RATE_LIMIT',
    systemPrompt: 'This is a test to trigger rate limit error',
    timestamp: new Date().toISOString()
  };
  
  await redis.lpush('ccsp:requests', JSON.stringify(rateLimitRequest));
  console.log('✅ レート制限テストリクエストを送信しました\n');
  
  // 少し待機
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // テスト2: セッションタイムアウトのシミュレーション
  console.log('Test 2: セッションタイムアウトのシミュレーション');
  const sessionTimeoutRequest = {
    requestId: uuidv4(),
    fromAgent: 'test-script',
    taskType: 'claude-cli',
    prompt: 'SIMULATE_SESSION_TIMEOUT',
    systemPrompt: 'This is a test to trigger session timeout',
    timestamp: new Date().toISOString()
  };
  
  await redis.lpush('ccsp:requests', JSON.stringify(sessionTimeoutRequest));
  console.log('✅ セッションタイムアウトテストリクエストを送信しました\n');
  
  // レスポンスを待機
  console.log('📡 CCSPからのレスポンスを待機中...');
  
  // レスポンスリスナー
  const responseKey = `ccsp:response:test-script`;
  let waitCount = 0;
  const maxWait = 30; // 30秒まで待機
  
  while (waitCount < maxWait) {
    const response = await redis.blpop(responseKey, 1);
    if (response) {
      const [, data] = response;
      const result = JSON.parse(data);
      console.log('\n📥 レスポンス受信:');
      console.log(JSON.stringify(result, null, 2));
      
      if (result.error === 'SESSION_TIMEOUT' || result.rateLimitInfo) {
        console.log('\n✅ 緊急停止機能が正常に動作することを確認しました！');
        console.log('CCSPはエラーを検出して停止します。');
        break;
      }
    }
    
    waitCount++;
    process.stdout.write('.');
  }
  
  if (waitCount >= maxWait) {
    console.log('\n⏱️ タイムアウト: CCSPからのレスポンスがありません');
    console.log('CCSPが既に停止している可能性があります。');
  }
  
  // クリーンアップ
  await redis.quit();
  console.log('\n🏁 テスト完了');
}

// 実行
testEmergencyStop().catch(error => {
  console.error('❌ テストエラー:', error);
  redis.quit();
  process.exit(1);
});