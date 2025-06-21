#!/usr/bin/env node

/**
 * State Synchronization Demo
 * プロジェクト間状態同期の動作を確認するためのデモスクリプト
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { StateSynchronizer } = require('../lib/core/state-synchronizer');

async function runDemo() {
  console.log('=== State Synchronizer Demo ===\n');
  
  // デモ用のディレクトリを作成
  const demoDir = path.join(os.tmpdir(), `state-sync-demo-${Date.now()}`);
  const project1Dir = path.join(demoDir, 'project1');
  const project2Dir = path.join(demoDir, 'project2');
  
  await fs.mkdir(project1Dir, { recursive: true });
  await fs.mkdir(project2Dir, { recursive: true });
  
  console.log(`Demo directory: ${demoDir}\n`);
  
  // State Synchronizerを初期化
  const synchronizer = new StateSynchronizer({
    globalStateDir: path.join(demoDir, 'global-state'),
    syncInterval: 2000, // 2秒ごとに同期
    enableAutoSync: true
  });
  
  // イベントリスナーを設定
  synchronizer.on('initialized', () => {
    console.log('✅ State Synchronizer initialized');
  });
  
  synchronizer.on('project-registered', ({ projectId }) => {
    console.log(`✅ Project registered: ${projectId}`);
  });
  
  synchronizer.on('state-changed', ({ type, key, value }) => {
    console.log(`📝 State changed: [${type}] ${key} = ${JSON.stringify(value.value)}`);
  });
  
  synchronizer.on('project-synced', ({ projectId }) => {
    console.log(`🔄 Project synced: ${projectId}`);
  });
  
  try {
    // 初期化
    await synchronizer.initialize();
    
    // プロジェクトを登録
    console.log('\n--- Registering Projects ---');
    await synchronizer.registerProject('project1', project1Dir);
    await synchronizer.registerProject('project2', project2Dir);
    
    // グローバル状態を設定
    console.log('\n--- Setting Global State ---');
    await synchronizer.setGlobalState('shared-config', {
      apiUrl: 'https://api.example.com',
      timeout: 5000
    });
    
    await synchronizer.setGlobalState('project:project1:config', {
      name: 'Project One',
      version: '1.0.0'
    });
    
    // プロジェクト固有の状態を設定
    console.log('\n--- Setting Local State ---');
    await synchronizer.setLocalState('project1', 'tasks', [
      { id: 1, name: 'Task 1', status: 'pending' },
      { id: 2, name: 'Task 2', status: 'completed' }
    ]);
    
    await synchronizer.setLocalState('project2', 'settings', {
      theme: 'dark',
      language: 'ja'
    });
    
    // 手動同期を実行
    console.log('\n--- Manual Sync ---');
    await synchronizer.syncAll();
    
    // 同期結果を確認
    console.log('\n--- Checking Sync Results ---');
    
    // Project1がグローバル設定を取得できるか確認
    const project1Config = await synchronizer.getLocalState('project1', 'config');
    console.log(`Project1 config (synced from global): ${JSON.stringify(project1Config)}`);
    
    // Project1のタスクがグローバルに同期されているか確認
    const globalTasks = await synchronizer.getGlobalState('project:project1:tasks');
    console.log(`Global tasks (synced from project1): ${JSON.stringify(globalTasks?.value)}`);
    
    // 競合解決のテスト
    console.log('\n--- Testing Conflict Resolution ---');
    
    // グローバルとローカルで異なる値を設定
    await synchronizer.setGlobalState('project:project1:shared-data', {
      value: 'global-version',
      timestamp: Date.now()
    });
    
    await synchronizer.setLocalState('project1', 'shared-data', {
      value: 'local-version',
      timestamp: Date.now() + 1000 // より新しい
    });
    
    // 同期を実行
    await synchronizer.syncProject('project1');
    
    // 結果を確認（より新しいローカル版が採用されるはず）
    const resolvedGlobal = await synchronizer.getGlobalState('project:project1:shared-data');
    console.log(`Resolved value: ${JSON.stringify(resolvedGlobal?.value)}`);
    
    // ロック機能のテスト
    console.log('\n--- Testing Lock Management ---');
    
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(
        synchronizer.setGlobalState('concurrent-test', `value-${i}`)
          .then(() => console.log(`  Concurrent write ${i} completed`))
      );
    }
    
    await Promise.all(promises);
    
    const finalValue = await synchronizer.getGlobalState('concurrent-test');
    console.log(`Final concurrent value: ${JSON.stringify(finalValue?.value)}`);
    
    // 自動同期の動作確認
    console.log('\n--- Auto-sync in action (wait 5 seconds) ---');
    
    // Project2に新しい状態を追加
    await synchronizer.setLocalState('project2', 'new-data', {
      message: 'This will be auto-synced',
      createdAt: new Date().toISOString()
    });
    
    // 自動同期を待つ
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // グローバルに同期されているか確認
    const autoSyncedData = await synchronizer.getGlobalState('project:project2:new-data');
    console.log(`Auto-synced data: ${JSON.stringify(autoSyncedData?.value)}`);
    
    // 統計情報を表示
    console.log('\n--- Final State ---');
    console.log('Global state keys:', Array.from(synchronizer.globalState.keys()));
    console.log('Registered projects:', Array.from(synchronizer.localStates.keys()));
    
  } catch (error) {
    console.error('Demo error:', error);
  } finally {
    // クリーンアップ
    console.log('\n--- Cleanup ---');
    await synchronizer.cleanup();
    
    // デモディレクトリを削除
    try {
      await fs.rm(demoDir, { recursive: true, force: true });
      console.log('✅ Demo directory cleaned up');
    } catch (error) {
      console.log('⚠️  Failed to clean up demo directory:', error.message);
    }
  }
}

// デモを実行
if (require.main === module) {
  runDemo().catch(console.error);
}

module.exports = { runDemo };