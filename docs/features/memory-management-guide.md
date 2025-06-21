# メモリ管理ガイド

PoppoBuilder Suiteのメモリ使用量を監視・最適化するための包括的なガイドです。長時間実行されるプロセスのメモリリークを防ぎ、パフォーマンスを最適に保つ方法を説明します。

## 📊 メモリ監視機能

### 1. リアルタイムメモリ監視

PoppoBuilderには組み込みのメモリ監視機能があります：

```javascript
// config/config.json
{
  "monitoring": {
    "memoryCheck": {
      "enabled": true,
      "interval": 60000,  // 1分ごとにチェック
      "threshold": 500    // 500MB警告閾値
    }
  }
}
```

### 2. メモリ使用量の確認方法

#### CLIコマンドで確認
```bash
# プロセス状態とメモリ使用量を表示
npm run poppo:status

# JSON形式で詳細情報を取得
node scripts/poppo-process.js status --json | jq '.processes[].memory'
```

#### ダッシュボードで確認
```bash
# ダッシュボード起動
npm run dashboard

# ブラウザで http://localhost:3001 にアクセス
# 「プロセス管理」タブでメモリ使用量をリアルタイム監視
```

#### ログファイルで確認
```bash
# メモリ使用量のログを抽出
grep "Memory usage" logs/poppo-$(date +%Y-%m-%d).log | tail -20
```

## 🔧 メモリ最適化設定

### 1. 基本的な最適化設定

```javascript
// config/config.json
{
  "performance": {
    "maxConcurrentTasks": 3,     // 同時実行タスク数を制限
    "memoryOptimization": {
      "enabled": true,
      "gcInterval": 300000,      // 5分ごとにガベージコレクション
      "heapSnapshot": false,     // ヒープスナップショット無効化
      "maxOldSpaceSize": 1024    // 最大ヒープサイズ 1GB
    }
  }
}
```

### 2. Node.js起動オプション

```bash
# メモリ制限付きで起動
NODE_OPTIONS="--max-old-space-size=1024 --expose-gc" npm start

# メモリ使用量の詳細ログ付き
NODE_OPTIONS="--trace-gc --max-old-space-size=1024" npm start
```

### 3. 環境変数での設定

```bash
# .env ファイル
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=1024
POPPO_MAX_CONCURRENT=2
POPPO_MEMORY_CHECK_INTERVAL=30000
```

## 🚨 メモリリーク検出

### 1. 自動検出機能

PoppoBuilderは以下のパターンでメモリリークを検出します：

- **継続的な増加**: 5回連続でメモリが増加
- **急激な増加**: 前回比50%以上の増加
- **閾値超過**: 設定値を超えた場合

### 2. メモリリーク検出の確認

```bash
# メモリリーク警告を検索
grep -E "(memory leak|Memory threshold)" logs/poppo-$(date +%Y-%m-%d).log

# メモリ統計を確認
npm run analytics:stats memory
```

### 3. ヒープスナップショット分析

```javascript
// デバッグモードでヒープスナップショットを有効化
{
  "debug": {
    "heapSnapshot": {
      "enabled": true,
      "interval": 3600000,  // 1時間ごと
      "path": "./heap-snapshots"
    }
  }
}
```

```bash
# スナップショットを手動で取得
kill -USR2 $(pgrep -f "PoppoBuilder-Main")

# Chrome DevToolsで分析
# 1. chrome://inspect を開く
# 2. "Open dedicated DevTools for Node"
# 3. Memory タブでスナップショットを読み込み
```

## 💡 メモリ効率化のベストプラクティス

### 1. タスクの分割

大きなタスクは小さく分割して処理：

```javascript
// 悪い例
const allIssues = await github.getAllIssues(); // 全Issue取得

// 良い例
const pageSize = 100;
for (let page = 1; ; page++) {
  const issues = await github.getIssues({ page, per_page: pageSize });
  if (issues.length === 0) break;
  await processIssues(issues);
}
```

### 2. 適切なクリーンアップ

```javascript
// タスク完了後のクリーンアップ
async function cleanupAfterTask(taskId) {
  // イベントリスナーの削除
  emitter.removeAllListeners(`task-${taskId}`);
  
  // 大きなオブジェクトの参照解除
  largeDataCache.delete(taskId);
  
  // 手動GC（有効な場合）
  if (global.gc) {
    global.gc();
  }
}
```

### 3. ストリーム処理の活用

```javascript
// ファイル処理でストリームを使用
const stream = fs.createReadStream('large-file.log');
const rl = readline.createInterface({ input: stream });

rl.on('line', (line) => {
  // 1行ずつ処理
  processLine(line);
});
```

## 🔄 自動メモリ管理機能

### 1. 自動ガベージコレクション

```javascript
// src/memory-manager.js の設定
class MemoryManager {
  constructor(config) {
    this.config = config;
    this.setupAutoGC();
  }

  setupAutoGC() {
    if (this.config.memoryOptimization.enabled && global.gc) {
      setInterval(() => {
        const before = process.memoryUsage().heapUsed;
        global.gc();
        const after = process.memoryUsage().heapUsed;
        logger.debug(`GC: ${(before - after) / 1024 / 1024}MB freed`);
      }, this.config.memoryOptimization.gcInterval);
    }
  }
}
```

### 2. メモリ圧迫時の自動対応

```javascript
// 設定例
{
  "memoryManagement": {
    "autoRecovery": {
      "enabled": true,
      "actions": {
        "clearCache": true,       // キャッシュクリア
        "reduceWorkers": true,    // ワーカー数削減
        "pauseNewTasks": true,    // 新規タスク一時停止
        "forceGC": true          // 強制GC実行
      },
      "recoveryThreshold": 0.8    // 使用率80%で回復動作
    }
  }
}
```

## 📈 メモリ使用量の分析

### 1. メモリ使用レポート生成

```bash
# 日次メモリ使用レポート
npm run analytics:report memory --period daily

# 詳細分析レポート
npm run analytics:report memory --detailed --format markdown
```

### 2. メモリトレンド分析

```bash
# 過去7日間のメモリ使用トレンド
npm run analytics:trends memory --days 7

# グラフ表示
npm run analytics:trends memory --days 30 --graph
```

### 3. プロセス別メモリ分析

```javascript
// ダッシュボードAPIでプロセス別統計を取得
fetch('http://localhost:3001/api/analytics/memory-by-process')
  .then(res => res.json())
  .then(data => {
    console.log('メモリ使用量トップ5:');
    data.top5.forEach(p => {
      console.log(`${p.name}: ${p.memory}MB (${p.percentage}%)`);
    });
  });
```

## 🛠️ トラブルシューティング

### 問題: メモリ使用量が継続的に増加

**原因と対策:**

1. **イベントリスナーの蓄積**
   ```javascript
   // 対策: リスナーの適切な削除
   process.on('exit', () => {
     emitter.removeAllListeners();
   });
   ```

2. **キャッシュの無制限な増加**
   ```javascript
   // 対策: LRUキャッシュの使用
   const LRU = require('lru-cache');
   const cache = new LRU({
     max: 500,  // 最大500エントリ
     maxAge: 1000 * 60 * 60  // 1時間で期限切れ
   });
   ```

3. **クロージャによる参照保持**
   ```javascript
   // 対策: WeakMapの使用
   const dataMap = new WeakMap();
   ```

### 問題: Out of Memory エラー

**即座の対応:**

```bash
# 1. メモリ制限を一時的に増加
NODE_OPTIONS="--max-old-space-size=2048" npm start

# 2. 並行実行数を削減
export POPPO_MAX_CONCURRENT=1
npm start

# 3. デバッグモードで詳細ログ
DEBUG=* NODE_OPTIONS="--trace-gc" npm start
```

**恒久的な対策:**

1. コードの最適化
2. バッチサイズの削減
3. ストリーム処理への変更
4. Worker Threadsの活用

### 問題: ガベージコレクションの頻発

**診断方法:**

```bash
# GCログを有効化
NODE_OPTIONS="--trace-gc --trace-gc-verbose" npm start 2>&1 | grep "gc"
```

**対策:**

1. ヒープサイズの調整
2. オブジェクトプールの使用
3. 一時オブジェクトの削減

## 📚 参考資料

### 設定ファイルテンプレート

```javascript
// config/memory-optimized.json
{
  "performance": {
    "maxConcurrentTasks": 2,
    "taskTimeout": 300000,
    "memoryOptimization": {
      "enabled": true,
      "gcInterval": 180000,
      "maxOldSpaceSize": 768,
      "heapSnapshot": false
    }
  },
  "monitoring": {
    "memoryCheck": {
      "enabled": true,
      "interval": 30000,
      "threshold": 400,
      "alerting": {
        "enabled": true,
        "channels": ["log", "slack"]
      }
    }
  },
  "memoryManagement": {
    "autoRecovery": {
      "enabled": true,
      "recoveryThreshold": 0.75,
      "actions": {
        "clearCache": true,
        "reduceWorkers": true,
        "pauseNewTasks": true,
        "forceGC": true
      }
    }
  }
}
```

### 監視スクリプト例

```bash
#!/bin/bash
# scripts/monitor-memory.sh

while true; do
  # プロセス情報取得
  MEM_INFO=$(ps aux | grep "PoppoBuilder-Main" | grep -v grep)
  
  if [ ! -z "$MEM_INFO" ]; then
    MEM_PERCENT=$(echo $MEM_INFO | awk '{print $4}')
    MEM_MB=$(echo $MEM_INFO | awk '{print $6/1024}')
    
    echo "[$(date)] Memory: ${MEM_PERCENT}% (${MEM_MB}MB)"
    
    # 閾値チェック
    if (( $(echo "$MEM_PERCENT > 5.0" | bc -l) )); then
      echo "[WARNING] High memory usage detected!"
      # アラート送信など
    fi
  fi
  
  sleep 60
done
```

## 🎯 まとめ

効果的なメモリ管理のポイント：

1. **定期的な監視** - ダッシュボードやCLIでメモリ使用量を確認
2. **適切な設定** - プロジェクトに応じたメモリ制限とGC設定
3. **早期検出** - メモリリークの兆候を早期に発見
4. **自動化** - 自動回復機能で問題を未然に防ぐ
5. **分析と改善** - レポートを活用して継続的に最適化

詳細な技術情報は[メモリ管理仕様書](../memory-management.md)を参照してください。