#!/usr/bin/env node

/**
 * セッションタイムアウト機能のテストスクリプト
 * 
 * このスクリプトは、CCSPエージェントのセッションタイムアウト検出と
 * 自動通知機能をテストします。
 */

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379
});

const responseQueue = 'ccsp:responses:test-session-timeout';

async function sendRequest(testCase) {
  const requestId = uuidv4();
  const request = {
    requestId,
    fromAgent: 'test-session-timeout',
    type: 'test',
    prompt: `This is a test for session timeout: ${testCase}`,
    context: {
      workingDirectory: process.cwd(),
      timeout: 30000,
      priority: 'high'
    },
    timestamp: new Date().toISOString()
  };
  
  console.log(`\n📤 Sending request: ${requestId}`);
  console.log(`   Test case: ${testCase}`);
  
  await redis.lpush('ccsp:requests', JSON.stringify(request));
  return requestId;
}

async function waitForResponse(requestId, timeout = 60000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const data = await redis.rpop(responseQueue);
    
    if (data) {
      const response = JSON.parse(data);
      
      if (response.requestId === requestId) {
        return response;
      } else {
        // 別のレスポンスだった場合は戻す
        await redis.lpush(responseQueue, data);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  return null;
}

async function checkSessionStatus() {
  const stateData = await redis.get('ccsp:session:state');
  if (stateData) {
    const state = JSON.parse(stateData);
    console.log('\n📊 Session State:', state);
    return state;
  }
  return null;
}

async function checkIssueInfo() {
  const issueData = await redis.get('ccsp:session:issue');
  if (issueData) {
    const issue = JSON.parse(issueData);
    console.log('\n🎫 Issue Info:', issue);
    return issue;
  }
  return null;
}

async function runTests() {
  console.log('🧪 CCSPセッションタイムアウトテスト開始\n');
  
  try {
    // テスト1: 通常のリクエスト
    console.log('=== テスト1: 通常のリクエスト ===');
    const requestId1 = await sendRequest('Normal request');
    const response1 = await waitForResponse(requestId1);
    
    if (response1) {
      console.log('✅ レスポンス受信:');
      console.log(`   Success: ${response1.success}`);
      console.log(`   Error: ${response1.error || 'なし'}`);
      if (response1.sessionTimeout) {
        console.log('   ⚠️  セッションタイムアウトが検出されました！');
      }
    } else {
      console.log('❌ タイムアウト（レスポンスなし）');
    }
    
    // セッション状態を確認
    await checkSessionStatus();
    await checkIssueInfo();
    
    // テスト2: セッションタイムアウトが発生している場合の動作確認
    if (response1 && response1.sessionTimeout) {
      console.log('\n=== テスト2: セッションタイムアウト後のリクエスト ===');
      const requestId2 = await sendRequest('Request after timeout');
      const response2 = await waitForResponse(requestId2, 10000); // 短いタイムアウト
      
      if (response2) {
        console.log('✅ レスポンス受信:');
        console.log(`   Success: ${response2.success}`);
        console.log(`   Error: ${response2.error || 'なし'}`);
        console.log(`   Message: ${response2.message || 'なし'}`);
      } else {
        console.log('❌ タイムアウト（キューがブロックされている可能性）');
      }
    }
    
    // 通知キューの状態を確認
    console.log('\n=== 通知キューの状態 ===');
    const notificationCount = await redis.llen('ccsp:notifications');
    console.log(`📬 通知キュー内のメッセージ数: ${notificationCount}`);
    
    // セッション監視の状態を最終確認
    console.log('\n=== 最終状態確認 ===');
    await checkSessionStatus();
    await checkIssueInfo();
    
  } catch (error) {
    console.error('❌ テストエラー:', error);
  } finally {
    await redis.quit();
  }
  
  console.log('\n🏁 テスト完了');
}

// メイン処理
console.log('📌 注意事項:');
console.log('1. CCSPエージェントが起動していることを確認してください');
console.log('2. Redisが起動していることを確認してください');
console.log('3. セッションタイムアウトをテストするには、Claude CLIをログアウトしてください');
console.log('   コマンド: claude logout');
console.log('\n開始するには Enter キーを押してください...');

process.stdin.once('data', () => {
  runTests().then(() => {
    process.exit(0);
  }).catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
});