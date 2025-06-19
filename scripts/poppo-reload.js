#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * PoppoBuilder設定再読み込みコマンド
 * 
 * 使用方法:
 *   poppo reload                 - 設定を再読み込み（SIGHUP送信）
 *   poppo reload --check         - 設定の検証のみ実行
 *   poppo reload --diff          - 現在の設定との差分を表示
 */

const args = process.argv.slice(2);
const command = args[0];
const options = args.slice(1);

// フラグの解析
const checkOnly = options.includes('--check');
const showDiff = options.includes('--diff');

/**
 * PoppoBuilderプロセスを検索
 */
function findPoppoProcess() {
  return new Promise((resolve, reject) => {
    exec('ps aux | grep -E "PoppoBuilder|minimal-poppo" | grep -v grep', (error, stdout) => {
      if (error) {
        resolve(null);
        return;
      }
      
      const lines = stdout.trim().split('\n').filter(line => line);
      for (const line of lines) {
        const parts = line.split(/\s+/);
        const pid = parts[1];
        const command = parts.slice(10).join(' ');
        
        if (command.includes('minimal-poppo') || command.includes('PoppoBuilder')) {
          resolve({ pid, command });
          return;
        }
      }
      
      resolve(null);
    });
  });
}

/**
 * 設定ファイルの検証
 */
function validateConfig() {
  console.log('🔍 設定ファイルを検証中...\n');
  
  const ConfigLoader = require('../src/config-loader');
  const configLoader = new ConfigLoader();
  
  try {
    const config = configLoader.loadConfig();
    const validation = configLoader.validateConfig(config);
    
    if (validation.valid) {
      console.log('✅ 設定ファイルは有効です');
      
      // 設定階層の表示
      console.log('\n設定階層:');
      configLoader.displayConfigHierarchy();
      
      return true;
    } else {
      console.error('❌ 設定ファイルにエラーがあります:');
      validation.errors.forEach(error => {
        console.error(`  - ${error}`);
      });
      return false;
    }
  } catch (error) {
    console.error('❌ 設定ファイルの読み込みエラー:', error.message);
    return false;
  }
}

/**
 * 設定の差分表示
 */
async function showConfigDiff() {
  console.log('📊 設定の差分を計算中...\n');
  
  const ConfigLoader = require('../src/config-loader');
  const configLoader = new ConfigLoader();
  const ConfigWatcher = require('../src/config-watcher');
  const configWatcher = new ConfigWatcher();
  
  try {
    // 現在の設定を取得（実行中のプロセスから取得できればベスト）
    const currentConfig = require('../config/config.json');
    const newConfig = configLoader.loadConfig();
    
    // 変更点の検出
    const changes = configWatcher._detectChanges(currentConfig, newConfig);
    
    if (changes.length === 0) {
      console.log('✅ 設定に変更はありません');
      return;
    }
    
    // 変更の分類
    const { hotReloadable, restartRequired, partialReloadable } = 
      configWatcher._classifyChanges(changes);
    
    // 変更点の表示
    console.log(`📝 検出された変更点: ${changes.length}件\n`);
    
    if (hotReloadable.length > 0) {
      console.log('🔄 即座に反映可能な変更:');
      hotReloadable.forEach(change => {
        console.log(`  ${change.path}:`);
        console.log(`    旧: ${JSON.stringify(change.oldValue)}`);
        console.log(`    新: ${JSON.stringify(change.newValue)}`);
      });
      console.log('');
    }
    
    if (restartRequired.length > 0) {
      console.log('⚠️  再起動が必要な変更:');
      restartRequired.forEach(change => {
        console.log(`  ${change.path}:`);
        console.log(`    旧: ${JSON.stringify(change.oldValue)}`);
        console.log(`    新: ${JSON.stringify(change.newValue)}`);
      });
      console.log('');
    }
    
    if (partialReloadable.length > 0) {
      console.log('🔧 部分的な再起動で対応可能な変更:');
      partialReloadable.forEach(change => {
        console.log(`  ${change.path}:`);
        console.log(`    旧: ${JSON.stringify(change.oldValue)}`);
        console.log(`    新: ${JSON.stringify(change.newValue)}`);
      });
      console.log('');
    }
    
  } catch (error) {
    console.error('❌ 差分の計算エラー:', error.message);
  } finally {
    configWatcher.stop();
  }
}

/**
 * 設定再読み込みの実行
 */
async function reloadConfig() {
  // まず設定を検証
  if (!validateConfig()) {
    console.error('\n⚠️  設定ファイルにエラーがあるため、再読み込みを中止します');
    process.exit(1);
  }
  
  // PoppoBuilderプロセスを検索
  const processInfo = await findPoppoProcess();
  
  if (!processInfo) {
    console.error('❌ PoppoBuilderプロセスが見つかりません');
    console.log('💡 PoppoBuilderが起動していることを確認してください');
    process.exit(1);
  }
  
  console.log(`\n🎯 PoppoBuilderプロセスを検出: PID=${processInfo.pid}`);
  console.log(`   ${processInfo.command}\n`);
  
  // SIGHUPシグナルを送信
  try {
    process.kill(processInfo.pid, 'SIGHUP');
    console.log('✅ 設定再読み込みシグナル(SIGHUP)を送信しました');
    console.log('📋 PoppoBuilderのログを確認して、再読み込みの結果を確認してください');
    
    // ログファイルのパスを表示
    const logPath = path.join(__dirname, '..', 'logs', `poppo-${new Date().toISOString().split('T')[0]}.log`);
    console.log(`\nログファイル: ${logPath}`);
    console.log('コマンド例: tail -f ' + logPath);
    
  } catch (error) {
    console.error('❌ シグナルの送信に失敗しました:', error.message);
    if (error.code === 'EPERM') {
      console.log('💡 権限が不足しています。sudoで実行してみてください');
    }
    process.exit(1);
  }
}

/**
 * メイン処理
 */
async function main() {
  console.log('🔄 PoppoBuilder 設定再読み込みツール\n');
  
  if (checkOnly) {
    // 検証のみ
    const isValid = validateConfig();
    process.exit(isValid ? 0 : 1);
  } else if (showDiff) {
    // 差分表示
    await showConfigDiff();
  } else {
    // 設定再読み込み
    await reloadConfig();
  }
}

// 実行
main().catch(error => {
  console.error('エラー:', error);
  process.exit(1);
});