#!/usr/bin/env node

/**
 * E2Eテストランナー
 * PoppoBuilder SuiteのE2Eテストを実行します
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;

// テスト設定
const TEST_CONFIG = {
  timeout: 300000, // 5分
  reporter: 'spec',
  bail: false, // エラーが発生しても全テストを実行
  grep: process.env.E2E_GREP || '', // 特定のテストのみ実行
};

// テストシナリオ
const TEST_SCENARIOS = [
  'scenarios/issue-processing.test.js',
  'scenarios/multi-agent-collaboration.test.js',
  'scenarios/dashboard-operations.test.js',
  'scenarios/config-and-recovery.test.js'
];

/**
 * E2Eテストを実行
 */
async function runE2ETests() {
  console.log('🚀 PoppoBuilder Suite E2Eテストを開始します...\n');

  // 環境変数の設定
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    E2E_TEST: 'true'
  };

  // dotenvファイルが存在する場合は読み込む
  const envPath = path.join(__dirname, 'config', 'test.env');
  try {
    const envContent = await fs.readFile(envPath, 'utf-8');
    envContent.split('\n').forEach(line => {
      const [key, value] = line.split('=');
      if (key && value) {
        env[key.trim()] = value.trim();
      }
    });
  } catch (err) {
    console.warn('⚠️  test.envファイルが見つかりません。デフォルト設定を使用します。');
  }

  // Mochaコマンドの構築
  const mochaArgs = [
    '--timeout', TEST_CONFIG.timeout,
    '--reporter', TEST_CONFIG.reporter,
    '--recursive'
  ];

  if (TEST_CONFIG.bail) {
    mochaArgs.push('--bail');
  }

  if (TEST_CONFIG.grep) {
    mochaArgs.push('--grep', TEST_CONFIG.grep);
  }

  // テストファイルを追加
  TEST_SCENARIOS.forEach(scenario => {
    mochaArgs.push(path.join(__dirname, scenario));
  });

  // Mochaを実行
  const mocha = spawn('npx', ['mocha', ...mochaArgs], {
    env,
    stdio: 'inherit',
    cwd: path.join(__dirname, '../..')
  });

  return new Promise((resolve, reject) => {
    mocha.on('close', (code) => {
      if (code === 0) {
        console.log('\n✅ E2Eテストが正常に完了しました！');
        resolve(code);
      } else {
        console.error(`\n❌ E2Eテストが失敗しました (exit code: ${code})`);
        reject(new Error(`E2E tests failed with code ${code}`));
      }
    });

    mocha.on('error', (err) => {
      console.error('E2Eテストの実行中にエラーが発生しました:', err);
      reject(err);
    });
  });
}

/**
 * テスト前の準備
 */
async function setup() {
  console.log('📦 テスト環境を準備しています...');

  // tempディレクトリを作成
  const tempDir = path.join(__dirname, 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  // 必要なディレクトリを作成
  const dirs = ['logs', 'data', 'claude-sessions'];
  for (const dir of dirs) {
    await fs.mkdir(path.join(tempDir, dir), { recursive: true });
  }

  console.log('✅ テスト環境の準備が完了しました\n');
}

/**
 * テスト後のクリーンアップ
 */
async function cleanup() {
  console.log('\n🧹 テスト環境をクリーンアップしています...');

  // tempディレクトリを削除
  const tempDir = path.join(__dirname, 'temp');
  try {
    await fs.rm(tempDir, { recursive: true, force: true });
    console.log('✅ クリーンアップが完了しました');
  } catch (err) {
    console.warn('⚠️  クリーンアップ中にエラーが発生しました:', err.message);
  }
}

/**
 * メイン処理
 */
async function main() {
  try {
    // テスト環境の準備
    await setup();

    // E2Eテストを実行
    await runE2ETests();

    // 成功時のクリーンアップ
    if (process.env.E2E_KEEP_TEMP !== 'true') {
      await cleanup();
    } else {
      console.log('\n📁 E2E_KEEP_TEMP=true のため、tempディレクトリを保持します');
    }

    process.exit(0);
  } catch (err) {
    console.error('\n💥 E2Eテストでエラーが発生しました:', err);

    // エラー時のクリーンアップ
    if (process.env.E2E_KEEP_TEMP !== 'true') {
      await cleanup();
    }

    process.exit(1);
  }
}

// 引数の処理
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
PoppoBuilder Suite E2Eテストランナー

使用方法:
  node test/e2e/index.js [オプション]

オプション:
  --help, -h        このヘルプを表示
  --grep <pattern>  指定したパターンにマッチするテストのみ実行
  --bail            最初のエラーでテストを中止
  --keep-temp       テスト後にtempディレクトリを保持

環境変数:
  E2E_GREP          grepパターンを指定
  E2E_KEEP_TEMP     "true"を設定するとtempディレクトリを保持
  NODE_ENV          "test"に設定されます

例:
  # すべてのE2Eテストを実行
  node test/e2e/index.js

  # Issue処理のテストのみ実行
  node test/e2e/index.js --grep "Issue処理"

  # エラー時にtempディレクトリを保持
  E2E_KEEP_TEMP=true node test/e2e/index.js
`);
  process.exit(0);
}

// コマンドライン引数の処理
if (args.includes('--grep')) {
  const grepIndex = args.indexOf('--grep');
  if (args[grepIndex + 1]) {
    TEST_CONFIG.grep = args[grepIndex + 1];
  }
}

if (args.includes('--bail')) {
  TEST_CONFIG.bail = true;
}

if (args.includes('--keep-temp')) {
  process.env.E2E_KEEP_TEMP = 'true';
}

// 実行
main();