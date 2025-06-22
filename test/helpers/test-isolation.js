/**
 * テスト分離ヘルパー
 * 各テストケースが互いに影響しないよう分離実行をサポート
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

class TestIsolation {
  constructor() {
    this.isolatedDirs = new Set();
    this.originalEnv = {};
    this.mocks = new Map();
  }

  /**
   * 分離されたテスト環境を作成
   */
  createIsolatedEnvironment(testName) {
    const envId = `${testName}-${uuidv4()}`;
    const isolatedDir = path.join(__dirname, '../../.test-isolated', envId);
    
    // ディレクトリ作成
    fs.mkdirSync(isolatedDir, { recursive: true });
    this.isolatedDirs.add(isolatedDir);

    // 必要なサブディレクトリ作成
    const subdirs = ['state', 'logs', '.poppo/locks', 'config'];
    subdirs.forEach(dir => {
      fs.mkdirSync(path.join(isolatedDir, dir), { recursive: true });
    });

    // 基本的な設定ファイルをコピー
    this.copyConfigFiles(isolatedDir);

    return {
      id: envId,
      dir: isolatedDir,
      stateDir: path.join(isolatedDir, 'state'),
      logsDir: path.join(isolatedDir, 'logs'),
      configDir: path.join(isolatedDir, 'config')
    };
  }

  /**
   * 設定ファイルをコピー
   */
  copyConfigFiles(targetDir) {
    const configSource = path.join(__dirname, '../../config/config.json');
    const configDest = path.join(targetDir, 'config/config.json');
    
    if (fs.existsSync(configSource)) {
      const config = JSON.parse(fs.readFileSync(configSource, 'utf8'));
      
      // テスト用に設定を調整
      config.logLevel = 'error';
      config.dashboard = { ...config.dashboard, enabled: false };
      config.notifications = { ...config.notifications, enabled: false };
      
      fs.writeFileSync(configDest, JSON.stringify(config, null, 2));
    }
  }

  /**
   * 環境変数を分離
   */
  isolateEnvironmentVariables(overrides = {}) {
    // 現在の環境変数を保存
    const keysToSave = Object.keys(overrides);
    keysToSave.forEach(key => {
      this.originalEnv[key] = process.env[key];
    });

    // 新しい値を設定
    Object.assign(process.env, overrides);

    return () => this.restoreEnvironmentVariables();
  }

  /**
   * 環境変数を復元
   */
  restoreEnvironmentVariables() {
    Object.keys(this.originalEnv).forEach(key => {
      if (this.originalEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = this.originalEnv[key];
      }
    });
    this.originalEnv = {};
  }

  /**
   * モジュールをモック
   */
  mockModule(modulePath, mockImplementation) {
    const resolvedPath = require.resolve(modulePath);
    
    // 元のモジュールを保存
    if (!this.mocks.has(resolvedPath)) {
      this.mocks.set(resolvedPath, require.cache[resolvedPath]);
    }

    // モックに置き換え
    require.cache[resolvedPath] = {
      exports: mockImplementation,
      filename: resolvedPath,
      loaded: true
    };

    return () => this.restoreModule(modulePath);
  }

  /**
   * モジュールを復元
   */
  restoreModule(modulePath) {
    const resolvedPath = require.resolve(modulePath);
    const original = this.mocks.get(resolvedPath);
    
    if (original) {
      require.cache[resolvedPath] = original;
    } else {
      delete require.cache[resolvedPath];
    }
  }

  /**
   * すべてのモックを復元
   */
  restoreAllMocks() {
    this.mocks.forEach((original, resolvedPath) => {
      if (original) {
        require.cache[resolvedPath] = original;
      } else {
        delete require.cache[resolvedPath];
      }
    });
    this.mocks.clear();
  }

  /**
   * クリーンアップ
   */
  cleanup() {
    // 環境変数の復元
    this.restoreEnvironmentVariables();
    
    // モックの復元
    this.restoreAllMocks();
    
    // 分離ディレクトリの削除
    this.isolatedDirs.forEach(dir => {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (error) {
        // エラーは無視
      }
    });
    this.isolatedDirs.clear();
  }

  /**
   * テストケースを分離実行
   */
  async runIsolated(testName, testFn) {
    const env = this.createIsolatedEnvironment(testName);
    const restoreEnv = this.isolateEnvironmentVariables({
      TEST_ISOLATION: 'true',
      TEST_ENV_ID: env.id,
      POPPO_STATE_DIR: env.stateDir,
      POPPO_LOGS_DIR: env.logsDir,
      POPPO_CONFIG_DIR: env.configDir
    });

    try {
      await testFn(env);
    } finally {
      restoreEnv();
      // 即座にクリーンアップしない（デバッグ用）
      if (process.env.KEEP_TEST_ENV !== 'true') {
        setTimeout(() => {
          try {
            fs.rmSync(env.dir, { recursive: true, force: true });
          } catch (error) {
            // エラーは無視
          }
        }, 1000);
      }
    }
  }
}

// シングルトンインスタンス
const isolation = new TestIsolation();

// プロセス終了時のクリーンアップ
process.on('exit', () => {
  isolation.cleanup();
});

module.exports = {
  isolation,
  runIsolated: isolation.runIsolated.bind(isolation),
  createIsolatedEnvironment: isolation.createIsolatedEnvironment.bind(isolation),
  isolateEnvironmentVariables: isolation.isolateEnvironmentVariables.bind(isolation),
  mockModule: isolation.mockModule.bind(isolation)
};