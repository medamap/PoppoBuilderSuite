const fs = require('fs').promises;
const path = require('path');
const CCLAAgent = require('../agents/ccla/index');

/**
 * エラーログ収集機能のテスト
 */
async function testErrorLogCollection() {
  console.log('エラーログ収集機能のテストを開始...\n');
  
  // CCLAエージェントのインスタンスを作成
  const config = require('../config/config.json');
  const agent = new CCLAAgent(config);
  
  // テスト用のエラーサンプル
  const testErrors = [
    {
      message: '[ERROR] TypeError: Cannot read property \'name\' of undefined',
      stackTrace: [
        '    at processIssue (/src/minimal-poppo.js:123:45)',
        '    at async main (/src/minimal-poppo.js:456:5)'
      ]
    },
    {
      message: '[ERROR] ReferenceError: someVariable is not defined',
      stackTrace: [
        '    at handleRequest (/src/github-client.js:45:12)',
        '    at Object.<anonymous> (/src/index.js:10:1)'
      ]
    },
    {
      message: '[ERROR] ENOENT: no such file or directory, open \'/config/missing.json\'',
      stackTrace: [
        '    at Object.openSync (fs.js:462:3)',
        '    at Object.readFileSync (fs.js:364:35)'
      ]
    },
    {
      message: '[ERROR] GitHub API rate limit exceeded',
      stackTrace: [
        '    at GitHubClient.makeRequest (/src/github-client.js:89:15)',
        '    at async GitHubClient.listIssues (/src/github-client.js:120:5)'
      ]
    },
    {
      message: '[ERROR] timeout of 2000ms exceeded',
      stackTrace: [
        '    at Timeout._onTimeout (/src/process-manager.js:200:20)',
        '    at listOnTimeout (internal/timers.js:554:17)'
      ]
    }
  ];
  
  console.log('=== エラーパターン分析テスト ===\n');
  
  // 各エラーをテスト
  for (const testError of testErrors) {
    console.log(`テストエラー: ${testError.message}`);
    
    // エラーハッシュの生成
    const hash = agent.generateErrorHash({
      level: 'ERROR',
      message: testError.message,
      stackTrace: testError.stackTrace
    });
    console.log(`  ハッシュ: ${hash}`);
    
    // エラーパターンの分析
    const analysis = agent.analyzeErrorPattern({
      message: testError.message,
      stackTrace: testError.stackTrace
    });
    
    console.log(`  分析結果:`);
    console.log(`    - パターンID: ${analysis.patternId}`);
    console.log(`    - カテゴリ: ${analysis.category}`);
    console.log(`    - タイプ: ${analysis.type}`);
    console.log(`    - 重要度: ${analysis.severity}`);
    console.log(`    - マッチ: ${analysis.matched ? '成功' : '失敗'}`);
    console.log(`    - 推奨対処法: ${analysis.suggestedAction}`);
    console.log();
  }
  
  console.log('=== Issue本文生成テスト ===\n');
  
  // エージェントコーディネーターのformatIssueBody関数をテスト
  const AgentCoordinator = require('../agents/core/agent-coordinator');
  const coordinator = new AgentCoordinator(config);
  
  const sampleError = {
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message: testErrors[0].message,
    stackTrace: testErrors[0].stackTrace,
    hash: 'abc12345',
    analysis: {
      patternId: 'EP001',
      category: 'Type Error',
      type: 'bug',
      severity: 'high',
      matched: true,
      suggestedAction: 'プロパティアクセス前のnullチェックを追加'
    }
  };
  
  const issueBody = coordinator.formatIssueBody(sampleError);
  console.log('生成されたIssue本文:');
  console.log('---');
  console.log(issueBody);
  console.log('---\n');
  
  console.log('=== メッセージディレクトリの作成テスト ===\n');
  
  // メッセージディレクトリの存在確認
  const messageBaseDir = path.join(__dirname, '../messages');
  const requiredDirs = [
    'core/inbox',
    'core/outbox',
    'ccla/inbox',
    'ccla/outbox',
    'ccpm/inbox',
    'ccpm/outbox',
    'ccag/inbox',
    'ccag/outbox'
  ];
  
  for (const dir of requiredDirs) {
    const fullPath = path.join(messageBaseDir, dir);
    try {
      await fs.mkdir(fullPath, { recursive: true });
      console.log(`✅ ディレクトリ作成/確認: ${dir}`);
    } catch (error) {
      console.log(`❌ ディレクトリ作成エラー: ${dir} - ${error.message}`);
    }
  }
  
  console.log('\nテスト完了！');
}

// メイン実行
if (require.main === module) {
  testErrorLogCollection().catch(error => {
    console.error('テストエラー:', error);
    process.exit(1);
  });
}

module.exports = { testErrorLogCollection };