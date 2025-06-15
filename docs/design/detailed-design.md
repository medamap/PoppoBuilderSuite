# 詳細設計書

## 概要
このドキュメントは、概要設計に基づいて各コンポーネントの詳細な実装設計を定義します。

**作成日**: 2025/6/15
**ブランチ**: design/system-architecture
**ステータス**: 詳細設計中

## コンポーネント詳細設計

### 1. Issue Manager

#### クラス構造
```typescript
class IssueManager {
  private gh: GitHubClient;
  private config: IssueManagerConfig;
  private eventBus: EventEmitter;

  constructor(config: IssueManagerConfig, eventBus: EventEmitter) {
    this.config = config;
    this.eventBus = eventBus;
    this.gh = new GitHubClient(config.repo);
  }

  // Issue監視
  async pollIssues(): Promise<void> {
    const issues = await this.gh.listIssues({
      state: 'open',
      labels: ['poppo-builder']
    });
    
    for (const issue of issues) {
      if (this.isNewIssue(issue)) {
        this.eventBus.emit('issue.created', issue);
      }
    }
  }

  // Issue作成
  async createIssue(params: CreateIssueParams): Promise<GitHubIssue> {
    const issue = await this.gh.createIssue({
      title: params.title,
      body: params.body,
      labels: params.labels
    });
    
    this.eventBus.emit('issue.created', issue);
    return issue;
  }

  // 承認待ちIssue作成
  async createApprovalIssue(task: Task, phase: Phase): Promise<GitHubIssue> {
    const body = this.formatApprovalBody(task, phase);
    return await this.createIssue({
      title: `[承認待ち] ${task.id} - ${phase.name}フェーズ`,
      body,
      labels: ['phase:waiting-approval', task.type]
    });
  }
}
```

#### インターフェース定義
```typescript
interface IssueManagerConfig {
  repo: {
    owner: string;
    name: string;
  };
  pollInterval: number;
  labels: {
    taskTypes: string[];
    phases: string[];
  };
}

interface CreateIssueParams {
  title: string;
  body: string;
  labels: string[];
  assignees?: string[];
}
```

### 2. Process Manager

#### クラス構造
```typescript
class ProcessManager {
  private processes: Map<string, ChildProcess>;
  private config: ProcessManagerConfig;
  
  constructor(config: ProcessManagerConfig) {
    this.config = config;
    this.processes = new Map();
  }

  // Claudeプロセスの起動
  async spawnClaude(instruction: ProcessInstruction): Promise<ProcessResult> {
    const args = [
      '--dangerously-skip-permissions',
      '--print',
      JSON.stringify(instruction)
    ];
    
    const process = spawn('claude', args, {
      cwd: instruction.workingDirectory,
      timeout: instruction.timeout,
      detached: true
    });
    
    this.processes.set(instruction.taskId, process);
    
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      
      process.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      process.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      process.on('exit', (code) => {
        this.processes.delete(instruction.taskId);
        
        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          reject(new ProcessError(code, stderr));
        }
      });
    });
  }

  // プロセスの強制終了
  async killProcess(taskId: string): Promise<void> {
    const process = this.processes.get(taskId);
    if (process) {
      process.kill('SIGTERM');
      this.processes.delete(taskId);
    }
  }
}
```

### 3. State Manager

#### クラス構造
```typescript
class StateManager {
  private statePath: string;
  private state: SystemState;
  private lockManager: LockManager;

  constructor(statePath: string) {
    this.statePath = statePath;
    this.lockManager = new LockManager();
    this.loadState();
  }

  // タスク追加
  async addTask(task: Task): Promise<void> {
    await this.lockManager.acquire('state');
    try {
      this.state.tasks.set(task.id, task);
      this.state.queue.push(task.id);
      await this.saveState();
    } finally {
      await this.lockManager.release('state');
    }
  }

  // フェーズ更新
  async updatePhase(taskId: string, phase: Phase): Promise<void> {
    await this.lockManager.acquire('state');
    try {
      const task = this.state.tasks.get(taskId);
      if (task) {
        task.phase = phase;
        task.updatedAt = new Date();
        await this.saveState();
      }
    } finally {
      await this.lockManager.release('state');
    }
  }

  // 状態の永続化
  private async saveState(): Promise<void> {
    const data = {
      tasks: Array.from(this.state.tasks.entries()),
      queue: this.state.queue,
      branches: Array.from(this.state.branches.entries()),
      updatedAt: new Date()
    };
    
    await fs.writeFile(
      this.statePath,
      JSON.stringify(data, null, 2),
      'utf-8'
    );
  }
}
```

#### データ構造
```typescript
interface SystemState {
  tasks: Map<string, Task>;
  queue: string[];
  branches: Map<string, BranchInfo>;
}

interface BranchInfo {
  name: string;
  type: 'feature' | 'fix' | 'docs' | 'design';
  taskId: string;
  baseBranch: string;
  status: 'active' | 'merged' | 'closed';
}
```

### 4. Phase Processors

#### 基底クラス
```typescript
abstract class PhaseProcessor {
  protected eventBus: EventEmitter;
  protected processManager: ProcessManager;
  
  constructor(eventBus: EventEmitter, processManager: ProcessManager) {
    this.eventBus = eventBus;
    this.processManager = processManager;
  }

  abstract get phaseName(): PhaseType;
  
  abstract process(task: Task, context: PhaseContext): Promise<PhaseResult>;
  
  // 共通の前処理
  protected async preProcess(task: Task): Promise<void> {
    this.eventBus.emit('phase.started', {
      taskId: task.id,
      phase: this.phaseName
    });
  }
  
  // 共通の後処理
  protected async postProcess(task: Task, result: PhaseResult): Promise<void> {
    this.eventBus.emit('phase.completed', {
      taskId: task.id,
      phase: this.phaseName,
      result
    });
  }
}
```

#### 要件定義プロセッサー
```typescript
class RequirementsSpecProcessor extends PhaseProcessor {
  get phaseName(): PhaseType {
    return 'requirements-spec';
  }
  
  async process(task: Task, context: PhaseContext): Promise<PhaseResult> {
    await this.preProcess(task);
    
    const instruction: ProcessInstruction = {
      taskId: task.id,
      phase: this.phaseName,
      context: {
        issue: context.issue,
        requirements: context.previousPhases.find(p => p.name === 'requirements-analysis'),
        template: await this.loadTemplate('requirements-spec')
      },
      timeout: 300000
    };
    
    try {
      const result = await this.processManager.spawnClaude(instruction);
      const artifacts = await this.parseArtifacts(result.output);
      
      const phaseResult: PhaseResult = {
        success: true,
        artifacts,
        nextPhase: 'design'
      };
      
      await this.postProcess(task, phaseResult);
      return phaseResult;
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        requiresUserInput: this.needsUserInput(error)
      };
    }
  }
}
```

## エラー処理詳細

### エラークラス階層
```typescript
class PoppoBuilderError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

class ProcessError extends PoppoBuilderError {
  constructor(public exitCode: number, public stderr: string) {
    super(`Process exited with code ${exitCode}`, 'PROCESS_ERROR');
  }
}

class GitHubError extends PoppoBuilderError {
  constructor(message: string, public statusCode: number) {
    super(message, 'GITHUB_ERROR');
  }
}

class ValidationError extends PoppoBuilderError {
  constructor(message: string, public field: string) {
    super(message, 'VALIDATION_ERROR');
  }
}
```

## 設定ファイル詳細

### システム設定
```typescript
interface SystemConfig {
  github: {
    owner: string;
    repo: string;
    auth: {
      token?: string;  // gh CLIの認証を優先
    };
  };
  
  process: {
    claudePath: string;  // デフォルト: 'claude'
    timeout: number;     // デフォルト: 300000 (5分)
    maxConcurrent: number; // デフォルト: 3
  };
  
  phases: {
    autoApprove: PhaseType[];  // 自動承認フェーズ
    requireApproval: PhaseType[]; // 承認必要フェーズ
  };
  
  paths: {
    state: string;      // 状態ファイルパス
    logs: string;       // ログディレクトリ
    artifacts: string;  // 成果物ディレクトリ
  };
}
```

## ファイル構造

```
poppo-builder-suite/
├── src/
│   ├── core/
│   │   ├── IssueManager.ts
│   │   ├── ProcessManager.ts
│   │   └── StateManager.ts
│   ├── phases/
│   │   ├── PhaseProcessor.ts
│   │   ├── RequirementsAnalysisProcessor.ts
│   │   ├── RequirementsSpecProcessor.ts
│   │   ├── DesignProcessor.ts
│   │   ├── ImplementationProcessor.ts
│   │   └── PRProcessor.ts
│   ├── utils/
│   │   ├── GitHubClient.ts
│   │   ├── LockManager.ts
│   │   └── Logger.ts
│   └── index.ts
├── config/
│   └── default.json
├── templates/
│   ├── requirements-spec.md
│   ├── design.md
│   └── pr-description.md
└── tests/
    ├── unit/
    └── integration/
```

## 次のステップ
- 実装フェーズの開始
- テストケースの作成
- CI/CD設定の準備