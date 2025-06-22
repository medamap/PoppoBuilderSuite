/**
 * テスト環境マネージャー
 * CCTAエージェントが使用するテスト環境の管理
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const Redis = require('ioredis');

class TestEnvironmentManager {
  constructor(config = {}) {
    this.config = {
      testDBNumber: 15, // テスト用Redis DB番号
      tempDir: path.join(process.cwd(), '.test-temp'),
      isolation: true, // テストの分離実行
      cleanup: true, // テスト後のクリーンアップ
      ...config
    };
    
    this.environments = new Map();
  }

  /**
   * テスト環境の作成
   */
  async createEnvironment(projectPath, testId) {
    const envId = `test-${testId}-${Date.now()}`;
    const env = {
      id: envId,
      projectPath,
      tempDir: path.join(this.config.tempDir, envId),
      redisNamespace: `test:${envId}`,
      processes: [],
      startTime: new Date()
    };

    // 一時ディレクトリ作成
    await fs.mkdir(env.tempDir, { recursive: true });

    // 環境変数の設定
    env.variables = {
      NODE_ENV: 'test',
      TEST_ENV_ID: envId,
      TEMP_DIR: env.tempDir,
      REDIS_TEST_NAMESPACE: env.redisNamespace,
      REDIS_DB: this.config.testDBNumber,
      CI: 'true', // CI環境をシミュレート
      ...this.getProjectSpecificEnv(projectPath)
    };

    this.environments.set(envId, env);
    return env;
  }

  /**
   * プロジェクト固有の環境変数を取得
   */
  getProjectSpecificEnv(projectPath) {
    const env = {};
    
    // .env.testファイルがあれば読み込む
    const envTestPath = path.join(projectPath, '.env.test');
    try {
      if (require('fs').existsSync(envTestPath)) {
        const envContent = require('fs').readFileSync(envTestPath, 'utf8');
        envContent.split('\n').forEach(line => {
          const [key, value] = line.split('=');
          if (key && value) {
            env[key.trim()] = value.trim();
          }
        });
      }
    } catch (error) {
      // エラーは無視
    }

    return env;
  }

  /**
   * テストの実行前準備
   */
  async prepareTestRun(env, testCommand) {
    // Redisのテストデータをクリア
    if (this.config.isolation) {
      await this.clearRedisTestData(env.redisNamespace);
    }

    // 依存関係のチェック
    await this.checkDependencies(env.projectPath);

    // テスト用データベースのセットアップ
    await this.setupTestDatabase(env);

    return true;
  }

  /**
   * Redisのテストデータをクリア
   */
  async clearRedisTestData(namespace) {
    try {
      const redis = new Redis({
        db: this.config.testDBNumber,
        lazyConnect: true
      });
      
      await redis.connect();
      const keys = await redis.keys(`${namespace}:*`);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      await redis.quit();
    } catch (error) {
      // Redisが使えない場合は無視
    }
  }

  /**
   * 依存関係のチェック
   */
  async checkDependencies(projectPath) {
    const packageJsonPath = path.join(projectPath, 'package.json');
    
    try {
      await fs.access(packageJsonPath);
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      // node_modulesの存在確認
      const nodeModulesPath = path.join(projectPath, 'node_modules');
      try {
        await fs.access(nodeModulesPath);
      } catch (error) {
        // 依存関係のインストールが必要
        await this.installDependencies(projectPath);
      }
    } catch (error) {
      throw new Error(`プロジェクトの依存関係チェックに失敗: ${error.message}`);
    }
  }

  /**
   * 依存関係のインストール
   */
  async installDependencies(projectPath) {
    return new Promise((resolve, reject) => {
      const npm = spawn('npm', ['ci', '--production=false'], {
        cwd: projectPath,
        stdio: 'pipe'
      });

      npm.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm ci failed with code ${code}`));
        }
      });
    });
  }

  /**
   * テスト用データベースのセットアップ
   */
  async setupTestDatabase(env) {
    // プロジェクトにtest-setup.jsがあれば実行
    const setupPath = path.join(env.projectPath, 'test', 'setup.js');
    
    try {
      await fs.access(setupPath);
      return new Promise((resolve, reject) => {
        const setup = spawn('node', [setupPath], {
          cwd: env.projectPath,
          env: { ...process.env, ...env.variables },
          stdio: 'pipe'
        });

        setup.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Test setup failed with code ${code}`));
          }
        });
      });
    } catch (error) {
      // セットアップファイルがない場合は何もしない
    }
  }

  /**
   * テスト環境のクリーンアップ
   */
  async cleanupEnvironment(envId) {
    const env = this.environments.get(envId);
    if (!env) return;

    // プロセスの終了
    for (const proc of env.processes) {
      if (proc && !proc.killed) {
        proc.kill('SIGTERM');
      }
    }

    // 一時ディレクトリの削除
    if (this.config.cleanup) {
      try {
        await fs.rm(env.tempDir, { recursive: true, force: true });
      } catch (error) {
        // エラーは無視
      }
    }

    // Redisデータのクリーンアップ
    await this.clearRedisTestData(env.redisNamespace);

    this.environments.delete(envId);
  }

  /**
   * すべての環境をクリーンアップ
   */
  async cleanupAll() {
    const promises = [];
    for (const envId of this.environments.keys()) {
      promises.push(this.cleanupEnvironment(envId));
    }
    await Promise.all(promises);
  }

  /**
   * テスト結果の保存パスを取得
   */
  getResultPath(env, filename) {
    return path.join(env.tempDir, 'results', filename);
  }

  /**
   * テストカバレッジの保存パスを取得
   */
  getCoveragePath(env) {
    return path.join(env.tempDir, 'coverage');
  }
}

module.exports = TestEnvironmentManager;