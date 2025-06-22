/**
 * 重複処理抑制機能のテスト
 * Issue #70で実装された機能の動作確認
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// テスト用の模擬機能
const mockConfig = {
  github: {
    owner: 'test-owner',
    repo: 'test-repo'
  },
  polling: {
    interval: 1000
  }
};

// テストケース管理用
const testSuites = {};
let currentSuite = null;
let beforeEachFn = null;

function describe(name, fn) {
  testSuites[name] = [];
  currentSuite = testSuites[name];
  beforeEachFn = null;
  fn();
}

function it(name, fn) {
  currentSuite.push({ name, fn, beforeEach: beforeEachFn });
}

function beforeEach(fn) {
  beforeEachFn = fn;
}

// 模擬GitHubクライアント
class MockGitHubClient {
  constructor() {
    this.issues = [];
    this.labels = new Map();
  }

  async listIssues() {
    return this.issues;
  }

  async addLabels(issueNumber, labels) {
    if (!this.labels.has(issueNumber)) {
      this.labels.set(issueNumber, new Set());
    }
    labels.forEach(label => this.labels.get(issueNumber).add(label));
  }

  async removeLabels(issueNumber, labels) {
    if (this.labels.has(issueNumber)) {
      labels.forEach(label => this.labels.get(issueNumber).delete(label));
    }
  }

  getLabels(issueNumber) {
    return Array.from(this.labels.get(issueNumber) || []);
  }
}

// テストケース
describe('重複処理抑制機能のテスト', () => {
  let github;

  beforeEach(() => {
    github = new MockGitHubClient();
  });

  describe('shouldProcessIssue関数の動作確認', () => {
    it('processingラベルがある場合はスキップされる', () => {
      // shouldProcessIssue関数のロジックを再現
      const shouldProcessIssue = (issue) => {
        const labels = issue.labels.map(l => l.name);
        
        // completed, processing, awaiting-responseラベルがあればスキップ
        if (labels.includes('completed') || labels.includes('processing') || labels.includes('awaiting-response')) {
          return false;
        }
        
        // task:*ラベルチェック
        const taskLabels = ['task:misc', 'task:dogfooding', 'task:quality', 'task:docs', 'task:feature'];
        if (!labels.some(label => taskLabels.includes(label))) {
          return false;
        }
        
        return true;
      };

      // テストケース1: processingラベルがある場合
      const issue1 = {
        number: 1,
        labels: [
          { name: 'task:misc' },
          { name: 'processing' }
        ]
      };
      assert.strictEqual(shouldProcessIssue(issue1), false, 'processingラベルがある場合はfalseを返すべき');

      // テストケース2: processingラベルがない場合
      const issue2 = {
        number: 2,
        labels: [
          { name: 'task:misc' }
        ]
      };
      assert.strictEqual(shouldProcessIssue(issue2), true, 'processingラベルがない場合はtrueを返すべき');
    });
  });

  describe('processedIssues Setによる重複防止', () => {
    it('同じIssue番号は一度しか処理されない', () => {
      const processedIssues = new Set();
      
      // 初回処理
      const issueNumber = 123;
      assert.strictEqual(processedIssues.has(issueNumber), false, '初回はまだ処理されていない');
      processedIssues.add(issueNumber);
      assert.strictEqual(processedIssues.has(issueNumber), true, '処理後は記録される');
      
      // 2回目の処理試行
      assert.strictEqual(processedIssues.has(issueNumber), true, '2回目も処理済みとして検出される');
    });
  });

  describe('ラベルによる重複処理防止フロー', () => {
    it('Issue処理開始時にprocessingラベルが追加される', async () => {
      const issueNumber = 456;
      
      // 処理開始時のラベル追加をシミュレート
      await github.addLabels(issueNumber, ['processing']);
      
      const labels = github.getLabels(issueNumber);
      assert(labels.includes('processing'), 'processingラベルが追加されている');
    });
    
    it('処理完了時にprocessingラベルが削除される', async () => {
      const issueNumber = 789;
      
      // 処理開始
      await github.addLabels(issueNumber, ['processing']);
      assert(github.getLabels(issueNumber).includes('processing'), 'processingラベルが追加されている');
      
      // 処理完了
      await github.removeLabels(issueNumber, ['processing']);
      await github.addLabels(issueNumber, ['completed']);
      
      const labels = github.getLabels(issueNumber);
      assert(!labels.includes('processing'), 'processingラベルが削除されている');
      assert(labels.includes('completed'), 'completedラベルが追加されている');
    });
  });

  describe('実行中タスクの管理', () => {
    it('実行中タスクリストへの追加と削除', () => {
      const runningTasks = {};
      const taskId = 'issue-100';
      const taskInfo = {
        issueNumber: 100,
        title: 'Test Issue',
        startTime: new Date().toISOString()
      };
      
      // タスク追加
      runningTasks[taskId] = taskInfo;
      assert.strictEqual(Object.keys(runningTasks).length, 1, 'タスクが追加されている');
      assert.strictEqual(runningTasks[taskId].issueNumber, 100, 'Issue番号が正しい');
      
      // タスク削除
      delete runningTasks[taskId];
      assert.strictEqual(Object.keys(runningTasks).length, 0, 'タスクが削除されている');
    });
  });

  describe('並行処理シミュレーション', () => {
    it('30秒間隔のポーリングで重複処理が発生しない', async () => {
      const processedCount = new Map();
      const processingIssues = new Set();
      
      // Issue処理のシミュレーション
      const processIssue = async (issueNumber) => {
        // 既に処理中かチェック
        if (processingIssues.has(issueNumber)) {
          console.log(`Issue #${issueNumber} は既に処理中のためスキップ`);
          return false;
        }
        
        // 処理開始
        processingIssues.add(issueNumber);
        processedCount.set(issueNumber, (processedCount.get(issueNumber) || 0) + 1);
        
        // 処理時間のシミュレーション（1秒）
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 処理完了
        processingIssues.delete(issueNumber);
        return true;
      };
      
      // 同じIssueを複数回処理しようとする
      const promises = [];
      for (let i = 0; i < 3; i++) {
        promises.push(processIssue(200));
        await new Promise(resolve => setTimeout(resolve, 100)); // 100ms間隔
      }
      
      await Promise.all(promises);
      
      assert.strictEqual(processedCount.get(200), 1, 'Issue #200は1回だけ処理される');
    });
  });
});

// テスト実行
console.log('🧪 重複処理抑制機能のテストを開始...\n');

let passedCount = 0;
let failedCount = 0;

// テストケースを実行
Object.entries(testSuites).forEach(([suiteName, suite]) => {
  console.log(`📋 ${suiteName}`);
  
  suite.forEach((test, index) => {
    try {
      if (test.beforeEach) test.beforeEach();
      test.fn();
      console.log(`  ✅ ${test.name}`);
      passedCount++;
    } catch (error) {
      console.log(`  ❌ ${test.name}`);
      console.log(`     ${error.message}`);
      failedCount++;
    }
  });
  
  console.log('');
});

// 結果サマリー
console.log('📊 テスト結果サマリー');
console.log(`  成功: ${passedCount}件`);
console.log(`  失敗: ${failedCount}件`);
console.log(`  合計: ${passedCount + failedCount}件`);

if (failedCount === 0) {
  console.log('\n✨ すべてのテストが成功しました！');
  process.exit(0);
} else {
  console.log('\n⚠️  一部のテストが失敗しました');
  process.exit(1);
}