# GitHub Projects設定ガイド

## クイックスタート

### 1. GitHub Projectの作成

1. GitHubで新しいプロジェクトを作成
   - https://github.com/users/YOUR_USERNAME/projects
   - "New project" → "Board" を選択

2. ステータスフィールドの確認
   - プロジェクトに "Status" フィールドがあることを確認
   - 必要なステータス値を追加（Todo, In Progress, Done など）

### 2. プロジェクトIDの取得

プロジェクトのURLから番号を確認し、以下のコマンドでIDを取得：

```bash
# 環境変数設定
export GITHUB_TOKEN=your_github_token

# テストスクリプトを実行
node test/test-github-projects.js
```

出力例：
```
見つかったプロジェクト: 2件
  - PoppoBuilder Tasks (ID: PVT_kwDOBq5-Ys4Aj5Xv, Number: #1)
  - Development Board (ID: PVT_kwDOBq5-Ys4Aj5Xw, Number: #2)
```

### 3. PoppoBuilderの設定

`config/config.json` を編集：

```json
{
  "githubProjects": {
    "enabled": true,
    "syncInterval": 300000,
    "projects": [
      {
        "id": "PVT_kwDOBq5-Ys4Aj5Xv",  // 上で取得したID
        "name": "PoppoBuilder Tasks",
        "autoAdd": true,
        "autoArchive": false
      }
    ]
  }
}
```

### 4. 起動

```bash
npm start
```

ログに以下が表示されれば成功：
```
GitHub Projects同期を開始しました
```

## 詳細設定

### ステータスマッピングのカスタマイズ

プロジェクトで使用しているステータス名に合わせて調整：

```json
{
  "statusMapping": {
    "pending": "バックログ",
    "processing": "作業中",
    "awaiting-response": "レビュー中",
    "completed": "完了",
    "error": "ブロック"
  }
}
```

### フィルター設定

特定のラベルを持つIssueのみを同期：

```json
{
  "filters": {
    "labels": ["task:dogfooding", "task:feature"],
    "excludeLabels": ["wontfix"]
  }
}
```

### 複数プロジェクト

```json
{
  "projects": [
    {
      "id": "PROJECT_ID_1",
      "name": "開発タスク",
      "statusMapping": { /* ... */ }
    },
    {
      "id": "PROJECT_ID_2", 
      "name": "バグ管理",
      "statusMapping": { /* ... */ }
    }
  ]
}
```

## 必要な権限

GitHubトークンに以下の権限が必要：

- `repo` - リポジトリへのアクセス
- `project` - プロジェクトの読み書き

## 確認方法

1. PoppoBuilderでIssueを処理
2. GitHubプロジェクトボードを確認
3. Issueが自動的に適切なカラムに移動していることを確認

## よくある質問

**Q: プロジェクトにIssueが表示されない**
A: `autoAdd: true` が設定されているか確認してください。

**Q: ステータスが同期されない**
A: ステータスマッピングが正しく設定されているか確認してください。

**Q: エラーが発生する**
A: GitHubトークンの権限とプロジェクトIDを確認してください。