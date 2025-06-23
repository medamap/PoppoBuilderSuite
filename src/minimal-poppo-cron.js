#!/usr/bin/env node

// cron実行用のPoppoBuilder
// プロセス名を設定（psコマンドで識別しやすくするため）
process.title = 'PoppoBuilder-Cron';

const fs = require('fs');
const path = require('path');
const GitHubClient = require('./github-client');
const ProcessManager = require('./process-manager');
const IndependentProcessManager = require('./independent-process-manager');
const EnhancedRateLimiter = require('./enhanced-rate-limiter');
const TaskQueue = require('./task-queue');
const Logger = require('./logger');
const ConfigLoader = require('./config-loader');
const TwoStageProcessor = require('./two-stage-processor');
const FileStateManager = require('./file-state-manager');
const StatusManager = require('./status-manager');
const MirinOrphanManager = require('./mirin-orphan-manager');

// ConfigLoaderで階層的に設定を読み込み
const configLoader = new ConfigLoader();
const poppoConfig = configLoader.loadConfig();

// メイン設定ファイルも読み込み（後方互換性のため）
const mainConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8')
);

// 設定をマージ（メイン設定を基本とし、PoppoConfig設定で上書き）
const config = {
  ...mainConfig,
  language: poppoConfig.language || mainConfig.language,
  systemPrompt: poppoConfig.systemPrompt || mainConfig.systemPrompt,
  // 環境変数やプロジェクト設定で上書き可能な項目
  github: {
    ...mainConfig.github,
    ...(poppoConfig.github || {})
  },
  claude: {
    ...mainConfig.claude,
    ...(poppoConfig.claude || {})
  },
  rateLimiting: {
    ...mainConfig.rateLimiting,
    ...(poppoConfig.rateLimit || {})
  },
  taskQueue: {
    ...mainConfig.taskQueue,
    ...(poppoConfig.queue || {})
  },
  logging: {
    ...mainConfig.logging,
    ...(poppoConfig.logging || {})
  },
  dynamicTimeout: {
    ...mainConfig.dynamicTimeout,
    ...(poppoConfig.dynamicTimeout || {})
  },
  errorCollection: {
    ...mainConfig.errorCollection,
    ...(poppoConfig.errorCollection || {})
  }
};

// インスタンス作成
const logger = new Logger(
  path.join(__dirname, '../logs'),
  config.logRotation || {}
);

// GitHub設定を確実に取得
const githubConfig = config.github || {
  owner: 'medamap',
  repo: 'PoppoBuilderSuite'
};
console.log('使用するGitHub設定:', githubConfig);
const github = new GitHubClient(githubConfig);
const rateLimiter = new EnhancedRateLimiter(config.rateLimiting || {});
const taskQueue = new TaskQueue({ 
  maxConcurrent: config.claude.maxConcurrent,
  maxQueueSize: config.taskQueue?.maxQueueSize || 100 
});
// ファイルベースの状態管理
const stateManager = new FileStateManager();

// 独立プロセス方式を使用（FileStateManagerを渡す）
const processManager = new IndependentProcessManager(config.claude, rateLimiter, logger, stateManager);

// IndependentProcessManagerにFileStateManagerを設定（二重管理を防止）
processManager.setStateManager(stateManager);

// 2段階処理システムの初期化
const twoStageProcessor = new TwoStageProcessor(config, null, logger);

// StatusManagerの初期化
const statusManager = new StatusManager('state/issue-status.json', logger);

// MirinOrphanManagerの初期化
const mirinManager = new MirinOrphanManager(github, statusManager, {
  checkInterval: 30 * 60 * 1000, // 30分
  heartbeatTimeout: 5 * 60 * 1000, // 5分
  requestsDir: 'state/requests',
  requestCheckInterval: 5000 // 5秒
}, logger);

// 処理済みIssueとコメント（メモリ内キャッシュ）
let processedIssues = new Set();
let processedComments = new Map();

/**
 * Issueが処理対象かチェック
 */
function shouldProcessIssue(issue) {
  const debugPrefix = `  Issue #${issue.number}:`;
  
  // すでに処理済み
  if (processedIssues.has(issue.number)) {
    console.log(`${debugPrefix} ⏭️  既に処理済み`);
    return false;
  }

  // 作者のIssueかチェック
  if (issue.author.login !== config.github.owner) {
    console.log(`${debugPrefix} ⏭️  作者が異なる (${issue.author.login} !== ${config.github.owner})`);
    return false;
  }

  // ラベルチェック
  const labels = issue.labels.map(l => l.name);
  console.log(`${debugPrefix} ラベル: [${labels.join(', ')}]`);
  
  // task:misc, task:dogfooding, task:quality, task:docs, task:feature のいずれかのラベルが必要
  const taskLabels = ['task:misc', 'task:dogfooding', 'task:quality', 'task:docs', 'task:feature'];
  if (!labels.some(label => taskLabels.includes(label))) {
    console.log(`${debugPrefix} ⏭️  必要なタスクラベルがない`);
    return false;
  }

  // completed, processing, awaiting-responseラベルがあればスキップ
  if (labels.includes('completed') || labels.includes('processing') || labels.includes('awaiting-response')) {
    console.log(`${debugPrefix} ⏭️  スキップラベルあり (completed/processing/awaiting-response)`);
    return false;
  }

  console.log(`${debugPrefix} ✅ 処理対象`);
  return true;
}

/**
 * Issueを処理
 */
async function processIssue(issue) {
  const issueNumber = issue.number;
  logger.logIssue(issueNumber, 'START', { title: issue.title, labels: issue.labels });
  console.log(`\nIssue #${issueNumber} の処理開始: ${issue.title}`);

  // 処理開始前に再度実行中タスクを確認（二重処理防止）
  const currentRunningTasks = await stateManager.loadRunningTasks();
  const taskId = `issue-${issueNumber}`;
  
  if (currentRunningTasks[taskId]) {
    // 実行中のプロセスが本当に生きているか確認
    const existingTask = currentRunningTasks[taskId];
    if (existingTask.pid && processManager.isProcessRunning(existingTask.pid)) {
      console.log(`⚠️  Issue #${issueNumber} は既に処理中です (PID: ${existingTask.pid})`);
      logger.logIssue(issueNumber, 'ALREADY_RUNNING', { 
        existingTask: existingTask
      });
      return;
    } else {
      // プロセスが死んでいる場合は、タスクを削除して続行
      console.log(`🧹 Issue #${issueNumber} の死んだタスクをクリーンアップ (PID: ${existingTask.pid})`);
      await stateManager.removeRunningTask(taskId);
    }
  }
  
  // IndependentProcessManagerの内部状態も確認
  const processManagerTasks = await processManager.getRunningTasks();
  if (processManagerTasks[taskId]) {
    const pmTask = processManagerTasks[taskId];
    if (pmTask.pid && processManager.isProcessRunning(pmTask.pid)) {
      console.log(`⚠️  Issue #${issueNumber} はProcessManager内で処理中です (PID: ${pmTask.pid})`);
      logger.logIssue(issueNumber, 'ALREADY_RUNNING_PM', { 
        existingTask: pmTask
      });
      return;
    }
  }
  
  // アトミックな状態更新で二重起動を防止
  try {
    // 即座に実行中タスクとして記録（他のプロセスから見えるように）
    await stateManager.addRunningTask(taskId, {
      issueNumber,
      title: issue.title,
      pid: process.pid, // 一時的に親プロセスのPIDを設定
      type: 'issue',
      status: 'preparing', // 準備中ステータス
      lockTime: new Date().toISOString()
    });
    
    // 再度チェック（レースコンディション対策）
    const doubleCheck = await stateManager.loadRunningTasks();
    const ourTask = doubleCheck[taskId];
    if (!ourTask || ourTask.pid !== process.pid || ourTask.status !== 'preparing') {
      console.log(`⚠️  Issue #${issueNumber} は別のプロセスに取られました`);
      logger.logIssue(issueNumber, 'RACE_CONDITION', { 
        ourPid: process.pid,
        actualTask: doubleCheck[taskId]
      });
      // 念のため自分の登録を削除
      if (ourTask && ourTask.pid === process.pid) {
        await stateManager.removeRunningTask(taskId);
      }
      return;
    }
  } catch (error) {
    console.error(`Issue #${issueNumber} の状態更新エラー:`, error);
    logger.error(`タスク ${taskId} の事前登録エラー:`, error);
    return;
  }

  // 処理開始前に処理済みとして記録（二重起動防止）
  processedIssues.add(issueNumber);
  try {
    await stateManager.saveProcessedIssues(processedIssues);
  } catch (error) {
    logger.error(`Issue #${issueNumber} の状態保存エラー:`, error);
    // 状態保存に失敗してもプロセスは継続
  }

  try {
    // StatusManagerでチェックアウト（processingラベルの追加はMirinOrphanManager経由で行われる）
    await statusManager.checkout(issueNumber, `issue-${issueNumber}`, 'claude-cli');
    logger.logIssue(issueNumber, 'CHECKED_OUT', { status: 'processing' });

    // ラベル取得
    const labels = issue.labels.map(l => l.name);
    
    // 言語設定読み込み
    const poppoConfig = configLoader.loadConfig();
    
    // 2段階処理を試みる
    const instructionText = `${issue.title}\n\n${issue.body}`;
    const twoStageResult = await twoStageProcessor.processInstruction(instructionText, {
      issueNumber: issueNumber,
      labels: labels
    });

    // 2段階処理が成功し、Issue作成アクションの場合
    if (twoStageResult.executed && twoStageResult.action === 'create_issue') {
      logger.logIssue(issueNumber, 'TWO_STAGE_ISSUE_CREATED', { 
        newIssue: twoStageResult.executionResult.issue 
      });
      
      // StatusManagerでチェックイン（completedステータスへ）
      await statusManager.checkin(issueNumber, 'completed', {
        taskType: 'two-stage-issue-creation',
        newIssueNumber: twoStageResult.executionResult.issue.number
      });
      
      console.log(`Issue #${issueNumber} の処理完了（2段階処理でIssue作成）`);
      return;
    }

    // 通常のClaude実行に進む
    const instruction = {
      task: 'execute',
      issue: {
        number: issueNumber,
        title: issue.title,
        body: issue.body
      },
      context: {
        repository: `${config.github.owner}/${config.github.repo}`,
        workingDirectory: process.cwd(),
        defaultBranch: 'work/poppo-builder',
        systemPrompt: configLoader.generateSystemPrompt(poppoConfig, issueNumber, labels)
      }
    };

    // Claudeで実行（独立プロセス方式）
    logger.logIssue(issueNumber, 'EXECUTE_START', { instruction });
    
    // dogfoodingかどうかを判定
    const isDogfooding = labels.includes('task:dogfooding');
    instruction.issue.type = isDogfooding ? 'dogfooding' : 'normal';
    
    const result = await processManager.execute(`issue-${issueNumber}`, instruction);
    logger.logIssue(issueNumber, 'INDEPENDENT_STARTED', { 
      taskId: result.taskId,
      pid: result.pid 
    });

    // 実行中タスクの情報を更新（実際のPIDで）
    try {
      await stateManager.addRunningTask(result.taskId, {
        issueNumber,
        title: issue.title,
        pid: result.pid,
        type: instruction.issue.type,
        status: 'running',
        startTime: new Date().toISOString()
      });
    } catch (error) {
      logger.error(`タスク ${result.taskId} の状態記録エラー:`, error);
    }

    console.log(`Issue #${issueNumber} を独立プロセス (${result.taskId}) として開始`);
    console.log(`PID: ${result.pid}`);

  } catch (error) {
    logger.logIssue(issueNumber, 'ERROR', { 
      message: error.message, 
      stack: error.stack,
      stdout: error.stdout,
      stderr: error.stderr 
    });
    console.error(`Issue #${issueNumber} の処理エラー:`, error.message);
    
    // エラー時の包括的なクリーンアップ
    const taskId = `issue-${issueNumber}`;
    
    // 1. 実行中タスクから削除
    try {
      await stateManager.removeRunningTask(taskId);
      console.log(`✅ タスク ${taskId} を実行中リストから削除`);
    } catch (cleanupError) {
      logger.error(`タスク ${taskId} のクリーンアップエラー:`, cleanupError);
    }
    
    // 2. 独立プロセスの停止確認（resultオブジェクトまたはerrorオブジェクトから）
    const pid = error.result?.pid || error.pid;
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`🛑 PID ${pid} のプロセスを停止しました`);
      } catch (killError) {
        if (killError.code !== 'ESRCH') {
          // プロセスが見つからない以外のエラーはログに記録
          logger.error(`プロセス ${pid} の停止エラー:`, killError);
        }
      }
    }
    
    // 3. IndependentProcessManagerから関連プロセスを確認・停止
    try {
      const runningTasks = await processManager.getRunningTasks();
      if (runningTasks[taskId]) {
        const taskPid = runningTasks[taskId].pid;
        if (taskPid && processManager.isProcessRunning(taskPid)) {
          process.kill(taskPid, 'SIGTERM');
          console.log(`🛑 関連プロセス PID ${taskPid} を停止しました`);
        }
      }
    } catch (processError) {
      logger.error(`関連プロセスの停止エラー:`, processError);
    }
    
    // 4. 処理済みIssueリストから削除（再処理可能にする）
    processedIssues.delete(issueNumber);
    try {
      await stateManager.saveProcessedIssues(processedIssues);
      console.log(`📝 Issue #${issueNumber} を処理済みリストから削除しました`);
    } catch (saveError) {
      logger.error(`Issue #${issueNumber} の処理済み状態削除エラー:`, saveError);
    }
    
    // 5. StatusManagerの状態をクリーンアップ
    try {
      await statusManager.checkin(issueNumber, 'error', {
        error: error.message,
        taskType: 'issue'
      });
    } catch (statusError) {
      logger.error(`Issue #${issueNumber} のステータス更新エラー:`, statusError);
    }
    
    // エラー時の処理
    const errorDetails = [
      `## エラーが発生しました`,
      ``,
      `### エラーメッセージ`,
      `\`\`\``,
      error.message || '(エラーメッセージなし)',
      `\`\`\``,
      error.stderr ? `\n### エラー出力\n\`\`\`\n${error.stderr}\n\`\`\`` : '',
      error.stdout ? `\n### 標準出力\n\`\`\`\n${error.stdout}\n\`\`\`` : '',
      ``,
      `詳細なログは \`logs/issue-${issueNumber}-*.log\` を確認してください。`
    ].filter(Boolean).join('\n');
    
    await github.addComment(issueNumber, errorDetails);
    
    // StatusManagerの状態をリセット（エラー時は処理済みリストから削除して再試行可能に）
    await statusManager.resetIssueStatus(issueNumber);
    processedIssues.delete(issueNumber);
    try {
      await stateManager.saveProcessedIssues(processedIssues);
    } catch (saveError) {
      logger.error(`Issue #${issueNumber} の状態削除エラー:`, saveError);
    }
  }
}

/**
 * コメントが処理対象かチェック
 */
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

/**
 * コメントが完了を示しているか判定
 */
function isCompletionComment(comment) {
  if (!config.commentHandling || !config.commentHandling.completionKeywords) {
    return false;
  }
  
  const lowerBody = comment.body.toLowerCase();
  return config.commentHandling.completionKeywords.some(keyword => 
    lowerBody.includes(keyword.toLowerCase())
  );
}

/**
 * コンテキストを構築
 */
async function buildContext(issueNumber) {
  const issue = await github.getIssue(issueNumber);
  const comments = await github.listComments(issueNumber);
  
  // 会話履歴を構築
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
      // PoppoBuilderの応答から"## 実行完了"を除去
      const content = comment.body.replace(/^## 実行完了\n\n/, '');
      conversation.push({
        role: 'assistant',
        content: content
      });
    }
  }
  
  return conversation;
}

/**
 * コメントを処理
 */
async function processComment(issue, comment) {
  const issueNumber = issue.number;
  const commentId = comment.id || `${comment.createdAt}-${comment.author.login}`;
  const taskId = `issue-${issueNumber}-comment-${commentId}`;
  
  logger.logIssue(issueNumber, 'COMMENT_START', { 
    commentId: commentId,
    commentAuthor: comment.author.login 
  });
  console.log(`\nIssue #${issueNumber} のコメント処理開始`);

  // 処理開始前に二重処理防止
  const currentRunningTasks = await stateManager.loadRunningTasks();
  if (currentRunningTasks[taskId]) {
    const existingTask = currentRunningTasks[taskId];
    if (existingTask.pid && processManager.isProcessRunning(existingTask.pid)) {
      console.log(`⚠️  コメント ${taskId} は既に処理中です (PID: ${existingTask.pid})`);
      logger.logIssue(issueNumber, 'COMMENT_ALREADY_RUNNING', { 
        existingTask: existingTask
      });
      return;
    } else {
      console.log(`🧹 コメント ${taskId} の死んだタスクをクリーンアップ (PID: ${existingTask.pid})`);
      await stateManager.removeRunningTask(taskId);
    }
  }

  try {
    // StatusManagerでコメント処理を開始（awaiting-response→processingの変更もMirinOrphanManager経由）
    await statusManager.checkout(issueNumber, `comment-${issueNumber}-${commentId}`, 'comment-response');
    logger.logIssue(issueNumber, 'COMMENT_CHECKOUT', { 
      status: 'processing',
      commentId: commentId
    });

    // コンテキストを構築
    const conversation = await buildContext(issueNumber);
    
    // ラベル取得
    const labels = issue.labels.map(l => l.name);
    
    // 言語設定読み込み
    const poppoConfig = configLoader.loadConfig();
    
    // Claude用の指示を作成（コンテキスト付き）
    const instruction = {
      task: 'execute_with_context',
      issue: {
        number: issueNumber,
        title: issue.title,
        conversation: conversation
      },
      context: {
        repository: `${config.github.owner}/${config.github.repo}`,
        workingDirectory: process.cwd(),
        defaultBranch: 'work/poppo-builder',
        systemPrompt: configLoader.generateSystemPrompt(poppoConfig, issueNumber, labels),
        isFollowUp: true
      }
    };

    // Claudeで実行（独立プロセス方式）
    logger.logIssue(issueNumber, 'COMMENT_EXECUTE_START', { 
      commentId: commentId,
      conversationLength: conversation.length 
    });
    
    instruction.issue.type = 'comment';
    instruction.issue.isCompletion = isCompletionComment(comment);
    
    const result = await processManager.execute(taskId, instruction);
    logger.logIssue(issueNumber, 'COMMENT_INDEPENDENT_STARTED', { 
      taskId: result.taskId,
      pid: result.pid 
    });

    // 実行中タスクとして記録
    try {
      await stateManager.addRunningTask(result.taskId, {
        issueNumber,
        title: issue.title,
        pid: result.pid,
        type: 'comment',
        isCompletion: instruction.issue.isCompletion
      });
    } catch (error) {
      logger.error(`コメントタスク ${result.taskId} の状態記録エラー:`, error);
    }

    console.log(`Issue #${issueNumber} のコメントを独立プロセス (${result.taskId}) として開始`);
    console.log(`PID: ${result.pid}`);

  } catch (error) {
    logger.logIssue(issueNumber, 'COMMENT_ERROR', { 
      commentId: commentId,
      message: error.message, 
      stack: error.stack 
    });
    console.error(`Issue #${issueNumber} のコメント処理エラー:`, error.message);
    
    // 1. 実行中タスクから削除
    try {
      await stateManager.removeRunningTask(taskId);
      console.log(`✅ コメントタスク ${taskId} を実行中リストから削除`);
    } catch (cleanupError) {
      logger.error(`コメントタスク ${taskId} のクリーンアップエラー:`, cleanupError);
    }
    
    // 2. 独立プロセスの停止確認
    const pid = error.result?.pid || error.pid;
    if (pid) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`🛑 PID ${pid} のプロセスを停止しました`);
      } catch (killError) {
        if (killError.code !== 'ESRCH') {
          logger.error(`プロセス ${pid} の停止エラー:`, killError);
        }
      }
    }
    
    // エラー時はawaiting-responseに戻す
    await statusManager.checkin(issueNumber, 'awaiting-response', {
      error: error.message,
      taskType: 'comment-response'
    });
  }
}

/**
 * コメントをチェック
 */
async function checkComments() {
  if (!config.commentHandling || !config.commentHandling.enabled) {
    return;
  }

  try {
    // awaiting-responseラベル付きのIssueを取得
    const issues = await github.listIssues({ 
      state: 'open', 
      labels: ['awaiting-response'] 
    });
    
    for (const issue of issues) {
      const comments = await github.listComments(issue.number);
      const processed = processedComments.get(issue.number) || new Set();
      
      // 新規コメントをチェック
      for (const comment of comments) {
        // IDフィールドがない場合はcreatedAtとauthorでユニークIDを生成
        const commentId = comment.id || `${comment.createdAt}-${comment.author.login}`;
        
        if (!processed.has(commentId) && shouldProcessComment(issue, comment)) {
          // 処理対象のコメントを発見
          console.log(`新規コメントを検出: Issue #${issue.number}, Comment: ${commentId}`);
          
          // 処理済みとして記録
          if (!processedComments.has(issue.number)) {
            processedComments.set(issue.number, new Set());
          }
          processedComments.get(issue.number).add(commentId);
          try {
            await stateManager.saveProcessedComments(processedComments);
          } catch (error) {
            logger.error(`Issue #${issue.number} のコメント状態保存エラー:`, error);
          }
          
          // コメントをタスクキューに追加
          try {
            const taskId = taskQueue.enqueue({
              type: 'comment',
              issue: issue,
              comment: { ...comment, id: commentId },
              issueNumber: issue.number,
              labels: issue.labels.map(l => l.name)
            });
            console.log(`💬 Issue #${issue.number} のコメントをキューに追加 (タスクID: ${taskId})`);
          } catch (error) {
            console.error(`コメントのキュー追加エラー:`, error.message);
          }
        }
      }
    }
  } catch (error) {
    console.error('コメントチェックエラー:', error.message);
  }
}

/**
 * タスクキューからタスクを処理
 */
async function processQueuedTasks() {
  // 最大1つの新規Issueのみ処理（既存の制限を維持）
  let newIssueProcessed = false;
  
  while (taskQueue.canExecute() && taskQueue.getQueueSize() > 0) {
    const task = taskQueue.dequeue();
    if (!task) break;
    
    // 新規Issueの場合は1つまで
    if (task.type === 'issue' && newIssueProcessed) {
      // キューに戻す
      taskQueue.enqueue(task);
      break;
    }
    
    // レート制限チェック
    const rateLimitStatus = await rateLimiter.isRateLimited();
    if (rateLimitStatus.limited) {
      // レート制限中はタスクをキューに戻す
      taskQueue.enqueue(task);
      console.log(`⏸️  レート制限中: ${rateLimitStatus.api} API`);
      break;
    }
    
    // タスク実行開始
    taskQueue.startTask(task.id, { type: task.type, issueNumber: task.issueNumber });
    
    try {
      if (task.type === 'issue') {
        await processIssue(task.issue);
        newIssueProcessed = true;
        taskQueue.completeTask(task.id, true);
        rateLimiter.resetRetryState(task.id);
      } else if (task.type === 'comment') {
        await processComment(task.issue, task.comment);
        taskQueue.completeTask(task.id, true);
        rateLimiter.resetRetryState(task.id);
      }
    } catch (error) {
      console.error(`タスク ${task.id} エラー:`, error.message);
      taskQueue.completeTask(task.id, false);
      
      // リトライ判定
      await handleTaskError(task, error);
    }
  }
}

/**
 * タスクエラーのハンドリング
 */
async function handleTaskError(task, error) {
  // レート制限エラーの場合
  if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
    try {
      await rateLimiter.waitWithBackoff(task.id, 'rate limit error');
      // リトライのためタスクを再キュー
      task.attempts = (task.attempts || 0) + 1;
      if (task.attempts <= 5) {
        taskQueue.enqueue(task);
      }
    } catch (retryError) {
      console.error(`タスク ${task.id} の最大リトライ回数に到達`);
    }
  }
}

/**
 * 完了したタスクをチェック
 */
async function checkCompletedTasks() {
  try {
    const completedResults = await processManager.pollCompletedTasks();
    
    for (const result of completedResults || []) {
      console.log(`🎯 完了タスク ${result.taskId} の後処理開始`);
      
      // 実行中タスクから削除
      try {
        await stateManager.removeRunningTask(result.taskId);
      } catch (error) {
        logger.error(`タスク ${result.taskId} の削除エラー:`, error);
      }
      
      // GitHubコメント投稿
      const issueNumber = result.taskInfo.issueNumber;
      if (issueNumber && result.success) {
        const comment = `## 実行完了\n\n${result.output}`;
        await github.addComment(issueNumber, comment);
        
        // StatusManagerで完了状態に更新
        const finalStatus = (config.commentHandling && config.commentHandling.enabled) 
          ? 'awaiting-response' 
          : 'completed';
        
        await statusManager.checkin(issueNumber, finalStatus, {
          taskId: result.taskId,
          duration: result.duration,
          taskType: result.taskInfo.type
        });
        logger.logIssue(issueNumber, 'TASK_COMPLETED', { status: finalStatus });
        
        console.log(`✅ Issue #${issueNumber} の後処理完了`);
        
        // タスクタイプに応じた後処理
        if (result.taskInfo.type === 'comment') {
          // コメント処理の場合は完了判定を行う
          const isCompletion = result.taskInfo.isCompletion || false;
          
          if (isCompletion) {
            // 完了キーワードが含まれている場合
            await statusManager.updateStatus(issueNumber, 'completed', {
              reason: 'completion_keyword',
              taskId: result.taskId
            });
            logger.logIssue(issueNumber, 'COMMENT_COMPLETED', { 
              reason: 'completion_keyword' 
            });
            console.log(`Issue #${issueNumber} のコメント処理完了（完了キーワード検出）`);
          } else {
            // 続けて対話する場合（すでにawaiting-responseステータスで更新されているはず）
            logger.logIssue(issueNumber, 'COMMENT_AWAITING', { 
              commentCount: 1 
            });
            console.log(`Issue #${issueNumber} のコメント処理完了（応答待ち）`);
          }
        }
      } else if (issueNumber && !result.success) {
        // エラー時の処理
        const errorComment = `## エラーが発生しました\n\n\`\`\`\n${result.error}\n\`\`\`\n\n詳細なログは確認してください。`;
        await github.addComment(issueNumber, errorComment);
        await statusManager.resetIssueStatus(issueNumber);
        
        console.log(`❌ Issue #${issueNumber} でエラーが発生`);
      }
    }
  } catch (error) {
    console.error('完了タスクチェックエラー:', error.message);
  }
}

/**
 * 既存のrunning-tasksファイルをマイグレート
 */
async function migrateRunningTasks() {
  const oldPath = path.join(__dirname, '../logs/running-tasks.json');
  const newPath = path.join(__dirname, '../state/running-tasks.json');
  
  try {
    // 古いファイルが存在し、新しいファイルが存在しない場合のみマイグレート
    if (fs.existsSync(oldPath)) {
      const oldData = fs.readFileSync(oldPath, 'utf8');
      const tasks = JSON.parse(oldData);
      
      // 新しいファイルが存在しない場合のみマイグレート
      if (!fs.existsSync(newPath)) {
        console.log('📦 既存のrunning-tasksをstate/ディレクトリにマイグレート中...');
        await stateManager.saveRunningTasks(tasks);
        console.log('✅ マイグレーション完了');
      }
      
      // 古いファイルをリネーム（バックアップとして保持）
      const backupPath = oldPath + '.migrated-' + new Date().toISOString().replace(/:/g, '-');
      fs.renameSync(oldPath, backupPath);
      console.log(`📁 古いファイルを ${path.basename(backupPath)} として保存`);
    }
  } catch (error) {
    console.error('マイグレーションエラー:', error.message);
    // マイグレーションエラーは致命的ではないので続行
  }
}

/**
 * クリーンアップ処理
 */
async function cleanup() {
  try {
    // タスクキューの永続化
    const pendingTasks = taskQueue.getAllPendingTasks();
    if (pendingTasks.length > 0) {
      console.log(`📦 ${pendingTasks.length}個の保留中タスクを保存中...`);
      await stateManager.savePendingTasks(pendingTasks);
    }
    
    // MirinOrphanManagerを停止
    mirinManager.stop();
    
    // プロセスロックの解放
    await stateManager.releaseProcessLock();
    console.log('🔓 プロセスロックを解放しました');
  } catch (error) {
    console.error('クリーンアップエラー:', error.message);
  }
}

/**
 * シグナルハンドラー設定
 */
function setupSignalHandlers() {
  const signals = ['SIGINT', 'SIGTERM', 'SIGHUP'];
  
  signals.forEach(signal => {
    process.on(signal, async () => {
      console.log(`\n${signal}を受信しました。クリーンアップ中...`);
      await cleanup();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  });
  
  process.on('uncaughtException', async (error) => {
    console.error('予期しないエラー:', error);
    logger.error('uncaughtException', error);
    await cleanup();
    process.exit(1);
  });
  
  process.on('unhandledRejection', async (reason, promise) => {
    console.error('未処理のPromise拒否:', reason);
    logger.error('unhandledRejection', { reason, promise });
    await cleanup();
    process.exit(1);
  });
}

/**
 * すべての永続化ファイルをリセット
 */
async function resetAllStateFiles() {
  console.log('📄 永続化ファイルをリセット中...');
  
  try {
    // 処理済みIssueをリセット
    await stateManager.saveProcessedIssues(new Set());
    console.log('  ✅ processed-issues.json をリセット');
    
    // 処理済みコメントをリセット（必要に応じて）
    await stateManager.saveProcessedComments(new Map());
    console.log('  ✅ processed-comments.json をリセット');
    
    // Issue状態をリセット（StatusManager経由）
    if (statusManager && statusManager.state && statusManager.state.issues) {
      const issueNumbers = Object.keys(statusManager.state.issues);
      for (const issueNumber of issueNumbers) {
        await statusManager.resetIssueStatus(parseInt(issueNumber));
      }
      console.log(`  ✅ issue-status.json をリセット (${issueNumbers.length}件のIssue)`);
    }
    
    // 保留中タスクをリセット
    await stateManager.savePendingTasks([]);
    console.log('  ✅ pending-tasks.json をリセット');
    
    // 実行中タスクをリセット（注意: 実行中のプロセスがある場合は問題が起きる可能性）
    const runningTasks = await stateManager.loadRunningTasks();
    if (Object.keys(runningTasks).length > 0) {
      console.log('  ⚠️  実行中のタスクが存在します。リセットによりこれらのタスクの状態が不整合になる可能性があります。');
      console.log('  実行中のタスク:', Object.keys(runningTasks));
    }
    // 注意: running-tasks.json はプロセスマネージャが管理しているため、ここではリセットしない
    
    console.log('\n📊 リセット結果:');
    console.log('  - processed-issues.json: 空の配列 []');
    console.log('  - processed-comments.json: 空のオブジェクト {}');
    console.log('  - issue-status.json: すべてのIssueステータスをクリア');
    console.log('  - pending-tasks.json: 空の配列 []');
    console.log('  - running-tasks.json: 変更なし（実行中のプロセスを保護）');
    
  } catch (error) {
    console.error('❌ リセット中にエラーが発生しました:', error.message);
    throw error;
  }
}

/**
 * メイン処理（1回実行）
 */
async function main() {
  console.log('PoppoBuilder Cron実行開始');
  
  // コマンドラインオプションの処理
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
PoppoBuilder Cron - 使用方法

オプション:
  --reset-state       すべての永続化情報をリセット
  --reset-processed   processed-issues.jsonのみリセット
  --sync-github       GitHubのラベル状態と同期（未実装）
  --help, -h          このヘルプを表示

例:
  node minimal-poppo-cron.js --reset-state
  node minimal-poppo-cron.js --reset-processed
`);
    process.exit(0);
  }

  // シグナルハンドラーの設定
  setupSignalHandlers();
  
  try {
    // 状態管理の初期化
    console.log('📋 状態管理システムを初期化中...');
    try {
      await stateManager.init();
      await statusManager.initialize();
      await mirinManager.initialize();
      console.log('✅ 初期化完了');
    } catch (error) {
      console.error('初期化エラー:', error.message);
      logger.error('初期化に失敗しました', error);
      process.exit(1);
    }

    // リセットオプションの処理
    if (process.argv.includes('--reset-state')) {
      console.log('🔄 すべての永続化情報をリセット中...');
      await resetAllStateFiles();
      console.log('✅ リセット完了');
      process.exit(0);
    } else if (process.argv.includes('--reset-processed')) {
      console.log('🔄 処理済みIssue情報をリセット中...');
      await stateManager.saveProcessedIssues(new Set());
      console.log('✅ processed-issues.jsonをリセットしました');
      process.exit(0);
    } else if (process.argv.includes('--sync-github')) {
      console.log('⚠️  --sync-githubオプションは未実装です');
      console.log('   将来的にGitHubラベルとの同期機能を実装予定です');
      process.exit(1);
    }
    
    // MirinOrphanManagerを開始
    mirinManager.start();
    logger.info('MirinOrphanManagerの監視を開始しました');
    
    // プロセスレベルのロック取得
    console.log('🔒 プロセスロックを取得中...');
    const lockAcquired = await stateManager.acquireProcessLock();
    if (!lockAcquired) {
      console.log('⚠️  別のPoppoBuilderプロセスが実行中です');
      process.exit(0);
    }
    console.log('✅ プロセスロックを取得しました');
    
    // 既存のrunning-tasksファイルのマイグレーション
    await migrateRunningTasks();
    
    // 状態の読み込み
    processedIssues = await stateManager.loadProcessedIssues();
    processedComments = await stateManager.loadProcessedComments();
    
    // 保留中タスクの復元
    const pendingTasks = await stateManager.loadPendingTasks();
    if (pendingTasks.length > 0) {
      console.log(`📥 ${pendingTasks.length}個の保留中タスクを復元中...`);
      taskQueue.restoreTasks(pendingTasks);
    }
    
    // 古い実行中タスクのクリーンアップ
    await stateManager.cleanupStaleRunningTasks();
    
    // 設定階層情報を表示
    configLoader.displayConfigHierarchy();
    
    console.log(`設定: ${JSON.stringify(config, null, 2)}\n`);
    
    // 2段階処理システムを初期化
    if (config.twoStageProcessing?.enabled) {
      await twoStageProcessor.init();
      logger.info('2段階処理システムを初期化しました');
    }
    
    // レート制限の初期チェック
    await rateLimiter.preflightCheck();
    
    // レート制限チェック
    const rateLimitStatus = await rateLimiter.isRateLimited();
    if (rateLimitStatus.limited) {
      const waitSeconds = Math.ceil(rateLimitStatus.waitTime / 1000);
      console.log(`⚠️  ${rateLimitStatus.api.toUpperCase()} APIレート制限中... 残り${waitSeconds}秒`);
      process.exit(0);
    }

    // Issue取得
    console.log('📋 GitHub から Issue を取得中...');
    const issues = await github.listIssues({ state: 'open' });
    console.log(`✅ ${issues.length} 件の Open Issue を取得しました`);
    
    // 処理対象のIssueを抽出
    console.log('🔍 処理対象の Issue をフィルタリング中...');
    const targetIssues = issues.filter(shouldProcessIssue);
    
    if (targetIssues.length === 0) {
      console.log('ℹ️  処理対象のIssueはありません');
    } else {
      console.log(`${targetIssues.length}件のIssueが見つかりました`);
      
      // 古い順に処理
      targetIssues.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );

      // Issueをタスクキューに追加
      for (const issue of targetIssues) {
        try {
          const taskId = taskQueue.enqueue({
            type: 'issue',
            issue: issue,
            issueNumber: issue.number,
            labels: issue.labels.map(l => l.name)
          });
          console.log(`📋 Issue #${issue.number} をキューに追加 (タスクID: ${taskId})`);
        } catch (error) {
          console.error(`Issue #${issue.number} のキュー追加エラー:`, error.message);
        }
      }
    }

    // コメント処理（コメント対応機能が有効な場合）
    await checkComments();
    
    // キューからタスクを処理
    await processQueuedTasks();
    
    // 完了したタスクをポーリングチェック
    await checkCompletedTasks();
    
    // キューの状態を表示
    const queueStatus = taskQueue.getStatus();
    if (queueStatus.queued > 0 || queueStatus.running > 0) {
      console.log(`📊 キュー状態: 実行中=${queueStatus.running}, 待機中=${queueStatus.queued}`);
      console.log(`   優先度別: ${JSON.stringify(queueStatus.queuesByPriority)}`);
    }
    
    // 最終実行情報を保存
    try {
      await stateManager.saveLastRun({
        issuesChecked: issues.length,
        issuesProcessed: targetIssues.length,
        queueStatus: queueStatus
      });
    } catch (error) {
      logger.error('最終実行情報の保存エラー:', error);
    }
    
    console.log('\nPoppoBuilder Cron実行完了');
    
  } catch (error) {
    console.error('メイン処理エラー:', error.message);
    logger.error('Cron実行エラー:', error);
  } finally {
    // 必ずクリーンアップを実行
    await cleanup();
  }
  
  // プロセス終了
  process.exit(0);
}

// 開始
main().catch(console.error);