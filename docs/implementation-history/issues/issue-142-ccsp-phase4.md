# Issue #142: Phase 4: CCSPの高度な制御機能とモニタリング実装

## 実装日
2025/6/21

## 概要
CCSPエージェントに高度な制御機能とモニタリング機能を実装し、システム全体のClaude API使用を完全に管理・監視できるようにしました。この実装により、PoppoBuilder SuiteのClaude API使用が一元化され、完全な監視・制御が可能になりました。

## 実装内容

### 1. メインCCSPエージェント (`agents/ccsp/index.js`)

**概要**: 全コンポーネントを統合した完全なCCSPエージェント

**主要機能**:
- 高度なキュー管理（優先度ベース、スケジューリング）
- リアルタイム使用量監視と予測
- Claude CLI実行エンジン
- Prometheusメトリクス公開
- 管理API提供
- 緊急停止機能
- 自動最適化機能

**技術的詳細**:
```javascript
class CCSPAgent extends EventEmitter {
  constructor(options = {}) {
    // Redis接続、各コンポーネント初期化
    // イベントリスナー設定
    // 自動最適化、セッション監視
  }
  
  async start() {
    // リクエスト処理ループ開始
    // 自動最適化機能開始
    // セッション監視開始
  }
}
```

### 2. 高度なキュー管理システム (`agents/ccsp/advanced-queue-manager.js`)

**概要**: 優先度ベースの高度なタスクキュー管理

**主要機能**:
- 4段階の優先度キュー（urgent/high/normal/low）
- スケジュール実行機能
- 統計情報収集
- 待機時間予測
- キューの一時停止/再開

**技術的詳細**:
```javascript
// 優先度別キュー
this.queues = {
  urgent: [],      // 緊急タスク（即座実行）
  high: [],        // 高優先度
  normal: [],      // 通常優先度
  low: [],         // 低優先度
  scheduled: []    // スケジュール実行
};

// 優先度順でのタスク取得
async dequeue() {
  const priorities = ['urgent', 'high', 'normal', 'low'];
  for (const priority of priorities) {
    if (this.queues[priority].length > 0) {
      return this.queues[priority].shift();
    }
  }
}
```

### 3. API使用量モニタリングシステム (`agents/ccsp/usage-monitor.js`)

**概要**: Claude API使用量の詳細な追跡と分析

**主要機能**:
- リアルタイム使用量追跡
- エージェント別統計
- 使用量予測（線形回帰）
- アラート機能
- レート制限予測

**技術的詳細**:
```javascript
// 使用量予測（線形回帰）
predictUsage(minutesAhead = 30) {
  const recentData = this.getTimeSeriesStats(60);
  const trend = this.calculateTrend(recentData);
  const currentRate = this.getCurrentWindowStats().requestsPerMinute;
  const predictedRate = currentRate + (trend * minutesAhead);
  
  return {
    prediction: { requestsPerMinute: predictedRate },
    confidence: this.calculatePredictionConfidence(recentData),
    trend: trend > 0 ? 'increasing' : 'decreasing'
  };
}
```

### 4. Claude CLI実行エンジン (`agents/ccsp/claude-executor.js`)

**概要**: Claude CLIコマンドの安全な実行とエラーハンドリング

**主要機能**:
- リトライ機能付きClaude CLI実行
- セッションタイムアウト検出
- 一時ファイル管理
- エラーパターン分析
- 統計情報収集

**技術的詳細**:
```javascript
// エラーパターン分析
analyzeError(errorMessage) {
  const message = errorMessage.toLowerCase();
  
  if (message.includes('invalid api key') || 
      message.includes('please run /login')) {
    return 'SESSION_TIMEOUT';
  }
  
  if (message.includes('rate limit') || 
      message.includes('usage limit')) {
    return 'RATE_LIMIT';
  }
  
  return 'UNKNOWN_ERROR';
}
```

### 5. 通知ハンドラー (`agents/ccsp/notification-handler.js`)

**概要**: システムイベントの通知機能

**主要機能**:
- GitHub Issue自動作成
- 重要度別チャンネル選択
- 通知履歴管理
- 通知統計

**技術的詳細**:
```javascript
// 重要度別チャンネル選択
selectChannels(type, severity) {
  const channels = [];
  
  switch (severity) {
    case 'critical':
    case 'emergency':
      if (this.config.enableGitHub) channels.push('github');
      if (this.config.enableSlack) channels.push('slack');
      break;
    default:
      if (this.config.enableGitHub) channels.push('github');
      break;
  }
  
  return channels.length > 0 ? channels : ['log'];
}
```

### 6. Prometheusメトリクス エクスポーター (`agents/ccsp/prometheus-exporter.js`)

**概要**: Prometheus形式でのメトリクス公開

**主要機能**:
- リクエスト統計（成功/失敗/レスポンス時間）
- キューサイズ監視
- エージェント別メトリクス
- ヒストグラム管理
- カスタムメトリクス

**技術的詳細**:
```javascript
// Prometheus形式メトリクス生成
async getMetrics() {
  let output = [];
  
  // カウンター
  output.push('# TYPE ccsp_requests_total counter');
  output.push(`ccsp_requests_total ${this.metrics.requests_total}`);
  
  // ゲージ
  output.push('# TYPE ccsp_queue_size gauge');
  for (const [priority, size] of Object.entries(this.metrics.queue_size)) {
    output.push(`ccsp_queue_size{priority="${priority}"} ${size}`);
  }
  
  // ヒストグラム
  const histogram = this.metrics.request_duration_seconds;
  for (const [bucket, count] of Object.entries(histogram.buckets)) {
    output.push(`ccsp_request_duration_seconds_bucket{le="${bucket}"} ${count}`);
  }
  
  return output.join('\n');
}
```

### 7. 管理API (`agents/ccsp/management-api.js`)

**概要**: CCSPの制御とモニタリング用RESTful API

**主要機能**:
- キュー管理エンドポイント
- 統計情報API
- 制御エンドポイント
- ヘルスチェック
- WebSocket統合

**技術的詳細**:
```javascript
// 主要APIエンドポイント
GET  /api/ccsp/queue/status      // キュー状態取得
POST /api/ccsp/queue/pause       // キュー一時停止
POST /api/ccsp/queue/resume      // キュー再開
GET  /api/ccsp/stats/usage       // 使用量統計
GET  /api/ccsp/stats/performance // パフォーマンス統計
POST /api/ccsp/control/throttle  // スロットリング設定
POST /api/ccsp/control/emergency-stop // 緊急停止
```

### 8. CCSPサービス起動スクリプト (`scripts/start-ccsp.js`)

**概要**: CCSPエージェントの起動とライフサイクル管理

**主要機能**:
- Express アプリケーション設定
- Socket.IO統合
- 設定管理
- シグナルハンドリング
- グレースフルシャットダウン

**使用方法**:
```bash
# 基本起動
npm run ccsp:start

# 環境変数での設定
CCSP_PORT=3004 npm run ccsp:start
CCSP_AUTO_OPTIMIZATION=true npm run ccsp:start

# ヘルスチェック
npm run ccsp:status

# メトリクス確認
npm run ccsp:metrics
```

### 9. 包括的テストスイート (`test/ccsp/ccsp-phase4.test.js`)

**概要**: 全CCSPコンポーネントの統合テスト

**テスト範囲**:
- AdvancedQueueManager（優先度、スケジューリング、一時停止）
- UsageMonitor（使用量記録、予測、エージェント別統計）
- ClaudeExecutor（エラー分析、統計、プロンプト強化）
- NotificationHandler（チャンネル選択、GitHub Issue生成）
- PrometheusExporter（メトリクス記録、Prometheus形式出力）
- EmergencyStop（エラー検出、再開条件）
- CCSPAgent統合（API、設定、スロットリング）

**実行方法**:
```bash
npm run ccsp:test
```

## 設定

### 設定ファイル (`config/config.json`)

```json
{
  "ccsp": {
    "enabled": true,
    "port": 3003,
    "maxConcurrentRequests": 5,
    "throttleDelay": 1000,
    "enableMetrics": true,
    "enableDashboard": true,
    "autoOptimization": false,
    "queueManager": {
      "maxQueueSize": 10000,
      "schedulerInterval": 5000
    },
    "usageMonitor": {
      "windowSize": 3600000,
      "alertThreshold": 0.8,
      "predictionWindow": 1800000
    },
    "claudeExecutor": {
      "maxRetries": 3,
      "timeout": 120000
    },
    "notifications": {
      "enableGitHub": true,
      "githubRepo": "medamap/PoppoBuilderSuite"
    },
    "redis": {
      "host": "localhost",
      "port": 6379
    }
  }
}
```

### 環境変数

| 変数名 | デフォルト | 説明 |
|--------|------------|------|
| CCSP_PORT | 3003 | HTTPサーバーポート |
| CCSP_MAX_CONCURRENT | 5 | 最大同時実行数 |
| CCSP_THROTTLE_DELAY | 1000 | スロットリング遅延(ms) |
| CCSP_ENABLE_METRICS | true | Prometheusメトリクス有効化 |
| CCSP_ENABLE_DASHBOARD | true | 管理ダッシュボード有効化 |
| CCSP_AUTO_OPTIMIZATION | false | 自動最適化有効化 |
| REDIS_HOST | localhost | Redisホスト |
| REDIS_PORT | 6379 | Redisポート |

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    CCSP Agent (Phase 4)                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │AdvancedQueue    │  │  UsageMonitor   │  │ClaudeExecutor│ │
│  │Manager          │  │                 │  │              │ │
│  │- 4段階優先度     │  │- リアルタイム監視 │  │- CLI実行      │ │
│  │- スケジューリング │  │- 使用量予測      │  │- エラー処理   │ │
│  │- 統計情報       │  │- アラート       │  │- リトライ     │ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────┐ │
│  │Notification     │  │Prometheus       │  │EmergencyStop │ │
│  │Handler          │  │Exporter         │  │              │ │
│  │- GitHub Issue   │  │- メトリクス公開  │  │- 自動停止     │ │
│  │- 重要度別通知    │  │- 統計情報       │  │- セッション監視│ │
│  └─────────────────┘  └─────────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐                  │
│  │Management API   │  │Service Startup  │                  │
│  │- RESTful API    │  │- Express統合     │                  │
│  │- WebSocket      │  │- ライフサイクル   │                  │
│  │- 制御機能       │  │- 設定管理       │                  │
│  └─────────────────┘  └─────────────────┘                  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │     Redis       │
                    │  (キュー管理)    │
                    └─────────────────┘
```

## 使用方法

### 1. 基本起動

```bash
# CCSPエージェント起動
npm run ccsp:start

# 状態確認
npm run ccsp:status

# メトリクス確認
npm run ccsp:metrics
```

### 2. API使用例

```bash
# キュー状態取得
curl http://localhost:3003/api/ccsp/queue/status

# 使用量統計取得
curl http://localhost:3003/api/ccsp/stats/usage

# キュー一時停止
curl -X POST http://localhost:3003/api/ccsp/queue/pause

# スロットリング設定
curl -X POST http://localhost:3003/api/ccsp/control/throttle \
  -H "Content-Type: application/json" \
  -d '{"enabled": true, "delay": 2000, "mode": "adaptive"}'
```

### 3. プログラムからの使用

```javascript
const CCSPAgent = require('./agents/ccsp/index');

const ccsp = new CCSPAgent({
  port: 3003,
  maxConcurrentRequests: 5,
  enableMetrics: true
});

await ccsp.start();

// タスクをキューに追加
const taskId = await ccsp.enqueueTask({
  prompt: 'Test prompt',
  agent: 'test-agent'
}, 'high');

// 統計情報取得
const stats = await ccsp.getUsageStats();
```

## 技術的特徴

### 1. スケーラビリティ
- 優先度ベースキューによる効率的な処理
- Redis活用による分散対応
- 自動最適化による動的パフォーマンス調整

### 2. 監視・可視性
- Prometheusメトリクスによる詳細監視
- リアルタイム使用量追跡
- 予測機能による予防的対応

### 3. 信頼性
- 緊急停止機能による安全性確保
- セッション監視による自動回復
- 包括的なエラーハンドリング

### 4. 運用性
- RESTful API による完全制御
- WebSocketによるリアルタイム更新
- 詳細な統計情報とレポート

## メリット

### 1. 一元化された管理
- すべてのClaude API呼び出しをCCSP経由に統一
- レート制限の完全な管理
- 使用量の詳細な追跡

### 2. 予防的対応
- 使用量予測による事前警告
- レート制限到達前の自動スロットリング
- セッションタイムアウトの早期検出

### 3. 運用効率化
- 自動最適化による手動調整の削減
- 詳細な監視による問題の早期発見
- GitHub統合による迅速な対応

### 4. 拡張性
- モジュラー設計による機能追加の容易さ
- 設定による柔軟なカスタマイズ
- 新しいエージェントとの簡単な統合

## 今後の拡張計画

### 1. 機械学習機能
- 使用パターンの自動学習
- より精密な使用量予測
- 最適なスロットリング設定の自動決定

### 2. 分散機能強化
- Redis Cluster対応
- 複数CCSPインスタンス間での負荷分散
- 地理的分散対応

### 3. 統合監視
- Grafanaダッシュボード提供
- アラート機能の拡張
- SLA監視との統合

### 4. セキュリティ強化
- 認証・認可機能
- 監査ログ機能
- 暗号化通信

## 関連ファイル

### 実装ファイル
- `/agents/ccsp/index.js` - メインCCSPエージェント
- `/agents/ccsp/advanced-queue-manager.js` - キュー管理
- `/agents/ccsp/usage-monitor.js` - 使用量監視
- `/agents/ccsp/claude-executor.js` - Claude CLI実行
- `/agents/ccsp/notification-handler.js` - 通知処理
- `/agents/ccsp/prometheus-exporter.js` - メトリクス公開
- `/agents/ccsp/management-api.js` - 管理API
- `/agents/ccsp/emergency-stop.js` - 緊急停止

### スクリプト・設定
- `/scripts/start-ccsp.js` - 起動スクリプト
- `/config/config.json` - 設定ファイル
- `/package.json` - NPMスクリプト

### テスト・ドキュメント
- `/test/ccsp/ccsp-phase4.test.js` - 統合テスト
- `/docs/implementation-history/issues/issue-142-ccsp-phase4.md` - このドキュメント

## 結論

Issue #142のPhase 4実装により、CCSPエージェントは完全な高度制御・モニタリング機能を持つシステムとなりました。これにより：

1. **完全な一元管理**: すべてのClaude API使用がCCSP経由で管理される
2. **予防的対応**: 使用量予測と自動調整により問題を未然に防止
3. **詳細な監視**: Prometheusメトリクスによる包括的な監視
4. **運用効率化**: 自動化機能により手動作業を最小化
5. **高い拡張性**: モジュラー設計により将来の機能追加が容易

この実装により、PoppoBuilder SuiteのClaude API使用は完全に制御され、安定性と効率性が大幅に向上しました。