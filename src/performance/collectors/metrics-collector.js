const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { performance } = require('perf_hooks');

/**
 * パフォーマンスメトリクス収集クラス
 * システムリソースとアプリケーションメトリクスを継続的に収集
 */
class MetricsCollector {
  constructor(options = {}) {
    this.interval = options.interval || 1000; // デフォルト1秒
    this.maxSamples = options.maxSamples || 3600; // 最大1時間分
    this.collectSystemMetrics = options.collectSystemMetrics !== false;
    this.collectProcessMetrics = options.collectProcessMetrics !== false;
    
    this.samples = [];
    this.collectors = new Map();
    this.intervalId = null;
    this.startTime = null;
    
    // カスタムメトリクス用のマーカー
    this.markers = new Map();
    this.counters = new Map();
  }

  /**
   * メトリクス収集の開始
   */
  start() {
    if (this.intervalId) {
      console.warn('メトリクス収集は既に開始されています');
      return;
    }

    this.startTime = Date.now();
    console.log('📊 メトリクス収集を開始しました');

    // 初回サンプル
    this.collectSample();

    // 定期収集
    this.intervalId = setInterval(() => {
      this.collectSample();
    }, this.interval);
  }

  /**
   * メトリクス収集の停止
   */
  stop() {
    if (!this.intervalId) {
      console.warn('メトリクス収集は開始されていません');
      return;
    }

    clearInterval(this.intervalId);
    this.intervalId = null;
    console.log('📊 メトリクス収集を停止しました');
  }

  /**
   * サンプルの収集
   */
  async collectSample() {
    const sample = {
      timestamp: Date.now(),
      elapsed: Date.now() - this.startTime
    };

    try {
      // システムメトリクス
      if (this.collectSystemMetrics) {
        sample.system = await this.collectSystemStats();
      }

      // プロセスメトリクス
      if (this.collectProcessMetrics) {
        sample.process = this.collectProcessStats();
      }

      // カスタムコレクター
      for (const [name, collector] of this.collectors) {
        try {
          sample[name] = await collector();
        } catch (error) {
          console.error(`カスタムコレクター "${name}" でエラー:`, error.message);
        }
      }

      // カスタムメトリクス
      sample.custom = {
        markers: Object.fromEntries(this.markers),
        counters: Object.fromEntries(this.counters)
      };

      // サンプルを保存
      this.samples.push(sample);

      // 最大サンプル数を超えたら古いものを削除
      if (this.samples.length > this.maxSamples) {
        this.samples.shift();
      }

    } catch (error) {
      console.error('メトリクス収集エラー:', error);
    }
  }

  /**
   * システム統計の収集
   */
  async collectSystemStats() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    
    // CPU使用率計算
    const cpuUsage = this.calculateSystemCpuUsage(cpus);
    
    // ディスク使用量（ルートパーティション）
    const diskUsage = await this.getDiskUsage('/');

    return {
      cpu: {
        usage: cpuUsage,
        loadAverage: {
          '1min': loadAvg[0],
          '5min': loadAvg[1],
          '15min': loadAvg[2]
        },
        count: cpus.length
      },
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem() * 100).toFixed(2)
      },
      disk: diskUsage,
      network: await this.getNetworkStats()
    };
  }

  /**
   * プロセス統計の収集
   */
  collectProcessStats() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // 前回のCPU使用量との差分を計算
    if (this.lastCpuUsage) {
      const userDiff = cpuUsage.user - this.lastCpuUsage.user;
      const systemDiff = cpuUsage.system - this.lastCpuUsage.system;
      const totalDiff = userDiff + systemDiff;
      const elapsedMs = this.interval;
      
      this.lastCpuUsage = cpuUsage;
      
      return {
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external,
          arrayBuffers: memUsage.arrayBuffers
        },
        cpu: {
          user: userDiff / 1000, // マイクロ秒からミリ秒に変換
          system: systemDiff / 1000,
          percent: (totalDiff / (elapsedMs * 1000) * 100).toFixed(2)
        },
        pid: process.pid,
        uptime: process.uptime()
      };
    } else {
      this.lastCpuUsage = cpuUsage;
      return {
        memory: {
          rss: memUsage.rss,
          heapTotal: memUsage.heapTotal,
          heapUsed: memUsage.heapUsed,
          external: memUsage.external,
          arrayBuffers: memUsage.arrayBuffers
        },
        cpu: {
          user: 0,
          system: 0,
          percent: '0.00'
        },
        pid: process.pid,
        uptime: process.uptime()
      };
    }
  }

  /**
   * システムCPU使用率の計算
   */
  calculateSystemCpuUsage(cpus) {
    if (!this.lastCpuInfo) {
      this.lastCpuInfo = cpus;
      return '0.00';
    }

    let totalDiff = 0;
    let idleDiff = 0;

    cpus.forEach((cpu, i) => {
      const lastCpu = this.lastCpuInfo[i];
      
      const currentTotal = Object.values(cpu.times).reduce((a, b) => a + b, 0);
      const lastTotal = Object.values(lastCpu.times).reduce((a, b) => a + b, 0);
      
      totalDiff += currentTotal - lastTotal;
      idleDiff += cpu.times.idle - lastCpu.times.idle;
    });

    this.lastCpuInfo = cpus;

    if (totalDiff === 0) {
      return '0.00';
    }

    const usage = (1 - idleDiff / totalDiff) * 100;
    return usage.toFixed(2);
  }

  /**
   * ディスク使用量の取得
   */
  async getDiskUsage(mountPath) {
    try {
      const { execSync } = require('child_process');
      
      if (process.platform === 'win32') {
        // Windows: wmic使用
        const output = execSync('wmic logicaldisk get size,freespace,caption', { encoding: 'utf8' });
        // 簡易的な解析（実装省略）
        return { total: 0, free: 0, used: 0, usagePercent: '0.00' };
      } else {
        // Unix系: dfコマンド使用
        const output = execSync(`df -k "${mountPath}" | tail -1`, { encoding: 'utf8' });
        const parts = output.trim().split(/\s+/);
        
        const total = parseInt(parts[1]) * 1024;
        const used = parseInt(parts[2]) * 1024;
        const free = parseInt(parts[3]) * 1024;
        const usagePercent = parts[4].replace('%', '');
        
        return { total, free, used, usagePercent };
      }
    } catch (error) {
      return { total: 0, free: 0, used: 0, usagePercent: '0.00' };
    }
  }

  /**
   * ネットワーク統計の取得（簡易版）
   */
  async getNetworkStats() {
    const interfaces = os.networkInterfaces();
    const stats = {
      interfaces: Object.keys(interfaces).length,
      ipv4: 0,
      ipv6: 0
    };

    Object.values(interfaces).forEach(iface => {
      iface.forEach(addr => {
        if (addr.family === 'IPv4') stats.ipv4++;
        if (addr.family === 'IPv6') stats.ipv6++;
      });
    });

    return stats;
  }

  /**
   * カスタムコレクターの登録
   */
  addCollector(name, collector) {
    if (typeof collector !== 'function') {
      throw new Error('コレクターは関数である必要があります');
    }
    this.collectors.set(name, collector);
  }

  /**
   * カスタムコレクターの削除
   */
  removeCollector(name) {
    this.collectors.delete(name);
  }

  /**
   * マーカーの設定（タイムスタンプ記録）
   */
  mark(name) {
    this.markers.set(name, performance.now());
  }

  /**
   * マーカー間の時間測定
   */
  measure(name, startMark, endMark) {
    const start = this.markers.get(startMark);
    const end = this.markers.get(endMark);
    
    if (start === undefined || end === undefined) {
      throw new Error('指定されたマーカーが見つかりません');
    }
    
    const duration = end - start;
    this.counters.set(name, duration);
    return duration;
  }

  /**
   * カウンターのインクリメント
   */
  increment(name, value = 1) {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
  }

  /**
   * 現在のスナップショット取得
   */
  getSnapshot() {
    if (this.samples.length === 0) {
      return null;
    }
    return this.samples[this.samples.length - 1];
  }

  /**
   * 統計サマリーの生成
   */
  getSummary() {
    if (this.samples.length === 0) {
      return null;
    }

    const summary = {
      duration: Date.now() - this.startTime,
      sampleCount: this.samples.length,
      startTime: new Date(this.startTime).toISOString(),
      endTime: new Date().toISOString()
    };

    // CPU統計
    if (this.collectSystemMetrics) {
      const cpuValues = this.samples
        .filter(s => s.system?.cpu?.usage)
        .map(s => parseFloat(s.system.cpu.usage));
      
      if (cpuValues.length > 0) {
        summary.cpu = {
          min: Math.min(...cpuValues),
          max: Math.max(...cpuValues),
          avg: (cpuValues.reduce((a, b) => a + b, 0) / cpuValues.length).toFixed(2)
        };
      }
    }

    // メモリ統計
    if (this.collectProcessMetrics) {
      const memValues = this.samples
        .filter(s => s.process?.memory?.heapUsed)
        .map(s => s.process.memory.heapUsed);
      
      if (memValues.length > 0) {
        summary.memory = {
          min: Math.min(...memValues),
          max: Math.max(...memValues),
          avg: Math.round(memValues.reduce((a, b) => a + b, 0) / memValues.length)
        };
      }
    }

    // カスタムメトリクス
    const lastSample = this.samples[this.samples.length - 1];
    if (lastSample.custom) {
      summary.custom = lastSample.custom;
    }

    return summary;
  }

  /**
   * メトリクスデータのエクスポート
   */
  async export(filepath) {
    const data = {
      metadata: {
        startTime: new Date(this.startTime).toISOString(),
        endTime: new Date().toISOString(),
        duration: Date.now() - this.startTime,
        sampleCount: this.samples.length,
        interval: this.interval
      },
      summary: this.getSummary(),
      samples: this.samples
    };

    await fs.writeFile(filepath, JSON.stringify(data, null, 2));
    console.log(`📁 メトリクスデータをエクスポートしました: ${filepath}`);
  }

  /**
   * メトリクスのリセット
   */
  reset() {
    this.samples = [];
    this.markers.clear();
    this.counters.clear();
    this.lastCpuUsage = null;
    this.lastCpuInfo = null;
    this.startTime = Date.now();
  }
}

module.exports = MetricsCollector;