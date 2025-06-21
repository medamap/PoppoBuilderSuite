const { spawn } = require('child_process');
const ProcessStateManager = require('./process-state-manager');
const TimeoutController = require('./timeout-controller');
const i18n = require('../lib/i18n');

/**
 * Claude CLIプロセスの管理
 */
class ProcessManager {
  constructor(config, rateLimiter, logger) {
    this.config = config;
    this.rateLimiter = rateLimiter;
    this.logger = logger;
    this.runningProcesses = new Map();
    this.stateManager = new ProcessStateManager(logger);
    this.timeoutController = new TimeoutController(config.dynamicTimeout || {}, logger);
    this.processStartTimes = new Map();
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
  async canExecute() {
    const rateLimitStatus = await this.rateLimiter.isRateLimited();
    return !rateLimitStatus.limited && 
           this.getRunningCount() < this.config.maxConcurrent;
  }

  /**
   * Claudeを実行
   */
  async execute(taskId, instruction) {
    if (!await this.canExecute()) {
      throw new Error(i18n.t('errors.process.cannotExecute'));
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

      // 動的タイムアウトの計算
      let timeout = this.config.timeout; // デフォルト値
      let timeoutInfo = null;
      
      if (this.config.dynamicTimeout?.enabled && instruction.issue) {
        timeoutInfo = this.timeoutController.calculateTimeout(instruction.issue);
        timeout = timeoutInfo.timeout;
        console.log(`[${taskId}] 動的タイムアウト: ${Math.round(timeout / 60000)}分`);
        console.log(`[${taskId}] 理由: ${timeoutInfo.reasoning}`);
      }
      
      console.log(`[${taskId}] Claude実行開始`);
      console.log(`[${taskId}] プロセス識別: PoppoBuilder-Claude-${taskId}`);
      
      // プロセス開始を記録
      const issueNumber = instruction.issue?.number || 0;
      this.stateManager.recordProcessStart(taskId, issueNumber, 'claude-cli');
      this.processStartTimes.set(taskId, Date.now());
      
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
        
        // プロセス出力を更新
        this.stateManager.updateProcessOutput(taskId, stdout);
        
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
        
        // プロセスエラーを記録
        this.stateManager.recordProcessEnd(taskId, 'error', -1);
        
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
        
        // 実行時間の計算
        const startTime = this.processStartTimes.get(taskId);
        const executionTime = startTime ? Date.now() - startTime : 0;
        this.processStartTimes.delete(taskId);
        
        // プロセス終了を記録
        const status = code === 0 ? 'completed' : 'error';
        this.stateManager.recordProcessEnd(taskId, status, code);
        
        // 実行履歴を記録（動的タイムアウトが有効な場合）
        if (this.config.dynamicTimeout?.enabled && instruction.issue) {
          this.timeoutController.recordExecution(taskId, instruction.issue, executionTime, status);
        }
        
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
          
          // 実行時間の計算
          const startTime = this.processStartTimes.get(taskId);
          const executionTime = startTime ? Date.now() - startTime : 0;
          this.processStartTimes.delete(taskId);
          
          // タイムアウトを記録
          this.stateManager.recordProcessEnd(taskId, 'timeout', -2);
          
          // 実行履歴を記録（動的タイムアウトが有効な場合）
          if (this.config.dynamicTimeout?.enabled && instruction.issue) {
            this.timeoutController.recordExecution(taskId, instruction.issue, executionTime, 'timeout');
          }
          
          reject(new Error('Process timeout'));
        }
      }, timeout);
    });
  }

  /**
   * すべてのプロセスを強制終了
   */
  killAll() {
    for (const [taskId, process] of this.runningProcesses) {
      console.log(`[${taskId}] プロセス強制終了`);
      process.kill('SIGTERM');
      
      // 強制終了を記録
      this.stateManager.recordProcessEnd(taskId, 'killed', -3);
    }
    this.runningProcesses.clear();
  }
  
  /**
   * プロセス状態マネージャーを取得
   */
  getStateManager() {
    return this.stateManager;
  }
  
  /**
   * タイムアウトコントローラーを取得
   */
  getTimeoutController() {
    return this.timeoutController;
  }
}

module.exports = ProcessManager;