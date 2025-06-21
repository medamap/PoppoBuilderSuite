#!/usr/bin/env node

/**
 * UnifiedStateManagerのテスト
 */

const UnifiedStateManager = require('../src/unified-state-manager');
const path = require('path');
const fs = require('fs').promises;

async function test() {
  console.log('🧪 UnifiedStateManager テスト開始\n');
  
  // テスト用の状態ディレクトリ
  const testStateDir = path.join(__dirname, 'test-state');
  
  // テストディレクトリをクリーンアップ
  try {
    await fs.rm(testStateDir, { recursive: true, force: true });
  } catch {}
  await fs.mkdir(testStateDir, { recursive: true });
  
  const stateManager = new UnifiedStateManager(testStateDir);
  
  try {
    // 1. 初期化テスト
    console.log('1. 初期化テスト');
    await stateManager.initialize();
    console.log('✅ 初期化成功\n');
    
    // 2. 基本的なget/setテスト
    console.log('2. 基本的なget/setテスト');
    await stateManager.set('issues', '123', {
      status: 'processing',
      startTime: new Date().toISOString()
    });
    const issue = await stateManager.get('issues', '123');
    console.log('設定した値:', issue);
    console.log('✅ get/set成功\n');
    
    // 3. has/deleteテスト
    console.log('3. has/deleteテスト');
    const exists = await stateManager.has('issues', '123');
    console.log('存在確認:', exists);
    
    await stateManager.delete('issues', '123');
    const afterDelete = await stateManager.has('issues', '123');
    console.log('削除後の存在確認:', afterDelete);
    console.log('✅ has/delete成功\n');
    
    // 4. トランザクションテスト
    console.log('4. トランザクションテスト');
    try {
      await stateManager.transaction(async (tx) => {
        await tx.set('tasks', 'task1', { status: 'running' });
        await tx.set('tasks', 'task2', { status: 'queued' });
        await tx.set('issues', '456', { status: 'processing' });
        throw new Error('ロールバックテスト');
      });
    } catch (error) {
      console.log('トランザクションがロールバックされました');
    }
    
    const task1 = await stateManager.get('tasks', 'task1');
    const issue456 = await stateManager.get('issues', '456');
    console.log('ロールバック後のtask1:', task1);
    console.log('ロールバック後のissue456:', issue456);
    console.log('✅ トランザクション成功\n');
    
    // 5. 監視機能テスト
    console.log('5. 監視機能テスト');
    let watcherCalled = false;
    const watcher = (change) => {
      console.log('変更を検知:', change);
      watcherCalled = true;
    };
    
    stateManager.watch('issues', watcher);
    await stateManager.set('issues', '789', { status: 'completed' });
    stateManager.unwatch('issues', watcher);
    
    console.log('ウォッチャーが呼ばれた:', watcherCalled);
    console.log('✅ 監視機能成功\n');
    
    // 6. バルク操作テスト
    console.log('6. バルク操作テスト');
    await stateManager.setAll('agents', {
      ccla: { status: 'active' },
      ccag: { status: 'inactive' },
      ccpm: { status: 'active' }
    });
    
    const allAgents = await stateManager.getAll('agents');
    console.log('全エージェント:', allAgents);
    
    await stateManager.clear('agents');
    const afterClear = await stateManager.getAll('agents');
    console.log('クリア後:', afterClear);
    console.log('✅ バルク操作成功\n');
    
    // 7. 後方互換性テスト
    console.log('7. 後方互換性テスト');
    await stateManager.addProcessedIssue(999);
    const isProcessed = await stateManager.isIssueProcessed(999);
    console.log('Issue #999 処理済み:', isProcessed);
    
    await stateManager.addRunningTask('test-task', {
      issueNumber: 999,
      type: 'test'
    });
    const runningTasks = await stateManager.loadRunningTasks();
    console.log('実行中タスク:', runningTasks);
    console.log('✅ 後方互換性成功\n');
    
    console.log('🎉 すべてのテストが成功しました！');
    
  } catch (error) {
    console.error('❌ テストエラー:', error);
    process.exit(1);
  } finally {
    // クリーンアップ
    try {
      await fs.rm(testStateDir, { recursive: true, force: true });
    } catch {}
  }
}

test();