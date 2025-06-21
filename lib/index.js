/**
 * PoppoBuilder Library Entry Point
 * npm パッケージとして公開される際のメインファイル
 */

const path = require('path');
const fs = require('fs');

// コアクラスのエクスポート
const PoppoBuilder = require('./core/poppo-builder');
const ConfigLoader = require('./core/config-loader');
const TaskProcessor = require('./core/task-processor');

// ユーティリティ
const Logger = require('./utils/logger');
const GitHubClient = require('./utils/github-client');

// プロジェクトルートからの相対パスを解決
function resolveProjectPath(relativePath) {
  // npm パッケージとしてインストールされた場合
  if (process.env.POPPOBUILDER_ROOT) {
    return path.join(process.env.POPPOBUILDER_ROOT, relativePath);
  }
  
  // 開発環境またはローカル実行
  const projectRoot = path.dirname(__dirname);
  return path.join(projectRoot, relativePath);
}

// 設定ファイルのパスを取得
function getConfigPath() {
  // 1. カレントディレクトリのプロジェクト設定
  const localConfig = path.join(process.cwd(), '.poppobuilder', 'config.json');
  if (fs.existsSync(localConfig)) {
    return localConfig;
  }
  
  // 2. グローバル設定
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  const globalConfig = path.join(homeDir, '.poppobuilder', 'config.json');
  if (fs.existsSync(globalConfig)) {
    return globalConfig;
  }
  
  // 3. デフォルト設定
  return resolveProjectPath('config/defaults.json');
}

// PoppoBuilderインスタンスの作成
function createPoppoBuilder(options = {}) {
  const configPath = options.configPath || getConfigPath();
  const config = new ConfigLoader(configPath).load();
  
  return new PoppoBuilder({
    ...config,
    ...options,
    projectRoot: process.cwd(),
    resolveProjectPath
  });
}

// CLI コマンドの実行
async function runCommand(command, options = {}) {
  const commandPath = path.join(__dirname, 'commands', command);
  
  try {
    const CommandClass = require(commandPath);
    const commandInstance = new CommandClass();
    return await commandInstance.execute(options);
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Unknown command: ${command}`);
    }
    throw error;
  }
}

// API エクスポート
module.exports = {
  // メインクラス
  PoppoBuilder,
  ConfigLoader,
  TaskProcessor,
  
  // ユーティリティ
  Logger,
  GitHubClient,
  
  // ファクトリー関数
  createPoppoBuilder,
  
  // CLI実行
  runCommand,
  
  // パス解決
  resolveProjectPath,
  getConfigPath,
  
  // バージョン情報
  version: require('../package.json').version
};