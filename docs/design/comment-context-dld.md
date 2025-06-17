# コメントコンテキスト拡張詳細設計書

## 1. 概要
本書では、コメントコンテキスト拡張機能の詳細な実装設計を記述する。

## 2. 実装ファイル構成

### 2.1 修正対象ファイル
- `src/minimal-poppo.js` - buildContext関数の拡張
- `src/github-client.js` - 必要に応じてAPI応答の詳細情報を返すよう調整

### 2.2 新規ファイル
なし（既存ファイルの拡張のみ）

## 3. 詳細実装

### 3.1 buildContext関数の実装

```javascript
// src/minimal-poppo.js

/**
 * 拡張されたコンテキストを構築
 * @param {number} issueNumber - Issue番号
 * @returns {Object} 拡張されたコンテキストオブジェクト
 */
async function buildContext(issueNumber) {
  try {
    // Issue詳細を取得
    const issue = await github.getIssue(issueNumber);
    
    // すべてのコメントを取得
    const allComments = await github.listComments(issueNumber);
    
    // コメント数制限の適用
    const maxComments = config.commentHandling?.maxCommentCount || 10;
    const comments = allComments.length > maxComments 
      ? allComments.slice(-maxComments) 
      : allComments;
    const truncated = allComments.length > maxComments;
    
    // 会話履歴を構築
    const conversation = [];
    
    // Issue本文を最初のエントリとして追加
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
    
    // コメント履歴を追加
    for (const comment of comments) {
      // 役割の判定（Issue作成者のコメントはuser、それ以外はassistant）
      const isUserComment = comment.user.login === issue.user.login;
      const role = isUserComment ? 'user' : 'assistant';
      
      // PoppoBuilderの応答から実行完了ヘッダーを除去
      let content = comment.body;
      if (!isUserComment && content.includes('## 実行完了')) {
        content = content.replace(/^## 実行完了\n\n/, '');
      }
      
      conversation.push({
        role: role,
        content: content,
        metadata: {
          author: comment.user.login,
          created_at: comment.created_at,
          id: comment.id,
          is_completion: isUserComment ? isCompletionComment(comment) : false
        }
      });
    }
    
    // 拡張されたコンテキストを返す
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
    
  } catch (error) {
    logger.log('ERROR', `コンテキスト構築エラー: ${error.message}`);
    
    // エラー時は最小限のコンテキストを返す
    const issue = await github.getIssue(issueNumber);
    return {
      issue: {
        number: issue.number,
        title: issue.title,
        description: issue.body,
        labels: [],
        created_at: null,
        updated_at: null
      },
      conversation: [{
        role: 'user',
        content: `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`
      }],
      context_summary: {
        total_comments: 0,
        truncated: false,
        oldest_included: null
      }
    };
  }
}
```

### 3.2 processComment関数の修正

```javascript
// src/minimal-poppo.js

async function processComment(issueNumber, comment) {
  try {
    // ... 既存のコード ...
    
    // 拡張されたコンテキストを構築
    const enhancedContext = await buildContext(issueNumber);
    
    // システムプロンプトの生成
    const labels = enhancedContext.issue.labels;
    const poppoConfig = configLoader.loadConfig();
    
    const instruction = {
      task: 'execute_with_context',
      issue: {
        number: issueNumber,
        title: enhancedContext.issue.title,
        conversation: enhancedContext.conversation,
        context_summary: enhancedContext.context_summary  // サマリー情報を追加
      },
      context: {
        repository: `${config.github.owner}/${config.github.repo}`,
        workingDirectory: process.cwd(),
        defaultBranch: 'work/poppo-builder',
        systemPrompt: configLoader.generateSystemPrompt(poppoConfig, issueNumber, labels),
        isFollowUp: true,
        enhancedMetadata: true  // 拡張メタデータが含まれることを示すフラグ
      }
    };
    
    // ... 既存のコード ...
  } catch (error) {
    // ... エラーハンドリング ...
  }
}
```

## 4. テスト計画

### 4.1 単体テスト項目
1. buildContext関数が正しく拡張されたコンテキストを返すこと
2. コメント数制限が正しく機能すること
3. メタデータが正しく付与されること
4. エラー時にフォールバックが機能すること

### 4.2 統合テスト項目
1. 実際のIssueでコメント処理が正しく動作すること
2. 拡張されたコンテキストがClaude CLIに正しく渡されること

## 5. 移行計画
1. 後方互換性があるため、特別な移行作業は不要
2. デプロイ後、新しいコメントから拡張されたコンテキストが使用される

## 6. ログ出力
拡張されたコンテキスト使用時は以下のログを出力：
```
[INFO] 拡張コンテキスト構築: Issue #123, 会話数: 5, 切り捨て: false
```