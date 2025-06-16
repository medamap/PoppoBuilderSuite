const AgentCoordinator = require('../agents/core/agent-coordinator');
const fs = require('fs').promises;
const path = require('path');

/**
 * エージェントモードのテスト
 */
async function testAgentMode() {
  console.log('🧪 エージェントモードのテストを開始します...\n');
  
  const coordinator = new AgentCoordinator({
    pollingInterval: 2000,
    autoRestart: false
  });
  
  try {
    // 1. コーディネーターの初期化
    console.log('1️⃣ コーディネーターを初期化中...');
    await coordinator.initialize();
    console.log('✅ コーディネーター初期化完了\n');
    
    // 少し待ってエージェントが起動するのを待つ
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // 2. エージェントの状態確認
    console.log('2️⃣ エージェントの状態を確認中...');
    const stats = coordinator.getStats();
    console.log('📊 エージェント状態:');
    stats.agents.forEach(agent => {
      console.log(`  - ${agent.name}: ${agent.status}`);
    });
    console.log();
    
    // 3. テストタスクの割り当て
    console.log('3️⃣ テストタスクを割り当て中...');
    
    // コードレビュータスク
    const reviewTask = await coordinator.assignTask(
      'test-review-001',
      'code-review',
      {
        issueNumber: 999,
        issueTitle: 'テスト: コードレビュー',
        issueBody: 'src/minimal-poppo.js のコードレビューをお願いします',
        labels: ['test'],
        priority: 'normal'
      },
      {
        files: ['src/minimal-poppo.js'],
        issueNumber: 999,
        issueBody: 'テストレビュー'
      }
    );
    console.log(`✅ コードレビュータスク割り当て: ${reviewTask.taskId}`);
    
    // ドキュメント生成タスク
    const docTask = await coordinator.assignTask(
      'test-doc-001',
      'generate-docs',
      {
        issueNumber: 999,
        issueTitle: 'テスト: ドキュメント生成',
        issueBody: 'APIドキュメントを生成してください',
        labels: ['test'],
        priority: 'normal'
      },
      {
        targetFiles: ['src/agent-integration.js'],
        docType: 'api',
        outputDir: 'test/docs'
      }
    );
    console.log(`✅ ドキュメント生成タスク割り当て: ${docTask.taskId}\n`);
    
    // 4. タスクの進捗を監視
    console.log('4️⃣ タスクの進捗を監視中...');
    
    let checkCount = 0;
    const maxChecks = 30; // 最大30回チェック（1分間）
    
    const checkProgress = async () => {
      checkCount++;
      
      const currentStats = coordinator.getStats();
      console.log(`\n[チェック ${checkCount}/${maxChecks}]`);
      console.log(`  アクティブタスク: ${currentStats.tasks.active}`);
      console.log(`  完了タスク: ${currentStats.tasks.completed}`);
      console.log(`  失敗タスク: ${currentStats.tasks.failed}`);
      
      // 各エージェントの状態
      currentStats.agents.forEach(agent => {
        console.log(`  ${agent.name}: ${agent.status} (アクティブ: ${agent.activeTasks})`);
      });
      
      // すべてのタスクが完了したら終了
      if (currentStats.tasks.active === 0 && 
          (currentStats.tasks.completed + currentStats.tasks.failed) >= 2) {
        console.log('\n✅ すべてのタスクが完了しました！');
        return true;
      }
      
      if (checkCount >= maxChecks) {
        console.log('\n⏱️ タイムアウト: テストを終了します');
        return true;
      }
      
      return false;
    };
    
    // 定期的に進捗をチェック
    while (true) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      const done = await checkProgress();
      if (done) break;
    }
    
    // 5. 最終結果の確認
    console.log('\n5️⃣ 最終結果:');
    const finalStats = coordinator.getStats();
    console.log(`  総タスク数: ${finalStats.tasks.assigned}`);
    console.log(`  完了: ${finalStats.tasks.completed}`);
    console.log(`  失敗: ${finalStats.tasks.failed}`);
    console.log(`  稼働時間: ${Math.round(finalStats.uptime / 1000)}秒`);
    
    // テスト用に生成されたドキュメントがあるか確認
    try {
      const testDocsDir = path.join(__dirname, 'docs');
      const files = await fs.readdir(testDocsDir);
      if (files.length > 0) {
        console.log(`\n📄 生成されたドキュメント:`);
        files.forEach(file => console.log(`  - ${file}`));
      }
    } catch (error) {
      // ディレクトリがない場合は無視
    }
    
  } catch (error) {
    console.error('\n❌ テストエラー:', error.message);
    console.error(error.stack);
  } finally {
    // 6. クリーンアップ
    console.log('\n6️⃣ クリーンアップ中...');
    await coordinator.shutdown();
    
    // テスト用ディレクトリを削除
    try {
      const testDocsDir = path.join(__dirname, 'docs');
      await fs.rm(testDocsDir, { recursive: true, force: true });
    } catch (error) {
      // ディレクトリがない場合は無視
    }
    
    console.log('✅ テスト完了\n');
  }
}

// メイン実行
if (require.main === module) {
  testAgentMode().catch(console.error);
}

module.exports = { testAgentMode };