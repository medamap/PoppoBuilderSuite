# トレーサビリティ GitHub連携ガイド

## 概要

トレーサビリティ機能Phase 3では、GitHub Issue/PRとトレーサビリティアイテムを自動的に連携させる機能を提供します。

## 主な機能

### 1. 自動ID抽出
- Issue/PRの本文からPBS-XXX-nnn形式のIDを自動抽出
- コミットメッセージからのID抽出
- 双方向リンクの自動作成

### 2. GitHub同期
- Issue/PRとトレーサビリティアイテムの関連付け
- 同期状態のレポート生成
- GitHubへのコメント自動投稿

## 使用方法

### Issue/PRの同期

```bash
# すべてのIssueを同期
npm run trace github sync

# 特定のIssueを同期
npm run trace github sync-issue 52

# 特定のPRを同期
npm run trace github sync-pr 123
```

### 手動リンク作成

```bash
# トレーサビリティアイテムをIssueにリンク
npm run trace github link PBS-REQ-001 52
```

このコマンドは：
1. PBS-REQ-001をIssue #52にリンク
2. Issue #52にトレーサビリティ情報をコメント投稿

### コミットメッセージからのID抽出

```bash
# 最新50件のコミットからIDを抽出（デフォルト）
npm run trace github commits

# 最新100件のコミットからIDを抽出
npm run trace github commits 100
```

### 同期レポートの生成

```bash
npm run trace github report
```

レポートには以下が含まれます：
- GitHub連携済みアイテム数
- 関連Issue/PR総数
- 連携詳細（アイテムごとの関連Issue/PR一覧）

## ベストプラクティス

### 1. Issue/PR作成時のID記載

Issue本文にトレーサビリティIDを含める：

```markdown
## 概要
PBS-REQ-001 の実装を行います。

## 実装内容
- PBS-SPEC-001: 基本機能の実装
- PBS-SPEC-002: 拡張機能の実装
```

### 2. コミットメッセージでのID記載

```bash
git commit -m "feat: PBS-IMP-001 GitHub同期機能を実装"
```

### 3. 定期的な同期

```bash
# cronなどで定期実行
npm run trace github sync
```

## トレーサビリティコメントの例

Issueにリンクすると、以下のようなコメントが自動投稿されます：

```markdown
## 🔗 トレーサビリティ更新

このIssueは以下のトレーサビリティアイテムにリンクされました:

- **ID**: PBS-REQ-001
- **フェーズ**: REQ
- **タイトル**: トレーサビリティ機能の実装
- **説明**: 要求から実装までの追跡機能

### 関連アイテム
- **implements**: PBS-SPEC-001, PBS-SPEC-002
- **関連Issue**: #52

---
*このコメントはトレーサビリティシステムによって自動生成されました*
```

## トラブルシューティング

### GitHub CLIが利用できない

```bash
# GitHub CLIのインストール
brew install gh

# 認証
gh auth login
```

### 同期が失敗する

1. GitHub CLIの認証状態を確認
2. リポジトリへのアクセス権限を確認
3. Issue/PR番号が正しいか確認

## 注意事項

- GitHubメタデータは`.poppo/traceability.yaml`に保存されます
- 同期は追加のみで、削除は行いません
- コメント投稿は重複チェックを行いません（改善予定）