/**
 * PoppoBuilder Core Class
 * npm パッケージ版のメインクラス
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');

class PoppoBuilder extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.projectRoot = config.projectRoot || process.cwd();
    this.isRunning = false;
    this.tasks = [];
    
    // 各種マネージャーの初期化
    this.initializeManagers();
  }

  initializeManagers() {
    // パスを相対化して初期化
    const ConfigLoader = require('./config-loader');
    const TaskProcessor = require('./task-processor');
    const Logger = require('../utils/logger');
    const GitHubClient = require('../utils/github-client');
    const StateManager = require('../utils/state-manager');
    
    // ログディレクトリ
    const logDir = path.join(this.projectRoot, this.config.paths?.logs || '.poppobuilder/logs');
    this.logger = new Logger('PoppoBuilder', { logDir });
    
    // GitHub クライアント
    this.github = new GitHubClient({
      token: this.config.github.token || process.env.GITHUB_TOKEN,
      owner: this.config.github.owner,
      repo: this.config.github.repo
    });
    
    // 状態管理
    const stateDir = path.join(this.projectRoot, this.config.paths?.state || '.poppobuilder/state');
    this.stateManager = new StateManager(stateDir);
    
    // タスクプロセッサー
    this.taskProcessor = new TaskProcessor({
      config: this.config,
      logger: this.logger,
      github: this.github,
      stateManager: this.stateManager
    });
    
    // イベントリスナーの設定
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.taskProcessor.on('task:start', (task) => {
      this.emit('task:start', task);
      this.logger.info(`Task started: ${task.type} #${task.issueNumber}`);
    });
    
    this.taskProcessor.on('task:complete', (task) => {
      this.emit('task:complete', task);
      this.logger.info(`Task completed: ${task.type} #${task.issueNumber}`);
    });
    
    this.taskProcessor.on('task:error', (task, error) => {
      this.emit('task:error', task, error);
      this.logger.error(`Task error: ${task.type} #${task.issueNumber}`, error);
    });
  }

  async start() {
    if (this.isRunning) {
      throw new Error('PoppoBuilder is already running');
    }
    
    this.logger.info('Starting PoppoBuilder...');
    this.isRunning = true;
    
    try {
      // 設定の検証
      await this.validateConfiguration();
      
      // 状態の初期化
      await this.stateManager.initialize();
      
      // メインループの開始
      await this.startMainLoop();
      
      this.logger.info('PoppoBuilder started successfully');
      this.emit('started');
    } catch (error) {
      this.isRunning = false;
      this.logger.error('Failed to start PoppoBuilder:', error);
      throw error;
    }
  }

  async stop() {
    if (!this.isRunning) {
      return;
    }
    
    this.logger.info('Stopping PoppoBuilder...');
    this.isRunning = false;
    
    // 実行中のタスクを待機
    await this.taskProcessor.waitForCompletion();
    
    // 状態の保存
    await this.stateManager.save();
    
    this.logger.info('PoppoBuilder stopped');
    this.emit('stopped');
  }

  async validateConfiguration() {
    const required = [
      'github.owner',
      'github.repo',
      'github.token'
    ];
    
    for (const key of required) {
      const value = this.getConfigValue(key);
      if (!value) {
        throw new Error(`Required configuration missing: ${key}`);
      }
    }
    
    // GitHub接続テスト
    try {
      await this.github.testConnection();
    } catch (error) {
      throw new Error(`GitHub connection failed: ${error.message}`);
    }
  }

  getConfigValue(keyPath) {
    const keys = keyPath.split('.');
    let value = this.config;
    
    for (const key of keys) {
      value = value?.[key];
    }
    
    // 環境変数の置換
    if (typeof value === 'string' && value.startsWith('${') && value.endsWith('}')) {
      const envVar = value.slice(2, -1);
      return process.env[envVar];
    }
    
    return value;
  }

  async startMainLoop() {
    while (this.isRunning) {
      try {
        // Issueの取得
        const issues = await this.fetchIssues();
        
        // 処理対象のフィルタリング
        const tasksToProcess = await this.filterIssues(issues);
        
        // タスクの処理
        if (tasksToProcess.length > 0) {
          this.logger.info(`Found ${tasksToProcess.length} issues to process`);
          await this.processTasks(tasksToProcess);
        }
        
        // 待機
        await this.sleep(this.config.polling?.interval || 60000);
        
      } catch (error) {
        this.logger.error('Error in main loop:', error);
        this.emit('error', error);
        
        // エラー後の待機
        await this.sleep(30000);
      }
    }
  }

  async fetchIssues() {
    const labels = this.config.tasks?.labels || ['task:misc'];
    const issues = [];
    
    for (const label of labels) {
      const labelIssues = await this.github.listIssues({
        labels: label,
        state: 'open'
      });
      issues.push(...labelIssues);
    }
    
    // 重複除去
    const uniqueIssues = Array.from(
      new Map(issues.map(issue => [issue.number, issue])).values()
    );
    
    return uniqueIssues;
  }

  async filterIssues(issues) {
    const tasks = [];
    
    for (const issue of issues) {
      // 処理済みチェック
      if (await this.stateManager.isProcessed(issue.number)) {
        continue;
      }
      
      // 実行中チェック
      if (await this.stateManager.isRunning(issue.number)) {
        continue;
      }
      
      // タスクラベルの確認
      const hasTaskLabel = issue.labels.some(label => 
        this.config.tasks?.labels?.includes(label.name)
      );
      
      if (hasTaskLabel) {
        tasks.push({
          type: 'issue',
          issueNumber: issue.number,
          issue: issue,
          priority: this.calculatePriority(issue)
        });
      }
    }
    
    // 優先度でソート
    tasks.sort((a, b) => b.priority - a.priority);
    
    return tasks;
  }

  calculatePriority(issue) {
    let priority = 0;
    
    // ラベルベースの優先度
    const priorityLabels = this.config.tasks?.priorityLabels || {};
    
    for (const [level, labels] of Object.entries(priorityLabels)) {
      const hasLabel = issue.labels.some(label => labels.includes(label.name));
      if (hasLabel) {
        priority += level === 'high' ? 100 : level === 'medium' ? 50 : 10;
      }
    }
    
    // 作成日時による優先度（古いものを優先）
    const ageInDays = (Date.now() - new Date(issue.created_at)) / (1000 * 60 * 60 * 24);
    priority += Math.min(ageInDays, 30);
    
    return priority;
  }

  async processTasks(tasks) {
    const maxConcurrent = this.config.claude?.maxConcurrent || 3;
    const concurrent = Math.min(tasks.length, maxConcurrent);
    
    // 並行処理
    const promises = [];
    for (let i = 0; i < concurrent; i++) {
      if (tasks[i]) {
        promises.push(this.taskProcessor.process(tasks[i]));
      }
    }
    
    await Promise.allSettled(promises);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public API
  
  async getStatus() {
    return {
      isRunning: this.isRunning,
      stats: await this.stateManager.getStats(),
      config: {
        project: this.config.project,
        github: {
          owner: this.config.github.owner,
          repo: this.config.github.repo
        }
      }
    };
  }

  async getRunningTasks() {
    return await this.stateManager.getRunningTasks();
  }

  async getProcessedIssues() {
    return await this.stateManager.getProcessedIssues();
  }

  async resetIssue(issueNumber) {
    await this.stateManager.removeProcessed(issueNumber);
    this.logger.info(`Reset issue #${issueNumber} for reprocessing`);
  }
}

module.exports = PoppoBuilder;