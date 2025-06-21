# E2E（エンドツーエンド）テストガイド

## 概要

PoppoBuilder SuiteのE2Eテストは、システム全体の動作を実際の使用シナリオに基づいて検証します。単体テストでは検出できない統合的な問題を発見し、ユーザー体験の品質を保証します。

## テストフレームワーク

### 使用技術
- **Mocha**: テストランナー
- **Chai**: アサーションライブラリ
- **Playwright**: ブラウザ自動化（ダッシュボードテスト）
- **Supertest**: HTTPテスト
- **Nock**: APIモック

## ディレクトリ構造

```
test/e2e/
├── config/
│   └── test.env          # テスト用環境変数
├── fixtures/             # テストデータ
├── helpers/
│   ├── api-mocks.js      # APIモックヘルパー
│   └── test-environment.js # テスト環境管理
├── scenarios/            # テストシナリオ
│   ├── issue-processing.test.js
│   ├── multi-agent-collaboration.test.js
│   ├── dashboard-operations.test.js
│   └── config-and-recovery.test.js
├── temp/                 # 一時ファイル（テスト実行時に作成）
└── index.js             # E2Eテストランナー
```

## テストシナリオ

### 1. 基本的なIssue処理フロー
- 新規Issue作成から処理完了まで
- コメント追加による再処理
- エラー発生時のリトライ動作
- レート制限への対応
- 並行処理の制御

### 2. マルチエージェント連携
- PoppoBuilder → CCLA → CCAG の連携
- エラー検出から自動修復まで
- ドキュメント生成フロー
- エージェント間メッセージング
- 循環参照の防止

### 3. ダッシュボード操作
- ログイン認証
- プロセス監視と制御
- ログ検索とエクスポート
- リアルタイム更新（WebSocket）

### 4. 設定管理フロー
- 設定変更と動的反映
- 環境変数による上書き
- 設定バリデーション

### 5. エラーリカバリー
- プロセスクラッシュからの復旧
- レート制限への対応
- 並行処理の競合解決
- データベース破損からの復旧

## 実行方法

### 全テストの実行
```bash
npm run test:e2e
```

### 特定のシナリオのみ実行
```bash
# Issue処理テストのみ
npm run test:e2e:grep "Issue処理"

# マルチエージェントテストのみ
npm run test:e2e:grep "multi-agent"
```

### デバッグモード
```bash
# tempディレクトリを保持してデバッグ
npm run test:e2e:debug
```

### 環境変数の設定
```bash
# カスタム環境変数を使用
E2E_KEEP_TEMP=true npm run test:e2e
```

## テスト環境の設定

### 1. 環境変数ファイル
`test/e2e/config/test.env`を編集してテスト環境をカスタマイズできます：

```env
# テスト用ポート
DASHBOARD_PORT=4001
WEBHOOK_PORT=4002

# タイムアウト設定
CLAUDE_TIMEOUT_MS=5000
PROCESS_TIMEOUT_MS=10000

# 並行処理数
MAX_CONCURRENT_PROCESSES=2
```

### 2. APIモックの設定
`test/e2e/helpers/api-mocks.js`でAPIレスポンスをカスタマイズ：

```javascript
// カスタムレスポンスの追加
apiMocks.githubMock
  .get('/repos/medamap/PoppoBuilderSuite/issues/999')
  .reply(200, customIssueData);
```

## CI/CD統合

### GitHub Actions
`.github/workflows/e2e-tests.yml`で自動実行：

- PRマージ時に自動実行
- 毎日定期実行（回帰テスト）
- 複数Node.jsバージョンでテスト
- テスト失敗時のアーティファクト保存

### 手動実行
```bash
# GitHub ActionsでE2Eテストを手動実行
# Actions → E2E Tests → Run workflow
```

## トラブルシューティング

### よくある問題

#### 1. ポート競合
```bash
# エラー: EADDRINUSE: address already in use
# 解決方法:
lsof -i :4001
kill -9 <PID>
```

#### 2. タイムアウトエラー
```javascript
// テストファイルでタイムアウトを延長
this.timeout(120000); // 2分に設定
```

#### 3. モックが機能しない
```javascript
// モックのデバッグ
apiMocks.githubMock.log(console.log);
```

### デバッグ方法

#### 1. ログの確認
```bash
# テスト実行後のログ確認
cat test/e2e/temp/logs/*.log
```

#### 2. データベースの確認
```bash
# SQLiteデータベースの内容確認
sqlite3 test/e2e/temp/test.db
.tables
SELECT * FROM process_history;
```

#### 3. スクリーンショット
```javascript
// Playwrightでスクリーンショットを保存
await page.screenshot({ path: 'test/e2e/screenshots/error.png' });
```

## ベストプラクティス

### 1. テストの独立性
- 各テストは独立して実行可能にする
- テスト間で状態を共有しない
- 必ずクリーンアップを実行

### 2. 適切なモック
- 外部APIは必ずモック化
- エラーケースも含める
- レスポンスは現実的に

### 3. 待機とタイムアウト
```javascript
// 明示的な待機より条件待機を使用
await testEnv.waitForProcess(process, /起動しました/, 10000);

// ポーリングで状態を確認
await waitFor(() => {
  return someCondition === true;
}, { timeout: 5000, interval: 500 });
```

### 4. アサーション
```javascript
// 具体的なアサーション
expect(response.body.processes).to.have.length.greaterThan(0);
expect(logContent).to.include('Issue #100');

// 複数の条件を確認
expect(process).to.satisfy((p) => {
  return p.status === 'running' && p.memory < 500;
});
```

## 拡張方法

### 新しいシナリオの追加

1. `test/e2e/scenarios/`に新しいテストファイルを作成
2. `test/e2e/index.js`のTEST_SCENARIOSに追加
3. 必要に応じてヘルパーを拡張

### カスタムヘルパーの作成
```javascript
// test/e2e/helpers/custom-helper.js
class CustomHelper {
  async setupCustomEnvironment() {
    // カスタム環境のセットアップ
  }
}

module.exports = CustomHelper;
```

## パフォーマンス考慮事項

### 並列実行
```javascript
// 独立したテストは並列実行可能
describe.parallel('並列実行可能なテスト', () => {
  // テストケース
});
```

### リソース管理
- プロセスは確実に終了させる
- ファイルハンドルを閉じる
- メモリリークに注意

## 今後の拡張予定

1. **ビジュアルリグレッションテスト**
   - ダッシュボードのUI変更検出
   - スクリーンショット比較

2. **パフォーマンステスト**
   - 負荷テストシナリオ
   - レスポンスタイム測定

3. **セキュリティテスト**
   - 認証・認可のテスト
   - セキュリティスキャン統合

4. **モバイル対応テスト**
   - レスポンシブデザインの検証
   - タッチ操作のシミュレーション