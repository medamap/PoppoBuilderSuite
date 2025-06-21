const fs = require('fs').promises;
const path = require('path');
const Logger = require('../logger');

/**
 * アプリケーションモニター
 * エージェントとプロセスの健全性を監視
 */
class ApplicationMonitor {
  constructor(processManager) {
    this.processManager = processManager;
    this.logger = new Logger('ApplicationMonitor');
    
    // しきい値の設定
    this.thresholds = {
      heartbeatTimeout: 60000, // 1分
      taskQueueWarning: 50,    // タスクキューの警告しきい値
      taskQueueCritical: 100,  // タスクキューの危険しきい値
      memoryWarning: 500,      // メモリ使用量警告（MB）
      memoryCritical: 1000     // メモリ使用量危険（MB）
    };
  }
  
  /**
   * アプリケーション層のヘルスチェック
   */
  async check() {
    const startTime = Date.now();
    
    try {
      const details = {
        agents: {},
        processes: {},
        taskQueue: {},
        unresponsiveAgents: [],
        issues: []
      };
      
      // エージェントの状態チェック
      await this.checkAgents(details);
      
      // プロセスの状態チェック
      await this.checkProcesses(details);
      
      // タスクキューの状態チェック
      await this.checkTaskQueue(details);
      
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
      this.logger.error('アプリケーションチェックエラー:', error);
      return {
        status: 'error',
        score: 0,
        error: error.message,
        checkDuration: Date.now() - startTime
      };
    }
  }
  
  /**
   * エージェントの状態チェック
   */
  async checkAgents(details) {
    const agentNames = ['ccla', 'ccag', 'ccpm', 'ccta'];
    const heartbeatDir = path.join(__dirname, '../../.heartbeat');
    
    for (const agent of agentNames) {
      try {
        const heartbeatFile = path.join(heartbeatDir, `${agent}.json`);
        
        // ハートビートファイルの存在確認
        try {
          const stat = await fs.stat(heartbeatFile);
          const content = await fs.readFile(heartbeatFile, 'utf8');
          const heartbeat = JSON.parse(content);
          
          const lastUpdate = new Date(heartbeat.timestamp);
          const timeSinceUpdate = Date.now() - lastUpdate.getTime();
          
          // エージェントの状態判定
          if (timeSinceUpdate > this.thresholds.heartbeatTimeout) {
            details.agents[agent] = {
              status: 'unresponsive',
              lastHeartbeat: heartbeat.timestamp,
              timeSinceUpdate
            };
            details.unresponsiveAgents.push(agent);
            details.issues.push(`エージェント${agent}が応答していません`);
          } else {
            details.agents[agent] = {
              status: 'running',
              lastHeartbeat: heartbeat.timestamp,
              pid: heartbeat.pid,
              memory: heartbeat.memory,
              cpu: heartbeat.cpu
            };
          }
          
        } catch (error) {
          // ハートビートファイルが存在しない
          details.agents[agent] = {
            status: 'stopped',
            error: 'ハートビートファイルが見つかりません'
          };
          details.issues.push(`エージェント${agent}が停止しています`);
        }
        
      } catch (error) {
        this.logger.error(`エージェント${agent}のチェックエラー:`, error);
        details.agents[agent] = {
          status: 'error',
          error: error.message
        };
      }
    }
  }
  
  /**
   * プロセスの状態チェック
   */
  async checkProcesses(details) {
    if (!this.processManager) {
      details.processes = { error: 'ProcessManagerが利用できません' };
      return;
    }
    
    try {
      // 実行中のプロセスを取得
      const runningProcesses = await this.processManager.getRunningProcesses();
      const allProcesses = await this.processManager.getAllProcesses();
      
      details.processes = {
        total: allProcesses.length,
        running: runningProcesses.length,
        stopped: allProcesses.length - runningProcesses.length,
        list: {}
      };
      
      // 各プロセスの詳細情報
      for (const process of allProcesses) {
        const memoryMB = process.memoryUsage ? process.memoryUsage / 1024 / 1024 : 0;
        
        details.processes.list[process.taskId] = {
          status: process.status,
          type: process.taskType,
          startTime: process.startTime,
          memory: Math.round(memoryMB * 100) / 100,
          pid: process.pid
        };
        
        // メモリ使用量チェック
        if (memoryMB > this.thresholds.memoryCritical) {
          details.issues.push(`プロセス${process.taskId}のメモリ使用量が危険レベルです（${Math.round(memoryMB)}MB）`);
        } else if (memoryMB > this.thresholds.memoryWarning) {
          details.issues.push(`プロセス${process.taskId}のメモリ使用量が高くなっています（${Math.round(memoryMB)}MB）`);
        }
      }
      
      // 長時間実行プロセスのチェック
      const longRunningThreshold = 3600000; // 1時間
      for (const process of runningProcesses) {
        const runtime = Date.now() - new Date(process.startTime).getTime();
        if (runtime > longRunningThreshold) {
          const hours = Math.floor(runtime / 3600000);
          details.issues.push(`プロセス${process.taskId}が${hours}時間以上実行されています`);
        }
      }
      
    } catch (error) {
      this.logger.error('プロセスチェックエラー:', error);
      details.processes = { error: error.message };
    }
  }
  
  /**
   * タスクキューの状態チェック
   */
  async checkTaskQueue(details) {
    try {
      const taskQueueFile = path.join(__dirname, '../../logs/task-queue.json');
      
      try {
        const content = await fs.readFile(taskQueueFile, 'utf8');
        const queue = JSON.parse(content);
        
        details.taskQueue = {
          size: queue.length,
          oldest: queue.length > 0 ? queue[0].createdAt : null,
          types: {}
        };
        
        // タスクタイプ別の集計
        for (const task of queue) {
          const type = task.type || 'unknown';
          details.taskQueue.types[type] = (details.taskQueue.types[type] || 0) + 1;
        }
        
        // キューサイズのチェック
        if (queue.length > this.thresholds.taskQueueCritical) {
          details.issues.push(`タスクキューが危険レベルです（${queue.length}タスク）`);
        } else if (queue.length > this.thresholds.taskQueueWarning) {
          details.issues.push(`タスクキューが増加しています（${queue.length}タスク）`);
        }
        
        // 古いタスクのチェック
        if (details.taskQueue.oldest) {
          const age = Date.now() - new Date(details.taskQueue.oldest).getTime();
          if (age > 3600000) { // 1時間以上
            const hours = Math.floor(age / 3600000);
            details.issues.push(`${hours}時間以上前のタスクがキューに残っています`);
          }
        }
        
      } catch (error) {
        // キューファイルが存在しない場合は空とみなす
        details.taskQueue = {
          size: 0,
          types: {}
        };
      }
      
    } catch (error) {
      this.logger.error('タスクキューチェックエラー:', error);
      details.taskQueue = { error: error.message };
    }
  }
  
  /**
   * アプリケーション層のスコア計算
   */
  calculateScore(details) {
    let score = 100;
    const penalties = {
      agentStopped: 15,
      agentUnresponsive: 10,
      agentError: 5,
      highMemoryUsage: 10,
      criticalMemoryUsage: 20,
      largeTaskQueue: 10,
      criticalTaskQueue: 20,
      oldTaskInQueue: 10,
      longRunningProcess: 5
    };
    
    // エージェントの状態によるペナルティ
    for (const [agent, info] of Object.entries(details.agents)) {
      if (info.status === 'stopped') {
        score -= penalties.agentStopped;
      } else if (info.status === 'unresponsive') {
        score -= penalties.agentUnresponsive;
      } else if (info.status === 'error') {
        score -= penalties.agentError;
      }
    }
    
    // メモリ使用量によるペナルティ
    if (details.processes.list) {
      for (const process of Object.values(details.processes.list)) {
        if (process.memory > this.thresholds.memoryCritical / 1024) {
          score -= penalties.criticalMemoryUsage;
        } else if (process.memory > this.thresholds.memoryWarning / 1024) {
          score -= penalties.highMemoryUsage;
        }
      }
    }
    
    // タスクキューサイズによるペナルティ
    if (details.taskQueue.size > this.thresholds.taskQueueCritical) {
      score -= penalties.criticalTaskQueue;
    } else if (details.taskQueue.size > this.thresholds.taskQueueWarning) {
      score -= penalties.largeTaskQueue;
    }
    
    // その他の問題によるペナルティ
    const issueTypes = details.issues.join(' ');
    if (issueTypes.includes('時間以上前のタスク')) {
      score -= penalties.oldTaskInQueue;
    }
    if (issueTypes.includes('時間以上実行')) {
      score -= penalties.longRunningProcess * 
        (issueTypes.match(/時間以上実行/g) || []).length;
    }
    
    // スコアを0-100の範囲に制限
    return Math.max(0, Math.min(100, score));
  }
}

module.exports = ApplicationMonitor;