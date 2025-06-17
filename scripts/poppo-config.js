#!/usr/bin/env node

/**
 * PoppoBuilder 設定管理CLI
 * 
 * 使用方法:
 *   poppo-config show              - 現在の設定を表示
 *   poppo-config hierarchy         - 設定階層情報を表示
 *   poppo-config get <key>         - 特定の設定値を取得
 *   poppo-config set <key> <value> - プロジェクト設定を更新
 *   poppo-config validate          - 設定のバリデーション
 *   poppo-config sources           - 設定ソース情報を表示
 *   poppo-config env               - 環境変数の一覧を表示
 */

const fs = require('fs');
const path = require('path');
const ConfigLoader = require('../src/config-loader');

const configLoader = new ConfigLoader();

// コマンドライン引数を解析
const args = process.argv.slice(2);
const command = args[0];

/**
 * 現在の設定を表示
 */
function showConfig() {
  const config = configLoader.loadConfig();
  console.log('\n現在の設定:');
  console.log(JSON.stringify(config, null, 2));
}

/**
 * 設定階層情報を表示
 */
function showHierarchy() {
  configLoader.displayConfigHierarchy();
}

/**
 * 特定の設定値を取得
 */
function getConfig(key) {
  if (!key) {
    console.error('エラー: キーを指定してください');
    process.exit(1);
  }

  const config = configLoader.loadConfig();
  const keys = key.split('.');
  let value = config;

  for (const k of keys) {
    if (value && typeof value === 'object' && k in value) {
      value = value[k];
    } else {
      console.log(`設定キー '${key}' が見つかりません`);
      process.exit(1);
    }
  }

  console.log(`${key}: ${JSON.stringify(value, null, 2)}`);
}

/**
 * プロジェクト設定を更新
 */
function setConfig(key, value) {
  if (!key || value === undefined) {
    console.error('エラー: キーと値を指定してください');
    process.exit(1);
  }

  // プロジェクト設定を読み込み
  let projectConfig = {};
  const projectConfigPath = configLoader.projectConfigPath;

  if (fs.existsSync(projectConfigPath)) {
    const content = fs.readFileSync(projectConfigPath, 'utf-8');
    projectConfig = JSON.parse(content);
  }

  // キーをパースして設定を更新
  const keys = key.split('.');
  let current = projectConfig;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!current[keys[i]]) {
      current[keys[i]] = {};
    }
    current = current[keys[i]];
  }

  // 値をパース
  let parsedValue = value;
  if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;
  else if (!isNaN(value)) parsedValue = Number(value);
  else if (value.startsWith('{') || value.startsWith('[')) {
    try {
      parsedValue = JSON.parse(value);
    } catch (e) {
      // JSONパース失敗時は文字列として扱う
    }
  }

  current[keys[keys.length - 1]] = parsedValue;

  // ディレクトリを作成
  configLoader.ensureConfigDirectory();

  // 設定を保存
  fs.writeFileSync(projectConfigPath, JSON.stringify(projectConfig, null, 2));
  console.log(`✅ プロジェクト設定を更新しました: ${key} = ${JSON.stringify(parsedValue)}`);
}

/**
 * 設定のバリデーション
 */
function validateConfig() {
  console.log('\n設定のバリデーションを実行中...');
  const config = configLoader.loadConfig();
  const isValid = configLoader.validateConfig(config);

  if (isValid) {
    console.log('✅ 設定は有効です');
  } else {
    console.log('❌ 設定に問題があります（上記の警告を確認してください）');
  }
}

/**
 * 設定ソース情報を表示
 */
function showSources() {
  const sources = configLoader.getConfigSources();

  console.log('\n設定ソース情報:');
  console.log('================');
  
  console.log('\nシステムデフォルト:');
  console.log(`  パス: ${sources.systemDefault.path}`);
  console.log(`  状態: ${sources.systemDefault.exists ? '✓ 存在' : '✗ 存在しない'}`);

  console.log('\nグローバル設定:');
  console.log(`  パス: ${sources.global.path}`);
  console.log(`  状態: ${sources.global.exists ? '✓ 存在' : '✗ 存在しない'}`);

  console.log('\nプロジェクト設定:');
  console.log(`  パス: ${sources.project.path}`);
  console.log(`  状態: ${sources.project.exists ? '✓ 存在' : '✗ 存在しない'}`);

  console.log('\n環境変数:');
  const envVars = sources.environment.variables;
  if (Object.keys(envVars).length > 0) {
    Object.entries(envVars).forEach(([key, value]) => {
      console.log(`  ${key} = ${value}`);
    });
  } else {
    console.log('  (設定なし)');
  }
}

/**
 * 環境変数の一覧を表示
 */
function showEnvironmentVariables() {
  const envVars = configLoader.getEnvironmentVariables();

  console.log('\nPoppoBuilder環境変数:');
  console.log('====================');

  if (Object.keys(envVars).length === 0) {
    console.log('設定されている環境変数はありません');
    console.log('\n環境変数の例:');
    console.log('  export POPPO_LANGUAGE_PRIMARY=en');
    console.log('  export POPPO_CLAUDE_MAXCONCURRENT=3');
    console.log('  export POPPO_GITHUB_POLLINGINTERVAL=120000');
    console.log('  export POPPO_DYNAMICTIMEOUT_ENABLED=false');
  } else {
    Object.entries(envVars).forEach(([key, value]) => {
      console.log(`${key} = ${value}`);
    });
  }
}

/**
 * ヘルプを表示
 */
function showHelp() {
  console.log(`
PoppoBuilder 設定管理CLI

使用方法:
  poppo-config <command> [options]

コマンド:
  show              現在の設定を表示
  hierarchy         設定階層情報を表示
  get <key>         特定の設定値を取得
  set <key> <value> プロジェクト設定を更新
  validate          設定のバリデーション
  sources           設定ソース情報を表示
  env               環境変数の一覧を表示
  help              このヘルプを表示

例:
  poppo-config show
  poppo-config get language.primary
  poppo-config set language.primary en
  poppo-config set claude.maxConcurrent 3
  poppo-config env

設定の優先順位:
  1. 環境変数 (POPPO_*)
  2. プロジェクト設定 (.poppo/config.json)
  3. グローバル設定 (~/.poppo/config.json)
  4. システムデフォルト (config/defaults.json)
`);
}

// メイン処理
switch (command) {
  case 'show':
    showConfig();
    break;
  case 'hierarchy':
    showHierarchy();
    break;
  case 'get':
    getConfig(args[1]);
    break;
  case 'set':
    setConfig(args[1], args[2]);
    break;
  case 'validate':
    validateConfig();
    break;
  case 'sources':
    showSources();
    break;
  case 'env':
    showEnvironmentVariables();
    break;
  case 'help':
  case undefined:
    showHelp();
    break;
  default:
    console.error(`不明なコマンド: ${command}`);
    showHelp();
    process.exit(1);
}