#!/usr/bin/env node

const FileStateManager = require('../src/file-state-manager');
const fs = require('fs').promises;
const path = require('path');

async function testLockMechanism() {
  console.log('🔧 ロック機構のテストを開始します...\n');

  const stateDir = path.join(__dirname, '../state');
  const stateManager = new FileStateManager(stateDir);

  try {
    // 1. ロック取得テスト
    console.log('1. ロック取得テスト');
    const result1 = await stateManager.acquireProcessLock();
    console.log(`   結果: ${result1 ? '✅ 成功' : '❌ 失敗'}`);

    // ロックファイルの確認
    const lockPath = path.join(stateDir, 'poppo-node.lock');
    try {
      const content = await fs.readFile(lockPath, 'utf8');
      const lockData = JSON.parse(content);
      console.log(`   ロックファイル内容:`, lockData);
    } catch (error) {
      console.log(`   ❌ ロックファイル読み込みエラー:`, error.message);
    }

    // 2. 二重ロック防止テスト
    console.log('\n2. 二重ロック防止テスト');
    const result2 = await stateManager.acquireProcessLock();
    console.log(`   結果: ${result2 ? '❌ 失敗（二重ロックが可能）' : '✅ 成功（二重ロックを防止）'}`);

    // 3. シェルスクリプトロックとの共存テスト
    console.log('\n3. シェルスクリプトロックとの共存テスト');
    const shellLockDir = path.join(stateDir, 'poppo-cron.lock');
    try {
      // シェルスクリプトのロック（ディレクトリ）を作成
      await fs.mkdir(shellLockDir);
      await fs.writeFile(path.join(shellLockDir, 'pid'), process.pid.toString());
      console.log('   ✅ poppo-cron.lockディレクトリを作成');

      // 両方が存在することを確認
      const shellStats = await fs.stat(shellLockDir);
      const nodeStats = await fs.stat(lockPath);
      console.log(`   ✅ 両方のロックが共存可能`);
      console.log(`      - poppo-cron.lock: ${shellStats.isDirectory() ? 'ディレクトリ' : 'ファイル'}`);
      console.log(`      - poppo-node.lock: ${nodeStats.isFile() ? 'ファイル' : 'ディレクトリ'}`);

      // クリーンアップ
      await fs.rm(shellLockDir, { recursive: true });
    } catch (error) {
      console.log(`   ⚠️  テスト中にエラー:`, error.message);
    }

    // 4. ロック解放テスト
    console.log('\n4. ロック解放テスト');
    await stateManager.releaseProcessLock();
    try {
      await fs.access(lockPath);
      console.log('   ❌ ロックファイルが残っています');
    } catch (error) {
      console.log('   ✅ ロックファイルが正常に削除されました');
    }

    console.log('\n✅ すべてのテストが完了しました！');

  } catch (error) {
    console.error('❌ テスト中にエラーが発生しました:', error);
  }
}

// テスト実行
testLockMechanism();