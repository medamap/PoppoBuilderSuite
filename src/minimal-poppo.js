#!/usr/bin/env node

// プロセス名を設定（psコマンドで識別しやすくするため）
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
const i18n = require('../lib/i18n');

// ConfigLoaderで階層的に設定を読み込み
const configLoader = new ConfigLoader();
const poppoConfig = configLoader.loadConfig();

// Initialize i18n
(async () => {
  await i18n.init({ language: poppoConfig.language?.primary || 'en' });
})();

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
  },
  notifications: {
    ...mainConfig.notifications,
    ...(poppoConfig.notifications || {})
  }
};

// インスタンス作成
const logger = new Logger();
const github = new GitHubClient(config.github);
const rateLimiter = new EnhancedRateLimiter(config.rateLimiting || {});
const taskQueue = new TaskQueue({ 
  maxConcurrent: config.claude.maxConcurrent,
  maxQueueSize: config.taskQueue?.maxQueueSize || 100 
});
// 独立プロセス方式を使用（PoppoBuilder再起動時もタスクが継続）
const processManager = new IndependentProcessManager(config.claude, rateLimiter, logger);

// ダッシュボードサーバーの初期化（独立プロセス方式では簡易的に動作）
const dashboardServer = new DashboardServer(config, null, logger);

// 処理済みIssueを記録（メモリ内）
const processedIssues = new Set();

// 処理済みコメントを記録（メモリ内）
const processedComments = new Map(); // issueNumber -> Set(commentIds)

// タスクキューイベントハンドラー
taskQueue.on('taskEnqueued', (task) => {
  logger.logSystem('QUEUE_ENQUEUED', { taskId: task.id, priority: task.priority });
});

taskQueue.on('taskStarted', ({ taskId, processInfo }) => {
  logger.logSystem('QUEUE_TASK_STARTED', { taskId, processInfo });
});

taskQueue.on('taskCompleted', ({ taskId, success, duration }) => {
  logger.logSystem('QUEUE_TASK_COMPLETED', { taskId, success, duration });
});

/**
 * Issueが処理対象かチェック
 */
function shouldProcessIssue(issue) {
  // すでに処理済み
  if (processedIssues.has(issue.number)) {
    return false;
  }

  // 作者のIssueかチェック
  if (issue.author.login !== config.github.owner) {
    return false;
  }

  // ラベルチェック
  const labels = issue.labels.map(l => l.name);
  
  // task:misc または task:dogfooding ラベルが必要
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
 * Issueを処理
 */
async function processIssue(issue) {
  const issueNumber = issue.number;
  logger.logIssue(issueNumber, 'START', { title: issue.title, labels: issue.labels });
  console.log(`\n${i18n.t('issue.processing', { number: issueNumber, title: issue.title })}`);

  // 処理開始前に処理済みとして記録（二重起動防止）
  processedIssues.add(issueNumber);

  try {
    // processingラベルを追加
    await github.addLabels(issueNumber, ['processing']);
    logger.logIssue(issueNumber, 'LABEL_ADDED', { label: 'processing' });

    // ラベル取得
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
    logger.logIssue(issueNumber, 'EXECUTE_START', { instruction });
    
    // dogfoodingかどうかを判定
    const isDogfooding = labels.includes('task:dogfooding');
    instruction.issue.type = isDogfooding ? 'dogfooding' : 'normal';
    
    const result = await processManager.execute(`issue-${issueNumber}`, instruction);
    logger.logIssue(issueNumber, 'INDEPENDENT_STARTED', { 
      taskId: result.taskId,
      pid: result.pid 
    });

    console.log(`Issue #${issueNumber} を独立プロセス (${result.taskId}) として開始`);
    console.log(`PID: ${result.pid} - PoppoBuilder再起動時も継続実行されます`);
    
    // 注意: 結果の処理は checkCompletedTasks() で非同期に行われる

  } catch (error) {
    logger.logIssue(issueNumber, 'ERROR', { 
      message: error.message, 
      stack: error.stack,
      stdout: error.stdout,
      stderr: error.stderr 
    });
    console.error(`Issue #${issueNumber} の処理エラー:`, error.message);
    
    // より詳細なエラー情報をコメントに含める
    const errorDetails = [
      `## ${i18n.t('labels.execution.error')}`,
      ``,
      `### ${i18n.t('errors.message')}`,
      `\`\`\``,
      error.message || '(エラーメッセージなし)',
      `\`\`\``,
      error.stderr ? `\n### ${i18n.t('errors.stderr')}\n\`\`\`\n${error.stderr}\n\`\`\`` : '',
      error.stdout ? `\n### ${i18n.t('errors.stdout')}\n\`\`\`\n${error.stdout}\n\`\`\`` : '',
      ``,
      i18n.t('errors.detailedLog', { logPath: `logs/issue-${issueNumber}-*.log` })
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
  logger.logIssue(issueNumber, 'COMMENT_START', { 
    commentId: comment.id,
    commentAuthor: comment.author.login 
  });
  console.log(`\n${i18n.t('comment.processing', { number: issueNumber })}`);

  try {
    // awaiting-responseを削除、processingラベルを追加
    await github.removeLabels(issueNumber, ['awaiting-response']);
    await github.addLabels(issueNumber, ['processing']);
    logger.logIssue(issueNumber, 'LABEL_UPDATED', { 
      removed: 'awaiting-response', 
      added: 'processing' 
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
      commentId: comment.id,
      conversationLength: conversation.length 
    });
    
    instruction.issue.type = 'comment';
    instruction.issue.isCompletion = isCompletionComment(comment);
    
    const result = await processManager.execute(`issue-${issueNumber}-comment-${comment.id}`, instruction);
    logger.logIssue(issueNumber, 'COMMENT_INDEPENDENT_STARTED', { 
      taskId: result.taskId,
      pid: result.pid 
    });

    console.log(`Issue #${issueNumber} のコメントを独立プロセス (${result.taskId}) として開始`);
    console.log(`PID: ${result.pid} - PoppoBuilder再起動時も継続実行されます`);
    
    // 注意: 結果の処理は checkCompletedTasks() で非同期に行われる

  } catch (error) {
    logger.logIssue(issueNumber, 'COMMENT_ERROR', { 
      commentId: comment.id,
      message: error.message, 
      stack: error.stack 
    });
    console.error(`Issue #${issueNumber} のコメント処理エラー:`, error.message);
    
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
          console.log(i18n.t('comment.newFound', { number: issue.number, commentId }));
          
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
  while (taskQueue.canExecute() && taskQueue.getQueueSize() > 0) {
    const task = taskQueue.dequeue();
    if (!task) break;
    
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
        processIssue(task.issue).then(() => {
          taskQueue.completeTask(task.id, true);
          rateLimiter.resetRetryState(task.id);
        }).catch((error) => {
          console.error(`タスク ${task.id} エラー:`, error.message);
          taskQueue.completeTask(task.id, false);
          
          // リトライ判定
          handleTaskError(task, error);
        });
      } else if (task.type === 'comment') {
        processComment(task.issue, task.comment).then(() => {
          taskQueue.completeTask(task.id, true);
          rateLimiter.resetRetryState(task.id);
        }).catch((error) => {
          console.error(`コメントタスク ${task.id} エラー:`, error.message);
          taskQueue.completeTask(task.id, false);
          
          // リトライ判定
          handleTaskError(task, error);
        });
      }
    } catch (error) {
      console.error(`タスク処理エラー:`, error.message);
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
      console.error(`タスク ${task.id} の最大リトライ回数に到達`);
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
      console.log(`🎯 完了タスク ${result.taskId} の後処理開始`);
      
      // GitHubコメント投稿
      const issueNumber = result.taskInfo.issueNumber;
      if (issueNumber && result.success) {
        const comment = `## ${i18n.t('labels.execution.completed')}\n\n${result.output}`;
        await github.addComment(issueNumber, comment);
        
        // ラベル更新
        await github.removeLabels(issueNumber, ['processing']);
        
        if (config.commentHandling && config.commentHandling.enabled) {
          await github.addLabels(issueNumber, ['awaiting-response']);
          logger.logIssue(issueNumber, 'LABEL_ADDED', { label: 'awaiting-response' });
        } else {
          await github.addLabels(issueNumber, ['completed']);
          logger.logIssue(issueNumber, 'LABEL_ADDED', { label: 'completed' });
        }
        
        console.log(`✅ Issue #${issueNumber} の後処理完了`);
        
        // タスクタイプに応じた後処理
        if (result.taskInfo.type === 'dogfooding') {
          console.log('🔧 DOGFOODINGタスク完了 - 30秒後に再起動をスケジュール...');
          
          try {
            const { spawn } = require('child_process');
            const child = spawn('node', ['scripts/restart-scheduler.js', '--oneshot', '30'], {
              detached: true,
              stdio: 'ignore',
              cwd: process.cwd()
            });
            child.unref();
            
            console.log('再起動スケジューラーを起動しました (PID: ' + child.pid + ')');
          } catch (error) {
            console.error('再起動スケジューラー起動エラー:', error.message);
          }
        } else if (result.taskInfo.type === 'comment') {
          // コメント処理の場合は完了判定を行う
          const isCompletion = result.taskInfo.isCompletion || false;
          
          if (isCompletion) {
            // 完了キーワードが含まれている場合
            await github.addLabels(issueNumber, ['completed']);
            logger.logIssue(issueNumber, 'COMMENT_COMPLETED', { 
              reason: 'completion_keyword' 
            });
            console.log(`Issue #${issueNumber} のコメント処理完了（完了キーワード検出）`);
          } else {
            // 続けて対話する場合
            await github.addLabels(issueNumber, ['awaiting-response']);
            logger.logIssue(issueNumber, 'COMMENT_AWAITING', { 
              commentCount: 1 
            });
            console.log(`Issue #${issueNumber} のコメント処理完了（応答待ち）`);
          }
        }
      } else if (issueNumber && !result.success) {
        // エラー時の処理
        const errorComment = `## ${i18n.t('labels.execution.error')}\n\n\`\`\`\n${result.error}\n\`\`\`\n\n${i18n.t('errors.detailedLog', { logPath: 'logs/*.log' })}`;
        await github.addComment(issueNumber, errorComment);
        await github.removeLabels(issueNumber, ['processing']);
        
        console.log(`❌ Issue #${issueNumber} でエラーが発生`);
      }
    }
  } catch (error) {
    console.error('完了タスクチェックエラー:', error.message);
  }
}

/**
 * メインループ
 */
async function mainLoop() {
  console.log(i18n.t('system.starting'));
  
  // 設定階層情報を表示
  configLoader.displayConfigHierarchy();
  
  console.log(`設定: ${JSON.stringify(config, null, 2)}\n`);
  
  // 独立プロセス方式の状態表示
  console.log(i18n.t('system.independentProcess.enabled'));
  
  if (config.dynamicTimeout?.enabled) {
    console.log(i18n.t('system.dynamicTimeout.enabled'));
  } else {
    console.log(i18n.t('system.dynamicTimeout.disabled'));
  }
  
  // レート制限の初期チェック
  await rateLimiter.preflightCheck();

  while (true) {
    try {
      // レート制限チェック
      const rateLimitStatus = await rateLimiter.isRateLimited();
      if (rateLimitStatus.limited) {
        const waitSeconds = Math.ceil(rateLimitStatus.waitTime / 1000);
        console.log(`⚠️  ${rateLimitStatus.api.toUpperCase()} APIレート制限中... 残り${waitSeconds}秒`);
        await rateLimiter.waitForReset();
        continue;
      }

      // Issue取得
      console.log(i18n.t('system.checkingIssues'));
      const issues = await github.listIssues({ state: 'open' });
      
      // 処理対象のIssueを抽出
      const targetIssues = issues.filter(shouldProcessIssue);
      
      if (targetIssues.length === 0) {
        console.log(i18n.t('issue.noTarget'));
      } else {
        console.log(i18n.t('issue.found', { count: targetIssues.length }));
        
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
            console.log(`📋 ${i18n.t('issue.addedToQueue', { number: issue.number, taskId })}`);
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
        console.log(`📊 ${i18n.t('queue.status', { running: queueStatus.running, queued: queueStatus.queued })}`);
        console.log(`   ${i18n.t('queue.priority', { priorities: JSON.stringify(queueStatus.queuesByPriority) })}`);
      }

    } catch (error) {
      console.error('メインループエラー:', error.message);
    }

    // ポーリング間隔待機
    console.log(`\n${i18n.t('system.waitingNext', { seconds: config.polling.interval / 1000 })}`);
    await new Promise(resolve => setTimeout(resolve, config.polling.interval));
  }
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log(`\n\n${i18n.t('system.shutdown')}`);
  processManager.killAll();
  dashboardServer.stop();
  process.exit(0);
});

// ダッシュボードサーバーを起動
dashboardServer.start();

// 開始
mainLoop().catch(console.error);