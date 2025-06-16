# PoppoBuilder Suite インストールガイド

PoppoBuilderは、GitHub IssueとClaude CLIを連携させて、自動的にタスクを処理するシステムです。コメント追記による継続的な対話機能や、自己改善機能（Dogfooding）を備えています。このガイドでは、PoppoBuilderのインストールと初期設定について説明します。

## 前提条件

### 必須要件
- **Node.js** (v18以上)
- **npm** または **yarn**
- **Claude CLI** (インストール済み)
- **GitHub CLI (`gh`)** (インストール済み)
- **Git**

### Claude CLI設定
Claude CLIがインストールされ、APIキーが設定されていることを確認してください：
```bash
claude --version
```

### GitHub CLI設定
GitHub CLIが認証済みであることを確認してください：
```bash
gh auth status
```

## インストール手順

### 1. リポジトリのクローン
```bash
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 2. 依存関係のインストール
```bash
npm install
```

### 3. 環境変数の設定
`.env`ファイルを作成し、必要な環境変数を設定します：
```bash
cp .env.example .env
```

`.env`ファイルを編集：
```
# GitHub設定
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name

# ログ設定（オプション）
LOG_LEVEL=info
```

### 4. GitHub リポジトリ設定

#### 必要なラベルの作成
PoppoBuilderが正常に動作するために、以下のラベルをGitHubリポジトリに作成する必要があります：

```bash
# 自動ラベル作成スクリプトを実行
node scripts/setup-labels.js
```

または手動で以下のラベルを作成：
- `task:misc` - 通常のタスク用
- `task:dogfooding` - PoppoBuilder自己改善用
- `processing` - 処理中を示す
- `awaiting-response` - コメント待機中を示す
- `completed` - 完了済みを示す

### 5. 言語設定（オプション）
PoppoBuilderの応答言語を設定できます。デフォルトは日本語です。

`.poppo/config.json`を作成：
```json
{
  "language": "ja"
}
```

利用可能な言語：
- `ja` - 日本語（デフォルト）
- `en` - 英語

### 6. システム設定（必須）
`config/config.json`を確認し、必要に応じて調整します：
```json
{
  "github": {
    "owner": "your-github-username",
    "repo": "your-repo-name"
  },
  "commentHandling": {
    "enabled": true,
    "completionKeywords": [
      "ありがとう", "ありがとうございます", "ありがとうございました",
      "完了", "OK", "ok", "了解", "承知",
      "thank you", "thanks", "done", "complete"
    ]
  }
}
```

## 動作確認

### 1. PoppoBuilderの起動
```bash
npm start
```

正常に起動すると、以下のようなログが表示されます：
```
[2025-06-16 10:00:00] [INFO] PoppoBuilder started
[2025-06-16 10:00:00] [INFO] Monitoring GitHub issues...
```

### 2. テストIssueの作成
別のターミナルで以下を実行：
```bash
gh issue create \
  --title "インストール確認テスト" \
  --body "現在時刻を教えてください" \
  --label "task:misc" \
  --repo $GITHUB_OWNER/$GITHUB_REPO
```

### 3. 動作確認
- 約30秒後にPoppoBuilderがIssueを検出し、処理を開始します
- GitHubのIssueページで、PoppoBuilderからのコメントが投稿されることを確認します
- `processing`ラベルが付与され、処理完了後に`awaiting-response`ラベルに変わります

### 4. コメント追記機能のテスト
初回処理完了後、Issueにコメントを追加すると：
```bash
gh issue comment <issue-number> \
  --body "追加の質問です" \
  --repo $GITHUB_OWNER/$GITHUB_REPO
```
- PoppoBuilderが自動的にコメントを検出し、追加処理を行います
- 完了キーワード（「ありがとう」など）を含むコメントを投稿すると`completed`ラベルが付与されます

## プロセス管理

### PoppoBuilderの停止
```bash
# プロセスIDを確認
ps aux | grep PoppoBuilder-Main

# プロセスを停止
kill <PID>
```

### ログの確認
```bash
# リアルタイムログ表示
tail -f logs/poppo-$(date +%Y-%m-%d).log

# プロセスログ
tail -f logs/processes-$(date +%Y-%m-%d).log
```

## トラブルシューティング

### Claude CLIがハングアップする場合
- **症状**: Claude CLIがプロンプト待ちでハングアップ
- **解決策**: 現在のバージョンではstdin経由でプロンプトを送信するため、この問題は解決済みです
- **確認事項**: Claude CLIが最新版であることを確認

### GitHubへのコメント投稿が失敗する場合
- **症状**: 特殊文字を含むコメントでエラーが発生
- **解決策**: 現在のバージョンでは`--body-file`オプションを使用してファイル経由で投稿するため、この問題は解決済みです
- **確認事項**: 
  - GitHub CLIの認証状態を確認：`gh auth status`
  - リポジトリへの書き込み権限があることを確認

### Issueが検出されない場合
- 正しいラベルが付与されているか確認（`task:misc`または`task:dogfooding`）
- `.env`ファイルのGitHub設定が正しいか確認
- `config/config.json`のGitHub設定も確認

### awaiting-responseラベルが付かない場合
- **症状**: Issue処理後にコメント追記機能が動作しない
- **原因**: GitHubリポジトリに`awaiting-response`ラベルが存在しない
- **解決策**: `node scripts/setup-labels.js`を実行して必要なラベルを作成

### restart-flag.jsonエラー
- **症状**: 再起動時に`restart-flag.json`が見つからないエラー
- **解決策**: 現在のバージョンではワンショット再起動方式を使用するため、この問題は解決済みです

### 日本語/英語の応答が期待と異なる場合
- `.poppo/config.json`の言語設定を確認
- PoppoBuilderを再起動して設定を反映
- デフォルトは日本語（`"language": "ja"`）です

### Dogfoodingタスク完了後に再起動されない場合
- **症状**: `task:dogfooding`ラベル付きIssue完了後に自動再起動されない
- **確認事項**: 
  - `restart-scheduler.js`が正しく配置されているか確認
  - ログファイル`logs/restart-*.log`を確認してエラーがないか確認

## 次のステップ

インストールが完了したら、以下のガイドを参照してください：
- [クイックスタートガイド](guides/quick-start.md) - 基本的な使い方
- [設定ガイド](setup-guide.md) - 詳細な設定オプション
- [要求定義](requirements/) - 機能の詳細仕様

## サポート

問題が発生した場合は、以下の方法でサポートを受けることができます：
- [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)でIssueを作成
- ログファイルを確認して詳細なエラー情報を取得