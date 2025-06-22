/**
 * Task Scheduler Demo
 * タスクスケジューラーのデモンストレーション
 */

const TaskScheduler = require('../lib/core/task-scheduler');

async function demonstrateTaskScheduler() {
  console.log('=== Task Scheduler Demo ===\n');
  
  // スケジューラーを作成
  const scheduler = new TaskScheduler({
    strategy: 'round-robin',
    defaultPriority: 50,
    maxConcurrentPerProject: 3
  });
  
  // 初期化
  await scheduler.initialize();
  console.log('✓ スケジューラーを初期化しました\n');
  
  // プロジェクトを登録
  console.log('プロジェクトを登録中...');
  
  scheduler.registerProject('web-app', {
    priority: 80,
    weight: 2.0,
    maxConcurrent: 5,
    metadata: { type: 'frontend', team: 'ui' }
  });
  
  scheduler.registerProject('api-service', {
    priority: 90,
    weight: 3.0,
    maxConcurrent: 10,
    metadata: { type: 'backend', team: 'platform' }
  });
  
  scheduler.registerProject('mobile-app', {
    priority: 60,
    weight: 1.5,
    maxConcurrent: 3,
    metadata: { type: 'mobile', team: 'mobile' }
  });
  
  console.log('✓ 3つのプロジェクトを登録しました\n');
  
  // 各戦略でタスクをスケジュール
  const strategies = ['round-robin', 'priority', 'weighted', 'fair-share'];
  
  for (const strategy of strategies) {
    console.log(`\n=== ${strategy.toUpperCase()} 戦略 ===`);
    
    // 戦略を切り替え
    scheduler.setStrategy(strategy);
    
    // スケジューラーをリセット
    scheduler.reset();
    
    // プロジェクトを再登録
    scheduler.registerProject('web-app', {
      priority: 80,
      weight: 2.0,
      maxConcurrent: 5
    });
    
    scheduler.registerProject('api-service', {
      priority: 90,
      weight: 3.0,
      maxConcurrent: 10
    });
    
    scheduler.registerProject('mobile-app', {
      priority: 60,
      weight: 1.5,
      maxConcurrent: 3
    });
    
    // 10個のタスクをスケジュール
    const assignments = {};
    
    for (let i = 1; i <= 10; i++) {
      const task = {
        id: `task-${i}`,
        type: 'issue',
        priority: Math.floor(Math.random() * 100)
      };
      
      const projectId = await scheduler.scheduleTask(task);
      assignments[projectId] = (assignments[projectId] || 0) + 1;
      
      console.log(`Task ${i}: ${task.id} → ${projectId}`);
      
      // タスクをランダムに完了
      if (Math.random() > 0.5) {
        const execTime = Math.floor(Math.random() * 1000) + 100;
        scheduler.taskCompleted(projectId, task.id, execTime);
      }
    }
    
    // 統計を表示
    console.log('\n配分結果:');
    for (const [projectId, count] of Object.entries(assignments)) {
      const percentage = (count / 10 * 100).toFixed(1);
      console.log(`  ${projectId}: ${count}タスク (${percentage}%)`);
    }
    
    // メトリクスを表示
    const metrics = scheduler.getMetrics();
    console.log(`\nフェアネススコア: ${metrics.fairnessScore.toFixed(3)}`);
  }
  
  // 最終的な統計を表示
  console.log('\n=== 最終統計 ===');
  
  scheduler.reset();
  scheduler.registerProject('project-1', { priority: 50, weight: 1.0 });
  scheduler.registerProject('project-2', { priority: 50, weight: 1.0 });
  
  // 各プロジェクトに均等にタスクを割り当て
  scheduler.setStrategy('fair-share');
  
  for (let i = 0; i < 20; i++) {
    const projectId = await scheduler.scheduleTask({ id: `final-task-${i}` });
    scheduler.taskCompleted(projectId, `final-task-${i}`, 100);
  }
  
  const finalMetrics = scheduler.getMetrics();
  console.log('\n全体メトリクス:');
  console.log(`  総スケジュール数: ${finalMetrics.totalScheduled}`);
  console.log(`  総完了数: ${finalMetrics.totalCompleted}`);
  console.log(`  フェアネススコア: ${finalMetrics.fairnessScore.toFixed(3)}`);
  console.log(`  現在の戦略: ${finalMetrics.currentStrategy}`);
  
  console.log('\nプロジェクト別統計:');
  for (const [projectId, stats] of Object.entries(finalMetrics.projectStats)) {
    console.log(`\n  ${projectId}:`);
    console.log(`    スケジュール済み: ${stats.tasksScheduled}`);
    console.log(`    完了: ${stats.tasksCompleted}`);
    console.log(`    平均実行時間: ${stats.tasksCompleted > 0 ? 
      (stats.totalExecutionTime / stats.tasksCompleted).toFixed(2) : 0}ms`);
  }
}

// 負荷テストのデモ
async function loadTestDemo() {
  console.log('\n\n=== 負荷テストデモ ===\n');
  
  const scheduler = new TaskScheduler({
    strategy: 'priority',
    maxConcurrentPerProject: 10
  });
  
  await scheduler.initialize();
  
  // 高負荷プロジェクトを登録
  const projects = [
    { id: 'critical-service', priority: 100, weight: 3.0, maxConcurrent: 20 },
    { id: 'normal-service', priority: 50, weight: 1.0, maxConcurrent: 10 },
    { id: 'background-job', priority: 10, weight: 0.5, maxConcurrent: 5 }
  ];
  
  projects.forEach(p => scheduler.registerProject(p.id, p));
  
  console.log('1000個のタスクをスケジューリング中...');
  
  const startTime = Date.now();
  const assignments = {};
  
  // 1000個のタスクを高速にスケジュール
  for (let i = 0; i < 1000; i++) {
    const task = {
      id: `load-task-${i}`,
      priority: Math.floor(Math.random() * 100)
    };
    
    const projectId = await scheduler.scheduleTask(task);
    assignments[projectId] = (assignments[projectId] || 0) + 1;
    
    // ランダムにタスクを完了
    if (Math.random() > 0.7) {
      scheduler.taskCompleted(projectId, task.id, Math.random() * 100);
    }
  }
  
  const duration = Date.now() - startTime;
  
  console.log(`\n完了！処理時間: ${duration}ms`);
  console.log(`スループット: ${(1000 / duration * 1000).toFixed(2)} tasks/sec`);
  
  console.log('\n配分結果:');
  for (const [projectId, count] of Object.entries(assignments)) {
    const percentage = (count / 1000 * 100).toFixed(1);
    console.log(`  ${projectId}: ${count}タスク (${percentage}%)`);
  }
  
  const metrics = scheduler.getMetrics();
  console.log(`\nフェアネススコア: ${metrics.fairnessScore.toFixed(3)}`);
}

// デモを実行
(async () => {
  try {
    await demonstrateTaskScheduler();
    await loadTestDemo();
    
    console.log('\n✓ デモを完了しました');
  } catch (error) {
    console.error('エラーが発生しました:', error);
    process.exit(1);
  }
})();