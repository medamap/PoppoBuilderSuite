# CLI コマンドリファレンス

PoppoBuilder Suite で利用可能なすべてのCLIコマンドの完全なリファレンスです。

## 📋 コマンド一覧

### 基本コマンド

| コマンド | 説明 | エイリアス |
|---------|------|-----------|
| `npm start` | PoppoBuilderを起動 | `npm run start` |
| `npm stop` | PoppoBuilderを停止 | - |
| `npm restart` | PoppoBuilderを再起動 | - |
| `npm test` | テストを実行 | - |
| `npm run dashboard` | ダッシュボードを起動 | - |

### プロセス管理コマンド

| コマンド | 説明 | オプション |
|---------|------|-----------|
| `npm run poppo:status` | プロセス状態を表示 | `--json` |
| `npm run poppo:help` | ヘルプを表示 | - |
| `poppo status` | プロセス一覧 | `--json`, `--detailed` |
| `poppo kill <task-id>` | タスクを停止 | `-f, --force` |
| `poppo logs <task-id>` | ログを表示 | `-f, --follow`, `-n, --lines` |

## 🚀 基本コマンド詳細

### npm start

PoppoBuilderのメインプロセスを起動します。

```bash
npm start
```

**オプション（環境変数）:**
```bash
# デバッグモードで起動
DEBUG=* npm start

# カスタム設定ファイル
CONFIG_PATH=./custom-config.json npm start

# セーフモードで起動
SAFE_MODE=true npm start
```

**出力例:**
```
[2025-01-20 10:00:00] [INFO] PoppoBuilder-Main Starting PoppoBuilder...
[2025-01-20 10:00:01] [INFO] PoppoBuilder-Main Configuration loaded
[2025-01-20 10:00:02] [INFO] PoppoBuilder-Main Issue polling started (interval: 30s)
```

### npm run dashboard

Webダッシュボードを起動します。

```bash
npm run dashboard
```

**オプション:**
```bash
# カスタムポート
PORT=8080 npm run dashboard

# 認証無効化（開発環境のみ）
NO_AUTH=true npm run dashboard

# HTTPSモード
HTTPS=true npm run dashboard
```

## 🔧 プロセス管理コマンド

### poppo status

実行中のプロセスとその状態を表示します。

```bash
poppo status [options]
```

**オプション:**
- `-j, --json`: JSON形式で出力
- `-d, --detailed`: 詳細情報を表示
- `-w, --watch`: リアルタイム更新（1秒ごと）

**出力例（通常）:**
```
┌─────────────┬──────────────┬──────────┬────────┬─────────┬────────┐
│ Task ID     │ Type         │ Status   │ PID    │ Memory  │ CPU    │
├─────────────┼──────────────┼──────────┼────────┼─────────┼────────┤
│ issue-123   │ claude-cli   │ running  │ 12345  │ 125.4MB │ 15.2%  │
│ issue-124   │ github-api   │ waiting  │ 12346  │ 45.2MB  │ 0.5%   │
└─────────────┴──────────────┴──────────┴────────┴─────────┴────────┘
```

**出力例（JSON）:**
```json
{
  "processes": [
    {
      "taskId": "issue-123",
      "type": "claude-cli",
      "status": "running",
      "pid": 12345,
      "memory": 131534848,
      "cpu": 15.2,
      "startTime": "2025-01-20T10:00:00Z"
    }
  ]
}
```

### poppo kill

指定したタスクを停止します。

```bash
poppo kill <task-id> [options]
```

**引数:**
- `<task-id>`: 停止するタスクのID（必須）

**オプション:**
- `-f, --force`: 確認なしで強制終了
- `-s, --signal <signal>`: 送信するシグナル（デフォルト: SIGTERM）
- `-t, --timeout <seconds>`: タイムアウト秒数（デフォルト: 10）

**使用例:**
```bash
# 通常の停止（確認あり）
poppo kill issue-123

# 強制終了
poppo kill issue-123 --force

# SIGKILLを送信
poppo kill issue-123 --signal SIGKILL
```

### poppo logs

タスクのログを表示します。

```bash
poppo logs <task-id> [options]
```

**引数:**
- `<task-id>`: ログを表示するタスクのID（必須）

**オプション:**
- `-f, --follow`: リアルタイムでログを追跡
- `-n, --lines <number>`: 表示する行数（デフォルト: 100）
- `-l, --level <level>`: ログレベルでフィルタ（error/warn/info/debug）
- `--since <time>`: 指定時刻以降のログのみ表示
- `--until <time>`: 指定時刻以前のログのみ表示
- `--grep <pattern>`: パターンにマッチする行のみ表示

**使用例:**
```bash
# 最新100行を表示
poppo logs issue-123

# リアルタイム追跡
poppo logs issue-123 -f

# エラーログのみ表示
poppo logs issue-123 -l error

# 過去1時間のログ
poppo logs issue-123 --since "1 hour ago"

# パターンマッチ
poppo logs issue-123 --grep "timeout"
```

## 📊 分析・レポートコマンド

### npm run analytics:report

分析レポートを生成します。

```bash
npm run analytics:report [type] [options]
```

**タイプ:**
- `daily`: 日次レポート
- `weekly`: 週次レポート  
- `monthly`: 月次レポート
- `errors`: エラーレポート
- `memory`: メモリ使用レポート
- `performance`: パフォーマンスレポート

**オプション:**
- `--format <format>`: 出力形式（markdown/html/json）
- `--output <file>`: 出力ファイルパス
- `--period <period>`: 対象期間

**使用例:**
```bash
# 日次レポート（Markdown形式）
npm run analytics:report daily

# エラーレポート（HTML形式で保存）
npm run analytics:report errors --format html --output error-report.html

# 過去7日間のパフォーマンスレポート
npm run analytics:report performance --period 7d
```

### npm run analytics:stats

統計情報を表示します。

```bash
npm run analytics:stats [metric] [options]
```

**メトリクス:**
- `tasks`: タスク処理統計
- `errors`: エラー統計
- `memory`: メモリ使用統計
- `claude-cli`: Claude CLI実行統計

**使用例:**
```bash
# タスク処理統計
npm run analytics:stats tasks

# 特定タスクタイプの統計
npm run analytics:stats claude-cli

# JSON形式で出力
npm run analytics:stats errors --json
```

## 🔐 セキュリティ・認証コマンド

### npm run security:init

セキュリティ環境を初期化します。

```bash
npm run security:init
```

**実行内容:**
- APIキーの生成
- JWT秘密鍵の作成
- 初期管理者アカウントの作成
- セキュリティ設定ファイルの生成

### npm run security:report

セキュリティレポートを生成します。

```bash
npm run security:report [options]
```

**オプション:**
- `--detailed`: 詳細レポート
- `--audit`: 監査ログを含める

## 🗃️ バックアップ・リストアコマンド

### npm run backup:create

バックアップを作成します。

```bash
npm run backup:create [options]
```

**オプション:**
- `--name <name>`: バックアップ名
- `--compress`: 圧縮する（デフォルト: true）
- `--encrypt`: 暗号化する
- `--type <type>`: full/incremental

**使用例:**
```bash
# 通常のバックアップ
npm run backup:create

# 名前付きバックアップ
npm run backup:create -- --name "before-upgrade"

# 暗号化バックアップ
npm run backup:create -- --encrypt
```

### npm run backup:restore

バックアップから復元します。

```bash
npm run backup:restore <backup-id> [options]
```

**オプション:**
- `--dry-run`: 実際には復元しない（確認のみ）
- `--target <items>`: 特定の項目のみ復元
- `--force`: 確認なしで実行

**使用例:**
```bash
# バックアップ一覧を確認
npm run backup:list

# 最新のバックアップから復元
npm run backup:restore latest

# ドライラン
npm run backup:restore backup-20250120 -- --dry-run

# 特定ファイルのみ復元
npm run backup:restore latest -- --target "state/issue-status.json"
```

## 🔧 設定管理コマンド

### npm run config:show

現在の設定を表示します。

```bash
npm run config:show [options]
```

**オプション:**
- `--all`: すべての設定を表示（デフォルト値含む）
- `--json`: JSON形式で出力
- `--path <path>`: 特定のパスのみ表示

**使用例:**
```bash
# 現在の設定を表示
npm run config:show

# 特定の設定のみ表示
npm run config:show -- --path "claude.timeout"

# JSON形式で出力
npm run config:show -- --json
```

### npm run config:validate

設定ファイルの妥当性を検証します。

```bash
npm run config:validate [file]
```

**使用例:**
```bash
# デフォルト設定ファイルを検証
npm run config:validate

# カスタム設定ファイルを検証
npm run config:validate custom-config.json
```

### npm run config:get/set

設定値の取得・更新を行います。

```bash
# 取得
npm run config get <key>

# 設定
npm run config set <key> <value>
```

**使用例:**
```bash
# タイムアウト値を取得
npm run config get claude.timeout

# タイムアウト値を更新
npm run config set claude.timeout 300000

# 配列やオブジェクトの設定
npm run config set 'rateLimiter.github.maxRequests' 50
```

## 🧹 メンテナンスコマンド

### npm run log:rotate

ログファイルをローテーションします。

```bash
npm run log:rotate [options]
```

**オプション:**
- `--force`: サイズに関わらず強制ローテーション
- `--compress`: 古いログを圧縮

### npm run log:clean

古いログファイルを削除します。

```bash
npm run log:clean [options]
```

**オプション:**
- `--days <number>`: 保持日数（デフォルト: 30）
- `--dry-run`: 削除対象を表示のみ

### npm run cache:clear

キャッシュをクリアします。

```bash
npm run cache:clear [type]
```

**タイプ:**
- `all`: すべてのキャッシュ
- `analysis`: 分析結果キャッシュ
- `api`: APIレスポンスキャッシュ
- `temp`: 一時ファイル

## 🏥 ヘルスチェックコマンド

### npm run health:check

システムヘルスチェックを実行します。

```bash
npm run health:check [options]
```

**オプション:**
- `-d, --detailed`: 詳細な結果を表示
- `--json`: JSON形式で出力

**出力例:**
```
System Health Check Results:
✅ Application: Healthy (score: 95/100)
✅ System Resources: Healthy (CPU: 25%, Memory: 45%)
⚠️  Network: Degraded (GitHub API slow response)
✅ Data Integrity: Healthy

Overall Score: 85/100 - HEALTHY
```

### npm run health:report

診断レポートを生成します。

```bash
npm run health:report [options]
```

**オプション:**
- `-s, --save <file>`: ファイルに保存
- `--include-logs`: 最新のログを含める

## 🚨 トラブルシューティングコマンド

### npm run diagnose

問題診断を実行します。

```bash
npm run diagnose [component]
```

**コンポーネント:**
- `all`: すべて診断
- `github`: GitHub接続
- `claude`: Claude API接続
- `database`: データベース
- `filesystem`: ファイルシステム

### npm run repair

自動修復を試みます。

```bash
npm run repair [issue]
```

**修復可能な問題:**
- `locks`: ロックファイルのクリア
- `database`: データベースの修復
- `config`: 設定ファイルの修復
- `state`: 状態ファイルの修復

## 🔌 プラグイン・拡張コマンド

### npm run plugin:list

インストール済みプラグインを表示します。

```bash
npm run plugin:list
```

### npm run plugin:install

プラグインをインストールします。

```bash
npm run plugin:install <plugin-name>
```

### npm run plugin:remove

プラグインを削除します。

```bash
npm run plugin:remove <plugin-name>
```

## ⚙️ 環境変数

多くのコマンドは環境変数で動作をカスタマイズできます：

| 環境変数 | 説明 | デフォルト値 |
|---------|------|-------------|
| `NODE_ENV` | 実行環境 | `production` |
| `DEBUG` | デバッグ出力 | - |
| `LOG_LEVEL` | ログレベル | `info` |
| `CONFIG_PATH` | 設定ファイルパス | `./config/config.json` |
| `PORT` | ダッシュボードポート | `3001` |
| `GITHUB_TOKEN` | GitHub認証トークン | - |
| `CLAUDE_API_KEY` | Claude APIキー | - |

## 🎯 使用例とベストプラクティス

### 日常的な運用

```bash
# 朝の確認作業
npm run health:check
npm run poppo:status
npm run analytics:report daily

# 問題発生時
npm run diagnose all
npm run logs:tail -f | grep ERROR
npm run repair locks

# 定期メンテナンス
npm run backup:create -- --name "weekly-backup"
npm run log:clean
npm run cache:clear temp
```

### スクリプト化

```bash
#!/bin/bash
# daily-check.sh

echo "=== Daily Health Check ==="
npm run health:check --detailed

echo -e "\n=== Process Status ==="
poppo status --json | jq '.processes[] | select(.status=="error")'

echo -e "\n=== Error Summary ==="
npm run analytics:stats errors --period 24h

echo -e "\n=== Backup ==="
npm run backup:create -- --name "daily-$(date +%Y%m%d)"
```

詳細な情報は各コマンドの `--help` オプションで確認できます。