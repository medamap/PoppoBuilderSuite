# バックアップ・リストア機能

PoppoBuilder Suiteの重要なデータとシステム状態を定期的にバックアップし、必要時に迅速にリストアできる機能です。

## 概要

この機能により、以下のリスクから保護されます：
- データ損失時の復旧困難
- 設定ミスからの回復手段不足
- 災害時の事業継続性
- 環境移行の困難さ

## バックアップ対象

### 1. システムデータ
- `config/` ディレクトリ全体
- `.poppo/` ディレクトリの設定
- データベースファイル（SQLite）
- 環境変数設定（マスキング付き）

### 2. 実行データ
- `logs/` ディレクトリ（圧縮済みログのみ）
- 実行履歴データベース
- プロセス状態情報
- キュー状態

### 3. エージェントデータ
- CCLA学習データ（`data/ccla/`）
- CCAG生成ドキュメント（`data/ccag/`）
- CCPM分析結果（`data/ccpm/`）
- カスタムエージェント設定

### 4. 状態ファイル
- `state/` ディレクトリ全体
- 実行中タスク情報
- 処理済みIssue/コメント情報

### 5. 認証・セキュリティ
- 認証トークン（暗号化）
- アクセスログ
- 証明書（参照のみ）

## 使用方法

### CLIコマンド

#### バックアップの作成
```bash
# 完全バックアップを作成
npm run backup:create

# 特定の対象のみバックアップ
npm run backup:create -- --targets config,database

# 名前を指定してバックアップ
npm run backup:create -- --name "before-upgrade"

# 暗号化付きバックアップ
npm run backup:create -- --encrypt
```

#### バックアップ一覧の表示
```bash
npm run backup:list
```

出力例：
```
バックアップ一覧:
────────────────────────────────────────────────────────────────────────────────
ID                                      日時                タイプ      サイズ    
────────────────────────────────────────────────────────────────────────────────
backup-2025-06-19T12-00-00-000Z-abc123  2025/06/19 12:00:00  manual      125.3 MB  
backup-2025-06-18T02-00-00-000Z-def456  2025/06/18 02:00:00  scheduled   120.1 MB  
────────────────────────────────────────────────────────────────────────────────
合計: 2 件のバックアップ
```

#### バックアップの検証
```bash
npm run backup:verify backup-2025-06-19T12-00-00-000Z-abc123
```

#### バックアップからのリストア
```bash
# 完全リストア
npm run backup:restore backup-2025-06-19T12-00-00-000Z-abc123

# ドライランモード（実際のリストアは行わない）
npm run backup:restore backup-id -- --dry-run

# 特定の対象のみリストア
npm run backup:restore backup-id -- --targets config,state

# リストア前のバックアップをスキップ
npm run backup:restore backup-id -- --skip-backup
```

### 自動バックアップ

設定ファイル（`config/config.json`）で自動バックアップを設定できます：

```json
{
  "backup": {
    "enabled": true,
    "schedule": "0 2 * * *",      // 毎日午前2時
    "retention": 30,              // 30日間保持
    "maxBackups": 10,             // 最大10世代
    "storage": {
      "type": "local",
      "path": "./backups",
      "compress": true,
      "encrypt": false
    },
    "targets": {
      "config": true,
      "database": true,
      "logs": true,
      "agents": true,
      "state": true,
      "security": true
    }
  }
}
```

### スケジュール設定

#### cron式での設定
```json
{
  "backup": {
    "schedule": "0 2 * * *"  // 毎日午前2時
  }
}
```

#### 複数スケジュール
```json
{
  "backup": {
    "schedule": {
      "daily": {
        "cron": "0 2 * * *",
        "type": "incremental"
      },
      "weekly": {
        "cron": "0 3 * * 0",
        "type": "full"
      }
    }
  }
}
```

## バックアップ形式

### ディレクトリ構造
```
backups/
├── backup-2025-06-19T12-00-00-000Z-abc123/
│   ├── metadata.json
│   ├── config/
│   │   ├── config.json
│   │   └── environment.json
│   ├── database/
│   │   ├── poppo-history.db
│   │   └── security.db
│   ├── logs/
│   │   └── *.gz
│   ├── agents/
│   │   ├── ccla/
│   │   ├── ccag/
│   │   └── ccpm/
│   ├── state/
│   │   └── *.json
│   └── security/
│       ├── env.encrypted
│       └── access.log
└── backup-2025-06-19T12-00-00-000Z-abc123.tar.gz  # 圧縮版
```

### メタデータ形式
```json
{
  "id": "backup-2025-06-19T12-00-00-000Z-abc123",
  "timestamp": "2025-06-19T12:00:00.000Z",
  "version": "1.0.0",
  "type": "manual",
  "incremental": false,
  "targets": {
    "config": {
      "files": 5,
      "size": 10240
    },
    "database": {
      "files": 3,
      "size": 5242880
    }
  },
  "checksum": "sha256:...",
  "duration": 1234,
  "size": 125312000
}
```

## 高度な機能

### 増分バックアップ
```json
{
  "backup": {
    "incremental": {
      "enabled": true,
      "maxIncrementals": 7  // 7回の増分後に完全バックアップ
    }
  }
}
```

### 暗号化
```json
{
  "backup": {
    "storage": {
      "encrypt": true,
      "encryptionKey": "your-secret-key"  // 環境変数推奨
    }
  }
}
```

### リモートストレージ（将来の拡張）
```json
{
  "backup": {
    "storage": {
      "type": "s3",
      "bucket": "poppo-backups",
      "region": "ap-northeast-1",
      "accessKeyId": "...",
      "secretAccessKey": "..."
    }
  }
}
```

## トラブルシューティング

### バックアップが失敗する場合

1. **ディスク容量不足**
   ```bash
   df -h
   # backupsディレクトリの容量を確認
   ```

2. **権限エラー**
   ```bash
   # バックアップディレクトリの権限を確認
   ls -la backups/
   ```

3. **整合性チェックエラー**
   - データベースの破損をチェック
   - 設定ファイルのJSON構文を確認

### リストアが失敗する場合

1. **バックアップの検証**
   ```bash
   npm run backup:verify backup-id
   ```

2. **部分的リストア**
   ```bash
   # 問題のある対象を除外
   npm run backup:restore backup-id -- --targets config,state
   ```

3. **手動リストア**
   - バックアップディレクトリから直接ファイルをコピー

## ベストプラクティス

1. **定期的なバックアップ**
   - 本番環境では日次バックアップを推奨
   - 重要な変更前には手動バックアップ

2. **バックアップの検証**
   - 定期的にバックアップの検証を実行
   - リストアテストの実施

3. **保持期間の管理**
   - ディスク容量に応じて適切な保持期間を設定
   - 重要なバックアップは別途保管

4. **セキュリティ**
   - 暗号化キーは環境変数で管理
   - バックアップディレクトリの権限を適切に設定

5. **監視とアラート**
   - バックアップ失敗時の通知設定
   - ディスク容量の監視

## 関連項目

- [ログローテーション](./log-rotation.md)
- [ヘルスチェック](./design/health-check-advanced.md)
- [設定管理](./config-management.md)