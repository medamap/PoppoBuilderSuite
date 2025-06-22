#!/usr/bin/env node

/**
 * プロセスロックの簡単なテスト
 */

const FileStateManager = require('../src/file-state-manager');
const path = require('path');

async function test() {
  const stateManager = new FileStateManager(path.join(__dirname, '../state'));
  
  try {
    await stateManager.init();
    
    console.log('1. 最初のロック取得試行...');
    const lock1 = await stateManager.acquireProcessLock();
    console.log('ロック取得結果:', lock1 ? '✅ 成功' : '❌ 失敗');
    
    console.log('\n2. 2番目のロック取得試行（ブロックされるはず）...');
    const lock2 = await stateManager.acquireProcessLock();
    console.log('ロック取得結果:', lock2 ? '❌ 成功（予期しない）' : '✅ 失敗（予期通り）');
    
    console.log('\n3. ロックを解放...');
    await stateManager.releaseProcessLock();
    console.log('✅ ロック解放完了');
    
    console.log('\n4. 再度ロック取得試行（成功するはず）...');
    const lock3 = await stateManager.acquireProcessLock();
    console.log('ロック取得結果:', lock3 ? '✅ 成功' : '❌ 失敗');
    
    if (lock3) {
      await stateManager.releaseProcessLock();
    }
    
  } catch (error) {
    console.error('エラー:', error);
  }
}

test();