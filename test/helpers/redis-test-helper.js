/**
 * Redisテスト環境ヘルパー
 * テスト用に分離されたRedis接続を提供
 */

const Redis = require('ioredis');

class RedisTestHelper {
  constructor() {
    this.client = null;
    this.testDB = parseInt(process.env.REDIS_TEST_DB || '15');
  }

  /**
   * テスト用Redis接続を作成
   */
  async connect() {
    const redisConfig = {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      db: this.testDB,
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      commandTimeout: 5000
    };

    this.client = new Redis(redisConfig);
    
    try {
      await this.client.connect();
      console.log(`✅ テスト用Redis接続成功 (DB: ${this.testDB})`);
      
      // テストDBをクリア
      await this.client.flushdb();
      console.log('🧹 テスト用Redisデータベースをクリアしました');
      
      return this.client;
    } catch (error) {
      console.warn('⚠️ Redis接続失敗:', error.message);
      console.log('📝 Redisなしでテストを実行します');
      return null;
    }
  }

  /**
   * Redis接続を閉じる
   */
  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      console.log('✅ テスト用Redis接続を閉じました');
    }
  }

  /**
   * テストデータのセットアップ
   */
  async setupTestData(data = {}) {
    if (!this.client) return;

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object') {
        await this.client.set(key, JSON.stringify(value));
      } else {
        await this.client.set(key, value);
      }
    }
  }

  /**
   * 特定のキーパターンをクリア
   */
  async clearPattern(pattern) {
    if (!this.client) return;

    const keys = await this.client.keys(pattern);
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  /**
   * モックRedisクライアントを作成
   */
  createMockClient() {
    const mockData = new Map();
    
    return {
      get: async (key) => mockData.get(key) || null,
      set: async (key, value) => {
        mockData.set(key, value);
        return 'OK';
      },
      del: async (...keys) => {
        let deleted = 0;
        keys.forEach(key => {
          if (mockData.delete(key)) deleted++;
        });
        return deleted;
      },
      keys: async (pattern) => {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return Array.from(mockData.keys()).filter(key => regex.test(key));
      },
      flushdb: async () => {
        mockData.clear();
        return 'OK';
      },
      quit: async () => 'OK',
      ping: async () => 'PONG',
      isReady: () => true
    };
  }
}

// シングルトンインスタンス
let instance = null;

module.exports = {
  /**
   * RedisTestHelperのインスタンスを取得
   */
  getInstance: () => {
    if (!instance) {
      instance = new RedisTestHelper();
    }
    return instance;
  },

  /**
   * テスト用のRedis設定
   */
  getTestRedisConfig: () => ({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    db: parseInt(process.env.REDIS_TEST_DB || '15'),
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1
  }),

  /**
   * Redisが利用可能かチェック
   */
  isRedisAvailable: async () => {
    const testClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      lazyConnect: true,
      connectTimeout: 1000,
      commandTimeout: 1000,
      maxRetriesPerRequest: 1
    });

    try {
      await testClient.connect();
      await testClient.ping();
      await testClient.quit();
      return true;
    } catch (error) {
      return false;
    }
  }
};