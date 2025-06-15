# PoppoBuilder Suite セットアップガイド

## 初回セットアップ

### 1. 前提条件の確認
- Node.js 18以上
- `gh` CLI（GitHub CLI）がインストール・認証済み
- `claude` CLIがインストール・認証済み

### 2. リポジトリのクローン
```bash
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 3. GitHubラベルのセットアップ
```bash
npm run setup
```

このコマンドで以下が実行されます：

#### 必須ラベルの作成
PoppoBuilderが動作するために必要なラベルを自動作成：
- `task:misc` - 雑用タスク（即実行）
- `task:feature` - 機能開発（全フェーズ実行）
- `task:fix` - バグ修正
- `task:docs` - ドキュメント更新
- `processing` - 処理中
- `completed` - 完了
- `needs:answer` - 回答待ち
- `phase:*` - 各フェーズ用ラベル

#### デフォルトラベルの処理（オプション）
GitHubのデフォルトラベルを削除するか選択できます：
- `duplicate`
- `good first issue` 
- `invalid`
- `wontfix`

**注意**: 既存のプロジェクトでこれらのラベルを使用している場合は、削除しないことをお勧めします。

### 4. PoppoBuilderの起動
```bash
npm start
```

## カスタマイズ

### ラベルのカスタマイズ
`scripts/setup-labels.js`を編集して、必須ラベルをカスタマイズできます：

```javascript
const REQUIRED_LABELS = [
  { name: 'task:misc', description: '雑用（即実行）', color: 'aaaaaa' },
  // 必要に応じて追加・変更
];
```

### 既存プロジェクトでの使用
既存のGitHubプロジェクトでPoppoBuilderを使用する場合：

1. 既存のラベルとの競合を避けるため、デフォルトラベルは残す
2. 必要に応じて手動でラベルを調整
3. `task:*`プレフィックスを変更したい場合は、コードも修正が必要

## トラブルシューティング

### ラベル作成でエラーが出る
- `gh`コマンドが認証されているか確認
- リポジトリへの書き込み権限があるか確認

### セットアップをやり直したい
手動でラベルを削除してから再実行：
```bash
gh label delete "ラベル名" --yes
```