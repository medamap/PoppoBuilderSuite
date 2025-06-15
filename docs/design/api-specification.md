# API仕様書

## 概要
このドキュメントは、PoppoBuilder Suiteの内部APIとGitHub連携APIの仕様を定義します。

## 内部API

### Event Bus API

#### イベント一覧
| イベント名 | 説明 | ペイロード |
|---------|------|----------|
| `issue.created` | 新規Issue検出 | `{ issue: GitHubIssue }` |
| `issue.commented` | Issueコメント追加 | `{ issue: GitHubIssue, comment: Comment }` |
| `issue.labeled` | ラベル変更 | `{ issue: GitHubIssue, labels: string[] }` |
| `task.created` | タスク作成 | `{ task: Task }` |
| `task.queued` | タスクキュー追加 | `{ taskId: string }` |
| `task.started` | タスク開始 | `{ taskId: string }` |
| `task.completed` | タスク完了 | `{ taskId: string, result: TaskResult }` |
| `phase.started` | フェーズ開始 | `{ taskId: string, phase: PhaseType }` |
| `phase.completed` | フェーズ完了 | `{ taskId: string, phase: PhaseType, result: PhaseResult }` |
| `phase.waiting` | 承認待ち | `{ taskId: string, phase: PhaseType, approvalIssueId: number }` |
| `process.spawned` | プロセス起動 | `{ taskId: string, pid: number }` |
| `process.completed` | プロセス完了 | `{ taskId: string, exitCode: number }` |
| `error.occurred` | エラー発生 | `{ error: Error, context: any }` |

#### 使用例
```typescript
// イベント登録
eventBus.on('issue.created', async (payload) => {
  console.log(`New issue: ${payload.issue.title}`);
  await taskManager.createTask(payload.issue);
});

// イベント発火
eventBus.emit('task.completed', {
  taskId: 'task-123',
  result: { success: true, artifacts: ['design.md'] }
});
```

### Task Queue API

#### メソッド一覧

##### addTask
```typescript
async addTask(task: Task): Promise<void>
```
タスクをキューに追加

##### getNextTask
```typescript
async getNextTask(): Promise<Task | null>
```
次の実行可能タスクを取得

##### updateTaskStatus
```typescript
async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>
```
タスクステータス更新

##### getTasksByStatus
```typescript
async getTasksByStatus(status: TaskStatus): Promise<Task[]>
```
ステータス別タスク取得

### Branch Manager API

#### メソッド一覧

##### createBranch
```typescript
async createBranch(params: CreateBranchParams): Promise<BranchInfo>

interface CreateBranchParams {
  taskId: string;
  type: 'feature' | 'fix' | 'docs' | 'design';
  baseBranch?: string; // デフォルト: 'develop'
}
```

##### switchBranch
```typescript
async switchBranch(branchName: string): Promise<void>
```

##### mergeBranch
```typescript
async mergeBranch(params: MergeBranchParams): Promise<MergeResult>

interface MergeBranchParams {
  source: string;
  target: string;
  strategy?: 'merge' | 'squash' | 'rebase';
}
```

## GitHub API ラッパー

### GitHubClient

#### 初期化
```typescript
const client = new GitHubClient({
  owner: 'medamap',
  repo: 'PoppoBuilderSuite'
});
```

#### Issue操作

##### listIssues
```typescript
async listIssues(params?: ListIssuesParams): Promise<GitHubIssue[]>

interface ListIssuesParams {
  state?: 'open' | 'closed' | 'all';
  labels?: string[];
  assignee?: string;
  creator?: string;
  since?: Date;
}
```

##### createIssue
```typescript
async createIssue(params: CreateIssueParams): Promise<GitHubIssue>

interface CreateIssueParams {
  title: string;
  body: string;
  labels?: string[];
  assignees?: string[];
  milestone?: number;
}
```

##### updateIssue
```typescript
async updateIssue(issueNumber: number, params: UpdateIssueParams): Promise<GitHubIssue>
```

##### addComment
```typescript
async addComment(issueNumber: number, body: string): Promise<Comment>
```

##### addLabels
```typescript
async addLabels(issueNumber: number, labels: string[]): Promise<void>
```

#### Pull Request操作

##### createPR
```typescript
async createPR(params: CreatePRParams): Promise<PullRequest>

interface CreatePRParams {
  title: string;
  body: string;
  head: string;  // source branch
  base: string;  // target branch
  draft?: boolean;
}
```

##### updatePR
```typescript
async updatePR(prNumber: number, params: UpdatePRParams): Promise<PullRequest>
```

##### mergePR
```typescript
async mergePR(prNumber: number, params: MergePRParams): Promise<MergeResult>

interface MergePRParams {
  merge_method?: 'merge' | 'squash' | 'rebase';
  commit_title?: string;
  commit_message?: string;
}
```

#### Wiki操作

##### updateWikiPage
```typescript
async updateWikiPage(params: UpdateWikiParams): Promise<void>

interface UpdateWikiParams {
  pageName: string;
  content: string;
  message: string;
}
```

## Process Instruction Format

### 基本構造
```typescript
interface ProcessInstruction {
  version: '1.0';
  taskId: string;
  phase: PhaseType;
  action: string;
  context: {
    issue: {
      number: number;
      title: string;
      body: string;
      labels: string[];
    };
    previousPhases: {
      name: PhaseType;
      artifacts: string[];
    }[];
    workingDirectory: string;
    files: string[];  // 関連ファイルパス
  };
  constraints: {
    timeout: number;
    memory?: string;  // e.g., '512MB'
  };
  output: {
    format: 'json' | 'markdown';
    saveTo?: string;  // 出力先パス
  };
}
```

### フェーズ別Instruction例

#### 要求定義フェーズ
```json
{
  "version": "1.0",
  "taskId": "task-001",
  "phase": "requirements-analysis",
  "action": "analyze",
  "context": {
    "issue": {
      "number": 42,
      "title": "新機能: ダッシュボード追加",
      "body": "管理画面にダッシュボード機能を追加したい...",
      "labels": ["feature", "enhancement"]
    },
    "workingDirectory": "/path/to/project",
    "files": []
  },
  "constraints": {
    "timeout": 300000
  },
  "output": {
    "format": "markdown",
    "saveTo": "docs/requirements/task-001-requirements.md"
  }
}
```

#### 実装フェーズ
```json
{
  "version": "1.0",
  "taskId": "task-001",
  "phase": "implementation",
  "action": "implement",
  "context": {
    "issue": { /* ... */ },
    "previousPhases": [
      {
        "name": "design",
        "artifacts": ["docs/design/task-001-design.md"]
      }
    ],
    "workingDirectory": "/path/to/project",
    "files": ["src/components/Dashboard.ts"]
  },
  "constraints": {
    "timeout": 600000
  },
  "output": {
    "format": "json"
  }
}
```

## レスポンスフォーマット

### 成功レスポンス
```typescript
interface SuccessResponse {
  success: true;
  taskId: string;
  phase: PhaseType;
  artifacts: string[];
  metrics?: {
    duration: number;
    filesChanged: number;
    linesAdded: number;
    linesDeleted: number;
  };
}
```

### エラーレスポンス
```typescript
interface ErrorResponse {
  success: false;
  taskId: string;
  phase: PhaseType;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  requiresUserInput?: boolean;
  suggestedAction?: string;
}
```

## Webhook仕様

### 受信Webhook
PoppoBuilderは以下のGitHub Webhookイベントを処理します：

| イベント | アクション | 処理内容 |
|---------|-----------|---------|
| `issues` | `opened` | 新規タスク作成 |
| `issues` | `labeled` | ラベルに基づく処理 |
| `issue_comment` | `created` | 承認処理など |
| `pull_request` | `closed` | マージ後処理 |

### Webhook処理例
```typescript
app.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const action = req.body.action;
  
  if (event === 'issues' && action === 'opened') {
    await handleNewIssue(req.body.issue);
  }
  
  res.status(200).send('OK');
});
```