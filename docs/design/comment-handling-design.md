# コメント追記対応機能 設計書

## 1. 要件定義

### 1.1 機能要件

#### 1.1.1 コメント監視と処理
- **要件ID**: REQ-CH-001
- **内容**: `awaiting-response`ラベルが付いたIssueの新規コメントを監視・処理する
- **詳細**:
  - ポーリング間隔（30秒）でコメントをチェック
  - Issue作成者のコメントのみを処理対象とする
  - PoppoBuilder自身のコメントは無視する

#### 1.1.2 状態管理
- **要件ID**: REQ-CH-002
- **内容**: Issue処理の状態を適切に管理する
- **詳細**:
  - `processing`: 処理中
  - `awaiting-response`: 応答待ち（新規導入）
  - `completed`: 完了
  - 状態遷移は可逆的（`awaiting-response` ⇔ `processing`）

#### 1.1.3 コンテキスト管理
- **要件ID**: REQ-CH-003
- **内容**: 会話の文脈を保持して適切な応答を生成する
- **詳細**:
  - Issue本文
  - 過去のコメント履歴
  - 処理結果の履歴

#### 1.1.4 完了判定
- **要件ID**: REQ-CH-004
- **内容**: 適切なタイミングでIssueを完了状態にする
- **詳細**:
  - 明示的な完了キーワード検出
  - タイムアウト（設定可能）
  - 最大処理回数制限

### 1.2 非機能要件

#### 1.2.1 性能要件
- **要件ID**: REQ-CH-NFR-001
- **内容**: 既存の処理性能を維持する
- **基準**: 
  - ポーリング間隔30秒を維持
  - 100コメントのIssueでも5秒以内に処理判定

#### 1.2.2 信頼性要件
- **要件ID**: REQ-CH-NFR-002
- **内容**: エラー時の適切な復旧
- **基準**:
  - コメント処理エラーでもIssue全体は継続
  - 重複処理防止メカニズム

#### 1.2.3 保守性要件
- **要件ID**: REQ-CH-NFR-003
- **内容**: 既存コードへの影響を最小化
- **基準**:
  - 既存の処理フローを大きく変更しない
  - 設定による機能の有効/無効切り替え

## 2. 概要設計

### 2.1 システム構成

```
┌─────────────────────────────────────────┐
│          PoppoBuilder Main Loop          │
│  ┌─────────────────┐ ┌─────────────────┐│
│  │  Issue Monitor   │ │ Comment Monitor ││
│  └────────┬─────────┘ └────────┬────────┘│
│           │                     │         │
│           ▼                     ▼         │
│  ┌─────────────────────────────────────┐│
│  │         State Manager                ││
│  │  ・processing                       ││
│  │  ・awaiting-response (新規)         ││
│  │  ・completed                        ││
│  └─────────────────────────────────────┘│
│           │                               │
│           ▼                               │
│  ┌─────────────────────────────────────┐│
│  │      Context Builder                 ││
│  │  ・Issue本文                        ││
│  │  ・コメント履歴                     ││
│  │  ・処理履歴                         ││
│  └─────────────────────────────────────┘│
│           │                               │
│           ▼                               │
│  ┌─────────────────────────────────────┐│
│  │       Claude Executor                ││
│  └─────────────────────────────────────┘│
└─────────────────────────────────────────┘
```

### 2.2 処理フロー

#### 2.2.1 初回処理フロー（既存）
1. 新規Issue検出（`task:misc` or `task:dogfooding`）
2. `processing`ラベル追加
3. Claude実行
4. 結果コメント投稿
5. `processing`削除、`awaiting-response`追加（変更点）

#### 2.2.2 コメント処理フロー（新規）
1. `awaiting-response`ラベル付きIssueのコメント監視
2. 新規コメント検出（作成者のみ）
3. `awaiting-response`削除、`processing`追加
4. コンテキスト構築（Issue + 履歴）
5. Claude実行
6. 結果コメント投稿
7. 完了判定
   - 完了の場合: `completed`追加
   - 継続の場合: `awaiting-response`追加

### 2.3 データ構造

#### 2.3.1 拡張されたIssue処理状態
```javascript
{
  issueNumber: number,
  state: 'processing' | 'awaiting-response' | 'completed',
  lastCommentId: number,        // 最後に処理したコメントID
  commentCount: number,         // 処理したコメント数
  firstProcessedAt: Date,       // 初回処理時刻
  lastProcessedAt: Date,        // 最終処理時刻
}
```

#### 2.3.2 コンテキスト情報
```javascript
{
  issue: {
    number: number,
    title: string,
    body: string,
  },
  comments: [
    {
      id: number,
      author: string,
      body: string,
      createdAt: Date,
      isProcessed: boolean,
    }
  ],
  processHistory: [
    {
      timestamp: Date,
      input: string,
      output: string,
    }
  ]
}
```

## 3. 詳細設計

### 3.1 モジュール設計

#### 3.1.1 CommentMonitor クラス（新規）
```javascript
class CommentMonitor {
  constructor(githubClient, logger) {
    this.github = githubClient;
    this.logger = logger;
    this.processedComments = new Map(); // issueNumber -> Set(commentIds)
  }

  /**
   * awaiting-responseラベル付きIssueのコメントをチェック
   */
  async checkNewComments() {
    const issues = await this.github.listIssues({ 
      state: 'open', 
      labels: 'awaiting-response' 
    });
    
    const newComments = [];
    for (const issue of issues) {
      const comments = await this.github.listComments(issue.number);
      const processed = this.processedComments.get(issue.number) || new Set();
      
      for (const comment of comments) {
        if (!processed.has(comment.id) && 
            comment.author.login === config.github.owner &&
            comment.author.login !== 'PoppoBuilder') {
          newComments.push({ issue, comment });
        }
      }
    }
    
    return newComments;
  }

  markAsProcessed(issueNumber, commentId) {
    if (!this.processedComments.has(issueNumber)) {
      this.processedComments.set(issueNumber, new Set());
    }
    this.processedComments.get(issueNumber).add(commentId);
  }
}
```

#### 3.1.2 StateManager の拡張
```javascript
// shouldProcessIssue 関数の拡張
function shouldProcessIssue(issue) {
  // 既存のチェック...
  
  // awaiting-responseの場合は別ロジックで処理
  if (labels.includes('awaiting-response')) {
    return false; // CommentMonitorで処理
  }
  
  // 既存のロジック...
}

// 新規: コメント処理用の判定関数
function shouldProcessComment(issue, comment) {
  const labels = issue.labels.map(l => l.name);
  
  // awaiting-responseラベルが必須
  if (!labels.includes('awaiting-response')) {
    return false;
  }
  
  // 作成者のコメントのみ
  if (comment.author.login !== config.github.owner) {
    return false;
  }
  
  // PoppoBuilder自身のコメントは無視
  if (comment.body.includes('## 実行完了') || 
      comment.body.includes('## エラーが発生しました')) {
    return false;
  }
  
  return true;
}
```

#### 3.1.3 ContextBuilder クラス（新規）
```javascript
class ContextBuilder {
  constructor(githubClient) {
    this.github = githubClient;
  }

  /**
   * Issue全体のコンテキストを構築
   */
  async buildContext(issueNumber) {
    const issue = await this.github.getIssue(issueNumber);
    const comments = await this.github.listComments(issueNumber);
    
    // PoppoBuilderのコメントと作成者のコメントを分離
    const conversation = [];
    
    // 初回のIssue本文
    conversation.push({
      role: 'user',
      content: `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`
    });
    
    // コメント履歴を時系列で追加
    for (const comment of comments) {
      if (comment.author.login === config.github.owner) {
        conversation.push({
          role: 'user',
          content: comment.body
        });
      } else if (comment.body.includes('## 実行完了')) {
        conversation.push({
          role: 'assistant',
          content: comment.body.replace('## 実行完了\n\n', '')
        });
      }
    }
    
    return conversation;
  }
}
```

#### 3.1.4 CompletionDetector クラス（新規）
```javascript
class CompletionDetector {
  constructor(config) {
    this.completionKeywords = config.completionKeywords || [
      'ありがとう', 'ありがとうございます', 'ありがとうございました',
      '完了', 'OK', 'ok', '了解', '承知', 
      'thank you', 'thanks', 'done', 'complete'
    ];
    this.maxCommentCount = config.maxCommentCount || 10;
    this.timeoutHours = config.timeoutHours || 24;
  }

  /**
   * コメントが完了を示しているか判定
   */
  isCompletionComment(comment) {
    const lowerBody = comment.body.toLowerCase();
    return this.completionKeywords.some(keyword => 
      lowerBody.includes(keyword.toLowerCase())
    );
  }

  /**
   * タイムアウトチェック
   */
  isTimeout(lastProcessedAt) {
    const now = new Date();
    const diff = now - new Date(lastProcessedAt);
    return diff > this.timeoutHours * 60 * 60 * 1000;
  }

  /**
   * 最大処理回数チェック
   */
  isMaxCountReached(commentCount) {
    return commentCount >= this.maxCommentCount;
  }
}
```

### 3.2 設定ファイルの拡張

#### config/config.json への追加
```json
{
  "github": { /* 既存 */ },
  "claude": { /* 既存 */ },
  "polling": { /* 既存 */ },
  "commentHandling": {
    "enabled": true,
    "completionKeywords": [
      "ありがとう", "完了", "OK", "了解"
    ],
    "maxCommentCount": 10,
    "timeoutHours": 24
  }
}
```

### 3.3 メインループの修正

```javascript
async function mainLoop() {
  const commentMonitor = new CommentMonitor(github, logger);
  const contextBuilder = new ContextBuilder(github);
  const completionDetector = new CompletionDetector(config.commentHandling);

  while (true) {
    try {
      // 既存のIssue処理...
      
      // 新規: コメント処理
      if (config.commentHandling.enabled) {
        const newComments = await commentMonitor.checkNewComments();
        
        for (const { issue, comment } of newComments) {
          if (shouldProcessComment(issue, comment)) {
            processComment(issue, comment, contextBuilder, completionDetector);
            commentMonitor.markAsProcessed(issue.number, comment.id);
          }
        }
      }
      
    } catch (error) {
      // エラー処理...
    }
    
    await new Promise(resolve => setTimeout(resolve, config.polling.interval));
  }
}
```

### 3.4 エラーハンドリング

#### 3.4.1 コメント処理エラー
- コメント単位でのエラーハンドリング
- エラー時はそのコメントをスキップし、次のコメントを処理
- エラーログに詳細を記録

#### 3.4.2 状態不整合の防止
- ラベル操作の前後で状態確認
- 同時実行による競合状態の検出と回復

### 3.5 ログ設計

#### 3.5.1 コメント処理ログ
```
[2025-06-16 10:30:00] [COMMENT] Issue #11 - New comment detected (ID: 12345)
[2025-06-16 10:30:01] [COMMENT] Issue #11 - Processing comment from owner
[2025-06-16 10:30:15] [COMMENT] Issue #11 - Comment processed successfully
[2025-06-16 10:30:16] [COMMENT] Issue #11 - Completion keyword detected: "ありがとう"
[2025-06-16 10:30:17] [COMMENT] Issue #11 - Marking as completed
```

## 4. テスト計画

### 4.1 単体テスト
- CommentMonitor: 新規コメント検出ロジック
- CompletionDetector: 完了判定ロジック
- ContextBuilder: コンテキスト構築ロジック

### 4.2 統合テスト
- 初回処理 → コメント追加 → 完了までのフロー
- タイムアウト処理
- エラー時の復旧

### 4.3 受け入れテスト
1. テストIssue作成（`task:misc`）
2. 初回処理確認（`awaiting-response`ラベル付与）
3. コメント追加
4. コメント処理確認
5. 「ありがとう」コメントで完了確認

## 5. 移行計画

### 5.1 既存Issueへの対応
- 既に`completed`ラベルが付いているIssueは影響なし
- `processing`中のIssueは処理完了後に新フローへ移行

### 5.2 段階的導入
1. 設定で機能を無効化した状態でリリース
2. テスト環境で動作確認
3. 本番環境で有効化

## 6. 今後の拡張可能性

### 6.1 Webhook対応
- GitHub WebhookでリアルタイムにコメントをA検出
- ポーリング方式からの移行

### 6.2 高度なコンテキスト管理
- 会話履歴の要約
- 長期記憶の実装
- 複数Issue間での知識共有