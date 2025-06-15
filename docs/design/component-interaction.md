# コンポーネント相互作用設計

## 概要
このドキュメントは、PoppoBuilder Suiteの各コンポーネント間の相互作用を詳細に定義します。

## シーケンス図

### 1. 新規Issue処理シーケンス
```
GitHub    IssueManager    StateManager    PhaseProcessor    ProcessManager    Claude
  │            │               │                │                 │              │
  │<---poll--->│               │                │                 │              │
  │            │               │                │                 │              │
  │ New Issue  │               │                │                 │              │
  │----------->│               │                │                 │              │
  │            │ Parse Issue   │                │                 │              │
  │            │-------------->│ Create Task    │                 │              │
  │            │               │--------------->│                 │              │
  │            │               │                │ Start Phase     │              │
  │            │               │                │---------------->│              │
  │            │               │                │                 │ Spawn Claude │
  │            │               │                │                 │------------->│
  │            │               │                │                 │              │
  │            │               │                │                 │<-- Result ---│
  │            │               │<-- Update -----│<-- Complete ----│              │
  │            │<-- Notify ----│                │                 │              │
  │<- Update ---│               │                │                 │              │
```

### 2. フェーズ承認待ちシーケンス
```
PhaseProcessor    IssueManager    GitHub    User
      │                │            │        │
      │ Need Approval  │            │        │
      │--------------->│            │        │
      │                │Create Issue│        │
      │                │----------->│        │
      │                │            │Notify->│
      │                │            │        │
      │                │            │<-Comment
      │                │<--Event----│        │
      │<-- Approved ---│            │        │
      │                │            │        │
      │ Continue       │            │        │
```

## 状態遷移図

### タスク状態遷移
```
┌─────────┐     ┌─────────┐     ┌──────────┐     ┌──────────┐
│ Created │---->│ Queued  │---->│ Running  │---->│ Complete │
└─────────┘     └─────────┘     └──────────┘     └──────────┘
                     │                 │                 
                     │                 ▼                 
                     │          ┌──────────┐             
                     └--------->│ Waiting  │             
                                └──────────┘             
                                      │                  
                                      ▼                  
                                ┌──────────┐             
                                │  Error   │             
                                └──────────┘             
```

### フェーズ状態遷移
```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│Requirements  │---->│Requirements  │---->│   Design     │
│  Analysis    │     │    Spec      │     │              │
└──────────────┘     └──────────────┘     └──────────────┘
                            │                      │
                            ▼                      ▼
                     ┌──────────────┐     ┌──────────────┐
                     │   Waiting    │     │Implementation│
                     │  Approval    │     │              │
                     └──────────────┘     └──────────────┘
```

## イベント駆動アーキテクチャ

### イベント一覧
1. **issue.created**: 新規Issue作成
2. **issue.commented**: Issueにコメント
3. **issue.labeled**: ラベル変更
4. **task.created**: タスク作成
5. **task.started**: タスク開始
6. **task.completed**: タスク完了
7. **phase.started**: フェーズ開始
8. **phase.completed**: フェーズ完了
9. **phase.waiting**: 承認待ち
10. **process.spawned**: プロセス起動
11. **process.completed**: プロセス完了
12. **error.occurred**: エラー発生

### イベントハンドラー
```javascript
// イベント登録例
eventBus.on('issue.created', async (issue) => {
  await taskQueue.add({
    type: 'analyze',
    issueId: issue.id,
    priority: issue.labels.includes('urgent') ? 'high' : 'normal'
  });
});

eventBus.on('phase.completed', async (phase) => {
  if (needsApproval(phase)) {
    await createApprovalIssue(phase);
  } else {
    await proceedToNextPhase(phase);
  }
});
```

## データ構造

### Task
```typescript
interface Task {
  id: string;
  issueId: number;
  type: 'feature' | 'fix' | 'docs';
  phase: Phase;
  status: TaskStatus;
  branch: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, any>;
}
```

### Phase
```typescript
interface Phase {
  name: PhaseType;
  status: 'pending' | 'running' | 'waiting' | 'completed';
  startedAt?: Date;
  completedAt?: Date;
  artifacts: string[];
  approvalRequired: boolean;
}
```

### ProcessInstruction
```typescript
interface ProcessInstruction {
  taskId: string;
  phase: PhaseType;
  context: {
    issue: GitHubIssue;
    previousPhases: Phase[];
    workingDirectory: string;
  };
  timeout: number;
}
```

## エラー処理方針

### エラー分類
1. **一時的エラー**: ネットワーク、API制限
   - 自動リトライ（指数バックオフ）
   
2. **ユーザー対応必要**: 要件不明、設計判断
   - Issue作成して待機
   
3. **システムエラー**: プロセス異常、設定ミス
   - ログ記録して停止

### エラーリカバリー
```javascript
class ErrorRecovery {
  async handle(error, context) {
    if (isTransient(error)) {
      return await this.retry(context);
    }
    
    if (needsUserInput(error)) {
      return await this.createIssue(error, context);
    }
    
    await this.logAndStop(error, context);
  }
}
```