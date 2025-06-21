# システムヘルスチェックの高度化 - 設計書

## 概要
PoppoBuilder Suiteのシステム健全性を包括的に監視し、問題を早期に検出・対処するための高度なヘルスチェック機能を実装します。

## アーキテクチャ

### コンポーネント構成
```
┌─────────────────────────────────────────────────────────────┐
│                    HealthCheckManager                        │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │HealthChecker│  │MetricsStore  │  │RecoveryManager  │  │
│  │   Engine    │  │              │  │                  │  │
│  └──────┬──────┘  └──────┬───────┘  └────────┬─────────┘  │
│         │                 │                    │            │
│  ┌──────▼──────────────────▼──────────────────▼─────────┐  │
│  │                  Health Monitors                      │  │
│  │ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────────────┐ │  │
│  │ │ App    │ │System  │ │Network │ │ Data           │ │  │
│  │ │Monitor │ │Monitor │ │Monitor │ │ Monitor        │ │  │
│  │ └────────┘ └────────┘ └────────┘ └────────────────┘ │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Alert & Report    │
                    │     Manager         │
                    └────────────────────┘
```

## 実装詳細

### 1. HealthCheckManager (`src/health-check-manager.js`)
メインのヘルスチェック管理クラス。各モニターの統合管理とスコアリングを担当。

**主な機能:**
- 各モニターの初期化と管理
- 総合健全性スコアの算出
- ヘルスチェックAPIの提供
- 自動回復の制御

### 2. Health Monitors

#### ApplicationMonitor (`src/monitors/application-monitor.js`)
- 各エージェントの応答性チェック
- プロセス生存確認
- タスクキューの監視
- メモリ使用量の監視

#### SystemMonitor (`src/monitors/system-monitor.js`)
- CPU使用率の監視
- メモリ使用状況（システム全体）
- ディスク容量チェック
- ファイルディスクリプタ数

#### NetworkMonitor (`src/monitors/network-monitor.js`)
- GitHub API接続性
- Claude API接続性
- レスポンスタイムの測定
- ネットワークエラー率

#### DataMonitor (`src/monitors/data-monitor.js`)
- SQLiteデータベース整合性
- ログファイルの破損チェック
- 設定ファイルの妥当性検証
- キューファイルの整合性

### 3. MetricsStore (`src/health-metrics-store.js`)
- メトリクスの時系列保存
- トレンド分析
- 異常パターンの検出
- 予測分析

### 4. RecoveryManager (`src/recovery-manager.js`)
- 自動回復アクションの実行
- プロセス再起動
- メモリクリーンアップ
- キューのクリア
- ログローテーション

### 5. AlertManager (`src/alert-manager.js`)
- アラートルールの管理
- 通知の送信（既存のNotificationManager利用）
- アラートの集約とスロットリング
- エスカレーション管理

## ヘルスチェックエンドポイント

### `/api/health`
基本的な生存確認
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "2025-06-18T10:00:00.000Z",
  "score": 95
}
```

### `/api/health/detailed`
詳細な状態情報
```json
{
  "status": "healthy",
  "score": 95,
  "timestamp": "2025-06-18T10:00:00.000Z",
  "components": {
    "application": {
      "status": "healthy",
      "score": 100,
      "details": {
        "agents": {
          "ccla": { "status": "running", "lastHeartbeat": "..." },
          "ccag": { "status": "running", "lastHeartbeat": "..." }
        }
      }
    },
    "system": {
      "status": "healthy",
      "score": 90,
      "details": {
        "cpu": 45,
        "memory": 68,
        "disk": 75
      }
    }
  }
}
```

### `/api/health/ready`
準備完了状態
```json
{
  "ready": true,
  "checks": {
    "database": true,
    "agents": true,
    "api": true
  }
}
```

### `/api/health/metrics`
Prometheus形式のメトリクス
```
# HELP poppobuilder_health_score Overall health score
# TYPE poppobuilder_health_score gauge
poppobuilder_health_score 95

# HELP poppobuilder_agent_status Agent status (1=running, 0=stopped)
# TYPE poppobuilder_agent_status gauge
poppobuilder_agent_status{agent="ccla"} 1
poppobuilder_agent_status{agent="ccag"} 1
```

## スコアリングシステム

### 重み付け
- アプリケーション層: 40%
  - エージェント生存: 20%
  - タスク処理能力: 20%
- システム層: 30%
  - CPU: 10%
  - メモリ: 10%
  - ディスク: 10%
- ネットワーク層: 20%
  - API接続性: 15%
  - レイテンシ: 5%
- データ層: 10%
  - DB整合性: 5%
  - ファイル整合性: 5%

### スコア計算
```javascript
totalScore = Σ(componentScore × weight)
status = score >= 80 ? 'healthy' : score >= 60 ? 'degraded' : 'unhealthy'
```

## 自動回復シナリオ

### 1. メモリ使用率80%超
- トリガー: システムメモリ使用率 > 80%
- アクション:
  1. ガベージコレクション実行
  2. 古いログファイルの削除
  3. キャッシュのクリア
  4. アラート送信

### 2. プロセス無応答
- トリガー: エージェントのハートビート途絶（60秒）
- アクション:
  1. プロセスの強制終了
  2. 自動再起動
  3. 再起動失敗時はアラート

### 3. ディスク容量不足
- トリガー: ディスク使用率 > 90%
- アクション:
  1. 古いログのアーカイブ
  2. 一時ファイルの削除
  3. データベースのVACUUM実行

### 4. API接続エラー
- トリガー: API接続失敗率 > 50%
- アクション:
  1. 接続リトライ（exponential backoff）
  2. フェイルオーバー（バックアップAPIあれば）
  3. レート制限の調整

## CLI統合

### `npm run health:check`
現在の健全性チェック実行

### `npm run health:report`
詳細な診断レポート生成

### `npm run health:history`
過去の健全性履歴表示

## 設定

```json
{
  "healthCheck": {
    "enabled": true,
    "interval": 60000,
    "scoring": {
      "weights": {
        "application": 0.4,
        "system": 0.3,
        "network": 0.2,
        "data": 0.1
      }
    },
    "thresholds": {
      "healthy": 80,
      "degraded": 60
    },
    "autoRecovery": {
      "enabled": true,
      "actions": {
        "memoryCleanup": true,
        "processRestart": true,
        "diskCleanup": true,
        "apiRetry": true
      }
    },
    "alerts": {
      "enabled": true,
      "channels": ["discord", "log"],
      "throttle": 300000
    }
  }
}
```

## 実装優先順位

1. **Phase 1**: 基本実装
   - HealthCheckManager
   - 基本的なモニター（Application, System）
   - ヘルスチェックエンドポイント

2. **Phase 2**: 高度な機能
   - NetworkMonitor, DataMonitor
   - MetricsStore（トレンド分析）
   - 自動回復機能

3. **Phase 3**: 統合と最適化
   - AlertManager統合
   - Prometheusメトリクス
   - ダッシュボード統合

## テスト計画

1. **単体テスト**
   - 各モニターのテスト
   - スコア計算ロジック
   - 自動回復アクション

2. **統合テスト**
   - エンドツーエンドのヘルスチェック
   - 自動回復シナリオ
   - アラート送信

3. **負荷テスト**
   - 高負荷時の動作確認
   - メトリクス収集のパフォーマンス