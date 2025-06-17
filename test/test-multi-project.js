#!/usr/bin/env node

/**
 * マルチプロジェクト機能のテストスクリプト
 */

const GlobalQueueManager = require('../src/global-queue-manager');
const ProjectManager = require('../src/project-manager');
const path = require('path');
const fs = require('fs').promises;

async function runTests() {
  console.log('🧪 マルチプロジェクト機能のテストを開始します...\n');
  
  let globalQueue;
  let projectManager;
  
  try {
    // 1. グローバルキューマネージャーのテスト
    console.log('1️⃣ グローバルキューマネージャーのテスト');
    
    globalQueue = new GlobalQueueManager({
      dataDir: path.join(__dirname, '../.test-data'),
      maxQueueSize: 100
    });
    
    await globalQueue.initialize();
    console.log('✅ グローバルキューマネージャーを初期化しました');
    
    // 2. プロジェクト登録のテスト
    console.log('\n2️⃣ プロジェクト登録のテスト');
    
    const testProject1 = {
      id: 'test-project-1',
      name: 'Test Project 1',
      path: path.join(__dirname, '../'),
      priority: 80
    };
    
    const testProject2 = {
      id: 'test-project-2',
      name: 'Test Project 2',
      path: path.join(__dirname, '../'),
      priority: 50
    };
    
    await globalQueue.registerProject(testProject1);
    console.log('✅ プロジェクト1を登録しました');
    
    await globalQueue.registerProject(testProject2);
    console.log('✅ プロジェクト2を登録しました');
    
    // 3. タスクエンキューのテスト
    console.log('\n3️⃣ タスクエンキューのテスト');
    
    const task1 = await globalQueue.enqueueTask({
      projectId: 'test-project-1',
      issueNumber: 101,
      priority: 90,
      metadata: { title: '高優先度タスク' }
    });
    console.log('✅ タスク1をエンキューしました（優先度: 90）');
    
    const task2 = await globalQueue.enqueueTask({
      projectId: 'test-project-2',
      issueNumber: 201,
      priority: 40,
      metadata: { title: '低優先度タスク' }
    });
    console.log('✅ タスク2をエンキューしました（優先度: 40）');
    
    const task3 = await globalQueue.enqueueTask({
      projectId: 'test-project-1',
      issueNumber: 102,
      priority: 70,
      metadata: { title: '中優先度タスク' }
    });
    console.log('✅ タスク3をエンキューしました（優先度: 70）');
    
    // 4. 優先度順序のテスト
    console.log('\n4️⃣ 優先度順序のテスト');
    
    const queueStatus = globalQueue.getQueueStatus();
    console.log('キューサイズ:', queueStatus.queueSize);
    console.log('キュー順序:');
    globalQueue.queue.forEach((task, index) => {
      console.log(`  ${index + 1}. ${task.projectId} - Issue #${task.issueNumber} (優先度: ${task.effectivePriority})`);
    });
    
    // 5. タスク取得のテスト
    console.log('\n5️⃣ タスク取得のテスト');
    
    const nextTask1 = await globalQueue.getNextTask('test-project-1');
    console.log(`✅ プロジェクト1の次のタスク: Issue #${nextTask1.issueNumber}`);
    
    const nextTask2 = await globalQueue.getNextTask('test-project-2');
    console.log(`✅ プロジェクト2の次のタスク: Issue #${nextTask2.issueNumber}`);
    
    // 6. タスク完了のテスト
    console.log('\n6️⃣ タスク完了のテスト');
    
    await globalQueue.completeTask(nextTask1.id, { executionTime: 1000 });
    console.log('✅ タスク1を完了しました');
    
    // 7. プロジェクトマネージャーのテスト
    console.log('\n7️⃣ プロジェクトマネージャーのテスト');
    
    projectManager = new ProjectManager(globalQueue);
    
    const projectStatus = await projectManager.getAllProjectsStatus();
    console.log('✅ プロジェクトステータスを取得しました:');
    projectStatus.forEach(project => {
      console.log(`  - ${project.name}: 健全性 ${project.health}, 統計 ${JSON.stringify(project.statistics)}`);
    });
    
    // 8. プロジェクト優先度更新のテスト
    console.log('\n8️⃣ プロジェクト優先度更新のテスト');
    
    await projectManager.updateProjectPriority('test-project-2', 90);
    console.log('✅ プロジェクト2の優先度を90に更新しました');
    
    // 9. リソース使用状況のテスト
    console.log('\n9️⃣ リソース使用状況のテスト');
    
    const resourceUsage = await projectManager.getProjectResourceUsage('test-project-1');
    console.log('✅ プロジェクト1のリソース使用状況:');
    console.log(`  - 実行中タスク: ${resourceUsage.runningTasks}`);
    console.log(`  - キュー内タスク: ${resourceUsage.queuedTasks}`);
    console.log(`  - 使用率: ${Math.round(resourceUsage.utilizationRate * 100)}%`);
    
    // 10. 統計情報のテスト
    console.log('\n🔟 統計情報のテスト');
    
    const stats = globalQueue.getQueueStatus();
    console.log('✅ システム統計:');
    console.log(`  - 総エンキュー数: ${stats.statistics.totalEnqueued}`);
    console.log(`  - 総処理数: ${stats.statistics.totalProcessed}`);
    console.log(`  - 総失敗数: ${stats.statistics.totalFailed}`);
    
    console.log('\n✨ すべてのテストが完了しました！');
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error);
    throw error;
  } finally {
    // クリーンアップ
    if (globalQueue) {
      await globalQueue.stop();
    }
    
    // テストデータの削除
    try {
      await fs.rm(path.join(__dirname, '../.test-data'), { recursive: true });
    } catch (error) {
      // エラーは無視
    }
  }
}

// テスト実行
if (require.main === module) {
  runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { runTests };