/**
 * Auto Recovery
 * 問題を検知した際の自動回復機能
 */

const { EventEmitter } = require('events');
const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const execAsync = promisify(exec);

class AutoRecovery extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      enableRecovery: options.enableRecovery !== false,
      maxRetries: options.maxRetries || 3,
      retryInterval: options.retryInterval || 60000, // 1分
      cooldownPeriod: options.cooldownPeriod || 300000, // 5分
      recoveryLog: options.recoveryLog || path.join(os.homedir(), '.poppobuilder', 'recovery.log'),
      ...options
    };
    
    // 回復アクションのレジストリ
    this.recoveryActions = new Map();
    this.recoveryHistory = new Map(); // issue -> recovery attempts
    this.cooldowns = new Map(); // issue -> cooldown end time
    
    this.registerDefaultActions();
  }

  /**
   * デフォルトの回復アクションを登録
   */
  registerDefaultActions() {
    // 高メモリ使用時の回復
    this.registerAction('high-memory', async (context) => {
      const actions = [];
      
      // 1. ガベージコレクションの強制実行
      if (global.gc) {
        global.gc();
        actions.push('Forced garbage collection');
      }
      
      // 2. キャッシュのクリア
      if (context.clearCache) {
        await context.clearCache();
        actions.push('Cleared cache');
      }
      
      // 3. 一時ファイルの削除
      await this.cleanupTempFiles();
      actions.push('Cleaned up temp files');
      
      return {
        success: true,
        actions,
        message: 'Memory recovery actions completed'
      };
    });
    
    // 高CPU使用時の回復
    this.registerAction('high-cpu', async (context) => {
      const actions = [];
      
      // 1. プロセスの優先度を下げる
      if (context.pid) {
        await this.adjustProcessPriority(context.pid, 10);
        actions.push(`Lowered priority for process ${context.pid}`);
      }
      
      // 2. タスクキューの調整
      if (context.pauseQueue) {
        await context.pauseQueue(5000); // 5秒間一時停止
        actions.push('Paused task queue temporarily');
      }
      
      return {
        success: true,
        actions,
        message: 'CPU recovery actions completed'
      };
    });
    
    // プロセス死亡時の回復
    this.registerAction('process-dead', async (context) => {
      const actions = [];
      
      // プロセスの再起動
      if (context.restartProcess) {
        const newPid = await context.restartProcess(context.pid);
        actions.push(`Restarted process (new PID: ${newPid})`);
        
        return {
          success: true,
          actions,
          message: 'Process restarted successfully',
          newPid
        };
      }
      
      return {
        success: false,
        actions,
        message: 'No restart handler available'
      };
    });
    
    // ディスク容量不足時の回復
    this.registerAction('disk-full', async (context) => {
      const actions = [];
      
      // 1. ログファイルのローテーション
      await this.rotateLogs();
      actions.push('Rotated log files');
      
      // 2. 古いアーカイブの削除
      const deletedSize = await this.cleanupOldArchives();
      actions.push(`Deleted ${this.formatBytes(deletedSize)} of old archives`);
      
      // 3. 一時ファイルのクリーンアップ
      await this.cleanupTempFiles();
      actions.push('Cleaned up temp files');
      
      return {
        success: true,
        actions,
        message: 'Disk space recovery completed',
        freedSpace: deletedSize
      };
    });
    
    // ゾンビプロセスの回復
    this.registerAction('zombie-process', async (context) => {
      const actions = [];
      
      // ゾンビプロセスのクリーンアップ
      if (context.pid) {
        try {
          await execAsync(`kill -9 ${context.pid}`);
          actions.push(`Killed zombie process ${context.pid}`);
        } catch (error) {
          // プロセスが既に存在しない場合もある
        }
      }
      
      return {
        success: true,
        actions,
        message: 'Zombie process cleaned up'
      };
    });
  }

  /**
   * 回復アクションを登録
   */
  registerAction(issue, actionFunction) {
    this.recoveryActions.set(issue, actionFunction);
    this.emit('action-registered', { issue });
  }

  /**
   * 回復を試行
   */
  async attemptRecovery(issue, context = {}) {
    if (!this.options.enableRecovery) {
      this.emit('recovery-disabled', { issue });
      return null;
    }
    
    // クールダウン中かチェック
    if (this.isInCooldown(issue)) {
      this.emit('recovery-cooldown', { 
        issue,
        remainingTime: this.cooldowns.get(issue) - Date.now()
      });
      return null;
    }
    
    // 回復履歴を取得
    const history = this.recoveryHistory.get(issue) || [];
    
    // 最大リトライ数をチェック
    if (history.length >= this.options.maxRetries) {
      this.emit('recovery-max-retries', { issue, attempts: history.length });
      this.setCooldown(issue);
      return null;
    }
    
    // 回復アクションを取得
    const action = this.recoveryActions.get(issue);
    if (!action) {
      this.emit('recovery-no-action', { issue });
      return null;
    }
    
    try {
      this.emit('recovery-started', { issue, attempt: history.length + 1 });
      
      // 回復アクションを実行
      const result = await action(context);
      
      // 履歴に記録
      const attempt = {
        timestamp: Date.now(),
        issue,
        success: result.success,
        result,
        context
      };
      
      history.push(attempt);
      this.recoveryHistory.set(issue, history);
      
      // ログに記録
      await this.logRecoveryAttempt(attempt);
      
      if (result.success) {
        this.emit('recovery-success', { issue, result });
        // 成功した場合は履歴をクリア
        this.recoveryHistory.delete(issue);
      } else {
        this.emit('recovery-failed', { issue, result });
      }
      
      return result;
      
    } catch (error) {
      const attempt = {
        timestamp: Date.now(),
        issue,
        success: false,
        error: error.message,
        context
      };
      
      history.push(attempt);
      this.recoveryHistory.set(issue, history);
      
      await this.logRecoveryAttempt(attempt);
      
      this.emit('recovery-error', { issue, error });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * クールダウン中かチェック
   */
  isInCooldown(issue) {
    const cooldownEnd = this.cooldowns.get(issue);
    if (!cooldownEnd) return false;
    
    if (Date.now() >= cooldownEnd) {
      this.cooldowns.delete(issue);
      return false;
    }
    
    return true;
  }

  /**
   * クールダウンを設定
   */
  setCooldown(issue) {
    const cooldownEnd = Date.now() + this.options.cooldownPeriod;
    this.cooldowns.set(issue, cooldownEnd);
    
    // クールダウン終了時に自動削除
    setTimeout(() => {
      this.cooldowns.delete(issue);
      this.emit('cooldown-ended', { issue });
    }, this.options.cooldownPeriod);
  }

  /**
   * プロセスの優先度を調整
   */
  async adjustProcessPriority(pid, nice = 10) {
    const platform = os.platform();
    
    if (platform === 'darwin' || platform === 'linux') {
      await execAsync(`renice -n ${nice} -p ${pid}`);
    } else if (platform === 'win32') {
      // Windowsでは異なるコマンドを使用
      const priority = nice > 0 ? 'BelowNormal' : 'Normal';
      await execAsync(`wmic process where ProcessId=${pid} CALL setpriority "${priority}"`);
    }
  }

  /**
   * 一時ファイルをクリーンアップ
   */
  async cleanupTempFiles() {
    const tempDirs = [
      path.join(os.tmpdir(), 'poppobuilder-*'),
      path.join(os.homedir(), '.poppobuilder', 'temp', '*')
    ];
    
    for (const pattern of tempDirs) {
      try {
        const { stdout } = await execAsync(`find ${path.dirname(pattern)} -name "${path.basename(pattern)}" -mtime +1 -delete`);
      } catch (error) {
        // エラーは無視
      }
    }
  }

  /**
   * ログファイルをローテーション
   */
  async rotateLogs() {
    const logDir = path.join(os.homedir(), '.poppobuilder', 'logs');
    
    try {
      const files = await fs.readdir(logDir);
      const logFiles = files.filter(f => f.endsWith('.log'));
      
      for (const file of logFiles) {
        const filepath = path.join(logDir, file);
        const stats = await fs.stat(filepath);
        
        // 100MB以上のファイルをローテーション
        if (stats.size > 100 * 1024 * 1024) {
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const rotatedPath = filepath.replace('.log', `.${timestamp}.log`);
          
          await fs.rename(filepath, rotatedPath);
          
          // gzip圧縮
          await execAsync(`gzip ${rotatedPath}`);
        }
      }
    } catch (error) {
      console.error('Log rotation error:', error);
    }
  }

  /**
   * 古いアーカイブを削除
   */
  async cleanupOldArchives() {
    const archiveDir = path.join(os.homedir(), '.poppobuilder', 'archives');
    let totalDeleted = 0;
    
    try {
      const files = await fs.readdir(archiveDir);
      const now = Date.now();
      
      for (const file of files) {
        const filepath = path.join(archiveDir, file);
        const stats = await fs.stat(filepath);
        
        // 30日以上前のファイルを削除
        if (now - stats.mtime.getTime() > 30 * 24 * 60 * 60 * 1000) {
          totalDeleted += stats.size;
          await fs.unlink(filepath);
        }
      }
    } catch (error) {
      // エラーは無視
    }
    
    return totalDeleted;
  }

  /**
   * 回復試行をログに記録
   */
  async logRecoveryAttempt(attempt) {
    const logEntry = {
      ...attempt,
      timestamp: new Date(attempt.timestamp).toISOString()
    };
    
    try {
      await fs.appendFile(
        this.options.recoveryLog,
        JSON.stringify(logEntry) + '\n'
      );
    } catch (error) {
      console.error('Failed to log recovery attempt:', error);
    }
  }

  /**
   * 回復履歴を取得
   */
  getRecoveryHistory(issue = null) {
    if (issue) {
      return this.recoveryHistory.get(issue) || [];
    }
    
    const allHistory = {};
    for (const [key, value] of this.recoveryHistory.entries()) {
      allHistory[key] = value;
    }
    return allHistory;
  }

  /**
   * 回復統計を取得
   */
  getRecoveryStats() {
    const stats = {
      totalAttempts: 0,
      successfulRecoveries: 0,
      failedRecoveries: 0,
      byIssue: {}
    };
    
    for (const [issue, history] of this.recoveryHistory.entries()) {
      const issueStats = {
        attempts: history.length,
        successes: history.filter(h => h.success).length,
        failures: history.filter(h => !h.success).length,
        lastAttempt: history[history.length - 1]?.timestamp
      };
      
      stats.byIssue[issue] = issueStats;
      stats.totalAttempts += issueStats.attempts;
      stats.successfulRecoveries += issueStats.successes;
      stats.failedRecoveries += issueStats.failures;
    }
    
    return stats;
  }

  /**
   * バイト数をフォーマット
   */
  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }
}

module.exports = AutoRecovery;