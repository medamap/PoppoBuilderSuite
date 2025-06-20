# WebSocketリアルタイム更新機能

## 概要

PoppoBuilder Suiteのダッシュボードに、WebSocketを使用したリアルタイム更新機能を実装しました。これにより、プロセスの状態変更が即座にブラウザに反映され、よりインタラクティブな体験を提供します。

## 実装内容

### 1. サーバー側の実装 (dashboard/server/index.js)

#### 差分更新メカニズム
- プロセス状態の追跡（`processStates` Map）
- 前回の状態との比較による差分検出
- 個別のイベントメッセージ送信

#### 新しいWebSocketメッセージタイプ
- `process-added` - 新しいプロセスが開始された
- `process-updated` - プロセスの状態が更新された
- `process-removed` - プロセスが終了した
- `notification` - 通知メッセージ
- `log` - ログメッセージ

#### 通知メソッド
```javascript
// プロセス追加通知
notifyProcessAdded(process)

// プロセス更新通知
notifyProcessUpdated(process)

// プロセス削除通知
notifyProcessRemoved(processId)

// 通知メッセージ送信
sendNotification(notification)

// ログメッセージ送信
sendLogMessage(log)
```

### 2. クライアント側の実装 (dashboard/client/js/app.js)

#### 新しいメッセージハンドラー
```javascript
handleProcessAdded(process)    // 新規プロセスの追加
handleProcessUpdated(process)  // 既存プロセスの更新
handleProcessRemoved(processId) // プロセスの削除
handleLogMessage(log)          // ログメッセージ
showNotification(notification) // 通知表示
```

#### 差分DOM更新
- 既存要素の検出と更新
- アニメーション付きの追加・削除
- 効率的な部分更新

#### 接続監視機能
- 30秒ごとのPing/Pong
- 自動再接続機能
- 接続状態の表示

### 3. CSSアニメーション (dashboard/client/css/dashboard.css)

#### アニメーションクラス
- `.process-added` - スライドイン効果
- `.process-updated` - パルス効果
- `.process-removing` - スライドアウト効果

#### 通知スタイル
- `.notification` - 右上に表示される通知
- 種類別スタイル（info、success、warning、error）

### 4. ProcessStateManagerとの統合

#### EventEmitterの実装
ProcessStateManagerがEventEmitterを継承し、状態変更時にイベントを発行：
- `process-added` イベント
- `process-updated` イベント
- `process-removed` イベント

#### minimal-poppo.jsでの接続
```javascript
processStateManager.on('process-added', (process) => {
  dashboardServer.notifyProcessAdded(process);
});
```

## 使用方法

### 基本的な使用
1. PoppoBuilderを起動すると自動的にWebSocket機能が有効になります
2. ダッシュボード（http://localhost:3001）にアクセス
3. プロセスの追加・更新・削除がリアルタイムで反映されます

### テスト方法
```bash
# WebSocket機能のテスト
node test/test-websocket-updates.js
```

### 通知の送信（プログラムから）
```javascript
// 通知メッセージ
dashboardServer.sendNotification({
  type: 'info',    // info, success, warning, error
  message: 'プロセスが開始されました'
});

// ログメッセージ
dashboardServer.sendLogMessage({
  message: 'タスクを処理中...',
  level: 'info'
});
```

## 技術的詳細

### WebSocketプロトコル

#### クライアント → サーバー
```json
{
  "type": "ping"
}

{
  "type": "subscribe-logs",
  "processId": "issue-123"
}
```

#### サーバー → クライアント
```json
// プロセス追加
{
  "type": "process-added",
  "process": { /* プロセス情報 */ },
  "timestamp": "2025-06-20T10:00:00.000Z"
}

// プロセス更新
{
  "type": "process-updated",
  "process": { /* プロセス情報 */ },
  "timestamp": "2025-06-20T10:00:00.000Z"
}

// プロセス削除
{
  "type": "process-removed",
  "processId": "issue-123",
  "timestamp": "2025-06-20T10:00:00.000Z"
}

// 通知
{
  "type": "notification",
  "notification": {
    "type": "success",
    "message": "処理が完了しました"
  },
  "timestamp": "2025-06-20T10:00:00.000Z"
}
```

### パフォーマンス最適化

1. **差分更新**: 全体を再描画せず、変更部分のみ更新
2. **デバウンス**: 高頻度の更新を適切に制御
3. **メモリ効率**: 古いプロセス状態の自動クリーンアップ

## トラブルシューティング

### WebSocket接続が確立できない
- ファイアウォール設定を確認
- ポート3001が使用可能か確認
- ブラウザのコンソールでエラーを確認

### 更新が反映されない
- ProcessStateManagerのイベントが正しく発行されているか確認
- ダッシュボードサーバーのログを確認
- ブラウザの開発者ツールでWebSocketメッセージを確認

### アニメーションが動作しない
- CSSファイルが正しく読み込まれているか確認
- ブラウザがCSS animationをサポートしているか確認

## 今後の拡張

1. **ログストリーミング**: 個別プロセスのログをリアルタイム表示
2. **メトリクスグラフ**: CPU/メモリ使用率のリアルタイムグラフ
3. **フィルタリング**: プロセスタイプ別の表示フィルタ
4. **音声通知**: 重要なイベントの音声通知