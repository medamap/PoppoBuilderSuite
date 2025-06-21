#!/usr/bin/env node

/**
 * 簡単な統合テスト
 */

const fs = require('fs');
const path = require('path');

async function testIntegration() {
  console.log('=== 統合テスト開始 ===\n');
  
  // 1. logs/running-tasks.jsonが存在するかチェック
  const logsPath = path.join(__dirname, '../logs/running-tasks.json');
  const statePath = path.join(__dirname, '../state/running-tasks.json');
  
  console.log('1. ファイル存在チェック');
  console.log(`  logs/running-tasks.json: ${fs.existsSync(logsPath)}`);
  console.log(`  state/running-tasks.json: ${fs.existsSync(statePath)}`);
  
  // 2. テスト用のlogs/running-tasks.jsonを作成
  if (!fs.existsSync(logsPath)) {
    console.log('\n2. テスト用のlogs/running-tasks.jsonを作成');
    const testData = {
      'test-task-1': {
        issueNumber: 100,
        title: 'テストタスク',
        startTime: new Date().toISOString(),
        pid: 12345
      }
    };
    
    if (!fs.existsSync(path.dirname(logsPath))) {
      fs.mkdirSync(path.dirname(logsPath), { recursive: true });
    }
    
    fs.writeFileSync(logsPath, JSON.stringify(testData, null, 2));
    console.log('  ✅ テストファイル作成完了');
  }
  
  // 3. IndependentProcessManagerの新しい実装をテスト
  console.log('\n3. IndependentProcessManagerの動作確認');
  
  // FileStateManagerのみテスト
  const FileStateManager = require('../src/file-state-manager');
  const stateManager = new FileStateManager();
  
  try {
    await stateManager.init();
    console.log('  ✅ FileStateManager初期化成功');
    
    // タスクを保存
    const testTasks = {
      'integration-test-1': {
        issueNumber: 101,
        title: '統合テストタスク',
        startTime: new Date().toISOString(),
        pid: process.pid
      }
    };
    
    await stateManager.saveRunningTasks(testTasks);
    console.log('  ✅ タスク保存成功');
    
    // タスクを読み込み
    const loadedTasks = await stateManager.loadRunningTasks();
    console.log('  ✅ タスク読み込み成功:', Object.keys(loadedTasks));
    
  } catch (error) {
    console.error('  ❌ エラー:', error.message);
  }
  
  console.log('\n=== テスト完了 ===');
}

// 実行
testIntegration().catch(console.error);