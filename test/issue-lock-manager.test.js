const IssueLockManager = require('../src/issue-lock-manager');
const fs = require('fs').promises;
const path = require('path');
const assert = require('assert');

describe('IssueLockManager', () => {
  let lockManager;
  const lockDir = '.test-locks';
  
  beforeEach(async () => {
    // テスト用のロックディレクトリを作成
    await fs.mkdir(lockDir, { recursive: true });
    lockManager = new IssueLockManager(lockDir, console);
    await lockManager.initialize();
  });
  
  afterEach(async () => {
    // クリーンアップ
    if (lockManager) {
      await lockManager.shutdown();
    }
    
    // ロックディレクトリを削除
    try {
      const files = await fs.readdir(lockDir);
      for (const file of files) {
        await fs.unlink(path.join(lockDir, file));
      }
      await fs.rmdir(lockDir);
    } catch (error) {
      // エラーは無視
    }
  });

  describe('acquireLock', () => {
    it('新しいロックを取得できる', async () => {
      const result = await lockManager.acquireLock(123, {
        taskId: 'test-task-123',
        type: 'test'
      });
      
      assert.strictEqual(result, true);
      
      // ロックファイルが作成されたことを確認
      const lockFile = path.join(lockDir, 'issue-123.lock');
      const exists = await fs.access(lockFile).then(() => true).catch(() => false);
      assert.strictEqual(exists, true);
    });
    
    it('既にロックされているIssueに対しては失敗する', async () => {
      // 最初のロック
      const result1 = await lockManager.acquireLock(123);
      assert.strictEqual(result1, true);
      
      // 2回目のロック試行
      const result2 = await lockManager.acquireLock(123);
      assert.strictEqual(result2, false);
    });
    
    it('期限切れのロックは上書きできる', async () => {
      // 期限切れのロックを作成
      const expiredLock = {
        issueNumber: 123,
        lockedAt: new Date(Date.now() - 2 * 3600000).toISOString(), // 2時間前
        lockedBy: {
          pid: 99999, // 存在しないPID
          sessionId: 'expired-session',
          taskId: 'expired-task'
        },
        type: 'issue_processing',
        ttl: 3600000, // 1時間
        expiresAt: new Date(Date.now() - 3600000).toISOString() // 1時間前に期限切れ
      };
      
      const lockFile = path.join(lockDir, 'issue-123.lock');
      await fs.writeFile(lockFile, JSON.stringify(expiredLock, null, 2));
      
      // 新しいロックを取得
      const result = await lockManager.acquireLock(123);
      assert.strictEqual(result, true);
    });
  });

  describe('releaseLock', () => {
    it('自分のロックは解放できる', async () => {
      const pid = process.pid;
      await lockManager.acquireLock(123, { pid });
      
      const result = await lockManager.releaseLock(123, pid);
      assert.strictEqual(result, true);
      
      // ロックファイルが削除されたことを確認
      const lockFile = path.join(lockDir, 'issue-123.lock');
      const exists = await fs.access(lockFile).then(() => true).catch(() => false);
      assert.strictEqual(exists, false);
    });
    
    it('他のプロセスのロックは解放できない', async () => {
      await lockManager.acquireLock(123, { pid: 99999 });
      
      const result = await lockManager.releaseLock(123, process.pid);
      assert.strictEqual(result, false);
    });
    
    it('存在しないロックの解放は問題ない', async () => {
      const result = await lockManager.releaseLock(999);
      assert.strictEqual(result, false);
    });
  });

  describe('checkLock', () => {
    it('ロックの状態を確認できる', async () => {
      await lockManager.acquireLock(123, {
        taskId: 'test-task',
        type: 'test'
      });
      
      const lockData = await lockManager.checkLock(123);
      assert.strictEqual(lockData.issueNumber, 123);
      assert.strictEqual(lockData.lockedBy.taskId, 'test-task');
      assert.strictEqual(lockData.type, 'test');
    });
    
    it('存在しないロックはnullを返す', async () => {
      const lockData = await lockManager.checkLock(999);
      assert.strictEqual(lockData, null);
    });
  });

  describe('isLockValid', () => {
    it('有効期限内のロックは有効', () => {
      const lockData = {
        expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1時間後
        lockedBy: {
          pid: process.pid,
          hostname: require('os').hostname()
        }
      };
      
      const result = lockManager.isLockValid(lockData);
      assert.strictEqual(result, true);
    });
    
    it('期限切れのロックは無効', () => {
      const lockData = {
        expiresAt: new Date(Date.now() - 3600000).toISOString(), // 1時間前
        lockedBy: {
          pid: process.pid,
          hostname: require('os').hostname()
        }
      };
      
      const result = lockManager.isLockValid(lockData);
      assert.strictEqual(result, false);
    });
    
    it('存在しないプロセスのロックは無効', () => {
      const lockData = {
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        lockedBy: {
          pid: 99999, // 存在しないPID
          hostname: require('os').hostname()
        }
      };
      
      const result = lockManager.isLockValid(lockData);
      assert.strictEqual(result, false);
    });
  });

  describe('cleanup', () => {
    it('期限切れのロックを削除する', async () => {
      // 期限切れのロックを作成
      const expiredLock = {
        issueNumber: 123,
        lockedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
        lockedBy: {
          pid: 99999,
          sessionId: 'expired-session',
          taskId: 'expired-task'
        },
        type: 'issue_processing',
        ttl: 3600000,
        expiresAt: new Date(Date.now() - 3600000).toISOString()
      };
      
      const lockFile = path.join(lockDir, 'issue-123.lock');
      await fs.writeFile(lockFile, JSON.stringify(expiredLock, null, 2));
      
      // 有効なロックも作成
      await lockManager.acquireLock(456);
      
      // クリーンアップ実行
      await lockManager.cleanup();
      
      // 期限切れのロックは削除される
      const expired = await fs.access(lockFile).then(() => true).catch(() => false);
      assert.strictEqual(expired, false);
      
      // 有効なロックは残る
      const valid = await fs.access(path.join(lockDir, 'issue-456.lock')).then(() => true).catch(() => false);
      assert.strictEqual(valid, true);
    });
  });

  describe('releaseAllLocks', () => {
    it('指定されたPIDのすべてのロックを解放する', async () => {
      const pid = process.pid;
      
      // 複数のロックを作成
      await lockManager.acquireLock(123, { pid });
      await lockManager.acquireLock(456, { pid });
      await lockManager.acquireLock(789, { pid: 99999 }); // 他のPID
      
      // 自分のロックをすべて解放
      const released = await lockManager.releaseAllLocks(pid);
      assert.strictEqual(released, 2);
      
      // 自分のロックは削除される
      const lock1 = await fs.access(path.join(lockDir, 'issue-123.lock')).then(() => true).catch(() => false);
      const lock2 = await fs.access(path.join(lockDir, 'issue-456.lock')).then(() => true).catch(() => false);
      assert.strictEqual(lock1, false);
      assert.strictEqual(lock2, false);
      
      // 他のPIDのロックは残る
      const lock3 = await fs.access(path.join(lockDir, 'issue-789.lock')).then(() => true).catch(() => false);
      assert.strictEqual(lock3, true);
    });
  });

  describe('getActiveLocks', () => {
    it('アクティブなロックのリストを取得できる', async () => {
      // 複数のロックを作成
      await lockManager.acquireLock(123);
      await lockManager.acquireLock(456);
      
      // 期限切れのロックも作成
      const expiredLock = {
        issueNumber: 789,
        lockedAt: new Date(Date.now() - 2 * 3600000).toISOString(),
        lockedBy: {
          pid: 99999,
          sessionId: 'expired-session',
          taskId: 'expired-task'
        },
        type: 'issue_processing',
        ttl: 3600000,
        expiresAt: new Date(Date.now() - 3600000).toISOString()
      };
      
      const lockFile = path.join(lockDir, 'issue-789.lock');
      await fs.writeFile(lockFile, JSON.stringify(expiredLock, null, 2));
      
      // アクティブなロックを取得
      const activeLocks = await lockManager.getActiveLocks();
      
      // 期限切れのロックは含まれない
      assert.strictEqual(activeLocks.length, 2);
      assert.ok(activeLocks.some(lock => lock.issueNumber === 123));
      assert.ok(activeLocks.some(lock => lock.issueNumber === 456));
      assert.ok(!activeLocks.some(lock => lock.issueNumber === 789));
    });
  });
});

// テスト実行
if (require.main === module) {
  const { exec } = require('child_process');
  console.log('IssueLockManagerのテストを実行中...');
  
  exec('npm test -- test/issue-lock-manager.test.js', (error, stdout, stderr) => {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (error) {
      console.error('テスト実行エラー:', error);
      process.exit(1);
    }
  });
}