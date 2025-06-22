# Redis移行計画 - PoppoBuilder状態管理の抜本的改善

## 背景

現在のFileStateManagerによるJSONファイルベースの状態管理は以下の問題を抱えています：

1. **パフォーマンスボトルネック**
   - ファイルI/Oの頻発
   - ロック機構による待機時間
   - アトミック操作の複雑さ

2. **並行処理の限界**
   - 複数tmuxセッションでの競合
   - ロックタイムアウトエラー
   - デッドロックリスク

3. **将来的な拡張性**
   - マルチプロジェクト対応（ぽっぽ学園）
   - 分散処理の必要性

## Redis導入のメリット

### 1. パフォーマンス向上
```
ファイルI/O: 10-50ms → Redis: 0.1-1ms（10-50倍高速化）
```

### 2. アトミック操作
```redis
# Issue状態の安全な更新
MULTI
HSET issue:123 status processing
HSET issue:123 pid 12345
HSET issue:123 startTime 2025-06-19T10:00:00Z
EXEC
```

### 3. TTL（有効期限）による自動クリーンアップ
```redis
# 30分でハートビートが自動失効
SETEX heartbeat:issue-123 1800 "alive"
```

### 4. Pub/Sub による通知
```redis
# 状態変更をリアルタイム通知
PUBLISH issue:status:changed '{"issue": 123, "status": "completed"}'
```

## 新しいアーキテクチャ

### RedisStateManager
```javascript
class RedisStateManager {
  constructor() {
    this.redis = new Redis({
      host: 'localhost',
      port: 6379,
      retryDelayOnFailover: 100,
      maxRetriesPerRequest: 3
    });
  }

  // Issue状態管理
  async checkoutIssue(issueNumber, processId, taskType) {
    const multi = this.redis.multi();
    multi.hset(`issue:${issueNumber}`, {
      status: 'processing',
      processId,
      pid: process.pid,
      taskType,
      startTime: new Date().toISOString()
    });
    multi.setex(`heartbeat:${processId}`, 1800, 'alive'); // 30分TTL
    multi.sadd('processing_issues', issueNumber);
    const result = await multi.exec();
    
    if (!result.every(([err]) => !err)) {
      throw new Error('Issue checkout failed');
    }
    
    // 状態変更を通知
    await this.redis.publish('issue:status:changed', JSON.stringify({
      issue: issueNumber,
      status: 'processing',
      processId
    }));
  }

  // ハートビート更新
  async updateHeartbeat(processId) {
    await this.redis.setex(`heartbeat:${processId}`, 1800, 'alive');
  }

  // 孤児Issue検出
  async findOrphanedIssues() {
    const processingIssues = await this.redis.smembers('processing_issues');
    const orphaned = [];
    
    for (const issueNumber of processingIssues) {
      const issueData = await this.redis.hgetall(`issue:${issueNumber}`);
      if (!issueData.processId) continue;
      
      const heartbeat = await this.redis.get(`heartbeat:${issueData.processId}`);
      if (!heartbeat) {
        orphaned.push({
          issue: issueNumber,
          processId: issueData.processId,
          lastSeen: issueData.startTime
        });
      }
    }
    
    return orphaned;
  }
}
```

## データ構造設計

### 1. Issue状態
```redis
# Hash: issue:123
HSET issue:123 status processing
HSET issue:123 processId issue-123
HSET issue:123 pid 12345
HSET issue:123 taskType dogfooding
HSET issue:123 startTime 2025-06-19T10:00:00Z
```

### 2. ハートビート
```redis
# String with TTL: heartbeat:process-id
SETEX heartbeat:issue-123 1800 "alive"
```

### 3. 処理中Issue一覧
```redis
# Set: processing_issues
SADD processing_issues 123 456 789
```

### 4. プロセス管理
```redis
# Hash: process:issue-123
HSET process:issue-123 pid 12345
HSET process:issue-123 host "MacBook-Pro"
HSET process:issue-123 tmuxSession "poppo-builder-main"
```

## 移行戦略

### Phase 1: Redis環境構築
```bash
# Homebrew でRedisをインストール
brew install redis

# 起動とサービス登録
brew services start redis

# 設定ファイルの調整（必要に応じて）
/opt/homebrew/etc/redis.conf
```

### Phase 2: RedisStateManagerの実装
1. `src/redis-state-manager.js`の作成
2. 基本的なCRUD操作の実装
3. ハートビート機構の実装
4. ユニットテストの作成

### Phase 3: 段階的移行
1. 既存のFileStateManagerと並行運用
2. 読み取り操作からRedisに移行
3. 書き込み操作をRedisに移行
4. FileStateManagerの削除

### Phase 4: 高度な機能
1. Pub/Sub通知の実装
2. クラスター対応（将来の拡張）
3. パフォーマンス監視
4. 障害復旧機能

## パフォーマンス予測

| 操作 | 現在(JSON) | Redis | 改善率 |
|------|------------|-------|--------|
| Issue状態取得 | 5-15ms | 0.1-0.5ms | 10-30倍 |
| 状態更新 | 20-50ms | 0.5-2ms | 10-25倍 |
| 孤児Issue検出 | 100-500ms | 5-20ms | 5-25倍 |
| ハートビート更新 | 10-30ms | 0.1-1ms | 10-30倍 |

## Redis設定例

```conf
# /opt/homebrew/etc/redis.conf
maxmemory 256mb
maxmemory-policy allkeys-lru
save 900 1
save 300 10
save 60 10000
appendonly yes
appendfsync everysec
```

## 注意事項

### 1. 依存関係の追加
```json
{
  "dependencies": {
    "ioredis": "^5.3.2"
  }
}
```

### 2. 障害時の対応
- Redis停止時のフォールバック機能
- 接続エラー時の再試行機構
- データ永続化の保証

### 3. メモリ使用量
- Issue数に比例してメモリ使用量増加
- TTLによる自動クリーンアップで管理

## コスト・ベネフィット分析

### コスト
- Redis学習コスト: 低（設定がシンプル）
- 運用コスト: 低（Homebrewで簡単管理）
- メモリ使用量: 微増（100-200MB程度）

### ベネフィット
- パフォーマンス大幅改善
- 並行処理の安定性向上
- 将来的な拡張性確保
- 運用の簡素化

## 結論

Redis導入により、現在の状態管理の問題点を根本的に解決し、将来的な「ぽっぽ学園」への拡張も容易になります。初期導入コストは低く、得られるメリットが大きいため、強く推奨します。