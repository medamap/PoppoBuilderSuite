/**
 * Claude CLIのレート制限ハンドラー
 * レート制限エラー時の自動再開機能を提供
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class RateLimitHandler {
  constructor(tempDir = 'temp') {
    this.tempDir = tempDir;
  }

  /**
   * レート制限エラーからエポック秒を抽出
   */
  parseRateLimitError(errorMessage) {
    const match = errorMessage.match(/rate.*limit.*reached.*\|(\d+)/i);
    if (match) {
      return parseInt(match[1]) * 1000; // ミリ秒に変換
    }
    return null;
  }

  /**
   * レート制限解除まで待機して再開
   */
  async waitAndResume(taskId, resetTimeMs, outputFile, resultFile) {
    const now = Date.now();
    const waitTime = Math.max(0, resetTimeMs - now);
    
    if (waitTime > 0) {
      console.log(`[${taskId}] レート制限検出: ${new Date(resetTimeMs).toLocaleString()} まで待機`);
      console.log(`[${taskId}] 待機時間: ${Math.ceil(waitTime / 1000)}秒`);
      
      // 待機状態をファイルに記録
      const waitFile = path.join(this.tempDir, `task-${taskId}.waiting`);
      fs.writeFileSync(waitFile, JSON.stringify({
        taskId,
        resetTime: resetTimeMs,
        waitStarted: now,
        status: 'waiting_rate_limit'
      }), 'utf8');
      
      // 待機
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      // 待機ファイルを削除
      try {
        fs.unlinkSync(waitFile);
      } catch (e) {
        // エラーは無視
      }
    }
    
    console.log(`[${taskId}] レート制限解除、処理を再開します`);
    
    // --continue で再開
    return this.resumeWithContinue(taskId, outputFile, resultFile);
  }

  /**
   * --continue オプションで処理を再開
   */
  resumeWithContinue(taskId, outputFile, resultFile) {
    return new Promise((resolve, reject) => {
      const args = [
        '--dangerously-skip-permissions',
        '--print',
        '--continue',
        'please resume your jobs.'
      ];
      
      console.log(`[${taskId}] Claude CLI再開: claude ${args.join(' ')}`);
      
      const claude = spawn('claude', args, {
        stdio: ['pipe', 'pipe', 'pipe']
      });
      
      let stdout = '';
      let stderr = '';
      
      claude.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        
        // リアルタイムで出力ファイルに追記
        fs.appendFileSync(outputFile, chunk, 'utf8');
      });
      
      claude.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      claude.on('exit', (code) => {
        console.log(`[${taskId}] Claude CLI再開終了 (code: ${code})`);
        
        // 再度レート制限エラーかチェック
        const newResetTime = this.parseRateLimitError(stderr);
        if (newResetTime) {
          // 再度レート制限に引っかかった場合
          console.log(`[${taskId}] 再度レート制限を検出`);
          this.waitAndResume(taskId, newResetTime, outputFile, resultFile)
            .then(result => resolve(result))
            .catch(error => reject(error));
        } else {
          // 正常終了または他のエラー
          const result = {
            taskId,
            exitCode: code,
            output: stdout,
            error: stderr,
            completedAt: new Date().toISOString(),
            success: code === 0,
            resumed: true
          };
          
          // 結果ファイルを更新
          fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf8');
          
          resolve(result);
        }
      });
      
      claude.on('error', (error) => {
        console.error(`[${taskId}] Claude CLI エラー:`, error.message);
        
        const result = {
          taskId,
          exitCode: -1,
          output: stdout,
          error: error.message,
          completedAt: new Date().toISOString(),
          success: false,
          resumed: true
        };
        
        fs.writeFileSync(resultFile, JSON.stringify(result, null, 2), 'utf8');
        reject(error);
      });
    });
  }

  /**
   * 既存の結果ファイルをチェックして、レート制限エラーなら再開
   */
  async checkAndResumeIfNeeded(taskId) {
    const resultFile = path.join(this.tempDir, `task-${taskId}.result`);
    const outputFile = path.join(this.tempDir, `task-${taskId}.output`);
    
    if (!fs.existsSync(resultFile)) {
      return null;
    }
    
    try {
      const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
      
      // エラーメッセージからレート制限を検出
      if (result.error) {
        const resetTime = this.parseRateLimitError(result.error);
        if (resetTime) {
          console.log(`[${taskId}] 既存の結果からレート制限を検出、再開処理を開始`);
          return await this.waitAndResume(taskId, resetTime, outputFile, resultFile);
        }
      }
      
      return result;
    } catch (error) {
      console.error(`[${taskId}] 結果ファイルの読み込みエラー:`, error);
      return null;
    }
  }
}

module.exports = RateLimitHandler;