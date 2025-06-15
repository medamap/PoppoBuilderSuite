# Git標準機能とGitHub独自機能の比較表

## Git標準機能（ローカルで動作）

### 基本的なバージョン管理
- `git init` - リポジトリの初期化
- `git add` - ステージングエリアへの追加
- `git commit` - 変更の記録
- `git status` - 作業ツリーの状態確認
- `git log` - コミット履歴の表示
- `git diff` - 差分の表示

### ブランチ操作
- `git branch` - ブランチの作成・一覧表示
- `git checkout` - ブランチの切り替え
- `git merge` - ブランチのマージ
- `git rebase` - コミット履歴の整理

### リモート操作
- `git remote` - リモートリポジトリの管理
- `git push` - リモートへの送信
- `git pull` - リモートからの取得
- `git fetch` - リモートの情報取得
- `git clone` - リポジトリの複製

### その他
- `git tag` - タグの作成・管理
- `git stash` - 一時的な変更の退避
- `git reset` - コミットの取り消し
- `git revert` - コミットの打ち消し

## GitHub独自機能（Webサービス・API経由）

### コラボレーション機能
- **Pull Request (PR)** - コードレビューとマージ管理
- **Issues** - タスク管理・バグトラッキング
- **Projects** - かんばんボード式のプロジェクト管理
- **Discussions** - コミュニティディスカッション

### 自動化・CI/CD
- **GitHub Actions** - ワークフローの自動化
- **Webhooks** - イベント通知
- **GitHub Apps** - カスタム統合

### ドキュメント・公開
- **Wiki** - プロジェクトドキュメント
- **GitHub Pages** - 静的サイトホスティング
- **README** - リポジトリの説明（Git管理だがGitHub独自の表示機能）

### セキュリティ・品質
- **Security Alerts** - 脆弱性通知
- **Dependabot** - 依存関係の自動更新
- **Code Scanning** - コード品質チェック
- **Secret Scanning** - シークレット検出

### その他の独自機能
- **Fork** - リポジトリの分岐
- **Star** - お気に入り登録
- **Watch** - 更新通知の購読
- **Releases** - リリース管理
- **Gist** - コードスニペット共有
- **Sponsors** - 開発者支援

## PoppoBuilder Suiteでの利用方針

### Git標準機能の利用
- バージョン管理の基本操作
- ブランチ戦略の実装
- ローカルでの作業管理

### GitHub機能の利用
- Issue駆動開発（必須）
- PR経由のコードレビュー
- GitHub Actionsは将来対応
- Wikiでの進捗管理

### 抽象化の検討
- Issue管理 → 将来的にGitLab/Bitbucket対応可能な設計
- PR作成 → プラットフォーム依存部分を最小化
- CI/CD → 初期はローカル実行で代替