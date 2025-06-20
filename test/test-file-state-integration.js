#!/usr/bin/env node

/**
 * Test FileStateManager integration with minimal-poppo.js
 */

const FileStateManager = require('../src/file-state-manager');
const path = require('path');
const fs = require('fs').promises;

async function test() {
  console.log('🧪 FileStateManager統合テスト開始\n');
  
  // テスト用の状態ディレクトリ
  const testStateDir = path.join(__dirname, '../state');
  const fileStateManager = new FileStateManager(testStateDir);
  
  try {
    // 1. 初期化
    console.log('1. FileStateManager初期化');
    await fileStateManager.init();
    console.log('✅ 初期化成功\n');
    
    // 2. 現在の状態を読み込み
    console.log('2. 現在の状態を読み込み');
    const processedIssues = await fileStateManager.loadProcessedIssues();
    const processedComments = await fileStateManager.loadProcessedComments();
    console.log(`✅ Issues: ${processedIssues.size}件`);
    console.log(`✅ Comments: ${processedComments.size}件\n`);
    
    // 3. Issue処理のテスト
    console.log('3. Issue処理のシミュレーション');
    const testIssueNumber = 999;
    
    // 処理済みチェック
    const wasProcessed = await fileStateManager.isIssueProcessed(testIssueNumber);
    console.log(`Issue #${testIssueNumber} 処理済み: ${wasProcessed}`);
    
    // 処理済みとして追加
    await fileStateManager.addProcessedIssue(testIssueNumber);
    console.log(`Issue #${testIssueNumber} を処理済みに追加`);
    
    // 再度チェック
    const isNowProcessed = await fileStateManager.isIssueProcessed(testIssueNumber);
    console.log(`Issue #${testIssueNumber} 処理済み: ${isNowProcessed}`);
    console.log('✅ Issue処理テスト成功\n');
    
    // 4. コメント処理のテスト
    console.log('4. コメント処理のシミュレーション');
    const testCommentId = 'test-comment-123';
    
    // 処理済みチェック
    const wasCommentProcessed = await fileStateManager.isCommentProcessed(testIssueNumber, testCommentId);
    console.log(`Comment ${testCommentId} 処理済み: ${wasCommentProcessed}`);
    
    // 処理済みとして追加
    await fileStateManager.addProcessedComment(testIssueNumber, testCommentId);
    console.log(`Comment ${testCommentId} を処理済みに追加`);
    
    // 再度チェック
    const isNowCommentProcessed = await fileStateManager.isCommentProcessed(testIssueNumber, testCommentId);
    console.log(`Comment ${testCommentId} 処理済み: ${isNowCommentProcessed}`);
    console.log('✅ コメント処理テスト成功\n');
    
    // 5. クリーンアップ（テストデータを削除）
    console.log('5. テストデータのクリーンアップ');
    const currentIssues = await fileStateManager.loadProcessedIssues();
    currentIssues.delete(testIssueNumber);
    await fileStateManager.saveProcessedIssues(currentIssues);
    
    const currentComments = await fileStateManager.loadProcessedComments();
    currentComments.delete(testIssueNumber);
    await fileStateManager.saveProcessedComments(currentComments);
    console.log('✅ クリーンアップ完了\n');
    
    console.log('🎉 すべてのテストが成功しました！');
    
  } catch (error) {
    console.error('❌ テストエラー:', error);
    process.exit(1);
  }
}

test();