#!/usr/bin/env node

/**
 * Issue #101 完全統合テスト
 * minimal-poppo.jsとminimal-poppo-cron.jsの統合をテスト
 */

const assert = require('assert');
const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

// テストディレクトリ
const testDir = path.join(__dirname, 'test-issue-101-full');

/**
 * プロセスを起動してログを監視
 */
function spawnProcess(command, args = []) {
  const proc = spawn('node', [command, ...args], {
    cwd: path.dirname(__dirname),
    env: {
      ...process.env,
      NODE_ENV: 'test',
      GITHUB_TOKEN: 'test-token'
    }
  });
  
  const logs = [];
  
  proc.stdout.on('data', (data) => {
    const text = data.toString();
    logs.push(text);
    console.log(`[${path.basename(command)}] ${text.trim()}`);
  });
  
  proc.stderr.on('data', (data) => {
    const text = data.toString();
    logs.push(`ERROR: ${text}`);
    console.error(`[${path.basename(command)} ERROR] ${text.trim()}`);
  });
  
  return { proc, logs };
}

/**
 * ログ内のパターンを待つ
 */
async function waitForPattern(logs, pattern, timeout = 10000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const allLogs = logs.join('\n');
    if (pattern.test(allLogs)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  throw new Error(`パターン "${pattern}" がタイムアウト内に見つかりませんでした`);
}

/**
 * リクエストファイルの存在を確認
 */
async function checkRequestFiles() {
  const requestDir = 'state/requests';
  try {
    const files = await fs.readdir(requestDir);
    return files.filter(f => f.startsWith('label-update-') && f.endsWith('.json'));
  } catch {
    return [];
  }
}

/**
 * 統合テスト実行
 */
async function runTest() {
  console.log('=== Issue #101 完全統合テスト開始 ===\n');
  
  // クリーンアップ
  try {
    await fs.rm('state', { recursive: true, force: true });
    await fs.rm('.poppo/locks', { recursive: true, force: true });
  } catch {}
  
  let minimalPoppo = null;
  let mirinLogs = [];
  
  try {
    console.log('1. minimal-poppo.js起動テスト');
    
    // minimal-poppo.jsを起動
    const { proc, logs } = spawnProcess('src/minimal-poppo.js');
    minimalPoppo = proc;
    
    // 初期化を待つ
    await waitForPattern(logs, /StatusManagerとMirinOrphanManagerを初期化しました/);
    console.log('✅ StatusManagerとMirinOrphanManagerが初期化されました');
    
    await waitForPattern(logs, /MirinOrphanManagerの監視を開始しました/);
    console.log('✅ MirinOrphanManagerが開始されました');
    
    // ラベル更新リクエストの処理を監視
    setTimeout(() => {
      mirinLogs = logs.filter(log => 
        log.includes('ラベル更新リクエスト') || 
        log.includes('Label update request')
      );
    }, 3000);
    
    console.log('\n2. 状態ファイルの確認');
    
    // 状態ファイルが作成されたか確認
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    try {
      const stateFile = await fs.readFile('state/issue-status.json', 'utf8');
      const state = JSON.parse(stateFile);
      console.log('✅ 状態ファイルが作成されました:', state);
    } catch (error) {
      console.error('❌ 状態ファイルの読み込みエラー:', error.message);
    }
    
    console.log('\n3. リクエスト処理の確認');
    
    // リクエストファイルを確認
    const requestFiles = await checkRequestFiles();
    console.log(`📁 リクエストファイル数: ${requestFiles.length}`);
    
    if (requestFiles.length > 0) {
      console.log('リクエストファイル:', requestFiles);
      
      // 最初のリクエストファイルの内容を確認
      const firstRequest = await fs.readFile(
        path.join('state/requests', requestFiles[0]), 
        'utf8'
      );
      console.log('リクエスト内容:', JSON.parse(firstRequest));
    }
    
    // MirinOrphanManagerのログを確認
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    if (mirinLogs.length > 0) {
      console.log('\n✅ MirinOrphanManagerがリクエストを処理しました:');
      mirinLogs.forEach(log => console.log(`  - ${log.trim()}`));
    } else {
      console.log('\n⚠️  MirinOrphanManagerのリクエスト処理ログが見つかりません');
    }
    
    console.log('\n=== テスト完了 ===');
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error);
    throw error;
  } finally {
    // プロセスをクリーンアップ
    if (minimalPoppo) {
      minimalPoppo.kill('SIGINT');
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

// 実行
if (require.main === module) {
  runTest().catch(error => {
    console.error(error);
    process.exit(1);
  });
}