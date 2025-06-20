const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const os = require('os');
const DatabaseManager = require('./database-manager');
const EventEmitter = require('events');

/**
 * プロセス状態管理
 * プロセスの実行状態を記録・管理する
 */
class ProcessStateManager extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.stateFile = path.join(__dirname, '../logs/process-state.json');
    this.states = this.loadStates();
    this.metricsInterval = null;
    this.cpuUsageCache = {}; // PIDごとのCPU使用量キャッシュ
    this.lastCpuMeasurement = {}; // 前回のCPU測定値
    
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
    const processInfo = {
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
    
    this.states[processId] = processInfo;
    this.saveStates();
    
    // イベントを発行
    this.emit('process-added', processInfo);
    
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
      
      // イベントを発行
      this.emit('process-removed', processId);
      
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
      
      // イベントを発行（プロセス更新）
      this.emit('process-updated', this.states[processId]);
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
      
      // イベントを発行（プロセス更新）
      this.emit('process-updated', this.states[processId]);
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
   * システムメトリクスを収集（CPU使用率を含む）
   */
  async collectMetrics() {
    const runningProcesses = this.getRunningProcesses();
    
    for (const process of runningProcesses) {
      try {
        // 経過時間を更新
        const startTime = new Date(process.startTime);
        const now = new Date();
        const elapsedTime = Math.floor((now - startTime) / 1000);
        
        // プロセスメモリ使用量を取得
        const memoryUsage = process.pid ? this.getProcessMemoryUsage(process.pid) : 0;
        
        // CPU使用率を取得（非同期）
        const cpuUsage = process.pid ? await this.getProcessCpuUsage(process.pid) : 0;
        
        const metrics = {
          elapsedTime,
          cpuUsage,
          memoryUsage
        };
        
        this.updateProcessMetrics(process.processId, metrics);
        
        // データベースにメトリクスを記録
        if (this.db) {
          try {
            if (memoryUsage > 0) {
              this.db.recordMetric(process.processId, 'memory_usage', memoryUsage);
            }
            if (cpuUsage > 0) {
              this.db.recordMetric(process.processId, 'cpu_usage', cpuUsage);
            }
          } catch (error) {
            // エラーは無視（ログが大量になるのを防ぐ）
          }
        }
      } catch (error) {
        // 個別のプロセスでエラーが発生しても続行
        this.logger?.debug(`プロセス ${process.processId} のメトリクス収集エラー:`, error);
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
   * プロセスのCPU使用率を取得
   * @param {number} pid - プロセスID
   * @returns {Promise<number>} CPU使用率（%）
   */
  async getProcessCpuUsage(pid) {
    try {
      // 現在のプロセスの場合
      if (pid === process.pid) {
        return await this.getNodeProcessCpuUsage();
      }

      // 外部プロセスの場合
      const platform = os.platform();
      
      if (platform === 'darwin' || platform === 'linux') {
        // macOS/Linux: psコマンドを使用
        const { stdout } = await execAsync(`ps -p ${pid} -o %cpu`);
        const lines = stdout.trim().split('\n');
        if (lines.length >= 2) {
          const cpuUsage = parseFloat(lines[1].trim());
          return isNaN(cpuUsage) ? 0 : cpuUsage;
        }
      } else if (platform === 'win32') {
        // Windows: wmicコマンドを使用
        try {
          const { stdout } = await execAsync(
            `wmic process where ProcessId=${pid} get PercentProcessorTime /format:value`
          );
          const match = stdout.match(/PercentProcessorTime=(\d+)/);
          if (match) {
            // Windowsの値は100倍されているので調整
            return parseInt(match[1]) / 100;
          }
        } catch (e) {
          // PowerShellを試す
          const { stdout } = await execAsync(
            `powershell "Get-Process -Id ${pid} | Select-Object -ExpandProperty CPU"`
          );
          const cpuTime = parseFloat(stdout.trim());
          // CPU時間から使用率を推定（簡易的）
          return Math.min(cpuTime / 10, 100);
        }
      }
      
      return 0;
    } catch (error) {
      // プロセスが存在しない場合など
      return 0;
    }
  }

  /**
   * Node.jsプロセスのCPU使用率を取得
   * @returns {Promise<number>} CPU使用率（%）
   */
  async getNodeProcessCpuUsage() {
    const pid = process.pid;
    const now = Date.now();
    
    // 初回測定の場合
    if (!this.lastCpuMeasurement[pid]) {
      const cpuUsage = process.cpuUsage();
      this.lastCpuMeasurement[pid] = {
        time: now,
        usage: cpuUsage
      };
      // 初回は0を返す（比較対象がないため）
      return 0;
    }
    
    // 2回目以降の測定
    const previousMeasurement = this.lastCpuMeasurement[pid];
    const currentCpuUsage = process.cpuUsage(previousMeasurement.usage);
    const elapsedTime = now - previousMeasurement.time;
    
    // CPU使用率を計算（マイクロ秒をミリ秒に変換）
    const totalCpuTime = (currentCpuUsage.user + currentCpuUsage.system) / 1000;
    const cpuPercent = (totalCpuTime / elapsedTime) * 100;
    
    // 測定値を更新
    this.lastCpuMeasurement[pid] = {
      time: now,
      usage: process.cpuUsage()
    };
    
    // CPUコア数で正規化（マルチコアの場合100%を超える可能性があるため）
    const numCpus = os.cpus().length;
    return Math.min(Math.round(cpuPercent * 10) / 10, numCpus * 100);
  }

  /**
   * プロセスの統計情報を取得（getProcessStatsメソッドの実装）
   * @param {string} processId - プロセスID
   * @returns {Promise<Object>} プロセス統計情報
   */
  async getProcessStats(processId) {
    const process = this.getProcess(processId);
    if (!process) {
      return null;
    }

    // 最新のCPU使用率を取得
    const cpuUsage = process.pid ? await this.getProcessCpuUsage(process.pid) : 0;
    
    return {
      ...process,
      metrics: {
        ...process.metrics,
        cpuUsage
      }
    };
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