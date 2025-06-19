#!/usr/bin/env node

/**
 * タスクキューの永続化テスト
 */

const FileStateManager = require('../src/file-state-manager');
const TaskQueue = require('../src/task-queue');
const path = require('path');

async function test() {
  const stateManager = new FileStateManager(path.join(__dirname, '../state'));
  const taskQueue = new TaskQueue({ maxConcurrent: 2 });
  
  try {
    await stateManager.init();
    
    console.log('1. タスクをキューに追加...');
    
    // テスト用タスクを追加
    taskQueue.enqueue({
      type: 'issue',
      issue: { number: 1001, title: 'Test Issue 1' },
      issueNumber: 1001,
      labels: ['task:misc']
    });
    
    taskQueue.enqueue({
      type: 'issue',
      issue: { number: 1002, title: 'Test Issue 2 (Dogfooding)' },
      issueNumber: 1002,
      labels: ['task:dogfooding']
    });
    
    taskQueue.enqueue({
      type: 'comment',
      issue: { number: 1003, title: 'Test Issue 3' },
      comment: { id: 'comment-1', body: 'Test comment' },
      issueNumber: 1003,
      labels: ['awaiting-response']
    });
    
    const status = taskQueue.getStatus();
    console.log('キューの状態:', status);
    
    console.log('\n2. 保留中タスクを取得...');
    const pendingTasks = taskQueue.getAllPendingTasks();
    console.log(`取得したタスク数: ${pendingTasks.length}`);
    console.log('優先度順:');
    pendingTasks.forEach(task => {
      console.log(`  - Issue #${task.issueNumber} (優先度: ${task.priority})`);
    });
    
    console.log('\n3. タスクを永続化...');
    await stateManager.savePendingTasks(pendingTasks);
    console.log('✅ タスクを保存しました');
    
    console.log('\n4. 新しいキューを作成して復元...');
    const newTaskQueue = new TaskQueue({ maxConcurrent: 2 });
    const loadedTasks = await stateManager.loadPendingTasks();
    console.log(`読み込んだタスク数: ${loadedTasks.length}`);
    
    newTaskQueue.restoreTasks(loadedTasks);
    const newStatus = newTaskQueue.getStatus();
    console.log('復元後のキューの状態:', newStatus);
    
    console.log('\n5. 復元されたタスクの確認...');
    while (newTaskQueue.canExecute() && newTaskQueue.getQueueSize() > 0) {
      const task = newTaskQueue.dequeue();
      console.log(`  - ${task.type}: Issue #${task.issueNumber} (優先度: ${task.priority})`);
    }
    
  } catch (error) {
    console.error('エラー:', error);
  }
}

test();