# PoppoBuilder Suite メモリ管理機能

## 概要

PoppoBuilder Suiteには、長時間稼働するシステムのメモリ使用量を監視し、最適化するための包括的なメモリ管理機能が実装されています。この機能は、メモリリークの検出、自動最適化、詳細なレポート生成を提供します。

## 機能構成

### 1. MemoryMonitor（メモリ監視）

継続的にメモリ使用量を監視し、問題を早期に検出します。

**主な機能**:
- リアルタイムメモリ使用量追跡
- 閾値超過アラート
- メモリリーク検出
- ヒープスナップショット自動取得
- 統計情報の収集と分析

### 2. MemoryOptimizer（メモリ最適化）

メモリ使用効率を向上させるための各種最適化戦略を実装します。

**主な機能**:
- インテリジェントキャッシュ管理
- オブジェクトプーリング
- 弱参照管理
- ストリーム処理サポート
- グローバル最適化実行

### 3. MemoryLeakDetector（メモリリーク検出）

潜在的なメモリリークを検出し、詳細な分析を提供します。

**主な機能**:
- ヒープスナップショット分析
- 成長パターン検出
- 長期保持オブジェクトの追跡
- コンストラクタ別の使用量分析

## 設定

`config/config.json`でメモリ管理機能を設定できます：

```json
{
  "memory": {
    "monitoring": {
      "enabled": true,
      "interval": 60000,              // 監視間隔（ミリ秒）
      "thresholds": {
        "heapUsed": 524288000,        // 500MB
        "heapTotal": 1073741824,      // 1GB
        "rss": 1572864000,            // 1.5GB
        "external": 104857600         // 100MB
      },
      "snapshot": {
        "enabled": true,
        "interval": 3600000,          // 1時間ごと
        "path": "./memory-snapshots"
      }
    },
    "optimization": {
      "enabled": true,
      "strategies": {
        "cacheEviction": true,
        "objectPooling": true,
        "lazyLoading": true,
        "streamProcessing": true
      },
      "cache": {
        "maxSize": 104857600,         // 100MB
        "ttl": 3600000,               // 1時間
        "checkInterval": 300000       // 5分ごと
      }
    },
    "autoOptimize": true,             // 閾値超過時の自動最適化
    "leakDetection": {
      "enabled": true,
      "checkInterval": 300000,        // 5分ごと
      "tracking": {
        "minSize": 1024,              // 1KB以上のオブジェクトを追跡
        "maxTracked": 10000,
        "retentionTime": 3600000      // 1時間以上保持で疑う
      }
    }
  }
}
```

## CLIコマンド

### メモリ状態の確認

```bash
# 現在のメモリ使用状況を表示
npm run memory:status

# または
poppo-memory status
```

出力例：
```
📊 メモリ使用状況

┌──────────────────────────────┬────────────────────┬──────────────────────────────┐
│ 項目                         │ 使用量             │ 詳細                         │
├──────────────────────────────┼────────────────────┼──────────────────────────────┤
│ RSS (Resident Set Size)      │ 245.32 MB          │ 物理メモリ使用量             │
│ Heap Total                   │ 189.45 MB          │ V8が確保したヒープサイズ     │
│ Heap Used                    │ 156.78 MB          │ 実際に使用中のヒープ         │
│ External                     │ 12.34 MB           │ V8外部のメモリ使用量         │
│ Array Buffers                │ 5.67 MB            │ ArrayBuffer使用量            │
└──────────────────────────────┴────────────────────┴──────────────────────────────┘
```

### メモリ監視

```bash
# 継続的な監視を開始
npm run memory:monitor

# 詳細モードで監視
npm run memory:monitor -- -v

# カスタム閾値で監視
npm run memory:monitor -- --heap-threshold 600 --rss-threshold 2000
```

### メモリ最適化

```bash
# 基本的な最適化を実行
npm run memory:optimize

# 深い最適化を実行（より積極的）
npm run memory:optimize -- --deep
```

### メモリリーク検出

```bash
# リーク検出を開始
npm run memory:leak-detect

# カスタム設定で検出
npm run memory:leak-detect -- --interval 60 --samples 10
```

### ヒープダンプ取得

```bash
# ヒープダンプを取得
poppo-memory heap-dump

# ファイル名を指定
poppo-memory heap-dump -o my-dump.heapsnapshot
```

### レポート生成

```bash
# メモリ分析レポートを生成
npm run memory:report

# JSON形式で出力
npm run memory:report -- --json

# ファイルに保存
npm run memory:report -- --save report.json
```

## プログラムからの使用

### 基本的な使用例

```javascript
const MemoryMonitor = require('./src/memory-monitor');
const MemoryOptimizer = require('./src/memory-optimizer');

// 監視を開始
const monitor = new MemoryMonitor({
  interval: 60000,
  thresholds: {
    heapUsed: 500 * 1024 * 1024 // 500MB
  }
});

monitor.on('threshold-exceeded', ({ alerts }) => {
  console.error('メモリ閾値超過:', alerts);
});

monitor.on('memory-leak-detected', (leakInfo) => {
  console.error('メモリリーク検出:', leakInfo);
});

await monitor.start();

// 最適化
const optimizer = new MemoryOptimizer();
const cache = optimizer.createCache('my-cache', {
  maxSize: 50 * 1024 * 1024, // 50MB
  ttl: 3600000 // 1時間
});

// キャッシュの使用
cache.set('key', 'value');
const value = cache.get('key');
```

### オブジェクトプーリング

```javascript
// 高コストなオブジェクトの再利用
const pool = optimizer.createObjectPool('connections', 
  () => createExpensiveConnection(),
  {
    maxObjects: 10,
    reset: (conn) => conn.reset()
  }
);

const conn = pool.acquire();
// 使用
await conn.query('...');
// 返却
pool.release(conn);
```

## アラートと通知

メモリ関連のイベントは、設定された通知チャンネルに送信されます：

- **メモリ閾値超過**: 設定した閾値を超えた場合
- **メモリリーク検出**: 継続的なメモリ増加を検出した場合
- **自動最適化実行**: 自動最適化が実行された場合

## パフォーマンスへの影響

メモリ監視機能自体のオーバーヘッドは最小限に抑えられています：

- CPU使用率: < 0.5%
- メモリ使用量: < 10MB（スナップショットを除く）
- 監視間隔は調整可能（デフォルト: 60秒）

## トラブルシューティング

### よくある問題

#### 1. ヒープスナップショットが大きすぎる
```bash
# スナップショット機能を無効化
# config.jsonで設定
"snapshot": {
  "enabled": false
}
```

#### 2. 頻繁な閾値超過アラート
```bash
# 閾値を調整
# config.jsonで設定
"thresholds": {
  "heapUsed": 1073741824  // 1GBに増加
}
```

#### 3. メモリリーク誤検出
```bash
# 検出感度を調整
"leakDetection": {
  "tracking": {
    "retentionTime": 7200000  // 2時間に延長
  }
}
```

## ベストプラクティス

### 1. 定期的な監視
```bash
# cronで定期実行
0 */6 * * * cd /path/to/PoppoBuilderSuite && npm run memory:report
```

### 2. 早期警告の設定
閾値を実際の限界より低く設定し、余裕を持って対処できるようにします。

### 3. キャッシュの適切な使用
```javascript
// TTLを設定してメモリリークを防ぐ
const cache = optimizer.createCache('api-cache', {
  maxSize: 100 * 1024 * 1024,
  ttl: 600000 // 10分
});
```

### 4. オブジェクトプールの活用
```javascript
// 高頻度で作成/破棄されるオブジェクトに使用
const pool = optimizer.createObjectPool('workers', 
  () => new Worker(),
  { maxObjects: 20 }
);
```

## メモリ最適化の指針

### 1. 測定と分析
まず現状を把握し、ボトルネックを特定します。

### 2. 段階的な最適化
小さな改善から始め、効果を測定しながら進めます。

### 3. 自動化
閾値超過時の自動最適化を活用します。

### 4. 継続的な監視
最適化後も継続的に監視し、改善効果を確認します。

## まとめ

PoppoBuilder Suiteのメモリ管理機能は、長時間稼働するシステムの安定性と効率性を大幅に向上させます。適切な設定と定期的な監視により、メモリ関連の問題を未然に防ぎ、システムのパフォーマンスを最適な状態に保つことができます。