# PoppoBuilder Suite

Claude Codeを活用した自律的ソフトウェア開発システム

## 🎯 概要

PoppoBuilder Suiteは、以下を実現する自己ホスティング型の開発自動化システムです：
- 単一セッションのタスクによってClaude Codeのコンテキストウィンドウ使用を最小化
- GitHub Actionsのような CI/CD 機能をコストなしで提供
- 複数の専門AIエージェントによる自律的なプロジェクト開発
- ドッグフーディングによる自己改善をサポート

## 🏗️ アーキテクチャ

```
ユーザーインターフェース層:
Claude Code → MCP Interface → CCGM (General Manager)
                    ↓
            Poppoリポジトリ (状態管理)
                    ↑
自動化層:
常駐CICD → エージェントオーケストラ:
  - CCPM (Project Manager) - タスク計画と指示書生成
  - CCAG (Agent) - 実装とPR作成
  - CCRA (Review Agent) - コードレビュー
  - CCTA (Test Agent) - テストと検証
  - CCMA (Merge Agent) - PRマージ
```

## 📁 プロジェクト構造

```
PoppoBuilderSuite/
├── cicd/               # 常駐CI/CDシステム
│   ├── scheduler/      # ジョブスケジューリングと管理
│   ├── executor/       # ジョブ実行エンジン
│   └── monitor/        # プロセス監視
├── mcp-interface/      # MCPサーバーインターフェース
│   └── tools/          # MCPツール実装
├── agents/             # AIエージェント実装
│   ├── ccgm/          # ゼネラルマネージャー
│   ├── ccpm/          # プロジェクトマネージャー
│   ├── ccag/          # 実装エージェント
│   ├── ccra/          # レビューエージェント
│   ├── ccta/          # テストエージェント
│   └── ccma/          # マージエージェント
├── poppo-repo/        # プロジェクト状態と設定
│   ├── config/        # システム設定
│   ├── projects/      # 管理対象プロジェクト
│   └── status/        # 実行時ステータス
└── docs/              # ドキュメント
```

## 🚀 はじめに

### 前提条件
- Node.js 18以上
- Claude Code CLI
- Git

### インストール
```bash
# リポジトリのクローン
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# 依存関係のインストール（package.json作成後）
npm install

# GitHubラベルの初期設定
npm run setup

# Poppoリポジトリの初期化
npm run init
```

### 基本的な使い方
```bash
# 新しいプロジェクトを開始
claude "ぽっぽ、新しいExpress APIプロジェクトを作って"

# ステータス確認
claude "ぽっぽ、現在の状況は？"

# 手動トリガー
claude "ぽっぽ、保留中のタスクを実行して"
```

## 🔄 開発ワークフロー

1. **機能開発**
   ```bash
   git checkout develop
   git checkout -b feature/your-feature
   # 変更を加える
   git commit -m "feat: 機能追加"
   git push origin feature/your-feature
   ```

2. **セルフホスティング開発**
   - PoppoBuilderは自身のコードベースで作業可能
   - 自己改善のためのIssueを作成
   - エージェントに機能拡張を実装させる

## 🤖 エージェントの役割

### CCGM (ゼネラルマネージャー)
- ユーザーインタラクションインターフェース
- プロジェクト設定管理
- ステータスレポートと監視

### CCPM (プロジェクトマネージャー)
- タスクの分解と計画
- 指示書の生成
- 依存関係管理

### CCAG (実装エージェント)
- コード実装
- PR作成
- ドキュメント更新

### CCRA (レビューエージェント)
- コード品質チェック
- ベストプラクティスの適用
- セキュリティレビュー

### CCTA (テストエージェント)
- テスト実行
- カバレッジレポート
- パフォーマンス検証

### CCMA (マージエージェント)
- PRマージ判断
- コンフリクト解決
- ブランチ管理

## 📈 ロードマップ

### Phase 1: 基盤構築（第1週）
- [ ] 基本的なCICDスケジューラー
- [ ] MCPインターフェースのセットアップ
- [ ] CCPMとCCAGの実装

### Phase 2: セルフホスティング（第2週）
- [ ] PoppoBuilder自身での作業
- [ ] 基本的な自動化ループ
- [ ] ステータス管理

### Phase 3: 完全自動化（第3週以降）
- [ ] 全エージェントの稼働
- [ ] 完全なCI/CDパイプライン
- [ ] 高度な機能

## 🤝 コントリビューション

このプロジェクトは自己改善型です！機能拡張のIssueを作成して、PoppoBuilderに実装させましょう。

## 📄 ライセンス

MIT License - 詳細はLICENSEファイルを参照