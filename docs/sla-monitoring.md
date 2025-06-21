# SLA定義とSLO監視システム

PoppoBuilder Suiteのサービスレベル目標（SLO）を定義し、継続的に監視するシステムです。

## 概要

このシステムは以下の機能を提供します：

- **SLA定義**: 可用性、パフォーマンス、処理成功率の目標値設定
- **リアルタイム監視**: 1分ごとのSLO達成状況チェック
- **エラーバジェット管理**: 許容エラー率の追跡と警告
- **自動アラート**: SLO違反時のGitHub Issue作成
- **定期レポート**: 週次・月次のSLOレポート生成

## SLA定義

### 1. 可用性目標

| サービス | 目標値 | 測定窓 | 説明 |
|---------|--------|--------|------|
| PoppoBuilder本体 | 99.5% | 30日間 | メインシステムの可用性 |
| 各エージェント | 99% | 30日間 | CCLA、CCAG等の可用性 |
| ダッシュボード | 95% | 30日間 | Web UIの可用性 |

### 2. パフォーマンス目標

| メトリクス | 目標値 | パーセンタイル | 説明 |
|-----------|--------|----------------|------|
| Issue処理開始時間 | 5分以内 | P95 | Issue作成から処理開始まで |
| API応答時間 | 200ms以内 | P95 | ダッシュボードAPI応答速度 |
| キュー滞留時間 | 10分以内 | P95 | タスクキューでの待機時間 |

### 3. 処理成功率目標

| メトリクス | 目標値 | 測定窓 | 説明 |
|-----------|--------|--------|------|
| Issue処理成功率 | 95% | 7日間 | 正常に完了したIssueの割合 |
| エージェント処理成功率 | 90% | 7日間 | エージェントタスクの成功率 |

## セットアップ

### 1. 設定

`config/config.json`に以下を追加：

```json
{
  "sla": {
    "enabled": true,
    "metricsRetentionDays": 30,
    "checkInterval": 60000,
    "reportSchedule": {
      "weekly": "0 0 * * 0",
      "monthly": "0 0 1 * *"
    },
    "alerts": {
      "channels": ["log", "github-issue"],
      "errorBudgetWarningThreshold": 0.2,
      "errorBudgetCriticalThreshold": 0.8
    }
  }
}
```

### 2. 統合

`minimal-poppo.js`に以下を追加：

```javascript
const { initializeSLAManager } = require('./src/sla-integration');

// SLAマネージャーを初期化
const slaManager = await initializeSLAManager(config, logger);

// メトリクスを記録
recordIssueProcessingMetrics(slaManager, {
  issueNumber: 123,
  success: true,
  startTime: startTime,
  endTime: Date.now(),
  createdAt: issue.created_at
});
```

## 使用方法

### メトリクスの記録

#### Issue処理メトリクス
```javascript
slaManager.recordMetric('issue_processing', {
  issueNumber: 123,
  success: true,
  duration: 300000,  // 5分
  startDelay: 240000 // 4分
});
```

#### ヘルスチェックメトリクス
```javascript
slaManager.recordMetric('health_check', {
  service: 'poppo-builder',
  success: true,
  duration: 100
});
```

#### API応答メトリクス
```javascript
slaManager.recordMetric('api_response', {
  endpoint: '/api/process',
  method: 'POST',
  status: 200,
  duration: 150
});
```

### ダッシュボードAPI

#### 現在のSLO状態
```
GET /api/slo/status
```

#### メトリクス時系列データ
```
GET /api/slo/metrics/:sloKey?startTime=<timestamp>&endTime=<timestamp>&resolution=1h
```

#### エラーバジェット
```
GET /api/slo/error-budget/:sloKey?days=30
```

#### SLOレポート
```
GET /api/slo/report/weekly
GET /api/slo/report/monthly
```

## アラート

### SLO違反アラート

SLO違反が検出されると、以下のアクションが実行されます：

1. **ログ出力**: エラーログにSLO違反を記録
2. **GitHub Issue作成**: 自動的にIssueを作成（`sla-violation`ラベル付き）
3. **通知**: 設定された通知チャネルに送信

### エラーバジェットアラート

- **警告（20%消費）**: エラーバジェットの警告通知
- **緊急（80%消費）**: 新機能リリースの停止を推奨

## レポート

### 週次レポート

毎週日曜日の0時に自動生成：
- 全体のコンプライアンス率
- 各SLOの達成状況
- インシデント分析
- 推奨事項

### 月次レポート

毎月1日の0時に自動生成：
- 月間パフォーマンストレンド
- エラーバジェット消費状況
- 改善提案

レポートは`reports/slo/`ディレクトリに保存されます。

## トラブルシューティング

### メトリクスが記録されない

1. SLAマネージャーが有効か確認：
```javascript
console.log(config.sla.enabled); // trueであることを確認
```

2. データベースの権限を確認：
```bash
ls -la data/poppo-history.db
```

### SLO違反が検出されない

1. メトリクスが正しく記録されているか確認
2. チェック間隔を短くしてテスト：
```json
"checkInterval": 10000  // 10秒
```

### レポートが生成されない

1. レポートディレクトリの権限を確認
2. 手動でレポート生成を実行：
```javascript
const report = await slaManager.generateReport('weekly');
```

## カスタムSLOの追加

`src/sla/sla-definitions.js`を編集：

```javascript
// カスタム可用性SLOを追加
SLADefinitions.availability['custom-service'] = {
  target: 0.98,
  window: 'rolling_7d',
  description: 'カスタムサービスの可用性'
};

// 対応するSLIを追加
SLIDefinitions.availability['custom-service'] = {
  good_events: 'custom_service_success',
  total_events: 'custom_service_total',
  measurement_interval: 60000
};
```

## ベストプラクティス

1. **適切な目標値の設定**: 現実的で達成可能な目標を設定
2. **段階的な改善**: 初期は緩めの目標から開始し、徐々に厳しく
3. **エラーバジェットの活用**: 残りバジェットに応じてリリース判断
4. **定期的なレビュー**: 月次レポートを基にSLO目標を見直し
5. **アラート疲れの防止**: 重要なアラートのみに絞る

## 関連ドキュメント

- [アーキテクチャ概要](architecture/system-overview.md)
- [モニタリングガイド](monitoring-guide.md)
- [ダッシュボードガイド](features/dashboard-guide.md)