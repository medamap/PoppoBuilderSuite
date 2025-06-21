/**
 * モックClaude CLI
 * 
 * 実際のClaude APIを呼び出さずにテストを行うためのモック実装
 */

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class MockClaudeCLI {
  constructor(config = {}) {
    this.config = {
      responseDelay: config.responseDelay || 1000,
      failureRate: config.failureRate || 0,
      rateLimitSimulation: config.rateLimitSimulation || false,
      sessionTimeoutSimulation: config.sessionTimeoutSimulation || false,
      ...config
    };
    
    this.mockExecutablePath = null;
    this.requestLog = [];
    this.isStarted = false;
    
    // レスポンステンプレート
    this.responses = {
      success: {
        code: 0,
        stdout: `# Task Completed Successfully

The requested task has been completed successfully. Here are the key points:

1. **Analysis**: The code has been analyzed and understood
2. **Implementation**: All necessary changes have been implemented
3. **Testing**: The implementation has been tested and verified
4. **Documentation**: Relevant documentation has been updated

## Summary

All requirements have been met and the task is complete.

\`\`\`json
{
  "status": "completed",
  "confidence": 0.95,
  "changes": ["file1.js", "file2.js"],
  "recommendations": ["Add unit tests", "Update documentation"]
}
\`\`\`
`,
        stderr: ''
      },
      
      rateLimitError: {
        code: 1,
        stdout: 'Claude AI usage limit reached|' + Math.floor((Date.now() + 3600000) / 1000),
        stderr: 'Rate limit exceeded'
      },
      
      sessionTimeout: {
        code: 1,
        stdout: 'Invalid API key. Please run /login to authenticate with Claude.',
        stderr: 'API Login Failure'
      },
      
      genericError: {
        code: 1,
        stdout: 'Execute error%',
        stderr: 'An error occurred during execution'
      }
    };
  }
  
  /**
   * モックサービスの開始
   */
  async start() {
    if (this.isStarted) return;
    
    // 一時ディレクトリにモック実行ファイルを作成
    const tempDir = path.join(os.tmpdir(), `mock-claude-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    this.mockExecutablePath = path.join(tempDir, 'claude');
    
    // モックスクリプトの内容
    const mockScript = this.createMockScript();
    
    await fs.writeFile(this.mockExecutablePath, mockScript);
    await fs.chmod(this.mockExecutablePath, '755');
    
    // 環境変数を設定してモックを使用させる
    const originalPath = process.env.PATH;
    process.env.PATH = `${tempDir}:${originalPath}`;
    
    this.isStarted = true;
    console.log(`Mock Claude CLI started at: ${this.mockExecutablePath}`);
  }
  
  /**
   * モックスクリプトの作成
   */
  createMockScript() {
    const responses = JSON.stringify(this.responses);
    const config = JSON.stringify(this.config);
    
    return `#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const responses = ${responses};
const config = ${config};

// コマンドライン引数を解析
const args = process.argv.slice(2);
const isHelp = args.includes('--help') || args.includes('-h');
const isVersion = args.includes('--version') || args.includes('-v');
const isContinue = args.includes('--continue');

// ヘルプの表示
if (isHelp) {
  console.log(\`
Claude CLI Mock - Test Version

Usage:
  claude [options] [prompt]

Options:
  --help, -h              Show this help message
  --version, -v           Show version information
  --continue              Continue previous execution
  --print                 Print output to stdout
  --dangerously-skip-permissions  Skip permission checks

Environment Variables:
  CLAUDE_MOCK_RESPONSE    Force specific response type
  CLAUDE_MOCK_DELAY       Response delay in milliseconds
\`);
  process.exit(0);
}

// バージョンの表示
if (isVersion) {
  console.log('Claude CLI Mock v1.0.0');
  process.exit(0);
}

async function main() {
  try {
    // 標準入力からプロンプトを読み取り
    const stdin = process.stdin;
    let inputData = '';
    
    stdin.setEncoding('utf8');
    stdin.on('data', (data) => {
      inputData += data;
    });
    
    await new Promise((resolve) => {
      stdin.on('end', resolve);
    });
    
    // リクエストをログに記録
    const logEntry = {
      timestamp: new Date().toISOString(),
      args: args,
      input: inputData.substring(0, 200) + (inputData.length > 200 ? '...' : ''),
      pid: process.pid
    };
    
    // ログファイルに記録
    const logFile = path.join(process.cwd(), 'test-claude-requests.log');
    fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\\n');
    
    // レスポンスの決定
    let response;
    const forcedResponse = process.env.CLAUDE_MOCK_RESPONSE;
    
    if (forcedResponse && responses[forcedResponse]) {
      response = responses[forcedResponse];
    } else if (inputData.includes('SIMULATE_RATE_LIMIT')) {
      response = responses.rateLimitError;
    } else if (inputData.includes('SIMULATE_SESSION_TIMEOUT')) {
      response = responses.sessionTimeout;
    } else if (Math.random() < config.failureRate) {
      response = responses.genericError;
    } else {
      response = responses.success;
    }
    
    // 遅延の適用
    const delay = parseInt(process.env.CLAUDE_MOCK_DELAY) || config.responseDelay;
    if (delay > 0) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // レスポンスの出力
    if (response.stdout) {
      process.stdout.write(response.stdout);
    }
    
    if (response.stderr) {
      process.stderr.write(response.stderr);
    }
    
    process.exit(response.code);
    
  } catch (error) {
    console.error('Mock Claude CLI Error:', error.message);
    process.exit(1);
  }
}

main();
`;
  }
  
  /**
   * レスポンスの設定
   */
  setResponse(type, response) {
    this.responses[type] = response;
  }
  
  /**
   * 失敗率の設定
   */
  setFailureRate(rate) {
    this.config.failureRate = Math.max(0, Math.min(1, rate));
  }
  
  /**
   * レート制限シミュレーションの有効/無効
   */
  enableRateLimitSimulation(enabled = true) {
    this.config.rateLimitSimulation = enabled;
  }
  
  /**
   * セッションタイムアウトシミュレーションの有効/無効
   */
  enableSessionTimeoutSimulation(enabled = true) {
    this.config.sessionTimeoutSimulation = enabled;
  }
  
  /**
   * リクエストログの取得
   */
  async getRequestLog() {
    const logFile = path.join(process.cwd(), 'test-claude-requests.log');
    try {
      const content = await fs.readFile(logFile, 'utf8');
      return content.split('\\n')
        .filter(line => line.trim())
        .map(line => JSON.parse(line));
    } catch (error) {
      return [];
    }
  }
  
  /**
   * リクエストログのクリア
   */
  async clearRequestLog() {
    const logFile = path.join(process.cwd(), 'test-claude-requests.log');
    try {
      await fs.unlink(logFile);
    } catch (error) {
      // ファイルが存在しない場合は無視
    }
  }
  
  /**
   * 統計情報の取得
   */
  getStats() {
    return {
      totalRequests: this.requestLog.length,
      failureRate: this.config.failureRate,
      rateLimitSimulation: this.config.rateLimitSimulation,
      sessionTimeoutSimulation: this.config.sessionTimeoutSimulation,
      responseDelay: this.config.responseDelay
    };
  }
  
  /**
   * モックサービスの停止
   */
  async stop() {
    if (!this.isStarted) return;
    
    try {
      // モック実行ファイルとディレクトリを削除
      if (this.mockExecutablePath) {
        const tempDir = path.dirname(this.mockExecutablePath);
        await fs.rm(tempDir, { recursive: true, force: true });
      }
      
      // リクエストログをクリア
      await this.clearRequestLog();
      
    } catch (error) {
      console.warn(`Failed to cleanup mock Claude CLI: ${error.message}`);
    }
    
    this.isStarted = false;
    console.log('Mock Claude CLI stopped');
  }
}

module.exports = MockClaudeCLI;