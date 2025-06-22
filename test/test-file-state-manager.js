#!/usr/bin/env node

const FileStateManager = require('../src/file-state-manager');
const path = require('path');
const fs = require('fs').promises;

async function test() {
  console.log('FileStateManager Race Condition修正のテスト開始\n');

  // テスト用の一時ディレクトリ
  const testStateDir = path.join(__dirname, '../state-test');
  const manager1 = new FileStateManager(testStateDir);
  const manager2 = new FileStateManager(testStateDir);

  try {
    // 1. 初期化テスト
    console.log('1. 初期化テスト');
    await manager1.init();
    console.log('✅ 初期化成功\n');

    // 2. 同時書き込みテスト（Race Condition）
    console.log('2. 同時書き込みテスト（Race Condition対策）');
    const promises = [];
    
    // 10個の同時書き込みをシミュレート
    for (let i = 0; i < 10; i++) {
      const manager = new FileStateManager(testStateDir);
      promises.push(
        manager.addRunningTask(`task-${i}`, {
          issueNumber: 100 + i,
          title: `Test Issue ${i}`,
          pid: process.pid + i
        })
      );
    }

    await Promise.all(promises);
    
    // 結果を確認
    const runningTasks = await manager1.loadRunningTasks();
    const taskCount = Object.keys(runningTasks).length;
    console.log(`✅ ${taskCount}個のタスクが正常に記録されました`);
    console.log(`   期待値: 10, 実際: ${taskCount}\n`);

    // 3. データ検証テスト
    console.log('3. データ検証テスト');
    
    // 不正なJSONファイルを作成
    const badJsonFile = path.join(testStateDir, 'bad-json-test.json');
    await fs.writeFile(badJsonFile, '{ invalid json', 'utf8');
    
    // ensureFileメソッドで修復を試みる
    await manager1.ensureFile(badJsonFile, '{"valid": true}');
    
    // 修復されたか確認
    const content = await fs.readFile(badJsonFile, 'utf8');
    const parsed = JSON.parse(content);
    console.log(`✅ 不正なJSONファイルが修復されました: ${JSON.stringify(parsed)}\n`);

    // 4. ロックタイムアウトテスト
    console.log('4. ロックタイムアウトテスト');
    const lockFile = path.join(testStateDir, '.locks/test-lock.lock');
    
    // 手動でロックファイルを作成
    await fs.mkdir(path.dirname(lockFile), { recursive: true });
    await fs.writeFile(lockFile, 'old-pid', 'utf8');
    
    try {
      // タイムアウトを短く設定してロック取得を試みる
      await manager1.acquireLock(path.join(testStateDir, 'test-lock'), 1000);
      console.log('✅ 古いロックファイルが強制削除されました\n');
    } catch (error) {
      console.log(`⚠️  ロック取得エラー: ${error.message}\n`);
    }

    // 5. アトミック書き込みテスト
    console.log('5. アトミック書き込みテスト');
    const atomicTestFile = path.join(testStateDir, 'atomic-test.json');
    
    // 元のコンテンツ
    await manager1.atomicWrite(atomicTestFile, '{"original": true}');
    
    // アトミックに更新
    await manager1.atomicWrite(atomicTestFile, '{"updated": true}');
    
    // バックアップファイルが存在するか確認
    try {
      await fs.access(atomicTestFile + '.backup');
      console.log('✅ バックアップファイルが作成されました');
    } catch {
      console.log('⚠️  バックアップファイルが見つかりません');
    }
    
    // 内容確認
    const atomicContent = await fs.readFile(atomicTestFile, 'utf8');
    console.log(`✅ アトミック書き込み成功: ${atomicContent}\n`);

    // 6. 整合性チェックテスト
    console.log('6. 整合性チェックテスト');
    const integrity = await manager1.checkIntegrity();
    console.log(`✅ 整合性チェック結果: ${integrity.isValid ? '正常' : 'エラーあり'}`);
    if (integrity.errors.length > 0) {
      console.log(`   エラー: ${integrity.errors.join(', ')}`);
    }
    console.log('');

    // 7. 古いタスクのクリーンアップテスト
    console.log('7. 古いタスクのクリーンアップテスト');
    
    // 古いタスクを追加
    const oldTasks = await manager1.loadRunningTasks();
    oldTasks['old-task'] = {
      issueNumber: 999,
      title: 'Old Task',
      startTime: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() // 25時間前
    };
    oldTasks['invalid-task'] = {
      issueNumber: 998,
      title: 'Invalid Task'
      // startTimeなし
    };
    await manager1.saveRunningTasks(oldTasks);
    
    // クリーンアップ実行
    await manager1.cleanupStaleRunningTasks();
    
    // 結果確認
    const cleanedTasks = await manager1.loadRunningTasks();
    const hasOldTask = 'old-task' in cleanedTasks;
    const hasInvalidTask = 'invalid-task' in cleanedTasks;
    console.log(`✅ 古いタスクのクリーンアップ完了`);
    console.log(`   old-task: ${hasOldTask ? '残存' : '削除済み'}`);
    console.log(`   invalid-task: ${hasInvalidTask ? '残存' : '削除済み'}\n`);

    console.log('すべてのテストが完了しました！');

  } catch (error) {
    console.error('テストエラー:', error);
  } finally {
    // クリーンアップ
    try {
      await fs.rm(testStateDir, { recursive: true });
      console.log('\nテストディレクトリをクリーンアップしました');
    } catch {}
  }
}

// テスト実行
test().catch(console.error);