/**
 * CCSPエージェントのテストクライアント
 * 
 * 使用方法: node test-client.js
 */

const Redis = require('ioredis');
const { v4: uuidv4 } = require('uuid');

async function testCCSP() {
  const redis = new Redis();
  
  console.log('CCSPテストクライアントを開始します...');
  
  // テストリクエストを作成
  const requestId = uuidv4();
  const request = {
    requestId,
    fromAgent: 'test-client',
    type: 'test',
    prompt: 'Hello! Please respond with "Pai-chan is working!" to confirm you are functioning.',
    systemPrompt: 'You are a test response generator. Please respond exactly as requested.',
    context: {
      workingDirectory: process.cwd(),
      timeout: 30000,
      priority: 'normal'
    },
    timestamp: new Date().toISOString()
  };
  
  console.log(`リクエストを送信: ${requestId}`);
  
  // リクエストを送信
  await redis.lpush('ccsp:requests', JSON.stringify(request));
  
  // レスポンスを待機
  console.log('レスポンスを待機中...');
  const responseQueue = 'ccsp:responses:test-client';
  const timeout = Date.now() + 30000; // 30秒タイムアウト
  
  while (Date.now() < timeout) {
    const response = await redis.rpop(responseQueue);
    
    if (response) {
      const parsed = JSON.parse(response);
      
      if (parsed.requestId === requestId) {
        console.log('\nレスポンス受信:');
        console.log('Success:', parsed.success);
        console.log('Result:', parsed.result);
        console.log('Execution Time:', parsed.executionTime, 'ms');
        
        if (parsed.error) {
          console.log('Error:', parsed.error);
        }
        
        await redis.quit();
        return;
      } else {
        // 他のリクエストのレスポンスは戻す
        await redis.lpush(responseQueue, response);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  console.log('タイムアウト: レスポンスが受信できませんでした');
  await redis.quit();
}

// 実行
testCCSP().catch(console.error);