/**
 * Claude CLI実行エンジン
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 * Claude CLIコマンドの実行とエラーハンドリングを担当
 */

const { spawn } = require('child_process');
const Logger = require('../../src/logger');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class ClaudeExecutor {
  constructor(options = {}) {
    this.logger = new Logger('ClaudeExecutor');
    this.config = {
      maxRetries: options.maxRetries || 3,
      retryDelay: options.retryDelay || 5000,
      timeout: options.timeout || 120000, // 2分
      tempDir: options.tempDir || '/tmp/ccsp-claude',
      ...options
    };
    
    // セッション状態の追跡
    this.sessionTimeout = false;
    this.lastLoginCheck = null;
    
    // 統計情報
    this.stats = {
      totalExecutions: 0,
      successCount: 0,
      errorCount: 0,
      sessionTimeouts: 0,
      rateLimits: 0
    };
    
    this.ensureTempDir();
    
    this.logger.info('Claude Executor initialized', {
      maxRetries: this.config.maxRetries,
      timeout: this.config.timeout
    });
  }
  
  /**
   * 一時ディレクトリの確保
   */
  async ensureTempDir() {
    try {
      await fs.mkdir(this.config.tempDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create temp directory', error);
    }
  }
  
  /**
   * Claude CLIコマンドの実行
   * @param {Object} task - 実行タスク
   */
  async execute(task) {
    const {
      prompt,
      files = [],
      timeout = this.config.timeout,
      includeContext = false,
      agent = 'unknown'
    } = task;
    
    this.stats.totalExecutions++;
    const startTime = Date.now();
    const executionId = crypto.randomUUID();
    
    this.logger.info('Starting Claude execution', {
      executionId,
      agent,
      promptLength: prompt.length,
      filesCount: files.length,
      timeout
    });
    
    let attempt = 0;
    let lastError = null;
    
    while (attempt < this.config.maxRetries) {
      attempt++;
      
      try {
        // セッションタイムアウトフラグのチェック
        if (this.sessionTimeout) {
          throw new Error('Session timeout detected, login required');
        }
        
        const result = await this.executeClaudeCommand(prompt, files, timeout, executionId);
        
        this.stats.successCount++;
        const responseTime = Date.now() - startTime;
        
        this.logger.info('Claude execution successful', {
          executionId,
          attempt,
          responseTime: `${responseTime}ms`,
          outputLength: result.length
        });
        
        return {
          success: true,
          result,
          responseTime,
          executionId,
          attempts: attempt
        };
        
      } catch (error) {
        lastError = error;
        const responseTime = Date.now() - startTime;
        
        this.logger.warn('Claude execution failed', {
          executionId,
          attempt,
          error: error.message,
          responseTime: `${responseTime}ms`
        });
        
        // エラーパターンの分析
        const errorType = this.analyzeError(error.message);
        
        if (errorType === 'SESSION_TIMEOUT') {
          this.sessionTimeout = true;
          this.stats.sessionTimeouts++;
          throw error; // セッションタイムアウトは即座に失敗
        }
        
        if (errorType === 'RATE_LIMIT') {
          this.stats.rateLimits++;
          // レート制限の場合、より長い遅延
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          this.logger.warn(`Rate limit detected, waiting ${delay}ms before retry`, {
            executionId,
            attempt
          });
          await this.sleep(delay);
        } else if (attempt < this.config.maxRetries) {
          // 通常のリトライ遅延
          await this.sleep(this.config.retryDelay);
        }
      }
    }
    
    // すべてのリトライが失敗
    this.stats.errorCount++;
    const responseTime = Date.now() - startTime;
    
    this.logger.error('Claude execution failed after all retries', {
      executionId,
      attempts: attempt,
      responseTime: `${responseTime}ms`,
      finalError: lastError.message
    });
    
    throw lastError;
  }
  
  /**
   * 実際のClaude CLIコマンド実行
   */
  async executeClaudeCommand(prompt, files, timeout, executionId) {
    return new Promise(async (resolve, reject) => {
      let tempFiles = [];
      
      try {
        // ファイルが指定されている場合、一時ファイルとして保存
        if (files && files.length > 0) {
          tempFiles = await this.createTempFiles(files, executionId);
        }
        
        // Claude CLIコマンドの構築
        const args = this.buildClaudeArgs(prompt, tempFiles);
        
        this.logger.debug('Executing claude command', {
          executionId,
          args: args.slice(0, 3), // 最初の3つの引数のみログ出力
          tempFilesCount: tempFiles.length
        });
        
        // Claude CLIプロセスの起動
        const claude = spawn('claude', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAUDE_LOG_LEVEL: 'ERROR' // 不要なログを抑制
          }
        });
        
        let stdout = '';
        let stderr = '';
        let isResolved = false;
        
        // タイムアウト設定
        const timeoutId = setTimeout(() => {
          if (!isResolved) {
            claude.kill('SIGTERM');
            reject(new Error(`Claude execution timed out after ${timeout}ms`));
            isResolved = true;
          }
        }, timeout);
        
        // 標準出力の収集
        claude.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        // 標準エラーの収集
        claude.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        // プロセス終了の処理
        claude.on('close', async (code) => {
          clearTimeout(timeoutId);
          
          // 一時ファイルのクリーンアップ
          await this.cleanupTempFiles(tempFiles);
          
          if (isResolved) return;
          isResolved = true;
          
          if (code === 0) {
            // 成功
            const cleanOutput = this.cleanClaudeOutput(stdout);
            resolve(cleanOutput);
          } else {
            // エラー
            const errorMessage = stderr || stdout || `Claude process exited with code ${code}`;
            reject(new Error(errorMessage));
          }
        });
        
        claude.on('error', async (error) => {
          clearTimeout(timeoutId);
          await this.cleanupTempFiles(tempFiles);
          
          if (isResolved) return;
          isResolved = true;
          
          reject(new Error(`Failed to start claude process: ${error.message}`));
        });
        
      } catch (error) {
        await this.cleanupTempFiles(tempFiles);
        reject(error);
      }
    });
  }
  
  /**
   * Claude CLIの引数を構築
   */
  buildClaudeArgs(prompt, tempFiles) {
    const args = [];
    
    // ファイルが指定されている場合
    if (tempFiles.length > 0) {
      for (const file of tempFiles) {
        args.push(file);
      }
    }
    
    // プロンプトの追加
    // 注: Claude API呼び出し禁止の注記を自動追加
    const enhancedPrompt = this.enhancePrompt(prompt);
    args.push(enhancedPrompt);
    
    return args;
  }
  
  /**
   * プロンプトの強化（API呼び出し禁止の注記追加）
   */
  enhancePrompt(prompt) {
    const apiWarning = `
注意: このタスクではClaude APIを直接呼び出さないでください。
すべてのClaude API呼び出しはCCSPエージェント経由で行われます。

`;
    
    return apiWarning + prompt;
  }
  
  /**
   * 一時ファイルの作成
   */
  async createTempFiles(files, executionId) {
    const tempFiles = [];
    
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const tempFileName = `${executionId}_file_${i}_${path.basename(file.name || `file${i}`)}`;
      const tempFilePath = path.join(this.config.tempDir, tempFileName);
      
      try {
        await fs.writeFile(tempFilePath, file.content || file.data || '');
        tempFiles.push(tempFilePath);
        
        this.logger.debug('Temp file created', {
          original: file.name,
          temp: tempFilePath,
          size: (file.content || file.data || '').length
        });
        
      } catch (error) {
        this.logger.error('Failed to create temp file', {
          file: file.name,
          error: error.message
        });
        
        // 部分的に作成されたファイルをクリーンアップ
        await this.cleanupTempFiles(tempFiles);
        throw error;
      }
    }
    
    return tempFiles;
  }
  
  /**
   * 一時ファイルのクリーンアップ
   */
  async cleanupTempFiles(tempFiles) {
    for (const file of tempFiles) {
      try {
        await fs.unlink(file);
        this.logger.debug('Temp file cleaned up', { file });
      } catch (error) {
        this.logger.warn('Failed to cleanup temp file', {
          file,
          error: error.message
        });
      }
    }
  }
  
  /**
   * Claude出力のクリーニング
   */
  cleanClaudeOutput(output) {
    // 不要な制御文字やプロンプト文字を除去
    return output
      .replace(/\x1b\[[0-9;]*m/g, '') // ANSI escape codes
      .replace(/^[\s\S]*?claude>\s*/m, '') // claude> prompt
      .trim();
  }
  
  /**
   * エラーの分析
   */
  analyzeError(errorMessage) {
    const message = errorMessage.toLowerCase();
    
    // セッションタイムアウト
    if (message.includes('invalid api key') ||
        message.includes('please run /login') ||
        message.includes('api login failure') ||
        message.includes('authentication failed')) {
      return 'SESSION_TIMEOUT';
    }
    
    // レート制限
    if (message.includes('rate limit') ||
        message.includes('usage limit') ||
        message.includes('too many requests')) {
      return 'RATE_LIMIT';
    }
    
    // ネットワークエラー
    if (message.includes('network') ||
        message.includes('connection') ||
        message.includes('timeout')) {
      return 'NETWORK_ERROR';
    }
    
    // 入力エラー
    if (message.includes('invalid input') ||
        message.includes('file not found') ||
        message.includes('permission denied')) {
      return 'INPUT_ERROR';
    }
    
    return 'UNKNOWN_ERROR';
  }
  
  /**
   * セッション状態のリセット
   */
  resetSession() {
    this.sessionTimeout = false;
    this.lastLoginCheck = Date.now();
    this.logger.info('Session state reset');
  }
  
  /**
   * 統計情報の取得
   */
  getStats() {
    const total = this.stats.totalExecutions;
    
    return {
      ...this.stats,
      successRate: total > 0 ? (this.stats.successCount / total) : 0,
      errorRate: total > 0 ? (this.stats.errorCount / total) : 0,
      sessionTimeoutRate: total > 0 ? (this.stats.sessionTimeouts / total) : 0,
      rateLimitRate: total > 0 ? (this.stats.rateLimits / total) : 0
    };
  }
  
  /**
   * 統計情報のリセット
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      successCount: 0,
      errorCount: 0,
      sessionTimeouts: 0,
      rateLimits: 0
    };
    
    this.logger.info('Statistics reset');
  }
  
  /**
   * スリープユーティリティ
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * クリーンアップ
   */
  async shutdown() {
    this.logger.info('Claude Executor shutting down', this.getStats());
    
    // 一時ディレクトリのクリーンアップ
    try {
      const files = await fs.readdir(this.config.tempDir);
      for (const file of files) {
        const filePath = path.join(this.config.tempDir, file);
        await fs.unlink(filePath);
      }
      
      await fs.rmdir(this.config.tempDir);
      this.logger.info('Temp directory cleaned up');
      
    } catch (error) {
      this.logger.warn('Failed to cleanup temp directory', error);
    }
  }
}

module.exports = ClaudeExecutor;