/**
 * Issue #94: 1回のポーリングで新規Issue処理を1つに制限する機能のテスト
 */

const assert = require('assert');

// モックTaskQueue
class MockTaskQueue {
  constructor() {
    this.queue = [];
    this.running = 0;
    this.maxConcurrent = 2;
  }
  
  canExecute() {
    return this.running < this.maxConcurrent;
  }
  
  getQueueSize() {
    return this.queue.length;
  }
  
  enqueue(task) {
    this.queue.push(task);
    return `task-${Date.now()}`;
  }
  
  dequeue() {
    return this.queue.shift();
  }
  
  startTask(taskId, info) {
    this.running++;
  }
  
  completeTask(taskId, success) {
    this.running--;
  }
}

// モックRateLimiter
class MockRateLimiter {
  async isRateLimited() {
    return { limited: false };
  }
  
  resetRetryState(taskId) {}
}

// テスト用のprocessQueuedTasks実装
async function processQueuedTasks(taskQueue, rateLimiter, processIssue, processComment) {
  let newIssuesStarted = 0; // 新規Issue開始数をカウント
  
  while (taskQueue.canExecute() && taskQueue.getQueueSize() > 0) {
    const task = taskQueue.dequeue();
    if (!task) break;
    
    // 新規Issueの場合、1回のポーリングで1つまで
    if (task.type === 'issue' && newIssuesStarted >= 1) {
      taskQueue.enqueue(task); // キューに戻す
      console.log('📋 新規Issue処理は1回のポーリングで1つまでに制限');
      break;
    }
    
    // レート制限チェック
    const rateLimitStatus = await rateLimiter.isRateLimited();
    if (rateLimitStatus.limited) {
      taskQueue.enqueue(task);
      console.log(`⏸️  レート制限中: ${rateLimitStatus.api} API`);
      break;
    }
    
    // タスク実行開始
    taskQueue.startTask(task.id, { type: task.type, issueNumber: task.issueNumber });
    
    try {
      if (task.type === 'issue') {
        newIssuesStarted++; // カウントアップ
        processIssue(task).then(() => {
          taskQueue.completeTask(task.id, true);
        }).catch((error) => {
          console.error(`タスク ${task.id} エラー:`, error.message);
          taskQueue.completeTask(task.id, false);
        });
      } else if (task.type === 'comment') {
        // コメント処理は制限しない
        processComment(task).then(() => {
          taskQueue.completeTask(task.id, true);
        }).catch((error) => {
          console.error(`コメントタスク ${task.id} エラー:`, error.message);
          taskQueue.completeTask(task.id, false);
        });
      }
    } catch (error) {
      console.error(`タスク処理エラー:`, error.message);
      taskQueue.completeTask(task.id, false);
    }
  }
  
  return newIssuesStarted;
}

// テスト実行
async function runTests() {
  console.log('=== Issue #94 テスト開始 ===\n');
  
  // テスト1: 複数の新規Issueがある場合、1つだけ処理される
  console.log('テスト1: 複数の新規Issueで1つだけ処理');
  {
    const taskQueue = new MockTaskQueue();
    const rateLimiter = new MockRateLimiter();
    let processedIssues = 0;
    let processedComments = 0;
    
    // 3つの新規Issueをキューに追加
    taskQueue.enqueue({ id: 'task-1', type: 'issue', issueNumber: 1 });
    taskQueue.enqueue({ id: 'task-2', type: 'issue', issueNumber: 2 });
    taskQueue.enqueue({ id: 'task-3', type: 'issue', issueNumber: 3 });
    
    const processIssue = async (task) => {
      processedIssues++;
      console.log(`  Issue #${task.issueNumber} を処理`);
    };
    
    const processComment = async (task) => {
      processedComments++;
    };
    
    const started = await processQueuedTasks(taskQueue, rateLimiter, processIssue, processComment);
    
    // 待機して非同期処理を完了
    await new Promise(resolve => setTimeout(resolve, 100));
    
    assert.strictEqual(started, 1, '1つの新規Issueのみ開始されるべき');
    assert.strictEqual(taskQueue.getQueueSize(), 2, '残り2つのIssueがキューに残っているべき');
    console.log('  ✅ 成功: 1つのIssueのみ処理開始\n');
  }
  
  // テスト2: コメント処理は制限されない
  console.log('テスト2: コメント処理は制限されない');
  {
    const taskQueue = new MockTaskQueue();
    const rateLimiter = new MockRateLimiter();
    let processedIssues = 0;
    let processedComments = 0;
    
    // 1つのIssueと2つのコメントをキューに追加
    taskQueue.enqueue({ id: 'task-1', type: 'issue', issueNumber: 1 });
    taskQueue.enqueue({ id: 'task-2', type: 'comment', issueNumber: 2, commentId: 1 });
    taskQueue.enqueue({ id: 'task-3', type: 'comment', issueNumber: 3, commentId: 2 });
    
    const processIssue = async (task) => {
      processedIssues++;
      console.log(`  Issue #${task.issueNumber} を処理`);
    };
    
    const processComment = async (task) => {
      processedComments++;
      console.log(`  Issue #${task.issueNumber} のコメント ${task.commentId} を処理`);
    };
    
    const started = await processQueuedTasks(taskQueue, rateLimiter, processIssue, processComment);
    
    // 待機して非同期処理を完了
    await new Promise(resolve => setTimeout(resolve, 100));
    
    assert.strictEqual(started, 1, '1つの新規Issueが開始される');
    // 非同期処理が完了するまで待機
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.strictEqual(processedIssues, 1, '1つのIssueが処理された');
    assert.strictEqual(processedComments, 2, '2つのコメントが処理された');
    assert.strictEqual(taskQueue.getQueueSize(), 0, 'キューは空になるべき');
    console.log('  ✅ 成功: Issueは1つ、コメントは制限なし\n');
  }
  
  // テスト3: Issueがない場合は制限されない
  console.log('テスト3: Issueがない場合（コメントのみ）');
  {
    const taskQueue = new MockTaskQueue();
    const rateLimiter = new MockRateLimiter();
    let processedComments = 0;
    
    // 3つのコメントをキューに追加
    taskQueue.enqueue({ id: 'task-1', type: 'comment', issueNumber: 1, commentId: 1 });
    taskQueue.enqueue({ id: 'task-2', type: 'comment', issueNumber: 2, commentId: 2 });
    taskQueue.enqueue({ id: 'task-3', type: 'comment', issueNumber: 3, commentId: 3 });
    
    const processIssue = async (task) => {};
    const processComment = async (task) => {
      processedComments++;
      console.log(`  Issue #${task.issueNumber} のコメント ${task.commentId} を処理`);
    };
    
    const started = await processQueuedTasks(taskQueue, rateLimiter, processIssue, processComment);
    
    // コメントのみなので newIssuesStarted は 0
    assert.strictEqual(started, 0, '新規Issue開始数は0');
    // 非同期処理が完了するまで待機
    await new Promise(resolve => setTimeout(resolve, 200));
    // コメントは制限されないので、すべて処理される
    assert.strictEqual(processedComments, 3, '3つのコメントがすべて処理された');
    assert.strictEqual(taskQueue.getQueueSize(), 0, 'キューは空になる');
    console.log('  ✅ 成功: コメントのみの場合は制限なし\n');
  }
  
  console.log('=== すべてのテストが成功しました！ ===');
}

// テスト実行
runTests().catch(console.error);