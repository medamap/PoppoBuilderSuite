# Redis キー名前空間設計

## 概要
PoppoBuilder Suiteで使用するRedisキーの名前空間を定義し、他のアプリケーションとの競合を防ぎます。

## 名前空間構造

### 基本フォーマット
```
poppo:{component}:{type}:{identifier}
```

### 具体例

#### 1. Issue状態管理
```redis
# Issue情報
poppo:issue:status:123          # Issue #123の状態
poppo:issue:metadata:123        # Issue #123のメタデータ

# 処理中Issue一覧
poppo:issues:processing         # 処理中Issue番号のSet
poppo:issues:completed:today    # 今日完了したIssue
```

#### 2. プロセス管理
```redis
# プロセス情報
poppo:process:info:issue-123-poppo     # プロセスの詳細情報
poppo:process:heartbeat:issue-123-poppo # ハートビート（TTL付き）

# プロセス一覧
poppo:processes:active          # アクティブなプロセス一覧
poppo:processes:zombies         # ゾンビプロセス検出用
```

#### 3. タスクキュー
```redis
# 優先度別キュー
poppo:queue:high               # 高優先度タスクキュー
poppo:queue:normal             # 通常優先度タスクキュー
poppo:queue:low                # 低優先度タスクキュー

# タスク詳細
poppo:task:info:task-123       # タスクの詳細情報
poppo:task:result:task-123     # タスクの実行結果
```

#### 4. 統計・メトリクス
```redis
# 実行統計
poppo:stats:issues:daily:2025-06-19    # 日別Issue処理統計
poppo:stats:performance:hourly          # 時間別パフォーマンス統計

# システムメトリクス
poppo:metrics:cpu:current               # 現在のCPU使用率
poppo:metrics:memory:history            # メモリ使用履歴
```

#### 5. 設定管理
```redis
# 動的設定
poppo:config:claude:timeout            # Claude APIタイムアウト
poppo:config:github:ratelimit          # GitHub APIレート制限

# フラグ管理
poppo:flags:maintenance                 # メンテナンスモードフラグ
poppo:flags:debug:enabled              # デバッグモード
```

#### 6. 通信チャンネル
```redis
# Pub/Subチャンネル
poppo:channel:mirin:requests           # ミリンちゃんへの依頼
poppo:channel:mirin:responses          # ミリンちゃんからの応答
poppo:channel:events:issue:status      # Issue状態変更イベント
```

#### 7. ロック管理
```redis
# 分散ロック
poppo:lock:issue:123                   # Issue #123の処理ロック
poppo:lock:process:migration           # マイグレーション実行ロック
poppo:lock:backup:daily                # 日次バックアップロック
```

## 名前空間のメリット

### 1. 競合防止
- 他のRedisクライアントとのキー競合を完全回避
- 将来的に他のプロジェクトが同じRedisインスタンスを使用しても安全

### 2. 管理の容易さ
```bash
# PoppoBuilder関連のキーのみを表示
redis-cli KEYS "poppo:*"

# Issue関連のキーのみを表示  
redis-cli KEYS "poppo:issue:*"

# 特定Issueのすべての情報を表示
redis-cli KEYS "poppo:*:*:123"
```

### 3. 監視とデバッグ
```bash
# 各コンポーネントの使用メモリを確認
redis-cli --bigkeys --pattern "poppo:issue:*"
redis-cli --bigkeys --pattern "poppo:process:*"

# 名前空間別の統計
redis-cli eval "return redis.call('keys', 'poppo:issue:*')" 0 | wc -l
```

### 4. バックアップと復元
```bash
# Issue関連データのみをバックアップ
redis-cli --scan --pattern "poppo:issue:*" | xargs redis-cli dump

# 特定の名前空間のみをクリーンアップ
redis-cli --scan --pattern "poppo:temp:*" | xargs redis-cli del
```

## 実装における考慮事項

### 1. キー生成ヘルパー
```javascript
class PoppoRedisKeys {
  static issue(issueNumber) {
    return {
      status: `poppo:issue:status:${issueNumber}`,
      metadata: `poppo:issue:metadata:${issueNumber}`,
      lock: `poppo:lock:issue:${issueNumber}`
    };
  }
  
  static process(processId) {
    return {
      info: `poppo:process:info:${processId}`,
      heartbeat: `poppo:process:heartbeat:${processId}`,
      lock: `poppo:lock:process:${processId}`
    };
  }
  
  static queue(priority = 'normal') {
    return `poppo:queue:${priority}`;
  }
  
  static channel(type, subtype) {
    return `poppo:channel:${type}:${subtype}`;
  }
}
```

### 2. TTL管理
```javascript
// TTL付きキーの管理
const TTL = {
  HEARTBEAT: 1800,        // 30分
  TEMP_DATA: 3600,        // 1時間  
  DAILY_STATS: 86400 * 7, // 1週間
  SESSION: 86400 * 30     // 30日
};
```

### 3. クリーンアップスクリプト
```javascript
// 期限切れデータの定期クリーンアップ
async function cleanupExpiredData() {
  const patterns = [
    'poppo:temp:*',
    'poppo:session:expired:*',
    'poppo:stats:*:old'
  ];
  
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  }
}
```

## 設定ファイルでの管理

```json
{
  "redis": {
    "namespace": "poppo",
    "keyPatterns": {
      "issue": "poppo:issue:{type}:{number}",
      "process": "poppo:process:{type}:{id}",
      "queue": "poppo:queue:{priority}",
      "stats": "poppo:stats:{category}:{period}:{date}"
    },
    "channels": {
      "mirinRequests": "poppo:channel:mirin:requests",
      "mirinResponses": "poppo:channel:mirin:responses",
      "events": "poppo:channel:events:{type}"
    },
    "ttl": {
      "heartbeat": 1800,
      "tempData": 3600,
      "stats": 604800
    }
  }
}
```

この名前空間設計により、Redisの使用が整理され、他のアプリケーションとの共存も安全に行えます。