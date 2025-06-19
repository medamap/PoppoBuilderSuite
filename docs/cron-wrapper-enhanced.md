# PoppoBuilder Cron Wrapper 強化版

## 概要
`scripts/poppo-cron-wrapper.sh`は、cron環境でPoppoBuilderを安全に実行するための強化されたラッパースクリプトです。

## 主な機能

### 1. 堅牢なロック機構
- アトミックなディレクトリ作成（`mkdir`）によるレースコンディション回避
- PIDファイルによるプロセス生存確認
- 古いロックの自動クリーンアップ

### 2. エラーハンドリング
- `set -euo pipefail`による厳密なエラー制御
- シグナルトラップ（EXIT、INT、TERM）による確実なクリーンアップ
- レベル別ログ出力（INFO、WARN、ERROR）

### 3. cron環境対応
- 必要な環境変数の明示的設定
- Node.jsパスの自動検出
- UTF-8ロケール設定

### 4. ログ管理
- サイズベースの自動ローテーション（10MB）
- gzip圧縮による容量節約
- 古いログの自動削除（7日以上）

### 5. タイムアウト処理
- 実行タイムアウト（30分）
- タイムアウト時の適切なエラー処理

## 使用方法

### crontabへの登録
```bash
*/5 * * * * /path/to/PoppoBuilderSuite/scripts/poppo-cron-wrapper.sh
```

### 手動実行
```bash
./scripts/poppo-cron-wrapper.sh
```

### ログの確認
```bash
tail -f logs/cron/poppo-cron-$(date +%Y-%m-%d).log
```

## 設定値

| 設定項目 | デフォルト値 | 説明 |
|---------|------------|------|
| MAX_LOG_SIZE | 10MB | ログローテーションのサイズ閾値 |
| LOG_RETENTION_DAYS | 7日 | ログ保持期間 |
| EXECUTION_TIMEOUT | 30分 | 実行タイムアウト |

## トラブルシューティング

### ロックファイルが残る場合
古いロックファイルは自動的に検出・削除されますが、手動削除が必要な場合：
```bash
rm -rf state/poppo-cron.lock
```

### Node.jsが見つからない場合
スクリプトは以下の順でNode.jsを検索します：
1. `/opt/homebrew/bin/node` (macOS Homebrew)
2. `/usr/local/bin/node`
3. `/usr/bin/node`
4. `which node`

### 二重起動の確認
```bash
# ロック状態の確認
ls -la state/poppo-cron.lock/
cat state/poppo-cron.lock/pid
```

## セキュリティ考慮事項
- GitHub認証トークンは環境から安全に取得
- ログファイルの権限は644に設定
- ロックファイルにはPIDとホスト名を記録