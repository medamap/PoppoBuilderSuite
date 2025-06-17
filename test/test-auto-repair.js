/**
 * 自動修復機能のテストスクリプト
 * エラーログ収集機能Phase 3の動作確認
 */

const fs = require('fs').promises;
const path = require('path');
const AutoRepairEngine = require('../agents/ccla/repairer');
const { repairPatterns } = require('../agents/ccla/patterns');

// テスト用のロガー
const testLogger = {
  info: (msg) => console.log(`[INFO] ${msg}`),
  warn: (msg) => console.log(`[WARN] ${msg}`),
  error: (msg) => console.log(`[ERROR] ${msg}`)
};

// テストケース
const testCases = [
  {
    name: 'Type Error - Property Access',
    errorInfo: {
      hash: 'test-001',
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message: "TypeError: Cannot read property 'name' of undefined",
      stackTrace: [
        "    at getUserName (/test/sample.js:10:15)",
        "    at processUser (/test/sample.js:20:5)",
        "    at main (/test/sample.js:30:3)"
      ],
      analysis: {
        patternId: 'EP001',
        type: 'bug',
        severity: 'high',
        category: 'Type Error',
        matched: true
      }
    },
    expectedResult: {
      success: true,
      pattern: 'NULL_CHECK_ADDITION'
    }
  },
  {
    name: 'Reference Error - Missing Import',
    errorInfo: {
      hash: 'test-002',
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message: "ReferenceError: fs is not defined",
      stackTrace: [
        "    at readConfig (/test/config.js:5:10)",
        "    at initialize (/test/config.js:15:5)"
      ],
      analysis: {
        patternId: 'EP002',
        type: 'bug',
        severity: 'high',
        category: 'Reference Error',
        matched: true
      }
    },
    expectedResult: {
      success: true,
      pattern: 'AUTO_IMPORT'
    }
  },
  {
    name: 'File Not Found',
    errorInfo: {
      hash: 'test-003',
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message: "Error: ENOENT: no such file or directory, open 'config.json'",
      stackTrace: [
        "    at Object.openSync (fs.js:498:3)",
        "    at readFileSync (fs.js:394:35)"
      ],
      analysis: {
        patternId: 'EP004',
        type: 'defect',
        severity: 'medium',
        category: 'File Not Found',
        matched: true
      }
    },
    expectedResult: {
      success: true,
      pattern: 'CREATE_MISSING_FILE'
    }
  },
  {
    name: 'JSON Parse Error',
    errorInfo: {
      hash: 'test-004',
      timestamp: new Date().toISOString(),
      level: 'ERROR',
      message: "SyntaxError: Unexpected token } in JSON at position 50",
      stackTrace: [
        "    at JSON.parse (<anonymous>)",
        "    at parseConfig (/test/parser.js:10:20)"
      ],
      analysis: {
        patternId: 'EP010',
        type: 'bug',
        severity: 'medium',
        category: 'Parse Error',
        matched: true
      }
    },
    expectedResult: {
      success: true,
      pattern: 'FIX_JSON_FORMAT'
    }
  }
];

// テストファイルのセットアップ
async function setupTestFiles() {
  const testDir = path.join(__dirname, 'test-repair-files');
  await fs.mkdir(testDir, { recursive: true });
  
  // Type Errorテスト用ファイル
  const sampleJs = `
function getUserName(user) {
  return user.name; // エラー: userがundefinedの可能性
}

function processUser(userId) {
  const user = getUser(userId);
  const name = getUserName(user);
  console.log(name);
}

function main() {
  processUser(123);
}
`;
  await fs.writeFile(path.join(testDir, 'sample.js'), sampleJs);
  
  // Reference Errorテスト用ファイル
  const configJs = `
function readConfig() {
  // fsモジュールが未インポート
  const content = fs.readFileSync('config.json', 'utf8');
  return JSON.parse(content);
}

function initialize() {
  const config = readConfig();
  console.log(config);
}
`;
  await fs.writeFile(path.join(testDir, 'config.js'), configJs);
  
  // JSON Parse Errorテスト用ファイル
  const badJson = `{
  "name": "test",
  "version": "1.0.0",
  "invalid": true,
}`;
  await fs.writeFile(path.join(testDir, 'bad-config.json'), badJson);
  
  return testDir;
}

// テスト実行
async function runTests() {
  console.log('=== 自動修復機能テスト開始 ===\n');
  
  // テストファイルをセットアップ
  const testDir = await setupTestFiles();
  
  // 修復エンジンを初期化
  const config = require('../config/config.json');
  const repairEngine = new AutoRepairEngine(testLogger);
  repairEngine.config.dryRun = true; // ドライランモードでテスト
  
  const results = [];
  
  for (const testCase of testCases) {
    console.log(`\n--- テストケース: ${testCase.name} ---`);
    console.log(`エラー: ${testCase.errorInfo.message}`);
    
    try {
      // 修復可能性をチェック
      const repairability = repairEngine.checkRepairability(testCase.errorInfo);
      console.log(`修復可能: ${repairability.canRepair ? 'はい' : 'いいえ'}`);
      
      if (repairability.canRepair) {
        console.log(`修復パターン: ${repairability.pattern}`);
        console.log(`成功率: ${(repairability.successRate * 100).toFixed(1)}%`);
        
        // 自動修復を試みる
        const result = await repairEngine.attemptAutoRepair(testCase.errorInfo, {
          dryRun: true
        });
        
        console.log(`修復結果: ${result.success ? '成功' : '失敗'}`);
        if (result.success) {
          console.log(`適用パターン: ${result.pattern}`);
          console.log(`説明: ${result.description || '(なし)'}`);
        } else {
          console.log(`失敗理由: ${result.reason}`);
        }
        
        results.push({
          testCase: testCase.name,
          expected: testCase.expectedResult,
          actual: result,
          passed: result.success === testCase.expectedResult.success &&
                  (!result.pattern || result.pattern === testCase.expectedResult.pattern)
        });
      } else {
        results.push({
          testCase: testCase.name,
          expected: testCase.expectedResult,
          actual: { success: false, reason: repairability.reason },
          passed: false
        });
      }
      
    } catch (error) {
      console.error(`テストエラー: ${error.message}`);
      results.push({
        testCase: testCase.name,
        expected: testCase.expectedResult,
        actual: { success: false, error: error.message },
        passed: false
      });
    }
  }
  
  // テスト結果のサマリー
  console.log('\n\n=== テスト結果サマリー ===');
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`合格: ${passed}/${total} (${(passed/total*100).toFixed(1)}%)`);
  
  console.log('\n詳細:');
  results.forEach(r => {
    console.log(`- ${r.testCase}: ${r.passed ? '✅ PASS' : '❌ FAIL'}`);
    if (!r.passed) {
      console.log(`  期待: ${JSON.stringify(r.expected)}`);
      console.log(`  実際: ${JSON.stringify(r.actual)}`);
    }
  });
  
  // 修復統計を表示
  console.log('\n\n=== 修復統計 ===');
  const stats = repairEngine.getStatistics();
  console.log(JSON.stringify(stats, null, 2));
  
  // クリーンアップ
  await fs.rm(testDir, { recursive: true, force: true });
  
  return passed === total;
}

// 統合テスト
async function integrationTest() {
  console.log('\n\n=== 統合テスト ===');
  
  // 実際のファイルで修復をテスト
  const testFile = path.join(__dirname, 'integration-test.js');
  const testContent = `
function processData(data) {
  console.log(data.items.length);
}

processData(null);
`;
  
  await fs.writeFile(testFile, testContent);
  
  const config = require('../config/config.json');
  const repairEngine = new AutoRepairEngine(testLogger);
  repairEngine.config.dryRun = false; // 実際に修復を実行
  repairEngine.config.skipTest = true; // テストはスキップ
  
  const errorInfo = {
    hash: 'int-test-001',
    timestamp: new Date().toISOString(),
    level: 'ERROR',
    message: "TypeError: Cannot read property 'items' of null",
    stackTrace: [
      `    at processData (${testFile}:3:20)`,
      `    at Object.<anonymous> (${testFile}:6:1)`
    ],
    analysis: {
      patternId: 'EP001',
      type: 'bug',
      severity: 'high',
      category: 'Type Error',
      matched: true
    }
  };
  
  console.log('修復前のコード:');
  console.log(testContent);
  
  const result = await repairEngine.attemptAutoRepair(errorInfo);
  
  if (result.success) {
    console.log('\n修復成功!');
    console.log('修復後のコード:');
    const repairedContent = await fs.readFile(testFile, 'utf8');
    console.log(repairedContent);
    
    // バックアップファイルも確認
    if (result.result && result.result.backupPath) {
      console.log(`\nバックアップ: ${result.result.backupPath}`);
    }
  } else {
    console.log(`\n修復失敗: ${result.reason}`);
  }
  
  // クリーンアップ
  await fs.unlink(testFile).catch(() => {});
  if (result.result && result.result.backupPath) {
    await fs.unlink(result.result.backupPath).catch(() => {});
  }
}

// メイン処理
async function main() {
  try {
    // 基本テストを実行
    const allPassed = await runTests();
    
    // 統合テストを実行
    await integrationTest();
    
    console.log('\n\n=== テスト完了 ===');
    process.exit(allPassed ? 0 : 1);
    
  } catch (error) {
    console.error('テスト実行エラー:', error);
    process.exit(1);
  }
}

// テスト実行
if (require.main === module) {
  main();
}