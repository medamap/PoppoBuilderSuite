# PoppoBuilder Suite 統合テスト

このディレクトリには、PoppoBuilder Suiteの主要機能の統合テストが含まれています。

## テストスイート

### 1. CCTA統合テスト (`test-ccta-integration.js`)
Code Change Test Agent (CCTA) の動作を検証します：
- エージェントの起動確認
- テストランナーの動作確認
- カバレッジレポーターの動作確認
- パフォーマンステスターの動作確認
- レポート生成の動作確認
- PoppoBuilderとの連携確認

### 2. WebSocket統合テスト (`test-websocket-integration.js`)
ダッシュボードのWebSocketリアルタイム更新機能を検証します：
- ダッシュボードサーバーの起動確認
- WebSocket接続の確立
- リアルタイム更新の動作確認
- 差分更新の動作確認
- 複数クライアントの同期

### 3. GitHub Projects統合テスト (`test-github-projects-integration.js`)
GitHub Projects v2との統合機能を検証します：
- GitHubProjectsClientの基本動作
- StatusManagerとの連携
- 双方向同期の動作確認
- レポート生成機能
- エラー処理とリトライ

## テストの実行

### すべてのテストを実行
```bash
npm run test:integration
```

または

```bash
node test/integration/run-all-tests.js
```

### 個別のテストを実行
```bash
# CCTA統合テスト
node test/integration/test-ccta-integration.js

# WebSocket統合テスト
node test/integration/test-websocket-integration.js

# GitHub Projects統合テスト
node test/integration/test-github-projects-integration.js
```

## 環境設定

統合テストの実行には以下の環境変数が必要な場合があります：

```bash
# GitHub API関連（オプション）
export GITHUB_TOKEN=your_github_token
export GITHUB_PROJECT_ID=your_project_id

# テスト環境
export NODE_ENV=test
```

## テストヘルパー

`test-helper.js` には、統合テストで使用する共通のユーティリティ関数が含まれています：

- **プロセス管理**: テスト用プロセスの起動と終了
- **一時ファイル管理**: テスト用の一時ディレクトリとファイルの作成・削除
- **待機処理**: ファイルの作成やログ出力を待機
- **HTTP/WebSocket**: HTTPリクエストとWebSocket接続のヘルパー
- **モック作成**: GitHubクライアントなどのモック作成
- **設定生成**: テスト用の設定オブジェクト生成

## テストレポート

テスト実行後、以下のレポートファイルが生成されます：

- `test-report.json`: JSON形式の詳細なテスト結果
- `test-report.md`: Markdown形式の読みやすいレポート

## CI/CD統合

これらの統合テストは、GitHub Actionsなどの CI/CD パイプラインに組み込むことができます：

```yaml
# .github/workflows/integration-tests.yml
name: Integration Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm install
      - run: npm run test:integration
      - uses: actions/upload-artifact@v3
        if: always()
        with:
          name: test-reports
          path: test/integration/test-report.*
```

## トラブルシューティング

### ポート競合
テストでダッシュボードサーバーを起動する際、ポート競合が発生する場合があります。
テストヘルパーはランダムなポートを使用するため、通常は問題ありませんが、
必要に応じて環境変数でポートを指定できます。

### タイムアウト
一部のテストは外部サービスとの通信を含むため、ネットワーク環境によってはタイムアウトする場合があります。
必要に応じてタイムアウト値を調整してください。

### 依存モジュール
統合テストの実行には以下のモジュールが必要です：
- ws (WebSocket)
- jest (テストランナー)
- mocha (テストランナー)
- puppeteer (パフォーマンステスト用)

不足している場合は `npm install` で追加インストールしてください。