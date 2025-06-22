#!/usr/bin/env node

// Set process name for easy identification in ps command
process.title = 'PoppoBuilder-Main';

const fs = require('fs');
const path = require('path');
const GitHubClient = require('./github-client');
const ProcessManager = require('./process-manager');
const IndependentProcessManager = require('./independent-process-manager');
const EnhancedRateLimiter = require('./enhanced-rate-limiter');
const TaskQueue = require('./task-queue');
const Logger = require('./logger');
const ConfigLoader = require('./config-loader');
const RestartScheduler = require('../scripts/restart-scheduler');
const DashboardServer = require('../dashboard/server/index');
const { initI18n, t } = require('../lib/i18n');
const I18nLogger = require('../lib/utils/i18n-logger');
const MemoryManager = require('./memory-manager');

// Load hierarchical configuration using ConfigLoader
const configLoader = new ConfigLoader();
const poppoConfig = configLoader.loadConfig();

// Initialize i18n will be done in main function
let i18n;

// Also load main config file (for backward compatibility)
const mainConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8')
);

// Merge configurations (main config as base, overridden by PoppoConfig settings)
const config = {
  ...mainConfig,
  language: poppoConfig.language || mainConfig.language,
  systemPrompt: poppoConfig.systemPrompt || mainConfig.systemPrompt,
  // Items that can be overridden by environment variables or project settings
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
  },
  notifications: {
    ...mainConfig.notifications,
    ...(poppoConfig.notifications || {})
  }
};

// Create instances
const baseLogger = new Logger();
const logger = I18nLogger.wrap(baseLogger);
const github = new GitHubClient(config.github);
const rateLimiter = new EnhancedRateLimiter(config.rateLimiting || {});
const taskQueue = new TaskQueue({ 
  maxConcurrent: config.claude.maxConcurrent,
  maxQueueSize: config.taskQueue?.maxQueueSize || 100 
});
// Use independent process approach (tasks continue even after PoppoBuilder restart)
const processManager = new IndependentProcessManager(config.claude, rateLimiter, logger);

// Initialize dashboard server (operates simply with independent process approach)
const dashboardServer = new DashboardServer(config, null, logger);

// Initialize memory manager
const memoryManager = new MemoryManager(config.memoryManagement || {
  enabled: true,
  checkInterval: 60000,
  memoryThreshold: 500,
  autoRecoveryEnabled: true,
  heapSnapshotEnabled: false
}, logger);

// Record processed issues (in memory)
const processedIssues = new Set();

// Record processed comments (in memory)
const processedComments = new Map(); // issueNumber -> Set(commentIds)

// Task queue event handlers
taskQueue.on('taskEnqueued', async (task) => {
  await logger.logSystem('queue_enqueued', { taskId: task.id, priority: task.priority });
});

taskQueue.on('taskStarted', async ({ taskId, processInfo }) => {
  await logger.logSystem('queue_task_started', { taskId, processInfo });
});

taskQueue.on('taskCompleted', async ({ taskId, success, duration }) => {
  if (success) {
    await logger.logSystem('queue_task_completed', { taskId, success, duration });
  } else {
    await logger.logSystem('queue_task_failed', { taskId });
  }
});

// Memory manager event handlers
memoryManager.on('memoryPressure', ({ memoryData, reasons }) => {
  logger.logSystem('memory_pressure', { 
    heapUsedMB: Math.round(memoryData.process.heapUsed / 1024 / 1024),
    systemUsage: Math.round(memoryData.system.percentage),
    reasons 
  });
});

memoryManager.on('memoryLeak', (activity) => {
  logger.logSystem('memory_leak_detected', activity);
});

memoryManager.on('gc', (gcResult) => {
  logger.logSystem('garbage_collection', {
    freedMB: Math.round(gcResult.freedMB),
    duration: gcResult.duration
  });
});

memoryManager.on('clearCaches', () => {
  // Clear internal caches when memory pressure is detected
  processedIssues.clear();
  processedComments.clear();
  logger.logSystem('caches_cleared', { reason: 'memory_pressure' });
});

/**
 * Check if issue should be processed
 */
function shouldProcessIssue(issue) {
  // Already processed
  if (processedIssues.has(issue.number)) {
    return false;
  }

  // Check if issue is by the author
  if (issue.author.login !== config.github.owner) {
    return false;
  }

  // Label check
  const labels = issue.labels.map(l => l.name);
  
  // Requires task:misc or task:dogfooding label
  if (!labels.includes('task:misc') && !labels.includes('task:dogfooding')) {
    return false;
  }

  // completed, processing, awaiting-responseラベルがあればスキップ
  if (labels.includes('completed') || labels.includes('processing') || labels.includes('awaiting-response')) {
    return false;
  }

  return true;
}

/**
 * Process issue
 */
async function processIssue(issue) {
  const issueNumber = issue.number;
  await logger.logIssue(issueNumber, 'processing', { number: issueNumber, title: issue.title });
  console.log(`\n${t('messages:issue.processing', { number: issueNumber, title: issue.title })}`);

  // Record as processed before starting (prevent duplicate execution)
  processedIssues.add(issueNumber);

  try {
    // Add processing label
    await github.addLabels(issueNumber, ['processing']);

    // Get labels
    const labels = issue.labels.map(l => l.name);
    
    // 言語設定読み込み
    const poppoConfig = configLoader.loadConfig();
    
    // Claude用の指示を作成
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
    
    // dogfoodingかどうかを判定
    const isDogfooding = labels.includes('task:dogfooding');
    instruction.issue.type = isDogfooding ? 'dogfooding' : 'normal';
    
    const result = await processManager.execute(`issue-${issueNumber}`, instruction);
    await logger.logProcess(result.pid, 'started', { pid: result.pid });

    console.log(t('messages:issue.processing', { number: issueNumber, title: issue.title }));
    console.log(`PID: ${result.pid}`);
    
    // 注意: 結果の処理は checkCompletedTasks() で非同期に行われる

  } catch (error) {
    await logger.logIssue(issueNumber, 'failed', { 
      number: issueNumber,
      error: error.message
    });
    console.error(t('messages:issue.failed', { number: issueNumber, error: error.message }));
    
    // より詳細なエラー情報をコメントに含める
    const errorDetails = [
      `## ${t('labels.execution.error')}`,
      ``,
      `### ${t('errors.message')}`,
      `\`\`\``,
      error.message || '(エラーメッセージなし)',
      `\`\`\``,
      error.stderr ? `\n### ${t('errors.stderr')}\n\`\`\`\n${error.stderr}\n\`\`\`` : '',
      error.stdout ? `\n### ${t('errors.stdout')}\n\`\`\`\n${error.stdout}\n\`\`\`` : '',
      ``,
      t('errors.detailedLog', { logPath: `logs/issue-${issueNumber}-*.log` })
    ].filter(Boolean).join('\n');
    
    await github.addComment(issueNumber, errorDetails);
    
    // processingラベルを削除（エラー時は処理済みリストから削除して再試行可能に）
    await github.removeLabels(issueNumber, ['processing']);
    processedIssues.delete(issueNumber);
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
  
  // コメント履歴を時系列で追加（PoppoBuilderのコメントと作成者のコメントを分離）
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
  console.log(`\n${t('messages:issue.processing', { number: issueNumber })}`);

  try {
    // awaiting-responseを削除、processingラベルを追加
    await github.removeLabels(issueNumber, ['awaiting-response']);
    await github.addLabels(issueNumber, ['processing']);

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
    
    instruction.issue.type = 'comment';
    instruction.issue.isCompletion = isCompletionComment(comment);
    
    const result = await processManager.execute(`issue-${issueNumber}-comment-${comment.id}`, instruction);
    await logger.logProcess(result.pid, 'started', { pid: result.pid });

    console.log(t('messages:issue.processing', { number: issueNumber }));
    console.log(`PID: ${result.pid}`);
    
    // 注意: 結果の処理は checkCompletedTasks() で非同期に行われる

  } catch (error) {
    await logger.logIssue(issueNumber, 'failed', { 
      number: issueNumber,
      error: error.message
    });
    console.error(t('messages:issue.failed', { number: issueNumber, error: error.message }));
    
    // エラー時はawaiting-responseに戻す
    await github.removeLabels(issueNumber, ['processing']);
    await github.addLabels(issueNumber, ['awaiting-response']);
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
          console.log(t('messages:issue.processing', { number: issue.number }));
          
          // 処理済みとして記録
          if (!processedComments.has(issue.number)) {
            processedComments.set(issue.number, new Set());
          }
          processedComments.get(issue.number).add(commentId);
          
          // コメントをタスクキューに追加
          try {
            const taskId = taskQueue.enqueue({
              type: 'comment',
              issue: issue,
              comment: { ...comment, id: commentId },
              issueNumber: issue.number,
              labels: issue.labels.map(l => l.name)
            });
            console.log(t('messages:task.created', { id: taskId }));
          } catch (error) {
            console.error(t('messages:task.failed', { id: 'comment', error: error.message }));
          }
        }
      }
    }
  } catch (error) {
    console.error(t('messages:system.error', { error: error.message }));
  }
}

/**
 * タスクキューからタスクを処理
 */
async function processQueuedTasks() {
  while (taskQueue.canExecute() && taskQueue.getQueueSize() > 0) {
    const task = taskQueue.dequeue();
    if (!task) break;
    
    // レート制限チェック
    const rateLimitStatus = await rateLimiter.isRateLimited();
    if (rateLimitStatus.limited) {
      // レート制限中はタスクをキューに戻す
      taskQueue.enqueue(task);
      console.log(t('messages:github.rateLimit', { api: rateLimitStatus.api }));
      break;
    }
    
    // タスク実行開始
    taskQueue.startTask(task.id, { type: task.type, issueNumber: task.issueNumber });
    
    try {
      if (task.type === 'issue') {
        processIssue(task.issue).then(() => {
          taskQueue.completeTask(task.id, true);
          rateLimiter.resetRetryState(task.id);
        }).catch((error) => {
          console.error(t('messages:task.failed', { id: task.id, error: error.message }));
          taskQueue.completeTask(task.id, false);
          
          // リトライ判定
          handleTaskError(task, error);
        });
      } else if (task.type === 'comment') {
        processComment(task.issue, task.comment).then(() => {
          taskQueue.completeTask(task.id, true);
          rateLimiter.resetRetryState(task.id);
        }).catch((error) => {
          console.error(t('messages:task.failed', { id: task.id, error: error.message }));
          taskQueue.completeTask(task.id, false);
          
          // リトライ判定
          handleTaskError(task, error);
        });
      }
    } catch (error) {
      console.error(t('messages:task.failed', { id: 'unknown', error: error.message }));
      taskQueue.completeTask(task.id, false);
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
      console.error(t('messages:task.failed', { id: task.id, error: '最大リトライ回数に到達' }));
    }
  }
}

/**
 * 完了したタスクをチェック（独立プロセス方式）
 */
async function checkCompletedTasks() {
  try {
    const completedResults = await processManager.pollCompletedTasks();
    
    for (const result of completedResults || []) {
      console.log(t('messages:task.completed', { id: result.taskId }));
      
      // GitHubコメント投稿
      const issueNumber = result.taskInfo.issueNumber;
      if (issueNumber && result.success) {
        const comment = `## ${t('labels.execution.completed')}\n\n${result.output}`;
        await github.addComment(issueNumber, comment);
        
        // ラベル更新
        await github.removeLabels(issueNumber, ['processing']);
        
        if (config.commentHandling && config.commentHandling.enabled) {
          await github.addLabels(issueNumber, ['awaiting-response']);
        } else {
          await github.addLabels(issueNumber, ['completed']);
        }
        
        console.log(t('messages:issue.completed', { number: issueNumber }));
        
        // タスクタイプに応じた後処理
        if (result.taskInfo.type === 'dogfooding') {
          console.log(t('messages:task.completed', { id: 'dogfooding' }));
          
          try {
            const { spawn } = require('child_process');
            const child = spawn('node', ['scripts/restart-scheduler.js', '--oneshot', '30'], {
              detached: true,
              stdio: 'ignore',
              cwd: process.cwd()
            });
            child.unref();
            
            console.log(t('messages:process.started', { pid: child.pid }));
          } catch (error) {
            console.error(t('messages:process.failed', { pid: 'scheduler', error: error.message }));
          }
        } else if (result.taskInfo.type === 'comment') {
          // コメント処理の場合は完了判定を行う
          const isCompletion = result.taskInfo.isCompletion || false;
          
          if (isCompletion) {
            // 完了キーワードが含まれている場合
            await github.addLabels(issueNumber, ['completed']);
            console.log(t('messages:issue.completed', { number: issueNumber }));
          } else {
            // 続けて対話する場合
            await github.addLabels(issueNumber, ['awaiting-response']);
            console.log(t('messages:issue.completed', { number: issueNumber }));
          }
        }
      } else if (issueNumber && !result.success) {
        // エラー時の処理
        const errorComment = `## ${t('labels.execution.error')}\n\n\`\`\`\n${result.error}\n\`\`\`\n\n${t('errors.detailedLog', { logPath: 'logs/*.log' })}`;
        await github.addComment(issueNumber, errorComment);
        await github.removeLabels(issueNumber, ['processing']);
        
        console.log(t('messages:issue.failed', { number: issueNumber, error: result.error }));
      }
    }
  } catch (error) {
    console.error(t('messages:task.failed', { id: 'completion-check', error: error.message }));
  }
}

/**
 * メインループ
 */
async function mainLoop() {
  // Initialize i18n system first
  try {
    i18n = await initI18n();
    console.log(t('messages:startup.ready'));
  } catch (error) {
    console.error('Failed to initialize i18n:', error.message);
    // Fallback to raw messages
  }

  console.log(t('messages:system.starting'));
  
  // 設定階層情報を表示
  configLoader.displayConfigHierarchy();
  
  console.log(`設定: ${JSON.stringify(config, null, 2)}\n`);
  
  // 独立プロセス方式の状態表示
  console.log(t('messages:system.started'));
  
  // Start memory manager
  await memoryManager.start();
  console.log('Memory manager started');
  
  // レート制限の初期チェック
  await rateLimiter.preflightCheck();

  while (true) {
    try {
      // レート制限チェック
      const rateLimitStatus = await rateLimiter.isRateLimited();
      if (rateLimitStatus.limited) {
        const waitSeconds = Math.ceil(rateLimitStatus.waitTime / 1000);
        console.log(t('messages:github.rateLimit', { 
          remaining: rateLimitStatus.remaining || 0, 
          limit: rateLimitStatus.limit || 'unknown',
          reset: waitSeconds + 's'
        }));
        await rateLimiter.waitForReset();
        continue;
      }

      // Issue取得
      console.log(t('messages:system.processing_issues', { count: 0 }));
      const issues = await github.listIssues({ state: 'open' });
      
      // 処理対象のIssueを抽出
      const targetIssues = issues.filter(shouldProcessIssue);
      
      if (targetIssues.length === 0) {
        console.log(t('messages:system.no_issues_found'));
      } else {
        console.log(t('messages:system.processing_issues', { count: targetIssues.length }));
        
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
            console.log(t('messages:task.created', { id: taskId }));
          } catch (error) {
            console.error(t('messages:issue.failed', { number: issue.number, error: error.message }));
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
        console.log(t('messages:system.processing_issues', { count: queueStatus.running + queueStatus.queued }));
      }

    } catch (error) {
      console.error(t('messages:system.error', { error: error.message }));
    }

    // ポーリング間隔待機
    console.log(`\n${t('messages:system.uptime', { time: config.polling.interval / 1000 + 's' })}`);
    await new Promise(resolve => setTimeout(resolve, config.polling.interval));
  }
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log(`\n\n${t('messages:system.stopping')}`);
  processManager.killAll();
  dashboardServer.stop();
  memoryManager.stop();
  console.log('Memory manager stopped');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log(`\n\n${t('messages:system.stopping')}`);
  processManager.killAll();
  dashboardServer.stop();
  memoryManager.stop();
  console.log('Memory manager stopped');
  process.exit(0);
});

// ダッシュボードサーバーを起動
dashboardServer.start();

// 開始
mainLoop().catch(console.error);