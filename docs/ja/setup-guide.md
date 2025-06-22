# PoppoBuilder Suite セットアップガイド

このガイドでは、PoppoBuilderの詳細なセットアップ方法と設定オプションについて説明します。基本的なインストール手順については[インストールガイド](INSTALL.md)を参照してください。

## 初回セットアップ

### 1. 前提条件の確認
- Node.js 18以上
- `gh` CLI（GitHub CLI）がインストール・認証済み
- `claude` CLIがインストール・認証済み
- Git

### 2. リポジトリのクローン
```bash
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 3. 依存関係のインストール
```bash
npm install
```

### 4. 環境変数の設定
```bash
cp .env.example .env
```

`.env`ファイルを編集してGitHub設定を記入：
```
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name
```

### 5. GitHubラベルのセットアップ
```bash
node scripts/setup-labels.js
```

このコマンドで以下が実行されます：

#### 必須ラベルの作成
PoppoBuilderが動作するために必要なラベルを自動作成：
- `task:misc` - 通常のタスク
- `task:dogfooding` - PoppoBuilder自己改善タスク
- `processing` - 処理中を示す
- `awaiting-response` - コメント待機中を示す
- `completed` - 完了済みを示す

### 6. 言語設定（オプション）
PoppoBuilderの応答言語を設定できます。デフォルトは日本語です。

`.poppo/config.json`を作成：
```json
{
  "language": "ja"  // "ja" または "en"
}
```

### 7. PoppoBuilderの起動
```bash
npm start
```

正常に起動すると、以下のようなログが表示されます：
```
[2025-06-16 10:00:00] [INFO] PoppoBuilder started
[2025-06-16 10:00:00] [INFO] Monitoring GitHub issues...
```

## カスタマイズ

### システム設定のカスタマイズ
`config/config.json`を編集して、動作をカスタマイズできます：

```json
{
  "github": {
    "owner": "GitHubユーザー名",
    "repo": "リポジトリ名"
  },
  "claude": {
    "maxConcurrent": 2,        // 同時実行最大数
    "timeout": 86400000        // タイムアウト（24時間）
  },
  "polling": {
    "interval": 30000          // Issue確認間隔（ミリ秒）
  },
  "commentHandling": {
    "enabled": true,           // コメント追記機能の有効/無効
    "completionKeywords": [    // 完了キーワード
      "ありがとう", "ありがとうございます", "ありがとうございました",
      "完了", "OK", "ok", "了解", "承知",
      "thank you", "thanks", "done", "complete"
    ],
    "maxCommentCount": 10,     // 最大コメント追記回数
    "timeoutHours": 24         // コメント待機タイムアウト（時間）
  }
}
```

### 既存プロジェクトでの使用
既存のGitHubプロジェクトでPoppoBuilderを使用する場合：

1. 環境変数でターゲットリポジトリを指定
2. 必要なラベルが存在することを確認
3. PoppoBuilderを起動してIssue処理を開始

## 高度な設定

### Dogfooding機能の活用
PoppoBuilderは自己改善機能（Dogfooding）を持っています。`task:dogfooding`ラベル付きIssueでは：

1. **CLAUDE.mdを自動参照**: 現在の実装状況を把握
2. **実装後に自動更新**: CLAUDE.mdに変更内容を記録
3. **自動再起動**: 完了後30秒で新機能を反映

### コメント追記機能の設定
`commentHandling`セクションで動作を細かく制御できます：

- **enabled**: コメント追記機能の有効/無効
- **completionKeywords**: 完了と判定するキーワード
- **maxCommentCount**: 1つのIssueでの最大コメント応答回数
- **timeoutHours**: コメント待機のタイムアウト時間

## トラブルシューティング

### ラベル作成でエラーが出る
- `gh`コマンドが認証されているか確認：`gh auth status`
- リポジトリへの書き込み権限があるか確認

### Claude CLIがハングアップする
- **解決済み**: 現在のバージョンではstdin経由でプロンプトを送信
- Claude CLIが最新版であることを確認

### Issueが検出されない
- 正しいラベルが付与されているか確認
- `.env`ファイルのGitHub設定が正しいか確認
- `config/config.json`の設定も確認

### awaiting-responseラベルが付かない
- GitHubリポジトリにラベルが存在しない可能性
- `node scripts/setup-labels.js`を再実行

### 日本語/英語の応答が期待と異なる
- `.poppo/config.json`の言語設定を確認
- PoppoBuilderを再起動して設定を反映

詳細なトラブルシューティングは[インストールガイド](INSTALL.md#トラブルシューティング)を参照してください。