# イベントとフック

PoppoBuilder Suite のイベントシステムとカスタマイズ可能なフックポイントについて説明します。

## 📡 イベントシステム概要

PoppoBuilder は Node.js の EventEmitter をベースにした強力なイベントシステムを提供しています。

### イベントリスナーの登録

```javascript
// 基本的な使用方法
const poppoBuilder = require('./src/minimal-poppo');

// イベントリスナーの登録
poppoBuilder.on('issue.processing.start', (data) => {
  console.log(`Issue #${data.issueNumber} の処理を開始しました`);
});

// 一度だけ実行されるリスナー
poppoBuilder.once('system.ready', () => {
  console.log('システムが起動しました');
});

// エラーイベントの処理
poppoBuilder.on('error', (error) => {
  console.error('エラーが発生しました:', error);
});
```

## 🎯 利用可能なイベント

### システムイベント

| イベント名 | 説明 | ペイロード |
|-----------|------|-----------|
| `system.starting` | システム起動開始 | `{ timestamp, version }` |
| `system.ready` | システム起動完了 | `{ timestamp, config }` |
| `system.stopping` | システム停止開始 | `{ timestamp, reason }` |
| `system.stopped` | システム停止完了 | `{ timestamp }` |
| `system.error` | システムエラー | `{ error, timestamp, context }` |

### Issue処理イベント

| イベント名 | 説明 | ペイロード |
|-----------|------|-----------|
| `issue.detected` | 新しいIssue検出 | `{ issueNumber, title, labels }` |
| `issue.processing.start` | 処理開始 | `{ issueNumber, taskId, type }` |
| `issue.processing.progress` | 処理進行中 | `{ issueNumber, taskId, progress }` |
| `issue.processing.complete` | 処理完了 | `{ issueNumber, taskId, result }` |
| `issue.processing.error` | 処理エラー | `{ issueNumber, taskId, error }` |
| `issue.comment.added` | コメント追加 | `{ issueNumber, commentId, author }` |

### タスクキューイベント

| イベント名 | 説明 | ペイロード |
|-----------|------|-----------|
| `queue.task.enqueued` | タスク追加 | `{ taskId, priority, type }` |
| `queue.task.dequeued` | タスク取り出し | `{ taskId }` |
| `queue.task.completed` | タスク完了 | `{ taskId, duration }` |
| `queue.task.failed` | タスク失敗 | `{ taskId, error, attempts }` |
| `queue.empty` | キューが空 | `{ timestamp }` |
| `queue.full` | キューが満杯 | `{ size, maxSize }` |

### プロセス管理イベント

| イベント名 | 説明 | ペイロード |
|-----------|------|-----------|
| `process.spawn` | プロセス起動 | `{ pid, command, args }` |
| `process.exit` | プロセス終了 | `{ pid, code, signal }` |
| `process.error` | プロセスエラー | `{ pid, error }` |
| `process.timeout` | タイムアウト | `{ pid, duration }` |

### メモリ・パフォーマンスイベント

| イベント名 | 説明 | ペイロード |
|-----------|------|-----------|
| `memory.warning` | メモリ警告 | `{ usage, threshold, percentage }` |
| `memory.critical` | メモリ危機 | `{ usage, available }` |
| `performance.slow` | 処理遅延 | `{ operation, duration, expected }` |
| `gc.start` | GC開始 | `{ type, flags }` |
| `gc.complete` | GC完了 | `{ duration, freed }` |

## 🪝 フックシステム

フックを使用して、処理フローの特定のポイントで独自のロジックを実行できます。

### フックの登録

```javascript
// フックの登録
const { registerHook } = require('./src/hook-manager');

// 同期フック
registerHook('beforeIssueProcess', (context) => {
  // Issue処理前の検証
  if (context.issue.labels.includes('skip')) {
    return { skip: true, reason: 'Skip label found' };
  }
  return { continue: true };
});

// 非同期フック
registerHook('afterIssueProcess', async (context) => {
  // 処理後の通知
  await sendNotification({
    issue: context.issue,
    result: context.result
  });
});
```

### 利用可能なフック

#### 処理フローフック

```javascript
// Issue処理前
beforeIssueProcess: {
  params: { issue, config },
  return: { continue: boolean, skip?: boolean, modify?: object }
}

// Issue処理後
afterIssueProcess: {
  params: { issue, result, duration },
  return: void
}

// コメント処理前
beforeCommentProcess: {
  params: { issue, comment, context },
  return: { continue: boolean, modify?: object }
}

// タスク実行前
beforeTaskExecute: {
  params: { task, executor },
  return: { continue: boolean, timeout?: number }
}

// エラー処理前
beforeErrorHandle: {
  params: { error, context, retry },
  return: { handle: boolean, action?: string }
}
```

#### 設定・初期化フック

```javascript
// 設定読み込み後
afterConfigLoad: {
  params: { config },
  return: { config: modifiedConfig }
}

// 初期化前
beforeInitialize: {
  params: { environment },
  return: { continue: boolean }
}

// シャットダウン前
beforeShutdown: {
  params: { reason, graceful },
  return: { delay?: number, force?: boolean }
}
```

## 🔧 カスタムイベントの実装

### イベントエミッターの拡張

```javascript
// custom-events.js
const EventEmitter = require('events');

class CustomEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(50); // リスナー数の上限を設定
  }

  // カスタムイベントの発行
  emitWithMetrics(event, data) {
    const startTime = Date.now();
    
    // イベント発行前のメトリクス
    this.emit('metrics.event.start', { event, timestamp: startTime });
    
    // 実際のイベント発行
    this.emit(event, data);
    
    // イベント発行後のメトリクス
    const duration = Date.now() - startTime;
    this.emit('metrics.event.complete', { event, duration });
  }

  // 条件付きイベント
  emitIf(condition, event, data) {
    if (condition) {
      this.emit(event, data);
    }
  }

  // 遅延イベント
  emitDelayed(event, data, delay) {
    setTimeout(() => {
      this.emit(event, data);
    }, delay);
  }
}

module.exports = CustomEventEmitter;
```

### プラグインシステムの実装

```javascript
// plugin-system.js
class PluginSystem {
  constructor() {
    this.plugins = new Map();
    this.hooks = new Map();
  }

  // プラグインの登録
  register(name, plugin) {
    if (typeof plugin.initialize === 'function') {
      plugin.initialize(this);
    }
    
    this.plugins.set(name, plugin);
    
    // プラグインのフックを登録
    if (plugin.hooks) {
      Object.entries(plugin.hooks).forEach(([hookName, handler]) => {
        this.addHook(hookName, handler);
      });
    }
    
    // プラグインのイベントリスナーを登録
    if (plugin.events) {
      Object.entries(plugin.events).forEach(([eventName, handler]) => {
        this.on(eventName, handler);
      });
    }
  }

  // フックの実行
  async executeHook(hookName, context) {
    const handlers = this.hooks.get(hookName) || [];
    let result = context;
    
    for (const handler of handlers) {
      try {
        const hookResult = await handler(result);
        if (hookResult !== undefined) {
          result = { ...result, ...hookResult };
        }
      } catch (error) {
        console.error(`Hook error in ${hookName}:`, error);
        // フックのエラーは継続
      }
    }
    
    return result;
  }

  // フックハンドラーの追加
  addHook(hookName, handler) {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, []);
    }
    this.hooks.get(hookName).push(handler);
  }
}
```

## 📝 実装例

### カスタム通知プラグイン

```javascript
// plugins/notification-plugin.js
module.exports = {
  name: 'notification-plugin',
  
  initialize(system) {
    this.system = system;
    this.config = system.config.notifications || {};
  },
  
  hooks: {
    afterIssueProcess: async (context) => {
      const { issue, result } = context;
      
      // 成功時の通知
      if (result.success) {
        await this.sendNotification({
          type: 'success',
          title: `Issue #${issue.number} 処理完了`,
          message: result.message
        });
      }
    },
    
    beforeErrorHandle: async (context) => {
      const { error, context: errorContext } = context;
      
      // クリティカルエラーの通知
      if (error.severity === 'critical') {
        await this.sendNotification({
          type: 'error',
          title: 'クリティカルエラー',
          message: error.message,
          priority: 'high'
        });
      }
    }
  },
  
  events: {
    'system.ready': function() {
      console.log('通知プラグインが有効になりました');
    },
    
    'queue.full': async function(data) {
      await this.sendNotification({
        type: 'warning',
        title: 'タスクキューが満杯',
        message: `キューサイズ: ${data.size}/${data.maxSize}`
      });
    }
  },
  
  async sendNotification(notification) {
    // 実際の通知送信ロジック
    if (this.config.slack) {
      await this.sendSlackNotification(notification);
    }
    if (this.config.email) {
      await this.sendEmailNotification(notification);
    }
  }
};
```

### メトリクス収集プラグイン

```javascript
// plugins/metrics-plugin.js
const prometheus = require('prom-client');

module.exports = {
  name: 'metrics-plugin',
  
  initialize(system) {
    // Prometheusメトリクスの初期化
    this.taskCounter = new prometheus.Counter({
      name: 'poppo_tasks_total',
      help: 'Total number of processed tasks',
      labelNames: ['type', 'status']
    });
    
    this.taskDuration = new prometheus.Histogram({
      name: 'poppo_task_duration_seconds',
      help: 'Task processing duration in seconds',
      labelNames: ['type'],
      buckets: [0.1, 0.5, 1, 5, 10, 30, 60]
    });
    
    // メトリクスエンドポイントの登録
    system.app.get('/metrics', (req, res) => {
      res.set('Content-Type', prometheus.register.contentType);
      res.end(prometheus.register.metrics());
    });
  },
  
  events: {
    'issue.processing.start': function(data) {
      // 処理開始時刻を記録
      this.startTimes.set(data.taskId, Date.now());
    },
    
    'issue.processing.complete': function(data) {
      // メトリクスを更新
      this.taskCounter.labels(data.type, 'success').inc();
      
      const startTime = this.startTimes.get(data.taskId);
      if (startTime) {
        const duration = (Date.now() - startTime) / 1000;
        this.taskDuration.labels(data.type).observe(duration);
        this.startTimes.delete(data.taskId);
      }
    },
    
    'issue.processing.error': function(data) {
      this.taskCounter.labels(data.type, 'error').inc();
    }
  },
  
  startTimes: new Map()
};
```

## 🔌 イベントバスの統合

### グローバルイベントバス

```javascript
// src/event-bus.js
const EventEmitter = require('events');

class GlobalEventBus extends EventEmitter {
  constructor() {
    super();
    this.middleware = [];
  }

  // ミドルウェアの追加
  use(middleware) {
    this.middleware.push(middleware);
  }

  // イベントの発行（ミドルウェア経由）
  async emitAsync(event, data) {
    let processedData = data;
    
    // ミドルウェアチェーンを実行
    for (const mw of this.middleware) {
      if (mw.event && mw.event !== event) continue;
      
      try {
        processedData = await mw.process(event, processedData);
        if (processedData === false) {
          // イベントをキャンセル
          return;
        }
      } catch (error) {
        console.error(`Middleware error: ${error.message}`);
      }
    }
    
    // 実際のイベント発行
    this.emit(event, processedData);
  }
}

// シングルトンインスタンス
const eventBus = new GlobalEventBus();

// ロギングミドルウェア
eventBus.use({
  process: async (event, data) => {
    console.log(`[Event] ${event}:`, data);
    return data;
  }
});

module.exports = eventBus;
```

## 🎯 ベストプラクティス

### 1. イベント名の命名規則

```javascript
// 良い例: ドット記法で階層化
'system.ready'
'issue.processing.start'
'queue.task.completed'

// 悪い例: フラットな命名
'systemReady'
'startProcessing'
'taskDone'
```

### 2. エラーハンドリング

```javascript
// イベントリスナーでのエラーハンドリング
poppoBuilder.on('issue.processing.start', async (data) => {
  try {
    await riskyOperation(data);
  } catch (error) {
    // エラーを別のイベントとして発行
    poppoBuilder.emit('plugin.error', {
      plugin: 'my-plugin',
      error,
      context: data
    });
  }
});
```

### 3. メモリリーク対策

```javascript
// リスナーの適切な削除
class TemporaryListener {
  constructor(emitter) {
    this.emitter = emitter;
    this.handler = this.handleEvent.bind(this);
  }

  start() {
    this.emitter.on('some.event', this.handler);
  }

  stop() {
    this.emitter.removeListener('some.event', this.handler);
  }

  handleEvent(data) {
    // イベント処理
  }
}
```

### 4. パフォーマンス考慮

```javascript
// 高頻度イベントのスロットリング
const throttle = require('lodash/throttle');

const throttledHandler = throttle((data) => {
  // 重い処理
  updateUI(data);
}, 1000); // 1秒に1回まで

poppoBuilder.on('progress.update', throttledHandler);
```

これらのイベントとフックを活用することで、PoppoBuilder Suite を柔軟にカスタマイズし、独自の要件に対応できます。