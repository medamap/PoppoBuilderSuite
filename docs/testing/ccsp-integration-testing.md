# CCSP統合テスト実装ガイド

Issue #144: CCSP移行の統合テストとバリデーション計画の実装完了

## 📋 概要

PoppoBuilder SuiteにおけるCCSP（Claude Code Spawner）移行の成功を検証するための包括的なテストスイートが実装されました。この文書では、実装されたテストフレームワークと各テストスイートについて説明します。

## 🏗️ テストアーキテクチャ

### テストフレームワーク構成

```
test/ccsp/
├── framework/               # 共通テストフレームワーク
│   ├── test-framework.js   # メインテストフレームワーク
│   └── mocks/              # モックサービス
│       ├── mock-claude-cli.js    # Claude CLI モック
│       ├── mock-redis.js         # Redis モック
│       └── mock-github-api.js    # GitHub API モック
├── validation/             # テストスイート
│   ├── rate-limit-simulation.js # レート制限テスト
│   ├── unit-tests.js            # 単体テスト
│   ├── integration-tests.js     # 統合テスト
│   └── e2e-scenarios.js         # E2Eシナリオテスト
├── run-all-tests.js        # 統合テストランナー
└── reports/               # テストレポート出力
```

## 🧪 テストスイート詳細

### 1. レート制限シミュレーションテスト

**ファイル**: `test/ccsp/validation/rate-limit-simulation.js`

**目的**: CCSP移行により、Claude APIのレート制限が適切に処理されるかを検証

**テストケース**:
- CCSP Rate Limit Detection - レート制限の検出
- Emergency Stop on Rate Limit - 緊急停止機能
- Multiple Clients Rate Limit Handling - 複数クライアントでの制限処理
- Rate Limit Recovery - レート制限からの回復
- Queue Processing During Rate Limit - 制限中のキュー処理

### 2. 単体テスト

**ファイル**: `test/ccsp/validation/unit-tests.js`

**目的**: CCSPエージェントのコアコンポーネントの個別機能テスト

**テストケース**:
- Claude Executor - 基本リクエスト処理
- Claude Executor - レート制限ハンドリング
- Claude Executor - セッションタイムアウト検出
- Queue Processor - リクエストキューイング
- Queue Processor - 優先度処理
- Queue Processor - 緊急停止
- Session Monitor - ヘルスチェック
- Session Monitor - タイムアウト回復
- CCSP Agent - コンポーネント統合
- CCSP Agent - 設定管理

### 3. 統合テスト

**ファイル**: `test/ccsp/validation/integration-tests.js`

**目的**: PoppoBuilder → CCSP フローの統合テスト

**テストケース**:
- PoppoBuilder to CCSP Communication - 基本通信
- Multi-Agent CCSP Usage - マルチエージェント使用
- Error Handling and Recovery - エラー処理と回復
- Concurrent Request Processing - 並行リクエスト処理
- Request Timeout and Retry Logic - タイムアウトとリトライ
- Performance and Throughput - パフォーマンスとスループット
- Data Integrity and Message Format - データ整合性
- CCSP Agent Lifecycle Management - ライフサイクル管理

### 4. エンドツーエンドシナリオテスト

**ファイル**: `test/ccsp/validation/e2e-scenarios.js`

**目的**: 実際の使用シナリオを模擬したエンドツーエンドテスト

**テストケース**:
- GitHub Issue Processing Workflow - Issue処理ワークフロー
- Multi-Agent Collaboration Scenario - マルチエージェント協調
- Error Recovery and Resilience - エラー回復とレジリエンス
- High Load Production Simulation - 高負荷本番シミュレーション
- Session Management and Recovery - セッション管理と回復
- Resource Exhaustion and Throttling - リソース枯渇とスロットリング
- Long-Running Complex Task Processing - 長時間複雑タスク処理
- Disaster Recovery and State Persistence - 災害復旧と状態永続化

## 🏃 テスト実行方法

### 全テストスイートの実行

```bash
# 全テストスイートを実行
npm run test:ccsp

# または直接実行
node test/ccsp/run-all-tests.js
```

### 個別テストスイートの実行

```bash
# 単体テストのみ
npm run test:ccsp:unit

# 統合テストのみ
npm run test:ccsp:integration

# E2Eテストのみ
npm run test:ccsp:e2e

# レート制限テストのみ
npm run test:ccsp:rate-limit
```

### オプション付き実行

```bash
# 特定のスイートのみ実行
node test/ccsp/run-all-tests.js --suite "Unit Tests"

# 一部をスキップ
node test/ccsp/run-all-tests.js --skip "e2e,integration"

# 最初のエラーで停止
node test/ccsp/run-all-tests.js --bail

# レポート生成を無効化
node test/ccsp/run-all-tests.js --no-report

# ヘルプ表示
node test/ccsp/run-all-tests.js --help
```

## 📊 モックサービス

### Mock Claude CLI

**機能**:
- 実際のClaude APIを呼び出さずにテスト実行
- レート制限、セッションタイムアウト、一般的なエラーのシミュレーション
- カスタムレスポンスの設定
- リクエスト履歴の記録

**使用例**:
```javascript
const mockClaude = mockServices.get('claude');
mockClaude.setResponse('rateLimitError', {
  code: 1,
  stdout: 'Claude AI usage limit reached|' + unlockTime,
  stderr: 'Rate limit exceeded'
});
```

### Mock Redis

**機能**:
- インメモリRedis機能の完全実装
- 全Redis命令のサポート（SET/GET/LPUSH/RPOP等）
- レイテンシーとエラーのシミュレーション
- 統計情報の収集

**使用例**:
```javascript
const redis = mockServices.get('redis');
await redis.lpush('ccsp:requests', JSON.stringify(request));
const response = await redis.blpop('ccsp:response:agent', 1);
```

### Mock GitHub API

**機能**:
- GitHub API呼び出しの完全モック
- Issue、コメント、ラベル操作
- レート制限シミュレーション
- テストデータの事前設定

**使用例**:
```javascript
const mockGitHub = mockServices.get('github');
const issue = await mockGitHub.getIssue(144);
await mockGitHub.createIssueComment(144, 'テストコメント');
```

## 📈 テストレポート

### 生成されるレポート形式

1. **JSON形式** (`ccsp-test-results.json`)
   - 構造化されたテスト結果データ
   - 自動処理やCI/CD統合用

2. **HTML形式** (`ccsp-test-results.html`)
   - ビジュアルなレポート
   - ブラウザで表示可能

3. **Markdown形式** (`ccsp-test-results.md`)
   - GitHub等での表示用
   - ドキュメント統合可能

### レポート内容

- **実行サマリー**: 総テスト数、成功/失敗数、実行時間
- **スイート別詳細**: 各テストスイートの結果
- **エラー詳細**: 失敗したテストのエラー情報
- **環境情報**: Node.jsバージョン、プラットフォーム等

## 🎯 品質保証指標

### 成功基準

- **テスト成功率**: 95%以上
- **レスポンス時間**: 平均30秒以内
- **スループット**: 100 requests/min以上
- **エラー回復**: 10秒以内
- **メモリ使用量**: 500MB以内

### パフォーマンス指標

- **並行処理**: 最大10並行リクエスト
- **キュー処理**: FIFO順序保証
- **状態永続化**: 100%データ保持
- **災害復旧**: 完全な状態復元

## 🔧 トラブルシューティング

### 一般的な問題と解決方法

1. **テストタイムアウト**
   ```bash
   # タイムアウトを延長
   CCSP_TEST_TIMEOUT=120000 npm run test:ccsp
   ```

2. **Redis接続エラー**
   ```bash
   # Redis設定を確認
   echo "Redis設定をチェックしてください"
   ```

3. **モックサービス初期化失敗**
   ```bash
   # 権限を確認
   ls -la test/ccsp/framework/mocks/
   ```

### デバッグモード

```bash
# デバッグログ有効化
DEBUG=ccsp:* npm run test:ccsp

# 詳細ログ出力
CCSP_TEST_VERBOSE=true npm run test:ccsp
```

## 📚 関連ドキュメント

- [Issue #144](https://github.com/medamap/PoppoBuilderSuite/issues/144) - CCSP移行の統合テストとバリデーション計画
- [CCSPアーキテクチャドキュメント](../architecture/ccsp-overview.md)
- [エージェント統合ガイド](../features/agent-integration.md)
- [テスト戦略](./test-strategy.md)

## 🎉 次のステップ

1. **継続的インテグレーション**: CI/CDパイプラインへの統合
2. **パフォーマンス監視**: 本番環境でのメトリクス収集
3. **テスト拡張**: 新機能追加時のテストケース追加
4. **ドキュメント更新**: テスト結果に基づくドキュメント改善

---

**実装完了日**: 2025/6/21  
**対応Issue**: [#144](https://github.com/medamap/PoppoBuilderSuite/issues/144)  
**実装者**: Claude Code  
**レビュー状態**: 実装完了、テスト準備完了