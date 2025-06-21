# PoppoBuilder Suite クイックスタートガイド

5分でPoppoBuilderを使い始めるためのガイドです。このガイドを読めば、すぐにGitHub Issueを使った自動タスク処理を始められます。

## 🔧 前提条件

### 必須ソフトウェア
- **Node.js** 18以上（[インストール方法](https://nodejs.org/)）
- **Claude CLI** がインストール・設定済み（[セットアップガイド](https://claude.ai/docs)）
- **GitHub CLI** (`gh`) がインストール・認証済み（[インストール方法](https://cli.github.com/)）
- **Git**（[インストール方法](https://git-scm.com/)）

### 確認方法
```bash
# Node.jsのバージョン確認
node --version  # v18.0.0以上であることを確認

# Claude CLIの確認
claude --version

# GitHub CLIの確認
gh --version
gh auth status  # 認証済みであることを確認

# Gitの確認
git --version
```

## 🚀 30秒でセットアップ

### 1. インストール

```bash
# リポジトリのクローン
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# 依存関係のインストール
npm install

# 環境変数設定
cp .env.example .env
# .envファイルを編集してGitHub設定を記入

# GitHubラベルの初期設定
node scripts/setup-labels.js

# PoppoBuilder起動
npm start
```

### 2. 起動確認

正常に起動すると以下のようなログが表示されます：
```
[2025-01-20 12:00:00] [INFO] PoppoBuilder-Main Starting PoppoBuilder...
[2025-01-20 12:00:01] [INFO] PoppoBuilder-Main Loaded configuration from: config/config.json
[2025-01-20 12:00:02] [INFO] PoppoBuilder-Main Starting issue polling (interval: 30000ms)
```

## 📝 基本的な使い方

### 1. 通常タスクの実行

GitHub Issueを作成してタスクを実行：
```bash
gh issue create \
  --title "タスクのタイトル" \
  --body "実行したい内容の説明" \
  --label "task:misc" \
  --repo owner/repo
```

例：
```bash
gh issue create \
  --title "データベース接続設定を教えて" \
  --body "PostgreSQLへの接続方法を説明してください" \
  --label "task:misc" \
  --repo medamap/my-project
```

### 2. ステータス確認

```bash
# 実行中のIssueを確認
gh issue list --label "processing" --repo owner/repo

# コメント待機中のIssueを確認
gh issue list --label "awaiting-response" --repo owner/repo

# ログを確認
tail -f logs/poppo-$(date +%Y-%m-%d).log
```

### 3. コメントでの対話

PoppoBuilderが初回処理後、コメントで続けて質問できます：
```bash
# 追加の質問
gh issue comment <issue-number> \
  --body "追加の質問をここに記載" \
  --repo owner/repo

# 完了を伝える
gh issue comment <issue-number> \
  --body "ありがとうございました" \
  --repo owner/repo
```

## 🔄 Dogfooding（自己改善）タスク

PoppoBuilder自体の機能を改善するタスク：

### 1. 機能追加のIssue作成

```bash
gh issue create \
  --title "PoppoBuilder機能追加: XXX機能" \
  --body "機能の詳細説明..." \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

### 2. Dogfoodingの特別動作

`task:dogfooding`ラベル付きIssueでは：
- CLAUDE.mdを自動的に参照
- 実装後にCLAUDE.mdを更新
- 完了時に30秒後の自動再起動をスケジュール

### 3. 自動再起動の確認

```bash
# 再起動ログの確認
tail -f logs/restart-$(date +%Y-%m-%d).log

# PoppoBuilderプロセスの監視
watch -n 1 'ps aux | grep PoppoBuilder-Main | grep -v grep'
```

## 🌐 言語設定の変更

PoppoBuilderの応答言語を変更する場合：

### 1. 設定ファイルの編集

`.poppo/config.json`を作成または編集：
```json
{
  "language": "en"  // "ja" または "en"
}
```

### 2. PoppoBuilderの再起動

```bash
# 現在のプロセスを停止
ps aux | grep PoppoBuilder-Main
kill <PID>

# 再起動
npm start
```

## ⚠️ よくある問題と解決方法

### Issueが検出されない場合

1. 正しいラベルが付与されているか確認
2. PoppoBuilderが実行中か確認
3. ログを確認：`tail -f logs/poppo-$(date +%Y-%m-%d).log`

### Claude CLIがハングアップする場合

1. Claude CLIが最新版であることを確認
2. APIキーが正しく設定されているか確認
3. プロセスログを確認：`tail -f logs/processes-$(date +%Y-%m-%d).log`

### コメントへの返信がない場合

1. `awaiting-response`ラベルが付いているか確認
2. コメントがIssue作成者からのものか確認
3. コメント監視ログを確認

## 🎯 高度な使い方

### システム設定のカスタマイズ

`config/config.json`を編集して動作を調整：

```json
{
  "github": {
    "owner": "your-username",
    "repo": "your-repo"
  },
  "polling": {
    "interval": 60000  // 1分ごとにチェック
  },
  "claude": {
    "maxConcurrent": 2,
    "timeout": 43200000  // 12時間に短縮
  },
  "commentHandling": {
    "enabled": true,
    "maxCommentCount": 20,  // 最大コメント数を増やす
    "completionKeywords": [
      "ありがとう", "完了", "終了", "OK",
      "thanks", "done", "finished", "closed"
    ]
  }
}
```

### 複数プロジェクトの管理

別のプロジェクト用にPoppoBuilderを設定：

```bash
# 別ディレクトリにクローン
cd ~/Projects/AnotherProject
git clone https://github.com/medamap/PoppoBuilderSuite.git poppo-for-project
cd poppo-for-project

# 環境変数を設定
cp .env.example .env
# GITHUB_OWNERとGITHUB_REPOをターゲットプロジェクトに設定

# 起動
npm start
```

### バッチ処理

複数の関連Issueを一度に作成：

```bash
# スクリプトでバッチ作成
for task in "テスト追加" "ドキュメント更新" "リファクタリング"; do
  gh issue create \
    --title "$task" \
    --body "$taskの詳細" \
    --label "task:misc" \
    --repo owner/repo
done
```

## 💡 ベストプラクティス

1. **Issueの説明は具体的に**: 何をしてほしいか明確に記述
2. **適切なラベルを使用**: `task:misc`または`task:dogfooding`
3. **ログを定期的に確認**: 長時間実行タスクを監視
4. **コメントで対話**: 追加情報や質問をコメントで伝える
5. **完了キーワードを使用**: "ありがとう"等でタスクを終了

## 🎉 おめでとうございます！

PoppoBuilderの基本的な使い方をマスターしました。

### 次のステップ

1. **より詳しく学ぶ**
   - [インストールガイド](INSTALL.md) - 詳細な設定方法
   - [メモリ管理ガイド](features/memory-management-guide.md) - パフォーマンス最適化
   - [エラーハンドリングガイド](features/error-handling-guide.md) - トラブル対処法

2. **高度な機能を使う**
   - [ダッシュボード操作ガイド](features/dashboard-guide.md) - Webインターフェース
   - [テストフレームワーク活用ガイド](features/testing-guide.md) - 自動テスト
   - [CLI コマンドリファレンス](api/cli-reference.md) - 全コマンド一覧

3. **PoppoBuilderを改善する**
   ```bash
   gh issue create \
     --title "PoppoBuilder改善: [あなたのアイデア]" \
     --body "詳細な説明..." \
     --label "task:dogfooding" \
     --repo medamap/PoppoBuilderSuite
   ```

### サポート

問題が解決しない場合は：
- [トラブルシューティングガイド](troubleshooting.md)を確認
- [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)で質問
- [ベストプラクティス集](best-practices.md)を参照