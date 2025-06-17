# PoppoBuilder Suite - セッション継続用ガイド

## 🎭 システムファミリー

PoppoBuilder Suiteは以下の協調システムで構成されています：

- **PoppoBuilder（ぽっぽちゃん）** 🚂 - メインの自動タスク処理システム
- **MedamaRepair（目玉さん）** 👁️ - PoppoBuilderの監視・自動復旧システム（1分ごとに監視）
- **MeraCleaner（メラさん）** 🔥 - エラーコメント分析・整理システム（30分ごとに実行）
- **CCLAエージェント（クララちゃん）** 🤖 - エラーログ収集・自動修復エージェント（5分ごとに監視）
- **CCAGエージェント（カグラちゃん）** 📝 - ドキュメント生成・多言語対応エージェント
- **CCPMエージェント（ドレミちゃん）** 🔍 - コードレビュー・リファクタリング提案エージェント
- **MirinOrphanManager（ミリンちゃん）** 🎋 - 孤児Issue検出・管理システム（毎時3分・33分に実行）

## 🚀 現在の実装状況

### ✅ 実装済み機能
- **基本機能**: Issue自動処理、独立プロセス管理、コメント対応、Dogfooding、多言語対応
- **高度な機能**: ダッシュボード、レート制限、動的タイムアウト、エラーログ収集、トレーサビリティ、通知
- **運用機能**: マルチプロジェクト対応、認証機能、整合性監査

### 📁 重要なファイル
- `src/minimal-poppo.js` - メイン処理
- `src/independent-process-manager.js` - 独立プロセス管理
- `config/config.json` - システム設定
- `.poppo/config.json` - 言語設定（ja/en）

## 📚 詳細な実装履歴

実装の詳細履歴は以下のドキュメントを参照：

- [Phase 1: 基本実装履歴](docs/implementation-history/phase1-basic.md)
- [Phase 2: 高度な実装履歴](docs/implementation-history/phase2-advanced.md)
- [Issue実装履歴一覧](docs/implementation-history/issues/README.md)

## 🔍 セッション開始時の確認手順

### 1. 現状確認（必須）
```bash
# 現在のディレクトリ確認
pwd
# /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite

# PoppoBuilderプロセス確認
ps aux | grep PoppoBuilder

# 実行中タスク確認
cat logs/running-tasks.json

# 最新ログ確認
tail -20 logs/poppo-$(date +%Y-%m-%d).log
```

### 2. 最新のIssue状況確認
```bash
gh issue list --repo medamap/PoppoBuilderSuite --state open
```

### 3. エラーログ確認
```bash
# エラーがないかチェック
grep ERROR logs/poppo-$(date +%Y-%m-%d).log | tail -10
```

## 🛠️ よく使うコマンド

### 基本操作
```bash
# PoppoBuilder起動
npm start

# エージェントモードで起動
npm run start:agents

# ダッシュボード確認
npm run dashboard
```

### デバッグ
```bash
# 詳細ログ有効化
DEBUG=* npm start

# テスト実行
npm test
```

### Git操作
```bash
# 現在のブランチ確認
git branch

# コミット（Claude Code署名付き）
git commit -m "メッセージ

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

## ⚠️ 注意事項

1. **最大プロセス数エラー**: 容量制限時はGitHubコメント投稿をスキップ
2. **レート制限**: 自動的に待機して再試行
3. **言語設定**: `.poppo/config.json`で`ja`/`en`を切り替え
4. **認証**: ダッシュボードのデフォルトパスワードは必ず変更

## 🔗 関連ドキュメント

- [README.md](README.md) - プロジェクト概要
- [インストールガイド](docs/INSTALL.md)
- [アーキテクチャ概要](docs/architecture/system-overview.md)
- [トラブルシューティング](docs/INSTALL.md#トラブルシューティング)

---
最終更新: 2025/6/17 - CLAUDE.mdをスリム化、実装履歴を別ファイルに分離