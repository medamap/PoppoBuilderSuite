# PoppoBuilder Suite 統合テストガイド

## 概要

PoppoBuilder Suiteの統合テストは、複数の機能が協調して動作することを確認するためのテストスイートです。Issue #122の一環として実装され、CCTA、WebSocket、GitHub Projectsなどの主要機能の統合動作を検証します。

## テストスイートの構成

### 1. CCTA（Code Change Test Agent）統合テスト

**ファイル**: `test/integration/test-ccta-integration.js`

**テスト内容**:
- CCTAエージェントの起動と初期化
- テストランナーの各フレームワーク対応
- カバレッジレポートの生成と閾値チェック
- パフォーマンステストの実行
- レポート生成機能
- PoppoBuilderとのタスク連携

### 2. WebSocketリアルタイム更新統合テスト

**ファイル**: `test/integration/test-websocket-integration.js`

**テスト内容**:
- ダッシュボードサーバーの起動
- WebSocket接続の確立と維持
- プロセス状態のリアルタイム更新
- 差分更新によるパフォーマンス最適化
- 複数クライアント間の同期

### 3. GitHub Projects統合テスト

**ファイル**: `test/integration/test-github-projects-integration.js`

**テスト内容**:
- GitHub Projects v2 GraphQL APIの動作
- StatusManagerとの双方向同期
- プロジェクトアイテムのステータス管理
- 進捗レポートの生成
- エラー処理とリトライメカニズム

## 実行方法

### すべての統合テストを実行

```bash
npm run test:integration
```

### 個別のテストを実行

```bash
# CCTA統合テスト
npm run test:integration:ccta

# WebSocket統合テスト
npm run test:integration:websocket

# GitHub Projects統合テスト
npm run test:integration:projects
```

### テスト結果の確認

テスト実行後、以下のファイルが生成されます：

- `test/integration/test-report.json` - 詳細なJSON形式のレポート
- `test/integration/test-report.md` - 読みやすいMarkdown形式のレポート

## テストヘルパー

`test/integration/test-helper.js` は、統合テストで使用する共通のユーティリティを提供します：

### プロセス管理
```javascript
// プロセスの起動
const { proc, stdout, stderr } = await helper.startProcess('node', ['script.js']);

// プロセスの状態確認
const isRunning = helper.isProcessRunning(pid);
```

### 待機処理
```javascript
// 時間待機
await helper.wait(1000);

// ファイル作成を待機
await helper.waitForFile('/path/to/file', 5000);

// ログ出力を待機
await helper.waitForLog(proc, 'Server started', 10000);
```

### HTTP/WebSocket
```javascript
// HTTPリクエスト
const response = await helper.httpRequest('http://localhost:3000/api/health');

// WebSocket接続
const ws = await helper.createWebSocket('ws://localhost:3000/ws');
```

### モック作成
```javascript
// GitHubクライアントのモック
const github = helper.createMockGitHubClient();

// テスト用設定
const config = helper.createTestConfig({ dashboard: { port: 3002 } });
```

## 環境設定

### 必要な環境変数

```bash
# GitHub API（オプション）
export GITHUB_TOKEN=your_github_token
export GITHUB_PROJECT_ID=your_project_id

# テスト環境
export NODE_ENV=test

# ログレベル
export LOG_LEVEL=debug
```

### 依存関係

統合テストの実行には以下のnpmパッケージが必要です：

```json
{
  "devDependencies": {
    "ws": "^8.0.0",
    "jest": "^29.0.0",
    "mocha": "^10.0.0",
    "puppeteer": "^21.0.0"
  }
}
```

## CI/CD統合

### GitHub Actions設定例

```yaml
name: Integration Tests

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  integration-test:
    runs-on: ubuntu-latest
    
    services:
      redis:
        image: redis:alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run integration tests
      run: npm run test:integration
      env:
        NODE_ENV: test
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    
    - name: Upload test reports
      uses: actions/upload-artifact@v3
      if: always()
      with:
        name: integration-test-reports
        path: |
          test/integration/test-report.json
          test/integration/test-report.md
```

## トラブルシューティング

### よくある問題と解決方法

#### 1. ポート競合エラー
```
Error: listen EADDRINUSE: address already in use :::3001
```
**解決方法**: テストヘルパーはランダムポートを使用しますが、明示的にポートを指定する場合は未使用のポートを選択してください。

#### 2. タイムアウトエラー
```
Error: ファイルが作成されませんでした: /path/to/file
```
**解決方法**: `waitForFile`のタイムアウト値を増やすか、ネットワーク環境を確認してください。

#### 3. モジュールが見つからない
```
Error: Cannot find module 'ws'
```
**解決方法**: `npm install`を実行して依存関係をインストールしてください。

#### 4. 権限エラー
```
Error: EACCES: permission denied
```
**解決方法**: テストスクリプトに実行権限を付与してください：
```bash
chmod +x test/integration/*.js
```

## ベストプラクティス

### 1. テストの独立性
各テストは他のテストに依存せず、独立して実行できるようにしてください。

### 2. クリーンアップ
テスト終了時は必ずリソースをクリーンアップしてください：
```javascript
try {
  // テスト実行
} finally {
  await helper.cleanup();
}
```

### 3. 適切な待機処理
固定の`wait`時間ではなく、条件ベースの待機を使用してください：
```javascript
// 悪い例
await helper.wait(5000);

// 良い例
await helper.waitForFile(filePath, 5000);
await helper.waitForLog(proc, 'Server started');
```

### 4. エラーハンドリング
各テストでエラーを適切にキャッチし、わかりやすいメッセージを表示してください。

### 5. モックの活用
外部依存を減らすため、適切にモックを使用してください。

## 拡張方法

### 新しい統合テストの追加

1. `test/integration/test-<feature>-integration.js`を作成
2. `test-helper.js`をインポート
3. テストを実装
4. `run-all-tests.js`のテストリストに追加
5. `package.json`にスクリプトを追加

### テストヘルパーの拡張

新しいヘルパー関数が必要な場合は、`test-helper.js`に追加してください：

```javascript
class TestHelper {
  // 新しいヘルパー関数
  async customHelper() {
    // 実装
  }
}
```

## まとめ

統合テストは、PoppoBuilder Suiteの品質保証において重要な役割を果たします。新機能を追加する際は、必ず対応する統合テストも実装し、全体的な動作確認を行ってください。