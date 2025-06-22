# プロジェクトテンプレート機能

PoppoBuilderのプロジェクトテンプレート機能について説明します。

## 概要

プロジェクトテンプレート機能は、新しいPoppoBuilderプロジェクトを素早く初期化するためのテンプレートシステムです。

## 利用可能なテンプレート

### システムテンプレート

1. **default** - PoppoBuilder標準テンプレート
   - 基本的な設定ファイル
   - GitHubとClaude APIの設定
   - ダッシュボード機能
   - 多言語対応

2. **minimal** - 最小構成テンプレート
   - 必要最小限の設定
   - GitHubとClaudeの基本設定のみ
   - 軽量な構成

3. **advanced** - 高度な機能テンプレート
   - 全エージェント機能
   - Redis統合
   - Docker Compose設定
   - バックアップ機能
   - ヘルスチェック
   - 通知機能

### カスタムテンプレート

ユーザーが独自に作成・管理できるテンプレート。既存のプロジェクトから作成することも可能です。

## 使用方法

### テンプレート一覧表示

```bash
poppobuilder template list
```

### テンプレートからプロジェクト初期化

```bash
# デフォルトテンプレートから初期化
poppobuilder init --template default

# 高度なテンプレートから初期化
poppobuilder init --template advanced

# ディレクトリ指定で初期化
poppobuilder init --template minimal --dir /path/to/project
```

### カスタムテンプレート作成

```bash
# 空のカスタムテンプレート作成
poppobuilder template create my-template

# 既存プロジェクトからテンプレート作成
poppobuilder template create my-template --from /path/to/existing/project

# 対話モードでテンプレート作成
poppobuilder template create my-template --interactive
```

### テンプレート情報表示

```bash
poppobuilder template info default
```

### テンプレート削除

```bash
# 確認付きで削除
poppobuilder template delete my-template

# 強制削除
poppobuilder template delete my-template --force
```

## テンプレート変数

テンプレートファイル内で以下の変数を使用できます：

- `{{PROJECT_NAME}}` - プロジェクト名
- `{{GITHUB_OWNER}}` - GitHubオーナー
- `{{GITHUB_REPO}}` - GitHubリポジトリ名
- `{{GITHUB_TOKEN}}` - GitHubトークン
- `{{CLAUDE_API_KEY}}` - Claude APIキー
- `{{DASHBOARD_PASSWORD}}` - ダッシュボードパスワード
- `{{DISCORD_WEBHOOK_URL}}` - Discord Webhook URL

## テンプレート構造

### テンプレートディレクトリ構造

```
template-name/
├── template.json          # テンプレートメタデータ
├── config/
│   └── config.json       # PoppoBuilder設定
├── .poppo/
│   └── config.json       # Poppo固有設定
├── README.md             # プロジェクトREADME
├── .gitignore           # Git除外設定
└── package.json         # Node.js依存関係（自動生成）
```

### template.json形式

```json
{
  "name": "template-name",
  "description": "テンプレートの説明",
  "version": "1.0.0",
  "author": "作成者名",
  "tags": ["tag1", "tag2"],
  "createdAt": "2025-06-21T12:00:00.000Z"
}
```

## テンプレート保存場所

- **システムテンプレート**: `lib/templates/definitions/`
- **ユーザーテンプレート**: `~/.poppobuilder/templates/`

## 実装詳細

### 主要コンポーネント

1. **TemplateManager** (`lib/templates/template-manager.js`)
   - テンプレートの管理、作成、適用
   - システム・ユーザーテンプレートの統合管理
   - 変数置換機能

2. **TemplateCommand** (`lib/commands/template.js`)
   - CLIコマンドの実装
   - 対話的なテンプレート操作
   - 国際化対応

3. **InitCommand更新** (`lib/commands/init.js`)
   - `--template`オプションの追加
   - テンプレートからの初期化機能

### 技術的特徴

- **依存関係最小化**: Node.js標準ライブラリのみ使用
- **国際化対応**: 日本語・英語対応
- **変数置換**: テンプレートファイル内の動的変数展開
- **バリデーション**: テンプレート構造とメタデータの検証
- **エラーハンドリング**: 包括的なエラー処理とログ記録

## 例

### 基本的な使用例

```bash
# プロジェクトの初期化
mkdir my-new-project
cd my-new-project

# デフォルトテンプレートから初期化
poppobuilder init --template default

# 設定編集
editor config/config.json

# 依存関係インストール
npm install

# PoppoBuilder起動
npm start
```

### 高度な使用例

```bash
# 高度なテンプレートで新規プロジェクト作成
poppobuilder init --template advanced --dir enterprise-project

cd enterprise-project

# Redis起動（高度なテンプレートに含まれる）
docker-compose up -d

# 依存関係インストール
npm install

# エージェント付きで起動
npm run start:agents
```

## トラブルシューティング

### よくある問題

1. **テンプレートが見つからない**
   ```bash
   poppobuilder template list
   ```
   で利用可能なテンプレートを確認

2. **変数が置換されない**
   - 変数名が正しいか確認
   - `{{}}` の形式で記述されているか確認

3. **カスタムテンプレート作成に失敗**
   - 書き込み権限があるか確認
   - ディスク容量があるか確認

### デバッグ

詳細なログ出力:
```bash
DEBUG=TemplateManager poppobuilder template create my-template
```

## 今後の拡張予定

- クラウドテンプレートリポジトリ対応
- テンプレートのバージョン管理
- Git連携強化
- より多くの変数サポート
- テンプレート共有機能