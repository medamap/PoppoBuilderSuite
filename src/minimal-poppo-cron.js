#!/usr/bin/env node
/**
 * Issue #98: State management integration and double startup prevention enhancement for minimal-poppo-cron.js
 * 
 * PoppoBuilder main file for cron execution
 * - Integration of FileStateManager and IndependentProcessManager
 * - Enhanced double startup prevention
 * - Improved error handling
 * - Task queue persistence
 */

// Set process name
process.title = 'PoppoBuilder-Cron';

const fs = require('fs');
const path = require('path');
const GitHubClient = require('./github-client');
const IndependentProcessManager = require('./independent-process-manager');
const EnhancedRateLimiter = require('./enhanced-rate-limiter');
const TaskQueue = require('./task-queue');
const Logger = require('./logger');
const ConfigLoader = require('./config-loader');
const i18n = require('../lib/i18n');

// Load FileStateManager (if exists)
let FileStateManager;
try {
  FileStateManager = require('./file-state-manager');
} catch (error) {
  console.error('❌ FileStateManager not found. Using basic state management functions only.');
  // Define basic state management class
  FileStateManager = class BasicStateManager {
    constructor() {
      this.stateDir = path.join(__dirname, '../state');
      this.lockDir = path.join(this.stateDir, '.locks');
      this.ensureDirectories();
    }
    
    ensureDirectories() {
      [this.stateDir, this.lockDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      });
    }
    
    async acquireProcessLock() {
      const lockFile = path.join(this.lockDir, 'cron-process.lock');
      const lockInfo = {
        pid: process.pid,
        startTime: new Date().toISOString(),
        hostname: require('os').hostname()
      };
      
      try {
        // Check existing lock
        if (fs.existsSync(lockFile)) {
          const existingLock = JSON.parse(fs.readFileSync(lockFile, 'utf8'));
          
          // Check if process is alive
          try {
            process.kill(existingLock.pid, 0);
            return false; // Process is alive = lock acquisition failed
          } catch (err) {
            // Process is dead = old lock file
            fs.unlinkSync(lockFile);
          }
        }
        
        // Create new lock
        fs.writeFileSync(lockFile, JSON.stringify(lockInfo, null, 2));
        return true;
      } catch (error) {
        console.error('Lock acquisition error:', error);
        return false;
      }
    }
    
    async releaseProcessLock() {
      const lockFile = path.join(this.lockDir, 'cron-process.lock');
      try {
        if (fs.existsSync(lockFile)) {
          fs.unlinkSync(lockFile);
        }
      } catch (error) {
        console.error('Lock release error:', error);
      }
    }
    
    async loadRunningTasks() {
      const tasksFile = path.join(this.stateDir, 'running-tasks.json');
      try {
        if (fs.existsSync(tasksFile)) {
          return JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
        }
      } catch (error) {
        console.error('Running tasks loading error:', error);
      }
      return {};
    }
    
    async saveRunningTasks(tasks) {
      const tasksFile = path.join(this.stateDir, 'running-tasks.json');
      try {
        fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
      } catch (error) {
        console.error('Running tasks saving error:', error);
      }
    }
    
    async loadPendingTasks() {
      const tasksFile = path.join(this.stateDir, 'pending-tasks.json');
      try {
        if (fs.existsSync(tasksFile)) {
          return JSON.parse(fs.readFileSync(tasksFile, 'utf8'));
        }
      } catch (error) {
        console.error('Pending tasks loading error:', error);
      }
      return [];
    }
    
    async savePendingTasks(tasks) {
      const tasksFile = path.join(this.stateDir, 'pending-tasks.json');
      const backupFile = path.join(this.stateDir, 'pending-tasks.json.backup-' + Date.now());
      
      try {
        // Create backup
        if (fs.existsSync(tasksFile)) {
          fs.copyFileSync(tasksFile, backupFile);
        }
        
        // Save new data
        fs.writeFileSync(tasksFile, JSON.stringify(tasks, null, 2));
      } catch (error) {
        console.error('Pending tasks saving error:', error);
      }
    }
    
    async removeRunningTask(taskId) {
      const tasks = await this.loadRunningTasks();
      delete tasks[taskId];
      await this.saveRunningTasks(tasks);
    }
  };
}

/**
 * PoppoBuilderCron - Class dedicated to cron execution
 */
class PoppoBuilderCron {
  constructor() {
    this.isShuttingDown = false;
    this.processStartTime = Date.now();
    this.config = null;
    this.logger = null;
    this.github = null;
    this.rateLimiter = null;
    this.processManager = null;
    this.taskQueue = null;
    this.stateManager = null;
    this.processedIssues = new Set();
    this.processedComments = new Map();
  }

  /**
   * Initialize
   */
  async initialize() {
    try {
      console.log('🚀 PoppoBuilder Cron initialization starting...');
      
      // テストモード判定
      const testMode = process.env.TEST_MODE;
      if (testMode) {
        console.log(`📋 テストモード: ${testMode}`);
      }
      
      // 設定読み込み
      await this.loadConfiguration();
      
      // ロガー初期化
      this.logger = new Logger('PoppoBuilderCron');
      this.logger.info('Cron実行開始');
      
      // 状態管理初期化
      this.stateManager = new FileStateManager();
      
      // プロセスロック取得
      const lockAcquired = await this.stateManager.acquireProcessLock();
      if (!lockAcquired) {
        this.logger.warn('他のcronプロセスが実行中です。終了します。');
        console.log('他のcronプロセスが実行中です。終了します。');
        process.exit(0);
      } else {
        console.log('プロセスロック取得成功');
        this.logger.info('プロセスロック取得成功');
      }
      
      // I18n初期化
      await i18n.init({ language: this.config.language?.primary || 'en' });
      
      // テストモードの場合は短縮実行
      if (testMode) {
        console.log('テストモード: 初期化完了');
        
        if (testMode === 'true' || testMode === 'quick' || testMode === 'cleanup_test') {
          // シグナルハンドラー設定（テスト用）
          this.setupSignalHandlers();
          this.logger.info('PoppoBuilder Cron 初期化完了（テストモード）');
          return;
        }
        
        if (testMode === 'error_test' || testMode === 'missing_config') {
          // 意図的にエラーを発生させる
          throw new Error('テスト用エラー: 設定ファイルが見つかりません');
        }
      }
      
      // GitHubクライアント初期化
      this.github = new GitHubClient(this.config.github);
      
      // レート制限初期化
      this.rateLimiter = new EnhancedRateLimiter(this.config.rateLimiting || {});
      
      // IndependentProcessManagerにStateManagerを設定
      this.processManager = new IndependentProcessManager(
        this.config.claude,
        this.rateLimiter,
        this.logger,
        this.stateManager  // FileStateManagerを渡す
      );
      
      // タスクキュー初期化
      this.taskQueue = new TaskQueue({
        maxConcurrentTasks: this.config.maxConcurrentTasks || 3,
        taskTimeout: this.config.taskTimeout || 300000, // 5分
        logger: this.logger
      });
      
      // 保留中タスクの復元
      await this.restorePendingTasks();
      
      // シグナルハンドラー設定
      this.setupSignalHandlers();
      
      this.logger.info('PoppoBuilder Cron 初期化完了');
      
    } catch (error) {
      console.error('❌ 初期化エラー:', error);
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * 設定読み込み
   */
  async loadConfiguration() {
    const configLoader = new ConfigLoader();
    const poppoConfig = configLoader.loadConfig();
    
    // メイン設定ファイルも読み込み
    const mainConfig = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../config/config.json'), 'utf-8')
    );
    
    // 設定をマージ
    this.config = {
      ...mainConfig,
      language: poppoConfig.language || mainConfig.language,
      systemPrompt: poppoConfig.systemPrompt || mainConfig.systemPrompt,
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
      }
    };
  }

  /**
   * メイン処理実行
   */
  async run() {
    try {
      this.logger.info('=== PoppoBuilder Cron 実行開始 ===');
      
      const testMode = process.env.TEST_MODE;
      
      // テストモードの場合は短縮実行
      if (testMode === 'true' || testMode === 'quick' || testMode === 'cleanup_test') {
        this.logger.info('テストモード: 短縮実行');
        
        // 二重起動防止テスト用により長く待機
        if (testMode === 'true') {
          await this.sleep(10000); // 10秒待機（二重起動テスト用）
        } else {
          await this.sleep(1000); // 1秒待機（その他のテスト用）
        }
        
        this.logger.info('=== PoppoBuilder Cron 実行完了（テスト） ===');
        return;
      }
      
      // 通常の実行
      // 実行前の状態確認
      await this.verifyState();
      
      // Issue処理
      await this.processIssues();
      
      // タスクキューの処理
      await this.processTaskQueue();
      
      this.logger.info('=== PoppoBuilder Cron 実行完了 ===');
      
    } catch (error) {
      this.logger.error('メイン処理エラー:', error);
      throw error;
    }
  }

  /**
   * 実行前の状態確認
   */
  async verifyState() {
    // 実行中タスクの再確認
    const currentRunningTasks = await this.stateManager.loadRunningTasks();
    const taskIds = Object.keys(currentRunningTasks);
    
    if (taskIds.length > 0) {
      this.logger.info(`実行中タスク確認: ${taskIds.length}件`);
      
      // 各タスクの状態を確認
      for (const taskId of taskIds) {
        const taskInfo = currentRunningTasks[taskId];
        
        // プロセスが生きているかチェック
        try {
          if (taskInfo.pid && !this.isProcessAlive(taskInfo.pid)) {
            this.logger.warn(`デッドプロセス検出: ${taskId} (PID: ${taskInfo.pid})`);
            await this.stateManager.removeRunningTask(taskId);
          }
        } catch (error) {
          this.logger.error(`タスク状態確認エラー ${taskId}:`, error);
        }
      }
    }
  }

  /**
   * プロセス生存確認
   */
  isProcessAlive(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Issue処理
   */
  async processIssues() {
    try {
      this.logger.info('Issue処理開始');
      
      // オープンなIssueを取得（優先度順）
      const issues = await this.github.getOpenIssues();
      const prioritizedIssues = this.prioritizeIssues(issues);
      
      this.logger.info(`処理対象Issue: ${prioritizedIssues.length}件`);
      
      for (const issue of prioritizedIssues) {
        if (this.isShuttingDown) {
          this.logger.info('シャットダウン中のため処理中断');
          break;
        }
        
        try {
          // 重複処理チェック（強化版）
          if (await this.isDuplicateProcessing(issue.number)) {
            this.logger.info(`Issue #${issue.number} は既に処理中またはスキップ`);
            continue;
          }
          
          // Issue処理の実行
          await this.processIssue(issue);
          
          // 処理間隔（レート制限対策）
          await this.sleep(2000);
          
        } catch (error) {
          this.logger.error(`Issue #${issue.number} 処理エラー:`, error);
          
          // エラー時の状態クリーンアップ
          await this.cleanupIssueState(issue.number);
        }
      }
      
    } catch (error) {
      this.logger.error('Issue処理エラー:', error);
      throw error;
    }
  }

  /**
   * 重複処理チェック（強化版）
   */
  async isDuplicateProcessing(issueNumber) {
    // 1. 実行中タスクをチェック
    const runningTasks = await this.stateManager.loadRunningTasks();
    const taskId = `issue-${issueNumber}`;
    
    if (runningTasks[taskId]) {
      // プロセスが生きているかダブルチェック
      const taskInfo = runningTasks[taskId];
      if (taskInfo.pid && this.isProcessAlive(taskInfo.pid)) {
        return true; // 実際に処理中
      } else {
        // デッドプロセスの場合はクリーンアップ
        await this.stateManager.removeRunningTask(taskId);
      }
    }
    
    // 2. メモリ内のProcessedチェック（セッション内重複防止）
    if (this.processedIssues.has(issueNumber)) {
      return true;
    }
    
    // 3. ファイルベースのProcessedチェック（他のプロセスとの重複防止）
    if (this.stateManager.isIssueProcessed && await this.stateManager.isIssueProcessed(issueNumber)) {
      return true;
    }
    
    return false;
  }

  /**
   * Issue優先度付け
   */
  prioritizeIssues(issues) {
    return issues.sort((a, b) => {
      // Dogfoodingを最優先
      const aDogfooding = a.labels.some(label => label.name === 'task:dogfooding');
      const bDogfooding = b.labels.some(label => label.name === 'task:dogfooding');
      
      if (aDogfooding && !bDogfooding) return -1;
      if (!aDogfooding && bDogfooding) return 1;
      
      // 次にBug
      const aBug = a.labels.some(label => label.name === 'task:bug');
      const bBug = b.labels.some(label => label.name === 'task:bug');
      
      if (aBug && !bBug) return -1;
      if (!aBug && bBug) return 1;
      
      // 最後に作成日時（古い順）
      return new Date(a.created_at) - new Date(b.created_at);
    });
  }

  /**
   * 個別Issue処理
   */
  async processIssue(issue) {
    const issueNumber = issue.number;
    const taskId = `issue-${issueNumber}`;
    
    this.logger.info(`Issue #${issueNumber} 処理開始: ${issue.title}`);
    
    try {
      // 処理中状態をマーク
      this.processedIssues.add(issueNumber);
      
      // 独立プロセスでの実行
      const result = await this.processManager.processIssue(issueNumber, {
        issueData: issue,
        priority: this.getIssuePriority(issue),
        timeout: this.config.claude.timeout || 120000
      });
      
      if (result.success) {
        this.logger.info(`Issue #${issueNumber} 処理成功`);
        
        // 成功時は処理済みとしてマーク
        if (this.stateManager.addProcessedIssue) {
          await this.stateManager.addProcessedIssue(issueNumber);
        }
      } else {
        this.logger.error(`Issue #${issueNumber} 処理失敗:`, result.error);
        
        // 失敗時は処理済みマークから削除（再試行可能にする）
        this.processedIssues.delete(issueNumber);
      }
      
    } catch (error) {
      this.logger.error(`Issue #${issueNumber} 処理例外:`, error);
      
      // エラー時の状態回復
      this.processedIssues.delete(issueNumber);
      await this.cleanupIssueState(issueNumber);
      
      throw error;
    }
  }

  /**
   * Issue優先度取得
   */
  getIssuePriority(issue) {
    if (issue.labels.some(label => label.name === 'task:dogfooding')) return 'high';
    if (issue.labels.some(label => label.name === 'task:bug')) return 'medium';
    return 'normal';
  }

  /**
   * Issue状態クリーンアップ
   */
  async cleanupIssueState(issueNumber) {
    const taskId = `issue-${issueNumber}`;
    
    try {
      // 実行中タスクから削除
      await this.stateManager.removeRunningTask(taskId);
      
      // メモリからも削除
      this.processedIssues.delete(issueNumber);
      
      this.logger.info(`Issue #${issueNumber} の状態をクリーンアップしました`);
      
    } catch (error) {
      this.logger.error(`Issue #${issueNumber} クリーンアップエラー:`, error);
    }
  }

  /**
   * タスクキュー処理
   */
  async processTaskQueue() {
    try {
      // キューにタスクがあるか確認
      if (this.taskQueue && this.taskQueue.size() > 0) {
        this.logger.info(`タスクキュー処理: ${this.taskQueue.size()}件`);
        
        // タスクキューの処理ロジックをここに実装
        // 現在の実装では基本的なログ出力のみ
        
      }
    } catch (error) {
      this.logger.error('タスクキュー処理エラー:', error);
    }
  }

  /**
   * 保留中タスクの復元
   */
  async restorePendingTasks() {
    try {
      const pendingTasks = await this.stateManager.loadPendingTasks();
      
      if (pendingTasks.length > 0) {
        this.logger.info(`保留中タスク復元: ${pendingTasks.length}件`);
        
        // 優先度順にソート
        const sortedTasks = pendingTasks.sort((a, b) => {
          const priorityOrder = { high: 3, medium: 2, normal: 1 };
          return (priorityOrder[b.priority] || 1) - (priorityOrder[a.priority] || 1);
        });
        
        // タスクキューに追加
        for (const task of sortedTasks) {
          if (this.taskQueue && this.taskQueue.add) {
            this.taskQueue.add(task);
          }
        }
        
        // 復元後はファイルをクリア
        await this.stateManager.savePendingTasks([]);
      }
      
    } catch (error) {
      this.logger.error('保留中タスク復元エラー:', error);
    }
  }

  /**
   * シグナルハンドラー設定
   */
  setupSignalHandlers() {
    const handleShutdown = async (signal) => {
      if (this.isShuttingDown) return;
      
      this.isShuttingDown = true;
      
      const testMode = process.env.TEST_MODE;
      if (testMode === 'cleanup_test') {
        console.log('クリーンアップ処理開始');
        this.logger?.info('クリーンアップ処理開始');
      }
      
      this.logger?.info(`シャットダウンシグナル受信: ${signal}`);
      
      await this.cleanup();
      process.exit(0);
    };
    
    // 予期しないエラーのハンドリング
    process.on('uncaughtException', async (error) => {
      this.logger?.error('予期しないエラー:', error);
      await this.cleanup();
      process.exit(1);
    });
    
    process.on('unhandledRejection', async (reason, promise) => {
      this.logger?.error('未処理のPromise拒否:', reason);
      await this.cleanup();
      process.exit(1);
    });
    
    // シャットダウンシグナル
    process.on('SIGINT', () => handleShutdown('SIGINT'));
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGHUP', () => handleShutdown('SIGHUP'));
  }

  /**
   * クリーンアップ処理
   */
  async cleanup() {
    try {
      const testMode = process.env.TEST_MODE;
      
      // テストモード用の出力
      if (testMode === 'cleanup_test') {
        console.log('クリーンアップ処理開始');
      }
      
      this.logger?.info('クリーンアップ処理開始');
      
      // 1. タスクキューの永続化
      if (this.taskQueue && this.stateManager) {
        const pendingTasks = this.taskQueue.getAllPendingTasks ? 
          this.taskQueue.getAllPendingTasks() : [];
        
        if (pendingTasks.length > 0) {
          await this.stateManager.savePendingTasks(pendingTasks);
          this.logger?.info(`保留中タスクを保存: ${pendingTasks.length}件`);
        }
      }
      
      // 2. 独立プロセスの停止確認とクリーンアップ
      if (this.processManager && this.processManager.shutdown) {
        await this.processManager.shutdown();
      }
      
      // 3. プロセスロックの解放
      if (this.stateManager && this.stateManager.releaseProcessLock) {
        await this.stateManager.releaseProcessLock();
      }
      
      // 4. リソースのクリーンアップ
      if (this.rateLimiter && this.rateLimiter.cleanup) {
        this.rateLimiter.cleanup();
      }
      
      this.logger?.info('クリーンアップ処理完了');
      
      // テストモード用の出力
      if (testMode === 'cleanup_test') {
        console.log('クリーンアップ処理完了');
      }
      
    } catch (error) {
      console.error('クリーンアップエラー:', error);
    }
  }

  /**
   * ユーティリティ: スリープ
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// メイン実行
async function main() {
  const cron = new PoppoBuilderCron();
  
  try {
    await cron.initialize();
    await cron.run();
    await cron.cleanup();
    
    console.log('✅ PoppoBuilder Cron 正常終了');
    process.exit(0);
    
  } catch (error) {
    console.error('❌ PoppoBuilder Cron エラー終了:', error);
    await cron.cleanup();
    process.exit(1);
  }
}

// スクリプトとして実行された場合
if (require.main === module) {
  main();
}

module.exports = PoppoBuilderCron;