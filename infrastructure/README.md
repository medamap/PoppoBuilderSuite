# CCSP Agent インフラストラクチャ

このディレクトリには、CCSP（Claude Code Service Provider）エージェントの本格運用に必要なインフラストラクチャ設定が含まれています。

## ディレクトリ構造

```
infrastructure/
├── systemd/                 # systemdサービス設定
│   ├── ccsp-agent.service  # サービス定義ファイル
│   └── setup-systemd.sh    # セットアップスクリプト
├── monitoring/             # 監視設定
│   ├── prometheus.yml      # Prometheus設定
│   ├── alerts/            # アラートルール
│   ├── grafana-*.yml      # Grafanaプロビジョニング
│   └── grafana-dashboard.json  # ダッシュボード定義
├── backup/                # バックアップ・リストア
│   ├── ccsp-backup.sh     # バックアップスクリプト
│   └── ccsp-restore.sh    # リストアスクリプト
├── operations/            # 運用スクリプト
│   ├── ccsp-diagnostics.sh # 診断ツール
│   ├── ccsp-monitor.sh     # リアルタイムモニター
│   └── ccsp-log-analyzer.sh # ログ分析ツール
└── docker-compose.yml     # Docker Compose設定
```

## クイックスタート

### 1. 前提条件

- Ubuntu 20.04以上 または CentOS 8以上
- Docker & Docker Compose
- Node.js 18以上
- Redis 6以上
- root権限（systemd設定用）

### 2. systemdサービスのセットアップ

```bash
# root権限で実行
sudo ./systemd/setup-systemd.sh

# 環境変数を設定
sudo vim /etc/poppo/ccsp.env
# GITHUB_TOKEN=your_token_here を設定

# サービスを起動
sudo systemctl start ccsp-agent
sudo systemctl status ccsp-agent
```

### 3. 監視環境の起動

```bash
# Docker Composeで監視スタックを起動
cd infrastructure
docker-compose up -d

# 確認
docker-compose ps
```

アクセスURL:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000 (admin/ccsp-admin)
- Alertmanager: http://localhost:9093

### 4. 診断の実行

```bash
# システム診断
./operations/ccsp-diagnostics.sh

# リアルタイムモニタリング
./operations/ccsp-monitor.sh

# ログ分析（過去7日間）
./operations/ccsp-log-analyzer.sh --days 7
```

## 主要な機能

### systemd統合
- 自動起動設定
- メモリ・CPU制限
- セキュリティ強化（NoNewPrivileges、PrivateTmp等）
- ログローテーション連携

### 監視・アラート
- Prometheusメトリクス収集
- Grafanaダッシュボード
- 以下のメトリクスを監視:
  - サービス稼働状況
  - セッション状態
  - キューサイズと処理速度
  - エラー率とレート制限
  - システムリソース使用率

### バックアップ・リストア
- 定期バックアップ（日次推奨）
- 3種類のバックアップタイプ:
  - full: 完全バックアップ
  - incremental: 差分バックアップ
  - data-only: データのみ
- 圧縮・暗号化対応
- ポイントインタイムリカバリ

### 運用ツール
- **診断ツール**: システム全体の健全性チェック
- **モニター**: リアルタイムパフォーマンス監視
- **ログ分析**: エラー傾向とパフォーマンス分析

## バックアップ戦略

推奨バックアップスケジュール:
```bash
# crontabに追加
# 毎日深夜2時に増分バックアップ
0 2 * * * /path/to/infrastructure/backup/ccsp-backup.sh --type incremental --compress

# 毎週日曜日に完全バックアップ
0 3 * * 0 /path/to/infrastructure/backup/ccsp-backup.sh --type full --compress --retention 30
```

## アラート設定

Slackへの通知を有効にする場合:

1. `monitoring/alertmanager.yml`を編集
2. Slack Webhook URLを設定
3. Alertmanagerを再起動

```bash
docker-compose restart alertmanager
```

## トラブルシューティング

### サービスが起動しない
```bash
# ログを確認
journalctl -u ccsp-agent -f

# 診断ツールを実行
./operations/ccsp-diagnostics.sh
```

### Prometheusがメトリクスを収集できない
```bash
# CCSPのメトリクスエンドポイントを確認
curl http://localhost:9100/metrics

# Prometheusターゲットを確認
curl http://localhost:9090/api/v1/targets
```

### セッションタイムアウトが頻発する
```bash
# セッション状態を確認
./operations/ccsp-monitor.sh

# Claude CLIに再ログイン
claude login
```

## セキュリティ考慮事項

1. **環境変数**: `/etc/poppo/ccsp.env`は600権限で保護
2. **systemd**: セキュリティ強化設定を適用
3. **バックアップ**: 機密情報はマスクまたは暗号化
4. **ネットワーク**: 必要に応じてfirewallルールを設定

## メンテナンス

### ログローテーション
systemdジャーナルとアプリケーションログの両方が自動的にローテーションされます。

### メトリクス保持期間
- Prometheus: 30日間（設定変更可能）
- Grafana: 無制限（ディスク容量に依存）

### アップデート手順
1. バックアップを作成
2. サービスを停止
3. コードを更新
4. サービスを再起動
5. 診断ツールで確認

## 関連ドキュメント

- [CCSP Agent アーキテクチャ](../docs/agents/ccsp-agent.md)
- [PoppoBuilder Suite 運用ガイド](../docs/operations-guide.md)
- [セキュリティベストプラクティス](../docs/security-best-practices.md)