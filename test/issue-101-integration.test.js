#!/usr/bin/env node

/**
 * Issue #101 統合テスト
 * StatusManagerとMirinOrphanManagerの連携をテスト
 */

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const StatusManager = require('../src/status-manager');
const MirinOrphanManager = require('../src/mirin-orphan-manager');

// モックGitHubClient
class MockGitHubClient {
  constructor() {
    this.issues = new Map();
    this.labels = new Map();
    this.comments = new Map();
  }

  async getIssue(issueNumber) {
    const issue = this.issues.get(issueNumber) || {
      number: issueNumber,
      title: `Test Issue ${issueNumber}`,
      labels: []
    };
    
    // ラベル情報を追加
    const labels = this.labels.get(issueNumber) || [];
    issue.labels = labels.map(name => ({ name }));
    
    return issue;
  }

  async listIssuesWithLabel(label) {
    const issues = [];
    for (const [number, issueLabels] of this.labels.entries()) {
      if (issueLabels.includes(label)) {
        issues.push(await this.getIssue(number));
      }
    }
    return issues;
  }

  async updateLabels(issueNumber, labels) {
    this.labels.set(issueNumber, labels);
    console.log(`MockGitHub: Issue #${issueNumber} のラベルを更新:`, labels);
  }

  async createComment(issueNumber, comment) {
    if (!this.comments.has(issueNumber)) {
      this.comments.set(issueNumber, []);
    }
    this.comments.get(issueNumber).push(comment);
    console.log(`MockGitHub: Issue #${issueNumber} にコメント追加`);
  }
}

// テスト実行
async function runTests() {
  const testDir = path.join(__dirname, 'test-issue-101');
  
  try {
    // テストディレクトリを作成
    await fs.mkdir(testDir, { recursive: true });
    await fs.mkdir(path.join(testDir, 'state'), { recursive: true });
    
    // モックロガー
    const logger = {
      info: (...args) => console.log('[INFO]', ...args),
      error: (...args) => console.error('[ERROR]', ...args),
      warn: (...args) => console.warn('[WARN]', ...args)
    };
    
    // コンポーネントを初期化
    const mockGitHub = new MockGitHubClient();
    const statusManager = new StatusManager(
      path.join(testDir, 'state/issue-status.json'),
      logger
    );
    const mirinManager = new MirinOrphanManager(
      mockGitHub,
      statusManager,
      {
        checkInterval: 1000,
        heartbeatTimeout: 500,
        requestsDir: path.join(testDir, 'state/requests'),
        requestCheckInterval: 100
      },
      logger
    );
    
    await statusManager.initialize();
    await mirinManager.initialize();
    
    console.log('\n=== テスト1: 正常なチェックアウト/チェックイン ===');
    
    // Issue をチェックアウト
    await statusManager.checkout('123', 'test-process', 'test');
    
    // ラベル更新リクエストが作成されたか確認
    await new Promise(resolve => setTimeout(resolve, 500));
    console.log('リクエスト処理前のラベル:', mockGitHub.labels.get('123'));
    await mirinManager.processLabelRequests();
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // GitHubのラベルが更新されたか確認
    const labels123 = mockGitHub.labels.get('123') || [];
    console.log('リクエスト処理後のラベル:', labels123);
    assert(labels123.includes('processing'), 
      'processing ラベルが追加されている');
    
    // チェックイン
    await statusManager.checkin('123', 'completed');
    await new Promise(resolve => setTimeout(resolve, 200));
    await mirinManager.processLabelRequests();
    
    // processing ラベルが削除されたか確認
    const labels123After = mockGitHub.labels.get('123') || [];
    assert(!labels123After.includes('processing'), 
      'processing ラベルが削除されている');
    
    console.log('✅ テスト1 成功');
    
    console.log('\n=== テスト2: 孤児 Issue の検出 ===');
    
    // 孤児 Issue を作成（古いハートビート）
    await statusManager.checkout('456', 'orphan-process', 'test');
    
    // processing ラベルを設定
    mockGitHub.labels.set('456', ['processing']);
    
    // ハートビートを古くする
    await statusManager.acquireLock();
    try {
      statusManager.state.issues['456'].lastHeartbeat = 
        new Date(Date.now() - 10 * 60 * 1000).toISOString();
      statusManager.state.issues['456'].pid = 999999; // 存在しない PID
      await statusManager.saveState();
    } finally {
      await statusManager.releaseLock();
    }
    
    // 孤児チェックを実行
    await mirinManager.checkOrphanedIssues();
    await new Promise(resolve => setTimeout(resolve, 200));
    await mirinManager.processLabelRequests();
    
    // 孤児が処理されたか確認
    const status456 = await statusManager.getStatus('456');
    assert(status456 === null, '孤児 Issue のステータスがリセットされている');
    const labels456 = mockGitHub.labels.get('456') || [];
    assert(!labels456.includes('processing'), 
      '孤児 Issue の processing ラベルが削除されている');
    
    console.log('✅ テスト2 成功');
    
    console.log('\n=== テスト3: ラベルとステータスの同期 ===');
    
    // ステータスは processing だがラベルがない状態を作る
    await statusManager.checkout('789', 'sync-test', 'test');
    mockGitHub.labels.set('789', []); // ラベルなし
    
    // 同期を実行
    await mirinManager.syncWithStatusManager();
    await new Promise(resolve => setTimeout(resolve, 200));
    await mirinManager.processLabelRequests();
    
    // ラベルが同期されたか確認
    const labels789 = mockGitHub.labels.get('789') || [];
    assert(labels789.includes('processing'), 
      'processing ラベルが同期された');
    
    console.log('✅ テスト3 成功');
    
    console.log('\n=== すべてのテストが成功しました！ ===');
    
    // クリーンアップ
    statusManager.cleanup();
    mirinManager.cleanup();
    
  } catch (error) {
    console.error('\n❌ テスト失敗:', error);
    throw error;
  } finally {
    // テストディレクトリを削除
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // 無視
    }
  }
}

// 実行
if (require.main === module) {
  runTests().catch(error => {
    console.error(error);
    process.exit(1);
  });
}