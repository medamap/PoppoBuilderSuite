/**
 * モックGitHub API
 * 
 * GitHub API呼び出しをシミュレートするテスト用実装
 */

const EventEmitter = require('events');

class MockGitHubAPI extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      latency: config.latency || 100, // 100ms
      errorRate: config.errorRate || 0,
      rateLimitSimulation: config.rateLimitSimulation || false,
      ...config
    };
    
    // モックデータ
    this.issues = new Map();
    this.comments = new Map();
    this.labels = new Set([
      'task:misc', 'task:dogfooding', 'task:feature', 'task:bug', 'task:docs',
      'priority:high', 'priority:normal', 'priority:low',
      'completed', 'in-progress', 'requires-manual-action'
    ]);
    
    // API呼び出し統計
    this.stats = {
      totalRequests: 0,
      getRequests: 0,
      postRequests: 0,
      putRequests: 0,
      deleteRequests: 0,
      errors: 0,
      rateLimitHits: 0
    };
    
    this.isStarted = false;
    this.initializeMockData();
  }
  
  /**
   * モックデータの初期化
   */
  initializeMockData() {
    // テスト用Issue
    this.issues.set(144, {
      number: 144,
      title: 'CCSP移行の統合テストとバリデーション計画',
      body: 'CCSP移行完了後の包括的なテストとバリデーション計画を実施...',
      state: 'open',
      labels: [
        { name: 'task:misc' },
        { name: 'testing' }
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    this.issues.set(143, {
      number: 143,
      title: 'CCSPアーキテクチャドキュメントの作成と責任境界の明文化',
      body: 'CCSPエージェントを中心としたアーキテクチャの完全なドキュメントを作成...',
      state: 'open',
      labels: [
        { name: 'documentation' },
        { name: 'task:docs' }
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    
    // テスト用コメント
    this.comments.set(`144-1`, {
      id: 1,
      issue_number: 144,
      body: 'テスト開始: CCSP統合テストを実行中...',
      created_at: new Date().toISOString()
    });
  }
  
  /**
   * サービス開始
   */
  async start() {
    this.isStarted = true;
    console.log('Mock GitHub API started');
  }
  
  /**
   * レイテンシーのシミュレーション
   */
  async simulateLatency() {
    if (this.config.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.latency));
    }
  }
  
  /**
   * エラーのシミュレーション
   */
  simulateError() {
    if (Math.random() < this.config.errorRate) {
      this.stats.errors++;
      throw new Error('Simulated GitHub API error');
    }
  }
  
  /**
   * レート制限のシミュレーション
   */
  simulateRateLimit() {
    if (this.config.rateLimitSimulation && Math.random() < 0.1) {
      this.stats.rateLimitHits++;
      const error = new Error('API rate limit exceeded');
      error.status = 403;
      error.headers = {
        'x-ratelimit-limit': '5000',
        'x-ratelimit-remaining': '0',
        'x-ratelimit-reset': Math.floor((Date.now() + 3600000) / 1000)
      };
      throw error;
    }
  }
  
  /**
   * Issue API
   */
  
  // Issues一覧取得
  async listIssues(options = {}) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.getRequests++;
    
    let issues = Array.from(this.issues.values());
    
    // フィルタリング
    if (options.state) {
      issues = issues.filter(issue => issue.state === options.state);
    }
    
    if (options.labels) {
      const labelNames = options.labels.split(',');
      issues = issues.filter(issue => 
        issue.labels.some(label => labelNames.includes(label.name))
      );
    }
    
    return issues;
  }
  
  // Issue取得
  async getIssue(issueNumber) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.getRequests++;
    
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      const error = new Error('Not Found');
      error.status = 404;
      throw error;
    }
    
    return issue;
  }
  
  // Issue作成
  async createIssue(data) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.postRequests++;
    
    const issueNumber = Math.max(...this.issues.keys()) + 1;
    const issue = {
      number: issueNumber,
      title: data.title,
      body: data.body || '',
      state: 'open',
      labels: data.labels ? data.labels.map(name => ({ name })) : [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    
    this.issues.set(issueNumber, issue);
    return issue;
  }
  
  // Issue更新
  async updateIssue(issueNumber, data) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.putRequests++;
    
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      const error = new Error('Not Found');
      error.status = 404;
      throw error;
    }
    
    if (data.title !== undefined) issue.title = data.title;
    if (data.body !== undefined) issue.body = data.body;
    if (data.state !== undefined) issue.state = data.state;
    if (data.labels !== undefined) {
      issue.labels = data.labels.map(name => ({ name }));
    }
    
    issue.updated_at = new Date().toISOString();
    
    return issue;
  }
  
  // Issueラベル追加
  async addLabelsToIssue(issueNumber, labels) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.postRequests++;
    
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      const error = new Error('Not Found');
      error.status = 404;
      throw error;
    }
    
    const existingLabels = new Set(issue.labels.map(l => l.name));
    
    for (const label of labels) {
      if (!existingLabels.has(label)) {
        issue.labels.push({ name: label });
        existingLabels.add(label);
      }
    }
    
    issue.updated_at = new Date().toISOString();
    
    return issue.labels;
  }
  
  // Issueラベル削除
  async removeLabelsFromIssue(issueNumber, labels) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.deleteRequests++;
    
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      const error = new Error('Not Found');
      error.status = 404;
      throw error;
    }
    
    issue.labels = issue.labels.filter(label => !labels.includes(label.name));
    issue.updated_at = new Date().toISOString();
    
    return issue.labels;
  }
  
  /**
   * Comment API
   */
  
  // コメント一覧取得
  async listIssueComments(issueNumber) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.getRequests++;
    
    const comments = [];
    for (const [key, comment] of this.comments) {
      if (comment.issue_number === issueNumber) {
        comments.push(comment);
      }
    }
    
    return comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
  
  // コメント作成
  async createIssueComment(issueNumber, body) {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.postRequests++;
    
    const issue = this.issues.get(issueNumber);
    if (!issue) {
      const error = new Error('Not Found');
      error.status = 404;
      throw error;
    }
    
    const commentId = Date.now();
    const comment = {
      id: commentId,
      issue_number: issueNumber,
      body: body,
      created_at: new Date().toISOString()
    };
    
    this.comments.set(`${issueNumber}-${commentId}`, comment);
    return comment;
  }
  
  /**
   * Label API
   */
  
  // ラベル一覧取得
  async listLabels() {
    await this.simulateLatency();
    this.simulateError();
    this.simulateRateLimit();
    
    this.stats.totalRequests++;
    this.stats.getRequests++;
    
    return Array.from(this.labels).map(name => ({ name }));
  }
  
  /**
   * ユーティリティメソッド
   */
  
  // 統計情報の取得
  getStats() {
    return {
      ...this.stats,
      issues: this.issues.size,
      comments: this.comments.size,
      labels: this.labels.size
    };
  }
  
  // データのリセット
  reset() {
    this.issues.clear();
    this.comments.clear();
    this.stats = {
      totalRequests: 0,
      getRequests: 0,
      postRequests: 0,
      putRequests: 0,
      deleteRequests: 0,
      errors: 0,
      rateLimitHits: 0
    };
    
    this.initializeMockData();
  }
  
  // カスタムIssueの追加
  addIssue(issue) {
    this.issues.set(issue.number, {
      ...issue,
      created_at: issue.created_at || new Date().toISOString(),
      updated_at: issue.updated_at || new Date().toISOString()
    });
  }
  
  // カスタムラベルの追加
  addLabel(name) {
    this.labels.add(name);
  }
  
  /**
   * サービス停止
   */
  async stop() {
    this.isStarted = false;
    console.log('Mock GitHub API stopped');
  }
}

module.exports = MockGitHubAPI;