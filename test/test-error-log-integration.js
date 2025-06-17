const fs = require('fs').promises;
const path = require('path');

/**
 * エラーログ収集機能の統合テスト
 * エージェントモードで実際にエラーログを生成してIssue作成までの流れをテスト
 */
async function testErrorLogIntegration() {
  console.log('エラーログ収集機能の統合テストを開始...\n');
  
  // テスト用のエラーログを生成
  const logsDir = path.join(__dirname, '../logs');
  const testLogFile = path.join(logsDir, `poppo-test-${new Date().toISOString().split('T')[0]}.log`);
  
  // ログディレクトリが存在しない場合は作成
  await fs.mkdir(logsDir, { recursive: true });
  
  // テスト用のエラーログ内容
  const logContent = `[2025-06-16 10:00:00] [INFO] PoppoBuilder起動
[2025-06-16 10:00:01] [INFO] 設定ファイルを読み込み中...
[2025-06-16 10:00:02] [ERROR] TypeError: Cannot read property 'name' of undefined
    at processIssue (/src/minimal-poppo.js:123:45)
    at async main (/src/minimal-poppo.js:456:5)
    at async Object.<anonymous> (/src/minimal-poppo.js:500:1)
[2025-06-16 10:00:03] [INFO] エラーが発生したため処理を中断
[2025-06-16 10:05:00] [INFO] 次のIssueをチェック中...
[2025-06-16 10:05:01] [ERROR] ENOENT: no such file or directory, open '/config/missing.json'
    at Object.openSync (fs.js:462:3)
    at Object.readFileSync (fs.js:364:35)
    at loadConfig (/src/config-loader.js:10:15)
[2025-06-16 10:05:02] [WARN] 設定ファイルが見つからないためデフォルト設定を使用
[2025-06-16 10:10:00] [INFO] GitHub APIを呼び出し中...
[2025-06-16 10:10:05] [ERROR] GitHub API rate limit exceeded
    at GitHubClient.makeRequest (/src/github-client.js:89:15)
    at async GitHubClient.listIssues (/src/github-client.js:120:5)
[2025-06-16 10:10:06] [INFO] レート制限のため次回まで待機
[2025-06-16 10:15:00] [FATAL] JavaScript heap out of memory
    at Array.push (<anonymous>)
    at processLargeData (/src/data-processor.js:45:20)
[2025-06-16 10:15:01] [INFO] プロセスが異常終了しました
`;
  
  // テストログファイルを作成
  await fs.writeFile(testLogFile, logContent, 'utf8');
  console.log(`✅ テストログファイルを作成: ${testLogFile}\n`);
  
  console.log('=== エージェントモードでの実行手順 ===\n');
  console.log('1. 別のターミナルでエージェントモードを起動してください:');
  console.log('   npm run start:agents\n');
  console.log('2. CCLAエージェントがログファイルを監視し、エラーを検出します');
  console.log('3. エラーが検出されると、自動的にGitHub Issueが作成されます\n');
  
  console.log('=== 期待される動作 ===\n');
  console.log('- 4つのエラーが検出されるはずです:');
  console.log('  1. TypeError (task:bug, high)');
  console.log('  2. File Not Found (task:defect, medium)');
  console.log('  3. Rate Limit (task:defect, low)');
  console.log('  4. Memory Error (task:defect, critical)\n');
  
  console.log('=== 動作確認方法 ===\n');
  console.log('1. 処理済みエラーの確認:');
  console.log('   cat .poppo/processed-errors.json\n');
  console.log('2. 作成されたIssueの確認:');
  console.log('   gh issue list --repo medamap/PoppoBuilderSuite --label "task:bug,task:defect"\n');
  console.log('3. エージェントログの確認:');
  console.log('   tail -f logs/poppo-$(date +%Y-%m-%d).log | grep CCLA\n');
  
  console.log('テスト準備完了！');
}

// 手動でエラーログを削除するヘルパー関数
async function cleanupTestLogs() {
  const logsDir = path.join(__dirname, '../logs');
  const files = await fs.readdir(logsDir);
  const testFiles = files.filter(f => f.includes('poppo-test-'));
  
  for (const file of testFiles) {
    await fs.unlink(path.join(logsDir, file));
    console.log(`削除: ${file}`);
  }
  
  console.log('テストログファイルをクリーンアップしました');
}

// メイン実行
if (require.main === module) {
  const command = process.argv[2];
  
  if (command === 'cleanup') {
    cleanupTestLogs().catch(error => {
      console.error('クリーンアップエラー:', error);
      process.exit(1);
    });
  } else {
    testErrorLogIntegration().catch(error => {
      console.error('テストエラー:', error);
      process.exit(1);
    });
  }
}

module.exports = { testErrorLogIntegration, cleanupTestLogs };