#!/usr/bin/env node

/**
 * Redis状態管理デモスクリプト
 * 
 * Issue #102 Phase 2で実装したRedis対応StatusManagerの動作確認用
 */

const path = require('path');
const StateManagerFactory = require('../src/state-manager-factory');

async function runDemo() {
  console.log('🎋 Redis状態管理デモ開始\n');

  // Redis設定
  const config = {
    unifiedStateManagement: {
      enabled: true,
      backend: 'redis',
      redis: {
        enabled: true,
        host: '127.0.0.1',
        port: 6379,
        password: null,
        db: 0
      }
    }
  };

  // 設定の検証
  console.log('📋 設定を検証中...');
  const configInfo = StateManagerFactory.getConfigInfo(config);
  console.log(`   Backend: ${configInfo.backend}`);
  console.log(`   Valid: ${configInfo.valid}`);
  if (!configInfo.valid) {
    console.error(`   Error: ${configInfo.error}`);
    return;
  }
  console.log('✅ 設定検証完了\n');

  let statusManager;
  let unifiedStateManager;

  try {
    // StatusManagerRedisの作成
    console.log('🔧 StatusManagerRedisを初期化中...');
    statusManager = StateManagerFactory.createStatusManager(config);
    await statusManager.initialize();
    console.log('✅ StatusManagerRedis初期化完了\n');

    // UnifiedStateManagerRedisの作成
    console.log('🔧 UnifiedStateManagerRedisを初期化中...');
    unifiedStateManager = StateManagerFactory.createUnifiedStateManager(config);
    await unifiedStateManager.initialize();
    console.log('✅ UnifiedStateManagerRedis初期化完了\n');

    // デモシナリオ1: 基本的なIssue管理
    console.log('📝 デモシナリオ1: 基本的なIssue管理');
    const issueNumber = 999999; // デモ用のIssue番号（実在しないがラベル更新リクエストを作成しない）
    const processId = 'demo-process';

    // Issue処理開始
    console.log(`   Issue #${issueNumber} の処理を開始...`);
    const checkoutResult = await statusManager.checkout(issueNumber, processId, 'demo-task');
    console.log(`   ✅ チェックアウト完了: ${checkoutResult.status}`);

    // ハートビート更新
    console.log('   ハートビートを更新...');
    await statusManager.updateHeartbeat(issueNumber);
    console.log('   ✅ ハートビート更新完了');

    // ステータス確認
    const status = await statusManager.getIssueStatus(issueNumber);
    console.log(`   現在のステータス: ${status.status} (PID: ${status.pid})`);

    // Issue処理完了
    console.log('   Issue処理を完了...');
    await statusManager.checkin(issueNumber, 'completed', {
      demoResult: true,
      completedAt: new Date().toISOString()
    });
    console.log('   ✅ チェックイン完了\n');

    // デモシナリオ2: UnifiedStateManagerの使用
    console.log('📝 デモシナリオ2: UnifiedStateManagerの使用');
    
    // データの保存
    console.log('   カスタムデータを保存...');
    await unifiedStateManager.set('demo', 'test-key', {
      message: 'Hello Redis State Management!',
      timestamp: new Date().toISOString(),
      data: [1, 2, 3, 4, 5]
    });
    console.log('   ✅ データ保存完了');

    // データの読み取り
    const retrievedData = await unifiedStateManager.get('demo', 'test-key');
    console.log('   読み取りデータ:', JSON.stringify(retrievedData, null, 2));

    // トランザクション処理
    console.log('   トランザクション処理を実行...');
    await unifiedStateManager.transaction(async (manager) => {
      await manager.set('demo', 'tx-1', { value: 'transaction test 1' });
      await manager.set('demo', 'tx-2', { value: 'transaction test 2' });
      await manager.set('demo', 'tx-3', { value: 'transaction test 3' });
    });
    console.log('   ✅ トランザクション完了');

    // 全データの取得
    const allDemoData = await unifiedStateManager.getAll('demo');
    console.log(`   demo名前空間の全データ (${Object.keys(allDemoData).length}件):`);
    for (const [key, value] of Object.entries(allDemoData)) {
      console.log(`     ${key}: ${JSON.stringify(value)}`);
    }
    console.log();

    // デモシナリオ3: 統計情報の表示
    console.log('📝 デモシナリオ3: 統計情報の表示');
    const stats = await statusManager.getStatistics();
    console.log('   統計情報:');
    console.log(`     総Issue数: ${stats.total}`);
    console.log(`     処理中: ${stats.processing}`);
    console.log(`     完了: ${stats.completed}`);
    console.log(`     エラー: ${stats.error}`);
    console.log(`     応答待ち: ${stats.awaitingResponse}`);
    console.log(`     孤児: ${stats.orphaned}`);
    console.log();

    // デモシナリオ4: 孤児Issue検出
    console.log('📝 デモシナリオ4: 孤児Issue検出');
    const orphanedIssues = await statusManager.detectOrphanedIssues();
    console.log(`   検出された孤児Issue: ${orphanedIssues.length}件`);
    orphanedIssues.forEach(orphan => {
      console.log(`     Issue #${orphan.issueNumber} (プロセス: ${orphan.status.processId})`);
    });
    console.log();

    // クリーンアップ
    console.log('🧹 デモデータをクリーンアップ...');
    await unifiedStateManager.clear('demo');
    await statusManager.resetIssueStatus(issueNumber);
    console.log('✅ クリーンアップ完了\n');

    console.log('🎉 Redis状態管理デモ完了!');

  } catch (error) {
    console.error('❌ デモ実行エラー:', error);
    
    if (error.code === 'ECONNREFUSED') {
      console.log('\n💡 Redisサーバーが起動していない可能性があります。');
      console.log('   以下のコマンドでRedisを起動してください:');
      console.log('   docker-compose up -d redis');
      console.log('   または:');
      console.log('   redis-server');
    }
  } finally {
    // クリーンアップ
    if (statusManager) {
      try {
        await statusManager.cleanup();
      } catch (error) {
        console.error('StatusManager cleanup error:', error);
      }
    }
    
    if (unifiedStateManager) {
      try {
        await unifiedStateManager.cleanup();
      } catch (error) {
        console.error('UnifiedStateManager cleanup error:', error);
      }
    }
  }
}

// CLI使用時の実行
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = runDemo;