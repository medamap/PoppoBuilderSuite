/**
 * Jest設定ファイル
 */

module.exports = {
  // テスト環境
  testEnvironment: 'node',

  // テストファイルのパターン
  testMatch: [
    '**/test/**/*.test.js',
    '**/test/**/*.spec.js'
  ],

  // カバレッジ対象ファイル
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/**/test-*.js'
  ],

  // カバレッジレポートの形式
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov'
  ],

  // カバレッジ出力ディレクトリ
  coverageDirectory: 'coverage',

  // カバレッジの閾値
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    },
    // 通知機能関連ファイルの個別設定
    './src/notification-manager.js': {
      branches: 85,
      functions: 85,
      lines: 85,
      statements: 85
    },
    './src/providers/*.js': {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // テストのタイムアウト（ミリ秒）
  testTimeout: 10000,

  // 詳細なエラー表示
  verbose: true,

  // テスト前に実行するセットアップファイル
  setupFilesAfterEnv: ['<rootDir>/test/setup.js'],

  // モジュールファイルの拡張子
  moduleFileExtensions: ['js', 'json', 'node'],

  // 変換を無視するパス（chai問題の対処）
  transformIgnorePatterns: [
    'node_modules/(?!(chai)/)'
  ],

  // モジュールのパスマッピング
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@test/(.*)$': '<rootDir>/test/$1'
  },

  // テスト実行時の環境変数
  testEnvironmentOptions: {
    NODE_ENV: 'test'
  },

  // グローバル変数の定義
  globals: {
    '__TEST__': true
  },

  // テスト結果のフォーマット
  reporters: [
    'default',
    [
      'jest-junit',
      {
        outputDirectory: 'test-results',
        outputName: 'junit.xml',
        suiteName: 'PoppoBuilder Notification Tests',
        classNameTemplate: '{classname}',
        titleTemplate: '{title}',
        ancestorSeparator: ' › ',
        usePathForSuiteName: true
      }
    ]
  ],

  // ウォッチモードのプラグイン
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ]
}