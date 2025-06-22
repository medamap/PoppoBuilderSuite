# エラーハンドリングガイド

PoppoBuilder Suiteのエラー処理とリカバリー機能の完全ガイドです。エラーの検出、分析、自動修復の方法を詳しく説明します。

## 🚨 エラー検出システム

### 1. 自動エラー検出

PoppoBuilderは以下のエラーを自動的に検出します：

- **実行時エラー**: JavaScript例外、未処理のPromise拒否
- **タイムアウト**: 設定時間を超過したタスク
- **APIエラー**: GitHub/Claude APIのエラーレスポンス
- **システムエラー**: メモリ不足、ディスク容量不足
- **プロセスエラー**: 子プロセスの異常終了

### 2. エラーレベルの分類

```javascript
// config/config.json
{
  "errorHandling": {
    "levels": {
      "critical": {
        "action": "immediate",
        "notification": true,
        "autoRestart": true
      },
      "error": {
        "action": "retry",
        "maxRetries": 3,
        "notification": false
      },
      "warning": {
        "action": "log",
        "notification": false
      }
    }
  }
}
```

## 🔍 エラーの確認方法

### 1. リアルタイムエラー監視

```bash
# エラーログのリアルタイム監視
tail -f logs/poppo-$(date +%Y-%m-%d).log | grep -E "(ERROR|CRITICAL)"

# CCLAエージェントのエラー収集状況
tail -f logs/ccla-$(date +%Y-%m-%d).log
```

### 2. ダッシュボードでのエラー確認

```bash
# ダッシュボード起動
npm run dashboard

# ブラウザで確認
# http://localhost:3001
# 「エラー分析」タブで詳細を確認
```

### 3. エラーレポートの生成

```bash
# 日次エラーレポート
npm run analytics:report errors --period daily

# エラー統計の確認
npm run analytics:stats errors

# 特定のエラータイプを検索
grep -r "TypeError" logs/ | wc -l
```

## 🛡️ エラーハンドリング戦略

### 1. try-catchブロックの適切な使用

```javascript
// 良い例: 詳細なエラー情報を保持
async function processIssue(issue) {
  const context = { issueNumber: issue.number, repo: issue.repository };
  
  try {
    await validateIssue(issue);
    const result = await executeTask(issue);
    return result;
  } catch (error) {
    // エラーコンテキストを追加
    error.context = context;
    error.timestamp = new Date().toISOString();
    
    // エラータイプに応じた処理
    if (error.code === 'RATE_LIMIT_EXCEEDED') {
      return handleRateLimit(error);
    } else if (error.code === 'TIMEOUT') {
      return handleTimeout(error);
    } else {
      throw error; // 上位で処理
    }
  }
}
```

### 2. 非同期エラーの適切な処理

```javascript
// Promise拒否の処理
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason,
    promise,
    stack: reason?.stack
  });
  
  // エラー分析に送信
  errorAnalyzer.analyze(reason);
});

// 非同期エラーのラッピング
async function safeExecute(fn, context) {
  try {
    return await fn();
  } catch (error) {
    error.context = context;
    await errorHandler.handle(error);
    throw error;
  }
}
```

### 3. エラーの伝播と集約

```javascript
// エラー集約クラス
class ErrorAggregator {
  constructor() {
    this.errors = [];
    this.criticalCount = 0;
  }
  
  add(error, severity = 'error') {
    this.errors.push({
      error,
      severity,
      timestamp: Date.now(),
      context: error.context
    });
    
    if (severity === 'critical') {
      this.criticalCount++;
      this.notifyImmediate(error);
    }
  }
  
  async flush() {
    if (this.errors.length === 0) return;
    
    const report = this.generateReport();
    await this.sendReport(report);
    this.errors = [];
  }
}
```

## 🔧 自動リカバリー機能

### 1. リトライメカニズム

```javascript
// config/config.json
{
  "retry": {
    "enabled": true,
    "strategies": {
      "exponential": {
        "initialDelay": 1000,
        "maxDelay": 60000,
        "factor": 2,
        "maxAttempts": 5
      },
      "linear": {
        "delay": 5000,
        "maxAttempts": 3
      }
    },
    "retryableErrors": [
      "ECONNRESET",
      "ETIMEDOUT",
      "RATE_LIMIT_EXCEEDED"
    ]
  }
}
```

### 2. サーキットブレーカー

```javascript
// サーキットブレーカーの実装例
class CircuitBreaker {
  constructor(options) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failures = 0;
  }
  
  async execute(fn) {
    if (this.state === 'OPEN') {
      throw new Error('Circuit breaker is OPEN');
    }
    
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  
  onFailure() {
    this.failures++;
    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      setTimeout(() => {
        this.state = 'HALF_OPEN';
      }, this.resetTimeout);
    }
  }
  
  onSuccess() {
    this.failures = 0;
    this.state = 'CLOSED';
  }
}
```

### 3. 自動修復アクション

```javascript
// 自動修復の設定
{
  "autoRecovery": {
    "actions": {
      "restartProcess": {
        "enabled": true,
        "conditions": ["FATAL_ERROR", "MEMORY_LEAK"],
        "delay": 5000
      },
      "clearCache": {
        "enabled": true,
        "conditions": ["CACHE_CORRUPTED", "MEMORY_PRESSURE"]
      },
      "reconnectAPI": {
        "enabled": true,
        "conditions": ["CONNECTION_LOST", "AUTH_EXPIRED"]
      },
      "rollbackConfig": {
        "enabled": true,
        "conditions": ["CONFIG_ERROR"]
      }
    }
  }
}
```

## 📊 エラー分析機能

### 1. CCLAエージェントによる自動分析

```bash
# CCLAエージェントの起動
node agents/ccla/index.js

# 分析結果の確認
cat logs/ccla-analysis-$(date +%Y-%m-%d).json | jq '.insights'
```

### 2. エラーパターンの検出

```javascript
// エラーパターン設定
{
  "errorPatterns": {
    "memoryLeak": {
      "indicators": [
        "JavaScript heap out of memory",
        "FATAL ERROR: Ineffective mark-compacts"
      ],
      "action": "restart",
      "priority": "high"
    },
    "apiLimit": {
      "indicators": [
        "rate limit exceeded",
        "429 Too Many Requests"
      ],
      "action": "backoff",
      "priority": "medium"
    }
  }
}
```

### 3. 根本原因分析

```bash
# エラーの根本原因レポート
npm run error:analyze --deep --issue 12345

# トレンド分析
npm run analytics:trends errors --days 7
```

## 🚑 緊急時の対処法

### 1. システム全体がダウンした場合

```bash
# 1. プロセスの確認
ps aux | grep -E "(poppo|node)" | grep -v grep

# 2. ロックファイルのクリア
rm -f state/.locks/*
rm -f state/poppo-*.lock

# 3. 破損した状態ファイルの修復
cp state/running-tasks.json.backup state/running-tasks.json

# 4. セーフモードで起動
SAFE_MODE=true npm start
```

### 2. 無限ループに陥った場合

```bash
# 1. 問題のプロセスを特定
top -p $(pgrep -f "PoppoBuilder")

# 2. 強制終了
kill -9 $(pgrep -f "PoppoBuilder-Main")

# 3. デバッグモードで再起動
DEBUG=* npm start 2>&1 | tee debug.log
```

### 3. データ破損の復旧

```bash
# 1. バックアップの確認
ls -la backups/

# 2. 最新のバックアップから復元
npm run backup:restore latest

# 3. 整合性チェック
npm run integrity:check

# 4. 部分復旧（特定のファイルのみ）
npm run backup:restore latest --only state/issue-status.json
```

## 📝 エラー対応のベストプラクティス

### 1. エラーメッセージの改善

```javascript
// 悪い例
throw new Error('Failed');

// 良い例
throw new Error(`Failed to process issue #${issueNumber}: ${reason}`, {
  cause: originalError,
  context: {
    issueNumber,
    repository: repo,
    attemptNumber: attempt
  }
});
```

### 2. エラーのカテゴライズ

```javascript
// カスタムエラークラス
class PoppoError extends Error {
  constructor(message, code, severity = 'error') {
    super(message);
    this.name = 'PoppoError';
    this.code = code;
    this.severity = severity;
    this.timestamp = new Date().toISOString();
  }
}

class RateLimitError extends PoppoError {
  constructor(resetTime) {
    super('Rate limit exceeded', 'RATE_LIMIT', 'warning');
    this.resetTime = resetTime;
  }
}
```

### 3. エラーログの構造化

```javascript
// 構造化されたエラーログ
logger.error({
  message: 'Task execution failed',
  error: {
    name: error.name,
    message: error.message,
    stack: error.stack,
    code: error.code
  },
  context: {
    taskId,
    issueNumber,
    duration: Date.now() - startTime
  },
  metadata: {
    memoryUsage: process.memoryUsage(),
    systemLoad: os.loadavg()
  }
});
```

## 🔍 デバッグテクニック

### 1. 詳細ログの有効化

```bash
# 全モジュールのデバッグログ
DEBUG=* npm start

# 特定モジュールのみ
DEBUG=poppo:*,ccla:* npm start

# ログレベルの変更
LOG_LEVEL=debug npm start
```

### 2. ブレークポイントデバッグ

```bash
# Node.js インスペクタモード
node --inspect-brk src/minimal-poppo.js

# Chrome DevToolsで接続
# chrome://inspect
```

### 3. プロファイリング

```bash
# CPUプロファイル
node --prof src/minimal-poppo.js

# プロファイル結果の分析
node --prof-process isolate-*.log > profile.txt
```

## 📚 よくあるエラーと対処法

### エラー: ENOENT

**原因**: ファイルが見つからない
```bash
# 対処法
# 1. 必要なディレクトリを作成
mkdir -p logs state temp

# 2. 権限を確認
ls -la logs/ state/
```

### エラー: EACCES

**原因**: アクセス権限なし
```bash
# 対処法
# 1. 所有者を変更
sudo chown -R $USER:$USER .

# 2. 権限を修正
chmod -R 755 .
```

### エラー: Rate limit exceeded

**原因**: API制限に到達
```javascript
// 対処法: config.jsonで調整
{
  "rateLimiter": {
    "github": {
      "maxRequests": 30,    // 減らす
      "windowMs": 60000     // 間隔を広げる
    }
  }
}
```

### エラー: JavaScript heap out of memory

**原因**: メモリ不足
```bash
# 対処法
# 1. メモリ制限を増やす
NODE_OPTIONS="--max-old-space-size=2048" npm start

# 2. 並行実行数を減らす
# config.jsonで maxConcurrentTasks を調整
```

## 🎯 まとめ

効果的なエラーハンドリングのポイント：

1. **予防的対策** - エラーが発生する前に検証
2. **早期検出** - リアルタイム監視で素早く発見
3. **詳細な記録** - コンテキスト情報を含むログ
4. **自動回復** - 可能な限り自動的に修復
5. **継続的改善** - エラー分析から学習

詳細な技術情報は[エラーハンドリング仕様書](../error-handling.md)を参照してください。