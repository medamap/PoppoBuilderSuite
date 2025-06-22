#!/usr/bin/env node

/**
 * Process Pool Demo
 * プロセスプールの動作を確認するためのデモスクリプト
 */

const { ProcessPoolManager } = require('../lib/core/process-pool-manager');
const path = require('path');

async function runDemo() {
  console.log('=== Process Pool Manager Demo ===\n');
  
  // プロセスプールを作成
  const pool = new ProcessPoolManager({
    minWorkers: 2,
    maxWorkers: 4,
    autoScale: true,
    scaleUpThreshold: 0.7,
    scaleDownThreshold: 0.2,
    workerScript: path.join(__dirname, '..', 'lib', 'core', 'worker-process.js')
  });
  
  // イベントリスナーを設定
  pool.on('worker-started', (event) => {
    console.log(`✅ Worker started: ${event.workerId}`);
  });
  
  pool.on('worker-terminated', (event) => {
    console.log(`❌ Worker terminated: ${event.workerId}`);
  });
  
  pool.on('task-complete', (event) => {
    console.log(`✅ Task completed: ${event.taskId} (${event.duration}ms)`);
  });
  
  pool.on('task-error', (event) => {
    console.log(`❌ Task error: ${event.taskId} - ${event.error}`);
  });
  
  pool.on('scaled-up', (event) => {
    console.log(`⬆️  Pool scaled up: ${event.workers} workers added`);
  });
  
  pool.on('scaled-down', (event) => {
    console.log(`⬇️  Pool scaled down: ${event.workers} workers removed`);
  });
  
  try {
    // プールを初期化
    console.log('Initializing process pool...');
    await pool.initialize();
    
    // 初期状態を表示
    let stats = pool.getStats();
    console.log('\nInitial pool stats:');
    console.log(`  Workers: ${stats.workers.total} (${stats.workers.available} available)`);
    console.log(`  Load: ${Math.round(stats.load * 100)}%\n`);
    
    // 複数のタスクを送信
    console.log('Submitting tasks...\n');
    
    const tasks = [];
    
    // コード実行タスク
    tasks.push(pool.submitTask({
      type: 'execute-code',
      code: `
        const result = [];
        for (let i = 0; i < 5; i++) {
          result.push('Hello from worker ' + i);
        }
        return result.join(', ');
      `
    }, { projectId: 'demo-project' }));
    
    // 関数実行タスク
    tasks.push(pool.submitTask({
      type: 'execute-function',
      code: `
        return async function fibonacci(n) {
          if (n <= 1) return n;
          return fibonacci(n - 1) + fibonacci(n - 2);
        }
      `,
      args: [10]
    }, { projectId: 'demo-project' }));
    
    // HTTPリクエストタスク（シミュレーション）
    tasks.push(pool.submitTask({
      type: 'http-request',
      url: 'https://api.github.com/repos/nodejs/node',
      method: 'GET'
    }, { projectId: 'demo-project' }));
    
    // シェルコマンドタスク
    tasks.push(pool.submitTask({
      type: 'shell-command',
      command: 'echo "Hello from shell"'
    }, { projectId: 'demo-project' }));
    
    // 高優先度タスク
    tasks.push(pool.submitTask({
      type: 'execute-code',
      code: 'return "High priority task completed";'
    }, { projectId: 'demo-project', priority: 10 }));
    
    // タスク完了を待つ
    console.log('Waiting for tasks to complete...\n');
    const results = await Promise.all(tasks);
    
    console.log('\nTask results:');
    results.forEach((result, index) => {
      console.log(`  Task ${index + 1}: ${JSON.stringify(result)}`);
    });
    
    // 最終的な統計を表示
    stats = pool.getStats();
    console.log('\nFinal pool stats:');
    console.log(`  Workers: ${stats.workers.total} (${stats.workers.available} available)`);
    console.log(`  Tasks completed: ${stats.tasks.completed}`);
    console.log(`  Tasks failed: ${stats.tasks.failed}`);
    console.log(`  Average task time: ${stats.tasks.avgTime}ms`);
    console.log(`  Load: ${Math.round(stats.load * 100)}%`);
    
    // プロジェクト制限のテスト
    console.log('\n=== Testing Project Limits ===');
    pool.setProjectLimit('limited-project', 2);
    
    const limitedTasks = [];
    for (let i = 0; i < 5; i++) {
      limitedTasks.push(
        pool.submitTask({
          type: 'execute-code',
          code: `return "Limited task ${i}";`
        }, { projectId: 'limited-project' })
        .catch(err => ({ error: err.message }))
      );
    }
    
    const limitedResults = await Promise.all(limitedTasks);
    console.log('\nLimited project results:');
    limitedResults.forEach((result, index) => {
      if (result.error) {
        console.log(`  Task ${index + 1}: ❌ ${result.error}`);
      } else {
        console.log(`  Task ${index + 1}: ✅ ${result}`);
      }
    });
    
    // プロジェクト使用状況を表示
    const projectUsage = pool.getStats().projectUsage;
    console.log('\nProject usage:');
    for (const [project, usage] of Object.entries(projectUsage)) {
      console.log(`  ${project}: ${usage}`);
    }
    
  } catch (error) {
    console.error('Demo error:', error);
  } finally {
    // プールをシャットダウン
    console.log('\nShutting down process pool...');
    await pool.shutdown();
    console.log('Process pool shut down successfully');
  }
}

// デモを実行
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = { runDemo };