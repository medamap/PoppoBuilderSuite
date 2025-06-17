const path = require('path');
const fs = require('fs').promises;

/**
 * CCLAエージェント統合テスト
 * エージェントモードでの実際の動作を確認
 */
async function testCCLAIntegration() {
  console.log('CCLAエージェント統合テストを開始...\n');
  
  try {
    // 1. 処理済みエラーファイルの初期化
    const processedErrorsFile = path.join(__dirname, '../.poppo/processed-errors.json');
    console.log('=== 処理済みエラーファイルの確認 ===');
    
    try {
      const data = await fs.readFile(processedErrorsFile, 'utf8');
      const errors = JSON.parse(data);
      console.log(`現在の処理済みエラー数: ${Object.keys(errors).length}`);
      
      // 最初の5つのエラーを表示
      const entries = Object.entries(errors).slice(0, 5);
      entries.forEach(([hash, info]) => {
        console.log(`  - ${hash}: ${info.issueUrl || 'Issue未作成'}`);
      });
      
      if (Object.keys(errors).length > 5) {
        console.log(`  ... 他 ${Object.keys(errors).length - 5} 件`);
      }
    } catch (error) {
      console.log('処理済みエラーファイルが存在しません（正常）');
    }
    
    console.log('\n=== エージェントモードの確認 ===');
    
    // 2. 設定ファイルの確認
    const config = require('../config/config.json');
    console.log(`エラーログ収集: ${config.errorLogCollection.enabled ? '有効' : '無効'}`);
    console.log(`エージェントモード: ${config.agentMode.enabled ? '有効' : '無効'}`);
    console.log(`ポーリング間隔: ${config.errorLogCollection.pollingInterval / 1000}秒`);
    console.log(`監視対象: ${config.errorLogCollection.logSources.join(', ')}`);
    
    console.log('\n=== メッセージディレクトリの確認 ===');
    
    // 3. メッセージディレクトリの存在確認
    const messageDir = path.join(__dirname, '../messages');
    const dirs = ['ccla/inbox', 'ccla/outbox', 'core/inbox', 'core/outbox'];
    
    for (const dir of dirs) {
      const fullPath = path.join(messageDir, dir);
      try {
        await fs.access(fullPath);
        console.log(`✅ ${dir} - 存在`);
      } catch {
        console.log(`❌ ${dir} - 不在`);
      }
    }
    
    console.log('\n=== 統合テストの実行方法 ===');
    console.log('1. エージェントモードを起動:');
    console.log('   npm run start:agents\n');
    
    console.log('2. テスト用エラーログを生成:');
    console.log('   node test/test-error-log-integration.js\n');
    
    console.log('3. 5分後に以下を確認:');
    console.log('   - .poppo/processed-errors.json に新しいエントリが追加される');
    console.log('   - GitHub に新しいIssueが作成される');
    console.log('   - messages/ccla/outbox にメッセージファイルが作成される\n');
    
    console.log('=== 動作確認用コマンド ===');
    console.log('# プロセス確認');
    console.log('ps aux | grep -E "(PoppoBuilder|ccla|ccpm|ccag)" | grep -v grep\n');
    
    console.log('# ログ監視');
    console.log('tail -f logs/poppo-$(date +%Y-%m-%d).log | grep -E "(CCLA|ERROR|Issue)"]\n');
    
    console.log('# Issue確認');
    console.log('gh issue list --repo medamap/PoppoBuilderSuite --label "task:bug,task:defect" --limit 5\n');
    
  } catch (error) {
    console.error('テストエラー:', error);
  }
}

// メイン実行
if (require.main === module) {
  testCCLAIntegration();
}

module.exports = { testCCLAIntegration };