const { spawn } = require('child_process');

/**
 * Claude CLIプロセスの管理
 */
class ProcessManager {
  constructor(config, rateLimiter) {
    this.config = config;
    this.rateLimiter = rateLimiter;
    this.runningProcesses = new Map();
  }

  /**
   * 実行中のプロセス数
   */
  getRunningCount() {
    return this.runningProcesses.size;
  }

  /**
   * 実行可能かチェック
   */
  canExecute() {
    return !this.rateLimiter.isRateLimited() && 
           this.getRunningCount() < this.config.maxConcurrent;
  }

  /**
   * Claudeを実行
   */
  async execute(taskId, instruction) {
    if (!this.canExecute()) {
      throw new Error('Cannot execute: rate limited or max concurrent reached');
    }

    return new Promise((resolve, reject) => {
      const args = [
        '--dangerously-skip-permissions',
        '--print',
        JSON.stringify(instruction)
      ];

      console.log(`[${taskId}] Claude実行開始`);
      const process = spawn('claude', args);
      
      this.runningProcesses.set(taskId, process);
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('error', (error) => {
        this.runningProcesses.delete(taskId);
        console.error(`[${taskId}] プロセスエラー:`, error.message);
        reject(error);
      });
      
      process.on('exit', (code) => {
        this.runningProcesses.delete(taskId);
        console.log(`[${taskId}] Claude実行完了 (code: ${code})`);
        
        if (code === 0) {
          resolve({
            success: true,
            output: stdout
          });
        } else {
          // エラー出力をチェックしてレート制限を検出
          const errorMessage = stderr || stdout;
          this.rateLimiter.parseRateLimit(errorMessage);
          
          reject(new Error(`Process exited with code ${code}: ${errorMessage}`));
        }
      });
      
      // タイムアウト設定
      setTimeout(() => {
        if (this.runningProcesses.has(taskId)) {
          console.log(`[${taskId}] タイムアウト`);
          process.kill('SIGTERM');
          this.runningProcesses.delete(taskId);
          reject(new Error('Process timeout'));
        }
      }, this.config.timeout);
    });
  }

  /**
   * すべてのプロセスを強制終了
   */
  killAll() {
    for (const [taskId, process] of this.runningProcesses) {
      console.log(`[${taskId}] プロセス強制終了`);
      process.kill('SIGTERM');
    }
    this.runningProcesses.clear();
  }
}

module.exports = ProcessManager;