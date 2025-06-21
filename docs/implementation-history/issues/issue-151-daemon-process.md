# Issue #151: Daemon Process Foundation Implementation

**実装日**: 2025/6/21  
**実装者**: Claude (PoppoBuilder)  
**関連Issue**: #151

## 概要
PoppoBuilderをデーモンとして動作させるための基盤を実装しました。Node.jsのclusterモジュールを使用してマスター・ワーカーアーキテクチャを構築し、複数のプロジェクトを効率的に管理できるようになりました。

## 実装内容

### 1. DaemonManager (`lib/daemon/daemon-manager.js`)
- デーモンプロセスのライフサイクル管理
- マスタープロセスとワーカープロセスの管理
- PIDファイル管理（`~/.poppobuilder/daemon.pid`）
- ワーカーの自動再起動（指数バックオフ付き）
- グレースフルシャットダウン機能
- 設定のホットリロード対応

### 2. SignalHandler (`lib/daemon/signal-handler.js`)
- システムシグナルの処理
- サポートするシグナル：
  - **SIGTERM**: グレースフルシャットダウン
  - **SIGINT**: グレースフルシャットダウン（Ctrl+C）
  - **SIGHUP**: 設定再読み込み
  - **SIGUSR1**: ステータスダンプ
  - **SIGUSR2**: カスタムアクション（予約）
- 未処理例外・Promiseリジェクションのハンドリング

### 3. Daemon CLIコマンド (`lib/commands/daemon.js`)
```bash
poppobuilder daemon start      # デーモン起動
poppobuilder daemon stop       # デーモン停止
poppobuilder daemon restart    # デーモン再起動
poppobuilder daemon status     # ステータス確認
poppobuilder daemon reload     # 設定再読み込み
```

### 4. アーキテクチャ
```
┌─────────────────────┐
│   Master Process    │
│  (Daemon Manager)   │
└──────────┬──────────┘
           │
    ┌──────┴──────┬──────────┬──────────┐
    │             │          │          │
┌───▼───┐   ┌────▼───┐  ┌───▼───┐  ┌───▼───┐
│Worker 0│   │Worker 1│  │Worker 2│  │Worker N│
└────────┘   └────────┘  └────────┘  └────────┘
```

### 5. 主要機能
- **ワーカープロセス管理**: 設定可能な数のワーカープロセスを生成
- **自動再起動**: ワーカーがクラッシュした場合、指数バックオフで再起動
- **IPC通信**: マスター・ワーカー間でメッセージング
- **リソース管理**: グローバル設定でワーカー数を制限
- **状態監視**: ワーカーの稼働時間、再起動回数を追跡

## 技術的特徴

### ワーカー管理
- 各ワーカーに一意のIDを割り当て
- 環境変数でワーカーIDとデーモンモードを通知
- ワーカーの再起動回数に応じた待機時間（1秒→2秒→4秒...最大30秒）

### プロセス間通信
ワーカーからマスターへ：
- `ready`: 準備完了通知
- `error`: エラー報告
- `metrics`: パフォーマンスメトリクス

マスターからワーカーへ：
- `shutdown`: シャットダウン要求
- `reload`: 設定再読み込み

### エラーハンドリング
- ワーカーの異常終了を検出して自動再起動
- シャットダウン中は再起動を行わない
- 未処理例外でもグレースフルシャットダウンを試行

## テスト結果
```
DaemonManager
  initialize
    ✔ should initialize global config and create directories
  start
    ✔ should start master process when not already running
    ✔ should throw error if already running
  stop
    ✔ should stop daemon and remove PID file
  isRunning
    ✔ should return true if process exists
    ✔ should return false if PID file does not exist
    ✔ should return false and remove PID file if process does not exist
  reload
    ✔ should reload configuration and notify workers
  worker management
    ✔ should fork worker with correct environment
    ✔ should handle worker exit and restart
    ✔ should not restart worker when shutting down
  getStatus
    ✔ should return daemon status

12 passing
```

## 今後の展開
このデーモンプロセス基盤は、以下の機能の土台となります：
- Issue #150: プロジェクトレジストリ（複数プロジェクト管理）
- ワーカープールによるタスク分散
- リソース制限とスケジューリング
- プロジェクト間の負荷分散