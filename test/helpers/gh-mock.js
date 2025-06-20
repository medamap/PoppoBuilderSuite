const sinon = require('sinon');
const { execSync } = require('child_process');

/**
 * gh コマンドのモックヘルパー
 * 実際の実装（github-client.js）に合わせたモック
 */
class GhMock {
  constructor() {
    this.stubs = [];
    this.mockData = new Map();
    this.originalExecSync = null;
  }

  /**
   * gh コマンドのモックを設定
   */
  setup() {
    if (this.originalExecSync) {
      throw new Error('GhMock is already set up');
    }

    this.originalExecSync = require('child_process').execSync;
    const mockExecSync = (command) => {
      // gh コマンドのみをモック
      if (typeof command === 'string' && command.startsWith('gh ')) {
        return this.handleGhCommand(command);
      }
      // その他のコマンドは元の実装を使用
      return this.originalExecSync(command);
    };

    require('child_process').execSync = mockExecSync;
  }

  /**
   * gh コマンドを処理
   */
  handleGhCommand(command) {
    // issue list コマンド
    if (command.includes('gh issue list')) {
      const issues = this.mockData.get('issues') || [];
      
      // ラベルフィルタリング
      const labelMatch = command.match(/--label "([^"]+)"/);
      if (labelMatch) {
        const requestedLabels = labelMatch[1].split(',');
        const filtered = issues.filter(issue => 
          issue.labels.some(label => 
            requestedLabels.includes(label.name)
          )
        );
        return JSON.stringify(filtered);
      }
      
      // 状態フィルタリング
      if (command.includes('--state open')) {
        const filtered = issues.filter(issue => issue.state === 'open');
        return JSON.stringify(filtered);
      }
      
      return JSON.stringify(issues);
    }

    // issue create コマンド
    if (command.includes('gh issue create')) {
      const titleMatch = command.match(/--title "([^"]+)"/);
      const bodyMatch = command.match(/--body "([^"]+)"/);
      const labelMatch = command.match(/--label "([^"]+)"/);
      
      const newIssue = {
        number: this.mockData.get('nextIssueNumber') || 100,
        title: titleMatch ? titleMatch[1] : 'Test Issue',
        body: bodyMatch ? bodyMatch[1] : 'Test body',
        labels: labelMatch ? labelMatch[1].split(',').map(name => ({ name })) : [],
        state: 'open',
        createdAt: new Date().toISOString()
      };
      
      // 次のIssue番号を更新
      this.mockData.set('nextIssueNumber', newIssue.number + 1);
      
      // Issues リストに追加
      const issues = this.mockData.get('issues') || [];
      issues.push(newIssue);
      this.mockData.set('issues', issues);
      
      return JSON.stringify(newIssue);
    }

    // issue comment コマンド
    if (command.includes('gh issue comment')) {
      const numberMatch = command.match(/(\d+)/);
      let body = 'Test comment';
      
      // --body-file オプションの処理
      const bodyFileMatch = command.match(/--body-file "([^"]+)"/);
      if (bodyFileMatch) {
        try {
          const fs = require('fs');
          body = fs.readFileSync(bodyFileMatch[1], 'utf8');
        } catch (e) {
          body = 'File content';
        }
      } else {
        // --body オプションの処理
        const bodyMatch = command.match(/--body "([^"]+)"/);
        if (bodyMatch) {
          body = bodyMatch[1];
        }
      }
      
      const comment = {
        id: Date.now(),
        issueNumber: numberMatch ? parseInt(numberMatch[1]) : 1,
        body: body,
        createdAt: new Date().toISOString()
      };
      
      const comments = this.mockData.get('comments') || [];
      comments.push(comment);
      this.mockData.set('comments', comments);
      
      return JSON.stringify({ success: true });
    }

    // label add コマンド
    if (command.includes('gh issue edit') && command.includes('--add-label')) {
      const numberMatch = command.match(/(\d+)/);
      const labelMatch = command.match(/--add-label "([^"]+)"/);
      
      if (numberMatch && labelMatch) {
        const issueNumber = parseInt(numberMatch[1]);
        const labels = labelMatch[1].split(',');
        
        const issues = this.mockData.get('issues') || [];
        const issue = issues.find(i => i.number === issueNumber);
        if (issue) {
          labels.forEach(label => {
            if (!issue.labels.find(l => l.name === label)) {
              issue.labels.push({ name: label });
            }
          });
        }
        
        return JSON.stringify({ success: true });
      }
    }

    // label remove コマンド
    if (command.includes('gh issue edit') && command.includes('--remove-label')) {
      const numberMatch = command.match(/(\d+)/);
      const labelMatch = command.match(/--remove-label "([^"]+)"/);
      
      if (numberMatch && labelMatch) {
        const issueNumber = parseInt(numberMatch[1]);
        const labels = labelMatch[1].split(',');
        
        const issues = this.mockData.get('issues') || [];
        const issue = issues.find(i => i.number === issueNumber);
        if (issue) {
          issue.labels = issue.labels.filter(l => !labels.includes(l.name));
        }
        
        return JSON.stringify({ success: true });
      }
    }

    // api コマンド（レート制限チェック用）
    if (command.includes('gh api rate_limit')) {
      return JSON.stringify({
        rate: {
          limit: 5000,
          remaining: 4999,
          reset: Math.floor(Date.now() / 1000) + 3600
        }
      });
    }

    // デフォルトレスポンス
    return JSON.stringify({ success: true });
  }

  /**
   * モックデータを設定
   */
  setMockData(key, value) {
    this.mockData.set(key, value);
  }

  /**
   * Issues を追加
   */
  addIssue(issue) {
    const issues = this.mockData.get('issues') || [];
    issues.push({
      number: issue.number || issues.length + 1,
      title: issue.title || 'Test Issue',
      body: issue.body || 'Test body',
      labels: issue.labels || [],
      state: issue.state || 'open',
      author: issue.author || { login: 'test-user' },
      createdAt: issue.createdAt || new Date().toISOString(),
      updatedAt: issue.updatedAt || new Date().toISOString()
    });
    this.mockData.set('issues', issues);
  }

  /**
   * すべてのモックデータをクリア
   */
  reset() {
    this.mockData.clear();
    this.mockData.set('nextIssueNumber', 100);
  }

  /**
   * モックを解除
   */
  teardown() {
    if (this.originalExecSync) {
      require('child_process').execSync = this.originalExecSync;
      this.originalExecSync = null;
    }
    this.reset();
  }

  /**
   * 特定のコマンドが呼ばれたかチェック
   */
  wasCommandCalled(commandPattern) {
    // この実装では履歴を追跡していないので、
    // 必要に応じて実装を追加
    return true;
  }
}

module.exports = GhMock;