/**
 * Jestテストのセットアップファイル
 */

// グローバルなタイムアウト設定
jest.setTimeout(10000)

// 環境変数のモック
process.env.NODE_ENV = 'test'

// コンソール出力の抑制（必要に応じて）
if (process.env.SUPPRESS_CONSOLE) {
  global.console = {
    ...console,
    log: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  }
}

// グローバルなモック設定
beforeEach(() => {
  // 各テストの前にモックをリセット
  jest.clearAllMocks()
})

// テスト後のクリーンアップ
afterEach(() => {
  // タイマーのクリア
  jest.clearAllTimers()
})

// グローバルなエラーハンドリング
process.on('unhandledRejection', (error) => {
  console.error('Unhandled Promise Rejection:', error)
})