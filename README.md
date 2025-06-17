# PoppoBuilder Suite

GitHub IssueとClaude CLIを連携した自動タスク処理システム

## 🎭 システムファミリー

PoppoBuilder Suiteは複数の協調システムで構成されています：

- **PoppoBuilder（ぽっぽちゃん）** 🚂 - メインの自動タスク処理システム
- **MedamaRepair（目玉さん）** 👁️ - PoppoBuilderの監視・自動復旧システム
- **MeraCleaner（メラさん）** 🔥 - エラーコメント分析・整理システム
- **CCLAエージェント（クララちゃん）** 🤖 - エラーログ収集・自動修復エージェント
- **CCAGエージェント（カグラちゃん）** 📝 - ドキュメント生成・多言語対応エージェント
- **CCPMエージェント（ドレミちゃん）** 🔍 - コードレビュー・リファクタリング提案エージェント
- **MirinOrphanManager（ミリンちゃん）** 🎋 - 孤児Issue検出・管理システム

## 🎯 概要

PoppoBuilder Suiteは、GitHub IssueとClaude CLIを連携した自動タスク処理システムです：
- **GitHub Issue駆動**: Issueの内容を自動で読み取り実行
- **Claude CLI統合**: 高度なタスク処理をAIが担当
- **多言語対応**: 日本語/英語に対応（設定可能）
- **継続的対話**: コメント追記による対話的なタスク処理
- **自己改善**: Dogfooding機能で自身の機能拡張が可能

## 🚀 現在の機能

✅ **Issue自動処理** - ラベル付きIssueを30秒間隔で監視・処理  
✅ **コメント追記対応** - `awaiting-response`ラベルで継続的な対話が可能  
✅ **Dogfooding機能** - `task:dogfooding`で自己改善タスク実行  
✅ **自動再起動** - Dogfoodingタスク完了時に30秒後の自動再起動  
✅ **多言語対応** - 日本語/英語を設定ファイルで切り替え可能  
✅ **詳細ログ** - タスク別・プロセス別の実行ログを記録  
✅ **完了キーワード認識** - 設定可能な完了キーワードで自動的に`completed`ラベル付与

## 🏗️ 現在のアーキテクチャ

```
┌─────────────────────────────────────────────────────────┐
│                   GitHub Issue                          │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Labels: task:misc / task:dogfooding             │  │
│  │ Status: processing → awaiting-response → ...    │  │
│  └─────────────────────────────────────────────────┘  │
└────────────────────┬───────────────┬───────────────────┘
                     │               │
                     ▼               ▼
              ┌──────────────┐ ┌──────────────┐
              │ PoppoBuilder │ │   Comment    │
              │   (30秒毎)   │ │   Monitor    │
              └──────┬───────┘ └──────┬───────┘
                     │               │
                     ▼               │
              ┌──────────────┐       │
              │ Claude CLI   │       │
              │ (stdin入力)  │       │
              └──────┬───────┘       │
                     │               │
                     ▼               │
              ┌──────────────┐       │
              │GitHub Comment│ ◀─────┘
              │ (file経由)   │
              └──────────────┘
```

### 主要コンポーネント
- **Issue監視**: 30秒間隔でGitHub APIを使用してIssue検出
- **Claude CLI連携**: stdin経由でプロンプトを送信（ハングアップ問題解決済み）
- **コメント処理**: ファイル経由で特殊文字を含むコメント投稿
- **状態管理**: ラベルによるIssue状態の管理（`processing`→`awaiting-response`→`completed`）
- **自動再起動**: dogfoodingタスク完了時にワンショット再起動

## 📁 プロジェクト構造

```
PoppoBuilderSuite/
├── src/                # ソースコード
│   ├── minimal-poppo.js    # メイン処理
│   ├── process-manager.js  # Claude CLI実行管理
│   ├── github-client.js    # GitHub API操作
│   ├── logger.js          # ログ機能
│   └── config-loader.js   # 設定読み込み
├── scripts/            # ユーティリティスクリプト
│   ├── setup-labels.js     # GitHubラベル作成
│   └── restart-scheduler.js   # 自動再起動スケジューラ
├── config/             # 設定ファイル
│   └── config.json         # システム設定
├── .poppo/             # ローカル設定
│   └── config.json        # 言語設定等
├── logs/               # ログファイル
├── temp/               # 一時ファイル
└── docs/              # ドキュメント
```

## 🚀 クイックスタート

### 前提条件
- Node.js 18以上
- Claude CLI (インストール済み)
- GitHub CLI (`gh` コマンド、認証済み)
- Git

### インストール
詳細なインストール手順は[インストールガイド](docs/INSTALL.md)（[English](docs/INSTALL_en.md)）を参照してください。

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

### 基本的な使い方

1. **通常タスクの実行**
```bash
gh issue create \
  --title "タスクのタイトル" \
  --body "実行したい内容の説明" \
  --label "task:misc" \
  --repo owner/repo
```

2. **Dogfoodingタスク（自己改善）**
```bash
gh issue create \
  --title "PoppoBuilder機能追加" \
  --body "新機能の説明" \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

3. **言語設定の変更**
`.poppo/config.json`を編集：
```json
{
  "language": "en"  // "ja" または "en"
}
```

## 📋 動作の仕組み

### Issue処理フロー
1. **Issue検出**: 30秒ごとに対象ラベル付きIssueをチェック
2. **処理開始**: `processing`ラベルを付与してClaude CLIを実行
3. **結果投稿**: 実行結果をGitHubコメントとして投稿
4. **状態更新**: `awaiting-response`ラベルに変更（継続対話可能）
5. **コメント監視**: Issue作成者からの新規コメントを検出して追加処理
6. **完了判定**: 完了キーワード検出時に`completed`ラベル付与

### Dogfooding機能
`task:dogfooding`ラベル付きIssueでは：
- CLAUDE.mdを自動的に参照して現在の実装状況を把握
- 実装後にCLAUDE.mdを更新して次回セッション用に記録
- 完了時に30秒後の自動再起動をスケジュール（新機能を反映）

## 🔧 設定

### システム設定 (`config/config.json`)
```json
{
  "github": {
    "owner": "GitHubユーザー名",
    "repo": "リポジトリ名",
    "checkInterval": 30000
  },
  "claude": {
    "command": "claude",
    "timeout": 86400000  // 24時間
  },
  "commentHandling": {
    "enabled": true,
    "completionKeywords": ["ありがとう", "完了", "thanks", "done"]
  }
}
```

### 言語設定 (`.poppo/config.json`)
```json
{
  "language": "ja"  // "ja" または "en"
}
```

## 📈 ロードマップ

### ✅ Phase 1: 基本機能（完了）
- ✅ Issue自動処理機能
- ✅ Claude CLI統合
- ✅ GitHubコメント投稿
- ✅ 詳細ログ機能

### ✅ Phase 2: 拡張機能（完了）
- ✅ コメント追記対応
- ✅ Dogfooding機能
- ✅ 自動再起動機能
- ✅ 多言語対応

### 🚧 Phase 3: 高度な機能（計画中）
- [ ] マルチプロジェクト対応
- [ ] プロセス管理ダッシュボード
- [ ] トレーサビリティ機能
- [ ] エージェント分離（CCPM, CCAG等）

## 📚 ドキュメント

- [インストールガイド](docs/INSTALL.md) ([English](docs/INSTALL_en.md))
- [クイックスタートガイド](docs/guides/quick-start.md)
- [セットアップガイド](docs/setup-guide.md)
- [最小実装ガイド](docs/minimal-implementation-guide.md)
- [要求定義](docs/requirements/)
- [設計書](docs/design/)
- [アーキテクチャ](docs/architecture/)

## 🔍 トラブルシューティング

### よくある問題と解決方法

#### Claude CLIハングアップ
- **問題**: Claude CLIがプロンプト待ちでハングアップ
- **解決**: stdin方式でプロンプトを送信（実装済み）

#### 特殊文字エラー
- **問題**: GitHubコメント投稿時の特殊文字エラー
- **解決**: `--body-file`オプションでファイル経由投稿（実装済み）

#### 言語が期待と異なる
- **問題**: 英語で回答される
- **解決**: `.poppo/config.json`の`language`設定を確認

#### restart-flag.jsonエラー
- **問題**: 再起動時に`restart-flag.json`が見つからない
- **解決**: ワンショット再起動方式を使用（実装済み）

#### awaiting-responseラベルが付かない
- **問題**: Issue処理後にコメント対応できない
- **解決**: GitHubでラベルを事前に作成する必要あり（`scripts/setup-labels.js`を実行）

詳細は[インストールガイド](docs/INSTALL.md#トラブルシューティング)を参照してください。

## 🤝 コントリビューション

このプロジェクトは自己改善型です！機能拡張のIssueを作成して、PoppoBuilderに実装させましょう。

```bash
# Dogfoodingタスクの作成例
gh issue create \
  --title "新機能: XXX機能の追加" \
  --body "機能の詳細説明..." \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

## 📄 ライセンス

MIT License - 詳細はLICENSEファイルを参照