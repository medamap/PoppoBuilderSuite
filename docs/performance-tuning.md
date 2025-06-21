# パフォーマンスチューニングガイド

PoppoBuilder Suite のパフォーマンスを最適化するための包括的なガイドです。

## 📊 パフォーマンス分析

### 1. 現状把握

#### パフォーマンスメトリクスの収集

```bash
# 基本的なパフォーマンス統計
npm run analytics:stats performance

# 詳細なパフォーマンスレポート
npm run analytics:report performance --detailed

# リアルタイムモニタリング
npm run monitor:performance
```

#### ボトルネックの特定

```javascript
// パフォーマンスプロファイリングの有効化
NODE_OPTIONS="--prof" npm start

// プロファイル結果の分析
node --prof-process isolate-*.log > performance-analysis.txt

// フレームグラフの生成
npm run profile:flamegraph
```

### 2. メトリクスの理解

| メトリクス | 目標値 | 警告閾値 | 説明 |
|-----------|--------|----------|------|
| タスク処理速度 | >100/hour | <50/hour | 1時間あたりの処理タスク数 |
| 平均応答時間 | <1s | >5s | APIレスポンスの平均時間 |
| メモリ使用量 | <500MB | >1GB | Node.jsプロセスのメモリ使用 |
| CPU使用率 | <50% | >80% | 平均CPU使用率 |
| エラー率 | <0.1% | >1% | 総リクエストに対するエラーの割合 |

## ⚡ CPU最適化

### 1. 並行処理の最適化

```javascript
// config/config.json
{
  "performance": {
    "maxConcurrentTasks": 5,  // CPUコア数に基づいて調整
    "workerThreads": {
      "enabled": true,
      "poolSize": 4         // CPUコア数 - 1
    }
  }
}
```

### 2. Worker Threads の活用

```javascript
// src/workers/task-worker.js
const { Worker } = require('worker_threads');
const os = require('os');

class WorkerPool {
  constructor(workerScript, poolSize = os.cpus().length - 1) {
    this.workers = [];
    this.queue = [];
    this.poolSize = poolSize;
    
    // ワーカープールの初期化
    for (let i = 0; i < poolSize; i++) {
      this.createWorker(workerScript);
    }
  }
  
  createWorker(workerScript) {
    const worker = new Worker(workerScript);
    
    worker.on('message', (result) => {
      worker.isBusy = false;
      this.processQueue();
    });
    
    worker.on('error', (error) => {
      console.error('Worker error:', error);
      worker.isBusy = false;
      this.createWorker(workerScript); // 新しいワーカーを作成
    });
    
    this.workers.push(worker);
  }
  
  async execute(data) {
    return new Promise((resolve, reject) => {
      const task = { data, resolve, reject };
      this.queue.push(task);
      this.processQueue();
    });
  }
  
  processQueue() {
    if (this.queue.length === 0) return;
    
    const availableWorker = this.workers.find(w => !w.isBusy);
    if (!availableWorker) return;
    
    const task = this.queue.shift();
    availableWorker.isBusy = true;
    availableWorker.postMessage(task.data);
    
    availableWorker.once('message', (result) => {
      task.resolve(result);
    });
  }
}
```

### 3. CPU集約的タスクの最適化

```javascript
// 重い計算処理の最適化
function optimizeHeavyComputation(data) {
  // バッチ処理
  const BATCH_SIZE = 1000;
  const results = [];
  
  for (let i = 0; i < data.length; i += BATCH_SIZE) {
    const batch = data.slice(i, i + BATCH_SIZE);
    
    // 各バッチを非同期で処理
    setImmediate(() => {
      const batchResult = processBatch(batch);
      results.push(batchResult);
    });
    
    // イベントループを解放
    if (i % (BATCH_SIZE * 10) === 0) {
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  
  return results;
}
```

## 💾 メモリ最適化

### 1. メモリ使用量の削減

```javascript
// ストリーム処理によるメモリ効率化
const fs = require('fs');
const stream = require('stream');
const util = require('util');
const pipeline = util.promisify(stream.pipeline);

async function processLargeFile(filePath) {
  const readStream = fs.createReadStream(filePath, { 
    highWaterMark: 16 * 1024  // 16KB チャンク
  });
  
  const transformStream = new stream.Transform({
    transform(chunk, encoding, callback) {
      // チャンクごとに処理
      const processed = processChunk(chunk);
      callback(null, processed);
    }
  });
  
  const writeStream = fs.createWriteStream('output.txt');
  
  await pipeline(readStream, transformStream, writeStream);
}
```

### 2. オブジェクトプールの実装

```javascript
// 頻繁に作成・破棄されるオブジェクトのプール化
class ObjectPool {
  constructor(createFn, resetFn, maxSize = 100) {
    this.createFn = createFn;
    this.resetFn = resetFn;
    this.pool = [];
    this.maxSize = maxSize;
  }
  
  acquire() {
    if (this.pool.length > 0) {
      return this.pool.pop();
    }
    return this.createFn();
  }
  
  release(obj) {
    if (this.pool.length < this.maxSize) {
      this.resetFn(obj);
      this.pool.push(obj);
    }
  }
}

// 使用例
const bufferPool = new ObjectPool(
  () => Buffer.allocUnsafe(1024 * 1024),  // 1MB バッファ
  (buffer) => buffer.fill(0),              // リセット
  50                                       // 最大50個保持
);
```

### 3. メモリリーク対策

```javascript
// WeakMapによる参照管理
class CacheManager {
  constructor() {
    this.cache = new WeakMap();
    this.timers = new Map();
  }
  
  set(key, value, ttl = 60000) {
    this.cache.set(key, value);
    
    // 既存のタイマーをクリア
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key));
    }
    
    // TTL後に自動削除
    const timer = setTimeout(() => {
      this.cache.delete(key);
      this.timers.delete(key);
    }, ttl);
    
    this.timers.set(key, timer);
  }
  
  get(key) {
    return this.cache.get(key);
  }
  
  clear() {
    // すべてのタイマーをクリア
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
```

## 🗄️ データベース最適化

### 1. クエリ最適化

```javascript
// インデックスの作成
await db.run(`
  CREATE INDEX IF NOT EXISTS idx_issues_status_created 
  ON issues(status, created_at);
  
  CREATE INDEX IF NOT EXISTS idx_tasks_issue_id 
  ON tasks(issue_id);
  
  CREATE INDEX IF NOT EXISTS idx_logs_timestamp 
  ON logs(timestamp);
`);

// 効率的なクエリ
const efficientQuery = `
  SELECT i.*, COUNT(t.id) as task_count
  FROM issues i
  LEFT JOIN tasks t ON i.id = t.issue_id
  WHERE i.status = ? AND i.created_at > ?
  GROUP BY i.id
  LIMIT 100
`;
```

### 2. コネクションプーリング

```javascript
// SQLiteの場合
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

class DatabasePool {
  constructor(filename, poolSize = 5) {
    this.filename = filename;
    this.poolSize = poolSize;
    this.connections = [];
    this.available = [];
  }
  
  async initialize() {
    for (let i = 0; i < this.poolSize; i++) {
      const db = await open({
        filename: this.filename,
        driver: sqlite3.Database
      });
      
      // WALモードを有効化（並行性向上）
      await db.exec('PRAGMA journal_mode = WAL');
      await db.exec('PRAGMA synchronous = NORMAL');
      
      this.connections.push(db);
      this.available.push(db);
    }
  }
  
  async acquire() {
    while (this.available.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    return this.available.pop();
  }
  
  release(db) {
    this.available.push(db);
  }
  
  async withConnection(fn) {
    const db = await this.acquire();
    try {
      return await fn(db);
    } finally {
      this.release(db);
    }
  }
}
```

### 3. バッチ処理

```javascript
// 一括挿入の最適化
async function batchInsert(records) {
  const BATCH_SIZE = 1000;
  
  await db.run('BEGIN TRANSACTION');
  
  try {
    const stmt = await db.prepare(`
      INSERT INTO records (id, data, timestamp) 
      VALUES (?, ?, ?)
    `);
    
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      
      for (const record of batch) {
        await stmt.run(record.id, record.data, record.timestamp);
      }
      
      // 定期的にコミット
      if (i % (BATCH_SIZE * 10) === 0) {
        await db.run('COMMIT');
        await db.run('BEGIN TRANSACTION');
      }
    }
    
    await stmt.finalize();
    await db.run('COMMIT');
  } catch (error) {
    await db.run('ROLLBACK');
    throw error;
  }
}
```

## 🌐 ネットワーク最適化

### 1. HTTP Keep-Alive

```javascript
const https = require('https');
const http = require('http');

// Keep-Aliveエージェントの設定
const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 60000,
  scheduling: 'fifo'
});

const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 50,
  maxFreeSockets: 10
});

// axios での使用
const axios = require('axios');
const apiClient = axios.create({
  httpsAgent,
  httpAgent,
  timeout: 30000,
  maxRedirects: 5
});
```

### 2. レスポンスキャッシング

```javascript
// インメモリキャッシュ
const NodeCache = require('node-cache');
const cache = new NodeCache({ 
  stdTTL: 600,      // 10分
  checkperiod: 120, // 2分ごとにチェック
  useClones: false  // パフォーマンス向上
});

// キャッシュミドルウェア
async function cachedApiCall(key, apiCall, ttl = 600) {
  // キャッシュチェック
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }
  
  // APIコール
  const result = await apiCall();
  
  // キャッシュに保存
  cache.set(key, result, ttl);
  
  return result;
}

// 使用例
const issues = await cachedApiCall(
  `issues:${repo}:${page}`,
  () => github.getIssues({ repo, page }),
  300  // 5分
);
```

### 3. 圧縮の活用

```javascript
// gzip圧縮の有効化
const compression = require('compression');
const express = require('express');
const app = express();

app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  level: 6  // 圧縮レベル（1-9）
}));

// APIレスポンスの圧縮
app.get('/api/data', async (req, res) => {
  const data = await getLargeData();
  
  res.setHeader('Content-Encoding', 'gzip');
  res.setHeader('Content-Type', 'application/json');
  
  const zlib = require('zlib');
  const compressed = zlib.gzipSync(JSON.stringify(data));
  
  res.send(compressed);
});
```

## 🔧 設定最適化

### 1. 環境別設定

```javascript
// config/performance-profiles.json
{
  "profiles": {
    "development": {
      "maxConcurrentTasks": 2,
      "cacheEnabled": false,
      "debugLogging": true,
      "compressionEnabled": false
    },
    "production": {
      "maxConcurrentTasks": 10,
      "cacheEnabled": true,
      "debugLogging": false,
      "compressionEnabled": true,
      "clustering": {
        "enabled": true,
        "workers": "auto"
      }
    },
    "high-performance": {
      "maxConcurrentTasks": 20,
      "cacheEnabled": true,
      "aggressiveCaching": true,
      "compressionEnabled": true,
      "clustering": {
        "enabled": true,
        "workers": 8
      },
      "database": {
        "poolSize": 10,
        "walMode": true
      }
    }
  }
}
```

### 2. 自動チューニング

```javascript
// src/auto-tuner.js
class AutoTuner {
  constructor(config) {
    this.config = config;
    this.metrics = [];
    this.tuningInterval = 300000; // 5分
  }
  
  start() {
    setInterval(() => this.tune(), this.tuningInterval);
  }
  
  async tune() {
    const currentMetrics = await this.collectMetrics();
    this.metrics.push(currentMetrics);
    
    // 直近のメトリクスを分析
    const recentMetrics = this.metrics.slice(-12); // 過去1時間
    const analysis = this.analyzeMetrics(recentMetrics);
    
    // 設定を調整
    if (analysis.cpuHigh) {
      this.config.maxConcurrentTasks = Math.max(
        1, 
        this.config.maxConcurrentTasks - 1
      );
    } else if (analysis.cpuLow && analysis.queueLength > 0) {
      this.config.maxConcurrentTasks = Math.min(
        20, 
        this.config.maxConcurrentTasks + 1
      );
    }
    
    // メモリ圧迫時の対応
    if (analysis.memoryPressure) {
      this.config.cacheSize = Math.floor(this.config.cacheSize * 0.8);
      global.gc && global.gc();
    }
  }
}
```

## 📊 モニタリングとアラート

### 1. パフォーマンスダッシュボード

```javascript
// メトリクス収集エンドポイント
app.get('/api/metrics', (req, res) => {
  const metrics = {
    process: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    },
    tasks: {
      processed: taskCounter.get(),
      queued: taskQueue.size(),
      processing: activeTaskCount,
      errorRate: errorCounter.get() / taskCounter.get()
    },
    performance: {
      avgResponseTime: responseTimeHistogram.mean(),
      p95ResponseTime: responseTimeHistogram.percentile(0.95),
      p99ResponseTime: responseTimeHistogram.percentile(0.99)
    }
  };
  
  res.json(metrics);
});
```

### 2. アラート設定

```javascript
// config/alerts.json
{
  "alerts": [
    {
      "name": "High CPU Usage",
      "condition": "cpu.usage > 80",
      "duration": 300,  // 5分間継続
      "severity": "warning",
      "actions": ["log", "email"]
    },
    {
      "name": "Memory Leak Detected",
      "condition": "memory.heapUsed.trend > 10",  // 10MB/分の増加
      "duration": 600,  // 10分間継続
      "severity": "critical",
      "actions": ["log", "email", "restart"]
    },
    {
      "name": "Slow Response Time",
      "condition": "performance.p95ResponseTime > 5000",
      "duration": 180,
      "severity": "warning",
      "actions": ["log", "scale"]
    }
  ]
}
```

## 🎯 パフォーマンスチェックリスト

### 開発時
- [ ] プロファイリングツールを使用してボトルネックを特定
- [ ] 不要な同期処理を非同期に変更
- [ ] 大きなデータセットにはストリーム処理を使用
- [ ] 適切なインデックスを作成

### デプロイ前
- [ ] 本番環境相当の負荷テストを実施
- [ ] メモリリークテストを実行（24時間以上）
- [ ] 適切なキャッシュ戦略を実装
- [ ] 圧縮とKeep-Aliveを有効化

### 運用中
- [ ] 定期的なパフォーマンスレポートを確認
- [ ] メトリクスの傾向を分析
- [ ] 必要に応じて設定を調整
- [ ] ボトルネックの継続的な改善

パフォーマンスチューニングは継続的なプロセスです。定期的な監視と分析により、PoppoBuilder Suite を最適な状態で運用できます。