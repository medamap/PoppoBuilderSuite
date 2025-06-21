/**
 * メモリリーク検出モジュール
 * 長期間解放されないオブジェクトを追跡し、リークの可能性を検出する
 */

const v8 = require('v8');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class MemoryLeakDetector extends EventEmitter {
  constructor(config = {}, logger = console) {
    super();
    this.config = {
      enabled: true,
      checkInterval: 300000, // 5分ごと
      tracking: {
        minSize: 1024, // 1KB以上のオブジェクトを追跡
        maxTracked: 10000, // 最大追跡数
        retentionTime: 3600000 // 1時間以上保持されているオブジェクトを疑う
      },
      analysis: {
        growthThreshold: 0.1, // 10%以上の成長で警告
        sampleCount: 5, // 分析に必要なサンプル数
        reportTop: 20 // レポートに含める上位オブジェクト数
      },
      ...config
    };

    this.logger = logger;
    this.snapshots = [];
    this.tracking = new Map();
    this.checkInterval = null;
    this.isChecking = false;
  }

  /**
   * リーク検出を開始
   */
  start() {
    if (!this.config.enabled || this.checkInterval) {
      return;
    }

    this.checkInterval = setInterval(() => {
      this.performCheck();
    }, this.config.checkInterval);

    // 初回チェック
    this.performCheck();

    this.logger.info('メモリリーク検出を開始しました');
    this.emit('started');
  }

  /**
   * リーク検出を停止
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }

    this.logger.info('メモリリーク検出を停止しました');
    this.emit('stopped');
  }

  /**
   * メモリチェックを実行
   */
  async performCheck() {
    if (this.isChecking) {
      this.logger.warn('前回のチェックがまだ完了していません');
      return;
    }

    this.isChecking = true;
    
    try {
      // ヒープスナップショットを取得
      const snapshot = await this.takeSnapshot();
      this.snapshots.push(snapshot);

      // 古いスナップショットを削除
      if (this.snapshots.length > this.config.analysis.sampleCount) {
        this.snapshots.shift();
      }

      // リーク分析
      if (this.snapshots.length >= 2) {
        const leaks = await this.analyzeLeaks();
        if (leaks.length > 0) {
          this.emit('leaks-detected', leaks);
          this.logger.warn(`${leaks.length}個の潜在的なメモリリークを検出しました`);
        }
      }

      // 成長分析
      if (this.snapshots.length >= this.config.analysis.sampleCount) {
        const growth = this.analyzeGrowth();
        if (growth.isGrowing) {
          this.emit('memory-growth', growth);
          this.logger.warn('継続的なメモリ成長を検出しました', growth);
        }
      }

    } catch (error) {
      this.logger.error('メモリチェックエラー:', error);
      this.emit('error', error);
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * ヒープスナップショットを取得
   */
  async takeSnapshot() {
    const heapStats = v8.getHeapStatistics();
    const heapSnapshot = v8.getHeapSnapshot();
    
    const snapshot = {
      timestamp: Date.now(),
      heapStats,
      objects: new Map(),
      constructors: new Map(),
      retainers: new Map()
    };

    // ストリームからオブジェクト情報を読み取る
    const chunks = [];
    for await (const chunk of heapSnapshot) {
      chunks.push(chunk);
    }
    
    const data = JSON.parse(Buffer.concat(chunks).toString());
    
    // ノードとエッジを解析
    this.parseSnapshot(data, snapshot);
    
    return snapshot;
  }

  /**
   * スナップショットを解析
   */
  parseSnapshot(data, snapshot) {
    const { nodes, edges, strings } = data;
    const nodeFieldCount = data.snapshot.node_fields.length;
    const edgeFieldCount = data.snapshot.edge_fields.length;
    
    // ノードを解析
    for (let i = 0; i < nodes.length; i += nodeFieldCount) {
      const type = nodes[i];
      const name = strings[nodes[i + 1]];
      const id = nodes[i + 2];
      const size = nodes[i + 3];
      const edgeIndex = nodes[i + 4];
      const edgeCount = nodes[i + 5];

      if (size >= this.config.tracking.minSize) {
        const nodeInfo = {
          type,
          name,
          id,
          size,
          edgeIndex,
          edgeCount,
          retainers: []
        };

        snapshot.objects.set(id, nodeInfo);

        // コンストラクタ別に集計
        const constructor = this.getConstructorName(type, name);
        if (!snapshot.constructors.has(constructor)) {
          snapshot.constructors.set(constructor, {
            count: 0,
            size: 0,
            instances: []
          });
        }
        
        const ctorInfo = snapshot.constructors.get(constructor);
        ctorInfo.count++;
        ctorInfo.size += size;
        if (ctorInfo.instances.length < 100) {
          ctorInfo.instances.push(id);
        }
      }
    }

    // エッジ（参照関係）を解析
    for (let i = 0; i < edges.length; i += edgeFieldCount) {
      const type = edges[i];
      const nameOrIndex = edges[i + 1];
      const toNode = edges[i + 2];

      if (snapshot.objects.has(toNode)) {
        const obj = snapshot.objects.get(toNode);
        obj.retainers.push({
          type,
          nameOrIndex: typeof nameOrIndex === 'number' ? strings[nameOrIndex] : nameOrIndex
        });
      }
    }
  }

  /**
   * コンストラクタ名を取得
   */
  getConstructorName(type, name) {
    // V8のヒープスナップショットのノードタイプ
    const typeNames = [
      'hidden',
      'array',
      'string',
      'object',
      'code',
      'closure',
      'regexp',
      'number',
      'native',
      'synthetic',
      'concatenated string',
      'sliced string',
      'symbol',
      'bigint'
    ];

    if (type === 3) { // object
      return name || 'Object';
    } else if (type === 1) { // array
      return 'Array';
    } else if (type === 2) { // string
      return 'String';
    } else {
      return typeNames[type] || 'Unknown';
    }
  }

  /**
   * メモリリークを分析
   */
  async analyzeLeaks() {
    if (this.snapshots.length < 2) {
      return [];
    }

    const current = this.snapshots[this.snapshots.length - 1];
    const previous = this.snapshots[this.snapshots.length - 2];
    const leaks = [];

    // コンストラクタ別の成長を分析
    for (const [constructor, currentInfo] of current.constructors) {
      const previousInfo = previous.constructors.get(constructor);
      
      if (!previousInfo) {
        // 新しいコンストラクタ
        if (currentInfo.size > 1024 * 1024) { // 1MB以上
          leaks.push({
            type: 'new-constructor',
            constructor,
            count: currentInfo.count,
            size: currentInfo.size,
            avgSize: Math.floor(currentInfo.size / currentInfo.count)
          });
        }
      } else {
        // 既存コンストラクタの成長をチェック
        const countGrowth = currentInfo.count - previousInfo.count;
        const sizeGrowth = currentInfo.size - previousInfo.size;
        const growthRate = sizeGrowth / previousInfo.size;

        if (growthRate > this.config.analysis.growthThreshold && sizeGrowth > 1024 * 1024) {
          leaks.push({
            type: 'growing-constructor',
            constructor,
            countGrowth,
            sizeGrowth,
            growthRate: (growthRate * 100).toFixed(2) + '%',
            currentCount: currentInfo.count,
            currentSize: currentInfo.size
          });
        }
      }
    }

    // 長期間保持されているオブジェクトをチェック
    for (const [id, obj] of current.objects) {
      const trackedTime = this.tracking.get(id);
      
      if (!trackedTime) {
        this.tracking.set(id, current.timestamp);
      } else if (current.timestamp - trackedTime > this.config.tracking.retentionTime) {
        if (obj.size > 10 * 1024) { // 10KB以上
          leaks.push({
            type: 'long-lived-object',
            id,
            name: obj.name,
            size: obj.size,
            retentionTime: current.timestamp - trackedTime,
            retainerCount: obj.retainers.length
          });
        }
      }
    }

    // 追跡オブジェクトのクリーンアップ
    if (this.tracking.size > this.config.tracking.maxTracked) {
      const sortedTracking = [...this.tracking.entries()].sort((a, b) => a[1] - b[1]);
      const toRemove = sortedTracking.slice(0, this.tracking.size - this.config.tracking.maxTracked);
      for (const [id] of toRemove) {
        this.tracking.delete(id);
      }
    }

    return leaks.slice(0, this.config.analysis.reportTop);
  }

  /**
   * メモリ成長を分析
   */
  analyzeGrowth() {
    const heapSizes = this.snapshots.map(s => s.heapStats.used_heap_size);
    const times = this.snapshots.map(s => s.timestamp);
    
    // 線形回帰で成長率を計算
    const n = heapSizes.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < n; i++) {
      const x = (times[i] - times[0]) / 1000; // 秒単位
      const y = heapSizes[i] / (1024 * 1024); // MB単位
      
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    const correlation = this.calculateCorrelation(heapSizes);
    
    // 成長判定
    const isGrowing = slope > 0.01 && correlation > 0.7; // 1秒あたり0.01MB以上の成長
    
    return {
      isGrowing,
      slope: slope.toFixed(4),
      slopePerHour: (slope * 3600).toFixed(2),
      intercept: intercept.toFixed(2),
      correlation: correlation.toFixed(4),
      samples: n,
      period: {
        start: new Date(times[0]).toISOString(),
        end: new Date(times[n - 1]).toISOString(),
        durationMinutes: Math.floor((times[n - 1] - times[0]) / 60000)
      },
      prediction: {
        oneHour: intercept + slope * 3600,
        oneDay: intercept + slope * 86400
      }
    };
  }

  /**
   * 相関係数を計算
   */
  calculateCorrelation(values) {
    const n = values.length;
    const mean = values.reduce((a, b) => a + b, 0) / n;
    
    let variance = 0;
    let trend = 0;
    
    for (let i = 0; i < n; i++) {
      variance += Math.pow(values[i] - mean, 2);
      if (i > 0) {
        trend += (values[i] - values[i - 1]) > 0 ? 1 : -1;
      }
    }
    
    return Math.abs(trend) / (n - 1);
  }

  /**
   * レポートを生成
   */
  async generateReport() {
    const current = this.snapshots[this.snapshots.length - 1];
    if (!current) {
      return null;
    }

    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        heapUsed: (current.heapStats.used_heap_size / (1024 * 1024)).toFixed(2) + ' MB',
        heapTotal: (current.heapStats.total_heap_size / (1024 * 1024)).toFixed(2) + ' MB',
        external: (current.heapStats.external_memory / (1024 * 1024)).toFixed(2) + ' MB',
        objectCount: current.objects.size,
        trackedObjects: this.tracking.size
      },
      topConstructors: [],
      suspectedLeaks: [],
      growth: null
    };

    // 上位コンストラクタ
    const sortedConstructors = [...current.constructors.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, this.config.analysis.reportTop);

    for (const [name, info] of sortedConstructors) {
      report.topConstructors.push({
        name,
        count: info.count,
        totalSize: (info.size / 1024).toFixed(2) + ' KB',
        avgSize: Math.floor(info.size / info.count) + ' bytes'
      });
    }

    // 最新のリーク分析結果
    if (this.snapshots.length >= 2) {
      report.suspectedLeaks = await this.analyzeLeaks();
    }

    // 成長分析
    if (this.snapshots.length >= this.config.analysis.sampleCount) {
      report.growth = this.analyzeGrowth();
    }

    return report;
  }

  /**
   * ヒープダンプを保存
   */
  async saveHeapDump(filepath) {
    try {
      v8.writeHeapSnapshot(filepath);
      this.logger.info(`ヒープダンプを保存しました: ${filepath}`);
      return true;
    } catch (error) {
      this.logger.error('ヒープダンプ保存エラー:', error);
      return false;
    }
  }

  /**
   * クリーンアップ
   */
  cleanup() {
    this.stop();
    this.snapshots = [];
    this.tracking.clear();
    this.removeAllListeners();
  }
}

module.exports = MemoryLeakDetector;