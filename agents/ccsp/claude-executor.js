/**
 * Claude Code実行管理モジュール
 * 
 * Claude CLIの呼び出しとレート制限処理を担当
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class ClaudeExecutor {
  constructor(logger) {
    this.logger = logger;
    this.maxConcurrent = 2;
    this.runningProcesses = new Map();
    this.tempDir = path.join(__dirname, '../../temp/ccsp');
    
    // 一時ディレクトリを作成
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
    
    // 定期的な一時ファイルクリーンアップ（1時間ごと）
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldTempFiles();
    }, 3600000);
  }
  
  async execute(request) {
    // 同時実行数チェック
    if (this.runningProcesses.size >= this.maxConcurrent) {
      throw new Error('Max concurrent executions reached');
    }
    
    const { requestId, prompt, systemPrompt, includeFiles, modelPreference } = request;
    const startTime = Date.now();
    
    try {
      // プロンプトファイルを作成（特殊文字対策）
      const promptFile = path.join(this.tempDir, `prompt-${requestId}.txt`);
      const fullPrompt = this.buildFullPrompt(request);
      fs.writeFileSync(promptFile, fullPrompt, 'utf8');
      
      // コマンドライン引数を構築
      const args = [
        '--dangerously-skip-permissions',
        '--print'
      ];
      
      // モデル指定
      if (modelPreference?.primary) {
        args.push('--model', modelPreference.primary);
        if (modelPreference.fallback) {
          args.push('--fallback-model', modelPreference.fallback);
        }
      }
      
      // プロンプトはファイルから読み込むよう指示
      const executePrompt = `Please read and execute the instructions in ${promptFile}`;
      
      this.logger.info(`[CCSP] Starting execution: ${requestId}`);
      
      // プロセスを開始
      const process = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      this.runningProcesses.set(requestId, process);
      
      // プロンプトを送信
      process.stdin.write(executePrompt);
      process.stdin.end();
      
      // 結果を収集
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      // プロセス完了を待つ
      const result = await new Promise((resolve, reject) => {
        process.on('error', (error) => {
          this.runningProcesses.delete(requestId);
          reject(error);
        });
        
        process.on('exit', async (code) => {
          this.runningProcesses.delete(requestId);
          
          // 一時ファイルを削除
          try {
            fs.unlinkSync(promptFile);
          } catch (e) {
            // エラーは無視
          }
          
          const outputTrimmed = stdout.trim();
          
          // セッションタイムアウトチェック
          if (outputTrimmed.includes('Invalid API key') || 
              outputTrimmed.includes('Please run /login') ||
              outputTrimmed.includes('API Login Failure')) {
            this.logger.error(`[CCSP] Session timeout detected: ${outputTrimmed}`);
            resolve({
              success: false,
              error: 'SESSION_TIMEOUT',
              sessionTimeout: true,
              message: outputTrimmed,
              requiresManualAction: true
            });
            return;
          }
          
          // レート制限チェック（バーチカルバー形式）
          if (outputTrimmed.includes('|')) {
            const parts = outputTrimmed.split('|');
            if (parts.length === 2 && !isNaN(parseInt(parts[1]))) {
              this.logger.info(`[CCSP] Rate limit detected: ${parts[0]}`);
              const retryResult = await this.handleRateLimit(outputTrimmed, request);
              resolve(retryResult);
              return;
            }
          }
          
          // Execute error% チェック
          if (outputTrimmed === 'Execute error%') {
            this.logger.info('[CCSP] Handling Execute error%');
            const retryResult = await this.handleExecuteError(request);
            resolve(retryResult);
            return;
          }
          
          if (code === 0) {
            resolve({
              success: true,
              result: stdout,
              executionTime: Date.now() - startTime
            });
          } else {
            resolve({
              success: false,
              error: stderr || stdout,
              code: code
            });
          }
        });
      });
      
      return result;
      
    } catch (error) {
      this.runningProcesses.delete(requestId);
      throw error;
    }
  }
  
  buildFullPrompt(request) {
    let prompt = '';
    
    // 重要な制限事項を最初に追加
    prompt += '【重要な制限事項】\n';
    prompt += '1. Claude APIの呼び出しは絶対に禁止です。\n';
    prompt += '2. anthropic、claude-ai、claude-sdk などのAPIライブラリの使用は禁止です。\n';
    prompt += '3. HTTPリクエストでClaude APIエンドポイントへのアクセスは禁止です。\n';
    prompt += '4. 子プロセスからのclaude CLIコマンドの実行も禁止です。\n';
    prompt += '5. この制限はPoppoBuilderSuiteシステム全体のポリシーです。\n\n';
    prompt += '上記の制限に違反するコードの生成、実行、提案は行わないでください。\n';
    prompt += 'Claude APIが必要な場合は、代わりにRedis Queue経由でCCSPエージェント（パイちゃん）にリクエストしてください。\n\n';
    prompt += '=== 以下、本来のリクエスト内容 ===\n\n';
    
    // システムプロンプト
    if (request.systemPrompt) {
      prompt += request.systemPrompt + '\n\n';
    }
    
    // インクルードファイル
    if (request.includeFiles && request.includeFiles.length > 0) {
      prompt += '=== Included Files ===\n';
      for (const file of request.includeFiles) {
        try {
          const content = fs.readFileSync(file, 'utf8');
          prompt += `\n--- ${file} ---\n${content}\n--- End of ${file} ---\n`;
        } catch (error) {
          prompt += `\n--- ${file} ---\n[Error reading file: ${error.message}]\n---\n`;
        }
      }
      prompt += '\n=== End of Included Files ===\n\n';
    }
    
    // メインプロンプト
    prompt += request.prompt;
    
    return prompt;
  }
  
  async handleRateLimit(output, request) {
    // バーチカルバーで分割
    const parts = output.trim().split('|');
    if (parts.length !== 2) {
      return {
        success: false,
        error: 'Invalid rate limit format'
      };
    }
    
    const message = parts[0];
    const epochStr = parts[1];
    
    // エポック秒を解析
    const unlockTime = parseInt(epochStr) * 1000; // ミリ秒に変換
    if (isNaN(unlockTime)) {
      return {
        success: false,
        error: 'Failed to parse unlock time'
      };
    }
    
    const now = Date.now();
    const waitTime = unlockTime - now + 60000; // 1分余裕を持たせる
    
    this.logger.info(`[CCSP] Rate limited: ${message}`);
    this.logger.info(`[CCSP] Waiting until ${new Date(unlockTime).toISOString()}`);
    this.logger.info(`[CCSP] Wait time: ${Math.round(waitTime / 1000)}s`);
    
    // レート制限情報を返す（呼び出し元で管理）
    return {
      success: false,
      rateLimitInfo: {
        message,
        unlockTime,
        waitTime
      }
    };
  }
  
  async continueExecution(request) {
    const args = [
      '--dangerously-skip-permissions',
      '--print',
      '--continue'
    ];
    
    return new Promise((resolve, reject) => {
      const process = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdin.write('please continue your job');
      process.stdin.end();
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('error', (error) => {
        reject(error);
      });
      
      process.on('exit', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            result: stdout
          });
        } else {
          resolve({
            success: false,
            error: stderr || stdout,
            code: code
          });
        }
      });
    });
  }
  
  async handleExecuteError(request) {
    const args = [
      '--dangerously-skip-permissions',
      '--print'
    ];
    
    return new Promise((resolve, reject) => {
      const process = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      process.stdin.write('処理が完了していれば結果を返してください');
      process.stdin.end();
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('error', (error) => {
        reject(error);
      });
      
      process.on('exit', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            result: stdout
          });
        } else {
          resolve({
            success: false,
            error: stderr || stdout,
            code: code
          });
        }
      });
    });
  }
  
  async cleanup() {
    // クリーンアップインターバルを停止
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    
    // 実行中のプロセスを停止
    for (const [requestId, process] of this.runningProcesses) {
      this.logger.info(`[CCSP] Terminating process: ${requestId}`);
      process.kill('SIGTERM');
    }
    this.runningProcesses.clear();
    
    // 最後に一時ファイルをクリーンアップ
    this.cleanupOldTempFiles();
  }
  
  /**
   * 古い一時ファイルをクリーンアップ
   */
  cleanupOldTempFiles() {
    try {
      const now = Date.now();
      const maxAge = 3600000; // 1時間
      
      const files = fs.readdirSync(this.tempDir);
      let cleanedCount = 0;
      
      for (const file of files) {
        if (file.startsWith('prompt-') && file.endsWith('.txt')) {
          const filePath = path.join(this.tempDir, file);
          const stats = fs.statSync(filePath);
          
          if (now - stats.mtimeMs > maxAge) {
            fs.unlinkSync(filePath);
            cleanedCount++;
          }
        }
      }
      
      if (cleanedCount > 0) {
        this.logger.info(`[CCSP] Cleaned up ${cleanedCount} old temp files`);
      }
    } catch (error) {
      this.logger.error(`[CCSP] Error cleaning up temp files: ${error.message}`);
    }
  }
}

module.exports = ClaudeExecutor;