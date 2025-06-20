const assert = require('assert');
const path = require('path');
const UnifiedStateManagerRedis = require('../src/unified-state-manager-redis');
const StatusManagerRedis = require('../src/status-manager-redis');
const StateManagerFactory = require('../src/state-manager-factory');

describe('Redis State Manager Tests', function() {
  this.timeout(30000); // 30秒タイムアウト

  let unifiedStateManager;
  let statusManager;
  const testStateDir = path.join(__dirname, '../test-state');

  // Redis接続テスト
  describe('Redis Connection', function() {
    it('should connect to Redis server', async function() {
      try {
        unifiedStateManager = new UnifiedStateManagerRedis(testStateDir, {
          processId: 'test-unified',
          redis: {
            host: '127.0.0.1',
            port: 6379
          }
        });
        
        await unifiedStateManager.initialize();
        assert.ok(unifiedStateManager.isInitialized, 'UnifiedStateManagerRedis should be initialized');
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          this.skip('Redis server is not running - skipping Redis tests');
        }
        throw error;
      }
    });

    it('should connect StatusManagerRedis to Redis', async function() {
      try {
        statusManager = new StatusManagerRedis(testStateDir, {
          processId: 'test-status',
          redis: {
            host: '127.0.0.1',
            port: 6379
          }
        });
        
        await statusManager.initialize();
        assert.ok(statusManager.isInitialized, 'StatusManagerRedis should be initialized');
      } catch (error) {
        if (error.code === 'ECONNREFUSED') {
          this.skip('Redis server is not running - skipping Redis tests');
        }
        throw error;
      }
    });
  });

  // UnifiedStateManagerRedisのテスト
  describe('UnifiedStateManagerRedis', function() {
    before(async function() {
      if (!unifiedStateManager) {
        this.skip('Redis connection not available');
      }
    });

    it('should set and get values', async function() {
      const testKey = 'test-key';
      const testValue = { message: 'Hello Redis!', timestamp: new Date().toISOString() };
      
      await unifiedStateManager.set('issues', testKey, testValue);
      const retrievedValue = await unifiedStateManager.get('issues', testKey);
      
      assert.deepStrictEqual(retrievedValue, testValue, 'Retrieved value should match set value');
    });

    it('should handle transactions', async function() {
      await unifiedStateManager.transaction(async (manager) => {
        await manager.set('issues', 'tx-test1', { status: 'processing' });
        await manager.set('issues', 'tx-test2', { status: 'completed' });
      });
      
      const value1 = await unifiedStateManager.get('issues', 'tx-test1');
      const value2 = await unifiedStateManager.get('issues', 'tx-test2');
      
      assert.strictEqual(value1.status, 'processing');
      assert.strictEqual(value2.status, 'completed');
    });

    it('should delete values', async function() {
      const testKey = 'delete-test';
      await unifiedStateManager.set('issues', testKey, { value: 'to be deleted' });
      
      // 存在確認
      const exists = await unifiedStateManager.has('issues', testKey);
      assert.ok(exists, 'Value should exist before deletion');
      
      // 削除
      await unifiedStateManager.delete('issues', testKey);
      
      // 削除確認
      const existsAfterDelete = await unifiedStateManager.has('issues', testKey);
      assert.ok(!existsAfterDelete, 'Value should not exist after deletion');
    });

    it('should clear namespace', async function() {
      // テストデータを追加
      await unifiedStateManager.set('config', 'test1', 'value1');
      await unifiedStateManager.set('config', 'test2', 'value2');
      
      // クリア
      await unifiedStateManager.clear('config');
      
      // 確認
      const allData = await unifiedStateManager.getAll('config');
      assert.strictEqual(Object.keys(allData).length, 0, 'Namespace should be empty after clear');
    });
  });

  // StatusManagerRedisのテスト
  describe('StatusManagerRedis', function() {
    before(async function() {
      if (!statusManager) {
        this.skip('Redis connection not available');
      }
    });

    it('should checkout and checkin an issue', async function() {
      const issueNumber = 9999;
      const processId = 'test-process';
      const taskType = 'test-task';
      
      // チェックアウト
      const checkoutResult = await statusManager.checkout(issueNumber, processId, taskType);
      assert.ok(checkoutResult, 'Checkout should return metadata');
      assert.strictEqual(checkoutResult.status, 'processing');
      assert.strictEqual(checkoutResult.processId, processId);
      
      // ステータス確認
      const status = await statusManager.getIssueStatus(issueNumber);
      assert.strictEqual(status.status, 'processing');
      
      // チェックイン
      const checkinResult = await statusManager.checkin(issueNumber, 'completed', { test: true });
      assert.ok(checkinResult, 'Checkin should return metadata');
      assert.strictEqual(checkinResult.status, 'completed');
      
      // 最終ステータス確認
      const finalStatus = await statusManager.getIssueStatus(issueNumber);
      assert.strictEqual(finalStatus.status, 'completed');
      assert.ok(finalStatus.result.test, 'Result should contain test data');
    });

    it('should update heartbeat', async function() {
      const issueNumber = 9998;
      const processId = 'test-heartbeat-process';
      
      // チェックアウト
      await statusManager.checkout(issueNumber, processId, 'test-task');
      
      // 初期ハートビートを取得
      const initialStatus = await statusManager.getIssueStatus(issueNumber);
      const initialHeartbeat = new Date(initialStatus.lastHeartbeat);
      
      // 少し待機
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // ハートビート更新
      const updateResult = await statusManager.updateHeartbeat(issueNumber);
      assert.ok(updateResult, 'Heartbeat update should succeed');
      
      // 更新されたハートビートを確認
      const updatedStatus = await statusManager.getIssueStatus(issueNumber);
      const updatedHeartbeat = new Date(updatedStatus.lastHeartbeat);
      
      assert.ok(updatedHeartbeat > initialHeartbeat, 'Heartbeat should be updated');
      
      // クリーンアップ
      await statusManager.checkin(issueNumber, 'completed');
    });

    it('should get statistics', async function() {
      // テストデータを作成
      await statusManager.checkout(9997, 'stats-test-1', 'test');
      await statusManager.checkout(9996, 'stats-test-2', 'test');
      await statusManager.checkin(9996, 'completed');
      
      const stats = await statusManager.getStatistics();
      
      assert.ok(typeof stats.total === 'number', 'Stats should include total count');
      assert.ok(typeof stats.processing === 'number', 'Stats should include processing count');
      assert.ok(typeof stats.completed === 'number', 'Stats should include completed count');
      
      // クリーンアップ
      await statusManager.checkin(9997, 'completed');
    });
  });

  // StateManagerFactoryのテスト
  describe('StateManagerFactory', function() {
    it('should create file-based managers by default', function() {
      const config = {
        unifiedStateManagement: {
          enabled: true,
          backend: 'file'
        }
      };
      
      const backend = StateManagerFactory.getBackendType(config);
      assert.strictEqual(backend, 'file', 'Should return file backend');
      
      const isFile = StateManagerFactory.isFileBackend(config);
      assert.ok(isFile, 'Should identify as file backend');
    });

    it('should create Redis-based managers when configured', function() {
      const config = {
        unifiedStateManagement: {
          enabled: true,
          backend: 'redis',
          redis: {
            enabled: true,
            host: '127.0.0.1',
            port: 6379
          }
        }
      };
      
      const backend = StateManagerFactory.getBackendType(config);
      assert.strictEqual(backend, 'redis', 'Should return redis backend');
      
      const isRedis = StateManagerFactory.isRedisBackend(config);
      assert.ok(isRedis, 'Should identify as redis backend');
    });

    it('should validate configuration', function() {
      const validConfig = {
        unifiedStateManagement: {
          enabled: true,
          backend: 'redis',
          redis: {
            enabled: true,
            host: '127.0.0.1',
            port: 6379
          }
        }
      };
      
      const validation = StateManagerFactory.validateConfig(validConfig);
      assert.ok(validation.valid, 'Valid config should pass validation');
      
      const invalidConfig = {
        unifiedStateManagement: {
          enabled: true,
          backend: 'redis',
          redis: {
            enabled: true
            // host and port missing
          }
        }
      };
      
      const invalidValidation = StateManagerFactory.validateConfig(invalidConfig);
      assert.ok(!invalidValidation.valid, 'Invalid config should fail validation');
    });
  });

  // クリーンアップ
  after(async function() {
    if (unifiedStateManager) {
      try {
        // テストデータのクリーンアップ
        await unifiedStateManager.clear('issues');
        await unifiedStateManager.clear('config');
        await unifiedStateManager.cleanup();
      } catch (error) {
        console.error('Cleanup error:', error);
      }
    }
    
    if (statusManager) {
      try {
        await statusManager.cleanup();
      } catch (error) {
        console.error('StatusManager cleanup error:', error);
      }
    }
  });
});