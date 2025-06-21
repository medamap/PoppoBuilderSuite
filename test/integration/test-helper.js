/**
 * 統合テスト用ヘルパー関数
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

class TestHelper {
  constructor() {
    this.processes = [];
    this.tempDirs = [];
  }

  /**
   * 一時ディレクトリを作成
   */
  async createTempDir(prefix = 'test-') {
    const tempDir = path.join(__dirname, '../../temp', `${prefix}${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    this.tempDirs.push(tempDir);
    return tempDir;
  }

  /**
   * プロセスを起動
   */
  async startProcess(command, args = [], options = {}) {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, {
        ...options,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('error', reject);

      // プロセスが起動したら即座にresolve
      setTimeout(() => {
        this.processes.push(proc);
        resolve({ proc, stdout, stderr });
      }, 1000);
    });
  }

  /**
   * プロセスが起動しているか確認
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 指定時間待機
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * ファイルの存在を待機
   */
  async waitForFile(filePath, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      try {
        await fs.access(filePath);
        return true;
      } catch (error) {
        await this.wait(100);
      }
    }
    throw new Error(`ファイルが作成されませんでした: ${filePath}`);
  }

  /**
   * ログ出力を待機
   */
  async waitForLog(proc, pattern, timeout = 10000) {
    const startTime = Date.now();
    let buffer = '';

    return new Promise((resolve, reject) => {
      const checkPattern = (data) => {
        buffer += data.toString();
        if (pattern instanceof RegExp ? pattern.test(buffer) : buffer.includes(pattern)) {
          resolve(buffer);
        }
      };

      proc.stdout.on('data', checkPattern);
      proc.stderr.on('data', checkPattern);

      setTimeout(() => {
        reject(new Error(`パターンが見つかりませんでした: ${pattern}`));
      }, timeout);
    });
  }

  /**
   * HTTPリクエストを送信
   */
  async httpRequest(url, options = {}) {
    const http = require(url.startsWith('https') ? 'https' : 'http');
    
    return new Promise((resolve, reject) => {
      const req = http.request(url, options, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => resolve({ 
          statusCode: res.statusCode, 
          headers: res.headers, 
          body: data 
        }));
      });
      
      req.on('error', reject);
      
      if (options.body) {
        req.write(options.body);
      }
      
      req.end();
    });
  }

  /**
   * WebSocket接続を作成
   */
  async createWebSocket(url) {
    const WebSocket = require('ws');
    const ws = new WebSocket(url);
    
    return new Promise((resolve, reject) => {
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      
      setTimeout(() => reject(new Error('WebSocket接続タイムアウト')), 5000);
    });
  }

  /**
   * 環境変数を設定して関数を実行
   */
  async withEnv(env, fn) {
    const originalEnv = { ...process.env };
    Object.assign(process.env, env);
    
    try {
      return await fn();
    } finally {
      process.env = originalEnv;
    }
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    // プロセスを終了
    for (const proc of this.processes) {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
        await this.wait(1000);
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }
    }

    // 一時ディレクトリを削除
    for (const dir of this.tempDirs) {
      try {
        await fs.rm(dir, { recursive: true, force: true });
      } catch (error) {
        console.error(`一時ディレクトリの削除に失敗: ${dir}`, error);
      }
    }
  }

  /**
   * モックGitHubクライアントを作成
   */
  createMockGitHubClient() {
    return {
      issues: [],
      comments: [],
      labels: [],
      
      getIssue: async (number) => {
        return this.issues.find(i => i.number === number) || null;
      },
      
      listIssues: async (options = {}) => {
        let issues = [...this.issues];
        if (options.labels) {
          const labelArray = options.labels.split(',');
          issues = issues.filter(issue => 
            labelArray.some(label => issue.labels.includes(label))
          );
        }
        return issues;
      },
      
      createComment: async (issueNumber, body) => {
        const comment = { id: Date.now(), issueNumber, body };
        this.comments.push(comment);
        return comment;
      },
      
      addLabels: async (issueNumber, labels) => {
        const issue = this.issues.find(i => i.number === issueNumber);
        if (issue) {
          issue.labels = [...new Set([...issue.labels, ...labels])];
        }
      },
      
      removeLabels: async (issueNumber, labels) => {
        const issue = this.issues.find(i => i.number === issueNumber);
        if (issue) {
          issue.labels = issue.labels.filter(l => !labels.includes(l));
        }
      }
    };
  }

  /**
   * テスト用の設定を作成
   */
  createTestConfig(overrides = {}) {
    return {
      github: {
        owner: 'test-owner',
        repo: 'test-repo',
        token: 'test-token'
      },
      claude: {
        apiKey: 'test-api-key',
        model: 'claude-3-opus-20240229',
        maxTokens: 4000,
        temperature: 0.7
      },
      dashboard: {
        enabled: true,
        port: 3001 + Math.floor(Math.random() * 1000)
      },
      githubProjects: {
        enabled: true,
        projects: []
      },
      agents: {
        enabled: true,
        ccta: { enabled: true }
      },
      notifications: {
        enabled: false
      },
      healthCheck: {
        enabled: true,
        interval: 5000
      },
      ...overrides
    };
  }
}

module.exports = TestHelper;