const fs = require('fs');
const path = require('path');
const DatabaseManager = require('./database-manager');

/**
 * プロセス状態管理
 * プロセスの実行状態を記録・管理する
 */
class ProcessStateManager {
  constructor(logger) {
    this.logger = logger;
    this.stateFile = path.join(__dirname, '../logs/process-state.json');
    this.states = this.loadStates();
    this.metricsInterval = null;
    
    // データベースマネージャーを初期化
    try {
      this.db = new DatabaseManager();
      this.logger?.info('データベースマネージャーを初期化しました');
    } catch (error) {
      this.logger?.error('データベースマネージャーの初期化に失敗', error);
      this.db = null;
    }
    
    // 定期的にメトリクスを更新（5秒間隔）
    this.startMetricsCollection();
  }

  /**
   * 保存された状態を読み込み
   */
  loadStates() {
    try {
      if (fs.existsSync(this.stateFile)) {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger?.error('プロセス状態ファイルの読み込みエラー', error);
    }
    return {};
  }

  /**
   * 状態をファイルに保存
   */
  saveStates() {
    try {
      const dir = path.dirname(this.stateFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.stateFile, JSON.stringify(this.states, null, 2));
    } catch (error) {
      this.logger?.error('プロセス状態ファイルの保存エラー', error);
    }
  }

  /**
   * プロセス開始を記録
   */
  recordProcessStart(processId, issueNumber, type = 'claude-cli', title = null) {
    this.states[processId] = {
      processId,
      pid: process.pid,
      type,
      issueNumber,
      title,
      startTime: new Date().toISOString(),
      status: 'running',
      metrics: {
        cpuUsage: 0,
        memoryUsage: 0,
        elapsedTime: 0
      },
      lastOutput: '',
      lastUpdateTime: new Date().toISOString()
    };
    
    this.saveStates();
    
    // データベースに記録
    if (this.db) {
      try {
        this.db.recordProcessStart({
          processId,
          taskType: type,
          issueNumber,
          title,
          cpuUsage: 0,
          memoryUsage: 0
        });
      } catch (error) {
        this.logger?.error('データベースへのプロセス開始記録に失敗', error);
      }
    }
    
    this.logger?.info(`プロセス開始を記録: ${processId}`, {
      issueNumber,
      type
    });
  }

  /**
   * プロセス終了を記録
   */
  recordProcessEnd(processId, status = 'completed', exitCode = 0, error = null) {
    if (this.states[processId]) {
      this.states[processId].status = status;
      this.states[processId].endTime = new Date().toISOString();
      this.states[processId].exitCode = exitCode;
      
      // 経過時間を計算
      const startTime = new Date(this.states[processId].startTime);
      const endTime = new Date();
      this.states[processId].metrics.elapsedTime = Math.floor((endTime - startTime) / 1000);
      
      this.saveStates();
      
      // データベースに記録
      if (this.db) {
        try {
          this.db.recordProcessEnd(processId, {
            status: status === 'completed' ? 'success' : status,
            exitCode,
            error,
            cpuUsage: this.states[processId].metrics.cpuUsage || 0,
            memoryUsage: this.states[processId].metrics.memoryUsage || 0
          });
        } catch (error) {
          this.logger?.error('データベースへのプロセス終了記録に失敗', error);
        }
      }
      
      this.logger?.info(`プロセス終了を記録: ${processId}`, {
        status,
        exitCode,
        elapsedTime: this.states[processId].metrics.elapsedTime
      });
    }
  }

  /**
   * プロセスの出力を更新
   */
  updateProcessOutput(processId, output) {
    if (this.states[processId]) {
      // 最新の出力（最大500文字）
      this.states[processId].lastOutput = output.slice(-500);
      this.states[processId].lastUpdateTime = new Date().toISOString();
      this.saveStates();
    }
  }

  /**
   * プロセスのメトリクスを更新
   */
  updateProcessMetrics(processId, metrics) {
    if (this.states[processId]) {
      this.states[processId].metrics = {
        ...this.states[processId].metrics,
        ...metrics
      };
      this.states[processId].lastUpdateTime = new Date().toISOString();
      this.saveStates();
    }
  }

  /**
   * 実行中のプロセス一覧を取得
   */
  getRunningProcesses() {
    return Object.values(this.states).filter(p => p.status === 'running');
  }

  /**
   * すべてのプロセス状態を取得
   */
  getAllProcesses() {
    return Object.values(this.states);
  }

  /**
   * 特定のプロセス状態を取得
   */
  getProcess(processId) {
    return this.states[processId];
  }

  /**
   * 古いプロセス情報をクリーンアップ（24時間以上前のもの）
   */
  cleanupOldProcesses() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    let cleaned = 0;
    
    for (const [processId, state] of Object.entries(this.states)) {
      if (state.endTime && new Date(state.endTime) < oneDayAgo) {
        delete this.states[processId];
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.saveStates();
      this.logger?.info(`古いプロセス情報をクリーンアップ: ${cleaned}件`);
    }
  }

  /**
   * メトリクス収集を開始
   */
  startMetricsCollection() {
    // 5秒ごとにメトリクスを更新
    this.metricsInterval = setInterval(() => {
      this.collectMetrics();
    }, 5000);
  }

  /**
   * メトリクス収集を停止
   */
  stopMetricsCollection() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
      this.metricsInterval = null;
    }
  }

  /**
   * システムメトリクスを収集（簡易版）
   */
  async collectMetrics() {
    const runningProcesses = this.getRunningProcesses();
    
    for (const process of runningProcesses) {
      // 経過時間を更新
      const startTime = new Date(process.startTime);
      const now = new Date();
      const elapsedTime = Math.floor((now - startTime) / 1000);
      
      // プロセスメモリ使用量を取得（簡易版）
      const memoryUsage = process.pid ? this.getProcessMemoryUsage(process.pid) : 0;
      
      const metrics = {
        elapsedTime,
        cpuUsage: 0, // CPU使用量は将来的に実装
        memoryUsage
      };
      
      this.updateProcessMetrics(process.processId, metrics);
      
      // データベースにメトリクスを記録
      if (this.db && memoryUsage > 0) {
        try {
          this.db.recordMetric(process.processId, 'memory_usage', memoryUsage);
        } catch (error) {
          // エラーは無視（ログが大量になるのを防ぐ）
        }
      }
    }
  }

  /**
   * プロセスのメモリ使用量を取得（簡易版）
   */
  getProcessMemoryUsage(pid) {
    try {
      // Node.jsプロセスのメモリ使用量を取得
      if (pid === process.pid) {
        const usage = process.memoryUsage();
        return Math.round(usage.heapUsed / 1024 / 1024); // MB単位
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * システム全体の統計情報を取得
   */
  getSystemStats() {
    const allProcesses = this.getAllProcesses();
    const runningProcesses = this.getRunningProcesses();
    
    return {
      total: allProcesses.length,
      running: runningProcesses.length,
      completed: allProcesses.filter(p => p.status === 'completed').length,
      error: allProcesses.filter(p => p.status === 'error').length,
      timeout: allProcesses.filter(p => p.status === 'timeout').length
    };
  }

  /**
   * クリーンアップ時にデータベースを閉じる
   */
  cleanup() {
    this.stopMetricsCollection();
    if (this.db) {
      this.db.close();
    }
  }
}

module.exports = ProcessStateManager;