#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const ProcessManager = require('./process-manager');
const GitHubClient = require('./github-client');
const { createLogger } = require('./logger');

/**
 * PoppoBuilderワーカー
 * 特定のプロジェクトのタスクを処理する
 */
class PoppoWorker {
  constructor(projectId) {
    this.projectId = projectId;
    this.projectPath = process.env.POPPO_PROJECT_PATH || process.cwd();
    this.daemonUrl = process.env.POPPO_DAEMON_URL || 'http://localhost:3003';
    
    this.logger = createLogger(`PoppoWorker-${projectId}`);
    this.processManager = new ProcessManager();
    this.github = new GitHubClient();
    
    this.isRunning = false;
    this.shutdownRequested = false;
    this.currentTask = null;
  }
  
  /**
   * ワーカーを初期化
   */
  async initialize() {
    try {
      this.logger.info('ワーカーを初期化しています...', {
        projectId: this.projectId,
        projectPath: this.projectPath,
        daemonUrl: this.daemonUrl
      });
      
      // プロジェクト設定を読み込み
      const projectConfigPath = path.join(this.projectPath, '.poppo', 'project.json');
      const configData = await fs.readFile(projectConfigPath, 'utf-8');
      this.projectConfig = JSON.parse(configData);
      
      // シグナルハンドラーを設定
      process.on('SIGINT', () => this.shutdown());
      process.on('SIGTERM', () => this.shutdown());
      
      this.logger.info('ワーカーの初期化が完了しました');
      
    } catch (error) {
      this.logger.error('ワーカーの初期化に失敗しました:', error);
      throw error;
    }
  }
  
  /**
   * デーモンAPIを呼び出し
   */
  async callDaemonApi(endpoint, method = 'GET', data = null) {
    try {
      const response = await axios({
        method,
        url: `${this.daemonUrl}${endpoint}`,
        data,
        timeout: 30000
      });
      return response.data;
    } catch (error) {
      this.logger.error('デーモンAPI呼び出しエラー:', error.message);
      throw error;
    }
  }
  
  /**
   * 次のタスクを取得
   */
  async getNextTask() {
    try {
      const response = await axios.post(`${this.daemonUrl}/api/queue/next`, {
        projectId: this.projectId
      });
      
      if (response.data && response.data.task) {
        return response.data.task;
      }
      
      return null;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        // タスクがない場合
        return null;
      }
      throw error;
    }
  }
  
  /**
   * タスクを処理
   */
  async processTask(task) {
    this.currentTask = task;
    const startTime = Date.now();
    
    try {
      this.logger.info('タスクの処理を開始します', {
        taskId: task.id,
        issueNumber: task.issueNumber
      });
      
      // Issueの詳細を取得
      const issue = await this.github.getIssue(task.issueNumber);
      
      // システムプロンプトを構築
      const systemPrompt = this.buildSystemPrompt(issue);
      
      // Claudeで処理
      const result = await this.processManager.executeTask({
        issueNumber: task.issueNumber,
        issueTitle: issue.title,
        issueBody: issue.body,
        labels: issue.labels.map(l => l.name),
        systemPrompt,
        timeout: this.getTaskTimeout(issue.labels)
      });
      
      // 結果をコメントとして投稿
      if (result.success) {
        await this.github.postComment(task.issueNumber, result.output);
        
        // タスクを完了
        await this.callDaemonApi(`/api/queue/complete/${task.id}`, 'POST', {
          result: {
            success: true,
            executionTime: Date.now() - startTime,
            outputLength: result.output.length
          }
        });
        
        this.logger.info('タスクを正常に完了しました', {
          taskId: task.id,
          executionTime: Date.now() - startTime
        });
      } else {
        throw new Error(result.error || 'タスクの実行に失敗しました');
      }
      
    } catch (error) {
      this.logger.error('タスクの処理に失敗しました:', error);
      
      // タスクを失敗として記録
      await this.callDaemonApi(`/api/queue/fail/${task.id}`, 'POST', {
        error: error.message
      });
      
      // エラーコメントを投稿
      const errorMessage = `処理中にエラーが発生しました: ${error.message}`;
      await this.github.postComment(task.issueNumber, errorMessage);
    } finally {
      this.currentTask = null;
    }
  }
  
  /**
   * システムプロンプトを構築
   */
  buildSystemPrompt(issue) {
    const labels = issue.labels.map(l => l.name);
    const isDogfooding = labels.includes(this.projectConfig.labels?.dogfooding || 'task:dogfooding');
    
    let prompt = `重要: あなたは ${this.projectConfig.name} プロジェクトの自動実行エージェントです。\n`;
    prompt += `すべての回答、コメント、説明は日本語で行ってください。\n\n`;
    
    if (isDogfooding) {
      prompt += `🔧 DOGFOODING MODE: 自己改善タスクです\n`;
      prompt += `- 最初に CLAUDE.md を読んで現在の実装状況を把握してください\n`;
      prompt += `- 実装完了後は必ず CLAUDE.md の実装状況を更新してください\n`;
      prompt += `- 次のセッションで継続できるよう詳細な記録を残してください\n`;
      prompt += `- 変更点は具体的に記述し、テスト方法も含めてください\n\n`;
    }
    
    prompt += `プロジェクト情報:\n`;
    prompt += `- リポジトリ: ${this.projectConfig.repository?.fullName || this.projectId}\n`;
    prompt += `- 作業ディレクトリ: ${this.projectPath}\n`;
    prompt += `- Issue #${issue.number}: ${issue.title}\n`;
    
    return prompt;
  }
  
  /**
   * タスクのタイムアウトを取得
   */
  getTaskTimeout(labels) {
    const labelNames = labels.map(l => l.name);
    
    // ラベルに基づいてタイムアウトを決定
    if (labelNames.includes(this.projectConfig.labels?.dogfooding)) {
      return 2 * 60 * 60 * 1000; // 2時間
    } else if (labelNames.includes(this.projectConfig.labels?.feature)) {
      return 90 * 60 * 1000; // 90分
    } else if (labelNames.includes(this.projectConfig.labels?.bug)) {
      return 60 * 60 * 1000; // 1時間
    }
    
    return 30 * 60 * 1000; // デフォルト30分
  }
  
  /**
   * メインループ
   */
  async mainLoop() {
    while (!this.shutdownRequested) {
      try {
        // 次のタスクを取得
        const task = await this.getNextTask();
        
        if (task) {
          await this.processTask(task);
        } else {
          // タスクがない場合は待機
          await new Promise(resolve => setTimeout(resolve, 10000));
        }
        
      } catch (error) {
        this.logger.error('メインループエラー:', error);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }
  }
  
  /**
   * ワーカーを開始
   */
  async start() {
    try {
      await this.initialize();
      
      this.isRunning = true;
      this.logger.info('ワーカーを開始しました', {
        projectId: this.projectId,
        pid: process.pid
      });
      
      // デーモンにワーカー開始を通知
      await this.callDaemonApi('/api/workers/register', 'POST', {
        projectId: this.projectId,
        pid: process.pid
      });
      
      // メインループを開始
      await this.mainLoop();
      
    } catch (error) {
      this.logger.error('ワーカーの開始に失敗しました:', error);
      process.exit(1);
    }
  }
  
  /**
   * ワーカーをシャットダウン
   */
  async shutdown() {
    if (this.shutdownRequested) {
      return;
    }
    
    this.shutdownRequested = true;
    this.logger.info('ワーカーのシャットダウンを開始します...');
    
    try {
      // 現在のタスクが完了するまで待機（最大30秒）
      if (this.currentTask) {
        this.logger.info('現在のタスクの完了を待機しています...');
        let waitTime = 0;
        while (this.currentTask && waitTime < 30000) {
          await new Promise(resolve => setTimeout(resolve, 1000));
          waitTime += 1000;
        }
      }
      
      // デーモンにワーカー停止を通知
      try {
        await this.callDaemonApi('/api/workers/unregister', 'POST', {
          projectId: this.projectId,
          pid: process.pid
        });
      } catch (error) {
        // エラーは無視
      }
      
      this.logger.info('ワーカーのシャットダウンが完了しました');
      process.exit(0);
      
    } catch (error) {
      this.logger.error('シャットダウン中にエラーが発生しました:', error);
      process.exit(1);
    }
  }
}

// メインエントリポイント
if (require.main === module) {
  const projectId = process.argv[2];
  if (!projectId) {
    console.error('使用法: poppo-worker.js <project-id>');
    process.exit(1);
  }
  
  const worker = new PoppoWorker(projectId);
  worker.start().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = PoppoWorker;