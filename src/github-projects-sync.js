const GitHubProjectsClient = require('./github-projects-client');
const EventEmitter = require('events');

/**
 * GitHub Projects同期マネージャー
 * PoppoBuilderのIssue処理状態とGitHub Projectsを自動同期
 */
class GitHubProjectsSync extends EventEmitter {
  constructor(config, github, statusManager, logger) {
    super();
    this.config = config.githubProjects || {};
    this.github = github;
    this.statusManager = statusManager;
    this.logger = logger;
    
    // GitHub Projectsクライアントの初期化
    this.projectsClient = new GitHubProjectsClient(
      process.env.GITHUB_TOKEN || this.config.token,
      logger
    );
    
    // プロジェクト設定のキャッシュ
    this.projectCache = new Map();
    this.syncInterval = null;
    this.isInitialized = false;
  }

  /**
   * 初期化
   */
  async initialize() {
    if (!this.config.enabled) {
      this.logger?.info('GitHub Projects同期は無効化されています');
      return;
    }
    
    try {
      // 設定されたプロジェクトの情報を取得
      for (const projectConfig of this.config.projects || []) {
        const project = await this.projectsClient.getProject(projectConfig.id);
        const statusField = await this.projectsClient.getStatusField(projectConfig.id);
        
        this.projectCache.set(projectConfig.id, {
          ...project,
          config: projectConfig,
          statusField
        });
        
        this.logger?.info(`プロジェクト初期化完了: ${project.title}`);
      }
      
      // StatusManagerのイベントをリッスン
      this.setupEventListeners();
      
      this.isInitialized = true;
      this.emit('initialized');
      
    } catch (error) {
      this.logger?.error('GitHub Projects同期の初期化エラー:', error);
      throw error;
    }
  }

  /**
   * イベントリスナーの設定
   */
  setupEventListeners() {
    // StatusManagerのイベントを監視
    this.statusManager.on('status-changed', async (issueNumber, newStatus, oldStatus) => {
      try {
        await this.syncIssueStatus(issueNumber, newStatus);
      } catch (error) {
        this.logger?.error(`Issue #${issueNumber} の同期エラー:`, error);
      }
    });
  }

  /**
   * Issueのステータスを同期
   */
  async syncIssueStatus(issueNumber, poppoStatus) {
    if (!this.isInitialized) {
      this.logger?.warn('GitHub Projects同期が初期化されていません');
      return;
    }
    
    // 各プロジェクトに対して同期を実行
    for (const [projectId, projectInfo] of this.projectCache) {
      try {
        await this.syncToProject(projectId, issueNumber, poppoStatus, projectInfo);
      } catch (error) {
        this.logger?.error(`プロジェクト ${projectInfo.title} への同期エラー:`, error);
      }
    }
  }

  /**
   * 特定のプロジェクトに同期
   */
  async syncToProject(projectId, issueNumber, poppoStatus, projectInfo) {
    const { config, statusField } = projectInfo;
    
    // ステータスマッピングを取得
    const projectStatus = this.mapStatus(poppoStatus, config.statusMapping);
    if (!projectStatus) {
      this.logger?.info(`ステータス '${poppoStatus}' はマッピングされていません`);
      return;
    }
    
    // プロジェクト内のアイテムを検索
    let projectItem = await this.projectsClient.findProjectItem(projectId, issueNumber);
    
    // アイテムが存在しない場合は追加
    if (!projectItem) {
      // IssueのノードIDを取得
      const issueNodeId = await this.projectsClient.getIssueNodeId(
        this.github.owner,
        this.github.repo,
        issueNumber
      );
      
      if (!issueNodeId) {
        this.logger?.error(`Issue #${issueNumber} のノードIDが取得できません`);
        return;
      }
      
      // プロジェクトに追加
      const newItem = await this.projectsClient.addIssueToProject(projectId, issueNodeId);
      projectItem = { id: newItem.id };
      
      this.logger?.info(`Issue #${issueNumber} をプロジェクトに追加しました`);
      this.emit('item-added', { projectId, issueNumber });
    }
    
    // ステータスを更新
    const statusOptionId = this.projectsClient.getStatusOptionId(statusField, projectStatus);
    await this.projectsClient.updateItemStatus(
      projectId,
      projectItem.id,
      statusField.id,
      statusOptionId
    );
    
    this.logger?.info(`Issue #${issueNumber} のステータスを '${projectStatus}' に更新しました`);
    this.emit('status-updated', {
      projectId,
      issueNumber,
      oldStatus: poppoStatus,
      newStatus: projectStatus
    });
    
    // 完了時の処理
    if (config.autoArchive && (poppoStatus === 'completed' || poppoStatus === 'closed')) {
      await this.projectsClient.archiveProjectItem(projectId, projectItem.id);
      this.logger?.info(`Issue #${issueNumber} をアーカイブしました`);
      this.emit('item-archived', { projectId, issueNumber });
    }
  }

  /**
   * PoppoBuilderのステータスをプロジェクトのステータスにマッピング
   */
  mapStatus(poppoStatus, mapping = {}) {
    // デフォルトマッピング
    const defaultMapping = {
      'pending': 'Todo',
      'processing': 'In Progress',
      'awaiting-response': 'In Review',
      'completed': 'Done',
      'error': 'Blocked',
      'skipped': 'Cancelled'
    };
    
    const statusMapping = { ...defaultMapping, ...mapping };
    return statusMapping[poppoStatus];
  }

  /**
   * プロジェクトからIssueを同期（逆方向）
   */
  async syncFromProject(projectId) {
    const projectInfo = this.projectCache.get(projectId);
    if (!projectInfo) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    // プロジェクトのアイテムを取得
    const items = await this.projectsClient.getProjectItems(projectId);
    
    for (const item of items) {
      if (!item.content || !item.content.number) continue;
      
      const issueNumber = item.content.number;
      const projectStatus = this.getItemStatus(item, projectInfo.statusField);
      
      if (projectStatus) {
        // 逆マッピングでPoppoBuilderのステータスを取得
        const poppoStatus = this.reverseMapStatus(projectStatus, projectInfo.config.statusMapping);
        
        if (poppoStatus) {
          // StatusManagerを通じて状態を更新
          await this.statusManager.updateStatus(issueNumber, poppoStatus, {
            source: 'github-projects',
            projectId
          });
          
          this.logger?.info(`Issue #${issueNumber} のステータスをプロジェクトから同期: ${poppoStatus}`);
        }
      }
    }
  }

  /**
   * アイテムから現在のステータスを取得
   */
  getItemStatus(item, statusField) {
    const statusValue = item.fieldValues.nodes.find(fv => 
      fv.field && fv.field.name === statusField.name
    );
    
    return statusValue?.name;
  }

  /**
   * プロジェクトステータスをPoppoBuilderステータスに逆マッピング
   */
  reverseMapStatus(projectStatus, mapping = {}) {
    const defaultMapping = {
      'Todo': 'pending',
      'In Progress': 'processing',
      'In Review': 'awaiting-response',
      'Done': 'completed',
      'Blocked': 'error',
      'Cancelled': 'skipped'
    };
    
    const reverseMapping = {};
    const statusMapping = { ...defaultMapping, ...mapping };
    
    // マッピングを逆転
    for (const [poppo, project] of Object.entries(statusMapping)) {
      reverseMapping[project] = poppo;
    }
    
    return reverseMapping[projectStatus];
  }

  /**
   * 定期同期を開始
   */
  startPeriodicSync(interval = 300000) { // デフォルト5分
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    this.syncInterval = setInterval(async () => {
      try {
        await this.syncAllProjects();
      } catch (error) {
        this.logger?.error('定期同期エラー:', error);
      }
    }, interval);
    
    this.logger?.info(`定期同期を開始しました（間隔: ${interval / 1000}秒）`);
  }

  /**
   * 定期同期を停止
   */
  stopPeriodicSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      this.logger?.info('定期同期を停止しました');
    }
  }

  /**
   * すべてのプロジェクトを同期
   */
  async syncAllProjects() {
    this.logger?.info('全プロジェクトの同期を開始');
    
    for (const [projectId] of this.projectCache) {
      try {
        await this.syncFromProject(projectId);
      } catch (error) {
        this.logger?.error(`プロジェクト ${projectId} の同期エラー:`, error);
      }
    }
    
    this.emit('sync-completed');
  }

  /**
   * プロジェクト進捗レポートを生成
   */
  async generateProgressReport(projectId) {
    const projectInfo = this.projectCache.get(projectId);
    if (!projectInfo) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    const items = await this.projectsClient.getProjectItems(projectId);
    
    // ステータス別の集計
    const statusCount = {};
    let totalItems = 0;
    
    for (const item of items) {
      if (!item.content) continue;
      
      const status = this.getItemStatus(item, projectInfo.statusField);
      if (status) {
        statusCount[status] = (statusCount[status] || 0) + 1;
        totalItems++;
      }
    }
    
    // 進捗率の計算
    const completedStatuses = ['Done', 'Closed'];
    const completedCount = completedStatuses.reduce((sum, status) => 
      sum + (statusCount[status] || 0), 0
    );
    const progressRate = totalItems > 0 ? (completedCount / totalItems * 100).toFixed(1) : 0;
    
    return {
      projectId,
      projectTitle: projectInfo.title,
      totalItems,
      statusCount,
      completedCount,
      progressRate: `${progressRate}%`,
      lastUpdated: new Date().toISOString()
    };
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    this.stopPeriodicSync();
    this.removeAllListeners();
    this.projectCache.clear();
  }
}

module.exports = GitHubProjectsSync;