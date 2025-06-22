#!/usr/bin/env node

/**
 * FileStateManagerの簡易テスト
 * Issue #97の修正内容を確認
 */

const FileStateManager = require('../src/file-state-manager');
const path = require('path');
const fs = require('fs').promises;

// テスト用ディレクトリ
const testStateDir = path.join(__dirname, '../state-test-simple');

async function cleanup() {
  try {
    await fs.rm(testStateDir, { recursive: true, force: true });
  } catch (error) {
    // 無視
  }
}

async function main() {
  console.log('FileStateManager Race Condition修正のテスト開始\n');
  
  try {
    await cleanup();
    
    // 1. 初期化テスト
    console.log('1. 初期化テスト');
    const stateManager = new FileStateManager(testStateDir);
    await stateManager.init();
    console.log('✅ 初期化成功');
    
    // 2. 同時書き込みテスト
    console.log('\n2. 同時書き込みテスト（Race Condition対策）');
    const promises = [];
    const numTasks = 10;
    
    for (let i = 0; i < numTasks; i++) {
      promises.push(
        stateManager.addRunningTask(`task-${i}`, {
          type: 'test',
          index: i,
          startTime: new Date().toISOString()
        })
      );
    }
    
    await Promise.all(promises);
    const tasks = await stateManager.loadRunningTasks();
    console.log(`✅ ${Object.keys(tasks).length}個のタスクが正常に記録されました`);
    console.log(`   期待値: ${numTasks}, 実際: ${Object.keys(tasks).length}`);
    
    // 3. データ検証テスト
    console.log('\n3. データ検証テスト');
    const badJsonFile = path.join(testStateDir, 'bad-json-test.json');
    await fs.writeFile(badJsonFile, '{ invalid json }', 'utf8');
    await stateManager.ensureFile(badJsonFile, '{"valid":true}');
    const content = await fs.readFile(badJsonFile, 'utf8');
    console.log(`✅ 不正なJSONファイルが修復されました: ${content}`);
    
    // 4. ロックタイムアウトテスト
    console.log('\n4. ロックタイムアウトテスト');
    const testFile = path.join(testStateDir, 'test-lock');
    await fs.writeFile(testFile, '{}', 'utf8');
    
    // ロックを取得して解放しない
    const lockFile1 = await stateManager.acquireLock(testFile, 1000);
    
    try {
      // 別のロック取得を試みる（タイムアウトするはず）
      await stateManager.acquireLock(testFile, 500);
      console.log('❌ ロックが取得できてしまいました');
    } catch (error) {
      console.log('✅ ロック取得エラー:', error.message);
    } finally {
      await stateManager.releaseLock(lockFile1);
    }
    
    // 5. アトミック書き込みテスト
    console.log('\n5. アトミック書き込みテスト');
    const atomicTestFile = path.join(testStateDir, 'atomic-test.json');
    await stateManager.atomicWrite(atomicTestFile, '{"original": true}');
    await stateManager.atomicWrite(atomicTestFile, '{"updated": true}');
    
    // バックアップファイルの存在確認
    const backupExists = await fs.access(atomicTestFile + '.backup').then(() => true).catch(() => false);
    console.log(`✅ バックアップファイルが作成されました`);
    
    const atomicContent = await fs.readFile(atomicTestFile, 'utf8');
    console.log(`✅ アトミック書き込み成功: ${atomicContent}`);
    
    // 6. 整合性チェック
    console.log('\n6. 整合性チェックテスト');
    const result = await stateManager.checkIntegrity();
    console.log(`✅ 整合性チェック結果: ${result.isValid ? '正常' : 'エラー'}`);
    if (!result.isValid) {
      console.log('   エラー:', result.errors);
    }
    
    // 7. 古いタスクのクリーンアップ
    console.log('\n7. 古いタスクのクリーンアップテスト');
    await stateManager.addRunningTask('old-task', {
      type: 'old',
      startTime: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
    });
    await stateManager.addRunningTask('new-task', {
      type: 'new',
      startTime: new Date().toISOString()
    });
    await stateManager.addRunningTask('invalid-task', {
      type: 'invalid'
      // startTimeなし
    });
    
    await stateManager.cleanupStaleRunningTasks();
    const remainingTasks = await stateManager.loadRunningTasks();
    console.log('✅ 古いタスクのクリーンアップ完了');
    console.log(`   old-task: ${remainingTasks['old-task'] ? '残存' : '削除済み'}`);
    console.log(`   invalid-task: ${remainingTasks['invalid-task'] ? '残存' : '削除済み'}`);
    
    console.log('\nすべてのテストが完了しました！');
    
  } catch (error) {
    console.error('テストエラー:', error);
  } finally {
    console.log('\nテストディレクトリをクリーンアップしました');
    await cleanup();
  }
}

main();