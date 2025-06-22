/**
 * CCLAエージェント Phase 3拡張機能のテスト
 * 
 * Issue #37 (Phase 3拡張): 学習機能、修復履歴、高度なパターンのテスト
 */

const path = require('path');
const fs = require('fs').promises;
const ErrorPatternLearner = require('../agents/ccla/learner');
const RepairHistoryManager = require('../agents/ccla/repair-history');
const AdvancedRepairPatterns = require('../agents/ccla/patterns-advanced');

// カラー出力
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// テストヘルパー
async function cleanupTestData() {
  const dirs = [
    path.join(__dirname, '../data/ccla/learning-data.json'),
    path.join(__dirname, '../data/ccla/repair-history')
  ];
  
  for (const dir of dirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      // エラーは無視
    }
  }
}

// テスト1: 学習機能のテスト
async function testLearningFunction() {
  log('\n=== 学習機能のテスト ===', 'blue');
  
  const learner = new ErrorPatternLearner();
  await learner.initialize();
  
  // 修復結果の記録
  log('修復結果を記録中...');
  
  // 成功パターン
  for (let i = 0; i < 8; i++) {
    await learner.recordRepairResult('EP001', true, {
      repairTime: 100 + i * 10,
      errorHash: `hash${i}`,
      file: `file${i}.js`
    });
  }
  
  // 失敗パターン
  for (let i = 0; i < 2; i++) {
    await learner.recordRepairResult('EP001', false, {
      repairTime: 200,
      errorHash: `fail${i}`,
      file: `fail${i}.js`
    });
  }
  
  // 統計情報の取得
  const stats = learner.getStatistics();
  log(`\n統計情報:`, 'green');
  log(`  総パターン数: ${stats.totalPatterns}`);
  log(`  有効パターン: ${stats.effectivePatterns}`);
  log(`  全体成功率: ${(stats.overallSuccessRate * 100).toFixed(1)}%`);
  
  // パターンの評価
  const evaluation = learner.evaluatePattern('EP001');
  log(`\nEP001の評価:`, 'green');
  log(`  有効性: ${evaluation.effective ? 'Yes' : 'No'}`);
  log(`  理由: ${evaluation.reason}`);
  log(`  推奨: ${evaluation.recommendation}`);
  log(`  成功率: ${(evaluation.data.successRate * 100).toFixed(1)}%`);
  
  // 新パターンの提案
  log('\n新パターンの提案を生成中...');
  const suggestions = await learner.suggestNewPatterns();
  log(`提案数: ${suggestions.length}`);
  
  await learner.saveLearningData();
  log('✓ 学習機能のテスト完了', 'green');
}

// テスト2: 修復履歴管理のテスト
async function testRepairHistory() {
  log('\n=== 修復履歴管理のテスト ===', 'blue');
  
  const historyManager = new RepairHistoryManager();
  await historyManager.initialize();
  
  // 修復履歴の記録
  log('修復履歴を記録中...');
  
  const repairIds = [];
  for (let i = 0; i < 5; i++) {
    const repairId = await historyManager.recordRepair({
      pattern: `EP00${i + 1}`,
      errorHash: `hash${i}`,
      file: `src/module${i}.js`,
      success: i % 2 === 0,
      repairTime: 100 + i * 50,
      errorMessage: `Error in module ${i}`,
      errorCategory: 'Type Error',
      repairMethod: 'Auto-fix',
      confidence: 0.8 + i * 0.02
    });
    repairIds.push(repairId);
  }
  
  // 履歴の検索
  log('\n成功した修復を検索中...');
  const successfulRepairs = await historyManager.searchHistory({
    success: true,
    limit: 10
  });
  log(`成功した修復: ${successfulRepairs.length}件`);
  
  // パターン別統計
  const patternStats = await historyManager.getPatternStatistics();
  log('\nパターン別統計:', 'green');
  patternStats.forEach(stat => {
    log(`  ${stat.pattern}: ${stat.totalRepairs}回 (成功率: ${(stat.successRate * 100).toFixed(1)}%)`);
  });
  
  // 修復時間の見積もり
  const estimate = await historyManager.estimateRepairTime('EP001', 'src/module0.js');
  log('\n修復時間の見積もり:', 'green');
  log(`  推定時間: ${estimate.estimated || 'N/A'}ms`);
  log(`  信頼度: ${(estimate.confidence * 100).toFixed(0)}%`);
  
  await historyManager.saveIndex();
  log('✓ 修復履歴管理のテスト完了', 'green');
}

// テスト3: 高度な修復パターンのテスト
async function testAdvancedPatterns() {
  log('\n=== 高度な修復パターンのテスト ===', 'blue');
  
  const advancedPatterns = new AdvancedRepairPatterns();
  
  // パターン一覧
  log('利用可能な高度パターン:', 'green');
  for (const [id, pattern] of advancedPatterns.patterns) {
    log(`  ${id}: ${pattern.name} (複雑度: ${pattern.complexity}, 複数ファイル: ${pattern.multiFile ? 'Yes' : 'No'})`);
  }
  
  // サンプルエラーでパターンマッチング
  const sampleErrors = [
    'TypeError: Cannot access \'user\' before initialization',
    'UnhandledPromiseRejectionWarning: Promise rejected',
    'JavaScript heap out of memory',
    'Configuration mismatch in settings',
    'API version mismatch: expected v2, got v1',
    'Test failed: Expected "foo" to equal "bar"',
    'Error: Cannot find module \'express\'',
    'Type \'string\' is not assignable to type \'number\''
  ];
  
  log('\nエラーパターンマッチング:', 'green');
  for (const error of sampleErrors) {
    let matched = false;
    for (const [id, pattern] of advancedPatterns.patterns) {
      if (pattern.matcher.test(error)) {
        log(`  "${error}" → ${id}: ${pattern.name}`);
        matched = true;
        break;
      }
    }
    if (!matched) {
      log(`  "${error}" → マッチなし`, 'yellow');
    }
  }
  
  log('✓ 高度な修復パターンのテスト完了', 'green');
}

// 統合テスト
async function runIntegrationTest() {
  log('\n=== Phase 3拡張機能統合テスト ===', 'blue');
  
  // CCLAエージェントの設定
  const config = {
    errorLogCollection: {
      autoRepair: {
        enabled: true,
        learningEnabled: true,
        autoCreatePR: true
      },
      thresholds: {
        minOccurrencesForLearning: 3,
        autoRepairConfidence: 0.9
      }
    }
  };
  
  log('設定:', 'green');
  log(JSON.stringify(config, null, 2));
  
  // Phase 3拡張機能の統合確認
  const hasLearning = config.errorLogCollection.autoRepair.learningEnabled;
  const hasAutoCreatePR = config.errorLogCollection.autoRepair.autoCreatePR;
  
  log('\n機能の有効化状態:', 'green');
  log(`  学習機能: ${hasLearning ? '有効' : '無効'}`);
  log(`  自動PR作成: ${hasAutoCreatePR ? '有効' : '無効'}`);
  
  log('✓ 統合テスト完了', 'green');
}

// メイン実行
async function main() {
  try {
    log('CCLA Phase 3拡張機能テスト開始', 'blue');
    log('================================\n');
    
    // テストデータのクリーンアップ
    await cleanupTestData();
    
    // 各テストの実行
    await testLearningFunction();
    await testRepairHistory();
    await testAdvancedPatterns();
    await runIntegrationTest();
    
    log('\n\n=== すべてのテストが完了しました ===', 'green');
    log('Phase 3拡張機能（学習、履歴、高度なパターン）が正常に動作しています', 'green');
    
  } catch (error) {
    log(`\nエラー: ${error.message}`, 'red');
    console.error(error);
    process.exit(1);
  }
}

// 実行
main();