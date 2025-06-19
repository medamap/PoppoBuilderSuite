const AgentCoordinator = require('../agents/core/agent-coordinator');
const Logger = require('./logger');
const { v4: uuidv4 } = require('uuid');

/**
 * エージェントアーキテクチャとの統合クラス
 * minimal-poppo.jsから利用される
 */
class AgentIntegration {
  constructor(config = {}) {
    this.logger = new Logger('AgentIntegration');
    this.config = config;
    this.coordinator = null;
    this.enabled = config.agentMode?.enabled || false;
    this.taskMapping = config.agentMode?.taskMapping || this.getDefaultTaskMapping();
  }
  
  /**
   * 初期化
   */
  async initialize() {
    if (!this.enabled) {
      this.logger.info('エージェントモードは無効です');
      return;
    }
    
    this.logger.info('エージェントモードを初期化中...');
    
    try {
      this.coordinator = new AgentCoordinator({
        pollingInterval: this.config.agentMode?.pollingInterval || 3000,
        autoRestart: this.config.agentMode?.autoRestart !== false
      });
      
      // イベントリスナーの設定
      this.setupEventListeners();
      
      // コーディネーターの初期化
      await this.coordinator.initialize();
      
      this.logger.info('エージェントモードの初期化完了');
      
    } catch (error) {
      this.logger.error(`エージェントモード初期化エラー: ${error.message}`);
      this.enabled = false;
      throw error;
    }
  }
  
  /**
   * イベントリスナーの設定
   */
  setupEventListeners() {
    // タスク進捗
    this.coordinator.on('task:progress', ({ taskId, progress, message }) => {
      this.logger.info(`[${taskId}] 進捗: ${message} (${progress}%)`);
    });
    
    // タスク完了
    this.coordinator.on('task:completed', ({ taskId, result }) => {
      this.logger.info(`[${taskId}] タスク完了`);
    });
    
    // タスクエラー
    this.coordinator.on('task:error', ({ taskId, error }) => {
      this.logger.error(`[${taskId}] タスクエラー: ${error.message}`);
    });
  }
  
  /**
   * Issueの処理（エージェントモード）
   */
  async processIssueWithAgents(issue) {
    if (!this.enabled || !this.coordinator) {
      throw new Error('エージェントモードが有効ではありません');
    }
    
    const { number, title, body, labels } = issue;
    const taskId = `issue-${number}`;
    
    this.logger.info(`エージェントモードでIssue #${number}を処理開始`);
    
    // ラベルからタスクタイプを決定
    const taskTypes = this.determineTaskTypes(labels, body);
    
    if (taskTypes.length === 0) {
      this.logger.warn('適切なタスクタイプが見つかりません。デフォルト処理を使用します。');
      return null;
    }
    
    const results = [];
    
    // 各タスクタイプに対してエージェントを割り当て
    for (const taskType of taskTypes) {
      try {
        const subTaskId = `${taskId}-${taskType}`;
        
        const taskResult = await this.coordinator.assignTask(
          subTaskId,
          taskType,
          {
            issueNumber: number,
            issueTitle: title,
            issueBody: body,
            labels: labels.map(l => l.name),
            priority: this.determinePriority(labels)
          },
          this.preparePayload(taskType, issue)
        );
        
        // タスク完了を待つ
        const result = await this.waitForTaskCompletion(subTaskId, taskType);
        results.push(result);
        
      } catch (error) {
        this.logger.error(`タスク ${taskType} の処理中にエラー: ${error.message}`);
        results.push({
          taskType,
          success: false,
          error: error.message
        });
      }
    }
    
    // 結果を統合
    return this.consolidateResults(results, issue);
  }
  
  /**
   * タスクタイプの決定
   */
  determineTaskTypes(labels, body) {
    const taskTypes = [];
    const labelNames = labels.map(l => l.name);
    
    // ラベルベースのマッピング
    for (const [pattern, types] of Object.entries(this.taskMapping.labels)) {
      if (labelNames.some(label => label.includes(pattern))) {
        taskTypes.push(...types);
      }
    }
    
    // キーワードベースのマッピング
    const bodyLower = body.toLowerCase();
    for (const [keyword, types] of Object.entries(this.taskMapping.keywords)) {
      if (bodyLower.includes(keyword)) {
        taskTypes.push(...types);
      }
    }
    
    // 重複を除去
    return [...new Set(taskTypes)];
  }
  
  /**
   * 優先度の決定
   */
  determinePriority(labels) {
    const labelNames = labels.map(l => l.name);
    
    if (labelNames.includes('priority:critical')) return 'critical';
    if (labelNames.includes('priority:high')) return 'high';
    if (labelNames.includes('task:dogfooding')) return 'high';
    if (labelNames.includes('priority:low')) return 'low';
    
    return 'normal';
  }
  
  /**
   * ペイロードの準備
   */
  preparePayload(taskType, issue) {
    const { number, title, body } = issue;
    
    switch (taskType) {
      case 'code-review':
        // コードレビュー用のファイルリストを抽出
        return {
          files: this.extractFilePaths(body),
          issueNumber: number,
          issueBody: body
        };
        
      case 'generate-docs':
        // ドキュメント生成対象を抽出
        return {
          targetFiles: this.extractFilePaths(body),
          docType: 'api',
          outputDir: 'docs/generated'
        };
        
      case 'create-comment':
        // コメント作成用の情報
        return {
          issueNumber: number,
          commentType: 'task-processing',
          additionalContext: `Issue: ${title}\n${body}`,
          language: 'ja'
        };
        
      case 'update-readme':
        // README更新情報
        return {
          updates: [{
            section: 'features',
            content: `Issue #${number}: ${title}`
          }],
          language: 'ja'
        };
        
      case 'quality-assurance':
        // 品質保証用の情報
        return {
          issueNumber: number,
          repository: issue.repository || 'medamap/PoppoBuilderSuite',
          changes: this.extractFilePaths(body),
          pullRequest: this.extractPullRequestNumber(body)
        };
        
      default:
        return {
          issueNumber: number,
          issueTitle: title,
          issueBody: body
        };
    }
  }
  
  /**
   * ファイルパスの抽出
   */
  extractFilePaths(text) {
    const filePathRegex = /(?:^|\s)((?:\.\/)?(?:[\w-]+\/)*[\w-]+\.[\w]+)/gm;
    const matches = [];
    let match;
    
    while ((match = filePathRegex.exec(text)) !== null) {
      matches.push(match[1]);
    }
    
    return matches.length > 0 ? matches : ['src/minimal-poppo.js']; // デフォルト
  }
  
  /**
   * Pull Request番号の抽出
   */
  extractPullRequestNumber(text) {
    const prRegex = /#(\d+)|PR\s*#?(\d+)|pull request\s*#?(\d+)/gi;
    const match = prRegex.exec(text);
    
    if (match) {
      return parseInt(match[1] || match[2] || match[3]);
    }
    
    return null;
  }
  
  /**
   * タスク完了を待つ
   */
  async waitForTaskCompletion(taskId, taskType, timeout = 300000) {
    return new Promise((resolve, reject) => {
      const timeoutTimer = setTimeout(() => {
        reject(new Error(`タスク ${taskId} がタイムアウトしました`));
      }, timeout);
      
      const checkCompletion = () => {
        const task = this.coordinator.activeTasks.get(taskId);
        
        if (!task) {
          // タスクが完了してアクティブリストから削除された
          clearTimeout(timeoutTimer);
          resolve({
            taskId,
            taskType,
            success: true,
            message: 'タスクが完了しました'
          });
          return;
        }
        
        if (task.status === 'completed') {
          clearTimeout(timeoutTimer);
          resolve({
            taskId,
            taskType,
            success: true,
            result: task.result
          });
        } else if (task.status === 'error') {
          clearTimeout(timeoutTimer);
          resolve({
            taskId,
            taskType,
            success: false,
            error: task.error
          });
        } else {
          // まだ処理中
          setTimeout(checkCompletion, 1000);
        }
      };
      
      // 初回チェック
      setTimeout(checkCompletion, 1000);
    });
  }
  
  /**
   * 結果の統合
   */
  consolidateResults(results, issue) {
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);
    
    let consolidatedOutput = `# Issue #${issue.number} 処理結果\n\n`;
    
    if (successful.length > 0) {
      consolidatedOutput += `## 成功したタスク (${successful.length}件)\n\n`;
      
      successful.forEach(result => {
        consolidatedOutput += `### ${result.taskType}\n`;
        
        if (result.result) {
          // エージェントからの詳細な結果を含める
          if (result.result.summary) {
            consolidatedOutput += `${result.result.summary}\n\n`;
          }
          if (result.result.details) {
            consolidatedOutput += `詳細:\n${JSON.stringify(result.result.details, null, 2)}\n\n`;
          }
        } else {
          consolidatedOutput += `${result.message || 'タスクが正常に完了しました。'}\n\n`;
        }
      });
    }
    
    if (failed.length > 0) {
      consolidatedOutput += `## 失敗したタスク (${failed.length}件)\n\n`;
      
      failed.forEach(result => {
        consolidatedOutput += `### ${result.taskType}\n`;
        consolidatedOutput += `エラー: ${result.error}\n\n`;
      });
    }
    
    // 統計情報
    consolidatedOutput += `## 処理統計\n`;
    consolidatedOutput += `- 総タスク数: ${results.length}\n`;
    consolidatedOutput += `- 成功: ${successful.length}\n`;
    consolidatedOutput += `- 失敗: ${failed.length}\n`;
    
    return {
      success: failed.length === 0,
      output: consolidatedOutput,
      stats: {
        total: results.length,
        successful: successful.length,
        failed: failed.length
      },
      results
    };
  }
  
  /**
   * デフォルトのタスクマッピング
   */
  getDefaultTaskMapping() {
    return {
      labels: {
        'review': ['code-review'],
        'documentation': ['generate-docs', 'update-readme'],
        'security': ['security-audit'],
        'refactor': ['refactoring-suggestion'],
        'dogfooding': ['code-review', 'generate-docs'],
        'quality': ['quality-assurance'],
        'test': ['quality-assurance'],
        'qa': ['quality-assurance']
      },
      keywords: {
        'レビュー': ['code-review'],
        'review': ['code-review'],
        'ドキュメント': ['generate-docs'],
        'document': ['generate-docs'],
        'セキュリティ': ['security-audit'],
        'security': ['security-audit'],
        'リファクタリング': ['refactoring-suggestion'],
        'refactor': ['refactoring-suggestion'],
        '品質': ['quality-assurance'],
        'quality': ['quality-assurance'],
        'テスト': ['quality-assurance'],
        'test': ['quality-assurance']
      }
    };
  }
  
  /**
   * 統計情報の取得
   */
  getStats() {
    if (!this.coordinator) {
      return null;
    }
    
    return this.coordinator.getStats();
  }
  
  /**
   * シャットダウン
   */
  async shutdown() {
    if (this.coordinator) {
      await this.coordinator.shutdown();
    }
  }
}

module.exports = AgentIntegration;