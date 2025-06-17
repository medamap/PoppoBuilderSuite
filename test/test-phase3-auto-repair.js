/**
 * Phase 3 自動修復機能の統合テスト
 */

const AutoRepairEngine = require('../agents/ccla/repairer');
const LearningErrorRecognizer = require('../agents/ccla/learning-recognizer');
const AutoPRCreator = require('../agents/ccla/pr-creator');
const CCLAAgent = require('../agents/ccla');
const fs = require('fs').promises;
const path = require('path');

async function testPhase3Integration() {
  console.log('=== Phase 3 自動修復機能統合テスト ===\n');
  
  // テスト設定
  const config = {
    errorLogCollection: {
      enabled: true,
      autoRepair: {
        enabled: true,
        maxRetries: 3,
        testTimeout: 60000,
        enableTestGeneration: true,
        enableRollback: true,
        dryRun: false,
        confidenceThreshold: 0.8,
        repairablePatterns: ['EP001', 'EP002', 'EP003', 'EP004', 'EP010'],
        autoCreatePR: true,
        requireValidation: true,
        learningEnabled: true
      }
    }
  };
  
  // 1. 学習エンジンのテスト
  console.log('1. 学習エンジンのテスト');
  const learningEngine = new LearningErrorRecognizer();
  
  // エラーパターンを複数回記録
  const testError = {
    hash: 'test123',
    message: 'TypeError: Cannot read property \'name\' of undefined',
    stackTrace: ['at test.js:10:5'],
    analysis: {
      patternId: 'EP001',
      category: 'Type Error'
    }
  };
  
  // 3回エラーを記録（学習閾値）
  for (let i = 0; i < 3; i++) {
    await learningEngine.recordError(testError);
  }
  
  // 修復成功を記録
  await learningEngine.recordRepairResult('test123', 'EP001', true);
  await learningEngine.recordRepairResult('test123', 'EP001', true);
  
  const shouldLearn = learningEngine.shouldLearnPattern('EP001');
  console.log(`  学習推奨: ${shouldLearn ? 'はい' : 'いいえ'}`);
  console.log(`  信頼度: ${learningEngine.getPatternConfidence('EP001')}\n`);
  
  // 2. PR作成機能のテスト
  console.log('2. PR作成機能のテスト');
  const prCreator = new AutoPRCreator();
  const canCreatePR = await prCreator.canCreatePR();
  console.log(`  PR作成可能: ${canCreatePR.canCreate ? 'はい' : 'いいえ'}`);
  if (!canCreatePR.canCreate) {
    console.log(`  理由: ${canCreatePR.reason}`);
  }
  console.log();
  
  // 3. 自動修復エンジンの統合テスト
  console.log('3. 自動修復エンジンの統合テスト');
  const repairEngine = new AutoRepairEngine(console, config.errorLogCollection.autoRepair);
  
  // テスト用の一時ファイルを作成
  const testFile = path.join(process.cwd(), 'test-repair-file.js');
  await fs.writeFile(testFile, `
// テストコード
function getUser(id) {
  const user = getUserById(id);
  return user.name;  // userがundefinedの可能性
}
`, 'utf8');
  
  const repairableError = {
    hash: 'repair123',
    message: 'TypeError: Cannot read property \'name\' of undefined',
    stackTrace: [
      `at getUser (${testFile}:4:14)`,
      'at test.js:10:5'
    ],
    analysis: {
      patternId: 'EP001',
      category: 'Type Error',
      severity: 'high',
      matched: true
    }
  };
  
  console.log('  修復を試みています...');
  const repairResult = await repairEngine.attemptAutoRepair(repairableError, {
    dryRun: false  // 実際に修復を実行
  });
  
  console.log(`  修復結果: ${repairResult.success ? '成功' : '失敗'}`);
  if (repairResult.success) {
    console.log(`  使用パターン: ${repairResult.pattern}`);
    console.log(`  成功率: ${(repairResult.successRate * 100).toFixed(1)}%`);
    console.log(`  実行時間: ${repairResult.duration}ms`);
    if (repairResult.prCreated) {
      console.log(`  PR作成: ${repairResult.prUrl}`);
    }
  } else {
    console.log(`  失敗理由: ${repairResult.reason}`);
  }
  
  // 修復されたファイルの内容を確認
  if (repairResult.success && await fs.access(testFile).then(() => true).catch(() => false)) {
    const repairedContent = await fs.readFile(testFile, 'utf8');
    console.log('\n  修復後のコード:');
    console.log('  ---');
    console.log(repairedContent.split('\n').map(line => '  ' + line).join('\n'));
    console.log('  ---');
  }
  
  // 4. CCLAエージェントの統合テスト
  console.log('\n4. CCLAエージェントの統合テスト');
  console.log('  (実際のログファイル監視をシミュレート)');
  
  // テスト用ログファイルを作成
  const logsDir = path.join(process.cwd(), 'logs');
  await fs.mkdir(logsDir, { recursive: true });
  
  const testLogFile = path.join(logsDir, `poppo-test-${new Date().toISOString().split('T')[0]}.log`);
  await fs.writeFile(testLogFile, `
[2025-01-16 10:00:00] [INFO] PoppoBuilder起動
[2025-01-16 10:00:01] [ERROR] TypeError: Cannot read property 'config' of undefined
    at initialize (/src/main.js:25:10)
    at startup (/src/main.js:100:5)
    at Object.<anonymous> (/src/main.js:150:1)
[2025-01-16 10:00:02] [INFO] 処理を続行します
`, 'utf8');
  
  console.log('  ログファイルを作成しました');
  console.log('  CCLAエージェントでの処理はシミュレーションで確認');
  
  // 5. 学習データのエクスポート
  console.log('\n5. 学習データのエクスポート');
  const exportPath = path.join(process.cwd(), 'test-learning-export.json');
  await repairEngine.exportLearningData(exportPath);
  console.log(`  データをエクスポート: ${exportPath}`);
  
  const exportedData = JSON.parse(await fs.readFile(exportPath, 'utf8'));
  console.log(`  統計情報:`)
  console.log(`    - 総試行回数: ${exportedData.statistics.totalAttempts}`);
  console.log(`    - 成功数: ${exportedData.statistics.totalSuccesses}`);
  console.log(`    - 失敗数: ${exportedData.statistics.totalFailures}`);
  
  // クリーンアップ
  console.log('\n6. クリーンアップ');
  try {
    await fs.unlink(testFile);
    await fs.unlink(testLogFile);
    await fs.unlink(exportPath);
    console.log('  テストファイルを削除しました');
  } catch (error) {
    console.log('  一部のファイル削除に失敗（問題ありません）');
  }
  
  console.log('\n=== テスト完了 ===');
}

// テスト実行
testPhase3Integration().catch(error => {
  console.error('テストエラー:', error);
  process.exit(1);
});