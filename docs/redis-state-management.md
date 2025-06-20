# Redis状態管理システム

## 概要

Issue #102 Phase 2で実装されたRedis対応の状態管理システムです。既存のファイルベースの状態管理から、Redisバックエンドを使用した高性能で分散対応の状態管理に移行できます。

## アーキテクチャ

```
┌─────────────────────┐
│  PoppoBuilder       │
│  (main process)     │
└──────┬──────────────┘
       │
       ├── StatusManagerRedis
       │   └── UnifiedStateManagerRedis
       │       └── RedisStateClient
       │           └── MirinRedisAmbassador
       │               └── Redis
       │
       └── StateManagerFactory
           (backend selection)
```

## 主要コンポーネント

### 1. StateManagerFactory

設定に基づいて適切なバックエンドを選択するファクトリークラス。

```javascript
const StateManagerFactory = require('./src/state-manager-factory');

// 設定に基づいてStatusManagerを作成
const statusManager = StateManagerFactory.createStatusManager(config);

// バックエンドタイプの確認
const backendType = StateManagerFactory.getBackendType(config); // 'file' or 'redis'
```

### 2. UnifiedStateManagerRedis

UnifiedStateManagerのRedis版実装。

**主な機能:**
- Redisハッシュによる名前空間管理
- トランザクション処理
- 監視機能（ウォッチャー）
- 既存APIとの完全互換性

### 3. StatusManagerRedis

StatusManagerのRedis版実装。

**主な機能:**
- Issue状態の分散管理
- ハートビート機能
- 孤児Issue検出
- ラベル更新リクエスト管理

## 設定

### config.json設定例

```json
{
  "unifiedStateManagement": {
    "enabled": true,
    "backend": "redis",
    "redis": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": 6379,
      "password": null,
      "db": 0,
      "processId": null
    },
    "namespaces": {
      "issues": { "description": "Issue関連の状態" },
      "comments": { "description": "コメント関連の状態" },
      "tasks": { "description": "タスク実行状態" },
      "processes": { "description": "プロセス管理" },
      "agents": { "description": "エージェント固有データ" },
      "config": { "description": "動的設定" }
    }
  }
}
```

### 設定パラメータ

| パラメータ | 説明 | デフォルト |
|-----------|------|-----------|
| `backend` | 使用するバックエンド (`file` or `redis`) | `file` |
| `redis.enabled` | Redisバックエンドの有効化 | `false` |
| `redis.host` | Redisサーバーのホスト | `127.0.0.1` |
| `redis.port` | Redisサーバーのポート | `6379` |
| `redis.password` | Redis認証パスワード | `null` |
| `redis.db` | 使用するRedisデータベース番号 | `0` |
| `redis.processId` | プロセス識別子 | `null` (自動生成) |

## 使用方法

### 1. ファイルベースからRedisへの切り替え

```bash
# 1. Redisサーバーを起動
docker-compose up -d redis

# 2. 設定ファイルを更新
# config/config.json の "backend" を "redis" に変更し、
# "redis.enabled" を true に設定

# 3. PoppoBuilderを再起動
npm start
```

### 2. プログラムでの使用

```javascript
const StateManagerFactory = require('./src/state-manager-factory');
const config = require('./config/config.json');

// StatusManagerの作成
const statusManager = StateManagerFactory.createStatusManager(config);
await statusManager.initialize();

// Issue処理
await statusManager.checkout(123, 'process-1', 'test-task');
await statusManager.updateHeartbeat(123);
await statusManager.checkin(123, 'completed', { result: 'success' });

// UnifiedStateManagerの作成
const stateManager = StateManagerFactory.createUnifiedStateManager(config);
await stateManager.initialize();

// データ操作
await stateManager.set('custom', 'key', { value: 'data' });
const data = await stateManager.get('custom', 'key');
```

## データ構造

### Redisキー構造

```
poppo:state:{namespace}     # 名前空間データ（ハッシュ）
poppo:issue:status:{id}     # Issue状態（ハッシュ）
poppo:issue:metadata:{id}   # Issueメタデータ（ハッシュ）
poppo:lock:issue:{id}       # Issueロック（文字列）
poppo:process:info:{id}     # プロセス情報（ハッシュ）
poppo:process:heartbeat:{id} # プロセスハートビート（文字列）
poppo:issues:processing     # 処理中Issue一覧（セット）
poppo:issues:processed      # 処理済みIssue一覧（セット）
poppo:processes:active      # アクティブプロセス一覧（セット）
```

## テスト

### 単体テスト

```bash
# Redis状態管理のテスト
npm run test:redis:state

# 統合テスト
npm test test/redis-state-manager.test.js
```

### デモスクリプト

```bash
# Redis状態管理デモの実行
npm run demo:redis
```

## パフォーマンス

### Redis vs ファイル比較

| 操作 | ファイル | Redis | 改善率 |
|------|---------|-------|-------|
| 読み取り | ~10ms | ~1ms | 10x |
| 書き込み | ~15ms | ~2ms | 7.5x |
| トランザクション | ~50ms | ~5ms | 10x |
| 並行処理 | 制限あり | 高性能 | 無制限 |

### メモリ使用量

- **ファイルベース**: プロセスあたり ~50MB
- **Redis**: 共有メモリ ~100MB (全プロセス共通)

## トラブルシューティング

### Redis接続エラー

```bash
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**解決方法:**
```bash
# Redisサーバーの起動
docker-compose up -d redis

# または
redis-server
```

### メモリ不足エラー

```bash
Error: OOM command not allowed when used memory > 'maxmemory'
```

**解決方法:**
```bash
# Redisメモリ制限の確認・変更
redis-cli CONFIG GET maxmemory
redis-cli CONFIG SET maxmemory 1gb
```

### データ移行エラー

**症状**: 既存のファイルベースデータが見つからない

**解決方法:**
1. バックアップを取得
2. マイグレーションフラグをリセット
3. 手動でデータを移行

```javascript
// マイグレーションフラグリセット
await stateManager.delete('config', 'statusManagerMigrated');
```

## マイグレーション

### ファイル → Redis

1. **設定変更前にバックアップ**
   ```bash
   npm run backup:create -- --name "before-redis-migration"
   ```

2. **設定変更**
   ```json
   {
     "unifiedStateManagement": {
       "backend": "redis",
       "redis": { "enabled": true }
     }
   }
   ```

3. **マイグレーション実行**
   - 初回起動時に自動実行
   - 既存ファイルはバックアップされる

### Redis → ファイル

1. **データエクスポート**
   ```bash
   npm run demo:redis -- --export backup.json
   ```

2. **設定変更**
   ```json
   {
     "unifiedStateManagement": {
       "backend": "file"
     }
   }
   ```

3. **データインポート**
   ```bash
   npm run import -- backup.json
   ```

## 監視とメトリクス

### Redis統計情報

```bash
# Redis接続数とメモリ使用量
redis-cli INFO clients
redis-cli INFO memory

# PoppoBuilder固有の統計
redis-cli EVAL "return redis.call('keys', 'poppo:*')" 0
```

### ダッシュボード統合

Redis状態管理は既存のダッシュボードと完全に統合されています：

- **プロセス監視**: リアルタイム状態追跡
- **統計情報**: Issue処理統計
- **ログ検索**: 分散ログ検索

## セキュリティ

### Redis認証

```json
{
  "unifiedStateManagement": {
    "redis": {
      "password": "your-secure-password",
      "host": "redis.internal.domain"
    }
  }
}
```

### ネットワークセキュリティ

- Redis ACL設定の推奨
- TLS暗号化（Redis 6.0+）
- ファイアウォール設定

## 今後の予定

- [ ] Redis Cluster対応
- [ ] Redis Sentinel対応  
- [ ] 暗号化ストレージ
- [ ] 自動フェイルオーバー
- [ ] 分散ロック強化