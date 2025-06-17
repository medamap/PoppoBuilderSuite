# Issue #23: プロセス管理ダッシュボード

## 概要
実行中のPoppoBuilderプロセスやClaude CLIプロセスをリアルタイムで監視・制御できるWebベースのダッシュボード機能の実装。

## 実装日
2025年6月16日

## 実装内容

### 1. プロセス状態管理
`src/process-state-manager.js`：
- プロセスの実行状態をJSON形式で記録・管理
- 5秒間隔でメトリクス（CPU、メモリ、経過時間）を更新
- 24時間以上前の古いプロセス情報を自動クリーンアップ
- システム全体の統計情報を提供

### 2. ダッシュボードサーバー
`dashboard/server/index.js`：
- Express.js + WebSocketによるリアルタイム通信
- REST APIエンドポイント：
  - `/api/processes` - 全プロセス一覧
  - `/api/processes/running` - 実行中プロセス一覧
  - `/api/processes/:id` - プロセス詳細
  - `/api/system/stats` - システム統計
  - `/api/health` - ヘルスチェック

### 3. ダッシュボードUI
`dashboard/client/`：
- リアルタイムプロセス監視画面
- システム状態の可視化（正常/エラー/待機中）
- プロセスごとの詳細表示：
  - Issue番号
  - 状態（running/completed/error）
  - CPU/メモリ使用率
  - 経過時間
- WebSocketによる自動更新（5秒間隔）
- レスポンシブデザイン対応

### 4. プロセスマネージャー統合
`src/process-manager.js`：
- プロセスの開始/終了/エラーを自動記録
- タイムアウトやエラー状態も適切に記録
- プロセス出力をリアルタイムで更新

### 5. 設定追加
`config/config.json`：
```json
"dashboard": {
  "enabled": true,
  "port": 3001,
  "host": "localhost",
  "updateInterval": 5000,
  "authentication": {
    "enabled": false,
    "username": "admin",
    "password": "changeme"
  }
}
```

## 動作確認方法

### PoppoBuilderの起動
```bash
npm start
# ダッシュボードサーバーも自動的に起動します
```

### ダッシュボードへのアクセス
```bash
npm run dashboard  # ブラウザでhttp://localhost:3001を開く
# または直接アクセス: http://localhost:3001
```

### 動作確認
- プロセス一覧にPoppoBuilder-Mainが表示される
- 新しいIssueを作成すると、Claude CLIプロセスがリアルタイムで表示される
- プロセスの状態変化（実行中→完了）が自動更新される

## 技術的な詳細
- プロセス状態は`logs/process-state.json`に永続化
- WebSocket切断時は自動再接続（5秒後）
- Express.jsサーバーはポート3001で起動
- PoppoBuilder終了時にダッシュボードサーバーも自動停止

## 成果
- プロセスの可視化により問題の早期発見が可能
- リアルタイムモニタリングで運用効率が向上
- システム全体の健全性を一目で把握

## 今後の拡張予定（Phase 2-3）
- プロセスの停止・再起動機能の実装
- 詳細なCPU/メモリメトリクスの収集
- ログ検索・フィルタ機能
- アラート通知機能
- 認証機能の有効化

## 関連ドキュメント
- **設計書**: `docs/design/process-dashboard-design.md`
- **検討事項**: `docs/considerations/process-management-dashboard.md`

## 関連Issue
- Issue #24: レート制限対応の強化（ダッシュボードでの表示）
- Issue #26: 動的タイムアウト制御（プロセス管理との連携）