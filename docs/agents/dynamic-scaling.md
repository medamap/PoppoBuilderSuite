# エージェント動的スケーリング機能

## 概要

PoppoBuilder Suiteのエージェントシステムは、負荷に応じて自動的にエージェント数を調整する動的スケーリング機能を備えています。この機能により、高負荷時には自動的にエージェントを追加し、低負荷時には不要なエージェントを削減することで、効率的なリソース利用を実現します。

## アーキテクチャ

### コンポーネント構成

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentCoordinator                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐   │
│  │AutoScaler   │  │LoadBalancer  │  │LifecycleManager│   │
│  └──────┬──────┘  └──────┬───────┘  └────────┬────────┘   │
│         │                 │                    │            │
│  ┌──────▼─────────────────▼────────────────────▼───────┐   │
│  │              MetricsCollector                        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
    ┌─────────────────────────┼─────────────────────────────┐
    │                         ▼                             │
    │  ┌──────────┐   ┌──────────┐   ┌──────────┐        │
    │  │ CCPM-1   │   │ CCAG-1   │   │ CCQA-1   │  ...   │
    │  └──────────┘   └──────────┘   └──────────┘        │
    │                    エージェントプール                   │
    └───────────────────────────────────────────────────────┘
```

### 主要コンポーネント

#### 1. MetricsCollector (`agents/core/metrics-collector.js`)
- **役割**: システムメトリクスの収集と集計
- **収集メトリクス**:
  - CPU使用率（コア別、平均）
  - メモリ使用率
  - タスクキューサイズ
  - エージェント稼働状況
  - エラー発生率
  - パフォーマンスメトリクス

#### 2. AutoScaler (`agents/core/auto-scaler.js`)
- **役割**: メトリクスに基づいたスケーリング判断
- **主な機能**:
  - 負荷ファクターの計算
  - スケールアップ/ダウンの判断
  - クールダウン期間の管理
  - スケーリング履歴の記録

#### 3. LoadBalancer (`agents/core/load-balancer.js`)
- **役割**: タスクの最適なエージェントへの振り分け
- **サポートアルゴリズム**:
  - ラウンドロビン
  - 最小接続数
  - 重み付きラウンドロビン
  - レスポンスタイムベース
  - ランダム

#### 4. LifecycleManager (`agents/shared/lifecycle-manager.js`)
- **役割**: エージェントのライフサイクル管理
- **主な機能**:
  - エージェントの起動/停止
  - ヘルスチェック
  - 自動再起動
  - ゾンビプロセスの検出

## 設定

### 基本設定 (`config/config.json`)

```json
{
  "dynamicScaling": {
    "enabled": true,
    "metrics": {
      "collectionInterval": 10000,      // メトリクス収集間隔（ミリ秒）
      "historySize": 60,                // 保持する履歴数
      "aggregationWindow": 5            // 集計ウィンドウ（分）
    },
    "scaling": {
      "minAgents": 3,                   // 最小エージェント数
      "maxAgents": 15,                  // 最大エージェント数
      "scaleUpThreshold": 0.8,          // スケールアップ閾値
      "scaleDownThreshold": 0.3,        // スケールダウン閾値
      "scaleUpIncrement": 2,            // スケールアップ時の増加数
      "scaleDownIncrement": 1,          // スケールダウン時の減少数
      "cooldownPeriod": 60000,          // クールダウン期間（ミリ秒）
      "evaluationInterval": 30000,      // 評価間隔（ミリ秒）
      "memoryThreshold": 0.85,          // メモリ使用率上限
      "cpuWindowSize": 5                // CPU使用率の移動平均ウィンドウ
    },
    "loadBalancer": {
      "algorithm": "least-connections",  // 負荷分散アルゴリズム
      "healthCheckInterval": 30000,      // ヘルスチェック間隔
      "unhealthyThreshold": 3,           // 非健全判定までの失敗回数
      "healthyThreshold": 2,             // 健全判定までの成功回数
      "requestTimeout": 30000,           // リクエストタイムアウト
      "retryAttempts": 2,                // リトライ回数
      "stickySession": false,            // スティッキーセッション
      "sessionTimeout": 3600000          // セッションタイムアウト
    },
    "lifecycle": {
      "gracefulShutdownTimeout": 30000,  // グレースフルシャットダウンタイムアウト
      "healthCheckInterval": 10000,      // ヘルスチェック間隔
      "startupTimeout": 60000,           // 起動タイムアウト
      "restartDelay": 5000,              // 再起動遅延
      "maxRestartAttempts": 3,           // 最大再起動試行回数
      "zombieCheckInterval": 60000       // ゾンビチェック間隔
    }
  }
}
```

### エージェント別設定

```javascript
// agents/core/agent-coordinator.js内の設定
agentConfigs: {
  CCPM: {
    minInstances: 1,      // 最小インスタンス数
    maxInstances: 5,      // 最大インスタンス数
    maxConcurrentTasks: 3 // インスタンスあたりの最大同時実行数
  },
  CCAG: {
    minInstances: 1,
    maxInstances: 8,
    maxConcurrentTasks: 5
  },
  CCQA: {
    minInstances: 1,
    maxInstances: 3,
    maxConcurrentTasks: 2
  }
}
```

## スケーリングロジック

### 負荷ファクターの計算

負荷ファクターは以下の要素から計算されます：

```javascript
loadFactor = (CPU使用率 × 0.4) + (メモリ使用率 × 0.3) + (キュー圧力 × 0.3)
```

ここで、キュー圧力は以下のように計算されます：

```javascript
queuePressure = min(タスクキューサイズ / (アクティブエージェント数 × 10), 1)
```

### スケーリング判断

1. **スケールアップ条件**:
   - 負荷ファクター > scaleUpThreshold (0.8)
   - 現在のエージェント数 < maxAgents
   - クールダウン期間外
   - メモリ使用率 < memoryThreshold (0.85)

2. **スケールダウン条件**:
   - 負荷ファクター < scaleDownThreshold (0.3)
   - 現在のエージェント数 > minAgents
   - クールダウン期間外

## 負荷分散アルゴリズム

### 1. ラウンドロビン
最もシンプルな分散方式。順番にエージェントを選択。

### 2. 最小接続数
現在の負荷が最も少ないエージェントを選択。

### 3. 重み付きラウンドロビン
エージェントの能力に応じて重み付けした分散。

### 4. レスポンスタイムベース
平均レスポンスタイムが最も短いエージェントを選択。

### 5. ランダム
ランダムにエージェントを選択。

## 使用方法

### 基本的な使用

```javascript
const config = require('./config/config.json');
const AgentCoordinator = require('./agents/core/agent-coordinator');

// コーディネーターの初期化
const coordinator = new AgentCoordinator({
  ...config.agentMode,
  ...config.dynamicScaling
});

// 初期化と起動
await coordinator.initialize();

// タスクの割り当て
const task = await coordinator.assignTask(
  'task-123',
  'code-review',
  { issueNumber: 456 },
  { code: '...' }
);
```

### 手動スケーリング

```javascript
// 特定のエージェント数に強制的にスケール
await coordinator.autoScaler.forceScale(10);

// 現在のスケール状態を取得
const scaleStatus = coordinator.autoScaler.getCurrentScale();
console.log(scaleStatus);
// {
//   currentAgents: 5,
//   minAgents: 3,
//   maxAgents: 15,
//   lastScaleAction: 1234567890,
//   isInCooldown: false
// }
```

### メトリクスの取得

```javascript
// 集計されたメトリクスの取得
const metrics = await coordinator.metricsCollector.getAggregatedMetrics();

// 統計情報の取得
const stats = coordinator.getStats();
console.log(stats);
// {
//   agents: [...],
//   tasks: { active: 10, queued: 5, completed: 100 },
//   uptime: 3600000
// }
```

## モニタリング

### ダッシュボード統合

動的スケーリングの状態はPoppoBuilderダッシュボードで確認できます：

- 現在のエージェント数
- 負荷ファクター
- CPU/メモリ使用率
- タスクキューサイズ
- スケーリング履歴

### ログ出力

各コンポーネントは詳細なログを出力します：

```
[INFO] AutoScaler: Scaling up agents (increment: 2, total: 7, reason: high load factor: 0.85)
[INFO] LifecycleManager: Agent CCPM-1234567890-0 spawned successfully
[INFO] LoadBalancer: Agent registered (agentId: CCPM-1234567890-0)
```

## トラブルシューティング

### 問題: エージェントが頻繁にスケールアップ/ダウンする

**原因**: クールダウン期間が短すぎる、または閾値が近すぎる

**解決策**:
```json
{
  "scaling": {
    "cooldownPeriod": 120000,    // 2分に延長
    "scaleUpThreshold": 0.85,     // 差を広げる
    "scaleDownThreshold": 0.25
  }
}
```

### 問題: エージェントが起動しない

**原因**: 起動タイムアウトが短すぎる

**解決策**:
```json
{
  "lifecycle": {
    "startupTimeout": 120000      // 2分に延長
  }
}
```

### 問題: タスクが特定のエージェントに偏る

**原因**: 負荷分散アルゴリズムが適切でない

**解決策**:
```json
{
  "loadBalancer": {
    "algorithm": "least-connections"  // または "response-time"
  }
}
```

## パフォーマンスチューニング

### 1. メトリクス収集の最適化

```json
{
  "metrics": {
    "collectionInterval": 30000,  // 負荷が低い場合は間隔を延ばす
    "historySize": 30             // メモリ使用量を減らす
  }
}
```

### 2. スケーリング感度の調整

```json
{
  "scaling": {
    "cpuWindowSize": 10,          // より安定した判断のため増やす
    "evaluationInterval": 60000   // 評価頻度を減らす
  }
}
```

### 3. エージェント設定の最適化

```javascript
{
  CCPM: {
    maxConcurrentTasks: 5,  // CPUバウンドタスクは少なめに
  },
  CCAG: {
    maxConcurrentTasks: 10, // I/Oバウンドタスクは多めに
  }
}
```

## まとめ

動的スケーリング機能により、PoppoBuilder Suiteは以下を実現します：

1. **効率的なリソース利用**: 必要な時に必要な分だけエージェントを起動
2. **高可用性**: 自動再起動とヘルスチェックによる安定稼働
3. **柔軟な負荷分散**: 複数のアルゴリズムから選択可能
4. **詳細なモニタリング**: メトリクス収集と可視化
5. **簡単な設定**: JSONベースの直感的な設定

これらの機能により、大規模なタスク処理にも対応できる、スケーラブルなエージェントシステムを実現しています。