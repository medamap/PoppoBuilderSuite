#!/usr/bin/env node

/**
 * IndependentProcessManagerとFileStateManagerの統合テスト
 */

const fs = require('fs');
const path = require('path');
const FileStateManager = require('../src/file-state-manager');
const IndependentProcessManager = require('../src/independent-process-manager');
const EnhancedRateLimiter = require('../src/enhanced-rate-limiter');
const Logger = require('../src/logger');

// テスト用の設定
const config = {
  maxConcurrent: 3,
  timeout: 30000
};

// テスト用のrate limiter
const rateLimiter = {
  isRateLimited: async () => ({ limited: false })
};

// テスト用のlogger
const logger = new Logger(path.join(__dirname, '../logs'));

async function testStateIntegration() {
  console.log('=== IndependentProcessManagerとFileStateManagerの統合テスト開始 ===\n');
  
  // 1. 初期化テスト
  console.log('1. 初期化テスト');
  const stateManager = new FileStateManager();
  await stateManager.init();
  console.log('✅ FileStateManager初期化完了');
  
  const processManager = new IndependentProcessManager(config, rateLimiter, logger, stateManager);
  console.log('✅ IndependentProcessManager初期化完了（FileStateManager連携）');
  
  // 2. タスク追加テスト
  console.log('\n2. タスク追加テスト');
  const testTaskId = 'test-task-' + Date.now();
  const testTaskInfo = {
    issueNumber: 999,
    title: 'テストタスク',
    startTime: new Date().toISOString(),
    pid: process.pid,
    type: 'test'
  };
  
  await processManager.addRunningTask(testTaskId, testTaskInfo);
  console.log('✅ タスク追加完了');
  
  // 3. タスク取得テスト
  console.log('\n3. タスク取得テスト');
  const runningTasks = await processManager.getRunningTasks();
  console.log('実行中タスク:', JSON.stringify(runningTasks, null, 2));
  
  if (runningTasks[testTaskId]) {
    console.log('✅ タスクが正しく保存されている');
  } else {
    console.error('❌ タスクが見つかりません');
  }
  
  // 4. FileStateManager経由での確認
  console.log('\n4. FileStateManager経由での確認');
  const directTasks = await stateManager.loadRunningTasks();
  console.log('FileStateManagerから取得:', JSON.stringify(directTasks, null, 2));
  
  if (directTasks[testTaskId]) {
    console.log('✅ FileStateManagerからも正しく取得できる');
  } else {
    console.error('❌ FileStateManagerから取得できません');
  }
  
  // 5. ファイルパスの確認
  console.log('\n5. ファイルパスの確認');
  const stateFilePath = path.join(__dirname, '../state/running-tasks.json');
  const logsFilePath = path.join(__dirname, '../logs/running-tasks.json');
  
  console.log(`state/running-tasks.json 存在: ${fs.existsSync(stateFilePath)}`);
  console.log(`logs/running-tasks.json 存在: ${fs.existsSync(logsFilePath)}`);
  
  // 6. タスク削除テスト
  console.log('\n6. タスク削除テスト');
  await processManager.removeTask(testTaskId);
  const tasksAfterRemove = await processManager.getRunningTasks();
  
  if (!tasksAfterRemove[testTaskId]) {
    console.log('✅ タスクが正しく削除された');
  } else {
    console.error('❌ タスクが削除されていません');
  }
  
  // 7. マイグレーションテスト
  console.log('\n7. マイグレーションテスト');
  
  // 古いファイルを作成
  const oldTasksFile = path.join(__dirname, '../logs/running-tasks.json');
  const oldTasks = {
    'old-task-1': {
      issueNumber: 1,
      title: '古いタスク1',
      startTime: '2025-01-01T00:00:00Z',
      pid: 12345
    }
  };
  
  // 一時的に古いファイルを作成
  if (!fs.existsSync(path.dirname(oldTasksFile))) {
    fs.mkdirSync(path.dirname(oldTasksFile), { recursive: true });
  }
  fs.writeFileSync(oldTasksFile, JSON.stringify(oldTasks, null, 2));
  console.log('✅ 古いrunning-tasks.jsonを作成');
  
  // minimal-poppo-cron.jsのmigrateRunningTasks関数をシミュレート
  const { migrateRunningTasksSimulation } = require('./migrate-simulation');
  await migrateRunningTasksSimulation(stateManager);
  
  console.log('\n=== テスト完了 ===');
}

// マイグレーション関数のシミュレーション
async function migrateRunningTasksSimulation(stateManager) {
  const oldPath = path.join(__dirname, '../logs/running-tasks.json');
  const newPath = path.join(__dirname, '../state/running-tasks.json');
  
  try {
    if (fs.existsSync(oldPath)) {
      const oldData = fs.readFileSync(oldPath, 'utf8');
      const tasks = JSON.parse(oldData);
      
      console.log('📦 マイグレーションシミュレーション開始...');
      await stateManager.saveRunningTasks(tasks);
      console.log('✅ マイグレーション完了');
      
      // バックアップ作成
      const backupPath = oldPath + '.test-backup';
      fs.renameSync(oldPath, backupPath);
      console.log(`📁 古いファイルを ${path.basename(backupPath)} として保存`);
      
      // 新しいファイルから読み込んで確認
      const migratedTasks = await stateManager.loadRunningTasks();
      console.log('マイグレートされたタスク:', JSON.stringify(migratedTasks, null, 2));
      
      // クリーンアップ
      fs.unlinkSync(backupPath);
    }
  } catch (error) {
    console.error('マイグレーションエラー:', error.message);
  }
}

// エクスポート
module.exports = { migrateRunningTasksSimulation };

// 直接実行された場合
if (require.main === module) {
  testStateIntegration().catch(console.error);
}