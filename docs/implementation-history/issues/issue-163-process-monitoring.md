# Issue #163: プロセス監視とヘルスチェックの実装

## 概要
デーモンとワーカープロセスの健全性を包括的に監視し、問題を早期に検出して自動回復を行う機能を実装しました。システムリソース、プロセス状態、アプリケーション固有のメトリクスを統合的に監視します。

## 実装日
2025/6/21

## 実装内容

### 1. HealthChecker (`lib/monitoring/health-checker.js`)
- **システムヘルスチェック**
  - メモリ使用率（閾値: 85%）
  - CPU使用率（閾値: 90%）
  - ディスク容量（閾値: 90%）
  - システム負荷（閾値: 2.0）

- **高度な機能**
  - カスタムヘルスチェックの登録
  - タイムアウト保護
  - Prometheus形式のメトリクスエクスポート
  - イベント駆動の異常通知

### 2. ProcessMonitor (`lib/monitoring/process-monitor.js`)
- **プロセス詳細監視**
  - PID、CPU、メモリ、RSS、状態の追跡
  - プロセスごとの履歴管理
  - 統計情報の計算（現在値、平均、最大、最小）
  - ゾンビプロセスの検出

- **異常検知**
  - 高CPU使用（90%以上）
  - 高メモリ使用（80%以上）
  - プロセス死亡の検出
  - リアルタイムアラート

- **クロスプラットフォーム対応**
  - macOS/Linux: psコマンド使用
  - Windows: WMI使用

### 3. AutoRecovery (`lib/monitoring/auto-recovery.js`)
- **自動回復アクション**
  - 高メモリ: GC実行、キャッシュクリア、一時ファイル削除
  - 高CPU: プロセス優先度調整、キュー一時停止
  - プロセス死亡: 自動再起動
  - ディスク不足: ログローテーション、古いアーカイブ削除
  - ゾンビプロセス: 強制終了

- **回復制御**
  - 最大リトライ数（デフォルト: 3回）
  - クールダウン期間（デフォルト: 5分）
  - 回復履歴の記録
  - 成功/失敗の統計

### 4. MonitoringManager (`lib/monitoring/monitoring-manager.js`)
- **統合管理**
  - 全コンポーネントの統合制御
  - MultiLoggerとの連携
  - イベントハンドリングの一元化
  - 統合レポート生成

- **カスタマイズ可能**
  - カスタムヘルスチェックの登録
  - カスタム回復アクションの登録
  - 設定による機能の有効/無効化

### 5. Daemon API統合
- **RESTエンドポイント**
  - `GET /api/monitoring/status` - 監視ステータス
  - `GET /api/monitoring/health` - ヘルスチェック結果
  - `GET /api/monitoring/processes` - プロセス一覧
  - `GET /api/monitoring/processes/:pid` - プロセス詳細
  - `GET /api/monitoring/metrics` - メトリクス（JSON/Prometheus）
  - `GET /api/monitoring/recovery` - 回復履歴
  - `POST /api/monitoring/recovery/:issue` - 手動回復実行

### 6. CLIコマンド (`lib/commands/monitor.js`)
```bash
# 監視ステータス表示
poppobuilder monitor                  # 全体ステータス
poppobuilder monitor health           # ヘルスチェック詳細
poppobuilder monitor processes        # プロセス一覧
poppobuilder monitor metrics          # メトリクス表示
poppobuilder monitor recovery         # 回復履歴

# オプション
poppobuilder monitor processes --pid 12345  # 特定プロセスの詳細
poppobuilder monitor metrics --format prometheus  # Prometheus形式
poppobuilder monitor recovery --history  # 回復履歴の詳細
poppobuilder monitor status --json    # JSON出力
```

## 技術的特徴

### パフォーマンス最適化
- 非同期処理による効率的な監視
- メトリクス履歴のメモリ制限
- 設定可能な更新間隔

### 信頼性
- タイムアウト保護
- エラーハンドリング
- プロセス死亡の確実な検出

### 拡張性
- プラグイン可能なチェック/アクション
- イベント駆動アーキテクチャ
- カスタムメトリクスのサポート

## 設定例

```javascript
// config.json
{
  "monitoring": {
    "healthCheck": {
      "enabled": true,
      "checkInterval": 30000,      // 30秒
      "memoryThreshold": 0.85,     // 85%
      "cpuThreshold": 0.90,        // 90%
      "diskThreshold": 0.90,       // 90%
      "responseTimeout": 5000      // 5秒
    },
    "processMonitor": {
      "enabled": true,
      "updateInterval": 5000,      // 5秒
      "historySize": 1000,
      "enableDetailedMetrics": true
    },
    "autoRecovery": {
      "enabled": true,
      "maxRetries": 3,
      "retryInterval": 60000,      // 1分
      "cooldownPeriod": 300000     // 5分
    }
  }
}
```

## 使用例

```javascript
// カスタムヘルスチェックの登録
monitoring.registerHealthCheck('database', async () => {
  const isConnected = await checkDatabaseConnection();
  return {
    status: isConnected ? 'healthy' : 'unhealthy',
    metric: isConnected ? 1 : 0,
    details: { connected: isConnected }
  };
});

// カスタム回復アクションの登録
monitoring.registerRecoveryAction('database-down', async (context) => {
  await reconnectDatabase();
  return {
    success: true,
    actions: ['Database reconnected'],
    message: 'Database connection restored'
  };
});

// プロセスの監視追加
monitoring.addProcess(process.pid, {
  name: 'my-worker',
  type: 'worker',
  startTime: Date.now()
});
```

## イベント

### HealthCheckerイベント
- `health-check-completed`: ヘルスチェック完了
- `unhealthy`: 不健全な状態を検出
- `recovery-needed`: 回復が必要

### ProcessMonitorイベント
- `process-added`: プロセス追加
- `process-removed`: プロセス削除
- `process-dead`: プロセス死亡
- `high-cpu`: 高CPU使用
- `high-memory`: 高メモリ使用
- `zombie-process`: ゾンビプロセス検出

### AutoRecoveryイベント
- `recovery-started`: 回復開始
- `recovery-success`: 回復成功
- `recovery-failed`: 回復失敗
- `recovery-cooldown`: クールダウン中

## テスト

- **Monitoringテスト** (`test/monitoring.test.js`)
  - 30個以上のテストケース
  - 各コンポーネントの単体テスト
  - 統合テスト

## 今後の拡張予定

1. **メトリクス永続化**: 長期的なトレンド分析
2. **アラート機能**: Slack/Email通知
3. **予測分析**: 機械学習による異常予測
4. **ダッシュボード統合**: Web UIでの可視化
5. **分散監視**: 複数ノードの統合監視

## 関連Issue
- Issue #162: マルチプロジェクトログ管理の実装（完了）
- 今後の実装候補:
  - configコマンドのグローバル対応
  - プロジェクトテンプレート機能