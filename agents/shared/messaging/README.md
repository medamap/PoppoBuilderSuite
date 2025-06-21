# PoppoBuilder メッセージキューシステム

## 概要

PoppoBuilder Suite Phase 2で実装されたメッセージキューシステムは、Redisベースの堅牢なエージェント間通信を提供します。

## コンポーネント

### 1. MessageQueue (`message-queue.js`)
- Bull (Redis ベース) を使用したキュー管理
- 配信保証、リトライ、優先度付きキュー
- デッドレターキュー、遅延配信

### 2. MessageSchema (`message-schema.js`)
- メッセージフォーマットの標準化
- JSONスキーマによるバリデーション
- カスタムメッセージタイプの登録

### 3. CompatibilityLayer (`compatibility-layer.js`)
- ファイルベース↔メッセージキューの橋渡し
- 3つのモード: file, queue, hybrid
- 自動マイグレーション機能

### 4. EventBus (`event-bus.js`)
- イベント駆動アーキテクチャ
- パターンマッチング購読
- イベントの永続化とブロードキャスト

### 5. EnhancedAgentBase (`../enhanced-agent-base.js`)
- AgentBaseの拡張版
- メッセージキューとイベントバスの統合
- 後方互換性を維持

## クイックスタート

### 1. Redisの起動

```bash
cd PoppoBuilderSuite
docker-compose up -d redis
```

### 2. 基本的な使用例

```javascript
const EnhancedAgentBase = require('./agents/shared/enhanced-agent-base');

class MyAgent extends EnhancedAgentBase {
  constructor() {
    super('MyAgent', {
      messagingMode: 'queue',  // または 'hybrid', 'file'
      enableEvents: true
    });
  }
  
  async processTask(message) {
    // タスク処理
    return { success: true };
  }
}

const agent = new MyAgent();
await agent.initialize();
```

### 3. デモの実行

```bash
node examples/messaging-demo.js
```

## 詳細ドキュメント

- [移行ガイド](../../../docs/messaging-migration-guide.md)
- [APIリファレンス](./api-reference.md) *(TODO)*
- [ベストプラクティス](./best-practices.md) *(TODO)*

## トラブルシューティング

### Redis接続エラー
```bash
docker-compose ps  # Redisの状態確認
redis-cli ping     # 接続テスト
```

### メッセージの欠落
- hybridモードで両方のシステムを確認
- デッドレターキューをチェック
- ログファイルで詳細を確認

## 設定

`config/config.json`:
```json
{
  "messaging": {
    "mode": "hybrid",
    "redis": {
      "host": "localhost",
      "port": 6379
    }
  }
}
```

環境変数:
- `MESSAGING_MODE`: file | queue | hybrid
- `REDIS_HOST`: Redisホスト
- `REDIS_PORT`: Redisポート