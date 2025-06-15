# 最小限実装ガイド

## 概要
PoppoBuilder Suiteの最小限の実装。GitHub Issueを読み取り、Claudeで処理して結果を返します。

## 動作要件
- Node.js 18以上
- `gh` CLIがインストール・認証済み
- `claude` CLIがインストール・認証済み

## 使い方

### 1. 起動
```bash
npm start
# または
node src/minimal-poppo.js
```

### 2. Issue作成
GitHubで以下のようなIssueを作成：
- **作成者**: リポジトリオーナー（medamap）
- **ラベル**: `task:misc`
- **タイトル**: 実行したいタスクの概要
- **本文**: 詳細な指示

例：
```
Title: package.jsonにlintスクリプトを追加
Labels: task:misc

Body:
package.jsonのscriptsセクションに以下を追加してください：
"lint": "eslint src/**/*.js"
```

### 3. 処理の流れ
1. PoppoBuilderがIssueを検出
2. `processing`ラベルを追加
3. Claudeで処理を実行
4. 結果をIssueコメントで報告
5. `completed`ラベルを追加

## 設定
`config/config.json`で設定変更可能：
- `claude.maxConcurrent`: 最大同時実行数（デフォルト: 2）
- `claude.timeout`: タイムアウト時間（デフォルト: 300000ms = 5分）
- `polling.interval`: ポーリング間隔（デフォルト: 30000ms = 30秒）

## 制限事項
- 作者のIssueのみ処理
- `task:misc`ラベルが必要
- フェーズ管理なし（即実行）
- ブランチ管理なし
- PR作成なし

## トラブルシューティング

### レート制限エラー
Claudeのレート制限に達した場合、自動的に制限解除時刻まで待機します。

### プロセスが終了しない
Ctrl+Cで終了。実行中のClaudeプロセスも自動的に終了します。