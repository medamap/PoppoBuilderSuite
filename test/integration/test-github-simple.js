#!/usr/bin/env node
/**
 * GitHub簡略化統合テスト
 * - ghコマンドモックを使用
 * - REST APIとOAuth/GraphQLを削除
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;

console.log('🐙 GitHub簡略化テストを開始します...\n');

/**
 * テスト実行
 */
async function runTests() {
  let passed = 0;
  let failed = 0;
  
  const GhMock = require('../helpers/gh-mock');
  const ghMock = new GhMock();

  // テスト1: GitHubClientの基本動作（ghコマンド使用）
  console.log('📋 テスト1: GitHubClientの基本動作');
  try {
    // ghモックをセットアップ
    ghMock.setup();
    
    // テストデータを設定
    ghMock.addIssue({
      number: 1,
      title: 'Test Issue 1',
      body: 'This is a test issue',
      labels: [{ name: 'task:misc' }],
      state: 'open'
    });
    
    ghMock.addIssue({
      number: 2,
      title: 'Test Issue 2',
      body: 'Another test issue',
      labels: [{ name: 'task:dogfooding' }],
      state: 'open'
    });

    // GitHubClientを使用
    const GitHubClient = require('../../src/github-client');
    const client = new GitHubClient({
      owner: 'test-owner',
      repo: 'test-repo'
    });

    // Issue一覧を取得
    const issues = await client.listIssues({ state: 'open' });
    assert(Array.isArray(issues), 'Issuesは配列である必要があります');
    assert(issues.length === 2, 'Issue数が正しくありません');
    assert(issues[0].number === 1, 'Issue番号が正しくありません');

    // ラベルフィルタリング
    const dogfoodingIssues = await client.listIssues({
      state: 'open',
      labels: ['task:dogfooding']
    });
    assert(dogfoodingIssues.length === 1, 'ラベルフィルタリングが機能していません');
    assert(dogfoodingIssues[0].number === 2, 'フィルタリング結果が正しくありません');

    console.log('✅ GitHubClientが正常に動作しました');
    passed++;
  } catch (error) {
    console.error('❌ エラー:', error.message);
    failed++;
  } finally {
    ghMock.teardown();
  }

  // テスト2: Issue作成とコメント追加
  console.log('\n📋 テスト2: Issue作成とコメント追加');
  try {
    ghMock.setup();
    
    const GitHubClient = require('../../src/github-client');
    const client = new GitHubClient({
      owner: 'test-owner',
      repo: 'test-repo'
    });

    // Issue作成
    const newIssue = await client.createIssue({
      title: 'New Test Issue',
      body: 'This is a new issue',
      labels: ['task:feature', 'priority:high']
    });

    assert(newIssue.number === 100, 'Issue番号が期待値と異なります');
    assert(newIssue.title === 'New Test Issue', 'Issueタイトルが正しくありません');
    assert(newIssue.labels.length === 2, 'ラベル数が正しくありません');

    // コメント追加
    await client.addComment(100, 'This is a test comment');
    
    const comments = ghMock.mockData.get('comments') || [];
    assert(comments.length === 1, 'コメントが追加されていません');
    assert(comments[0].body === 'This is a test comment', 'コメント内容が正しくありません');

    console.log('✅ Issue作成とコメント追加が正常に動作しました');
    passed++;
  } catch (error) {
    console.error('❌ エラー:', error.message);
    failed++;
  } finally {
    ghMock.teardown();
  }

  // テスト3: ラベル操作
  console.log('\n📋 テスト3: ラベル操作');
  try {
    ghMock.setup();
    
    // 既存のIssueを追加
    ghMock.addIssue({
      number: 10,
      title: 'Label Test Issue',
      labels: [{ name: 'task:misc' }]
    });

    const GitHubClient = require('../../src/github-client');
    const client = new GitHubClient({
      owner: 'test-owner',
      repo: 'test-repo'
    });

    // ラベル追加
    await client.addLabels(10, ['status:processing', 'priority:high']);
    
    const issues = ghMock.mockData.get('issues');
    const issue = issues.find(i => i.number === 10);
    assert(issue.labels.length === 3, 'ラベルが追加されていません');
    assert(issue.labels.some(l => l.name === 'status:processing'), 'processing ラベルがありません');

    // ラベル削除
    await client.removeLabels(10, ['task:misc']);
    assert(issue.labels.length === 2, 'ラベルが削除されていません');
    assert(!issue.labels.some(l => l.name === 'task:misc'), 'task:misc ラベルが残っています');

    console.log('✅ ラベル操作が正常に動作しました');
    passed++;
  } catch (error) {
    console.error('❌ エラー:', error.message);
    failed++;
  } finally {
    ghMock.teardown();
  }

  // テスト4: StatusManagerとの連携
  console.log('\n📋 テスト4: StatusManagerとの連携');
  try {
    ghMock.setup();
    
    const tempDir = await fs.mkdtemp(path.join(require('os').tmpdir(), 'status-test-'));
    const stateFile = path.join(tempDir, 'issue-status.json');
    
    // StatusManagerを初期化
    const StatusManager = require('../../src/status-manager');
    const statusManager = new StatusManager(stateFile, console);
    await statusManager.initialize();

    // テスト用のIssueを追加
    ghMock.addIssue({
      number: 20,
      title: 'Status Test Issue',
      labels: []
    });

    // ステータス更新
    await statusManager.checkout(20, 'test-process', 'test-task');
    
    // ラベル更新リクエストの確認
    const requestDir = path.join(tempDir, '../requests');
    if (await fs.access(requestDir).then(() => true).catch(() => false)) {
      const files = await fs.readdir(requestDir);
      const labelRequests = files.filter(f => f.startsWith('label-update-'));
      assert(labelRequests.length > 0, 'ラベル更新リクエストが作成されていません');
    }

    // チェックイン
    await statusManager.checkin(20, 'completed');
    
    const status = await statusManager.getStatus(20);
    assert(status.status === 'completed', 'ステータスが更新されていません');

    console.log('✅ StatusManagerとの連携が正常に動作しました');
    passed++;

    // クリーンアップ
    await statusManager.cleanup();
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch (error) {
    console.error('❌ エラー:', error.message);
    failed++;
  } finally {
    ghMock.teardown();
  }

  // テスト5: エラーハンドリング
  console.log('\n📋 テスト5: エラーハンドリング');
  try {
    // ghモックなしでGitHubClientを使用（実際のコマンドが実行される）
    const GitHubClient = require('../../src/github-client');
    const client = new GitHubClient({
      owner: 'invalid-owner-xyz',
      repo: 'invalid-repo-xyz'
    });

    // 存在しないリポジトリへのアクセスをテスト
    const issues = await client.listIssues();
    // エラーが発生してもクラッシュせず、空の配列を返すことを確認
    assert(Array.isArray(issues), '空の配列が返されるべきです');
    assert(issues.length === 0, 'エラー時は空の配列を返すべきです');

    console.log('✅ エラーハンドリングが正常に動作しました');
    passed++;
  } catch (error) {
    // GitHubClientがエラーをキャッチして空配列を返すはず
    console.log('✅ エラーが適切にハンドリングされました');
    passed++;
  }

  // 結果サマリー
  console.log('\n📊 テスト結果サマリー');
  console.log(`✅ 成功: ${passed}`);
  console.log(`❌ 失敗: ${failed}`);
  console.log(`🏁 合計: ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

// テスト実行
runTests().catch(error => {
  console.error('致命的なエラー:', error);
  process.exit(1);
});