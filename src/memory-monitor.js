/**
 * メモリ使用量監視モジュール
 * Node.jsプロセスのメモリ使用状況を監視し、最適化を支援する
 */

const v8 = require('v8');
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class MemoryMonitor extends EventEmitter {
  constructor(config = {}, logger = console) {
    super();
    this.config = {
      enabled: true,
      interval: 60000, // 1分ごと
      thresholds: {
        heapUsed: 500 * 1024 * 1024, // 500MB
        heapTotal: 1024 * 1024 * 1024, // 1GB
        rss: 1500 * 1024 * 1024, // 1.5GB
        external: 100 * 1024 * 1024 // 100MB
      },
      history: {
        maxEntries: 1440, // 24時間分（1分間隔）
        retentionDays: 7
      },
      snapshot: {
        enabled: true,
        interval: 3600000, // 1時間ごと
        path: './memory-snapshots'
      },
      ...config
    };
    
    this.logger = logger;
    this.history = [];
    this.monitoring = false;
    this.monitorInterval = null;
    this.snapshotInterval = null;
    this.startTime = Date.now();
    this.lastSnapshot = null;
    this.baselineMemory = null;
  }

  /**
   * 監視を開始
   */
  async start() {
    if (!this.config.enabled || this.monitoring) {
      return;
    }

    this.monitoring = true;
    this.baselineMemory = this.getCurrentMemoryUsage();
    
    // 定期的なメモリチェック
    this.monitorInterval = setInterval(() => {
      this.checkMemory();
    }, this.config.interval);

    // スナップショット取得
    if (this.config.snapshot.enabled) {
      await fs.mkdir(this.config.snapshot.path, { recursive: true });
      this.snapshotInterval = setInterval(() => {
        this.takeHeapSnapshot();
      }, this.config.snapshot.interval);
    }

    this.logger.info('メモリ監視を開始しました');
    this.emit('started');
  }

  /**
   * 監視を停止
   */
  stop() {
    if (!this.monitoring) {
      return;
    }

    this.monitoring = false;
    
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    if (this.snapshotInterval) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = null;
    }

    this.logger.info('メモリ監視を停止しました');
    this.emit('stopped');
  }

  /**
   * 現在のメモリ使用状況を取得
   */
  getCurrentMemoryUsage() {
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    
    return {
      timestamp: new Date().toISOString(),
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      // V8固有の統計
      totalHeapSize: heapStats.total_heap_size,
      totalHeapSizeExecutable: heapStats.total_heap_size_executable,
      totalPhysicalSize: heapStats.total_physical_size,
      totalAvailableSize: heapStats.total_available_size,
      usedHeapSize: heapStats.used_heap_size,
      heapSizeLimit: heapStats.heap_size_limit,
      mallocedMemory: heapStats.malloced_memory,
      peakMallocedMemory: heapStats.peak_malloced_memory,
      doesZapGarbage: heapStats.does_zap_garbage,
      numberOfNativeContexts: heapStats.number_of_native_contexts,
      numberOfDetachedContexts: heapStats.number_of_detached_contexts
    };
  }

  /**
   * メモリチェックを実行
   */
  async checkMemory() {
    const current = this.getCurrentMemoryUsage();
    
    // 履歴に追加
    this.history.push(current);
    
    // 履歴サイズ制限
    if (this.history.length > this.config.history.maxEntries) {
      this.history.shift();
    }

    // 閾値チェック
    const alerts = this.checkThresholds(current);
    if (alerts.length > 0) {
      this.emit('threshold-exceeded', { current, alerts });
      this.logger.warn('メモリ閾値超過:', alerts);
    }

    // メモリリーク検出
    const leakInfo = this.detectMemoryLeak();
    if (leakInfo) {
      this.emit('memory-leak-detected', leakInfo);
      this.logger.error('メモリリークの可能性を検出:', leakInfo);
    }

    // 統計情報を発行
    const stats = this.getStatistics();
    this.emit('memory-stats', { current, stats });
  }

  /**
   * 閾値チェック
   */
  checkThresholds(memoryUsage) {
    const alerts = [];
    
    if (memoryUsage.heapUsed > this.config.thresholds.heapUsed) {
      alerts.push({
        type: 'heapUsed',
        value: memoryUsage.heapUsed,
        threshold: this.config.thresholds.heapUsed,
        severity: 'warning'
      });
    }

    if (memoryUsage.heapTotal > this.config.thresholds.heapTotal) {
      alerts.push({
        type: 'heapTotal',
        value: memoryUsage.heapTotal,
        threshold: this.config.thresholds.heapTotal,
        severity: 'warning'
      });
    }

    if (memoryUsage.rss > this.config.thresholds.rss) {
      alerts.push({
        type: 'rss',
        value: memoryUsage.rss,
        threshold: this.config.thresholds.rss,
        severity: 'critical'
      });
    }

    if (memoryUsage.external > this.config.thresholds.external) {
      alerts.push({
        type: 'external',
        value: memoryUsage.external,
        threshold: this.config.thresholds.external,
        severity: 'warning'
      });
    }

    return alerts;
  }

  /**
   * メモリリーク検出
   */
  detectMemoryLeak() {
    if (this.history.length < 10) {
      return null; // 履歴が少なすぎる
    }

    // 最近10サンプルを分析
    const recentSamples = this.history.slice(-10);
    const heapUsedValues = recentSamples.map(s => s.heapUsed);
    
    // 線形回帰で増加傾向を分析
    const trend = this.calculateLinearTrend(heapUsedValues);
    
    // 1分あたり1MB以上増加している場合は警告
    const mbPerMinute = (trend.slope * this.config.interval) / (1024 * 1024);
    if (mbPerMinute > 1) {
      // 増加率を計算
      const firstValue = heapUsedValues[0];
      const lastValue = heapUsedValues[heapUsedValues.length - 1];
      const increaseRate = ((lastValue - firstValue) / firstValue) * 100;

      return {
        detected: true,
        mbPerMinute: mbPerMinute.toFixed(2),
        increaseRate: increaseRate.toFixed(2),
        trend: trend,
        samples: recentSamples.length,
        recommendation: this.getLeakRecommendation(mbPerMinute)
      };
    }

    return null;
  }

  /**
   * 線形トレンドを計算
   */
  calculateLinearTrend(values) {
    const n = values.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumX2 += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    return { slope, intercept };
  }

  /**
   * メモリリークに対する推奨事項
   */
  getLeakRecommendation(mbPerMinute) {
    if (mbPerMinute > 10) {
      return '深刻なメモリリークの可能性があります。即座にヒープダンプを取得し、分析してください。';
    } else if (mbPerMinute > 5) {
      return '中程度のメモリリークの可能性があります。近日中に調査することを推奨します。';
    } else {
      return '軽微なメモリリークの可能性があります。継続的に監視してください。';
    }
  }

  /**
   * ヒープスナップショットを取得
   */
  async takeHeapSnapshot() {
    if (!this.config.snapshot.enabled) {
      return;
    }

    try {
      const filename = `heap-${Date.now()}.heapsnapshot`;
      const filepath = path.join(this.config.snapshot.path, filename);
      
      // v8モジュールのwriteHeapSnapshot関数を使用
      v8.writeHeapSnapshot(filepath);
      
      this.lastSnapshot = {
        filename,
        filepath,
        timestamp: new Date().toISOString(),
        size: (await fs.stat(filepath)).size
      };

      this.emit('snapshot-taken', this.lastSnapshot);
      this.logger.info(`ヒープスナップショットを保存: ${filename}`);

      // 古いスナップショットを削除
      await this.cleanupOldSnapshots();
    } catch (error) {
      this.logger.error('ヒープスナップショット取得エラー:', error);
    }
  }

  /**
   * 古いスナップショットを削除
   */
  async cleanupOldSnapshots() {
    const files = await fs.readdir(this.config.snapshot.path);
    const snapshots = files.filter(f => f.endsWith('.heapsnapshot'));
    
    const cutoffTime = Date.now() - (this.config.history.retentionDays * 24 * 60 * 60 * 1000);
    
    for (const file of snapshots) {
      const filepath = path.join(this.config.snapshot.path, file);
      const stat = await fs.stat(filepath);
      
      if (stat.mtime.getTime() < cutoffTime) {
        await fs.unlink(filepath);
        this.logger.info(`古いスナップショットを削除: ${file}`);
      }
    }
  }

  /**
   * メモリ使用統計を取得
   */
  getStatistics() {
    if (this.history.length === 0) {
      return null;
    }

    const heapUsedValues = this.history.map(h => h.heapUsed);
    const rssValues = this.history.map(h => h.rss);

    return {
      samples: this.history.length,
      period: {
        start: this.history[0].timestamp,
        end: this.history[this.history.length - 1].timestamp
      },
      heapUsed: {
        current: heapUsedValues[heapUsedValues.length - 1],
        min: Math.min(...heapUsedValues),
        max: Math.max(...heapUsedValues),
        avg: heapUsedValues.reduce((a, b) => a + b, 0) / heapUsedValues.length
      },
      rss: {
        current: rssValues[rssValues.length - 1],
        min: Math.min(...rssValues),
        max: Math.max(...rssValues),
        avg: rssValues.reduce((a, b) => a + b, 0) / rssValues.length
      },
      trend: this.calculateLinearTrend(heapUsedValues)
    };
  }

  /**
   * メモリ最適化の実行
   */
  async optimize() {
    this.logger.info('メモリ最適化を開始します');
    
    const before = this.getCurrentMemoryUsage();
    
    // 手動ガベージコレクション（--expose-gcフラグが必要）
    if (global.gc) {
      global.gc();
      this.logger.info('ガベージコレクションを実行しました');
    } else {
      this.logger.warn('ガベージコレクションは利用できません（--expose-gcフラグが必要）');
    }

    // 少し待機
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const after = this.getCurrentMemoryUsage();
    
    const freed = {
      heapUsed: before.heapUsed - after.heapUsed,
      heapTotal: before.heapTotal - after.heapTotal,
      rss: before.rss - after.rss,
      external: before.external - after.external
    };

    this.emit('optimized', { before, after, freed });
    
    return {
      success: true,
      before,
      after,
      freed,
      freedMB: {
        heapUsed: (freed.heapUsed / (1024 * 1024)).toFixed(2),
        heapTotal: (freed.heapTotal / (1024 * 1024)).toFixed(2),
        rss: (freed.rss / (1024 * 1024)).toFixed(2),
        external: (freed.external / (1024 * 1024)).toFixed(2)
      }
    };
  }

  /**
   * レポートを生成
   */
  async generateReport() {
    const stats = this.getStatistics();
    const current = this.getCurrentMemoryUsage();
    const uptime = Date.now() - this.startTime;

    const report = {
      timestamp: new Date().toISOString(),
      uptime: uptime,
      uptimeHuman: this.formatDuration(uptime),
      current: {
        heapUsedMB: (current.heapUsed / (1024 * 1024)).toFixed(2),
        heapTotalMB: (current.heapTotal / (1024 * 1024)).toFixed(2),
        rssMB: (current.rss / (1024 * 1024)).toFixed(2),
        externalMB: (current.external / (1024 * 1024)).toFixed(2)
      },
      statistics: stats ? {
        samples: stats.samples,
        period: stats.period,
        heapUsed: {
          currentMB: (stats.heapUsed.current / (1024 * 1024)).toFixed(2),
          minMB: (stats.heapUsed.min / (1024 * 1024)).toFixed(2),
          maxMB: (stats.heapUsed.max / (1024 * 1024)).toFixed(2),
          avgMB: (stats.heapUsed.avg / (1024 * 1024)).toFixed(2)
        },
        rss: {
          currentMB: (stats.rss.current / (1024 * 1024)).toFixed(2),
          minMB: (stats.rss.min / (1024 * 1024)).toFixed(2),
          maxMB: (stats.rss.max / (1024 * 1024)).toFixed(2),
          avgMB: (stats.rss.avg / (1024 * 1024)).toFixed(2)
        }
      } : null,
      lastSnapshot: this.lastSnapshot,
      recommendations: this.generateRecommendations(current, stats)
    };

    return report;
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendations(current, stats) {
    const recommendations = [];

    // ヒープ使用量チェック
    if (current.heapUsed > this.config.thresholds.heapUsed * 0.8) {
      recommendations.push({
        type: 'warning',
        category: 'heap',
        message: 'ヒープ使用量が閾値の80%を超えています。不要なオブジェクトの解放を検討してください。'
      });
    }

    // RSS使用量チェック
    if (current.rss > this.config.thresholds.rss * 0.8) {
      recommendations.push({
        type: 'warning',
        category: 'rss',
        message: 'RSS使用量が閾値の80%を超えています。プロセスの再起動を検討してください。'
      });
    }

    // トレンドチェック
    if (stats && stats.trend.slope > 0) {
      const mbPerHour = (stats.trend.slope * 60 * 60 * 1000) / (1024 * 1024);
      if (mbPerHour > 10) {
        recommendations.push({
          type: 'critical',
          category: 'leak',
          message: `メモリが1時間あたり${mbPerHour.toFixed(2)}MB増加しています。メモリリークの調査が必要です。`
        });
      }
    }

    // デタッチされたコンテキスト
    if (current.numberOfDetachedContexts > 10) {
      recommendations.push({
        type: 'info',
        category: 'contexts',
        message: `${current.numberOfDetachedContexts}個のデタッチされたコンテキストがあります。クリーンアップを検討してください。`
      });
    }

    return recommendations;
  }

  /**
   * 期間をフォーマット
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}日 ${hours % 24}時間`;
    } else if (hours > 0) {
      return `${hours}時間 ${minutes % 60}分`;
    } else if (minutes > 0) {
      return `${minutes}分 ${seconds % 60}秒`;
    } else {
      return `${seconds}秒`;
    }
  }

  /**
   * メモリ履歴をエクスポート
   */
  async exportHistory(filepath) {
    const data = {
      metadata: {
        exported: new Date().toISOString(),
        samples: this.history.length,
        config: this.config
      },
      history: this.history,
      statistics: this.getStatistics()
    };

    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    this.logger.info(`メモリ履歴をエクスポート: ${filepath}`);
  }

  /**
   * クリーンアップ
   */
  cleanup() {
    this.stop();
    this.history = [];
    this.removeAllListeners();
  }
}

module.exports = MemoryMonitor;