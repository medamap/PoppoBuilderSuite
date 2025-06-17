# Issue #24: レート制限対応の強化

## 概要
GitHub APIとClaude APIのレート制限を動的に監視し、自動バックオフ、リトライ戦略、優先度付きキュー管理を実装。

## 実装日
2025年6月16日

## 実装内容

### 1. GitHub APIレート制限監視
`src/github-rate-limiter.js`：
- `gh api rate_limit`を使用してレート制限状態を取得
- 使用率80%超で警告表示
- API呼び出し前の事前チェック機能
- リセット時刻までの自動待機

### 2. 統合レート制限管理
`src/enhanced-rate-limiter.js`：
- GitHub APIとClaude APIの両方を一元管理
- エクスポネンシャルバックオフ戦略の実装
  - 初期遅延: 1秒
  - 最大遅延: 5分
  - 倍率: 2倍
  - ジッター（0-10%）でランダム性を追加
- 最大5回までの自動リトライ

### 3. 優先度付きタスクキュー
`src/task-queue.js`：
- 4段階の優先度レベル
  - DOGFOODING: 100（最優先）
  - HIGH: 75
  - NORMAL: 50
  - LOW: 25
- dogfoodingタスクを自動的に最優先処理
- キューイベント（enqueued, started, completed）の発火
- 統計情報の収集（待機時間、処理数など）

### 4. GitHubクライアントの更新
`src/github-client.js`：
- すべてのAPIメソッドを非同期化
- レート制限チェック付きの`executeWithRateLimit`メソッド追加
- API呼び出し前の自動待機処理

### 5. メインループの改良
`src/minimal-poppo.js`：
- タスクキューベースの処理に変更
- レート制限中はタスクをキューに戻す
- キューの状態をリアルタイム表示
- エラー時の自動バックオフとリトライ

### 6. 設定ファイルの拡張
`config/config.json`：
```json
"rateLimiting": {
  "initialBackoffDelay": 1000,
  "maxBackoffDelay": 300000,
  "backoffMultiplier": 2,
  "backoffJitter": 0.1
},
"taskQueue": {
  "maxQueueSize": 100,
  "priorityLevels": {
    "dogfooding": 100,
    "high": 75,
    "normal": 50,
    "low": 25
  }
}
```

## テスト方法

### レート制限機能のテスト
```bash
node test/test-rate-limiting.js
```

### 実際の動作確認
```bash
# PoppoBuilderを起動
npm start

# 複数のdogfoodingタスクを作成
gh issue create --title "テスト1" --body "test" --label "task:dogfooding" --repo medamap/PoppoBuilderSuite
gh issue create --title "テスト2" --body "test" --label "task:misc" --repo medamap/PoppoBuilderSuite

# ログでキューの優先度処理を確認
tail -f logs/poppo-$(date +%Y-%m-%d).log | grep -E "(QUEUE_|優先度|レート制限)"
```

### GitHub APIレート制限の確認
```bash
gh api rate_limit
```

## 技術的な詳細

### バックオフ計算
`遅延 = 前回遅延 × 倍率 + ジッター`

### 優先度判定
`task:dogfooding`ラベルは自動的に最高優先度

### レート制限監視
1分ごとに最新情報を自動取得

### キューサイズ制限
デフォルト100タスク（設定変更可能）

## 動作確認済み項目
- ✅ GitHub APIレート制限の動的取得
- ✅ エクスポネンシャルバックオフの計算
- ✅ dogfoodingタスクの優先処理
- ✅ レート制限エラー時の自動リトライ
- ✅ キューの状態表示とイベント発火

## 成果
- APIレート制限による処理停止を回避
- 重要なタスクを優先的に処理
- システムの安定性と信頼性が向上

## 技術的なポイント
- エクスポネンシャルバックオフによる効率的なリトライ
- 優先度キューによる重要タスクの確実な処理
- レート制限の事前検知による予防的対応

## 今後の改善予定
- APIコール数の予測機能
- 複数GitHubトークンのサポート
- より詳細なメトリクス収集
- ダッシュボードでのレート制限状態表示

## 関連ドキュメント
- **機能説明**: `docs/features/rate-limiting.md`
- **テストスクリプト**: `test/test-rate-limiting.js`

## 関連Issue
- Issue #23: プロセス管理ダッシュボード（レート制限状態の可視化）
- Issue #26: 動的タイムアウト制御（レート制限との連携）