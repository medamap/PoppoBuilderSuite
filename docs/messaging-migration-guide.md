# メッセージキューシステム移行ガイド

## 概要

PoppoBuilder Suiteは、Phase 2実装としてRedisベースのメッセージキューシステムを導入しました。これにより、エージェント間通信がより堅牢でスケーラブルになります。

## アーキテクチャ

### 旧アーキテクチャ（ファイルベース）
```
Agent A → File → Agent B
```

### 新アーキテクチャ（メッセージキュー）
```
Agent A → Redis Queue → Agent B
         ↓
    Event Bus → All Agents
```

## 主な機能

### 1. メッセージキュー（Bull/Redis）
- **配信保証**: at-least-once配信保証
- **リトライ機能**: 指数バックオフによる自動リトライ
- **デッドレターキュー**: 失敗メッセージの隔離
- **優先度付きキュー**: 0-10の優先度設定
- **遅延配信**: 指定時間後のメッセージ配信

### 2. イベントバス
- **イベント駆動**: 疎結合なイベント通信
- **パターンマッチング**: 正規表現による購読
- **永続化**: イベントの永続化オプション
- **ブロードキャスト**: 複数エージェントへの同時配信

### 3. 互換性レイヤー
- **3つのモード**:
  - `file`: 従来のファイルベース（後方互換）
  - `queue`: メッセージキューのみ
  - `hybrid`: 両方（移行期間用）
- **自動マイグレーション**: ファイルメッセージの自動移行
- **重複排除**: hybridモードでの重複メッセージ除去

## セットアップ

### 1. Redisの起動

```bash
# Docker Composeを使用
docker-compose up -d redis

# Redis Commanderも起動する場合（デバッグ用）
docker-compose --profile debug up -d
```

### 2. 環境変数の設定（オプション）

```bash
export MESSAGING_MODE=hybrid  # file, queue, hybrid
export REDIS_HOST=localhost
export REDIS_PORT=6379
```

### 3. 設定ファイルの確認

`config/config.json`に以下の設定が追加されています：

```json
{
  "messaging": {
    "mode": "hybrid",
    "redis": {
      "host": "localhost",
      "port": 6379
    },
    "eventBus": {
      "enablePersistence": true,
      "enableBroadcast": true
    }
  }
}
```

## エージェントの移行

### 既存エージェントの移行

1. **最小限の変更（互換性レイヤー使用）**
   ```javascript
   // 変更不要 - AgentBaseを使い続ける
   const AgentBase = require('../shared/agent-base');
   
   class MyAgent extends AgentBase {
     // 既存のコードはそのまま動作
   }
   ```

2. **段階的な移行（EnhancedAgentBase使用）**
   ```javascript
   // AgentBase → EnhancedAgentBaseに変更
   const EnhancedAgentBase = require('../shared/enhanced-agent-base');
   
   class MyAgent extends EnhancedAgentBase {
     constructor(config) {
       super('MyAgent', {
         messagingMode: 'hybrid',  // 移行期間中
         ...config
       });
     }
     
     async onInitialize() {
       // イベントの購読
       this.subscribeEvent('ISSUE_PROCESSED', async (event) => {
         console.log('Issue処理完了:', event.payload);
       });
     }
   }
   ```

### 新規エージェントの作成

```javascript
const EnhancedAgentBase = require('../shared/enhanced-agent-base');

class NewAgent extends EnhancedAgentBase {
  constructor() {
    super('NewAgent', {
      messagingMode: 'queue',  // 新規は直接queueモード
      enableEvents: true
    });
  }
  
  async processTask(message) {
    // タスク処理
    await this.reportProgress(message.taskId, 50, '処理中...');
    
    // イベント発行
    await this.publishEvent('CUSTOM_EVENT', {
      data: 'some data'
    });
    
    return { success: true };
  }
}
```

## イベントの使用

### イベントの発行

```javascript
// 標準イベント
await this.publishEvent('ISSUE_PROCESSED', {
  issueNumber: 123,
  repository: 'medamap/PoppoBuilderSuite',
  result: { success: true }
});

// カスタムイベント
await this.publishEvent('MY_CUSTOM_EVENT', {
  customData: 'value'
}, {
  priority: 8,
  broadcast: true,
  targets: ['ccla', 'ccag']
});
```

### イベントの購読

```javascript
// 特定イベントの購読
const unsubscribe = this.subscribeEvent('ERROR_OCCURRED', async (event) => {
  if (event.payload.severity === 'critical') {
    // クリティカルエラーの処理
  }
});

// パターンマッチング購読
this.subscribeEventPattern('TASK_.*', async (eventType, event) => {
  console.log(`タスクイベント: ${eventType}`);
});
```

## 監視とデバッグ

### 1. キューの状態確認

```javascript
const stats = await messageQueue.getQueueStats('poppo:ccla');
console.log(stats);
// {
//   queue: 'poppo:ccla',
//   status: 'active',
//   counts: { waiting: 5, active: 2, completed: 100, failed: 3 }
// }
```

### 2. Redis Commander

```bash
# http://localhost:8081 でアクセス
docker-compose --profile debug up -d
```

### 3. ログ確認

```bash
# メッセージキューのログ
grep "MessageQueue" logs/poppo-*.log

# 互換性レイヤーのログ
grep "CompatibilityLayer" logs/poppo-*.log
```

## トラブルシューティング

### Redis接続エラー

```bash
# Redisが起動しているか確認
docker-compose ps
redis-cli ping

# 接続テスト
node -e "require('redis').createClient().ping(console.log)"
```

### メッセージの欠落

1. **hybridモードで確認**
   ```bash
   # ファイルメッセージの確認
   ls -la messages/*/inbox/
   
   # 移行済みメッセージ
   ls -la messages/*/migrated/
   ```

2. **デッドレターキューの確認**
   ```javascript
   const dlqStats = await messageQueue.getQueueStats('poppo:ccla:dead-letter');
   ```

### パフォーマンス問題

1. **キューのバックログ確認**
2. **Redisのメモリ使用量確認**
3. **並行数の調整**

## ベストプラクティス

1. **段階的な移行**
   - まず`hybrid`モードで動作確認
   - 問題がなければ`queue`モードに移行
   - 最後に`file`モードのコードを削除

2. **エラーハンドリング**
   - リトライ可能/不可能を明確に
   - デッドレターキューの監視
   - 適切なログ記録

3. **イベント設計**
   - イベント名は明確で一貫性を保つ
   - ペイロードのスキーマを定義
   - バージョニングを考慮

4. **パフォーマンス**
   - 大きなペイロードは避ける
   - 適切な優先度設定
   - TTLを活用した自動クリーンアップ

## 今後の拡張

1. **RabbitMQサポート**
2. **メッセージ暗号化**
3. **分散トレーシング**
4. **メトリクスダッシュボード**
5. **クラスタリング対応**