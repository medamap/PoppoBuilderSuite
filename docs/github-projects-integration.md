# GitHub Projects統合機能

## 概要

PoppoBuilder SuiteとGitHub Projects (v2)を統合し、Issueの処理状態とプロジェクトボードを自動的に同期する機能です。これにより、プロジェクト管理の自動化と進捗の可視化が実現されます。

## 機能

### 1. 自動同期機能
- PoppoBuilderの処理状態とプロジェクトカラムの双方向同期
- Issueステータス変更時の自動反映
- プロジェクトボードからの変更取り込み

### 2. プロジェクト管理
- 複数プロジェクトの同時サポート
- プロジェクトごとのカスタム設定
- 自動Issue追加・アーカイブ機能

### 3. ステータスマッピング
- PoppoBuilderステータスとプロジェクトステータスの柔軟なマッピング
- カスタムマッピングの定義可能

### 4. レポート機能
- プロジェクト進捗レポート
- ステータス別集計
- 進捗率の計算

## アーキテクチャ

### コンポーネント構成

```
GitHubProjectsClient
  ├── GraphQL APIラッパー
  ├── プロジェクト操作
  └── アイテム管理

GitHubProjectsSync
  ├── StatusManager連携
  ├── 同期ロジック
  ├── イベント管理
  └── レポート生成
```

## 設定

### config.json

```json
{
  "githubProjects": {
    "enabled": true,
    "token": "${GITHUB_TOKEN}",
    "syncInterval": 300000,  // 5分
    "projects": [
      {
        "id": "PVT_kwDOBq5-Ys4Aj5Xv",
        "name": "PoppoBuilder Tasks",
        "autoAdd": true,
        "autoArchive": true,
        "statusMapping": {
          "pending": "Todo",
          "processing": "In Progress",
          "awaiting-response": "In Review",
          "completed": "Done",
          "error": "Blocked"
        },
        "filters": {
          "labels": ["task:misc", "task:dogfooding", "task:feature"],
          "excludeLabels": ["wontfix", "duplicate"]
        }
      }
    ]
  }
}
```

### 環境変数

```bash
# GitHubトークン（Projects権限が必要）
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxx

# プロジェクトID（オプション）
export GITHUB_PROJECT_ID=PVT_kwDOBq5-Ys4Aj5Xv
```

## 使用方法

### 1. プロジェクトIDの取得

```bash
# GitHubのプロジェクトページでURLを確認
# https://github.com/users/USERNAME/projects/PROJECT_NUMBER

# GraphQL APIでプロジェクト一覧を取得
node test/test-github-projects.js
```

### 2. 設定の有効化

```json
// config.jsonで有効化
{
  "githubProjects": {
    "enabled": true,
    "projects": [
      {
        "id": "YOUR_PROJECT_ID"
      }
    ]
  }
}
```

### 3. PoppoBuilder起動

```bash
npm start
# GitHub Projects同期が自動的に開始されます
```

## ステータスマッピング

### デフォルトマッピング

| PoppoBuilder | GitHub Projects |
|--------------|----------------|
| pending | Todo |
| processing | In Progress |
| awaiting-response | In Review |
| completed | Done |
| error | Blocked |
| skipped | Cancelled |

### カスタムマッピング

プロジェクトごとに独自のマッピングを定義できます：

```json
{
  "statusMapping": {
    "pending": "Backlog",
    "processing": "Working on it",
    "completed": "Shipped"
  }
}
```

## イベント

### 発生するイベント

```javascript
// アイテムがプロジェクトに追加された
githubProjectsSync.on('item-added', ({ projectId, issueNumber }) => {
  console.log(`Issue #${issueNumber} が追加されました`);
});

// ステータスが更新された
githubProjectsSync.on('status-updated', ({ projectId, issueNumber, oldStatus, newStatus }) => {
  console.log(`Issue #${issueNumber}: ${oldStatus} → ${newStatus}`);
});

// アイテムがアーカイブされた
githubProjectsSync.on('item-archived', ({ projectId, issueNumber }) => {
  console.log(`Issue #${issueNumber} がアーカイブされました`);
});

// 同期が完了した
githubProjectsSync.on('sync-completed', () => {
  console.log('同期完了');
});
```

## API リファレンス

### GitHubProjectsClient

```javascript
// プロジェクト一覧取得
const projects = await client.listProjects(owner, isOrg);

// プロジェクト詳細取得
const project = await client.getProject(projectId);

// プロジェクトアイテム取得
const items = await client.getProjectItems(projectId, limit);

// Issueをプロジェクトに追加
const item = await client.addIssueToProject(projectId, issueId);

// ステータス更新
await client.updateItemStatus(projectId, itemId, statusFieldId, statusOptionId);
```

### GitHubProjectsSync

```javascript
// 初期化
await sync.initialize();

// 定期同期開始
sync.startPeriodicSync(interval);

// 手動同期
await sync.syncIssueStatus(issueNumber, status);

// プロジェクトから同期
await sync.syncFromProject(projectId);

// レポート生成
const report = await sync.generateProgressReport(projectId);
```

## トラブルシューティング

### 権限エラー

```
GraphQL errors: [{"message":"Resource not accessible by integration"}]
```

**解決方法**: GitHubトークンにProjects権限を追加してください。

### プロジェクトが見つからない

```
プロジェクトにStatusフィールドが見つかりません
```

**解決方法**: プロジェクトに"Status"という名前の単一選択フィールドを追加してください。

### 同期されない

1. `config.json`で`enabled: true`になっているか確認
2. プロジェクトIDが正しいか確認
3. StatusManagerのイベントが発火しているか確認

## パフォーマンス考慮事項

- GraphQL APIのレート制限: 5000ポイント/時
- 大規模プロジェクト（1000+ Issues）の場合はページネーションを使用
- 同期間隔は負荷に応じて調整（推奨: 5-15分）

## セキュリティ

- GitHubトークンは環境変数で管理
- 最小限の権限（repo, project）のみ付与
- トークンのローテーションを定期的に実施

## 今後の拡張

1. **Webhook対応**: プロジェクトボードの変更をリアルタイムで受信
2. **バーンダウンチャート**: 進捗の視覚化
3. **マイルストーン連携**: マイルストーンとプロジェクトの同期
4. **カスタムフィールド**: 追加のメタデータ管理
5. **通知機能**: ステータス変更時の通知