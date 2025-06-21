# PoppoBuilder Suite 監視システム

PoppoBuilder Suiteの包括的な監視システムです。Prometheus、Grafana、Alertmanagerを使用してシステムの健全性を可視化し、問題を早期発見します。

## 🎯 監視対象

### システムメトリクス
- **CPU使用率** - システム全体とエージェント別
- **メモリ使用量** - 物理メモリ、ヒープメモリ
- **ディスク使用量** - ストレージ容量と読み書き速度
- **ネットワーク** - 接続状況とレスポンス時間

### アプリケーションメトリクス
- **Issue処理速度** - 1分間あたりの処理数
- **Issue処理成功率** - 成功/失敗の割合
- **エージェント稼働状況** - 各エージェントの生存状態
- **キューサイズ** - 待機中のタスク数

### APIメトリクス
- **GitHub API** - リクエスト数、レート制限、レスポンス時間
- **Claude API** - 使用トークン数、セッション状態
- **エラー率** - API呼び出しの失敗率

### Redis/データベース
- **接続状況** - Redis接続の健全性
- **操作レスポンス時間** - データベース操作の速度
- **キュー長** - メッセージキューの待機数

## 🚀 クイックスタート

### 1. 前提条件の確認

```bash
# Docker確認
docker --version

# Docker Compose確認
docker-compose --version
```

### 2. 依存関係のインストール

```bash
# Node.js依存関係
npm install prom-client

# または package.json から一括インストール
npm install
```

### 3. 監視スタックの起動

```bash
# 一括起動
npm run monitoring:start

# または個別起動
bash scripts/start-monitoring.sh start
```

### 4. ダッシュボードへのアクセス

監視システムが起動すると、以下のURLでアクセスできます：

- **Grafana**: http://localhost:3000 (admin/poppo2024)
- **Prometheus**: http://localhost:9090
- **Alertmanager**: http://localhost:9093

## 📊 Grafanaダッシュボード

### 1. システム概要ダッシュボード
- **URL**: http://localhost:3000/d/poppo-overview
- **内容**: システム全体の健全性、パフォーマンス概要
- **用途**: 日次の健全性確認、問題の早期発見

### 2. エージェント詳細ダッシュボード
- **URL**: http://localhost:3000/d/poppo-agents
- **内容**: 各エージェントの詳細メトリクス
- **用途**: エージェント別の詳細分析

### 3. エラー分析ダッシュボード
- **URL**: http://localhost:3000/d/poppo-errors
- **内容**: エラー発生状況、APIエラー、レート制限
- **用途**: 問題の詳細分析、根本原因調査

## 🔧 設定

### Prometheus設定
`infrastructure/monitoring/prometheus/prometheus.yml` でスクレイプ設定を管理：

```yaml
scrape_configs:
  - job_name: 'poppo-main'
    static_configs:
      - targets: ['host.docker.internal:9090']
    scrape_interval: 15s
```

### Grafana設定
- **データソース**: `infrastructure/monitoring/grafana/datasources/`
- **ダッシュボード**: `infrastructure/monitoring/grafana/dashboards/`

### Alertmanager設定
`infrastructure/monitoring/alertmanager/alertmanager.yml` でアラート通知を設定：

```yaml
receivers:
  - name: 'critical-alerts'
    slack_configs:
      - channel: '#alerts'
        title: 'PoppoBuilder Critical Alert'
```

## 🚨 アラート設定

### 定義済みアラート

1. **CCSPServiceDown** - エージェント停止
2. **CCSPHighMemoryUsage** - メモリ使用量過多
3. **CCSPHighErrorRate** - エラー率上昇
4. **CCSPLargeQueueSize** - キューサイズ異常
5. **CCSPSessionTimeout** - Claudeセッションタイムアウト

### カスタムアラートの追加

1. `infrastructure/monitoring/prometheus/rules/` にYAMLファイルを作成
2. Prometheusの設定を再読み込み

```bash
docker-compose -f infrastructure/docker-compose.monitoring.yml restart prometheus
```

## 📈 メトリクス収集の統合

### Dashboard Serverとの統合

```javascript
// ダッシュボードサーバーでメトリクス記録
dashboardServer.recordIssueProcessing('ccsp', 'bug', 'success', 45.2);
dashboardServer.recordGitHubApiCall('/issues', 200, 1.2, 4500);
dashboardServer.recordClaudeApiCall('opus', 'success', { input: 1000, output: 500 });
```

### エージェントでの統合

```javascript
const PrometheusExporter = require('./src/prometheus-exporter');

// エージェント内でメトリクス初期化
const exporter = new PrometheusExporter({ port: 9091 });
await exporter.start();

// メトリクス記録
exporter.recordIssueProcessing('agent-name', 'feature', 'success', 30.5);
exporter.updateAgentMetrics('agent-name', {
  status: 1,
  uptime: process.uptime(),
  memory: process.memoryUsage(),
  cpu: 15.5
});
```

## 🔍 トラブルシューティング

### よくある問題

1. **Prometheusがメトリクスを収集できない**
   ```bash
   # ターゲットの確認
   curl http://localhost:9090/api/v1/targets
   
   # PoppoBuilderメトリクスの確認
   curl http://localhost:9090/metrics
   ```

2. **Grafanaでデータが表示されない**
   ```bash
   # データソース接続確認
   curl http://prometheus:9090/api/v1/query?query=up
   ```

3. **Alertmanagerが通知を送信しない**
   ```bash
   # アラート状態確認
   curl http://localhost:9093/api/v1/alerts
   
   # 設定検証
   docker run --rm -v "$(pwd)/infrastructure/monitoring/alertmanager:/etc/alertmanager" \
     prom/alertmanager:v0.26.0 amtool check-config /etc/alertmanager/alertmanager.yml
   ```

### ログ確認

```bash
# 全サービスのログ
npm run monitoring:logs

# 特定サービスのログ
npm run monitoring:logs prometheus
npm run monitoring:logs grafana
npm run monitoring:logs alertmanager
```

### 設定の検証

```bash
# Prometheus設定チェック
docker run --rm -v "$(pwd)/infrastructure/monitoring/prometheus:/etc/prometheus" \
  prom/prometheus:v2.47.2 promtool check config /etc/prometheus/prometheus.yml

# アラートルールチェック
docker run --rm -v "$(pwd)/infrastructure/monitoring/prometheus:/etc/prometheus" \
  prom/prometheus:v2.47.2 promtool check rules /etc/prometheus/rules/*.yml
```

## 🛠️ 管理コマンド

```bash
# 監視システム管理
npm run monitoring:start    # 起動
npm run monitoring:stop     # 停止
npm run monitoring:restart  # 再起動
npm run monitoring:status   # 状態確認
npm run monitoring:info     # 情報表示

# ヘルスチェック
bash scripts/start-monitoring.sh health
```

## 📋 パフォーマンス目標

| メトリクス | 目標値 | 警告閾値 | 緊急閾値 |
|-----------|---------|----------|----------|
| Issue処理速度 | > 1000/hour | < 500/hour | < 100/hour |
| システム応答時間 | < 200ms (P95) | > 500ms | > 1000ms |
| エラー率 | < 1% | > 5% | > 20% |
| CPU使用率 | < 50% | > 80% | > 95% |
| メモリ使用量 | < 2GB | > 4GB | > 6GB |

## 🔐 セキュリティ

### 認証・認可
- Grafana: admin/poppo2024 (初期設定、本番環境では変更必須)
- Prometheus: Basic認証なし（内部ネットワークのみ）
- Redis: パスワード認証（redis.conf）

### ネットワークセキュリティ
- 監視コンポーネントは専用Dockerネットワーク内で隔離
- 外部アクセスは必要最小限のポートのみ開放

## 📚 関連ドキュメント

- [Prometheus Documentation](https://prometheus.io/docs/)
- [Grafana Documentation](https://grafana.com/docs/)
- [Alertmanager Documentation](https://prometheus.io/docs/alerting/latest/alertmanager/)
- [PoppoBuilder Architecture Guide](../../docs/architecture/system-overview.md)

## 🤝 貢献

監視システムの改善にご協力ください：

1. 新しいメトリクスの提案
2. ダッシュボードの改善
3. アラートルールの最適化
4. ドキュメントの更新

## 📄 ライセンス

PoppoBuilder Suiteと同じライセンスが適用されます。