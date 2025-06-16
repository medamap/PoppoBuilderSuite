const { spawn } = require('child_process');

/**
 * Claude CLIプロセスの管理
 */
class ProcessManager {
  constructor(config, rateLimiter, logger) {
    this.config = config;
    this.rateLimiter = rateLimiter;
    this.logger = logger;
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
      // 指示ファイルを作成
      const fs = require('fs');
      const path = require('path');
      const tempDir = path.join(__dirname, '../temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      const instructionFile = path.join(tempDir, `instruction-${taskId}.txt`);
      let instructionContent = `${instruction.context.systemPrompt}\n\n`;
      
      // コンテキスト付き実行の場合（コメント対応）
      if (instruction.task === 'execute_with_context' && instruction.issue.conversation) {
        instructionContent += `現在のタスク: Issue #${instruction.issue.number}\n\n`;
        instructionContent += `これは以前のやり取りの続きです。以下が会話履歴です：\n\n`;
        
        for (const message of instruction.issue.conversation) {
          if (message.role === 'user') {
            instructionContent += `[ユーザー]\n${message.content}\n\n`;
          } else if (message.role === 'assistant') {
            instructionContent += `[あなたの以前の回答]\n${message.content}\n\n`;
          }
        }
        
        instructionContent += `上記の会話履歴を踏まえて、最新のユーザーコメントに対して適切に応答してください。\n`;
        instructionContent += `作業ディレクトリは ${instruction.context.workingDirectory} です。`;
      } else {
        // 通常のIssue実行
        instructionContent += `タイトル: ${instruction.issue.title}\n`;
        instructionContent += `内容: ${instruction.issue.body}\n\n`;
        instructionContent += `このIssueの内容を実行してください。作業ディレクトリは ${instruction.context.workingDirectory} です。`;
      }
      
      fs.writeFileSync(instructionFile, instructionContent, 'utf8');
      
      // シンプルなプロンプト
      const prompt = `${instructionFile} の指示に従ってください。`;

      const args = [
        '--dangerously-skip-permissions',
        '--print'
      ];

      console.log(`[${taskId}] Claude実行開始`);
      console.log(`[${taskId}] プロセス識別: PoppoBuilder-Claude-${taskId}`);
      
      if (this.logger) {
        this.logger.logProcess(taskId, 'START', { 
          command: 'claude',
          args: args,
          prompt: prompt,
          instruction: instruction 
        });
      }
      
      const process = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      // プロンプトをstdinに書き込む
      process.stdin.write(prompt);
      process.stdin.end();
      
      this.runningProcesses.set(taskId, process);
      
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (this.logger) {
          this.logger.logProcess(taskId, 'STDOUT', { chunk });
        }
      });
      
      process.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (this.logger) {
          this.logger.logProcess(taskId, 'STDERR', { chunk });
        }
      });
      
      process.on('error', (error) => {
        this.runningProcesses.delete(taskId);
        console.error(`[${taskId}] プロセスエラー:`, error.message);
        if (this.logger) {
          this.logger.logProcess(taskId, 'ERROR', { 
            error: error.message,
            stack: error.stack 
          });
        }
        reject(error);
      });
      
      process.on('exit', (code) => {
        this.runningProcesses.delete(taskId);
        console.log(`[${taskId}] Claude実行完了 (code: ${code})`);
        
        // 指示ファイルを削除
        try {
          fs.unlinkSync(instructionFile);
        } catch (e) {
          // エラーは無視
        }
        
        if (code === 0) {
          resolve({
            success: true,
            output: stdout
          });
        } else {
          // エラー出力をチェックしてレート制限を検出
          const errorMessage = stderr || stdout;
          this.rateLimiter.parseRateLimit(errorMessage);
          
          const error = new Error(`Process exited with code ${code}: ${errorMessage}`);
          error.stdout = stdout;
          error.stderr = stderr;
          
          if (this.logger) {
            this.logger.logProcess(taskId, 'FAILED', { 
              code,
              stdout,
              stderr,
              errorMessage 
            });
          }
          
          reject(error);
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