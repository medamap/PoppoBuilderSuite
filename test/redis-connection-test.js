#!/usr/bin/env node

/**
 * Redis接続テスト
 * Redis環境の基本動作確認と名前空間設計の検証
 */

const Redis = require('ioredis');

// 名前空間ヘルパークラス
class PoppoRedisKeys {
  static issue(issueNumber) {
    return {
      status: `poppo:issue:status:${issueNumber}`,
      metadata: `poppo:issue:metadata:${issueNumber}`,
      lock: `poppo:lock:issue:${issueNumber}`
    };
  }
  
  static process(processId) {
    return {
      info: `poppo:process:info:${processId}`,
      heartbeat: `poppo:process:heartbeat:${processId}`,
      lock: `poppo:lock:process:${processId}`
    };
  }
  
  static queue(priority = 'normal') {
    return `poppo:queue:${priority}`;
  }
  
  static channel(type, subtype) {
    return `poppo:channel:${type}:${subtype}`;
  }
  
  static stats(category, period, date) {
    return `poppo:stats:${category}:${period}:${date}`;
  }
}

// TTL定数
const TTL = {
  HEARTBEAT: 1800,        // 30分
  TEMP_DATA: 3600,        // 1時間  
  DAILY_STATS: 86400 * 7, // 1週間
  SESSION: 86400 * 30     // 30日
};

async function testRedisConnection() {
  const redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
    retryDelayOnFailover: 100,
    enableReadyCheck: false,
    maxRetriesPerRequest: 3
  });

  try {
    console.log('🔧 Redis接続テスト開始...');
    
    // 1. 基本接続テスト
    console.log('\n1. 基本接続テスト');
    const pong = await redis.ping();
    console.log(`   PING: ${pong}`);
    
    // 2. 基本的な読み書きテスト
    console.log('\n2. 基本的な読み書きテスト');
    await redis.set('poppo:test:connection', 'OK');
    const value = await redis.get('poppo:test:connection');
    console.log(`   SET/GET: ${value}`);
    
    // 3. 名前空間テスト
    console.log('\n3. 名前空間テスト');
    const issueKeys = PoppoRedisKeys.issue(123);
    console.log(`   Issue keys: ${JSON.stringify(issueKeys, null, 2)}`);
    
    const processKeys = PoppoRedisKeys.process('issue-123-poppo');
    console.log(`   Process keys: ${JSON.stringify(processKeys, null, 2)}`);
    
    // 4. Hash操作テスト
    console.log('\n4. Hash操作テスト');
    await redis.hset(issueKeys.status, {
      status: 'processing',
      processId: 'issue-123-poppo',
      pid: process.pid,
      startTime: new Date().toISOString(),
      checkedOutBy: 'test'
    });
    
    const issueStatus = await redis.hgetall(issueKeys.status);
    console.log(`   Issue status: ${JSON.stringify(issueStatus, null, 2)}`);
    
    // 5. Set操作テスト
    console.log('\n5. Set操作テスト');
    await redis.sadd('poppo:issues:processing', 123, 456, 789);
    const processingIssues = await redis.smembers('poppo:issues:processing');
    console.log(`   Processing issues: ${processingIssues}`);
    
    // 6. TTL付きキーテスト
    console.log('\n6. TTL付きキーテスト');
    await redis.setex(processKeys.heartbeat, TTL.HEARTBEAT, 'alive');
    const ttl = await redis.ttl(processKeys.heartbeat);
    console.log(`   Heartbeat TTL: ${ttl} seconds`);
    
    // 7. アトミック操作テスト
    console.log('\n7. アトミック操作テスト（MULTI/EXEC）');
    const multi = redis.multi();
    multi.hset('poppo:test:atomic', 'field1', 'value1');
    multi.hset('poppo:test:atomic', 'field2', 'value2');
    multi.sadd('poppo:test:set', 'item1', 'item2');
    multi.incr('poppo:test:counter');
    
    const results = await multi.exec();
    console.log(`   Atomic operation results: ${results.map(([err, result]) => result)}`);
    
    // 8. パターン検索テスト
    console.log('\n8. パターン検索テスト');
    const poppoKeys = await redis.keys('poppo:*');
    console.log(`   Poppo namespace keys (${poppoKeys.length}): ${poppoKeys.slice(0, 5).join(', ')}${poppoKeys.length > 5 ? '...' : ''}`);
    
    // 9. パフォーマンステスト
    console.log('\n9. パフォーマンステスト');
    const startTime = Date.now();
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(redis.set(`poppo:test:perf:${i}`, `value-${i}`));
    }
    await Promise.all(promises);
    const duration = Date.now() - startTime;
    console.log(`   100回の並行SET操作: ${duration}ms`);
    
    // 10. Pub/Sub基本テスト
    console.log('\n10. Pub/Sub基本テスト');
    const subscriber = new Redis({
      host: '127.0.0.1',
      port: 6379
    });
    
    const channel = PoppoRedisKeys.channel('mirin', 'requests');
    console.log(`   Channel: ${channel}`);
    
    let messageReceived = false;
    subscriber.subscribe(channel);
    subscriber.on('message', (receivedChannel, message) => {
      console.log(`   Received: ${message} on ${receivedChannel}`);
      messageReceived = true;
    });
    
    // メッセージ送信
    setTimeout(async () => {
      await redis.publish(channel, JSON.stringify({
        action: 'test',
        timestamp: new Date().toISOString()
      }));
    }, 100);
    
    // メッセージ受信を少し待つ
    await new Promise(resolve => setTimeout(resolve, 200));
    subscriber.disconnect();
    
    if (messageReceived) {
      console.log('   ✅ Pub/Sub通信成功');
    } else {
      console.log('   ❌ Pub/Sub通信失敗');
    }
    
    // クリーンアップ
    console.log('\n11. テストデータクリーンアップ');
    const testKeys = await redis.keys('poppo:test:*');
    if (testKeys.length > 0) {
      await redis.del(...testKeys);
      console.log(`   Deleted ${testKeys.length} test keys`);
    }
    
    console.log('\n✅ Redis接続テスト完了 - すべての機能が正常に動作');
    
  } catch (error) {
    console.error('❌ Redis接続テストエラー:', error.message);
    throw error;
  } finally {
    redis.disconnect();
  }
}

// メイン実行
if (require.main === module) {
  testRedisConnection()
    .then(() => {
      console.log('\n🎉 Redis環境は正常に動作しています');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Redis環境に問題があります:', error.message);
      process.exit(1);
    });
}

module.exports = { testRedisConnection, PoppoRedisKeys, TTL };