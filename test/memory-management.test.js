/**
 * メモリ管理機能のテスト
 */

const assert = require('assert');
const MemoryMonitor = require('../src/memory-monitor');
const MemoryOptimizer = require('../src/memory-optimizer');
const MemoryLeakDetector = require('../src/memory-leak-detector');

describe('メモリ管理機能', () => {
  
  describe('MemoryMonitor', () => {
    let monitor;
    
    beforeEach(() => {
      monitor = new MemoryMonitor({
        interval: 100, // テスト用に短い間隔
        snapshot: { enabled: false } // テストではスナップショット無効
      });
    });
    
    afterEach(() => {
      monitor.cleanup();
    });
    
    it('メモリ使用状況を正しく取得できる', () => {
      const usage = monitor.getCurrentMemoryUsage();
      
      assert(usage.timestamp);
      assert(typeof usage.rss === 'number');
      assert(typeof usage.heapTotal === 'number');
      assert(typeof usage.heapUsed === 'number');
      assert(typeof usage.external === 'number');
      assert(usage.rss > 0);
      assert(usage.heapTotal > 0);
      assert(usage.heapUsed > 0);
    });
    
    it('監視を開始/停止できる', async () => {
      await monitor.start();
      assert(monitor.monitoring === true);
      
      monitor.stop();
      assert(monitor.monitoring === false);
    });
    
    it('閾値超過を検出できる', (done) => {
      const lowThresholdMonitor = new MemoryMonitor({
        interval: 100,
        thresholds: {
          heapUsed: 1, // 非常に低い閾値
          rss: 1
        },
        snapshot: { enabled: false }
      });
      
      lowThresholdMonitor.on('threshold-exceeded', ({ alerts }) => {
        assert(alerts.length > 0);
        assert(alerts[0].type);
        assert(alerts[0].value > alerts[0].threshold);
        lowThresholdMonitor.cleanup();
        done();
      });
      
      lowThresholdMonitor.start();
    });
    
    it('統計情報を正しく計算できる', async () => {
      await monitor.start();
      
      // いくつかのサンプルを収集
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const stats = monitor.getStatistics();
      assert(stats);
      assert(stats.samples > 0);
      assert(stats.heapUsed.min <= stats.heapUsed.max);
      assert(stats.heapUsed.avg >= stats.heapUsed.min);
      assert(stats.heapUsed.avg <= stats.heapUsed.max);
    });
    
    it('メモリ最適化を実行できる', async () => {
      const result = await monitor.optimize();
      
      assert(result.success === true);
      assert(result.before);
      assert(result.after);
      assert(result.freed);
      assert(result.freedMB);
    });
  });
  
  describe('MemoryOptimizer', () => {
    let optimizer;
    
    beforeEach(() => {
      optimizer = new MemoryOptimizer();
    });
    
    afterEach(() => {
      optimizer.cleanup();
    });
    
    it('キャッシュを作成し管理できる', () => {
      const cache = optimizer.createCache('test-cache', {
        maxSize: 1024 * 1024, // 1MB
        ttl: 1000 // 1秒
      });
      
      // 値を設定
      const success = cache.set('key1', 'value1');
      assert(success === true);
      
      // 値を取得
      const value = cache.get('key1');
      assert(value === 'value1');
      
      // キャッシュサイズ
      assert(cache.size() === 1);
      
      // 統計情報
      const stats = cache.stats();
      assert(stats.hits === 1);
      assert(stats.misses === 0);
    });
    
    it('キャッシュのTTLが機能する', async () => {
      const cache = optimizer.createCache('ttl-test', {
        ttl: 100 // 100ms
      });
      
      cache.set('key1', 'value1');
      assert(cache.get('key1') === 'value1');
      
      // TTL後
      await new Promise(resolve => setTimeout(resolve, 150));
      assert(cache.get('key1') === undefined);
    });
    
    it('オブジェクトプールを作成し管理できる', () => {
      let created = 0;
      const pool = optimizer.createObjectPool('test-pool', 
        () => ({ id: ++created }),
        { maxObjects: 3 }
      );
      
      // オブジェクトを取得
      const obj1 = pool.acquire();
      const obj2 = pool.acquire();
      assert(obj1.id === 1);
      assert(obj2.id === 2);
      
      // オブジェクトを返却
      pool.release(obj1);
      
      // 再利用される
      const obj3 = pool.acquire();
      assert(obj3.id === 1); // 再利用
      
      const stats = pool.stats();
      assert(stats.created === 2);
      assert(stats.recycled === 1);
    });
    
    it('サイズ推定が正しく動作する', () => {
      assert(optimizer.estimateSize(null) === 0);
      assert(optimizer.estimateSize(true) === 4);
      assert(optimizer.estimateSize(123) === 8);
      assert(optimizer.estimateSize('test') === 8); // 4文字 * 2バイト
      assert(optimizer.estimateSize([1, 2, 3]) > 24);
      assert(optimizer.estimateSize({ a: 1, b: 2 }) > 24);
    });
    
    it('グローバル最適化を実行できる', async () => {
      // キャッシュとプールを作成
      const cache = optimizer.createCache('test');
      cache.set('key1', 'value1');
      
      const pool = optimizer.createObjectPool('test', () => ({}));
      pool.acquire();
      
      optimizer.start();
      const result = await optimizer.performGlobalOptimization();
      
      assert(result.timestamp);
      assert(typeof result.cachesCleaned === 'number');
      assert(typeof result.objectsReleased === 'number');
      assert(result.memoryBefore);
      assert(result.memoryAfter);
    });
  });
  
  describe('MemoryLeakDetector', () => {
    let detector;
    
    beforeEach(() => {
      detector = new MemoryLeakDetector({
        checkInterval: 100,
        analysis: {
          sampleCount: 2,
          growthThreshold: 0.01
        }
      });
    });
    
    afterEach(() => {
      detector.cleanup();
    });
    
    it('リーク検出を開始/停止できる', () => {
      detector.start();
      assert(detector.checkInterval !== null);
      
      detector.stop();
      assert(detector.checkInterval === null);
    });
    
    it('スナップショットを取得できる', async () => {
      const snapshot = await detector.takeSnapshot();
      
      assert(snapshot.timestamp);
      assert(snapshot.heapStats);
      assert(snapshot.objects instanceof Map);
      assert(snapshot.constructors instanceof Map);
    });
    
    it('成長傾向を分析できる', async () => {
      // 複数のスナップショットを作成
      await detector.performCheck();
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // メモリを意図的に増やす
      const bigArray = new Array(1000000).fill('test');
      
      await detector.performCheck();
      
      // 成長分析
      const growth = detector.analyzeGrowth();
      assert(growth);
      assert(typeof growth.slope === 'string');
      assert(typeof growth.correlation === 'string');
      assert(growth.samples >= 2);
    });
    
    it('レポートを生成できる', async () => {
      await detector.performCheck();
      
      const report = await detector.generateReport();
      assert(report);
      assert(report.timestamp);
      assert(report.summary);
      assert(report.topConstructors);
      assert(Array.isArray(report.suspectedLeaks));
    });
  });
  
  describe('統合テスト', () => {
    it('メモリ監視と最適化が連携して動作する', async () => {
      const monitor = new MemoryMonitor({
        interval: 100,
        snapshot: { enabled: false }
      });
      const optimizer = new MemoryOptimizer();
      
      let optimizationTriggered = false;
      
      monitor.on('threshold-exceeded', () => {
        optimizationTriggered = true;
        optimizer.performGlobalOptimization();
      });
      
      // 大きなオブジェクトを作成
      const cache = optimizer.createCache('large-cache');
      for (let i = 0; i < 1000; i++) {
        cache.set(`key${i}`, new Array(1000).fill(i));
      }
      
      await monitor.start();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      monitor.cleanup();
      optimizer.cleanup();
    });
  });
});