#!/usr/bin/env node

// プロセス名を設定（psコマンドで識別しやすくするため）
process.title = 'PoppoBuilder-Main';

// バージョン表示
if (process.argv.includes('--version') || process.argv.includes('-v')) {
  const packageJson = require('../package.json');
  console.log(`PoppoBuilder Suite v${packageJson.version}`);
  process.exit(0);
}

// ヘルプ表示
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
PoppoBuilder Suite - AI-powered autonomous software development system

使用方法:
  poppo-builder [options]

オプション:
  -v, --version    バージョンを表示
  -h, --help       このヘルプを表示

設定:
  PoppoBuilderは以下の順序で設定を読み込みます：
  1. 環境変数 (POPPO_*)
  2. プロジェクトの .poppo/config.json
  3. グローバル設定 (~/.poppo/config.json)
  4. システムデフォルト

必要な環境変数:
  GITHUB_TOKEN     GitHub APIアクセス用のトークン

詳細情報:
  https://github.com/medamap/PoppoBuilderSuite
`);
  process.exit(0);
}

const fs = require('fs');
const path = require('path');
const GitHubClient = require('./github-client');
const IndependentProcessManager = require('./independent-process-manager');
const EnhancedRateLimiter = require('./enhanced-rate-limiter');
const TaskQueue = require('./task-queue');
const RetryManager = require('./retry-manager');
const Logger = require('./logger');
const ConfigLoader = require('./config-loader');
const ConfigWatcher = require('./config-watcher');
const DashboardServer = require('../dashboard/server/index');
const HealthCheckManager = require('./health-check-manager');
const NotificationManager = require('./notification-manager');
const TwoStageProcessor = require('./two-stage-processor');
const ProcessStateManager = require('./process-state-manager');
const StatusManager = require('./status-manager');
const MirinOrphanManager = require('./mirin-orphan-manager');
const IssueLockManager = require('./issue-lock-manager');
const BackupScheduler = require('./backup-scheduler');
const FileStateManager = require('./file-state-manager');
const GitHubProjectsSync = require('./github-projects-sync');
const MemoryMonitor = require('./memory-monitor');
const MemoryOptimizer = require('./memory-optimizer');
const CleanupManager = require('./cleanup-manager');

// エラーハンドリングとリカバリー戦略
const { ErrorHandler } = require('./error-handler');
const { CircuitBreakerFactory } = require('./circuit-breaker');
const { ErrorRecoveryManager } = require('./error-recovery');

// エラーハンドリングの設定
process.on('uncaughtException', (error) => {
  console.error('\n❌ エラーが発生しました\n');
  console.error('Stack trace:', error.stack);
  
  if (error.code === 'ENOENT') {
    console.log('📁 設定ファイルが見つかりません');
    console.log('\n解決方法:');
    console.log('1. プロジェクトディレクトリに .poppo/config.json を作成してください:');
    console.log('   mkdir -p .poppo');
    console.log('   echo \'{"language": "ja"}\' > .poppo/config.json');
    console.log('\n2. または環境変数で設定してください:');
    console.log('   export POPPO_LANGUAGE_PRIMARY=ja');
    console.log('\n詳細はドキュメントを参照してください:');
    console.log('   https://github.com/medamap/PoppoBuilderSuite\n');
  } else if (error.message && error.message.includes('language.primary')) {
    console.log('🌐 言語設定が不足しています');
    console.log('\n解決方法:');
    console.log('1. .poppo/config.json に言語を設定してください:');
    console.log('   {"language": {"primary": "ja"}}');
    console.log('\n2. または環境変数で設定してください:');
    console.log('   export POPPO_LANGUAGE_PRIMARY=ja\n');
  } else {
    console.log('詳細:', error.message);
    console.log('\nヘルプが必要な場合は以下を実行してください:');
    console.log('   poppo-builder --help\n');
  }
  
  process.exit(1);
});

// ConfigLoaderで階層的に設定を読み込み
const configLoader = new ConfigLoader();
let poppoConfig = {};
try {
  poppoConfig = configLoader.loadConfigSync();
  
  // 言語設定のフォールバック
  if (!poppoConfig.language || !poppoConfig.language.primary) {
    console.log('ℹ️  言語設定が見つかりません。英語をデフォルトとして使用します。');
    poppoConfig.language = poppoConfig.language || {};
    poppoConfig.language.primary = process.env.LANG?.split('_')[0] || 'en';
    poppoConfig.language.fallback = 'en';
  }
} catch (error) {
  if (error.message && error.message.includes('language.primary')) {
    // 言語設定の警告を無視してデフォルトを使用
    poppoConfig.language = {
      primary: process.env.LANG?.split('_')[0] || 'en',
      fallback: 'en'
    };
  } else {
    throw error;
  }
}

// メイン設定ファイルも読み込み（後方互換性のため）
let mainConfig = {};
const mainConfigPath = path.join(__dirname, '../config/config.json');
if (fs.existsSync(mainConfigPath)) {
  try {
    mainConfig = JSON.parse(fs.readFileSync(mainConfigPath, 'utf-8'));
  } catch (error) {
    console.warn('警告: メイン設定ファイルの読み込みに失敗しました:', error.message);
  }
}


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

// インスタンス作成（ログローテーション設定を含む）
const logger = new Logger(
  path.join(__dirname, '../logs'),
  config.logRotation || {}
);

// エラーハンドリングシステムの初期化
const errorHandler = new ErrorHandler(logger, config.errorHandling || {});
const cleanupManager = new CleanupManager({ logger });
const circuitBreakerFactory = new CircuitBreakerFactory();
const recoveryManager = new ErrorRecoveryManager(logger, config.errorHandling?.autoRecovery || {});

// ConfigWatcherの初期化（設定の動的再読み込み機能）
let configWatcher = null;
let dynamicConfig = config; // 動的に更新される設定

if (config.configReload?.enabled !== false) {
  configWatcher = new ConfigWatcher(logger);
  
  // 設定更新時のハンドラー
  configWatcher.on('config-updated', ({ newConfig, changes }) => {
    logger.info('設定が動的に更新されました:', changes.map(c => c.path).join(', '));
    
    // 即座に反映可能な設定を更新
    updateHotReloadableConfigs(newConfig, changes);
  });

  configWatcher.on('restart-required', ({ changes }) => {
    logger.warn('再起動が必要な設定変更を検知しました');
    // 通知マネージャーがあれば通知
    if (notificationManager) {
      notificationManager.sendNotification({
        type: 'restart-required',
        title: 'PoppoBuilder再起動必要',
        message: `設定変更により再起動が必要です: ${changes.map(c => c.path).join(', ')}`,
        priority: 'high'
      });
    }
  });

  configWatcher.on('validation-error', ({ errors }) => {
    logger.error('設定のバリデーションエラー:', errors);
  });

  // ConfigWatcherを開始
  try {
    configWatcher.start();
    dynamicConfig = configWatcher.getConfig() || config;
  } catch (error) {
    logger.error('ConfigWatcherの起動に失敗しました:', error);
    // フォールバックとして静的設定を使用
  }
}

// GitHub設定を確実に取得
const githubConfig = (dynamicConfig && dynamicConfig.github) || config.github;


// GitHub設定が見つからない場合のエラーハンドリング
if (!githubConfig || !githubConfig.owner || !githubConfig.repo) {
  console.error('\n❌ GitHub設定が見つかりません\n');
  console.log('📁 PoppoBuilderを使用するには、プロジェクトの設定が必要です\n');
  
  // 初期設定ウィザードの提案
  const chalk = require('chalk');
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(chalk.cyan('🎯 初回セットアップが必要です'));
  console.log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n'));
  
  // Claude CLIが利用可能かチェック
  let claudeAvailable = false;
  try {
    require('child_process').execSync('claude --version', { stdio: 'ignore' });
    claudeAvailable = true;
  } catch {}
  
  // Claude CLI検出を無効化し、直接inquirerウィザードを使用
  if (false && claudeAvailable) {
    // Claude CLIインタラクティブモードは現在非対応
  } else {
    // TUIウィザードを起動（inquirer使用）
    console.log(chalk.yellow('🔧 対話型設定ツールを起動しています...\n'));
    const InitWizard = require('./init-wizard');
    const wizard = new InitWizard();
    wizard.run().then((success) => {
      if (success) {
        console.log(chalk.green('\n✅ 設定が完了しました！'));
        console.log(chalk.yellow('もう一度 poppo-builder を実行してください\n'));
      }
      process.exit(0);
    });
  }
  return; // これ以降の処理を停止
}

function showManualSetupInstructions() {
  console.log('\n手動設定の手順:');
  console.log('1. プロジェクトの設定ファイルを作成:');
  console.log('   mkdir -p .poppo');
  console.log('   cat > .poppo/config.json << EOF');
  console.log('   {');
  console.log('     "github": {');
  console.log('       "owner": "YOUR_GITHUB_USERNAME",');
  console.log('       "repo": "YOUR_REPO_NAME"');
  console.log('     },');
  console.log('     "language": {');
  console.log('       "primary": "ja"');
  console.log('     }');
  console.log('   }');
  console.log('   EOF');
  console.log('\n2. または環境変数で設定:');
  console.log('   export POPPO_GITHUB_OWNER=YOUR_USERNAME');
  console.log('   export POPPO_GITHUB_REPO=YOUR_REPO_NAME\n');
  console.log('詳細: https://github.com/medamap/PoppoBuilderSuite/blob/main/config/config.example.json\n');
}

const github = new GitHubClient(githubConfig);
const rateLimiter = new EnhancedRateLimiter(dynamicConfig.rateLimiting || {});

// FileStateManagerの初期化（IndependentProcessManagerで必要）
const stateManager = new FileStateManager();

// IssueLockManagerの初期化
const lockManager = new IssueLockManager('.poppo/locks', logger);

const taskQueue = new TaskQueue({ 
  maxConcurrent: dynamicConfig.claude?.maxConcurrent || 2,
  maxQueueSize: dynamicConfig.taskQueue?.maxQueueSize || 100 
}, lockManager); // lockManagerを渡す

// リトライマネージャーの初期化
const retryManager = new RetryManager({
  maxRetries: dynamicConfig.retry?.maxRetries || 3,
  baseDelay: dynamicConfig.retry?.baseDelay || 1000,
  maxDelay: dynamicConfig.retry?.maxDelay || 300000,
  backoffFactor: dynamicConfig.retry?.backoffFactor || 2,
  logger: logger
});

// 独立プロセス方式を使用（PoppoBuilder再起動時もタスクが継続）
const processManager = new IndependentProcessManager(dynamicConfig.claude || { maxConcurrent: 2, timeout: 86400000 }, rateLimiter, logger, stateManager, lockManager); // stateManagerとlockManagerを渡す

// 通知マネージャーの初期化（設定で有効な場合のみ）
let notificationManager = null;
if (config.notifications?.enabled) {
  notificationManager = new NotificationManager(config.notifications);
  notificationManager.initialize().catch(err => {
    logger.error('通知マネージャーの初期化エラー:', err);
  });
}

// ヘルスチェックマネージャーの初期化
let healthCheckManager = null;
if (config.healthCheck?.enabled !== false) {
  healthCheckManager = new HealthCheckManager(config, processManager, notificationManager);
}

// ProcessStateManagerの初期化
const processStateManager = new ProcessStateManager(logger);

// StatusManagerの初期化
const statusManager = new StatusManager('state/issue-status.json', logger);

// MirinOrphanManagerの初期化
const mirinManager = new MirinOrphanManager(github, statusManager, {
  checkInterval: 30 * 60 * 1000, // 30分
  heartbeatTimeout: 5 * 60 * 1000, // 5分
  requestsDir: 'state/requests',
  requestCheckInterval: 5000 // 5秒
}, logger);

// ダッシュボードサーバーの初期化（ProcessStateManagerを渡す）
const dashboardServer = new DashboardServer(config, processStateManager, logger, healthCheckManager, processManager);

// ProcessStateManagerのイベントをダッシュボードサーバーに接続
processStateManager.on('process-added', (process) => {
  dashboardServer.notifyProcessAdded(process);
});

processStateManager.on('process-updated', (process) => {
  dashboardServer.notifyProcessUpdated(process);
});

processStateManager.on('process-removed', (processId) => {
  dashboardServer.notifyProcessRemoved(processId);
});

// 2段階処理システムの初期化
const twoStageProcessor = new TwoStageProcessor(config, null, logger); // claudeClientは後で設定

// バックアップスケジューラーの初期化
const backupScheduler = new BackupScheduler(config, logger);

// stateManagerを使用（上で既に初期化済み）
const fileStateManager = stateManager;

// GitHub Projects同期の初期化
let githubProjectsSync = null;
if (config.githubProjects?.enabled) {
  githubProjectsSync = new GitHubProjectsSync(config, githubConfig, statusManager, logger);
}

// メモリ監視と最適化の初期化
let memoryMonitor = null;
let memoryOptimizer = null;
if (config.memory?.monitoring?.enabled !== false) {
  memoryMonitor = new MemoryMonitor(config.memory?.monitoring || {}, logger);
  memoryOptimizer = new MemoryOptimizer(config.memory?.optimization || {}, logger);
  
  // メモリ監視イベントハンドラー
  memoryMonitor.on('threshold-exceeded', ({ current, alerts }) => {
    logger.error('メモリ閾値超過:', alerts);
    // 自動最適化を実行
    if (config.memory?.autoOptimize !== false) {
      memoryOptimizer.performGlobalOptimization();
    }
  });
  
  memoryMonitor.on('memory-leak-detected', (leakInfo) => {
    logger.error('メモリリーク検出:', leakInfo);
    if (notificationManager) {
      notificationManager.sendNotification('memory-leak', {
        title: 'メモリリークの可能性',
        message: `増加率: ${leakInfo.mbPerMinute} MB/分`,
        severity: 'critical'
      });
    }
  });
}

// 処理済みIssueを記録（FileStateManager使用）
let processedIssues = new Set();

// 処理済みコメントを記録（FileStateManager使用）
let processedComments = new Map(); // issueNumber -> Set(commentIds)

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
 * ホットリロード可能な設定を更新
 */
function updateHotReloadableConfigs(newConfig, changes) {
  // 動的設定を更新
  dynamicConfig = newConfig;
  
  // 各コンポーネントの設定を更新
  for (const change of changes) {
    const rootKey = change.path.split('.')[0];
    
    switch (rootKey) {
      case 'logLevel':
        logger.setLevel(newConfig.logLevel);
        logger.info(`ログレベルを変更: ${change.oldValue} → ${change.newValue}`);
        break;
        
      case 'rateLimiter':
      case 'rateLimiting':
        // レート制限設定の更新
        if (rateLimiter.updateConfig) {
          rateLimiter.updateConfig(newConfig.rateLimiting || newConfig.rateLimiter);
        }
        break;
        
      case 'claude':
        // Claude API設定の一部を更新
        if (change.path === 'claude.timeout' || change.path === 'claude.maxRetries') {
          processManager.updateConfig({ [change.path.split('.')[1]]: change.newValue });
        }
        break;
        
      case 'language':
        // 言語設定の更新
        logger.info(`言語設定を変更: ${change.path}`);
        break;
        
      case 'notification':
      case 'notifications':
        // 通知設定の更新
        if (notificationManager && notificationManager.updateConfig) {
          notificationManager.updateConfig(newConfig.notifications || newConfig.notification);
        }
        break;
        
      case 'monitoring':
      case 'agentMonitoring':
        // モニタリング設定の更新
        if (healthCheckManager && healthCheckManager.updateConfig) {
          healthCheckManager.updateConfig(newConfig);
        }
        break;
    }
  }
}

/**
 * Issueが処理対象かチェック
 */
async function shouldProcessIssue(issue) {
  // すでに処理済み
  const isProcessed = await fileStateManager.isIssueProcessed(issue.number);
  if (isProcessed) {
    return false;
  }

  // 作者のIssueかチェック
  if (issue.author.login !== config.github.owner) {
    return false;
  }

  // ラベルチェック
  const labels = issue.labels.map(l => l.name);
  
  // 処理対象のtask:*ラベルリスト
  const taskLabels = ['task:misc', 'task:dogfooding', 'task:quality', 'task:docs', 'task:feature'];
  
  // いずれかのtask:*ラベルが必要
  if (!labels.some(label => taskLabels.includes(label))) {
    return false;
  }

  // completedラベルがあればスキップ
  // Note: awaiting-response は処理対象とする（レスポンス待ちの意味なので）
  if (labels.includes('completed') || labels.includes('processing')) {
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
  console.log(`\nIssue #${issueNumber} の処理開始: ${issue.title}`);

  // 早期ロックチェック（IssueLockManager）
  const existingLock = await lockManager.checkLock(issueNumber);
  if (existingLock && lockManager.isLockValid(existingLock)) {
    console.log(`⚠️  Issue #${issueNumber} は既に処理中です (PID: ${existingLock.lockedBy.pid})`);
    logger.logIssue(issueNumber, 'SKIP_ALREADY_LOCKED', { 
      lockedBy: existingLock.lockedBy,
      lockedAt: existingLock.lockedAt 
    });
    return;
  }

  // 処理開始前に処理済みとして記録（二重起動防止）
  await fileStateManager.addProcessedIssue(issueNumber);
  processedIssues.add(issueNumber);

  let cleanupRequired = true;
  let cleanupError = null;
  
  try {
    // StatusManagerでチェックアウト（processingラベルの追加はMirinOrphanManager経由で行われる）
    await statusManager.checkout(issueNumber, `issue-${issueNumber}`, 'claude-cli');
    logger.logIssue(issueNumber, 'CHECKED_OUT', { status: 'processing' });

    // ラベル取得
    const labels = issue.labels.map(l => l.name);
    
    // 言語設定読み込み
    const poppoConfig = configLoader.loadConfigSync();
    
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
      
      // 処理完了としてステータスを更新
      await statusManager.checkin(issueNumber, 'completed', {
        action: 'create_issue',
        newIssue: twoStageResult.executionResult.issue
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
    
    // タスクキューで既にロックを取得しているため、skipLockAcquisitionを指定
    const result = await processManager.execute(`issue-${issueNumber}`, instruction, { skipLockAcquisition: true });
    logger.logIssue(issueNumber, 'INDEPENDENT_STARTED', { 
      taskId: result.taskId,
      pid: result.pid 
    });

    console.log(`Issue #${issueNumber} を独立プロセス (${result.taskId}) として開始`);
    console.log(`PID: ${result.pid} - PoppoBuilder再起動時も継続実行されます`);
    
    // 正常に処理が開始されたのでクリーンアップは不要
    cleanupRequired = false;
    
    // 注意: 結果の処理は checkCompletedTasks() で非同期に行われる

  } catch (error) {
    // エラーを記録
    cleanupError = error;
    
    // 統合エラーハンドリング
    const handledError = await errorHandler.handleError(error, {
      issueNumber,
      operation: 'processIssue',
      title: issue.title
    });
    
    // 自動リカバリーを試行
    const recovered = await recoveryManager.recover(handledError, {
      issueNumber,
      operation: async () => {
        // リトライ用の操作
        console.log(`Issue #${issueNumber} のリトライを実行します`);
        // processIssue自体を再実行するとループになるため、ここではfalseを返す
        return false;
      }
    });
    
    if (!recovered) {
      // リカバリー失敗時の処理
      console.error(`Issue #${issueNumber} の処理エラー:`, handledError.message);
      
      // より詳細なエラー情報をコメントに含める
      const errorDetails = [
        `## エラーが発生しました`,
        ``,
        `### エラーメッセージ`,
        `\`\`\``,
        handledError.message || '(エラーメッセージなし)',
        `\`\`\``,
        handledError.context?.stderr ? `\n### エラー出力\n\`\`\`\n${handledError.context.stderr}\n\`\`\`` : '',
        handledError.context?.stdout ? `\n### 標準出力\n\`\`\`\n${handledError.context.stdout}\n\`\`\`` : '',
        ``,
        `エラーコード: \`${handledError.code}\``,
        `重要度: \`${handledError.severity}\``,
        `リトライ可能: \`${handledError.retryable ? 'Yes' : 'No'}\``,
        ``,
        `詳細なログは \`logs/issue-${issueNumber}-*.log\` を確認してください。`
      ].filter(Boolean).join('\n');
      
      await github.addComment(issueNumber, errorDetails);
      
      // エラー時はステータスをリセット（再試行可能にする）
      await statusManager.resetIssueStatus(issueNumber);
      processedIssues.delete(issueNumber);
      
      // 処理済みIssuesを再読み込みして削除
      const currentProcessed = await fileStateManager.loadProcessedIssues();
      currentProcessed.delete(issueNumber);
      await fileStateManager.saveProcessedIssues(currentProcessed);
    } else {
      logger.info(`Issue #${issueNumber} の自動リカバリーが成功しました`);
    }
  } finally {
    // クリーンアップ処理
    if (cleanupRequired) {
      await cleanupManager.cleanupTask(`issue-${issueNumber}`, {
        issueNumber,
        lockManager,
        statusManager,
        error: cleanupError ? cleanupError.message : 'Process interrupted'
      });
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
  console.log(`\nIssue #${issueNumber} のコメント処理開始`);

  let cleanupRequired = true;
  let cleanupError = null;
  
  try {
    // StatusManagerでコメント処理を開始（awaiting-response→processingの変更もMirinOrphanManager経由）
    await statusManager.checkout(issueNumber, `comment-${issueNumber}-${comment.id}`, 'comment-response');
    logger.logIssue(issueNumber, 'COMMENT_CHECKED_OUT', { 
      commentId: comment.id,
      status: 'processing' 
    });

    // コンテキストを構築
    const conversation = await buildContext(issueNumber);
    
    // ラベル取得
    const labels = issue.labels.map(l => l.name);
    
    // 言語設定読み込み
    const poppoConfig = configLoader.loadConfigSync();
    
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
    
    // タスクキューで既にロックを取得しているため、skipLockAcquisitionを指定
    const result = await processManager.execute(`issue-${issueNumber}-comment-${comment.id}`, instruction, { skipLockAcquisition: true });
    logger.logIssue(issueNumber, 'COMMENT_INDEPENDENT_STARTED', { 
      taskId: result.taskId,
      pid: result.pid 
    });

    console.log(`Issue #${issueNumber} のコメントを独立プロセス (${result.taskId}) として開始`);
    console.log(`PID: ${result.pid} - PoppoBuilder再起動時も継続実行されます`);
    
    // 正常に処理が開始されたのでクリーンアップは不要
    cleanupRequired = false;
    
    // 注意: 結果の処理は checkCompletedTasks() で非同期に行われる

  } catch (error) {
    // エラーを記録
    cleanupError = error;
    
    logger.logIssue(issueNumber, 'COMMENT_ERROR', { 
      commentId: comment.id,
      message: error.message, 
      stack: error.stack 
    });
    console.error(`Issue #${issueNumber} のコメント処理エラー:`, error.message);
    
    // エラー時はawaiting-responseに戻す
    await statusManager.checkin(issueNumber, 'awaiting-response', {
      error: error.message,
      commentId: comment.id
    });
  } finally {
    // クリーンアップ処理
    if (cleanupRequired) {
      await cleanupManager.cleanupTask(`comment-${issueNumber}-${comment.id}`, {
        issueNumber,
        lockManager,
        statusManager,
        error: cleanupError ? cleanupError.message : 'Comment processing interrupted'
      });
    }
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
      const processed = await fileStateManager.getProcessedCommentsForIssue(issue.number);
      
      // 新規コメントをチェック
      for (const comment of comments) {
        // IDフィールドがない場合はcreatedAtとauthorでユニークIDを生成
        const commentId = comment.id || `${comment.createdAt}-${comment.author.login}`;
        
        if (!processed.has(commentId) && shouldProcessComment(issue, comment)) {
          // 処理対象のコメントを発見
          console.log(`新規コメントを検出: Issue #${issue.number}, Comment: ${commentId}`);
          
          // 処理済みとして記録
          await fileStateManager.addProcessedComment(issue.number, commentId);
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
          retryManager.clearRetryInfo(task.id);
        }).catch((error) => {
          console.error(`タスク ${task.id} エラー:`, error.message);
          taskQueue.completeTask(task.id, false);
          
          // リトライ判定
          handleTaskError(task, error);
        });
      } else if (task.type === 'comment') {
        processComment(task.issue, task.comment).then(() => {
          taskQueue.completeTask(task.id, true);
          retryManager.clearRetryInfo(task.id);
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
 * タスクエラーのハンドリング（改善版）
 */
async function handleTaskError(task, error) {
  // リトライ可否を判定
  if (!retryManager.shouldRetry(task.id, error)) {
    console.error(`タスク ${task.id} はリトライしません: ${error.message}`);
    
    // エラー通知（必要に応じて）
    if (notificationManager) {
      await notificationManager.sendNotification({
        level: 'error',
        title: `Task Failed: ${task.id}`,
        message: `Task permanently failed after retries: ${error.message}`,
        metadata: { taskId: task.id, issueNumber: task.issueNumber }
      });
    }
    
    return;
  }
  
  // リトライ試行を記録
  retryManager.recordAttempt(task.id, error);
  
  // リトライ遅延を計算
  const delay = retryManager.getRetryDelay(task.id, error);
  console.log(`タスク ${task.id} を ${Math.ceil(delay / 1000)} 秒後にリトライします`);
  
  // 遅延後にリトライ
  setTimeout(async () => {
    try {
      // 重複チェックしてから再キューイング
      if (!taskQueue.hasDuplicateTask(task)) {
        await taskQueue.enqueue(task);
        console.log(`タスク ${task.id} を再キューイングしました`);
      } else {
        console.log(`タスク ${task.id} は既に処理中のため、再キューイングをスキップ`);
      }
    } catch (enqueueError) {
      console.error(`タスク ${task.id} の再キューイング失敗:`, enqueueError.message);
    }
  }, delay);
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
        const comment = `## 実行完了\n\n${result.output}`;
        await github.addComment(issueNumber, comment);
        
        // ステータス更新
        const finalStatus = (config.commentHandling && config.commentHandling.enabled) 
          ? 'awaiting-response' 
          : 'completed';
        
        await statusManager.checkin(issueNumber, finalStatus, {
          taskId: result.taskId,
          success: true,
          outputLength: result.output?.length || 0
        });
        
        logger.logIssue(issueNumber, 'STATUS_UPDATED', { status: finalStatus });
        
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
 * メインループ
 */
async function mainLoop() {
  console.log('PoppoBuilder 最小限実装 起動');
  
  // 設定階層情報を表示
  configLoader.displayConfigHierarchy();
  
  console.log(`設定: ${JSON.stringify(config, null, 2)}\n`);
  
  // 独立プロセス方式の状態表示
  console.log('🔄 独立プロセス方式: 有効（PoppoBuilder再起動時もタスクが継続）');
  
  if (config.dynamicTimeout?.enabled) {
    console.log('✅ 動的タイムアウト機能: 有効');
  } else {
    console.log('❌ 動的タイムアウト機能: 無効（固定24時間タイムアウト使用）');
  }
  
  // レート制限の初期チェック
  await rateLimiter.preflightCheck();
  
  // ハートビート更新用のインターバル
  global.heartbeatInterval = setInterval(async () => {
    try {
      // 処理中のすべてのIssueのハートビートを更新
      const allStatuses = await statusManager.getAllStatuses();
      for (const [issueNumber, status] of Object.entries(allStatuses)) {
        if (status.status === 'processing') {
          await statusManager.updateHeartbeat(issueNumber);
        }
      }
    } catch (error) {
      logger.error('ハートビート更新エラー:', error);
    }
  }, 30000); // 30秒ごと

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
      console.log('Issueをチェック中...');
      const issues = await github.listIssues({ state: 'open' });
      
      // 処理対象のIssueを抽出
      const targetIssues = [];
      for (const issue of issues) {
        if (await shouldProcessIssue(issue)) {
          targetIssues.push(issue);
        }
      }
      
      if (targetIssues.length === 0) {
        console.log('処理対象のIssueはありません');
      } else {
        console.log(`${targetIssues.length}件のIssueが見つかりました`);
        
        // 古い順に処理
        targetIssues.sort((a, b) => 
          new Date(a.createdAt) - new Date(b.createdAt)
        );

        // Issueをタスクキューに追加（重複チェック付き）
        const currentlyProcessing = await statusManager.getCurrentlyProcessing();
        const queuedIssues = taskQueue.getPendingIssues();
        
        for (const issue of targetIssues) {
          try {
            // 重複チェック
            if (currentlyProcessing.includes(issue.number)) {
              console.log(`⏭️  Issue #${issue.number} は既に処理中のためスキップ`);
              continue;
            }
            
            if (queuedIssues.includes(issue.number)) {
              console.log(`⏭️  Issue #${issue.number} は既にキューに登録済みのためスキップ`);
              continue;
            }

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

    } catch (error) {
      console.error('メインループエラー:', error.message);
    }

    // ポーリング間隔待機
    console.log(`\n${config.polling.interval / 1000}秒後に再チェック...`);
    await new Promise(resolve => setTimeout(resolve, config.polling.interval));
  }
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', async () => {
  console.log('\n\n終了します...');
  
  // 状態を保存
  try {
    await fileStateManager.saveProcessedIssues(processedIssues);
    await fileStateManager.saveProcessedComments(processedComments);
    logger.info('処理済み状態を保存しました');
  } catch (error) {
    logger.error('状態保存エラー:', error);
  }
  
  // ヘルスチェックマネージャーを停止
  if (healthCheckManager) {
    await healthCheckManager.stop();
  }
  
  // MirinOrphanManagerを停止
  mirinManager.stop();
  
  // ハートビートインターバルをクリア
  if (global.heartbeatInterval) {
    clearInterval(global.heartbeatInterval);
  }
  
  // バックアップスケジューラーを停止
  if (backupScheduler) {
    backupScheduler.stop();
  }
  
  // GitHub Projects同期を停止
  if (githubProjectsSync) {
    await githubProjectsSync.cleanup();
  }
  
  // メモリ監視を停止
  if (memoryMonitor) {
    memoryMonitor.stop();
    memoryOptimizer.stop();
  }
  
  // ログローテーターを停止
  logger.close();
  
  // IssueLockManagerをシャットダウン
  await lockManager.shutdown();
  
  processManager.killAll();
  dashboardServer.stop();
  process.exit(0);
});

// SIGTERMでも同じクリーンアップを実行
process.on('SIGTERM', async () => {
  console.log('\n\nSIGTERMを受信しました。終了します...');
  
  // 状態を保存
  try {
    await fileStateManager.saveProcessedIssues(processedIssues);
    await fileStateManager.saveProcessedComments(processedComments);
    logger.info('処理済み状態を保存しました');
  } catch (error) {
    logger.error('状態保存エラー:', error);
  }
  
  // ヘルスチェックマネージャーを停止
  if (healthCheckManager) {
    await healthCheckManager.stop();
  }
  
  // MirinOrphanManagerを停止
  mirinManager.stop();
  
  // ハートビートインターバルをクリア
  if (global.heartbeatInterval) {
    clearInterval(global.heartbeatInterval);
  }
  
  // バックアップスケジューラーを停止
  if (backupScheduler) {
    backupScheduler.stop();
  }
  
  // GitHub Projects同期を停止
  if (githubProjectsSync) {
    await githubProjectsSync.cleanup();
  }
  
  // メモリ監視を停止
  if (memoryMonitor) {
    memoryMonitor.stop();
    memoryOptimizer.stop();
  }
  
  // ログローテーターを停止
  logger.close();
  
  // IssueLockManagerをシャットダウン
  await lockManager.shutdown();
  
  processManager.killAll();
  dashboardServer.stop();
  process.exit(0);
});

// ダッシュボードサーバーを起動
dashboardServer.start();

// ヘルスチェックマネージャーを開始
if (healthCheckManager) {
  healthCheckManager.start().catch(err => {
    logger.error('ヘルスチェックマネージャーの開始エラー:', err);
  });
  logger.info('ヘルスチェックマネージャーを開始しました');
}

// 2段階処理システムを初期化
if (config.twoStageProcessing?.enabled) {
  twoStageProcessor.init().catch(err => {
    logger.error('2段階処理システムの初期化エラー:', err);
  });
  logger.info('2段階処理システムを初期化しました');
}

// StatusManager、MirinOrphanManager、IssueLockManagerを初期化
Promise.all([
  fileStateManager.init(),
  statusManager.initialize(),
  mirinManager.initialize(),
  lockManager.initialize()
]).then(async () => {
  logger.info('FileStateManager、StatusManager、MirinOrphanManager、IssueLockManagerを初期化しました');
  
  // 保存された状態を読み込む
  processedIssues = await fileStateManager.loadProcessedIssues();
  processedComments = await fileStateManager.loadProcessedComments();
  logger.info(`保存された状態を読み込みました: Issues=${processedIssues.size}, Comments=${processedComments.size}`);
  
  // MirinOrphanManagerを開始
  mirinManager.start();
  logger.info('MirinOrphanManagerの監視を開始しました');
  
  // バックアップスケジューラーを開始
  if (config.backup?.enabled) {
    backupScheduler.start();
    logger.info('バックアップスケジューラーを開始しました');
  }
  
  // GitHub Projects同期を開始
  if (githubProjectsSync) {
    await githubProjectsSync.initialize();
    githubProjectsSync.startPeriodicSync(config.githubProjects.syncInterval);
    logger.info('GitHub Projects同期を開始しました');
  }
  
  // メモリ監視を開始
  if (memoryMonitor) {
    await memoryMonitor.start();
    memoryOptimizer.start();
    logger.info('メモリ監視と最適化を開始しました');
  }
  
  // 定期的な孤児リソースクリーンアップ（1時間ごと）
  setInterval(async () => {
    try {
      const cleaned = await cleanupManager.cleanupOrphanedResources(config.stateDir || 'state');
      if (cleaned.locks > 0 || cleaned.tempFiles > 0) {
        logger.info(`孤児リソースをクリーンアップ: ${cleaned.locks} locks, ${cleaned.tempFiles} temp files`);
      }
    } catch (error) {
      logger.error('孤児リソースクリーンアップエラー:', error);
    }
  }, 3600000); // 1時間
  
  // リトライ情報の定期クリーンアップ
  setInterval(() => {
    retryManager.cleanup(3600000); // 1時間以上古いリトライ情報を削除
    const stats = retryManager.getStats();
    if (stats.activeRetries > 0) {
      logger.info(`リトライ統計: アクティブ=${stats.activeRetries}, 総試行回数=${stats.totalAttempts}`);
    }
  }, 600000); // 10分ごと
  
  // 開始
  mainLoop().catch(console.error);
}).catch(err => {
  logger.error('初期化エラー:', err);
  process.exit(1);
});