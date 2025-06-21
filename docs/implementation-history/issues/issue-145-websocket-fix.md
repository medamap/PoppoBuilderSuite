# Issue #145: WebSocket接続エラーの修正とダッシュボード接続安定化

## 実装日
2025/6/21

## 問題の詳細
CCSPダッシュボードでWebSocket接続エラーが発生し、リアルタイム更新機能が利用できない状態でした。ダッシュボードはモックデータでフォールバック動作していましたが、Socket.ioサーバーが未実装でした。

## 原因
1. Socket.ioサーバーライブラリが未インストール
2. ダッシュボードサーバーにSocket.io設定が未実装
3. CCSP名前空間のハンドラーが存在しない
4. CCSPのAPIエンドポイントが未実装

## 実装内容

### 1. Socket.ioのインストール
```bash
npm install socket.io --save
npm install socket.io-client --save-dev  # テスト用
```

### 2. ダッシュボードサーバーの修正 (`dashboard/server/index.js`)

#### Socket.ioサーバーの初期化
```javascript
const { Server } = require('socket.io');

// Socket.ioサーバーの初期化
this.io = new Server(this.server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});
```

#### CCSP名前空間の実装
```javascript
setupSocketIO() {
  const ccspNamespace = this.io.of('/ccsp');
  
  ccspNamespace.on('connection', (socket) => {
    // 初期状態の送信
    socket.emit('initialState', {...});
    
    // 統計情報の購読
    socket.on('subscribeStats', (interval) => {
      // 定期的にモックデータを送信
      const statsInterval = setInterval(() => {
        socket.emit('usageUpdate', {...});
        socket.emit('queueUpdate', {...});
      }, interval || 5000);
    });
  });
}
```

### 3. CCSPルーティングの追加
- `/ccsp` - CCSPダッシュボードHTML
- `/ccsp/*` - CCSPダッシュボード静的ファイル

### 4. CCSP APIエンドポイントの実装（モック）
- `GET /api/ccsp/queue/status` - キューステータス
- `GET /api/ccsp/stats/usage` - 使用統計
- `GET /api/ccsp/stats/agents` - エージェント統計
- `POST /api/ccsp/queue/pause` - キュー一時停止
- `POST /api/ccsp/queue/resume` - キュー再開
- `DELETE /api/ccsp/queue/clear` - キュークリア
- `POST /api/ccsp/control/emergency-stop` - 緊急停止

### 5. その他の修正
- logger.jsとlogger-adapter.jsの構文エラー修正（不要な署名削除）
- USE_LEGACY_LOGGER環境変数でレガシーロガーを使用

## テスト結果
```bash
# WebSocketテスト
node test/test-ccsp-websocket.js
✅ Successfully connected to CCSP namespace
📊 Subscribed to stats updates
📥 Received initial state
📈 Usage update (定期更新)
📋 Queue update (定期更新)

# API動作確認
curl http://localhost:3001/api/ccsp/queue/status
→ 正常にJSONレスポンスを返却
```

## 動作確認方法
1. ダッシュボードを起動: `USE_LEGACY_LOGGER=true node scripts/start-dashboard.js`
2. ブラウザで `http://localhost:3001/ccsp` にアクセス
3. WebSocket接続インジケータが緑色になることを確認
4. モックデータでグラフやメトリクスが更新されることを確認

## 今後の改善点
1. 実際のCCSPエージェントとの統合
2. リアルデータの取得と表示
3. WebSocket再接続の改善
4. エラーハンドリングの強化

## 受け入れ条件の達成状況
- [x] WebSocket接続エラーが解消される
- [x] リアルタイムデータ更新が正常に動作する（モックデータ）
- [x] ポート競合が発生しない
- [x] 接続失敗時も適切にフォールバックする