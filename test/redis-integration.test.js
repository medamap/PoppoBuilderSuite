/**
 * Redis統合テスト
 * MirinRedisAmbassadorとRedisStateClientの連携動作確認
 */

const { MirinRedisAmbassador, PoppoRedisKeys } = require('../src/mirin-redis-ambassador');
const RedisStateClient = require('../src/redis-state-client');
const Redis = require('ioredis');

// テスト用ログレベル
const testLogger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: () => {} // デバッグログは無効化
};

// テスト用GitHubクライアントモック
const mockGitHub = {
  getIssue: async (issueNumber) => ({
    number: issueNumber,
    labels: [{ name: 'task:test' }]
  }),
  addLabels: async (issueNumber, labels) => {
    console.log(`[Mock GitHub] Adding labels to #${issueNumber}:`, labels);
  },
  removeLabels: async (issueNumber, labels) => {
    console.log(`[Mock GitHub] Removing labels from #${issueNumber}:`, labels);
  },
  addComment: async (issueNumber, comment) => {
    console.log(`[Mock GitHub] Adding comment to #${issueNumber}:`, comment.substring(0, 100) + '...');
  }
};

// テストヘルパー
async function clearRedisTestData() {
  const redis = new Redis();
  const keys = await redis.keys('poppo:*');
  if (keys.length > 0) {
    await redis.del(...keys);
    console.log(`Cleared ${keys.length} Redis keys`);
  }
  redis.disconnect();
}

// メインテスト
async function runIntegrationTest() {
  console.log('🧪 Redis統合テスト開始\n');

  let mirin = null;
  let poppoClient = null;
  let directRedis = null;

  try {
    // 1. Redis接続テスト
    console.log('1️⃣ Redis接続テスト');
    directRedis = new Redis();
    const pong = await directRedis.ping();
    console.log(`   ✅ Redis接続確認: ${pong}`);
    
    // テストデータクリア
    await clearRedisTestData();

    // 2. MirinRedisAmbassador起動
    console.log('\n2️⃣ MirinRedisAmbassador起動');
    mirin = new MirinRedisAmbassador({
      github: mockGitHub,
      logger: testLogger,
      heartbeatInterval: 5000, // テスト用に短縮
      orphanCheckInterval: 10000 // テスト用に短縮
    });
    
    await mirin.initialize();
    console.log('   ✅ MirinRedisAmbassador初期化完了');

    // 3. RedisStateClient接続
    console.log('\n3️⃣ RedisStateClient接続');
    poppoClient = new RedisStateClient('test-poppo-process', {
      logger: testLogger,
      heartbeatInterval: 5000
    });
    
    await poppoClient.connect();
    console.log('   ✅ RedisStateClient接続完了');

    // 4. ハートビートテスト
    console.log('\n4️⃣ ハートビートテスト');
    const heartbeatResult = await poppoClient.sendHeartbeat();
    console.log('   ✅ ハートビート送信成功:', heartbeatResult.message);

    // 5. Issueチェックアウトテスト
    console.log('\n5️⃣ Issueチェックアウトテスト');
    const checkoutResult = await poppoClient.checkoutIssue(102, 'dogfooding');
    console.log('   ✅ Issue #102 チェックアウト成功:', checkoutResult.message);

    // Redis内容確認
    const issueStatus = await directRedis.hgetall(PoppoRedisKeys.issue(102).status);
    console.log('   📊 Issue状態:', issueStatus);

    // 6. Issue状態取得テスト
    console.log('\n6️⃣ Issue状態取得テスト');
    const statusResult = await poppoClient.getIssueStatus(102);
    console.log('   ✅ Issue状態取得成功:', statusResult.status);

    // 7. 処理中Issue一覧テスト
    console.log('\n7️⃣ 処理中Issue一覧取得テスト');
    const listResult = await poppoClient.listProcessingIssues();
    console.log('   ✅ 処理中Issue:', listResult.count, '件');
    console.log('   📊 詳細:', listResult.issues);

    // 8. 別プロセスでの同じIssueチェックアウト（競合テスト）
    console.log('\n8️⃣ 競合テスト（同じIssueを別プロセスでチェックアウト）');
    const poppoClient2 = new RedisStateClient('test-poppo-process-2', {
      logger: testLogger
    });
    await poppoClient2.connect();
    
    try {
      await poppoClient2.checkoutIssue(102, 'feature');
      console.log('   ❌ 競合エラーが発生しませんでした（予期しない結果）');
    } catch (error) {
      console.log('   ✅ 期待通り競合エラー:', error.message);
    }
    await poppoClient2.disconnect();

    // 9. Issueチェックインテスト
    console.log('\n9️⃣ Issueチェックインテスト');
    const checkinResult = await poppoClient.checkinIssue(102, 'completed', {
      completedAt: new Date().toISOString(),
      duration: '5 minutes'
    });
    console.log('   ✅ Issue #102 チェックイン成功:', checkinResult.message);

    // 10. 処理済み確認
    console.log('\n🔟 処理済み確認');
    const processedIssues = await directRedis.smembers(PoppoRedisKeys.lists().processedIssues);
    console.log('   ✅ 処理済みIssue:', processedIssues);

    // 11. プロセス生存確認テスト
    console.log('\n1️⃣1️⃣ プロセス生存確認テスト');
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2秒待機
    const isAlive = mirin.isProcessAlive(process.pid);
    console.log(`   ✅ 現在のプロセス(PID: ${process.pid})は生存中: ${isAlive}`);
    
    const isDead = mirin.isProcessAlive(99999); // 存在しないPID
    console.log(`   ✅ 存在しないプロセス(PID: 99999)は死亡: ${!isDead}`);

    // 12. 孤児Issue検出テスト（シミュレーション）
    console.log('\n1️⃣2️⃣ 孤児Issue検出テスト');
    
    // 孤児Issueをシミュレート（ハートビートを削除）
    await directRedis.sadd(PoppoRedisKeys.lists().processingIssues, 999);
    await directRedis.hset(PoppoRedisKeys.issue(999).status, {
      status: 'processing',
      processId: 'dead-process',
      pid: 99999,
      taskType: 'test',
      startTime: new Date(Date.now() - 3600000).toISOString() // 1時間前
    });
    
    const orphans = await mirin.checkOrphanedIssues();
    console.log('   ✅ 孤児Issue検出:', orphans.length, '件');
    if (orphans.length > 0) {
      console.log('   📊 孤児Issue詳細:', orphans);
    }

    // 13. 統計情報確認
    console.log('\n1️⃣3️⃣ クライアント統計情報');
    const stats = poppoClient.getStats();
    console.log('   📊 統計:', stats);

    // 14. パフォーマンステスト
    console.log('\n1️⃣4️⃣ パフォーマンステスト（100回の操作）');
    const startTime = Date.now();
    
    for (let i = 0; i < 100; i++) {
      await poppoClient.sendHeartbeat();
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`   ✅ 100回のハートビート送信完了: ${elapsed}ms (平均: ${elapsed/100}ms/回)`);

    console.log('\n✅ すべてのテストが成功しました！');

  } catch (error) {
    console.error('\n❌ テストエラー:', error);
    throw error;
  } finally {
    // クリーンアップ
    console.log('\n🧹 クリーンアップ中...');
    
    if (poppoClient) {
      await poppoClient.disconnect();
    }
    
    if (mirin) {
      await mirin.shutdown();
    }
    
    if (directRedis) {
      await clearRedisTestData();
      directRedis.disconnect();
    }
    
    console.log('✅ クリーンアップ完了');
  }
}

// エラーハンドリング
process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
  process.exit(1);
});

// テスト実行
console.log('='.repeat(60));
console.log('PoppoBuilder Redis統合テスト');
console.log('='.repeat(60));

runIntegrationTest()
  .then(() => {
    console.log('\n🎉 統合テスト完了！');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n💥 統合テスト失敗:', error);
    process.exit(1);
  });