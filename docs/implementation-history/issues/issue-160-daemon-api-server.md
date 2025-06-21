# Issue #160: Daemon API Server Implementation

**実装日**: 2025/6/21  
**実装者**: Claude (PoppoBuilder)  
**関連Issue**: #160

## 概要

PoppoBuilderのマルチプロジェクト管理システムにおいて、CLIコマンドとデーモンプロセス間の通信を可能にするRESTful APIサーバーを実装しました。Issue #151で実装したDaemonManagerを拡張し、WebSocket通信によるリアルタイム更新機能も提供します。

## 実装内容

### 1. DaemonAPIServer (`lib/daemon/api-server.js`)

#### 主要機能
- **RESTful API**: デーモンプロセスの制御とステータス取得
- **WebSocket通信**: リアルタイムイベント通知とコマンド実行
- **API Key認証**: セキュアな通信のための認証機構
- **統合管理**: ProjectRegistryとGlobalConfigManagerとの連携

#### API エンドポイント
```
GET  /health                      # ヘルスチェック（認証不要）
GET  /api/info                    # API情報取得
GET  /api/daemon/status           # デーモンステータス取得
POST /api/daemon/start            # デーモン開始
POST /api/daemon/stop             # デーモン停止
POST /api/daemon/restart          # デーモン再起動
POST /api/daemon/reload           # 設定再読み込み
GET  /api/workers                 # ワーカー一覧取得
POST /api/workers/:pid/restart    # 特定ワーカー再起動
GET  /api/projects                # プロジェクト一覧取得
GET  /api/projects/:id            # プロジェクト詳細取得
POST /api/projects/:id/enable     # プロジェクト有効化
POST /api/projects/:id/disable    # プロジェクト無効化
GET  /api/config                  # グローバル設定取得
POST /api/config                  # グローバル設定更新
```

#### WebSocket機能
- **イベント購読**: daemon、worker、configイベントの購読
- **コマンド実行**: WebSocket経由でのデーモンコマンド実行
- **リアルタイム通知**: プロセス状態変更の即座通知
- **接続管理**: Ping/Pong、自動切断検知

#### セキュリティ機能
- **API Key認証**: 64文字のランダムAPIキー生成
- **CORS設定**: ローカルホストのみアクセス許可
- **接続制限**: 認証済みクライアントのみWebSocket接続
- **ファイル権限**: APIキーファイルの読み取り専用設定

### 2. DaemonAPIClient (`lib/daemon/api-client.js`)

#### 主要機能
- **HTTP通信**: Axiosベースの高レベルAPIクライアント
- **自動リトライ**: 接続失敗時の指数バックオフリトライ
- **WebSocket統合**: リアルタイム通信とイベント購読
- **認証管理**: APIキーの自動読み込みと認証ヘッダー設定

#### クライアントメソッド
```javascript
// 基本操作
await client.initialize()
await client.isRunning()
await client.waitForDaemon(timeout)

// デーモン制御
await client.getInfo()
await client.getStatus()
await client.startDaemon()
await client.stopDaemon()
await client.restartDaemon()
await client.reloadDaemon()

// ワーカー管理
await client.getWorkers()
await client.restartWorker(pid)

// プロジェクト管理
await client.getProjects()
await client.getProject(id)
await client.enableProject(id)
await client.disableProject(id)

// 設定管理
await client.getConfig()
await client.updateConfig(config)

// WebSocket
await client.connectWebSocket()
client.subscribeToEvents(['daemon', 'worker'])
client.sendCommand('status')
```

#### エラーハンドリング
- **HTTP エラー**: ステータスコード別の詳細エラーメッセージ
- **接続エラー**: ECONNREFUSED時の分かりやすいメッセージ
- **認証エラー**: 401 Unauthorizedの適切な処理
- **タイムアウト**: 設定可能なリクエストタイムアウト

### 3. DaemonCommand (`lib/commands/daemon.js`)

#### 主要機能
- **統合CLI**: start、stop、restart、status、reload、logsサブコマンド
- **出力形式**: テキストとJSON形式の両対応
- **詳細表示**: ワーカー情報、API情報、リソース使用状況
- **デタッチモード**: バックグラウンド実行とフォアグラウンド実行

#### コマンド例
```bash
# デーモン開始（デタッチモード）
poppobuilder daemon start

# デーモン開始（フォアグラウンド）
poppobuilder daemon start --no-detach

# 詳細ステータス表示
poppobuilder daemon status --verbose

# JSON形式でステータス取得
poppobuilder daemon status --json

# 設定再読み込み
poppobuilder daemon reload

# デーモン停止
poppobuilder daemon stop
```

### 4. DaemonManagerの拡張 (`lib/daemon/daemon-manager.js`)

#### 追加機能
- **API Server統合**: DaemonAPIServerの自動起動と停止
- **イベント転送**: DaemonManagerイベントのAPIサーバーへの転送
- **ワーカー管理**: 個別ワーカーの再起動機能
- **状態監視**: APIサーバー情報を含むステータス取得

#### 新しいメソッド
```javascript
async startApiServer()        // APIサーバー開始
async stopApiServer()         // APIサーバー停止
async restart()               // デーモン再起動
getWorkerCount()              // ワーカー数取得
getWorkers()                  // ワーカーMap取得
restartWorker(pid)            // 特定ワーカー再起動
```

### 5. デーモンランナー (`scripts/daemon-runner.js`)

#### 機能
- **独立実行**: デーモンプロセスの独立実行環境
- **シグナル処理**: SIGINT、SIGTERMによるグレースフル終了
- **エラー処理**: uncaughtException、unhandledRejectionの適切な処理
- **プロセス管理**: PIDファイル管理とプロセス監視

### 6. CLIエントリーポイントの更新 (`bin/poppobuilder.js`)

#### 統合内容
- **daemonコマンド**: DaemonCommandクラスの統合
- **オプション追加**: --json、--verbose、--detach、--no-detachオプション
- **エラーハンドリング**: 詳細なエラー情報とスタックトレース表示

### 7. 包括的テストスイート (`test/daemon-api-server.test.js`)

#### テスト項目
- **初期化テスト**: オプション設定とAPIキー管理
- **ライフサイクルテスト**: サーバー開始と停止
- **HTTP APIテスト**: 全エンドポイントの動作確認
- **WebSocketテスト**: 接続、認証、メッセージング
- **認証テスト**: APIキー認証の各種パターン
- **エラーハンドリングテスト**: 各種エラー条件の処理
- **ブロードキャストテスト**: WebSocketメッセージの配信

## 技術的特徴

### アーキテクチャ設計
- **分離された責任**: APIサーバー、クライアント、コマンドの明確な分離
- **イベント駆動**: EventEmitterベースの疎結合アーキテクチャ
- **非同期処理**: Promise/async-awaitによる非ブロッキング処理
- **エラー境界**: 各レイヤーでの適切なエラーハンドリング

### セキュリティ考慮
- **認証機構**: 強力なAPIキーによる認証
- **ネットワーク制限**: ローカルホストのみのアクセス許可
- **ファイル権限**: APIキーファイルの適切な権限設定
- **入力検証**: APIリクエストの適切なバリデーション

### パフォーマンス最適化
- **接続プール**: Axiosインスタンスによる接続再利用
- **WebSocket効率**: 単一接続による双方向通信
- **リトライ機構**: 指数バックオフによる効率的リトライ
- **メモリ管理**: 接続の適切なクリーンアップ

### 拡張性
- **プラガブル設計**: 新しいAPIエンドポイントの簡易追加
- **イベントベース**: 新しいイベントタイプの容易な統合
- **設定駆動**: 環境に応じた柔軟な設定変更
- **クロスプラットフォーム**: Windows、macOS、Linux対応

## 使用例

### 基本的なデーモン操作
```bash
# デーモン開始
poppobuilder daemon start

# ステータス確認
poppobuilder daemon status

# 設定変更後のリロード
poppobuilder daemon reload

# デーモン停止
poppobuilder daemon stop
```

### プログラマティックアクセス
```javascript
const DaemonAPIClient = require('./lib/daemon/api-client');

const client = new DaemonAPIClient();
await client.initialize();

// デーモンステータス取得
const status = await client.getStatus();
console.log('Workers:', status.workers.length);

// WebSocket接続とイベント購読
await client.connectWebSocket();
client.subscribeToEvents(['daemon']);

client.on('ws-event', (event) => {
  console.log('Daemon event:', event);
});
```

### API直接呼び出し
```bash
# APIキー取得
API_KEY=$(cat ~/.poppobuilder/daemon.key)

# ステータス取得
curl -H "X-API-Key: $API_KEY" http://localhost:45678/api/daemon/status

# プロジェクト一覧
curl -H "X-API-Key: $API_KEY" http://localhost:45678/api/projects
```

## テスト結果

```
Daemon API Server
  Initialization
    ✔ should initialize with default options
    ✔ should accept custom options
  API Key Management
    ✔ should load existing API key
    ✔ should generate new API key if file does not exist
    ✔ should generate cryptographically strong API keys
  Server Lifecycle
    ✔ should start and stop server successfully
    ✔ should emit events on start and stop
  HTTP API Endpoints
    Health Check
      ✔ should respond to health check without authentication
    API Info
      ✔ should return API information
      ✔ should require authentication
    Daemon Control
      ✔ should handle daemon start request
      ✔ should handle daemon stop request
      ✔ should handle daemon restart request
      ✔ should handle daemon reload request
      ✔ should get daemon status
    Worker Management
      ✔ should list workers
      ✔ should restart specific worker
    Error Handling
      ✔ should handle 404 for unknown endpoints
      ✔ should handle daemon manager errors
  WebSocket Communication
    ✔ should accept WebSocket connections with valid API key
    ✔ should reject WebSocket connections with invalid API key
    ✔ should send connection confirmation message
    ✔ should handle subscription messages
  Authentication Middleware
    ✔ should authenticate valid API key in header
    ✔ should authenticate valid API key in authorization header
    ✔ should reject invalid API key
    ✔ should reject missing API key
  Broadcasting
    ✔ should broadcast messages to all connected clients
    ✔ should clean up closed connections during broadcast
  Server Info
    ✔ should return correct server information

30 passing (250ms)
```

## 依存関係

この実装は以下のコンポーネントに依存しています：
- **Issue #151**: DaemonManager - プロセスライフサイクル管理
- **Issue #150**: ProjectRegistry - プロジェクト情報管理
- **Issue #149**: GlobalConfigManager - グローバル設定管理
- Express.js - HTTP サーバーフレームワーク
- WebSocket (ws) - リアルタイム通信
- Axios - HTTP クライアント

## 今後の展開

このDaemon API Serverの実装により、以下の機能への基盤が整いました：
- **リモート管理**: 複数のPoppoBuilderインスタンスの統合管理
- **モニタリング**: 外部監視システムとの統合
- **WebUI**: ブラウザベースの管理インターフェース
- **CI/CD統合**: ビルドパイプラインからのAPI制御

## ファイル一覧

- `lib/daemon/api-server.js` - メインのAPIサーバー実装
- `lib/daemon/api-client.js` - APIクライアントライブラリ
- `lib/commands/daemon.js` - デーモン管理CLIコマンド
- `scripts/daemon-runner.js` - デーモンプロセスランナー
- `lib/daemon/daemon-manager.js` - APIサーバー統合（更新）
- `bin/poppobuilder.js` - CLIエントリーポイント（更新）
- `test/daemon-api-server.test.js` - 包括的テストスイート
- `docs/implementation-history/issues/issue-160-daemon-api-server.md` - 実装ドキュメント

## 破壊的変更

- 新機能のため、既存機能への影響なし
- DaemonManagerクラスにAPIサーバー統合機能を追加
- CLIコマンドに`daemon`サブコマンドを追加
- 新しい依存関係: express、ws（WebSocket）