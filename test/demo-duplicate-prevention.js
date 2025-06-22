#!/usr/bin/env node

/**
 * 重複処理抑制機能のデモンストレーション
 * Issue #72: 重複処理抑制機能の検証と文書化
 * 
 * このスクリプトは、Issue #70で実装された重複処理抑制機能が
 * どのように動作するかを実証します。
 */

const fs = require('fs');
const path = require('path');

console.log('🎯 PoppoBuilder重複処理抑制機能のデモンストレーション');
console.log('====================================================\n');

// グローバル変数（実際のPoppoBuilderの状態を模擬）
const processedIssues = new Set();

// shouldProcessIssue関数の実装（src/minimal-poppo.jsから）
function shouldProcessIssue(issue) {
  console.log(`\n📋 Issue #${issue.number}: "${issue.title}"`);
  
  // すでに処理済み（メモリ内Set）
  if (processedIssues.has(issue.number)) {
    console.log('   ❌ スキップ: メモリ内Setに記録済み（同一プロセス内での重複防止）');
    return false;
  }
  
  // ラベル取得
  const labels = issue.labels.map(l => l.name);
  console.log(`   📌 ラベル: [${labels.join(', ')}]`);
  
  // completed, processing, awaiting-responseラベルがあればスキップ
  if (labels.includes('completed') || labels.includes('processing') || labels.includes('awaiting-response')) {
    console.log(`   ❌ スキップ: ${
      labels.includes('processing') ? 'processing（処理中）' :
      labels.includes('completed') ? 'completed（完了）' :
      'awaiting-response（応答待ち）'
    }ラベルが付いています`);
    return false;
  }
  
  // task:*ラベルチェック
  const taskLabels = ['task:misc', 'task:dogfooding', 'task:quality', 'task:docs', 'task:feature'];
  if (!labels.some(label => taskLabels.includes(label))) {
    console.log('   ❌ スキップ: task:*ラベルがありません');
    return false;
  }
  
  console.log('   ✅ 処理対象です');
  return true;
}

// 処理フローのシミュレーション
function simulateProcessing(issue) {
  console.log(`\n🔄 Issue #${issue.number} の処理シミュレーション:`);
  
  // 1. 処理前チェック
  if (shouldProcessIssue(issue)) {
    // 2. 処理開始（processedIssuesに追加）
    console.log('   📝 処理開始: processedIssuesに追加');
    processedIssues.add(issue.number);
    
    // 3. processingラベルを追加（実際はGitHub APIで行う）
    console.log('   🏷️  processingラベルを追加（GitHub API）');
    issue.labels.push({ name: 'processing' });
    
    // 4. 処理実行
    console.log('   🤖 Claude CLIで処理実行中...');
    
    // 5. 処理完了
    console.log('   ✅ 処理完了');
  }
}

console.log('📚 Phase 1: 基本的な重複処理抑制のテスト');
console.log('=========================================');

// テストケース1: 正常な処理フロー
console.log('\n### テストケース1: 正常な処理フロー');
const normalIssue = {
  number: 100,
  title: '通常のタスク',
  labels: [{ name: 'task:misc' }]
};
simulateProcessing(normalIssue);

// テストケース2: 同じIssueを再度処理しようとする
console.log('\n### テストケース2: 同じIssueの再処理を試みる');
simulateProcessing(normalIssue);

// テストケース3: processingラベル付きIssue
console.log('\n### テストケース3: 既に処理中のIssue');
const processingIssue = {
  number: 101,
  title: '処理中のタスク',
  labels: [{ name: 'task:dogfooding' }, { name: 'processing' }]
};
simulateProcessing(processingIssue);

// テストケース4: completedラベル付きIssue
console.log('\n### テストケース4: 完了済みのIssue');
const completedIssue = {
  number: 102,
  title: '完了したタスク',
  labels: [{ name: 'task:misc' }, { name: 'completed' }]
};
simulateProcessing(completedIssue);

// Phase 2: Issue #101以降の高度な重複防止機構
console.log('\n\n📚 Phase 2: 高度な重複防止機構（Issue #101以降）');
console.log('==============================================');

// StatusManagerの状態確認
console.log('\n### StatusManager（JSONベースの状態管理）');
const statusFile = path.join(__dirname, '../state/issue-status.json');
if (fs.existsSync(statusFile)) {
  try {
    const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    console.log('📁 状態ファイル: state/issue-status.json');
    console.log(`   管理中のIssue数: ${Object.keys(status.issues || {}).length}`);
    
    if (Object.keys(status.issues || {}).length > 0) {
      Object.entries(status.issues).forEach(([issueNumber, info]) => {
        console.log(`   - Issue #${issueNumber}:`);
        console.log(`     状態: ${info.status}`);
        console.log(`     処理者: ${info.taskId || 'N/A'}`);
        console.log(`     PID: ${info.lockedBy?.pid || 'N/A'}`);
        console.log(`     最終更新: ${info.lastHeartbeat || info.checkedOutAt}`);
      });
    }
  } catch (e) {
    console.log('   ⚠️  状態ファイルの読み込みエラー:', e.message);
  }
} else {
  console.log('   ℹ️  状態ファイルが存在しません（初回実行時は正常）');
}

// IssueLockManagerのロック確認
console.log('\n### IssueLockManager（ファイルベースロック）');
const lockDir = path.join(__dirname, '../.poppo/locks');
if (fs.existsSync(lockDir)) {
  try {
    const lockFiles = fs.readdirSync(lockDir).filter(f => f.endsWith('.lock'));
    console.log('🔒 ロックディレクトリ: .poppo/locks/');
    console.log(`   ロックファイル数: ${lockFiles.length}`);
    
    lockFiles.forEach(file => {
      try {
        const lockData = JSON.parse(fs.readFileSync(path.join(lockDir, file), 'utf8'));
        const issueNumber = file.replace('issue-', '').replace('.lock', '');
        console.log(`   - Issue #${issueNumber}:`);
        console.log(`     PID: ${lockData.lockedBy?.pid || 'N/A'}`);
        console.log(`     セッションID: ${lockData.lockedBy?.sessionId || 'N/A'}`);
        console.log(`     ロック取得: ${lockData.lockedAt}`);
      } catch (e) {
        // エラーは無視
      }
    });
  } catch (e) {
    console.log('   ⚠️  ロックディレクトリの読み込みエラー:', e.message);
  }
} else {
  console.log('   ℹ️  ロックディレクトリが存在しません（初回実行時は正常）');
}

// まとめ
console.log('\n\n📊 重複処理抑制機構のまとめ');
console.log('===========================');
console.log('\n🛡️  3層の防御機構:');
console.log('1. メモリ内Set（processedIssues）');
console.log('   - 同一プロセス内での高速な重複チェック');
console.log('   - PoppoBuilder再起動時にクリアされる');
console.log('');
console.log('2. GitHubラベル（processing/completed/awaiting-response）');
console.log('   - プロセス間での重複防止');
console.log('   - 視覚的に状態が確認できる');
console.log('   - PoppoBuilder再起動時も保持される');
console.log('');
console.log('3. ローカルファイルシステム（Issue #101以降）');
console.log('   - StatusManager: JSONベースの状態管理');
console.log('   - IssueLockManager: ファイルベースのロック');
console.log('   - プロセスクラッシュ時の自動回復');
console.log('');
console.log('✨ これらの機構により、以下が実現されています:');
console.log('- 同一Issue に対する重複処理の完全な防止');
console.log('- プロセスクラッシュ時の状態回復');
console.log('- 分散環境での協調動作（将来的な拡張）');
console.log('');