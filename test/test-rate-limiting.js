#!/usr/bin/env node

/**
 * レート制限機能のテストスクリプト
 */

const EnhancedRateLimiter = require('../src/enhanced-rate-limiter');
const GitHubRateLimiter = require('../src/github-rate-limiter');
const TaskQueue = require('../src/task-queue');

console.log('レート制限機能テスト開始\n');

// テスト1: GitHubレート制限チェック
async function testGitHubRateLimit() {
  console.log('=== Test 1: GitHub APIレート制限チェック ===');
  const githubLimiter = new GitHubRateLimiter();
  
  try {
    const rateLimit = await githubLimiter.updateRateLimit();
    console.log('GitHub APIレート制限情報:');
    console.log(`  - 上限: ${rateLimit.limit}`);
    console.log(`  - 残り: ${rateLimit.remaining}`);
    console.log(`  - 使用: ${rateLimit.used}`);
    console.log(`  - リセット: ${new Date(rateLimit.reset).toLocaleString()}`);
    
    const canMake = await githubLimiter.canMakeAPICalls(10);
    console.log(`  - 10回のAPI呼び出し可能: ${canMake ? 'はい' : 'いいえ'}`);
  } catch (error) {
    console.error('エラー:', error.message);
  }
  console.log();
}

// テスト2: エクスポネンシャルバックオフ
async function testExponentialBackoff() {
  console.log('=== Test 2: エクスポネンシャルバックオフ ===');
  const limiter = new EnhancedRateLimiter({
    initialBackoffDelay: 100,
    maxBackoffDelay: 1000,
    backoffMultiplier: 2,
    backoffJitter: 0.1
  });
  
  const taskId = 'test-task-1';
  
  for (let i = 0; i < 5; i++) {
    const backoff = limiter.calculateBackoff(taskId);
    console.log(`  リトライ ${backoff.retryCount}: 遅延 ${backoff.delay}ms`);
  }
  
  console.log();
}

// テスト3: タスクキュー優先度
function testTaskQueue() {
  console.log('=== Test 3: タスクキュー優先度管理 ===');
  const queue = new TaskQueue({ maxConcurrent: 2 });
  
  // 異なる優先度のタスクを追加
  const tasks = [
    { id: 'task-1', type: 'issue', issueNumber: 1, labels: [] },
    { id: 'task-2', type: 'issue', issueNumber: 2, labels: ['task:dogfooding'] },
    { id: 'task-3', type: 'issue', issueNumber: 3, labels: [], priority: queue.PRIORITY_LEVELS.HIGH },
    { id: 'task-4', type: 'issue', issueNumber: 4, labels: [], priority: queue.PRIORITY_LEVELS.LOW }
  ];
  
  tasks.forEach(task => {
    const id = queue.enqueue(task);
    const priority = queue.determinePriority(task);
    console.log(`  追加: ${id} (優先度: ${queue.getPriorityName(priority)})`);
  });
  
  console.log('\n  デキュー順序:');
  while (queue.getQueueSize() > 0) {
    const task = queue.dequeue();
    console.log(`  - ${task.id} (優先度: ${queue.getPriorityName(task.priority)})`);
  }
  
  console.log('\n  キューステータス:');
  const status = queue.getStatus();
  console.log(`  - 総エンキュー数: ${status.stats.totalEnqueued}`);
  console.log();
}

// テスト4: 統合レート制限チェック
async function testIntegratedRateLimit() {
  console.log('=== Test 4: 統合レート制限チェック ===');
  const limiter = new EnhancedRateLimiter();
  
  try {
    // 事前チェック
    const canProceed = await limiter.preflightCheck(5);
    console.log(`  API呼び出し可能: ${canProceed ? 'はい' : 'いいえ'}`);
    
    // レート制限状態を取得
    const status = await limiter.getRateLimitStatus();
    console.log('  GitHub API状態:');
    console.log(`    - 残り回数: ${status.github.remaining}`);
    console.log(`    - リセット時刻: ${status.github.resetDate}`);
    console.log('  Claude API状態:');
    console.log(`    - 制限中: ${status.claude.isLimited ? 'はい' : 'いいえ'}`);
    
  } catch (error) {
    console.error('エラー:', error.message);
  }
  console.log();
}

// テスト実行
async function runTests() {
  await testGitHubRateLimit();
  await testExponentialBackoff();
  testTaskQueue();
  await testIntegratedRateLimit();
  
  console.log('すべてのテストが完了しました');
}

// メイン実行
runTests().catch(console.error);