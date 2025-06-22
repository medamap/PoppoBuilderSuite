/**
 * CCSP Phase 4 - 統合テスト
 * 高度な制御機能とモニタリングの動作確認
 */

const CCSPAgent = require('../agents/ccsp');
const { execSync } = require('child_process');

async function runTest() {
  console.log('=== CCSP Phase 4 統合テスト ===\n');
  
  // CCSPエージェントのインスタンス作成
  const ccspAgent = new CCSPAgent({
    maxConcurrent: 1,
    tokensPerMinute: 100000,
    requestsPerMinute: 50
  });
  
  try {
    console.log('1. CCSP エージェントを起動...');
    await ccspAgent.start();
    console.log('✅ 起動完了\n');
    
    // APIテスト
    console.log('2. API機能テスト...');
    
    // キュー状態
    console.log('  - キュー状態を取得:');
    const queueStatus = await ccspAgent.getQueueStatus();
    console.log('    優先度別キューサイズ:', queueStatus.queues);
    console.log('    一時停止状態:', queueStatus.isPaused);
    
    // レート制限状態
    console.log('\n  - レート制限状態を取得:');
    const rateLimitStatus = await ccspAgent.getRateLimitStatus();
    console.log('    現在の使用率:', rateLimitStatus.utilization);
    console.log('    推奨遅延:', rateLimitStatus.recommendations.delay + 'ms');
    console.log('    推奨アクション:', rateLimitStatus.recommendations.action);
    
    // 使用量統計
    console.log('\n  - 使用量統計を取得:');
    const usageStats = await ccspAgent.getUsageStats('realtime');
    console.log('    現在のトークン使用量:', usageStats.current?.tokens || 0);
    console.log('    現在のリクエスト数:', usageStats.current?.requests || 0);
    
    // エージェント別統計
    console.log('\n  - エージェント別統計を取得:');
    const agentStats = await ccspAgent.getAgentStats();
    console.log('    登録エージェント数:', agentStats.length);
    
    // エラー統計
    console.log('\n  - エラー統計を取得:');
    const errorStats = await ccspAgent.getErrorStats();
    console.log('    総エラー数:', errorStats.summary.total);
    console.log('    エラー種別数:', errorStats.summary.types);
    
    // 使用パターン
    console.log('\n  - 使用パターンを取得:');
    const patterns = await ccspAgent.getUsagePatterns();
    console.log('    ピーク時間:', patterns.peakHours);
    console.log('    静かな時間:', patterns.quietHours);
    console.log('    トレンド:', patterns.trend);
    
    // 詳細ヘルスチェック
    console.log('\n  - 詳細ヘルスチェック:');
    const health = await ccspAgent.getDetailedHealth();
    console.log('    全体ステータス:', health.status || 'N/A');
    console.log('    コンポーネント状態:', health.components);
    
    console.log('\n3. キュー管理機能テスト...');
    
    // タスクをエンキュー
    console.log('  - テストタスクをエンキュー:');
    const task1 = await ccspAgent.enqueueTask({
      id: 'test-task-1',
      type: 'test',
      data: { message: 'Test task 1' }
    }, 'normal');
    console.log('    通常優先度タスク追加:', task1.id);
    
    const task2 = await ccspAgent.enqueueTask({
      id: 'test-task-2',
      type: 'test',
      data: { message: 'Test task 2' }
    }, 'high');
    console.log('    高優先度タスク追加:', task2.id);
    
    const task3 = await ccspAgent.enqueueTask({
      id: 'test-task-3',
      type: 'test',
      data: { message: 'Test task 3' }
    }, 'scheduled', new Date(Date.now() + 60000)); // 1分後
    console.log('    スケジュールタスク追加:', task3.id);
    
    // キュー状態を再確認
    console.log('\n  - 更新後のキュー状態:');
    const updatedQueueStatus = await ccspAgent.getQueueStatus();
    console.log('    通常キュー:', updatedQueueStatus.queues.normal?.size || 0);
    console.log('    高優先度キュー:', updatedQueueStatus.queues.high?.size || 0);
    console.log('    スケジュールキュー:', updatedQueueStatus.queues.scheduled?.size || 0);
    
    // タスクを削除
    console.log('\n  - タスクを削除:');
    const removed = await ccspAgent.removeTask('test-task-2');
    console.log('    削除結果:', removed ? '成功' : '失敗');
    
    // キューをクリア
    console.log('\n  - キューをクリア:');
    await ccspAgent.clearQueue('all');
    const clearedQueueStatus = await ccspAgent.getQueueStatus();
    console.log('    クリア後の合計タスク数:', clearedQueueStatus.totalTasks);
    
    console.log('\n4. 制御機能テスト...');
    
    // キューを一時停止
    console.log('  - キューを一時停止:');
    await ccspAgent.pauseQueue();
    const pausedStatus = await ccspAgent.getQueueStatus();
    console.log('    一時停止状態:', pausedStatus.isPaused);
    
    // キューを再開
    console.log('\n  - キューを再開:');
    await ccspAgent.resumeQueue();
    const resumedStatus = await ccspAgent.getQueueStatus();
    console.log('    一時停止状態:', resumedStatus.isPaused);
    
    // 設定の更新
    console.log('\n  - 設定を更新:');
    const updatedConfig = await ccspAgent.updateConfig({
      maxConcurrent: 2,
      alertThreshold: 0.9
    });
    console.log('    更新された設定:', updatedConfig);
    
    // Prometheusメトリクスの取得
    console.log('\n  - Prometheusメトリクスを取得:');
    const metrics = await ccspAgent.getPrometheusMetrics();
    const metricsLines = metrics.split('\n').slice(0, 5);
    console.log('    メトリクス（最初の5行）:');
    metricsLines.forEach(line => console.log('      ' + line));
    
    console.log('\n✅ すべてのテストが完了しました！');
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error);
  } finally {
    console.log('\n5. クリーンアップ...');
    await ccspAgent.stop();
    console.log('✅ CCSPエージェントを停止しました');
  }
}

// テスト実行
if (require.main === module) {
  runTest().catch(console.error);
}

module.exports = { runTest };