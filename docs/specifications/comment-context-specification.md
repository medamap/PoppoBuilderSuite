# コメントコンテキスト拡張仕様書

## 1. 概要
PoppoBuilderのコメント処理機能において、コンテキスト構築を改善し、より豊富な情報を提供する。

## 2. 機能仕様

### 2.1 コンテキスト構造
```javascript
{
  issue: {
    number: number,
    title: string,
    description: string,
    labels: string[],
    created_at: string,
    updated_at: string
  },
  conversation: [
    {
      role: 'user' | 'assistant',
      content: string,
      metadata: {
        author: string,
        created_at: string,
        id: number,
        is_completion: boolean  // 完了コメントかどうか
      }
    }
  ],
  context_summary: {
    total_comments: number,
    truncated: boolean,
    oldest_included: string  // 含まれる最古のコメント日時
  }
}
```

### 2.2 コンテキストサイズ管理
- `config.commentHandling.maxCommentCount`で最大コメント数を制限
- 制限を超える場合は古いコメントから除外
- 除外された場合は`context_summary.truncated`をtrueに設定

### 2.3 メタデータの追加
各コメントに以下のメタデータを付与：
- `author`: コメント作成者のGitHubユーザー名
- `created_at`: コメント作成日時（ISO 8601形式）
- `id`: コメントID
- `is_completion`: 完了キーワードを含むかどうか

## 3. 実装詳細

### 3.1 buildContext関数の拡張
```javascript
async function buildContext(issueNumber) {
  const issue = await github.getIssue(issueNumber);
  const allComments = await github.listComments(issueNumber);
  
  // コメント数制限の適用
  const maxComments = config.commentHandling.maxCommentCount || 10;
  const comments = allComments.slice(-maxComments);
  const truncated = allComments.length > maxComments;
  
  // 会話履歴を構築（メタデータ付き）
  const conversation = [];
  
  // Issue本文
  conversation.push({
    role: 'user',
    content: `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`,
    metadata: {
      author: issue.user.login,
      created_at: issue.created_at,
      id: issue.id,
      is_completion: false
    }
  });
  
  // コメント履歴
  for (const comment of comments) {
    const role = comment.author.login === config.github.owner ? 'user' : 'assistant';
    const content = comment.body.replace(/^## 実行完了\n\n/, '');
    
    conversation.push({
      role: role,
      content: content,
      metadata: {
        author: comment.author.login,
        created_at: comment.created_at,
        id: comment.id,
        is_completion: isCompletionComment(comment)
      }
    });
  }
  
  return {
    issue: {
      number: issue.number,
      title: issue.title,
      description: issue.body,
      labels: issue.labels.map(l => l.name),
      created_at: issue.created_at,
      updated_at: issue.updated_at
    },
    conversation: conversation,
    context_summary: {
      total_comments: allComments.length,
      truncated: truncated,
      oldest_included: comments.length > 0 ? comments[0].created_at : null
    }
  };
}
```

## 4. 設定
`config/config.json`の既存設定を使用：
```json
{
  "commentHandling": {
    "maxCommentCount": 10  // 含めるコメントの最大数
  }
}
```

## 5. 後方互換性
- 既存のコード互換性を保つため、`conversation`配列の基本構造は維持
- メタデータは追加フィールドとして実装