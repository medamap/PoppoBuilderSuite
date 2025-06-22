/**
 * テスト環境ヘルパー
 * テスト実行時の独立した環境を提供
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class TestEnvironment {
  constructor(testName = 'test') {
    this.testName = testName;
    this.testRunId = crypto.randomBytes(8).toString('hex');
    this.basePath = path.join(os.tmpdir(), 'poppobuilder', 'test', this.testRunId);
    this.paths = {
      root: this.basePath,
      state: path.join(this.basePath, 'state'),
      data: path.join(this.basePath, 'data'),
      logs: path.join(this.basePath, 'logs'),
      temp: path.join(this.basePath, 'temp'),
      config: path.join(this.basePath, 'config')
    };
    this.cleanupHandlers = [];
  }

  /**
   * テスト環境のセットアップ
   */
  async setup() {
    // ディレクトリ作成
    for (const dir of Object.values(this.paths)) {
      await fs.mkdir(dir, { recursive: true });
    }
    
    // 環境変数の設定
    this.originalEnv = { ...process.env };
    process.env.POPPOBUILDER_TEST_MODE = 'true';
    process.env.POPPOBUILDER_BASE_DIR = this.basePath;
    process.env.POPPOBUILDER_TEMP_DIR = this.paths.temp;
    
    // デフォルト設定ファイルの作成
    await this.createDefaultConfig();
    
    return this;
  }

  /**
   * デフォルト設定ファイルの作成
   */
  async createDefaultConfig() {
    const defaultConfig = {
      github: {
        owner: 'test-owner',
        repo: 'test-repo'
      },
      claude: {
        maxConcurrent: 1,
        timeout: 5000
      },
      polling: {
        interval: 60000
      },
      test: true
    };
    
    await fs.writeFile(
      path.join(this.paths.config, 'config.json'),
      JSON.stringify(defaultConfig, null, 2)
    );
  }

  /**
   * ファイルパスの取得
   */
  getPath(type, filename = '') {
    if (!this.paths[type]) {
      throw new Error(`Unknown path type: ${type}`);
    }
    return path.join(this.paths[type], filename);
  }

  /**
   * 一時ファイルの作成
   */
  async createTempFile(content = '', extension = 'txt') {
    const filename = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}.${extension}`;
    const filepath = this.getPath('temp', filename);
    await fs.writeFile(filepath, content);
    return filepath;
  }

  /**
   * 状態ファイルの作成
   */
  async createStateFile(filename, content = {}) {
    const filepath = this.getPath('state', filename);
    await fs.writeFile(filepath, JSON.stringify(content, null, 2));
    return filepath;
  }

  /**
   * モックログファイルの作成
   */
  async createLogFile(filename, lines = []) {
    const filepath = this.getPath('logs', filename);
    const content = lines.map(line => {
      if (typeof line === 'string') {
        return line;
      }
      return JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'INFO',
        category: 'test',
        message: line.message || 'Test log entry',
        ...line
      });
    }).join('\n');
    
    await fs.writeFile(filepath, content);
    return filepath;
  }

  /**
   * クリーンアップハンドラーの登録
   */
  onCleanup(handler) {
    this.cleanupHandlers.push(handler);
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    // カスタムクリーンアップハンドラーの実行
    for (const handler of this.cleanupHandlers) {
      try {
        await handler();
      } catch (error) {
        console.error('Cleanup handler error:', error);
      }
    }
    
    // 環境変数の復元
    if (this.originalEnv) {
      process.env = this.originalEnv;
    }
    
    // テストディレクトリの削除
    try {
      await fs.rm(this.basePath, { recursive: true, force: true });
    } catch (error) {
      console.error('Failed to remove test directory:', error);
    }
  }

  /**
   * ファイルの存在確認
   */
  async exists(filepath) {
    try {
      await fs.access(filepath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * ディレクトリ内のファイル一覧
   */
  async listFiles(type) {
    const dir = this.paths[type];
    if (!dir) {
      throw new Error(`Unknown path type: ${type}`);
    }
    
    try {
      return await fs.readdir(dir);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }
}

/**
 * Mochaグローバルフック
 */
const setupTestEnvironment = () => {
  let testEnv;
  
  beforeEach(async function() {
    // テスト名からテスト環境を作成
    const testName = this.currentTest?.title || 'unknown';
    testEnv = new TestEnvironment(testName);
    await testEnv.setup();
    
    // テストコンテキストに環境を追加
    this.testEnv = testEnv;
  });
  
  afterEach(async function() {
    // テスト環境のクリーンアップ
    if (testEnv) {
      await testEnv.cleanup();
      testEnv = null;
    }
  });
};

module.exports = {
  TestEnvironment,
  setupTestEnvironment
};