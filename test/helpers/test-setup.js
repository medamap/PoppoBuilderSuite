const chai = require('chai');

// 依存関係を追加（互換性のためのバージョンチェック）
try {
    // chai-as-promisedがChaiの新しいバージョンと互換性があるかチェック
    const chaiAsPromised = require('chai-as-promised');
    if (typeof chaiAsPromised === 'function') {
        chai.use(chaiAsPromised);
        console.log('✅ chai-as-promised loaded successfully');
    } else {
        console.warn('❌ chai-as-promised: incompatible version');
    }
} catch (e) {
    console.warn('❌ chai-as-promised not available:', e.message);
}

try {
    // sinon-chaiの互換性チェック
    const sinonChai = require('sinon-chai');
    if (typeof sinonChai === 'function') {
        chai.use(sinonChai);
        console.log('✅ sinon-chai loaded successfully');
    } else {
        console.warn('❌ sinon-chai: incompatible version');
    }
} catch (e) {
    console.warn('❌ sinon-chai not available:', e.message);
}

// 重複した設定を削除

// グローバルなchai設定
chai.config.includeStack = true;
chai.config.showDiff = true;

// テスト用の共通設定
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'error'; // テスト中はログを最小限に

// 未処理の Promise rejection をキャッチ
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    // テスト環境では process.exit(1) はしない
});

// 未処理の Exception をキャッチ
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // テスト環境では process.exit(1) はしない
});

// テスト環境の自動分離機能
const { TestEnvironment } = require('./test-environment');

// テスト環境を自動的に分離する設定
const AUTO_ISOLATE = process.env.POPPOBUILDER_TEST_ISOLATE !== 'false';

if (AUTO_ISOLATE) {
  // グローバルフック
  let globalTestEnv;
  
  // 全テスト実行前
  before(async function() {
    console.log('🧪 テスト環境を準備しています...');
    
    // グローバルテスト環境の作成
    globalTestEnv = new TestEnvironment('global');
    await globalTestEnv.setup();
    
    // テスト用環境変数の設定
    process.env.POPPOBUILDER_TEST_MODE = 'true';
    process.env.POPPOBUILDER_BASE_DIR = globalTestEnv.basePath;
  });
  
  // 全テスト実行後
  after(async function() {
    console.log('🧹 テスト環境をクリーンアップしています...');
    
    // グローバルテスト環境のクリーンアップ
    if (globalTestEnv) {
      await globalTestEnv.cleanup();
    }
  });
}

// グローバル変数として公開
global.expect = chai.expect;
global.sinon = require('sinon');

// テストユーティリティ
global.testUtils = {
  /**
   * 一時的な環境変数の設定
   */
  withEnv(env, fn) {
    const original = { ...process.env };
    Object.assign(process.env, env);
    try {
      return fn();
    } finally {
      process.env = original;
    }
  },
  
  /**
   * タイムアウト付きの待機
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },
  
  /**
   * 条件が満たされるまで待機
   */
  async waitUntil(condition, timeout = 5000, interval = 100) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (await condition()) {
        return true;
      }
      await this.wait(interval);
    }
    throw new Error('Timeout waiting for condition');
  }
};

module.exports = chai;