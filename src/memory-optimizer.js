/**
 * メモリ最適化モジュール
 * メモリ使用量を分析し、最適化戦略を実行する
 */

const EventEmitter = require('events');
const WeakMap = require('weak-map');

class MemoryOptimizer extends EventEmitter {
  constructor(config = {}, logger = console) {
    super();
    this.config = {
      enabled: true,
      strategies: {
        cacheEviction: true,
        objectPooling: true,
        lazyLoading: true,
        streamProcessing: true
      },
      cache: {
        maxSize: 100 * 1024 * 1024, // 100MB
        ttl: 3600000, // 1時間
        checkInterval: 300000 // 5分ごと
      },
      objectPool: {
        maxObjects: 1000,
        recycleThreshold: 0.8
      },
      ...config
    };

    this.logger = logger;
    this.caches = new Map();
    this.objectPools = new Map();
    this.weakRefs = new WeakMap();
    this.cleanupInterval = null;
  }

  /**
   * 最適化を開始
   */
  start() {
    if (!this.config.enabled) {
      return;
    }

    // 定期的なキャッシュクリーンアップ
    this.cleanupInterval = setInterval(() => {
      this.cleanupCaches();
    }, this.config.cache.checkInterval);

    this.logger.info('メモリ最適化を開始しました');
    this.emit('started');
  }

  /**
   * 最適化を停止
   */
  stop() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    this.logger.info('メモリ最適化を停止しました');
    this.emit('stopped');
  }

  /**
   * キャッシュマネージャー
   */
  createCache(name, options = {}) {
    const cache = {
      name,
      data: new Map(),
      metadata: new Map(),
      options: {
        maxSize: options.maxSize || this.config.cache.maxSize,
        ttl: options.ttl || this.config.cache.ttl,
        onEvict: options.onEvict || null
      },
      stats: {
        hits: 0,
        misses: 0,
        evictions: 0,
        size: 0
      }
    };

    this.caches.set(name, cache);
    return this.createCacheProxy(cache);
  }

  /**
   * キャッシュプロキシを作成
   */
  createCacheProxy(cache) {
    return {
      get: (key) => this.cacheGet(cache, key),
      set: (key, value, ttl) => this.cacheSet(cache, key, value, ttl),
      delete: (key) => this.cacheDelete(cache, key),
      clear: () => this.cacheClear(cache),
      has: (key) => cache.data.has(key),
      size: () => cache.data.size,
      stats: () => ({ ...cache.stats })
    };
  }

  /**
   * キャッシュから値を取得
   */
  cacheGet(cache, key) {
    if (!cache.data.has(key)) {
      cache.stats.misses++;
      return undefined;
    }

    const metadata = cache.metadata.get(key);
    if (metadata.expires && metadata.expires < Date.now()) {
      this.cacheDelete(cache, key);
      cache.stats.misses++;
      return undefined;
    }

    cache.stats.hits++;
    metadata.lastAccess = Date.now();
    metadata.accessCount++;
    
    return cache.data.get(key);
  }

  /**
   * キャッシュに値を設定
   */
  cacheSet(cache, key, value, ttl) {
    const size = this.estimateSize(value);
    
    // サイズチェック
    if (size > cache.options.maxSize) {
      this.logger.warn(`キャッシュ項目が大きすぎます: ${size} bytes`);
      return false;
    }

    // 容量確保
    while (cache.stats.size + size > cache.options.maxSize && cache.data.size > 0) {
      this.evictOldest(cache);
    }

    const metadata = {
      size,
      created: Date.now(),
      lastAccess: Date.now(),
      accessCount: 0,
      expires: ttl ? Date.now() + ttl : (cache.options.ttl ? Date.now() + cache.options.ttl : null)
    };

    cache.data.set(key, value);
    cache.metadata.set(key, metadata);
    cache.stats.size += size;

    return true;
  }

  /**
   * キャッシュから削除
   */
  cacheDelete(cache, key) {
    if (!cache.data.has(key)) {
      return false;
    }

    const metadata = cache.metadata.get(key);
    cache.stats.size -= metadata.size;
    
    if (cache.options.onEvict) {
      cache.options.onEvict(key, cache.data.get(key));
    }

    cache.data.delete(key);
    cache.metadata.delete(key);
    
    return true;
  }

  /**
   * キャッシュをクリア
   */
  cacheClear(cache) {
    if (cache.options.onEvict) {
      for (const [key, value] of cache.data) {
        cache.options.onEvict(key, value);
      }
    }

    cache.data.clear();
    cache.metadata.clear();
    cache.stats.size = 0;
    cache.stats.evictions += cache.data.size;
  }

  /**
   * 最も古いアイテムを削除
   */
  evictOldest(cache) {
    let oldestKey = null;
    let oldestTime = Infinity;

    for (const [key, metadata] of cache.metadata) {
      if (metadata.lastAccess < oldestTime) {
        oldestTime = metadata.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.cacheDelete(cache, oldestKey);
      cache.stats.evictions++;
    }
  }

  /**
   * キャッシュのクリーンアップ
   */
  cleanupCaches() {
    let totalEvicted = 0;

    for (const cache of this.caches.values()) {
      const keysToDelete = [];
      
      for (const [key, metadata] of cache.metadata) {
        if (metadata.expires && metadata.expires < Date.now()) {
          keysToDelete.push(key);
        }
      }

      for (const key of keysToDelete) {
        this.cacheDelete(cache, key);
        totalEvicted++;
      }
    }

    if (totalEvicted > 0) {
      this.logger.info(`期限切れキャッシュを削除: ${totalEvicted}件`);
      this.emit('cache-cleanup', { evicted: totalEvicted });
    }
  }

  /**
   * オブジェクトプールを作成
   */
  createObjectPool(name, factory, options = {}) {
    const pool = {
      name,
      factory,
      available: [],
      inUse: new Set(),
      options: {
        maxObjects: options.maxObjects || this.config.objectPool.maxObjects,
        recycleThreshold: options.recycleThreshold || this.config.objectPool.recycleThreshold,
        reset: options.reset || null
      },
      stats: {
        created: 0,
        recycled: 0,
        destroyed: 0
      }
    };

    this.objectPools.set(name, pool);
    return this.createPoolProxy(pool);
  }

  /**
   * オブジェクトプールプロキシを作成
   */
  createPoolProxy(pool) {
    return {
      acquire: () => this.poolAcquire(pool),
      release: (obj) => this.poolRelease(pool, obj),
      size: () => pool.available.length + pool.inUse.size,
      stats: () => ({ ...pool.stats })
    };
  }

  /**
   * プールからオブジェクトを取得
   */
  poolAcquire(pool) {
    let obj;

    if (pool.available.length > 0) {
      obj = pool.available.pop();
      pool.stats.recycled++;
    } else if (pool.inUse.size < pool.options.maxObjects) {
      obj = pool.factory();
      pool.stats.created++;
    } else {
      throw new Error(`オブジェクトプール "${pool.name}" が満杯です`);
    }

    pool.inUse.add(obj);
    return obj;
  }

  /**
   * プールにオブジェクトを返却
   */
  poolRelease(pool, obj) {
    if (!pool.inUse.has(obj)) {
      return false;
    }

    pool.inUse.delete(obj);

    // リセット処理
    if (pool.options.reset) {
      pool.options.reset(obj);
    }

    // 再利用閾値チェック
    const utilization = pool.inUse.size / pool.options.maxObjects;
    if (utilization < pool.options.recycleThreshold) {
      pool.available.push(obj);
    } else {
      pool.stats.destroyed++;
    }

    return true;
  }

  /**
   * サイズを推定
   */
  estimateSize(obj) {
    if (obj === null || obj === undefined) {
      return 0;
    }

    const type = typeof obj;
    
    if (type === 'boolean') return 4;
    if (type === 'number') return 8;
    if (type === 'string') return obj.length * 2;
    
    if (obj instanceof Buffer) {
      return obj.length;
    }

    if (obj instanceof ArrayBuffer) {
      return obj.byteLength;
    }

    if (Array.isArray(obj)) {
      return obj.reduce((sum, item) => sum + this.estimateSize(item), 24);
    }

    if (type === 'object') {
      let size = 24; // オブジェクトのオーバーヘッド
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          size += this.estimateSize(key) + this.estimateSize(obj[key]);
        }
      }
      return size;
    }

    return 24; // デフォルト
  }

  /**
   * 弱参照を作成
   */
  createWeakRef(key, obj) {
    this.weakRefs.set(key, obj);
    return key;
  }

  /**
   * 弱参照から取得
   */
  getWeakRef(key) {
    return this.weakRefs.get(key);
  }

  /**
   * メモリ効率的なストリーム処理
   */
  createStreamProcessor(transform, options = {}) {
    const { Readable, Transform } = require('stream');
    
    const processor = new Transform({
      objectMode: options.objectMode || false,
      highWaterMark: options.highWaterMark || 16,
      transform: async function(chunk, encoding, callback) {
        try {
          const result = await transform(chunk, encoding);
          callback(null, result);
        } catch (error) {
          callback(error);
        }
      }
    });

    return processor;
  }

  /**
   * 最適化レポートを生成
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      caches: {},
      objectPools: {},
      recommendations: []
    };

    // キャッシュ統計
    for (const [name, cache] of this.caches) {
      const hitRate = cache.stats.hits / (cache.stats.hits + cache.stats.misses) || 0;
      report.caches[name] = {
        size: cache.data.size,
        sizeBytes: cache.stats.size,
        hitRate: (hitRate * 100).toFixed(2) + '%',
        stats: cache.stats
      };

      if (hitRate < 0.5) {
        report.recommendations.push({
          type: 'cache',
          name,
          message: 'キャッシュヒット率が低いです。キャッシュ戦略の見直しを検討してください。'
        });
      }
    }

    // オブジェクトプール統計
    for (const [name, pool] of this.objectPools) {
      const recycleRate = pool.stats.recycled / (pool.stats.created + pool.stats.recycled) || 0;
      report.objectPools[name] = {
        available: pool.available.length,
        inUse: pool.inUse.size,
        recycleRate: (recycleRate * 100).toFixed(2) + '%',
        stats: pool.stats
      };

      if (recycleRate < 0.7) {
        report.recommendations.push({
          type: 'objectPool',
          name,
          message: 'オブジェクトの再利用率が低いです。プールサイズの調整を検討してください。'
        });
      }
    }

    return report;
  }

  /**
   * グローバル最適化の実行
   */
  async performGlobalOptimization() {
    this.logger.info('グローバルメモリ最適化を開始');
    
    const results = {
      cachesCleaned: 0,
      objectsReleased: 0,
      memoryBefore: process.memoryUsage(),
      timestamp: new Date().toISOString()
    };

    // すべてのキャッシュをクリーンアップ
    for (const cache of this.caches.values()) {
      const sizeBefore = cache.data.size;
      this.cleanupCaches();
      results.cachesCleaned += sizeBefore - cache.data.size;
    }

    // オブジェクトプールの最適化
    for (const pool of this.objectPools.values()) {
      const released = pool.available.length;
      pool.available = [];
      results.objectsReleased += released;
    }

    // ガベージコレクション（可能な場合）
    if (global.gc) {
      global.gc();
    }

    // メモリ使用量の変化を記録
    results.memoryAfter = process.memoryUsage();
    results.memoryFreed = {
      heapUsed: results.memoryBefore.heapUsed - results.memoryAfter.heapUsed,
      external: results.memoryBefore.external - results.memoryAfter.external
    };

    this.emit('global-optimization', results);
    this.logger.info('グローバルメモリ最適化完了', results);
    
    return results;
  }

  /**
   * クリーンアップ
   */
  cleanup() {
    this.stop();
    this.caches.clear();
    this.objectPools.clear();
    this.weakRefs = new WeakMap();
    this.removeAllListeners();
  }
}

module.exports = MemoryOptimizer;