# ダッシュボード操作ガイド

PoppoBuilder Suiteの Web ダッシュボードの完全ガイドです。プロセス監視、ログ検索、パフォーマンス分析など、すべての機能を詳しく説明します。

## 🚀 ダッシュボードの起動

### 1. 基本的な起動方法

```bash
# ダッシュボードを起動
npm run dashboard

# カスタムポートで起動
PORT=8080 npm run dashboard

# 認証を無効化して起動（開発環境のみ）
NO_AUTH=true npm run dashboard
```

### 2. アクセス方法

```
デフォルトURL: http://localhost:3001

初期認証情報:
- ユーザー名: admin
- パスワード: poppo-admin-2024
```

### 3. 初回ログイン時の設定

1. デフォルトパスワードでログイン
2. パスワード変更画面が表示される
3. 新しいパスワードを設定（8文字以上）
4. タイムゾーン設定を確認

## 📊 メインダッシュボード

### 1. 概要ビュー

メインダッシュボードには以下の情報が表示されます：

- **システムステータス**: 全体の健全性スコア
- **アクティブプロセス**: 実行中のタスク数
- **リソース使用状況**: CPU、メモリ、ディスク
- **直近のアクティビティ**: 最新のイベント

### 2. リアルタイムメトリクス

```javascript
// 自動更新間隔の設定
{
  "dashboard": {
    "refreshInterval": 5000,  // 5秒ごとに更新
    "metrics": {
      "cpu": true,
      "memory": true,
      "network": true,
      "disk": true
    }
  }
}
```

### 3. ステータスインジケーター

- 🟢 **正常**: すべて正常に動作
- 🟡 **警告**: 注意が必要な状態
- 🔴 **エラー**: 即座の対応が必要
- ⚫ **不明**: 情報取得不可

## 🔍 プロセス管理

### 1. プロセス一覧

プロセス管理タブでは以下の操作が可能です：

#### プロセス情報の表示
- タスクID
- 種類（claude-cli、github-api等）
- ステータス（実行中、待機中、完了、エラー）
- 開始時刻と実行時間
- メモリ使用量とCPU使用率

#### フィルタリング
```
- ステータスでフィルタ: [実行中のみ] [エラーのみ] [すべて]
- タスクタイプでフィルタ: [claude-cli] [github-api] [misc]
- 時間範囲でフィルタ: [過去1時間] [今日] [過去7日]
```

### 2. プロセス制御

#### 個別プロセスの操作
- **停止**: プロセスを安全に停止
- **強制終了**: 応答しないプロセスを強制終了
- **再起動**: プロセスを再起動
- **ログ表示**: 該当プロセスのログを表示

#### 一括操作
```bash
# UIでの操作
[全て選択] → [選択したプロセスを停止]

# ショートカットキー
Ctrl+A: 全選択
Del: 選択したプロセスを停止
```

### 3. プロセス詳細ビュー

プロセスをクリックすると詳細情報が表示されます：

```
┌─────────────────────────────────────┐
│ Task ID: issue-123                  │
│ Type: claude-cli                    │
│ Status: Running                     │
│                                     │
│ Started: 2025-01-20 10:30:15       │
│ Duration: 00:05:23                  │
│                                     │
│ Memory: 125.4 MB (↑ 2.3 MB/min)   │
│ CPU: 15.2%                         │
│                                     │
│ Issue: #456 - Feature Request      │
│ Repository: medamap/PoppoBuilder   │
└─────────────────────────────────────┘
```

## 📋 ログ管理

### 1. ログ検索機能

#### 基本検索
```
検索ボックス: [キーワードを入力]
レベル: [ALL] [ERROR] [WARN] [INFO] [DEBUG]
期間: [過去1時間] [今日] [カスタム範囲]
```

#### 高度な検索
```javascript
// 検索クエリの例
level:error AND process:claude-cli
timestamp:[2025-01-20 TO 2025-01-21]
message:"timeout" OR message:"failed"
issue:123 AND NOT status:completed
```

### 2. ログビューア

#### リアルタイムログ追跡
```bash
# ライブログの有効化
[ライブ追跡] トグルをON

# 自動スクロール
[自動スクロール] チェックボックスをON
```

#### ログのフィルタリング
- プロセスIDでフィルタ
- ログレベルでフィルタ
- 正規表現でフィルタ

### 3. ログのエクスポート

```bash
# エクスポートオプション
形式: [JSON] [CSV] [プレーンテキスト]
範囲: [表示中のログ] [検索結果すべて] [カスタム範囲]
圧縮: [なし] [gzip] [zip]

# エクスポート実行
[エクスポート] ボタンをクリック
```

## 📈 パフォーマンス分析

### 1. メトリクスダッシュボード

#### システムメトリクス
- CPU使用率（リアルタイムグラフ）
- メモリ使用量（ヒープ、RSS）
- ディスクI/O
- ネットワークスループット

#### アプリケーションメトリクス
- タスク処理速度（タスク/時間）
- 平均実行時間
- 成功率とエラー率
- キュー待機時間

### 2. トレンド分析

```javascript
// グラフ設定
{
  "charts": {
    "timeRange": "24h",      // 表示期間
    "resolution": "5m",      // データポイント間隔
    "smoothing": true,       // スムージング
    "annotations": true      // イベント注釈
  }
}
```

### 3. パフォーマンスレポート

#### レポート生成
```
期間: [過去24時間] [過去7日] [過去30日] [カスタム]
メトリクス: [✓] CPU [✓] メモリ [✓] タスク統計
形式: [PDF] [HTML] [Markdown]

[レポート生成] ボタンで作成
```

#### レポート内容
- エグゼクティブサマリー
- パフォーマンストレンド
- ボトルネック分析
- 改善提案

## 🔔 アラートとモニタリング

### 1. アラート設定

#### アラートルールの作成
```javascript
// UIでの設定例
条件: メモリ使用量 > 80%
期間: 5分以上継続
アクション: [メール通知] [Slack通知] [ログ記録]
重要度: [警告] [エラー] [クリティカル]
```

### 2. 通知設定

```javascript
// 通知チャンネル設定
{
  "notifications": {
    "email": {
      "enabled": true,
      "recipients": ["admin@example.com"],
      "severity": ["error", "critical"]
    },
    "slack": {
      "enabled": true,
      "webhook": "https://hooks.slack.com/...",
      "channel": "#poppo-alerts"
    }
  }
}
```

### 3. ヘルスチェック

#### 自動ヘルスチェック
- エンドポイント監視
- プロセス生存確認
- リソース閾値チェック
- 依存サービス確認

## 🛠️ 設定管理

### 1. システム設定

#### 設定エディタ
```
[設定] → [システム設定]

編集可能な項目:
- ポーリング間隔
- タイムアウト値
- 並行実行数
- メモリ制限
```

### 2. ユーザー管理

#### ユーザーの追加
```
[設定] → [ユーザー管理] → [新規ユーザー]

必須項目:
- ユーザー名
- メールアドレス
- 初期パスワード
- ロール（管理者/オペレーター/閲覧者）
```

### 3. バックアップとリストア

```bash
# バックアップの作成
[設定] → [バックアップ] → [今すぐバックアップ]

# 自動バックアップ設定
スケジュール: 毎日 02:00
保持期間: 30日
保存先: ./backups/
```

## 🎨 カスタマイズ

### 1. ダッシュボードレイアウト

```javascript
// ウィジェットの配置変更
ドラッグ&ドロップでウィジェットを移動
右上の [⚙️] でウィジェット設定

// レイアウトの保存
[レイアウトを保存] で現在の配置を保存
```

### 2. テーマ設定

```
[設定] → [外観] → [テーマ]

利用可能なテーマ:
- ライト（デフォルト）
- ダーク
- ハイコントラスト
- カスタム
```

### 3. ショートカットキー

```
一般:
- F1: ヘルプ
- F5: 更新
- Esc: ダイアログを閉じる

ナビゲーション:
- Alt+1: ダッシュボード
- Alt+2: プロセス管理
- Alt+3: ログ
- Alt+4: パフォーマンス

操作:
- Ctrl+K: 検索
- Ctrl+S: 保存
- Ctrl+Z: 元に戻す
```

## 🔍 トラブルシューティング

### 問題: ダッシュボードにアクセスできない

```bash
# 1. サービスの確認
npm run dashboard:status

# 2. ポートの確認
lsof -i :3001

# 3. ファイアウォール設定
sudo ufw allow 3001/tcp
```

### 問題: リアルタイムデータが更新されない

```javascript
// WebSocket接続の確認
ブラウザのコンソールで:
> dashboard.ws.readyState
// 1 = OPEN が正常

// 手動再接続
> dashboard.reconnect()
```

### 問題: グラフが表示されない

```bash
# 1. データベースの確認
sqlite3 data/poppo.db "SELECT COUNT(*) FROM metrics;"

# 2. キャッシュのクリア
rm -rf dashboard/cache/*

# 3. ブラウザキャッシュのクリア
Ctrl+Shift+R (強制リロード)
```

## 📱 モバイル対応

### 1. レスポンシブデザイン

ダッシュボードは以下のデバイスに対応：
- デスクトップ（1920x1080以上推奨）
- タブレット（768px以上）
- スマートフォン（基本機能のみ）

### 2. モバイル最適化

```javascript
// モバイル用設定
{
  "dashboard": {
    "mobile": {
      "simplifiedView": true,
      "reduceAnimations": true,
      "compactMode": true
    }
  }
}
```

## 🔐 セキュリティ

### 1. アクセス制御

```javascript
// ロールベースアクセス制御
{
  "roles": {
    "admin": ["*"],
    "operator": ["view", "control", "logs"],
    "viewer": ["view", "logs:read"]
  }
}
```

### 2. 監査ログ

すべての操作は監査ログに記録されます：
- ログイン/ログアウト
- 設定変更
- プロセス操作
- データエクスポート

### 3. セッション管理

```javascript
// セッション設定
{
  "session": {
    "timeout": 3600000,        // 1時間
    "extendOnActivity": true,  // 活動時に延長
    "maxSessions": 5          // 最大同時セッション数
  }
}
```

## 🎯 まとめ

ダッシュボードを効果的に使用するポイント：

1. **定期的な監視** - 重要なメトリクスを常にチェック
2. **アラートの活用** - 問題を早期に検出
3. **ログの分析** - エラーパターンを把握
4. **パフォーマンス追跡** - トレンドから改善点を発見
5. **カスタマイズ** - 自分のワークフローに合わせて調整

詳細な技術情報は[ダッシュボード設計書](../considerations/process-management-dashboard.md)を参照してください。