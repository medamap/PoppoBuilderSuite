# Issue #11-12: コメント追記対応機能

## 概要
PoppoBuilderの継続的対話機能の設計と実装。初回処理後もIssue作成者からのコメントに継続的に対応する機能。

## 実装日
2025年6月16日

## Issue #11: 設計フェーズ

### 要求定義
1. 初回処理後もIssue作成者のコメントに対応
2. 会話の文脈を保持した継続的な対話
3. 明示的な完了指示で処理終了
4. 作成者以外のコメントは無視

### 設計内容
- `awaiting-response`ラベルでコメント待機状態を表現
- 完了キーワード（"ありがとう"、"解決しました"等）で終了判定
- 会話履歴を含めたコンテキスト構築

## Issue #12: 実装フェーズ

### 実装内容

#### 1. 設定ファイルの拡張
`config/config.json`に追加：
```json
{
  "commentHandling": {
    "enabled": true,
    "checkInterval": 60000,
    "completionKeywords": [
      "ありがとう",
      "解決しました",
      "完了",
      "終了",
      "done",
      "resolved",
      "thanks"
    ]
  }
}
```

#### 2. GitHubクライアントの拡張
```javascript
// Issue詳細取得
async getIssue(issueNumber) {
  const { data } = await this.octokit.rest.issues.get({
    owner: this.owner,
    repo: this.repo,
    issue_number: issueNumber
  });
  return data;
}

// コメント一覧取得
async listComments(issueNumber) {
  const { data } = await this.octokit.rest.issues.listComments({
    owner: this.owner,
    repo: this.repo,
    issue_number: issueNumber,
    sort: 'created',
    direction: 'asc'
  });
  return data;
}
```

#### 3. メイン処理の拡張
```javascript
// コメント監視機能
async checkComments() {
  const awaitingIssues = await this.github.listIssuesWithLabel('awaiting-response');
  
  for (const issue of awaitingIssues) {
    const comments = await this.github.listComments(issue.number);
    const lastProcessedId = this.getLastProcessedCommentId(issue.number);
    
    const newComments = comments.filter(c => 
      c.user.login === issue.user.login && 
      c.id > lastProcessedId
    );
    
    if (newComments.length > 0) {
      await this.processComment(issue, newComments[newComments.length - 1]);
    }
  }
}
```

### 動作フロー
1. 初回処理完了後、`awaiting-response`ラベルを付与
2. 定期的にコメントをチェック（1分間隔）
3. Issue作成者の新規コメントを検出
4. 会話履歴を含めてClaude CLIに送信
5. 応答をコメントとして投稿
6. 完了キーワード検出で`completed`ラベル付与

## テスト結果

### テストシナリオ
1. **初回処理** → 正常完了、`awaiting-response`付与
2. **追加質問** → コメントを検出して回答
3. **完了指示** → "ありがとう"で`completed`付与

### 実行ログ
```
[INFO] Issue #12: 初回処理完了、awaiting-responseラベル付与
[INFO] 新規コメント検出: "追加で質問があります..."
[INFO] コンテキスト構築: 3件の会話履歴を含む
[INFO] Claude応答完了、コメント投稿
[INFO] 完了キーワード検出: "ありがとう"
[INFO] completedラベル付与、処理終了
```

## 技術的なポイント

1. **コンテキスト管理**
   - 全会話履歴を時系列で構築
   - 作成者とPoppoBuilderの対話として整形

2. **状態管理**
   - ラベルで処理状態を表現
   - 最終処理コメントIDを記録

3. **効率的な監視**
   - 既存の5分間隔ループに組み込み
   - 新規コメントのみを処理

## 成果
- PoppoBuilderが継続的な対話に対応可能に
- ユーザーの追加質問や要望に柔軟に対応
- 明確な終了条件で無限ループを防止

## 関連ドキュメント
- [要求定義](../../requirements/comment-handling-requirements.md)
- [設計書](../../design/comment-handling-design.md)