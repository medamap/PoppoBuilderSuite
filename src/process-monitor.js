/**
 * プロセス監視システム
 * システムヘルスの監視とアラート機能を提供
 */
const os = require('os');
const { EventEmitter } = require('events');

class ProcessMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.config = {
      checkInterval: options.checkInterval || 30000, // 30秒
      thresholds: {
        processCount: options.thresholds?.processCount || 10,
        queueSize: options.thresholds?.queueSize || 50,
        lockFailureRate: options.thresholds?.lockFailureRate || 0.3, // 30%
        errorRate: options.thresholds?.errorRate || 0.1, // 10%
        memoryUsage: options.thresholds?.memoryUsage || 0.8, // 80%
        cpuUsage: options.thresholds?.cpuUsage || 0.9 // 90%
      },
      alertCooldown: options.alertCooldown || 300000 // 5分
    };
    
    this.logger = options.logger || console;
    
    // メトリクス
    this.metrics = {
      processCount: 0,
      queueSize: 0,
      lockAttempts: 0,
      lockFailures: 0,
      taskAttempts: 0,
      taskErrors: 0,
      memoryUsage: 0,
      cpuUsage: 0,
      lastCheck: null
    };
    
    // 履歴データ（トレンド分析用）
    this.history = {
      processCount: [],
      queueSize: [],
      errorRate: [],
      memoryUsage: [],
      cpuUsage: []
    };
    
    // アラート管理
    this.lastAlerts = new Map(); // alertType -> timestamp
    this.activeAlerts = new Set();
    
    // 監視対象の参照
    this.monitoredComponents = {
      processManager: null,
      taskQueue: null,
      lockManager: null,
      retryManager: null
    };
    
    // 監視インターバル
    this.monitoringInterval = null;
  }

  /**
   * 監視対象コンポーネントを設定
   */
  setComponents(components) {
    Object.assign(this.monitoredComponents, components);
  }

  /**
   * 監視を開始
   */
  start() {
    if (this.monitoringInterval) {
      this.logger.warn('Process monitoring is already running');
      return;
    }
    
    this.logger.info('Starting process monitoring...');
    
    // 初回チェック
    this.performHealthCheck();
    
    // 定期チェック
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.checkInterval);
  }

  /**
   * 監視を停止
   */
  stop() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.logger.info('Process monitoring stopped');
    }
  }

  /**
   * ヘルスチェックを実行
   */
  async performHealthCheck() {
    try {
      // メトリクスを収集
      await this.collectMetrics();
      
      // 履歴に追加
      this.updateHistory();
      
      // 閾値チェック
      this.checkThresholds();
      
      // イベント発火
      this.emit('healthCheck', {
        metrics: this.metrics,
        alerts: Array.from(this.activeAlerts)
      });
      
    } catch (error) {
      this.logger.error('Health check failed:', error);
    }
  }

  /**
   * メトリクスを収集
   */
  async collectMetrics() {
    const timestamp = Date.now();
    
    // プロセス数
    if (this.monitoredComponents.processManager) {
      try {
        const processes = await this.monitoredComponents.processManager.getRunningProcesses();
        this.metrics.processCount = processes.length;
      } catch (error) {
        this.logger.warn('Failed to get process count:', error.message);
      }
    }
    
    // キューサイズ
    if (this.monitoredComponents.taskQueue) {
      this.metrics.queueSize = this.monitoredComponents.taskQueue.getQueueSize();
    }
    
    // ロック統計
    if (this.monitoredComponents.lockManager && this.monitoredComponents.lockManager.getStats) {
      const lockStats = await this.monitoredComponents.lockManager.getStats();
      this.metrics.lockAttempts = lockStats.attempts || 0;
      this.metrics.lockFailures = lockStats.failures || 0;
    }
    
    // リトライ統計
    if (this.monitoredComponents.retryManager) {
      const retryStats = this.monitoredComponents.retryManager.getStats();
      this.metrics.activeRetries = retryStats.activeRetries || 0;
    }
    
    // システムリソース
    this.metrics.memoryUsage = this.getMemoryUsage();
    this.metrics.cpuUsage = await this.getCpuUsage();
    
    this.metrics.lastCheck = timestamp;
  }

  /**
   * メモリ使用率を取得
   */
  getMemoryUsage() {
    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    const usedMemory = totalMemory - freeMemory;
    return usedMemory / totalMemory;
  }

  /**
   * CPU使用率を取得
   */
  async getCpuUsage() {
    return new Promise((resolve) => {
      const startMeasure = this.cpuAverage();
      
      setTimeout(() => {
        const endMeasure = this.cpuAverage();
        const idleDiff = endMeasure.idle - startMeasure.idle;
        const totalDiff = endMeasure.total - startMeasure.total;
        const usage = 1 - (idleDiff / totalDiff);
        resolve(Math.min(1, Math.max(0, usage)));
      }, 100);
    });
  }

  /**
   * CPU平均値を計算
   */
  cpuAverage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;
    
    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });
    
    return {
      idle: totalIdle / cpus.length,
      total: totalTick / cpus.length
    };
  }

  /**
   * 履歴を更新
   */
  updateHistory() {
    const maxHistorySize = 100;
    
    // 各メトリクスの履歴に追加
    this.addToHistory('processCount', this.metrics.processCount, maxHistorySize);
    this.addToHistory('queueSize', this.metrics.queueSize, maxHistorySize);
    this.addToHistory('memoryUsage', this.metrics.memoryUsage, maxHistorySize);
    this.addToHistory('cpuUsage', this.metrics.cpuUsage, maxHistorySize);
    
    // エラー率を計算して追加
    const errorRate = this.calculateErrorRate();
    this.addToHistory('errorRate', errorRate, maxHistorySize);
  }

  /**
   * 履歴配列に追加（サイズ制限付き）
   */
  addToHistory(metric, value, maxSize) {
    if (!this.history[metric]) {
      this.history[metric] = [];
    }
    
    this.history[metric].push({
      timestamp: Date.now(),
      value: value
    });
    
    // サイズ制限
    if (this.history[metric].length > maxSize) {
      this.history[metric].shift();
    }
  }

  /**
   * エラー率を計算
   */
  calculateErrorRate() {
    if (this.metrics.taskAttempts === 0) {
      return 0;
    }
    return this.metrics.taskErrors / this.metrics.taskAttempts;
  }

  /**
   * ロック失敗率を計算
   */
  calculateLockFailureRate() {
    if (this.metrics.lockAttempts === 0) {
      return 0;
    }
    return this.metrics.lockFailures / this.metrics.lockAttempts;
  }

  /**
   * 閾値チェック
   */
  checkThresholds() {
    const checks = [
      {
        name: 'PROCESS_COUNT_HIGH',
        condition: this.metrics.processCount > this.config.thresholds.processCount,
        message: `Process count (${this.metrics.processCount}) exceeds threshold (${this.config.thresholds.processCount})`
      },
      {
        name: 'QUEUE_SIZE_HIGH',
        condition: this.metrics.queueSize > this.config.thresholds.queueSize,
        message: `Queue size (${this.metrics.queueSize}) exceeds threshold (${this.config.thresholds.queueSize})`
      },
      {
        name: 'LOCK_FAILURE_RATE_HIGH',
        condition: this.calculateLockFailureRate() > this.config.thresholds.lockFailureRate,
        message: `Lock failure rate (${(this.calculateLockFailureRate() * 100).toFixed(1)}%) exceeds threshold (${this.config.thresholds.lockFailureRate * 100}%)`
      },
      {
        name: 'ERROR_RATE_HIGH',
        condition: this.calculateErrorRate() > this.config.thresholds.errorRate,
        message: `Error rate (${(this.calculateErrorRate() * 100).toFixed(1)}%) exceeds threshold (${this.config.thresholds.errorRate * 100}%)`
      },
      {
        name: 'MEMORY_USAGE_HIGH',
        condition: this.metrics.memoryUsage > this.config.thresholds.memoryUsage,
        message: `Memory usage (${(this.metrics.memoryUsage * 100).toFixed(1)}%) exceeds threshold (${this.config.thresholds.memoryUsage * 100}%)`
      },
      {
        name: 'CPU_USAGE_HIGH',
        condition: this.metrics.cpuUsage > this.config.thresholds.cpuUsage,
        message: `CPU usage (${(this.metrics.cpuUsage * 100).toFixed(1)}%) exceeds threshold (${this.config.thresholds.cpuUsage * 100}%)`
      }
    ];
    
    // 各チェックを実行
    checks.forEach(check => {
      if (check.condition) {
        this.raiseAlert(check.name, check.message);
      } else {
        this.clearAlert(check.name);
      }
    });
  }

  /**
   * アラートを発生
   */
  raiseAlert(type, message) {
    const now = Date.now();
    const lastAlert = this.lastAlerts.get(type);
    
    // クールダウン期間中はスキップ
    if (lastAlert && (now - lastAlert) < this.config.alertCooldown) {
      return;
    }
    
    // 新規アラートの場合
    if (!this.activeAlerts.has(type)) {
      this.activeAlerts.add(type);
      this.lastAlerts.set(type, now);
      
      this.logger.warn(`🚨 ALERT: ${type} - ${message}`);
      
      this.emit('alert', {
        type: type,
        message: message,
        timestamp: now,
        metrics: { ...this.metrics }
      });
    }
  }

  /**
   * アラートをクリア
   */
  clearAlert(type) {
    if (this.activeAlerts.has(type)) {
      this.activeAlerts.delete(type);
      this.logger.info(`✅ Alert cleared: ${type}`);
      
      this.emit('alertCleared', {
        type: type,
        timestamp: Date.now()
      });
    }
  }

  /**
   * タスク試行を記録
   */
  recordTaskAttempt() {
    this.metrics.taskAttempts++;
  }

  /**
   * タスクエラーを記録
   */
  recordTaskError() {
    this.metrics.taskErrors++;
  }

  /**
   * ロック試行を記録
   */
  recordLockAttempt() {
    this.metrics.lockAttempts++;
  }

  /**
   * ロック失敗を記録
   */
  recordLockFailure() {
    this.metrics.lockFailures++;
  }

  /**
   * 現在のステータスを取得
   */
  getStatus() {
    return {
      metrics: { ...this.metrics },
      activeAlerts: Array.from(this.activeAlerts),
      thresholds: { ...this.config.thresholds },
      trends: this.calculateTrends()
    };
  }

  /**
   * トレンドを計算
   */
  calculateTrends() {
    const trends = {};
    
    ['processCount', 'queueSize', 'errorRate', 'memoryUsage', 'cpuUsage'].forEach(metric => {
      const history = this.history[metric] || [];
      if (history.length >= 2) {
        const recent = history.slice(-10); // 最新10件
        const values = recent.map(h => h.value);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const first = values[0];
        const last = values[values.length - 1];
        
        trends[metric] = {
          average: avg,
          change: last - first,
          direction: last > first ? 'up' : last < first ? 'down' : 'stable'
        };
      }
    });
    
    return trends;
  }
}

module.exports = ProcessMonitor;