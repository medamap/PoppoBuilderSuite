/**
 * Issue #130: Enhanced Lock Manager 基本機能テスト
 */

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EnhancedIssueLockManager = require('../src/enhanced-issue-lock-manager');

// テスト用の一時ディレクトリ
const TEST_LOCK_DIR = path.join(os.tmpdir(), `test-enhanced-locks-simple-${Date.now()}`);

// モックLogger
class MockLogger {
  info() {}
  warn() {}
  error() {}
  debug() {}
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanupTestDir() {
  try {
    await fs.rm(TEST_LOCK_DIR, { recursive: true });
  } catch (error) {
    // ディレクトリが存在しない場合は無視
  }
}

// テスト実行
async function runTests() {
  console.log('=== Issue #130 Enhanced Lock Manager 基本テスト開始 ===\n');
  
  // 各テスト前にクリーンアップ
  await cleanupTestDir();
  
  // テスト1: 基本的なロック取得とタイムアウト
  console.log('テスト1: タイムアウト付きロック取得');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // 最初のロック取得（成功するはず）
      const acquired1 = await lockManager.acquireLockWithTimeout(1, { priority: 'high' }, 5000);
      assert.strictEqual(acquired1, true, '最初のロック取得は成功するべき');
      
      // 同じIssueに対する2番目のロック取得（タイムアウトするはず）
      const startTime = Date.now();
      try {
        await lockManager.acquireLockWithTimeout(1, { priority: 'normal' }, 1000);
        assert.fail('2番目のロック取得はタイムアウトするべき');
      } catch (error) {
        const duration = Date.now() - startTime;
        assert(duration >= 900 && duration <= 1200, `タイムアウト時間が適切でない: ${duration}ms`);
        assert(error.message.includes('timeout'), 'タイムアウトエラーメッセージが適切でない');
      }
      
      // ロック解放
      const released = await lockManager.releaseLock(1);
      assert.strictEqual(released, true, 'ロック解放は成功するべき');
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: タイムアウト付きロック取得\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // テスト2: ロック状態チェック
  console.log('テスト2: ロック状態チェック');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // ロック取得前
      const noLock = await lockManager.checkLock(2);
      assert.strictEqual(noLock, null, 'ロック取得前はnullが返されるべき');
      
      // ロック取得
      await lockManager.acquireLockWithTimeout(2, { taskId: 'test-task' }, 1000);
      
      // ロック状態チェック
      const lockData = await lockManager.checkLock(2);
      assert(lockData !== null, 'ロック取得後はロックデータが返されるべき');
      assert.strictEqual(lockData.issueNumber, 2, 'Issue番号が正しいべき');
      assert.strictEqual(lockData.lockedBy.taskId, 'test-task', 'タスクIDが正しいべき');
      
      // ロック有効性チェック
      const isValid = lockManager.isLockValid(lockData);
      assert.strictEqual(isValid, true, 'ロックが有効であるべき');
      
      // ロック解放
      await lockManager.releaseLock(2);
      
      // ロック解放後
      const noLockAfter = await lockManager.checkLock(2);
      assert.strictEqual(noLockAfter, null, 'ロック解放後はnullが返されるべき');
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: ロック状態チェック\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // テスト3: 統計情報の取得
  console.log('テスト3: 統計情報の取得');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // 初期統計
      const initialStatus = await lockManager.getLockStatus();
      assert.strictEqual(initialStatus.activeLocks.length, 0, '初期状態ではアクティブロックは0であるべき');
      assert.strictEqual(initialStatus.waitingQueues.length, 0, '初期状態では待機キューは0であるべき');
      
      // ロック取得
      await lockManager.acquireLockWithTimeout(3, { priority: 'high', taskId: 'stats-test' });
      
      // 統計確認
      const status = await lockManager.getLockStatus();
      assert.strictEqual(status.activeLocks.length, 1, 'アクティブロックが1つあるべき');
      assert.strictEqual(status.activeLocks[0].issueNumber, 3, 'Issue番号が正しいべき');
      assert.strictEqual(status.activeLocks[0].taskId, 'stats-test', 'タスクIDが正しいべき');
      
      // 統計カウンター
      assert(status.stats.lockAcquired >= 1, 'ロック取得統計が正しいべき');
      assert.strictEqual(status.stats.lockReleased, 0, 'まだロック解放されていないべき');
      
      // ロック解放
      await lockManager.releaseLock(3);
      
      // 解放後の統計
      const afterStatus = await lockManager.getLockStatus();
      assert.strictEqual(afterStatus.activeLocks.length, 0, 'ロック解放後はアクティブロックは0であるべき');
      assert(afterStatus.stats.lockReleased >= 1, 'ロック解放統計が更新されるべき');
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: 統計情報の取得\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // テスト4: イベント処理
  console.log('テスト4: イベント処理');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      let lockAcquiredEvent = null;
      let lockReleasedEvent = null;
      
      // イベントリスナー設定
      lockManager.on('lock-acquired', (event) => {
        lockAcquiredEvent = event;
      });
      
      lockManager.on('lock-released', (event) => {
        lockReleasedEvent = event;
      });
      
      // ロック取得
      await lockManager.acquireLockWithTimeout(4, { taskId: 'event-test' });
      
      // ロック取得イベントの確認
      assert(lockAcquiredEvent !== null, 'ロック取得イベントが発火されるべき');
      assert.strictEqual(lockAcquiredEvent.issueNumber, 4, 'ロック取得イベントのIssue番号が正しいべき');
      
      // ロック解放
      await lockManager.releaseLock(4);
      
      // ロック解放イベントの確認
      assert(lockReleasedEvent !== null, 'ロック解放イベントが発火されるべき');
      assert.strictEqual(lockReleasedEvent.issueNumber, 4, 'ロック解放イベントのIssue番号が正しいべき');
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: イベント処理\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // クリーンアップ
  await cleanupTestDir();
  
  console.log('=== すべてのテストが成功しました！ ===');
}

// テスト実行
runTests().catch(error => {
  console.error('テストエラー:', error);
  cleanupTestDir().then(() => process.exit(1));
});