/**
 * Process Monitor
 * プロセスの状態を詳細に監視
 */

const { EventEmitter } = require('events');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const execAsync = promisify(exec);

class ProcessMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      updateInterval: options.updateInterval || 5000, // 5秒
      historySize: options.historySize || 1000,
      enableDetailedMetrics: options.enableDetailedMetrics !== false,
      metricsPath: options.metricsPath || path.join(os.homedir(), '.poppobuilder', 'metrics'),
      ...options
    };
    
    this.processes = new Map(); // pid -> process info
    this.history = new Map(); // pid -> metrics history
    this.isRunning = false;
    this.updateTimer = null;
    
    // パフォーマンスメトリクス
    this.metrics = {
      totalCpu: 0,
      totalMemory: 0,
      processCount: 0,
      lastUpdate: null
    };
  }

  /**
   * モニタリングを開始
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Process monitor is already running');
    }
    
    this.isRunning = true;
    
    // メトリクスディレクトリの作成
    await fs.mkdir(this.options.metricsPath, { recursive: true });
    
    // 初回更新
    await this.updateProcesses();
    
    // 定期的な更新
    this.updateTimer = setInterval(async () => {
      try {
        await this.updateProcesses();
      } catch (error) {
        console.error('Process update error:', error);
        this.emit('error', error);
      }
    }, this.options.updateInterval);
    
    this.emit('started');
  }

  /**
   * モニタリングを停止
   */
  stop() {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
    
    this.isRunning = false;
    this.emit('stopped');
  }

  /**
   * プロセスを追加
   */
  addProcess(pid, info = {}) {
    if (this.processes.has(pid)) {
      return;
    }
    
    const processInfo = {
      pid,
      name: info.name || 'unknown',
      type: info.type || 'worker',
      startTime: info.startTime || Date.now(),
      ...info
    };
    
    this.processes.set(pid, processInfo);
    this.history.set(pid, []);
    
    this.emit('process-added', processInfo);
  }

  /**
   * プロセスを削除
   */
  removeProcess(pid) {
    const processInfo = this.processes.get(pid);
    if (!processInfo) {
      return;
    }
    
    this.processes.delete(pid);
    this.history.delete(pid);
    
    this.emit('process-removed', processInfo);
  }

  /**
   * プロセス情報を更新
   */
  async updateProcesses() {
    const startTime = Date.now();
    const updates = [];
    
    // 各プロセスの情報を更新
    for (const [pid, info] of this.processes.entries()) {
      try {
        const metrics = await this.getProcessMetrics(pid);
        
        if (metrics) {
          // メトリクスを履歴に追加
          this.addToHistory(pid, metrics);
          
          // プロセス情報を更新
          const updatedInfo = {
            ...info,
            ...metrics,
            lastUpdate: Date.now()
          };
          
          this.processes.set(pid, updatedInfo);
          updates.push(updatedInfo);
          
          // 異常検知
          this.checkAnomalies(pid, metrics);
        } else {
          // プロセスが存在しない場合
          this.emit('process-dead', { pid, info });
          this.removeProcess(pid);
        }
        
      } catch (error) {
        console.error(`Error updating process ${pid}:`, error);
      }
    }
    
    // 全体メトリクスを更新
    this.updateOverallMetrics();
    
    // 更新完了イベント
    this.emit('update-completed', {
      duration: Date.now() - startTime,
      processCount: this.processes.size,
      updates
    });
  }

  /**
   * プロセスのメトリクスを取得
   */
  async getProcessMetrics(pid) {
    try {
      // プラットフォーム別の処理
      const platform = os.platform();
      
      if (platform === 'darwin' || platform === 'linux') {
        return await this.getUnixProcessMetrics(pid);
      } else if (platform === 'win32') {
        return await this.getWindowsProcessMetrics(pid);
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
      
    } catch (error) {
      // プロセスが存在しない場合はnullを返す
      if (error.code === 1 || error.message.includes('No such process')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Unix系OSでのプロセスメトリクス取得
   */
  async getUnixProcessMetrics(pid) {
    // ps コマンドでプロセス情報を取得
    const { stdout } = await execAsync(
      `ps -p ${pid} -o pid,ppid,%cpu,%mem,rss,vsz,etime,state,comm`
    );
    
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) {
      return null;
    }
    
    const values = lines[1].trim().split(/\s+/);
    
    return {
      pid: parseInt(values[0]),
      ppid: parseInt(values[1]),
      cpu: parseFloat(values[2]),
      memory: parseFloat(values[3]),
      rss: parseInt(values[4]) * 1024, // KB to bytes
      vsz: parseInt(values[5]) * 1024, // KB to bytes
      elapsed: values[6],
      state: values[7],
      command: values.slice(8).join(' ')
    };
  }

  /**
   * WindowsでのPプロセスメトリクス取得
   */
  async getWindowsProcessMetrics(pid) {
    const { stdout } = await execAsync(
      `wmic process where ProcessId=${pid} get ProcessId,ParentProcessId,WorkingSetSize,VirtualSize,KernelModeTime,UserModeTime,Name /format:csv`
    );
    
    const lines = stdout.trim().split('\n').filter(line => line);
    if (lines.length < 2) {
      return null;
    }
    
    const headers = lines[1].split(',');
    const values = lines[2].split(',');
    
    const data = {};
    headers.forEach((header, index) => {
      data[header] = values[index];
    });
    
    return {
      pid: parseInt(data.ProcessId),
      ppid: parseInt(data.ParentProcessId),
      cpu: 0, // Windows doesn't provide CPU% directly
      memory: 0, // Calculate from WorkingSetSize
      rss: parseInt(data.WorkingSetSize || 0),
      vsz: parseInt(data.VirtualSize || 0),
      elapsed: '00:00',
      state: 'R',
      command: data.Name
    };
  }

  /**
   * メトリクス履歴に追加
   */
  addToHistory(pid, metrics) {
    const history = this.history.get(pid) || [];
    
    history.push({
      timestamp: Date.now(),
      cpu: metrics.cpu,
      memory: metrics.memory,
      rss: metrics.rss
    });
    
    // 履歴サイズを制限
    if (history.length > this.options.historySize) {
      history.shift();
    }
    
    this.history.set(pid, history);
  }

  /**
   * 異常検知
   */
  checkAnomalies(pid, metrics) {
    const info = this.processes.get(pid);
    
    // CPU使用率が高い
    if (metrics.cpu > 90) {
      this.emit('high-cpu', {
        pid,
        info,
        cpu: metrics.cpu
      });
    }
    
    // メモリ使用率が高い
    if (metrics.memory > 80) {
      this.emit('high-memory', {
        pid,
        info,
        memory: metrics.memory,
        rss: metrics.rss
      });
    }
    
    // ゾンビプロセス
    if (metrics.state === 'Z') {
      this.emit('zombie-process', {
        pid,
        info
      });
    }
  }

  /**
   * 全体メトリクスを更新
   */
  updateOverallMetrics() {
    let totalCpu = 0;
    let totalMemory = 0;
    
    for (const info of this.processes.values()) {
      totalCpu += info.cpu || 0;
      totalMemory += info.memory || 0;
    }
    
    this.metrics = {
      totalCpu,
      totalMemory,
      processCount: this.processes.size,
      lastUpdate: Date.now()
    };
    
    this.emit('metrics-updated', this.metrics);
  }

  /**
   * プロセス情報を取得
   */
  getProcess(pid) {
    return this.processes.get(pid);
  }

  /**
   * すべてのプロセス情報を取得
   */
  getAllProcesses() {
    return Array.from(this.processes.values());
  }

  /**
   * プロセスの履歴を取得
   */
  getHistory(pid, limit = 100) {
    const history = this.history.get(pid) || [];
    return history.slice(-limit);
  }

  /**
   * プロセスの統計情報を取得
   */
  getProcessStats(pid) {
    const history = this.history.get(pid) || [];
    if (history.length === 0) {
      return null;
    }
    
    const cpuValues = history.map(h => h.cpu);
    const memoryValues = history.map(h => h.memory);
    const rssValues = history.map(h => h.rss);
    
    return {
      cpu: {
        current: cpuValues[cpuValues.length - 1],
        average: this.average(cpuValues),
        max: Math.max(...cpuValues),
        min: Math.min(...cpuValues)
      },
      memory: {
        current: memoryValues[memoryValues.length - 1],
        average: this.average(memoryValues),
        max: Math.max(...memoryValues),
        min: Math.min(...memoryValues)
      },
      rss: {
        current: rssValues[rssValues.length - 1],
        average: this.average(rssValues),
        max: Math.max(...rssValues),
        min: Math.min(...rssValues)
      }
    };
  }

  /**
   * メトリクスをエクスポート
   */
  async exportMetrics(format = 'json') {
    const data = {
      timestamp: new Date().toISOString(),
      overall: this.metrics,
      processes: Array.from(this.processes.entries()).map(([pid, info]) => ({
        ...info,
        stats: this.getProcessStats(pid)
      }))
    };
    
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
        
      case 'csv':
        return this.toCSV(data);
        
      default:
        throw new Error(`Unsupported format: ${format}`);
    }
  }

  /**
   * CSV形式に変換
   */
  toCSV(data) {
    const headers = ['timestamp', 'pid', 'name', 'type', 'cpu', 'memory', 'rss'];
    const rows = [headers.join(',')];
    
    for (const process of data.processes) {
      const row = [
        data.timestamp,
        process.pid,
        process.name,
        process.type,
        process.cpu || 0,
        process.memory || 0,
        process.rss || 0
      ];
      rows.push(row.join(','));
    }
    
    return rows.join('\n');
  }

  /**
   * 平均値を計算
   */
  average(values) {
    if (values.length === 0) return 0;
    return values.reduce((sum, val) => sum + val, 0) / values.length;
  }

  /**
   * メトリクスをファイルに保存
   */
  async saveMetrics() {
    const filename = `metrics-${new Date().toISOString().split('T')[0]}.json`;
    const filepath = path.join(this.options.metricsPath, filename);
    
    const data = await this.exportMetrics('json');
    await fs.writeFile(filepath, data);
    
    this.emit('metrics-saved', { filepath });
  }
}

module.exports = ProcessMonitor;