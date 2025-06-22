const os = require('os');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const fs = require('fs').promises;
const path = require('path');
const Logger = require('../logger');

/**
 * システムモニター
 * OS レベルのリソース使用状況を監視
 */
class SystemMonitor {
  constructor() {
    this.logger = new Logger('SystemMonitor');
    
    // しきい値の設定
    this.thresholds = {
      cpu: {
        warning: 70,
        critical: 85
      },
      memory: {
        warning: 80,
        critical: 90
      },
      disk: {
        warning: 80,
        critical: 90
      },
      loadAverage: {
        warning: 2.0,
        critical: 4.0
      }
    };
    
    // CPU使用率計算用の前回値
    this.previousCpuInfo = null;
  }
  
  /**
   * システム層のヘルスチェック
   */
  async check() {
    const startTime = Date.now();
    
    try {
      const details = {
        cpu: await this.getCpuUsage(),
        memory: await this.getMemoryUsage(),
        disk: await this.getDiskUsage(),
        loadAverage: this.getLoadAverage(),
        uptime: os.uptime(),
        platform: process.platform,
        nodeVersion: process.version,
        issues: []
      };
      
      // 問題の検出
      this.detectIssues(details);
      
      // スコアの計算
      const score = this.calculateScore(details);
      
      // ステータスの判定
      const status = score >= 80 ? 'healthy' : score >= 60 ? 'degraded' : 'unhealthy';
      
      return {
        status,
        score,
        details,
        checkDuration: Date.now() - startTime
      };
      
    } catch (error) {
      this.logger.error('システムチェックエラー:', error);
      return {
        status: 'error',
        score: 0,
        error: error.message,
        checkDuration: Date.now() - startTime
      };
    }
  }
  
  /**
   * CPU使用率の取得
   */
  async getCpuUsage() {
    try {
      const cpus = os.cpus();
      
      // 現在のCPU情報を取得
      const currentCpuInfo = cpus.reduce((acc, cpu) => {
        acc.user += cpu.times.user;
        acc.nice += cpu.times.nice;
        acc.sys += cpu.times.sys;
        acc.idle += cpu.times.idle;
        acc.irq += cpu.times.irq;
        return acc;
      }, { user: 0, nice: 0, sys: 0, idle: 0, irq: 0 });
      
      // 初回実行時は0を返す
      if (!this.previousCpuInfo) {
        this.previousCpuInfo = currentCpuInfo;
        // 少し待ってから再計測
        await new Promise(resolve => setTimeout(resolve, 100));
        return this.getCpuUsage();
      }
      
      // CPU使用率を計算
      const totalDiff = Object.values(currentCpuInfo).reduce((a, b) => a + b) -
                       Object.values(this.previousCpuInfo).reduce((a, b) => a + b);
      const idleDiff = currentCpuInfo.idle - this.previousCpuInfo.idle;
      
      const usage = totalDiff > 0 ? Math.round((1 - idleDiff / totalDiff) * 100) : 0;
      
      // 次回のために現在値を保存
      this.previousCpuInfo = currentCpuInfo;
      
      return Math.min(100, Math.max(0, usage));
      
    } catch (error) {
      this.logger.error('CPU使用率取得エラー:', error);
      return 0;
    }
  }
  
  /**
   * メモリ使用率の取得
   */
  async getMemoryUsage() {
    try {
      const totalMemory = os.totalmem();
      const freeMemory = os.freemem();
      const usedMemory = totalMemory - freeMemory;
      
      return Math.round((usedMemory / totalMemory) * 100);
      
    } catch (error) {
      this.logger.error('メモリ使用率取得エラー:', error);
      return 0;
    }
  }
  
  /**
   * ディスク使用率の取得
   */
  async getDiskUsage() {
    try {
      // プロジェクトディレクトリのパスを取得
      const projectDir = path.resolve(__dirname, '../..');
      
      if (process.platform === 'win32') {
        // Windows の場合
        const { stdout } = await exec('wmic logicaldisk get size,freespace,caption');
        const lines = stdout.trim().split('\n').slice(1);
        
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length >= 3 && projectDir.startsWith(parts[0])) {
            const free = parseInt(parts[1]);
            const size = parseInt(parts[2]);
            if (size > 0) {
              return Math.round(((size - free) / size) * 100);
            }
          }
        }
        
      } else {
        // Unix系の場合
        const { stdout } = await exec(`df -k "${projectDir}" | tail -1`);
        const parts = stdout.trim().split(/\s+/);
        
        // df の出力形式に応じて解析
        let usage;
        if (parts.length >= 5) {
          // 通常の形式: Filesystem 1K-blocks Used Available Use% Mounted
          usage = parseInt(parts[4]);
        } else if (parts.length >= 3) {
          // 簡略形式
          const used = parseInt(parts[1]);
          const available = parseInt(parts[2]);
          const total = used + available;
          usage = Math.round((used / total) * 100);
        }
        
        if (!isNaN(usage)) {
          return usage;
        }
      }
      
      // デフォルト値
      return 0;
      
    } catch (error) {
      this.logger.error('ディスク使用率取得エラー:', error);
      return 0;
    }
  }
  
  /**
   * ロードアベレージの取得
   */
  getLoadAverage() {
    try {
      const loadAvg = os.loadavg();
      const cpuCount = os.cpus().length;
      
      // CPU数で正規化した1分間のロードアベレージ
      return {
        oneMinute: loadAvg[0],
        fiveMinute: loadAvg[1],
        fifteenMinute: loadAvg[2],
        normalized: loadAvg[0] / cpuCount
      };
      
    } catch (error) {
      this.logger.error('ロードアベレージ取得エラー:', error);
      return {
        oneMinute: 0,
        fiveMinute: 0,
        fifteenMinute: 0,
        normalized: 0
      };
    }
  }
  
  /**
   * 問題の検出
   */
  detectIssues(details) {
    // CPU使用率チェック
    if (details.cpu >= this.thresholds.cpu.critical) {
      details.issues.push(`CPU使用率が危険レベルです（${details.cpu}%）`);
    } else if (details.cpu >= this.thresholds.cpu.warning) {
      details.issues.push(`CPU使用率が高くなっています（${details.cpu}%）`);
    }
    
    // メモリ使用率チェック
    if (details.memory >= this.thresholds.memory.critical) {
      details.issues.push(`メモリ使用率が危険レベルです（${details.memory}%）`);
    } else if (details.memory >= this.thresholds.memory.warning) {
      details.issues.push(`メモリ使用率が高くなっています（${details.memory}%）`);
    }
    
    // ディスク使用率チェック
    if (details.disk >= this.thresholds.disk.critical) {
      details.issues.push(`ディスク使用率が危険レベルです（${details.disk}%）`);
    } else if (details.disk >= this.thresholds.disk.warning) {
      details.issues.push(`ディスク使用率が高くなっています（${details.disk}%）`);
    }
    
    // ロードアベレージチェック
    if (details.loadAverage.normalized >= this.thresholds.loadAverage.critical) {
      details.issues.push(`システム負荷が非常に高くなっています（${details.loadAverage.oneMinute.toFixed(2)}）`);
    } else if (details.loadAverage.normalized >= this.thresholds.loadAverage.warning) {
      details.issues.push(`システム負荷が高くなっています（${details.loadAverage.oneMinute.toFixed(2)}）`);
    }
  }
  
  /**
   * システム層のスコア計算
   */
  calculateScore(details) {
    let score = 100;
    
    // CPU使用率によるスコア減少
    if (details.cpu >= this.thresholds.cpu.critical) {
      score -= 30;
    } else if (details.cpu >= this.thresholds.cpu.warning) {
      score -= 15;
    } else {
      // 線形にスコアを減少（0-70%の範囲で）
      score -= Math.floor(details.cpu / 70 * 10);
    }
    
    // メモリ使用率によるスコア減少
    if (details.memory >= this.thresholds.memory.critical) {
      score -= 25;
    } else if (details.memory >= this.thresholds.memory.warning) {
      score -= 12;
    } else {
      // 線形にスコアを減少（0-80%の範囲で）
      score -= Math.floor(details.memory / 80 * 8);
    }
    
    // ディスク使用率によるスコア減少
    if (details.disk >= this.thresholds.disk.critical) {
      score -= 20;
    } else if (details.disk >= this.thresholds.disk.warning) {
      score -= 10;
    } else {
      // 線形にスコアを減少（0-80%の範囲で）
      score -= Math.floor(details.disk / 80 * 5);
    }
    
    // ロードアベレージによるスコア減少
    if (details.loadAverage.normalized >= this.thresholds.loadAverage.critical) {
      score -= 15;
    } else if (details.loadAverage.normalized >= this.thresholds.loadAverage.warning) {
      score -= 8;
    }
    
    // スコアを0-100の範囲に制限
    return Math.max(0, Math.min(100, score));
  }
  
  /**
   * システム情報の詳細取得
   */
  async getDetailedInfo() {
    return {
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      cpus: os.cpus().length,
      totalMemory: Math.round(os.totalmem() / 1024 / 1024 / 1024 * 100) / 100, // GB
      freeMemory: Math.round(os.freemem() / 1024 / 1024 / 1024 * 100) / 100, // GB
      uptime: os.uptime(),
      nodeVersion: process.version,
      pid: process.pid
    };
  }
}

module.exports = SystemMonitor;