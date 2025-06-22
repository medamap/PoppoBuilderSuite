/**
 * Mochaテストのセットアップファイル
 */

const sinon = require('sinon');

// 環境変数のモック
process.env.NODE_ENV = 'test'

// コンソール出力の抑制（必要に応じて）
if (process.env.SUPPRESS_CONSOLE) {
  global.console = {
    ...console,
    log: sinon.stub(),
    info: sinon.stub(),
    warn: sinon.stub(),
    error: sinon.stub(),
    debug: sinon.stub()
  }
}

// グローバルなモック設定
beforeEach(() => {
  // 各テストの前にモックをリセット
  // Mochaではsinon.restoreAll()を使用
  sinon.restore()
})

// テスト後のクリーンアップ
afterEach(() => {
  // Mochaでは特別なタイマークリアは不要
  // 必要に応じてsinon.restoreClocks()を使用
})

// グローバルなエラーハンドリング
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error)
})