# CCRA (Code Change Review Agent)

## 概要

CCRA（Code Change Review Agent）は、GitHubのPull Requestを自動的にレビューし、コード品質、セキュリティ、ベストプラクティスに関するフィードバックを提供するエージェントです。

## 主な機能

### 1. PR自動検出
- オープンなPRを定期的に監視（デフォルト: 5分間隔）
- ドラフトPRやスキップラベル付きPRの自動除外
- 優先度に基づいたレビュー順序の制御

### 2. コード品質チェック
- **複雑度分析**: ネストの深さ、条件文の複雑さを検出
- **重複検出**: 類似コードブロックの識別
- **スタイルチェック**: 行の長さ、インデント、末尾空白の検証
- **ベストプラクティス**: var使用、空のcatchブロック、==演算子の検出

### 3. セキュリティスキャン
- **認証情報の検出**: APIキー、パスワード、トークンのハードコーディング
- **脆弱性パターン**: SQLインジェクション、XSS、evalの使用
- **安全でない設定**: HTTPSチェック、過度な権限、CORS設定

### 4. レビューコメント生成
- インラインコメント（問題箇所に直接）
- 全体的なレビューサマリー
- 優先度付きの修正提案
- ステータスチェックの更新

## 使用方法

### 環境変数の設定

```bash
# 必須
export GITHUB_TOKEN=your_github_token
export GITHUB_REPOSITORY=owner/repo

# オプション
export CCRA_CHECK_INTERVAL=300000  # PR チェック間隔（ミリ秒）
export CCRA_MIN_COVERAGE=80        # 最小カバレッジ要求
export CCRA_MAX_COMPLEXITY=10      # 最大許容複雑度
export CCRA_MAX_FILE_LENGTH=500    # 最大ファイル行数
export CCRA_MAX_DUPLICATION=5      # 最大許容重複ブロック数
```

### 起動方法

```bash
# npm script での起動
npm run ccra:start

# 直接起動
node scripts/start-ccra.js

# PoppoBuilder のエージェントモードで起動
npm run start:agents
```

### 設定オプション

```javascript
{
  "repository": "medamap/PoppoBuilderSuite",
  "checkInterval": 300000,      // 5分
  "reviewCriteria": {
    "minCoverage": 80,          // カバレッジ閾値
    "maxComplexity": 10,        // 複雑度閾値
    "maxFileLength": 500,       // ファイル行数制限
    "maxDuplication": 5         // 重複ブロック制限
  },
  "excludePatterns": [          // 除外パターン
    "**/node_modules/**",
    "**/test/**",
    "**/*.test.js"
  ]
}
```

## レビュー基準

### 優先度の決定

PRの優先度は以下の要素で決定されます：

1. **ラベル**
   - `urgent`: +30
   - `hotfix`: +20
   - `security`: +25
   - `low-priority`: -20

2. **変更規模**
   - 1000行以上: +10
   - 50行未満: -10

3. **PR年齢**
   - 7日以上: +15
   - 14日以上: +10（追加）

### レビューイベントの種類

- **APPROVE**: 問題なし
- **COMMENT**: 改善提案あり
- **REQUEST_CHANGES**: 必須修正あり

## 出力例

### レビューコメント

```markdown
## 🔍 コードレビュー結果

PR #123 のレビューを完了しました。

### 📊 変更の概要
- 変更ファイル数: 5
- 追加行数: 150
- 削除行数: 50
- 主な言語: JavaScript, TypeScript

### 🔐 セキュリティ
⚠️ **1個の重大なセキュリティ問題が検出されました**
- ハードコードされたAPIキーが検出されました

### 📝 コード品質
- エラー: 2個
- 警告: 5個
- 品質スコア: 75/100

### ❗ 必須修正項目
1. **ハードコードされたAPIキーが検出されました**
   - 環境変数に移動してください

2. **関数の複雑度が高すぎます（深さ: 7）**
   - 関数を分割してシンプルにすることを検討してください

### 💡 改善提案
- console.logが使用されています
- == の使用が検出されました
- 行が長すぎます（135文字）

### 📋 次のステップ
1. 上記の必須修正項目を対応してください
2. 修正後、再レビューを依頼してください

---
*このレビューは CCRA (Code Change Review Agent) により自動生成されました*
```

### インラインコメント

```markdown
🚨 **セキュリティ: ハードコードされたAPIキーが検出されました**

```javascript
const apiKey = "sk-1234567890abcdef";
```

**推奨事項:** 環境変数に移動してください

検出された値: `sk**********ef`
```

## 拡張方法

### カスタムチェックの追加

1. `agents/ccra/custom-checker.js` を作成
2. 必要なチェックロジックを実装
3. `agents/ccra/index.js` で統合

### セキュリティパターンの追加

`agents/ccra/security-scanner.js` の `patterns` オブジェクトに新しいパターンを追加：

```javascript
this.patterns.customPattern = [
  {
    pattern: /your-regex-here/gi,
    type: 'custom',
    severity: 'high',
    message: 'カスタムパターンが検出されました'
  }
];
```

## トラブルシューティング

### PRが検出されない

1. GitHub トークンの権限を確認
2. リポジトリ名が正しいか確認
3. PRのラベルを確認（skip-review等）

### レビューが投稿されない

1. GitHub API の権限を確認
2. レート制限を確認
3. ログでエラーを確認

### 誤検知が多い

1. 除外パターンを調整
2. 閾値を調整
3. カスタムルールを追加

## 関連情報

- [エージェントアーキテクチャ概要](../architecture/agent-architecture.md)
- [CCPM エージェント](ccpm-agent.md)
- [CCQA エージェント](ccqa-agent.md)