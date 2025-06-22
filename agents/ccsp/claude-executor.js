/**
 * Claude CLI Execution Engine
 * 
 * Issue #142: CCSP Advanced Control and Monitoring Implementation
 * Handles Claude CLI command execution and error handling
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
    
    // Session state tracking
    this.sessionTimeout = false;
    this.lastLoginCheck = null;
    
    // Statistics
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
   * Ensure temporary directory
   */
  async ensureTempDir() {
    try {
      await fs.mkdir(this.config.tempDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create temp directory', error);
    }
  }
  
  /**
   * Execute Claude CLI command
   * @param {Object} task - Execution task
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
        // Check session timeout flag
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
        
        // Analyze error patterns
        const errorType = this.analyzeError(error.message);
        
        if (errorType === 'SESSION_TIMEOUT') {
          this.sessionTimeout = true;
          this.stats.sessionTimeouts++;
          throw error; // セッションタイムアウトは即座に失敗
        }
        
        if (errorType === 'RATE_LIMIT') {
          this.stats.rateLimits++;
          // For rate limit, use longer delay
          const delay = this.config.retryDelay * Math.pow(2, attempt);
          this.logger.warn(`Rate limit detected, waiting ${delay}ms before retry`, {
            executionId,
            attempt
          });
          await this.sleep(delay);
        } else if (attempt < this.config.maxRetries) {
          // Normal retry delay
          await this.sleep(this.config.retryDelay);
        }
      }
    }
    
    // All retries failed
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
   * Actual Claude CLI command execution
   */
  async executeClaudeCommand(prompt, files, timeout, executionId) {
    return new Promise(async (resolve, reject) => {
      let tempFiles = [];
      
      try {
        // If files are specified, save as temporary files
        if (files && files.length > 0) {
          tempFiles = await this.createTempFiles(files, executionId);
        }
        
        // Build Claude CLI command
        const args = this.buildClaudeArgs(prompt, tempFiles);
        
        this.logger.debug('Executing claude command', {
          executionId,
          args: args.slice(0, 3), // Only log first 3 arguments
          tempFilesCount: tempFiles.length
        });
        
        // Start Claude CLI process
        const claude = spawn('claude', args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          cwd: process.cwd(),
          env: {
            ...process.env,
            CLAUDE_LOG_LEVEL: 'ERROR' // Suppress unnecessary logs
          }
        });
        
        let stdout = '';
        let stderr = '';
        let isResolved = false;
        
        // Timeout setting
        const timeoutId = setTimeout(() => {
          if (!isResolved) {
            claude.kill('SIGTERM');
            reject(new Error(`Claude execution timed out after ${timeout}ms`));
            isResolved = true;
          }
        }, timeout);
        
        // Collect standard output
        claude.stdout.on('data', (data) => {
          stdout += data.toString();
        });
        
        // Collect standard error
        claude.stderr.on('data', (data) => {
          stderr += data.toString();
        });
        
        // Process termination handling
        claude.on('close', async (code) => {
          clearTimeout(timeoutId);
          
          // Clean up temporary files
          await this.cleanupTempFiles(tempFiles);
          
          if (isResolved) return;
          isResolved = true;
          
          if (code === 0) {
            // Success
            const cleanOutput = this.cleanClaudeOutput(stdout);
            resolve(cleanOutput);
          } else {
            // Error
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
   * Build Claude CLI arguments
   */
  buildClaudeArgs(prompt, tempFiles) {
    const args = [];
    
    // If files are specified
    if (tempFiles.length > 0) {
      for (const file of tempFiles) {
        args.push(file);
      }
    }
    
    // Add prompt
    // Note: Automatically add note prohibiting Claude API calls
    const enhancedPrompt = this.enhancePrompt(prompt);
    args.push(enhancedPrompt);
    
    return args;
  }
  
  /**
   * Enhance prompt (add note prohibiting API calls)
   */
  enhancePrompt(prompt) {
    const apiWarning = `
Note: Do not call Claude API directly in this task.
All Claude API calls are made through the CCSP agent.

`;
    
    return apiWarning + prompt;
  }
  
  /**
   * Create temporary files
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
        
        // Clean up partially created files
        await this.cleanupTempFiles(tempFiles);
        throw error;
      }
    }
    
    return tempFiles;
  }
  
  /**
   * Clean up temporary files
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
   * Clean Claude output
   */
  cleanClaudeOutput(output) {
    // Remove unnecessary control characters and prompt characters
    return output
      .replace(/\x1b\[[0-9;]*m/g, '') // ANSI escape codes
      .replace(/^[\s\S]*?claude>\s*/m, '') // claude> prompt
      .trim();
  }
  
  /**
   * Analyze error
   */
  analyzeError(errorMessage) {
    const message = errorMessage.toLowerCase();
    
    // Session timeout
    if (message.includes('invalid api key') ||
        message.includes('please run /login') ||
        message.includes('api login failure') ||
        message.includes('authentication failed')) {
      return 'SESSION_TIMEOUT';
    }
    
    // Rate limit
    if (message.includes('rate limit') ||
        message.includes('usage limit') ||
        message.includes('too many requests')) {
      return 'RATE_LIMIT';
    }
    
    // Network error
    if (message.includes('network') ||
        message.includes('connection') ||
        message.includes('timeout')) {
      return 'NETWORK_ERROR';
    }
    
    // Input error
    if (message.includes('invalid input') ||
        message.includes('file not found') ||
        message.includes('permission denied')) {
      return 'INPUT_ERROR';
    }
    
    return 'UNKNOWN_ERROR';
  }
  
  /**
   * Reset session state
   */
  resetSession() {
    this.sessionTimeout = false;
    this.lastLoginCheck = Date.now();
    this.logger.info('Session state reset');
  }
  
  /**
   * Get statistics
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
   * Reset statistics
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
   * Sleep utility
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  /**
   * Cleanup
   */
  async shutdown() {
    this.logger.info('Claude Executor shutting down', this.getStats());
    
    // Clean up temporary directory
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