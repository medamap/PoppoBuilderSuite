/**
 * Project Context Switcher
 * プロジェクトのコンテキストを切り替えて、独立した実行環境を提供
 */

const path = require('path');
const fs = require('fs').promises;

class ContextSwitcher {
  constructor() {
    this.originalContext = null;
    this.contextStack = [];
  }

  /**
   * プロジェクトコンテキストに切り替え
   * @param {string} projectPath - プロジェクトのパス
   * @param {Object} options - オプション設定
   * @returns {Object} 切り替え前のコンテキスト情報
   */
  async switchContext(projectPath, options = {}) {
    // 現在のコンテキストを保存
    const currentContext = {
      cwd: process.cwd(),
      env: { ...process.env },
      timestamp: new Date().toISOString(),
      projectPath
    };

    // コンテキストスタックに追加
    this.contextStack.push(currentContext);

    try {
      // プロジェクトディレクトリの存在確認
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        throw new Error(`Project path is not a directory: ${projectPath}`);
      }

      // 作業ディレクトリの切り替え
      process.chdir(projectPath);

      // プロジェクト固有の環境変数を読み込み
      if (options.loadEnv !== false) {
        await this.loadProjectEnvironment(projectPath);
      }

      // プロジェクト固有の設定を読み込み
      if (options.loadConfig !== false) {
        await this.loadProjectConfig(projectPath);
      }

      return currentContext;
    } catch (error) {
      // エラー時は元のコンテキストに戻す
      this.contextStack.pop();
      if (currentContext.cwd !== process.cwd()) {
        process.chdir(currentContext.cwd);
      }
      throw new Error(`Failed to switch context to ${projectPath}: ${error.message}`);
    }
  }

  /**
   * コンテキストを復元
   * @param {Object} context - 復元するコンテキスト情報
   */
  async restoreContext(context) {
    if (!context) {
      throw new Error('No context provided for restoration');
    }

    try {
      // 作業ディレクトリの復元
      if (context.cwd && context.cwd !== process.cwd()) {
        process.chdir(context.cwd);
      }

      // 環境変数の復元
      if (context.env) {
        await this.restoreEnvironment(context.env);
      }

      // スタックから削除
      const stackIndex = this.contextStack.findIndex(c => c.timestamp === context.timestamp);
      if (stackIndex !== -1) {
        this.contextStack.splice(stackIndex, 1);
      }
    } catch (error) {
      throw new Error(`Failed to restore context: ${error.message}`);
    }
  }

  /**
   * 現在のコンテキストを取得
   * @returns {Object} 現在のコンテキスト情報
   */
  getCurrentContext() {
    return {
      cwd: process.cwd(),
      env: { ...process.env },
      stackDepth: this.contextStack.length
    };
  }

  /**
   * コンテキストスタックをクリア
   */
  clearContextStack() {
    this.contextStack = [];
  }

  /**
   * プロジェクト固有の環境変数を読み込み
   * @param {string} projectPath - プロジェクトのパス
   */
  async loadProjectEnvironment(projectPath) {
    const envFiles = [
      path.join(projectPath, '.env'),
      path.join(projectPath, '.env.local'),
      path.join(projectPath, '.poppo.env')
    ];

    for (const envFile of envFiles) {
      try {
        const stats = await fs.stat(envFile);
        if (stats.isFile()) {
          const envContent = await fs.readFile(envFile, 'utf8');
          this.parseAndSetEnv(envContent);
        }
      } catch (error) {
        // ファイルが存在しない場合は無視
        if (error.code !== 'ENOENT') {
          console.warn(`Warning: Failed to load env file ${envFile}: ${error.message}`);
        }
      }
    }
  }

  /**
   * プロジェクト固有の設定を読み込み
   * @param {string} projectPath - プロジェクトのパス
   */
  async loadProjectConfig(projectPath) {
    const configFiles = [
      path.join(projectPath, '.poppo', 'config.json'),
      path.join(projectPath, 'poppo.config.json'),
      path.join(projectPath, 'package.json')
    ];

    for (const configFile of configFiles) {
      try {
        const stats = await fs.stat(configFile);
        if (stats.isFile()) {
          const configContent = await fs.readFile(configFile, 'utf8');
          const config = JSON.parse(configContent);
          
          // package.jsonの場合はpoppo設定セクションを確認
          if (configFile.endsWith('package.json') && config.poppo) {
            this.applyProjectConfig(config.poppo);
          } else if (!configFile.endsWith('package.json')) {
            this.applyProjectConfig(config);
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.warn(`Warning: Failed to load config file ${configFile}: ${error.message}`);
        }
      }
    }
  }

  /**
   * 環境変数を解析して設定
   * @param {string} content - .envファイルの内容
   */
  parseAndSetEnv(content) {
    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      // コメントや空行をスキップ
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // クォートを除去
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        // 環境変数を設定（プレフィックスを付けて保護）
        process.env[`POPPO_PROJECT_${key}`] = value;
      }
    }
  }

  /**
   * プロジェクト設定を適用
   * @param {Object} config - プロジェクト設定オブジェクト
   */
  applyProjectConfig(config) {
    // 設定を環境変数として適用
    if (config.environment) {
      Object.entries(config.environment).forEach(([key, value]) => {
        process.env[`POPPO_CONFIG_${key.toUpperCase()}`] = String(value);
      });
    }

    // その他の設定も環境変数に変換
    if (config.timeout) {
      process.env.POPPO_PROJECT_TIMEOUT = String(config.timeout);
    }
    if (config.maxConcurrent) {
      process.env.POPPO_PROJECT_MAX_CONCURRENT = String(config.maxConcurrent);
    }
  }

  /**
   * 環境変数を復元
   * @param {Object} originalEnv - 元の環境変数
   */
  async restoreEnvironment(originalEnv) {
    // プロジェクト固有の環境変数を削除
    const currentKeys = Object.keys(process.env);
    for (const key of currentKeys) {
      if (key.startsWith('POPPO_PROJECT_') || key.startsWith('POPPO_CONFIG_')) {
        delete process.env[key];
      }
    }

    // 元の環境変数を復元（必要に応じて）
    // 注意: 完全な復元は複雑なため、プロジェクト固有の変数のみクリア
  }

  /**
   * 指定されたコンテキストでタスクを実行
   * @param {string} projectPath - プロジェクトのパス
   * @param {Function} task - 実行するタスク関数
   * @param {Object} options - オプション設定
   * @returns {*} タスクの実行結果
   */
  async executeInContext(projectPath, task, options = {}) {
    const context = await this.switchContext(projectPath, options);
    try {
      return await task();
    } finally {
      await this.restoreContext(context);
    }
  }

  /**
   * 複数のプロジェクトで同じタスクを実行
   * @param {Array<string>} projectPaths - プロジェクトパスの配列
   * @param {Function} task - 実行するタスク関数
   * @param {Object} options - オプション設定
   * @returns {Array} 各プロジェクトでの実行結果
   */
  async executeInMultipleContexts(projectPaths, task, options = {}) {
    const results = [];
    
    for (const projectPath of projectPaths) {
      try {
        const result = await this.executeInContext(projectPath, task, options);
        results.push({
          projectPath,
          success: true,
          result
        });
      } catch (error) {
        results.push({
          projectPath,
          success: false,
          error: error.message
        });
      }
    }
    
    return results;
  }
}

module.exports = ContextSwitcher;