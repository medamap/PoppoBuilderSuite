#!/usr/bin/env node

/**
 * Redis統合テスト
 * MirinRedisAmbassadorとRedisStateClientの統合テスト
 */

const { MirinRedisAmbassador } = require('../src/mirin-redis-ambassador');
const RedisStateClient = require('../src/redis-state-client');

// テスト用のモックGitHubクライアント
class MockGitHubClient {
  constructor() {
    this.labels = new Map(); // issueNumber -> [labels]
    this.comments = new Map(); // issueNumber -> [comments]
  }

  async getIssue(issueNumber) {
    return {
      number: issueNumber,
      title: `Test Issue #${issueNumber}`,
      labels: (this.labels.get(issueNumber) || []).map(name => ({ name }))
    };
  }

  async addLabels(issueNumber, labels) {
    const current = this.labels.get(issueNumber) || [];
    const updated = [...new Set([...current, ...labels])];
    this.labels.set(issueNumber, updated);
    console.log(`  MockGitHub: Issue #${issueNumber} にラベル追加: ${labels.join(', ')}`);
  }

  async removeLabels(issueNumber, labels) {
    const current = this.labels.get(issueNumber) || [];
    const updated = current.filter(label => !labels.includes(label));
    this.labels.set(issueNumber, updated);
    console.log(`  MockGitHub: Issue #${issueNumber} からラベル削除: ${labels.join(', ')}`);
  }

  async addComment(issueNumber, body) {
    const comments = this.comments.get(issueNumber) || [];
    comments.push({
      id: Date.now(),
      body,
      timestamp: new Date().toISOString()
    });
    this.comments.set(issueNumber, comments);
    console.log(`  MockGitHub: Issue #${issueNumber} にコメント追加`);
  }

  getLabels(issueNumber) {
    return this.labels.get(issueNumber) || [];
  }

  getComments(issueNumber) {
    return this.comments.get(issueNumber) || [];
  }
}

// テストロガー
class TestLogger {
  info(message, ...args) {
    console.log(`[INFO] ${message}`, ...args);
  }

  warn(message, ...args) {
    console.warn(`[WARN] ${message}`, ...args);
  }

  error(message, ...args) {
    console.error(`[ERROR] ${message}`, ...args);
  }
}

async function runIntegrationTest() {
  const logger = new TestLogger();
  const mockGitHub = new MockGitHubClient();
  
  console.log('🧪 Redis統合テスト開始\n');

  // MirinRedisAmbassadorの初期化
  const mirin = new MirinRedisAmbassador({
    github: mockGitHub,
    logger: logger,
    heartbeatInterval: 5000, // 5秒（テスト用）
    orphanCheckInterval: 10000 // 10秒（テスト用）
  });

  // RedisStateClientの初期化
  const client1 = new RedisStateClient('test-process-1', { logger });
  const client2 = new RedisStateClient('test-process-2', { logger });

  try {
    // 1. 初期化テスト
    console.log('\n1. 初期化テスト');
    await mirin.initialize();
    console.log('✅ MirinRedisAmbassador初期化完了');

    await client1.connect();
    console.log('✅ RedisStateClient1接続完了');

    await client2.connect();
    console.log('✅ RedisStateClient2接続完了');

    // 少し待機してハートビートが送信されるのを確認
    await new Promise(resolve => setTimeout(resolve, 1000));

    // 2. Issue状態管理テスト
    console.log('\n2. Issue状態管理テスト');
    
    // Issue #100をclient1がチェックアウト
    let response = await client1.checkoutIssue(100, 'dogfooding');
    console.log('✅ Issue #100 チェックアウト成功:', response.message);
    
    // GitHub上のラベル確認
    const labels = mockGitHub.getLabels(100);
    console.log(`  GitHubラベル: ${labels.join(', ')}`);
    
    // Issue状態を確認
    const status = await client2.getIssueStatus(100);
    console.log('✅ Issue状態取得:', status.status);

    // 3. 重複チェックアウトテスト
    console.log('\n3. 重複チェックアウトテスト');
    try {
      await client2.checkoutIssue(100, 'misc');
      console.log('❌ 重複チェックアウトが成功してしまった');
    } catch (error) {
      console.log('✅ 重複チェックアウト防止成功:', error.message);
    }

    // 4. 処理中Issue一覧テスト
    console.log('\n4. 処理中Issue一覧テスト');
    
    // 別のIssueもチェックアウト
    await client2.checkoutIssue(101, 'quality');
    
    const processingIssues = await client1.listProcessingIssues();
    console.log(`✅ 処理中Issue一覧 (${processingIssues.count}件):`, 
      processingIssues.issues.map(i => `#${i.issueNumber}(${i.taskType})`).join(', '));

    // 5. ハートビートテスト
    console.log('\n5. ハートビートテスト');
    const heartbeatResponse = await client1.sendHeartbeat();
    console.log('✅ ハートビート送信成功:', heartbeatResponse.message);

    // 6. チェックインテスト
    console.log('\n6. チェックインテスト');
    
    // Issue #100を完了
    await client1.checkinIssue(100, 'completed', {
      duration: 1500,
      result: 'success'
    });
    console.log('✅ Issue #100 チェックイン完了');
    
    // GitHub上のラベル確認
    const labelsAfterCheckin = mockGitHub.getLabels(100);
    console.log(`  GitHubラベル: ${labelsAfterCheckin.join(', ')}`);

    // 7. エラーチェックインテスト
    console.log('\n7. エラーチェックインテスト');
    
    await client2.checkinIssue(101, 'error', {
      error: 'Test error condition',
      stackTrace: 'Mock stack trace'
    });
    console.log('✅ Issue #101 エラーチェックイン完了');

    // 8. 孤児Issue検出テスト（手動実行）
    console.log('\n8. 孤児Issue検出テスト');
    
    // 新しいIssueをチェックアウト
    await client1.checkoutIssue(102, 'feature');
    
    // client1のプロセスが死んだと仮定して、ハートビート停止
    client1.stopHeartbeat();
    console.log('  client1のハートビートを停止（孤児状態をシミュレート）');
    
    // 孤児Issue検出を手動実行
    const orphans = await mirin.checkOrphanedIssues();
    if (orphans.length > 0) {
      console.log(`✅ 孤児Issue検出: ${orphans.length}件`);
      orphans.forEach(orphan => {
        console.log(`  - Issue #${orphan.issue} (プロセス: ${orphan.processId})`);
      });
    } else {
      console.log('  孤児Issueは検出されませんでした（プロセスがまだ生きているため）');
    }

    // 9. 直接読み取りテスト
    console.log('\n9. 直接読み取りテスト');
    
    const directStatus = await client2.directHGetAll('poppo:issue:status:102');
    console.log('✅ 直接読み取り成功:', directStatus.status);
    
    const processingList = await client2.directSMembers('poppo:issues:processing');
    console.log(`✅ 処理中Issue直接取得: ${processingList.join(', ')}`);

    // 10. 統計情報テスト
    console.log('\n10. 統計情報テスト');
    
    const stats1 = client1.getStats();
    const stats2 = client2.getStats();
    
    console.log(`✅ client1統計: 接続=${stats1.isConnected}, 健全性=${stats1.isHealthy}, 保留リクエスト=${stats1.pendingRequests}`);
    console.log(`✅ client2統計: 接続=${stats2.isConnected}, 健全性=${stats2.isHealthy}, 保留リクエスト=${stats2.pendingRequests}`);

    // 11. 緊急状態確認テスト
    console.log('\n11. 緊急状態確認テスト');
    
    const emergencyStatus = await client2.emergencyStatusCheck();
    console.log(`✅ 緊急状態確認: 処理中=${emergencyStatus.processingIssues}件, アクティブプロセス=${emergencyStatus.activeProcesses}件`);

    // 12. クリーンアップテスト
    console.log('\n12. クリーンアップテスト');
    
    // 残りのIssueをチェックイン（正しいクライアントで）
    await client1.checkinIssue(102, 'completed', { cleanupTest: true });
    console.log('✅ 残りのIssueクリーンアップ完了');

    console.log('\n🎉 すべてのテストが成功しました！');

  } catch (error) {
    console.error('\n❌ テストエラー:', error.message);
    console.error(error.stack);
    throw error;

  } finally {
    // クリーンアップ
    console.log('\n🧹 クリーンアップ開始...');
    
    await client1.disconnect();
    await client2.disconnect();
    await mirin.shutdown();
    
    console.log('✅ クリーンアップ完了');
  }
}

// パフォーマンステスト
async function runPerformanceTest() {
  console.log('\n\n⚡ パフォーマンステスト開始');
  
  const logger = new TestLogger();
  const mockGitHub = new MockGitHubClient();
  
  const mirin = new MirinRedisAmbassador({
    github: mockGitHub,
    logger: logger
  });

  const clients = [];
  for (let i = 0; i < 5; i++) {
    clients.push(new RedisStateClient(`perf-test-${i}`, { logger }));
  }

  try {
    await mirin.initialize();
    
    for (const client of clients) {
      await client.connect();
    }

    // 同時チェックアウトテスト
    const startTime = Date.now();
    const promises = [];
    
    for (let i = 0; i < 50; i++) {
      const clientIndex = i % clients.length;
      const client = clients[clientIndex];
      promises.push(client.checkoutIssue(200 + i, 'performance-test'));
    }

    const results = await Promise.allSettled(promises);
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const duration = Date.now() - startTime;

    console.log(`✅ パフォーマンステスト結果:`);
    console.log(`  - 50件の同時チェックアウト: ${duration}ms`);
    console.log(`  - 成功: ${successCount}件, 失敗: ${50 - successCount}件`);
    console.log(`  - 平均処理時間: ${(duration / 50).toFixed(2)}ms/件`);

    // クリーンアップ
    for (const client of clients) {
      await client.disconnect();
    }
    await mirin.shutdown();

  } catch (error) {
    console.error('パフォーマンステストエラー:', error);
    throw error;
  }
}

// メイン実行
if (require.main === module) {
  (async () => {
    try {
      await runIntegrationTest();
      await runPerformanceTest();
      
      console.log('\n🎊 すべてのテストが完了しました！');
      process.exit(0);
      
    } catch (error) {
      console.error('\n💥 テスト失敗:', error.message);
      process.exit(1);
    }
  })();
}

module.exports = { runIntegrationTest, runPerformanceTest };