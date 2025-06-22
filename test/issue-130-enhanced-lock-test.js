/**
 * Issue #130: Enhanced Issue Lock Manager テスト
 * 並行処理ロック機構の改善とデッドロック対策のテスト
 */

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EnhancedIssueLockManager = require('../src/enhanced-issue-lock-manager');

// テスト用の一時ディレクトリ
const TEST_LOCK_DIR = path.join(os.tmpdir(), `test-enhanced-locks-${Date.now()}`);

// モックLogger
class MockLogger {
  constructor() {
    this.logs = [];
  }
  
  info(message, ...args) {
    this.logs.push({ level: 'info', message, args });
    console.log('INFO:', message, ...args);
  }
  
  warn(message, ...args) {
    this.logs.push({ level: 'warn', message, args });
    console.log('WARN:', message, ...args);
  }
  
  error(message, ...args) {
    this.logs.push({ level: 'error', message, args });
    console.log('ERROR:', message, ...args);
  }
  
  debug(message, ...args) {
    this.logs.push({ level: 'debug', message, args });
    console.log('DEBUG:', message, ...args);
  }
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function cleanupTestDir() {
  try {
    await fs.rmdir(TEST_LOCK_DIR, { recursive: true });
  } catch (error) {
    // ディレクトリが存在しない場合は無視
  }
}

// テスト実行
async function runTests() {
  console.log('=== Issue #130 Enhanced Lock Manager テスト開始 ===\n');
  
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
        await lockManager.acquireLockWithTimeout(1, { priority: 'normal' }, 2000);
        assert.fail('2番目のロック取得はタイムアウトするべき');
      } catch (error) {
        const duration = Date.now() - startTime;
        assert(duration >= 1800 && duration <= 2500, `タイムアウト時間が適切でない: ${duration}ms`);
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
  
  // テスト2: 優先度付き待機キュー
  console.log('テスト2: 優先度付き待機キュー');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // 最初のロック取得
      await lockManager.acquireLockWithTimeout(2, { priority: 'normal' }, 1000);
      
      const results = [];
      
      // 複数の異なる優先度でロック取得を試行（順次実行を保証するため）
      setTimeout(async () => {
        await lockManager.acquireLockWithTimeout(2, { priority: 'low', taskId: 'low-priority' }, 10000)
          .then(() => {
            results.push('low');
            // 処理完了後にロックを解放して次のタスクを処理可能にする
            return lockManager.releaseLock(2);
          });
      }, 50);
      
      setTimeout(async () => {
        await lockManager.acquireLockWithTimeout(2, { priority: 'urgent', taskId: 'urgent-priority' }, 10000)
          .then(() => {
            results.push('urgent');
            return lockManager.releaseLock(2);
          });
      }, 100);
      
      setTimeout(async () => {
        await lockManager.acquireLockWithTimeout(2, { priority: 'high', taskId: 'high-priority' }, 10000)
          .then(() => {
            results.push('high');
            return lockManager.releaseLock(2);
          });
      }, 150);
      
      // 少し待ってからロックを解放（最初の待機タスクを開始）
      await sleep(300);
      await lockManager.releaseLock(2);
      
      // すべてのタスクが完了するまで待機
      await sleep(2000);
      
      // 優先度順で処理されているかチェック
      assert.deepStrictEqual(results, ['urgent', 'high', 'low'], '優先度順で処理されるべき');
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: 優先度付き待機キュー\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // テスト3: デッドロック検出
  console.log('テスト3: デッドロック検出');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // デッドロック検出のイベントリスナー
      let deadlockDetected = false;
      lockManager.on('deadlock-detected', () => {
        deadlockDetected = true;
      });
      
      // プロセスAがIssue 3をロック
      await lockManager.acquireLockWithTimeout(3, { pid: 1001, taskId: 'process-a' });
      
      // プロセスBがIssue 4をロック
      await lockManager.acquireLockWithTimeout(4, { pid: 1002, taskId: 'process-b' });
      
      // プロセスAがIssue 4を待機（プロセスBが保持）
      lockManager.lockDependencies.set(1001, new Set([4]));
      
      // プロセスBがIssue 3を待機（プロセスAが保持）
      lockManager.lockDependencies.set(1002, new Set([3]));
      
      // デッドロック検出を実行
      await lockManager.detectDeadlocks();
      
      // デッドロックが検出されたかチェック
      assert.strictEqual(deadlockDetected, true, 'デッドロックが検出されるべき');
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: デッドロック検出\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // テスト4: リトライ機構
  console.log('テスト4: リトライ機構');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // 最初のロック取得
      await lockManager.acquireLockWithTimeout(5, { priority: 'normal' }, 1000);
      
      // リトライを含むロック取得（短いタイムアウトで失敗するが、リトライする）
      const startTime = Date.now();
      
      // 別のプロセスで解放をスケジュール
      setTimeout(async () => {
        await lockManager.releaseLock(5);
      }, 1500);
      
      const acquired = await lockManager.acquireLockWithTimeout(5, { priority: 'high' }, 3000);
      const duration = Date.now() - startTime;
      
      assert.strictEqual(acquired, true, 'リトライによりロック取得が成功するべき');
      assert(duration >= 1400 && duration <= 2000, `適切なタイミングでロック取得: ${duration}ms`);
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: リトライ機構\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // テスト5: ロック状態の可視化
  console.log('テスト5: ロック状態の可視化');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // 複数のロックを取得
      await lockManager.acquireLockWithTimeout(6, { priority: 'high', taskId: 'task-6' });
      await lockManager.acquireLockWithTimeout(7, { priority: 'normal', taskId: 'task-7' });
      
      // 待機キューに追加
      const waitPromise = lockManager.acquireLockWithTimeout(6, { priority: 'low', taskId: 'waiting-task' }, 5000);
      
      // 少し待ってからステータス取得
      await sleep(100);
      const status = await lockManager.getLockStatus();
      
      // ステータス内容をチェック
      assert.strictEqual(status.activeLocks.length, 2, 'アクティブなロックが2つあるべき');
      assert.strictEqual(status.waitingQueues.length, 1, '待機キューが1つあるべき');
      assert.strictEqual(status.waitingQueues[0].issueNumber, 6, '待機キューのIssue番号が正しいべき');
      assert.strictEqual(status.deadlockRisk, false, 'デッドロックリスクはfalseであるべき');
      
      // 統計情報をチェック
      assert(status.stats.lockAcquired >= 2, 'ロック取得統計が正しいべき');
      assert(status.stats.queueWaiting >= 1, '待機キュー統計が正しいべき');
      
      // クリーンアップ
      await lockManager.releaseLock(6);
      await waitPromise;
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: ロック状態の可視化\n');
      
    } catch (error) {
      await lockManager.shutdown();
      throw error;
    }
  }
  
  // テスト6: プロセス異常終了の処理
  console.log('テスト6: プロセス異常終了の処理');
  {
    const logger = new MockLogger();
    const lockManager = new EnhancedIssueLockManager(TEST_LOCK_DIR, logger);
    
    try {
      await lockManager.initialize();
      
      // 存在しないPIDでロックを作成
      const fakePid = 99999;
      const lockData = {
        issueNumber: 8,
        lockedAt: new Date().toISOString(),
        lockedBy: {
          pid: fakePid,
          sessionId: 'fake-session',
          taskId: 'fake-task',
          hostname: os.hostname()
        },
        type: 'issue_processing',
        ttl: 3600000,
        expiresAt: new Date(Date.now() + 3600000).toISOString()
      };
      
      // 偽のロックファイルを作成
      const lockFile = path.join(TEST_LOCK_DIR, 'issue-8.lock');
      await fs.writeFile(lockFile, JSON.stringify(lockData, null, 2));
      
      // プロセスが存在しないロックは無効とみなされるべき
      const isValid = lockManager.isLockValid(lockData);
      assert.strictEqual(isValid, false, '存在しないプロセスのロックは無効であるべき');
      
      // 新しいロック取得が成功するべき
      const acquired = await lockManager.acquireLockWithTimeout(8, { priority: 'normal' });
      assert.strictEqual(acquired, true, '無効なロックが存在する場合でも新しいロック取得は成功するべき');
      
      await lockManager.shutdown();
      console.log('  ✅ 成功: プロセス異常終了の処理\n');
      
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