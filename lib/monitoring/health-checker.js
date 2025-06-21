/**
 * Health Checker
 * プロセスとシステムの健全性を監視
 */

const { EventEmitter } = require('events');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');

class HealthChecker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      checkInterval: options.checkInterval || 30000, // 30秒
      memoryThreshold: options.memoryThreshold || 0.85, // 85%
      cpuThreshold: options.cpuThreshold || 0.90, // 90%
      responseTimeout: options.responseTimeout || 5000, // 5秒
      diskThreshold: options.diskThreshold || 0.90, // 90%
      enableAutoRecovery: options.enableAutoRecovery !== false,
      ...options
    };
    
    this.isRunning = false;
    this.checkTimer = null;
    this.lastCheck = null;
    this.healthStatus = {
      overall: 'healthy',
      checks: {},
      lastUpdate: null
    };
    
    // ヘルスチェック関数のレジストリ
    this.healthChecks = new Map();
    this.registerDefaultChecks();
  }

  /**
   * デフォルトのヘルスチェックを登録
   */
  registerDefaultChecks() {
    // メモリ使用率チェック
    this.registerCheck('memory', async () => {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      const usage = usedMemory / totalMemory;
      
      const status = usage > this.options.memoryThreshold ? 'unhealthy' : 'healthy';
      
      return {
        status,
        metric: usage,
        threshold: this.options.memoryThreshold,
        details: {
          total: totalMemory,
          used: usedMemory,
          free: freeMemory,
          percentage: (usage * 100).toFixed(2) + '%'
        }
      };
    });
    
    // CPU使用率チェック
    this.registerCheck('cpu', async () => {
      const usage = await this.getCpuUsage();
      const status = usage > this.options.cpuThreshold ? 'unhealthy' : 'healthy';
      
      return {
        status,
        metric: usage,
        threshold: this.options.cpuThreshold,
        details: {
          percentage: (usage * 100).toFixed(2) + '%',
          cores: os.cpus().length
        }
      };
    });
    
    // ディスク容量チェック
    this.registerCheck('disk', async () => {
      const diskInfo = await this.getDiskUsage();
      const usage = diskInfo.used / diskInfo.total;
      const status = usage > this.options.diskThreshold ? 'unhealthy' : 'healthy';
      
      return {
        status,
        metric: usage,
        threshold: this.options.diskThreshold,
        details: {
          total: diskInfo.total,
          used: diskInfo.used,
          available: diskInfo.available,
          percentage: (usage * 100).toFixed(2) + '%'
        }
      };
    });
    
    // システム負荷チェック
    this.registerCheck('load', async () => {
      const loadAvg = os.loadavg();
      const cores = os.cpus().length;
      const load1m = loadAvg[0] / cores;
      const status = load1m > 2.0 ? 'unhealthy' : 'healthy';
      
      return {
        status,
        metric: load1m,
        threshold: 2.0,
        details: {
          '1m': loadAvg[0].toFixed(2),
          '5m': loadAvg[1].toFixed(2),
          '15m': loadAvg[2].toFixed(2),
          cores
        }
      };
    });
  }

  /**
   * カスタムヘルスチェックを登録
   */
  registerCheck(name, checkFunction) {
    this.healthChecks.set(name, checkFunction);
    this.emit('check-registered', { name });
  }

  /**
   * ヘルスチェックを開始
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Health checker is already running');
    }
    
    this.isRunning = true;
    
    // 初回チェック
    await this.performHealthCheck();
    
    // 定期的なチェック
    this.checkTimer = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        console.error('Health check error:', error);
        this.emit('error', error);
      }
    }, this.options.checkInterval);
    
    this.emit('started');
  }

  /**
   * ヘルスチェックを停止
   */
  stop() {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * ヘルスチェックを実行
   */
  async performHealthCheck() {
    const startTime = Date.now();
    const results = {};
    let overallStatus = 'healthy';
    
    // 各チェックを実行
    for (const [name, checkFunction] of this.healthChecks) {
      try {
        const result = await Promise.race([
          checkFunction(),
          this.timeout(this.options.responseTimeout, name)
        ]);
        
        results[name] = {
          ...result,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime
        };
        
        // 全体ステータスの更新
        if (result.status === 'unhealthy') {
          overallStatus = 'unhealthy';
        }
        
      } catch (error) {
        results[name] = {
          status: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        };
        overallStatus = 'unhealthy';
      }
    }
    
    // ヘルスステータスを更新
    this.healthStatus = {
      overall: overallStatus,
      checks: results,
      lastUpdate: new Date().toISOString(),
      duration: Date.now() - startTime
    };
    
    this.lastCheck = Date.now();
    
    // イベント発行
    this.emit('health-check-completed', this.healthStatus);
    
    // 不健全な状態の場合
    if (overallStatus === 'unhealthy') {
      this.emit('unhealthy', this.healthStatus);
      
      // 自動回復が有効な場合
      if (this.options.enableAutoRecovery) {
        this.emit('recovery-needed', this.healthStatus);
      }
    }
    
    return this.healthStatus;
  }

  /**
   * 特定のチェックを実行
   */
  async runCheck(name) {
    const checkFunction = this.healthChecks.get(name);
    if (!checkFunction) {
      throw new Error(`Health check '${name}' not found`);
    }
    
    return await checkFunction();
  }

  /**
   * 現在のヘルスステータスを取得
   */
  getStatus() {
    return this.healthStatus;
  }

  /**
   * ヘルスステータスのサマリーを取得
   */
  getSummary() {
    const { overall, checks, lastUpdate } = this.healthStatus;
    const checkCount = Object.keys(checks).length;
    const healthyCount = Object.values(checks).filter(c => c.status === 'healthy').length;
    const unhealthyCount = Object.values(checks).filter(c => c.status === 'unhealthy').length;
    const errorCount = Object.values(checks).filter(c => c.status === 'error').length;
    
    return {
      overall,
      lastUpdate,
      summary: {
        total: checkCount,
        healthy: healthyCount,
        unhealthy: unhealthyCount,
        error: errorCount
      },
      checks: Object.entries(checks).map(([name, check]) => ({
        name,
        status: check.status,
        metric: check.metric,
        threshold: check.threshold
      }))
    };
  }

  /**
   * CPU使用率を取得
   */
  async getCpuUsage() {
    const startUsage = process.cpuUsage();
    const startTime = process.hrtime.bigint();
    
    // 100ms待機
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const endUsage = process.cpuUsage(startUsage);
    const endTime = process.hrtime.bigint();
    
    const elapsedTime = Number(endTime - startTime);
    const elapsedUserTime = endUsage.user;
    const elapsedSystemTime = endUsage.system;
    const totalTime = elapsedUserTime + elapsedSystemTime;
    
    return totalTime / elapsedTime;
  }

  /**
   * ディスク使用状況を取得
   */
  async getDiskUsage() {
    // 簡易実装（実際の実装では df コマンドなどを使用）
    const stats = await fs.statfs(os.homedir());
    
    return {
      total: stats.blocks * stats.bsize,
      used: (stats.blocks - stats.bfree) * stats.bsize,
      available: stats.bavail * stats.bsize
    };
  }

  /**
   * タイムアウトヘルパー
   */
  timeout(ms, name) {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Health check '${name}' timed out after ${ms}ms`));
      }, ms);
    });
  }

  /**
   * ヘルスチェック結果をエクスポート
   */
  async exportStatus(format = 'json') {
    const status = this.getStatus();
    
    switch (format) {
      case 'json':
        return JSON.stringify(status, null, 2);
        
      case 'prometheus':
        return this.toPrometheusFormat(status);
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * Prometheus形式に変換
   */
  toPrometheusFormat(status) {
    const lines = [];
    
    // 全体ステータス
    lines.push(`# HELP health_status Overall health status (1=healthy, 0=unhealthy)`);
    lines.push(`# TYPE health_status gauge`);
    lines.push(`health_status ${status.overall === 'healthy' ? 1 : 0}`);
    
    // 各チェックの結果
    for (const [name, check] of Object.entries(status.checks)) {
      if (check.metric !== undefined) {
        lines.push(`# HELP health_check_${name} Health check metric for ${name}`);
        lines.push(`# TYPE health_check_${name} gauge`);
        lines.push(`health_check_${name} ${check.metric}`);
      }
      
      lines.push(`# HELP health_check_${name}_status Health check status for ${name} (1=healthy, 0=unhealthy)`);
      lines.push(`# TYPE health_check_${name}_status gauge`);
      lines.push(`health_check_${name}_status ${check.status === 'healthy' ? 1 : 0}`);
    }
    
    return lines.join('\n');
  }
}

module.exports = HealthChecker;