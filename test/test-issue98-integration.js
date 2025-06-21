#!/usr/bin/env node

/**
 * Issue #98の実装テスト
 * minimal-poppo-cron.jsの状態管理統合と二重起動防止強化の検証
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const FileStateManager = require('../src/file-state-manager');

const TEST_DIR = path.join(__dirname, 'test-state-98');
const CRON_SCRIPT = path.join(__dirname, '../src/minimal-poppo-cron.js');

// テスト用の状態ディレクトリを作成
if (!fs.existsSync(TEST_DIR)) {
  fs.mkdirSync(TEST_DIR, { recursive: true });
}

// テスト用のFileStateManager
const stateManager = new FileStateManager(TEST_DIR);

/**
 * プロセスを起動して結果を待つ
 */
function runProcess(timeout = 5000) {
  return new Promise((resolve, reject) => {
    console.log(`\n🚀 プロセスを起動中...`);
    
    const proc = spawn('node', [CRON_SCRIPT], {
      env: {
        ...process.env,
        // テスト用に短い処理にする
        TEST_MODE: 'true',
        STATE_DIR: TEST_DIR
      }
    });
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      process.stdout.write(data);
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      process.stderr.write(data);
    });
    
    // タイムアウト処理
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({ stdout, stderr, code: 'TIMEOUT', pid: proc.pid });
    }, timeout);
    
    proc.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code, pid: proc.pid });
    });
    
    proc.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

/**
 * テスト1: プロセスレベルのロック機構
 */
async function testProcessLock() {
  console.log('\n=== テスト1: プロセスレベルのロック機構 ===');
  
  try {
    // 初期化
    await stateManager.init();
    
    // 最初のプロセスを起動
    const proc1Promise = runProcess(10000);
    
    // 少し待ってから2つ目のプロセスを起動
    await new Promise(resolve => setTimeout(resolve, 2000));
    const proc2 = await runProcess(3000);
    
    // 2つ目のプロセスが即座に終了することを確認
    if (proc2.stdout.includes('別のPoppoBuilderプロセスが既に実行中です')) {
      console.log('✅ 二重起動が正しく防止されました');
    } else {
      console.log('❌ 二重起動防止が機能していません');
      console.log('出力:', proc2.stdout);
    }
    
    // 最初のプロセスを終了
    const proc1 = await proc1Promise;
    console.log('最初のプロセスが終了しました');
    
  } catch (error) {
    console.error('テスト1エラー:', error);
  }
}

/**
 * テスト2: タスクキューの永続化
 */
async function testTaskQueuePersistence() {
  console.log('\n=== テスト2: タスクキューの永続化 ===');
  
  try {
    // テスト用のタスクを作成
    const testTasks = [
      {
        type: 'issue',
        issue: { number: 1001, title: 'Test Issue 1' },
        issueNumber: 1001,
        labels: ['task:misc'],
        priority: 50,
        id: 'task-test-1'
      },
      {
        type: 'issue', 
        issue: { number: 1002, title: 'Test Issue 2' },
        issueNumber: 1002,
        labels: ['task:dogfooding'],
        priority: 100,
        id: 'task-test-2'
      }
    ];
    
    // タスクを保存
    console.log('タスクを保存中...');
    await stateManager.savePendingTasks(testTasks);
    
    // タスクを読み込み
    console.log('タスクを読み込み中...');
    const loadedTasks = await stateManager.loadPendingTasks();
    
    if (loadedTasks.length === 2) {
      console.log('✅ タスクの永続化が正しく機能しています');
      console.log('保存されたタスク数:', loadedTasks.length);
    } else {
      console.log('❌ タスクの永続化に問題があります');
      console.log('期待: 2, 実際:', loadedTasks.length);
    }
    
  } catch (error) {
    console.error('テスト2エラー:', error);
  }
}

/**
 * テスト3: エラー時の状態クリーンアップ
 */
async function testErrorCleanup() {
  console.log('\n=== テスト3: エラー時の状態クリーンアップ ===');
  
  try {
    // 実行中タスクを追加
    const testTaskId = 'issue-9999';
    await stateManager.addRunningTask(testTaskId, {
      issueNumber: 9999,
      title: 'Test Error Issue',
      pid: 12345,
      type: 'normal'
    });
    
    console.log('実行中タスクを追加しました');
    
    // タスクが存在することを確認
    let runningTasks = await stateManager.loadRunningTasks();
    if (runningTasks[testTaskId]) {
      console.log('✅ タスクが正しく追加されました');
    }
    
    // タスクを削除（エラー時のクリーンアップをシミュレート）
    await stateManager.removeRunningTask(testTaskId);
    console.log('タスクをクリーンアップしました');
    
    // タスクが削除されたことを確認
    runningTasks = await stateManager.loadRunningTasks();
    if (!runningTasks[testTaskId]) {
      console.log('✅ エラー時のクリーンアップが正しく機能しています');
    } else {
      console.log('❌ クリーンアップが機能していません');
    }
    
  } catch (error) {
    console.error('テスト3エラー:', error);
  }
}

/**
 * テスト4: ファイルロックの整合性
 */
async function testFileLockIntegrity() {
  console.log('\n=== テスト4: ファイルロックの整合性 ===');
  
  try {
    const testFile = path.join(TEST_DIR, 'test-lock-file.json');
    
    // 複数の並行書き込みを試行
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        stateManager.atomicWrite(testFile, JSON.stringify({ count: i }))
      );
    }
    
    await Promise.all(promises);
    console.log('並行書き込みが完了しました');
    
    // ファイルの内容を確認
    const content = fs.readFileSync(testFile, 'utf8');
    const data = JSON.parse(content);
    
    if (typeof data.count === 'number') {
      console.log('✅ ファイルロックが正しく機能しています');
      console.log('最終的な値:', data.count);
    } else {
      console.log('❌ ファイルロックに問題があります');
    }
    
  } catch (error) {
    console.error('テスト4エラー:', error);
  }
}

/**
 * クリーンアップ
 */
async function cleanup() {
  console.log('\n=== クリーンアップ ===');
  
  try {
    // プロセスロックを解放
    await stateManager.releaseProcessLock();
    
    // テストディレクトリを削除
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
      console.log('テストディレクトリを削除しました');
    }
  } catch (error) {
    console.error('クリーンアップエラー:', error);
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('Issue #98 統合テスト開始\n');
  
  try {
    await testProcessLock();
    await testTaskQueuePersistence();
    await testErrorCleanup();
    await testFileLockIntegrity();
  } catch (error) {
    console.error('テストエラー:', error);
  } finally {
    await cleanup();
  }
  
  console.log('\n統合テスト完了');
}

// 実行
main().catch(console.error);