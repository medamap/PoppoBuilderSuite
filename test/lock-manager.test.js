/**
 * Lock Manager Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { LockManager } = require('../lib/utils/lock-manager');

describe('LockManager', function() {
  this.timeout(10000);
  
  let lockManager;
  let sandbox;
  let tempDir;
  
  beforeEach(async () => {
    sandbox = sinon.createSandbox();
    
    // テンポラリディレクトリの作成
    tempDir = path.join(os.tmpdir(), `lock-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    // テスト用のLockManagerを作成
    lockManager = new LockManager({
      lockDir: tempDir,
      lockTimeout: 1000, // テスト用に短く設定
      retryInterval: 50
    });
    
    await lockManager.initialize();
  });
  
  afterEach(async () => {
    if (lockManager) {
      await lockManager.cleanup();
    }
    
    sandbox.restore();
    
    // テンポラリディレクトリのクリーンアップ
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // エラーは無視
    }
  });
  
  describe('Initialization', () => {
    it('should initialize with default options', () => {
      const lm = new LockManager();
      expect(lm.options.lockTimeout).to.equal(30000);
      expect(lm.options.retryInterval).to.equal(100);
      expect(lm.options.maxRetries).to.equal(50);
    });
    
    it('should create lock directory', async () => {
      const stats = await fs.stat(tempDir);
      expect(stats.isDirectory()).to.be.true;
    });
  });
  
  describe('Lock Acquisition', () => {
    it('should acquire a lock successfully', async () => {
      const lockId = await lockManager.acquire('test-resource');
      
      expect(lockId).to.be.a('string');
      expect(lockManager.activeLocks.has('test-resource')).to.be.true;
      
      // ロックファイルが作成されていることを確認
      const lockFile = path.join(tempDir, 'test-resource.lock');
      const stats = await fs.stat(lockFile);
      expect(stats.isFile()).to.be.true;
    });
    
    it('should emit lock-acquired event', async () => {
      const eventSpy = sandbox.spy();
      lockManager.on('lock-acquired', eventSpy);
      
      const lockId = await lockManager.acquire('test-resource');
      
      expect(eventSpy.calledOnce).to.be.true;
      expect(eventSpy.firstCall.args[0]).to.deep.equal({
        resource: 'test-resource',
        lockId
      });
    });
    
    it('should fail to acquire already locked resource', async () => {
      await lockManager.acquire('test-resource');
      
      try {
        await lockManager.acquire('test-resource', { maxRetries: 2 });
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.satisfy(msg => 
          msg.includes('Failed to acquire lock') || msg.includes('EEXIST')
        );
      }
    });
    
    it('should wait for lock if wait option is true', async () => {
      const lockId1 = await lockManager.acquire('test-resource');
      
      // 別のロック取得を開始（wait付き）
      const lockPromise = lockManager.acquire('test-resource', { wait: true });
      
      // 少し待ってから最初のロックを解放
      setTimeout(() => {
        lockManager.release('test-resource', lockId1);
      }, 100);
      
      const lockId2 = await lockPromise;
      expect(lockId2).to.be.a('string');
      expect(lockId2).to.not.equal(lockId1);
    });
  });
  
  describe('Lock Release', () => {
    it('should release a lock successfully', async () => {
      const lockId = await lockManager.acquire('test-resource');
      await lockManager.release('test-resource', lockId);
      
      expect(lockManager.activeLocks.has('test-resource')).to.be.false;
      
      // ロックファイルが削除されていることを確認
      const lockFile = path.join(tempDir, 'test-resource.lock');
      try {
        await fs.stat(lockFile);
        expect.fail('Lock file should have been deleted');
      } catch (error) {
        expect(error.code).to.equal('ENOENT');
      }
    });
    
    it('should emit lock-released event', async () => {
      const eventSpy = sandbox.spy();
      lockManager.on('lock-released', eventSpy);
      
      const lockId = await lockManager.acquire('test-resource');
      await lockManager.release('test-resource', lockId);
      
      expect(eventSpy.calledOnce).to.be.true;
      expect(eventSpy.firstCall.args[0]).to.deep.equal({
        resource: 'test-resource',
        lockId
      });
    });
    
    it('should throw error for invalid lock ID', async () => {
      const lockId = await lockManager.acquire('test-resource');
      
      try {
        await lockManager.release('test-resource', 'invalid-id');
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid lock ID');
      }
    });
  });
  
  describe('Lock Timeout', () => {
    it('should automatically release lock on timeout', async () => {
      const eventSpy = sandbox.spy();
      lockManager.on('lock-timeout', eventSpy);
      
      const lockId = await lockManager.acquire('test-resource', { timeout: 200 });
      
      // タイムアウトを待つ
      await new Promise(resolve => setTimeout(resolve, 300));
      
      expect(eventSpy.calledOnce).to.be.true;
      expect(lockManager.activeLocks.has('test-resource')).to.be.false;
    });
  });
  
  describe('Stale Lock Detection', () => {
    it('should detect and remove stale locks', async () => {
      // 古いロックファイルを手動で作成
      const lockFile = path.join(tempDir, 'stale-resource.lock');
      const staleLockData = {
        id: 'stale-lock-id',
        pid: 99999, // 存在しないPID
        acquiredAt: Date.now() - 60000, // 1分前
        timeout: 1000 // 1秒のタイムアウト
      };
      
      await fs.writeFile(lockFile, JSON.stringify(staleLockData));
      
      // 新しいロックを取得（古いロックは削除されるはず）
      const lockId = await lockManager.acquire('stale-resource');
      
      expect(lockId).to.be.a('string');
      expect(lockManager.activeLocks.has('stale-resource')).to.be.true;
    });
  });
  
  describe('Force Release', () => {
    it('should force release a lock', async () => {
      await lockManager.acquire('test-resource');
      
      const eventSpy = sandbox.spy();
      lockManager.on('lock-force-released', eventSpy);
      
      await lockManager.forceRelease('test-resource');
      
      expect(eventSpy.calledOnce).to.be.true;
      expect(lockManager.activeLocks.has('test-resource')).to.be.false;
    });
  });
  
  describe('Lock Status Check', () => {
    it('should check if resource is locked', async () => {
      expect(await lockManager.isLocked('test-resource')).to.be.false;
      
      await lockManager.acquire('test-resource');
      expect(await lockManager.isLocked('test-resource')).to.be.true;
      
      await lockManager.forceRelease('test-resource');
      expect(await lockManager.isLocked('test-resource')).to.be.false;
    });
  });
  
  describe('withLock Helper', () => {
    it('should execute function with lock', async () => {
      let executed = false;
      const result = await lockManager.withLock('test-resource', async () => {
        executed = true;
        return 'test-result';
      });
      
      expect(executed).to.be.true;
      expect(result).to.equal('test-result');
      expect(await lockManager.isLocked('test-resource')).to.be.false;
    });
    
    it('should release lock even if function throws', async () => {
      try {
        await lockManager.withLock('test-resource', async () => {
          throw new Error('Test error');
        });
      } catch (error) {
        // エラーは期待される
      }
      
      expect(await lockManager.isLocked('test-resource')).to.be.false;
    });
  });
  
  describe('Concurrent Access', () => {
    it('should handle multiple concurrent lock requests', async () => {
      const results = [];
      const promises = [];
      
      // 10個の並行ロックリクエスト
      for (let i = 0; i < 10; i++) {
        promises.push(
          lockManager.withLock('concurrent-resource', async () => {
            results.push(i);
            await new Promise(resolve => setTimeout(resolve, 10));
          })
        );
      }
      
      await Promise.all(promises);
      
      // すべてのタスクが実行されたことを確認
      expect(results).to.have.lengthOf(10);
      
      // 順序は保証されないが、すべての数値が含まれているはず
      const sorted = results.sort((a, b) => a - b);
      expect(sorted).to.deep.equal([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    });
  });
  
  describe('Wait Queue', () => {
    it('should handle wait queue', async () => {
      const lockId1 = await lockManager.acquire('queue-test');
      let lockId2 = null;
      
      // 待機ロックを作成
      const waitPromise = lockManager.acquire('queue-test', { wait: true });
      
      // 少し待ってから最初のロックを解放
      setTimeout(() => {
        lockManager.release('queue-test', lockId1);
      }, 50);
      
      // 待機していたロックが取得できるはず
      lockId2 = await waitPromise;
      expect(lockId2).to.be.a('string');
      expect(lockId2).to.not.equal(lockId1);
      
      // クリーンアップ
      await lockManager.release('queue-test', lockId2);
    });
    
    it('should timeout waiting locks', async () => {
      await lockManager.acquire('timeout-test');
      
      try {
        await lockManager.acquire('timeout-test', { 
          wait: true, 
          waitTimeout: 100 
        });
        expect.fail('Should have thrown timeout error');
      } catch (error) {
        expect(error.message).to.include('Lock wait timeout');
      }
    });
  });
  
  describe('Cleanup', () => {
    it('should cleanup all locks on shutdown', async () => {
      await lockManager.acquire('cleanup-test-1');
      await lockManager.acquire('cleanup-test-2');
      await lockManager.acquire('cleanup-test-3');
      
      expect(lockManager.activeLocks.size).to.equal(3);
      
      await lockManager.cleanup();
      
      expect(lockManager.activeLocks.size).to.equal(0);
    });
    
    it('should cleanup stale locks on initialization', async () => {
      // 古いロックファイルを作成
      const staleLockFile = path.join(tempDir, 'init-stale.lock');
      await fs.writeFile(staleLockFile, JSON.stringify({
        id: 'stale',
        acquiredAt: Date.now() - 100000,
        timeout: 1000
      }));
      
      // 新しいLockManagerを作成して初期化
      const newLockManager = new LockManager({ lockDir: tempDir });
      
      const eventSpy = sandbox.spy();
      newLockManager.on('stale-lock-cleaned', eventSpy);
      
      await newLockManager.initialize();
      
      expect(eventSpy.called).to.be.true;
      
      await newLockManager.cleanup();
    });
  });
});