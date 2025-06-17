# PoppoBuilder マルチプロジェクト管理ガイド

## 概要

PoppoBuilderのマルチプロジェクト機能により、複数のGitHubプロジェクトを一元管理し、プロジェクト間でタスクの優先度制御を行うことができます。

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    PoppoBuilder デーモン                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────┐  │
│  │ グローバルキュー │  │プロジェクト管理  │  │ APIサーバ │  │
│  │  マネージャー    │  │   マネージャー   │  │ (Port 3003) │
│  └─────────────────┘  └──────────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│  ワーカー1  │  │  ワーカー2  │  │  ワーカー3  │
│ Project A   │  │ Project B   │  │ Project C   │
└─────────────┘  └─────────────┘  └─────────────┘
```

## インストール

1. 依存関係のインストール:
```bash
npm install
```

2. CLIツールのグローバルインストール（オプション）:
```bash
npm link
```

## 使用方法

### 1. デーモンの起動

```bash
# デーモンを起動
npm run poppo daemon --start

# または
poppo daemon --start

# デーモンの状態確認
poppo daemon --status

# デーモンの停止
poppo daemon --stop
```

### 2. プロジェクトの登録

```bash
# 現在のディレクトリをプロジェクトとして登録
poppo project -r .

# 別のディレクトリを登録
poppo project -r /path/to/project

# プロジェクト一覧の確認
poppo project -l
```

### 3. プロジェクト設定

プロジェクトを登録すると、`.poppo/project.json`ファイルが作成されます：

```json
{
  "id": "owner/repo",
  "name": "My Project",
  "priority": 50,
  "labels": {
    "misc": "task:misc",
    "dogfooding": "task:dogfooding",
    "bug": "task:bug",
    "feature": "task:feature"
  },
  "maxConcurrentTasks": 2,
  "pollingInterval": 30000
}
```

### 4. 優先度管理

プロジェクトの優先度（0-100）を設定:

```bash
poppo project -p my-project 80
```

優先度の目安:
- 100: 最高優先度（dogfoodingタスクなど）
- 75-99: 高優先度
- 50-74: 通常優先度
- 25-49: 低優先度
- 0-24: 最低優先度

### 5. タスクのスキャンとキュー管理

```bash
# プロジェクトのタスクをスキャン
poppo project -s my-project

# グローバルキューの状態確認
poppo queue -s

# ワーカーの状態確認
poppo worker -l
```

### 6. ダッシュボード

統合ダッシュボードでマルチプロジェクトの状態を可視化:

```bash
# ダッシュボードを開く
poppo dashboard

# または直接アクセス
http://localhost:3001/multi-project.html
```

## 設定

### デーモン設定 (`config/daemon-config.json`)

```json
{
  "port": 3003,
  "host": "localhost",
  "dataDir": "~/.poppo-builder",
  "maxWorkers": 10,
  "maxQueueSize": 1000,
  "workerTimeout": 3600000,
  "pollInterval": 5000
}
```

### メインシステム設定 (`config/config.json`)

マルチプロジェクトモードを有効にする:

```json
{
  "multiProject": {
    "enabled": true,
    "daemonUrl": "http://localhost:3003"
  }
}
```

## 高度な機能

### リソース最適化

デーモンは1分ごとにプロジェクト間のリソース配分を自動最適化します。以下の要素を考慮:
- プロジェクト優先度
- キュー内のタスク数
- 過去の実行統計

### プロジェクトの健全性

プロジェクトの健全性は成功率に基づいて自動計算されます:
- 🟢 Excellent: 成功率90%以上
- 🔵 Good: 成功率70-89%
- 🟡 Fair: 成功率50-69%
- 🔴 Poor: 成功率50%未満

### 自動タスクスキャン

`autoScan`設定により、定期的にプロジェクトのタスクを自動スキャンできます:

```json
{
  "autoScan": {
    "enabled": true,
    "interval": 300000
  }
}
```

## トラブルシューティング

### デーモンが起動しない

1. ポート3003が使用されていないか確認:
```bash
lsof -i :3003
```

2. PIDファイルを削除:
```bash
rm ~/.poppo-builder/poppo-daemon.pid
```

### ワーカーが起動しない

1. プロジェクトが正しく登録されているか確認:
```bash
poppo project -l
```

2. プロジェクトディレクトリに`.poppo/project.json`が存在するか確認

### タスクが処理されない

1. キューの状態を確認:
```bash
poppo queue -s
```

2. 対象のIssueに正しいラベルが付いているか確認

## APIリファレンス

### デーモンAPI

- `GET /api/health` - ヘルスチェック
- `POST /api/projects/register` - プロジェクト登録
- `GET /api/projects` - プロジェクト一覧
- `GET /api/queue/status` - キューステータス
- `POST /api/queue/enqueue` - タスクエンキュー
- `GET /api/workers` - ワーカー一覧

## ベストプラクティス

1. **プロジェクト優先度の設定**
   - 重要なプロダクションプロジェクトには高優先度を設定
   - 開発/テストプロジェクトには低優先度を設定

2. **ワーカー数の調整**
   - CPU/メモリリソースに応じて`maxWorkers`を調整
   - 各プロジェクトの`maxConcurrentTasks`も適切に設定

3. **定期的なメンテナンス**
   - ログファイルの定期的なローテーション
   - 完了済みタスクのクリーンアップ

4. **監視とアラート**
   - ダッシュボードで定期的に状態を確認
   - 重要なプロジェクトのエラー率を監視