const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');
const { createLogger } = require('./logger');

/**
 * プロジェクトマネージャー
 * 複数のプロジェクトの設定と状態を管理する
 */
class ProjectManager {
  constructor(globalQueueManager) {
    this.logger = createLogger('ProjectManager');
    this.globalQueue = globalQueueManager;
    this.projects = new Map();
  }
  
  /**
   * プロジェクトを自動検出して登録
   */
  async autoDetectProject(projectPath) {
    try {
      // プロジェクトパスの検証
      const stats = await fs.stat(projectPath);
      if (!stats.isDirectory()) {
        throw new Error('指定されたパスはディレクトリではありません');
      }
      
      // .poppo/project.json を確認
      const projectConfigPath = path.join(projectPath, '.poppo', 'project.json');
      let projectConfig = {};
      
      try {
        const configData = await fs.readFile(projectConfigPath, 'utf-8');
        projectConfig = JSON.parse(configData);
      } catch (error) {
        // 設定ファイルがない場合は新規作成
        this.logger.info('プロジェクト設定ファイルが見つかりません。新規作成します。');
      }
      
      // GitHubリポジトリ情報を取得
      let repoInfo = null;
      try {
        const remoteUrl = execSync('git config --get remote.origin.url', {
          cwd: projectPath,
          encoding: 'utf-8'
        }).trim();
        
        // URLからオーナーとリポジトリ名を抽出
        const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
        if (match) {
          repoInfo = {
            owner: match[1],
            repo: match[2],
            fullName: `${match[1]}/${match[2]}`
          };
        }
      } catch (error) {
        this.logger.warn('Gitリポジトリ情報を取得できませんでした', { error: error.message });
      }
      
      // プロジェクト情報を構築
      const projectId = projectConfig.id || (repoInfo ? repoInfo.fullName : path.basename(projectPath));
      const projectName = projectConfig.name || (repoInfo ? repoInfo.repo : path.basename(projectPath));
      
      const projectInfo = {
        id: projectId,
        name: projectName,
        path: projectPath,
        priority: projectConfig.priority || 50,
        config: {
          repository: repoInfo,
          labels: projectConfig.labels || {
            misc: 'task:misc',
            dogfooding: 'task:dogfooding',
            bug: 'task:bug',
            feature: 'task:feature'
          },
          pollingInterval: projectConfig.pollingInterval || 30000,
          maxConcurrentTasks: projectConfig.maxConcurrentTasks || 2,
          ...projectConfig
        }
      };
      
      // グローバルキューに登録
      const registeredProject = await this.globalQueue.registerProject(projectInfo);
      
      // プロジェクト設定を保存
      await this.saveProjectConfig(projectPath, registeredProject);
      
      this.logger.info('プロジェクトを自動検出して登録しました', { project: registeredProject });
      return registeredProject;
      
    } catch (error) {
      this.logger.error('プロジェクトの自動検出に失敗しました:', error);
      throw error;
    }
  }
  
  /**
   * プロジェクト設定を保存
   */
  async saveProjectConfig(projectPath, projectInfo) {
    const poppoDir = path.join(projectPath, '.poppo');
    const configPath = path.join(poppoDir, 'project.json');
    
    try {
      await fs.mkdir(poppoDir, { recursive: true });
      
      const config = {
        id: projectInfo.id,
        name: projectInfo.name,
        priority: projectInfo.priority,
        ...projectInfo.config
      };
      
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      this.logger.info('プロジェクト設定を保存しました', { path: configPath });
      
    } catch (error) {
      this.logger.error('プロジェクト設定の保存に失敗しました:', error);
      throw error;
    }
  }
  
  /**
   * プロジェクトのタスクをスキャン
   */
  async scanProjectTasks(projectId) {
    const project = await this.globalQueue.projects.get(projectId);
    if (!project) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    const tasks = [];
    
    try {
      // GitHub CLIを使用してIssueを取得
      const command = `gh issue list --repo ${project.id} --state open --json number,title,labels,createdAt --limit 100`;
      const output = execSync(command, {
        cwd: project.path,
        encoding: 'utf-8'
      });
      
      const issues = JSON.parse(output);
      
      for (const issue of issues) {
        // 対象ラベルを持つIssueのみ処理
        const hasTargetLabel = issue.labels.some(label => 
          Object.values(project.config.labels).includes(label.name)
        );
        
        if (hasTargetLabel) {
          // 優先度を決定
          let priority = 50;
          if (issue.labels.some(l => l.name === project.config.labels.dogfooding)) {
            priority = 100;
          } else if (issue.labels.some(l => l.name === project.config.labels.bug)) {
            priority = 75;
          } else if (issue.labels.some(l => l.name === project.config.labels.feature)) {
            priority = 60;
          }
          
          tasks.push({
            projectId: project.id,
            issueNumber: issue.number,
            priority,
            metadata: {
              title: issue.title,
              labels: issue.labels.map(l => l.name),
              createdAt: issue.createdAt
            }
          });
        }
      }
      
      this.logger.info('プロジェクトタスクをスキャンしました', {
        projectId,
        foundTasks: tasks.length
      });
      
      return tasks;
      
    } catch (error) {
      this.logger.error('タスクのスキャンに失敗しました:', error);
      throw error;
    }
  }
  
  /**
   * プロジェクトの優先度を更新
   */
  async updateProjectPriority(projectId, newPriority) {
    const project = await this.globalQueue.projects.get(projectId);
    if (!project) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    if (newPriority < 0 || newPriority > 100) {
      throw new Error('優先度は0-100の範囲で指定してください');
    }
    
    project.priority = newPriority;
    await this.globalQueue.saveProjects();
    
    // プロジェクト設定ファイルも更新
    await this.saveProjectConfig(project.path, project);
    
    this.logger.info('プロジェクト優先度を更新しました', { projectId, newPriority });
    return project;
  }
  
  /**
   * プロジェクトのラベル設定を更新
   */
  async updateProjectLabels(projectId, labels) {
    const project = await this.globalQueue.projects.get(projectId);
    if (!project) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    project.config.labels = { ...project.config.labels, ...labels };
    await this.globalQueue.saveProjects();
    
    // プロジェクト設定ファイルも更新
    await this.saveProjectConfig(project.path, project);
    
    this.logger.info('プロジェクトラベル設定を更新しました', { projectId, labels });
    return project;
  }
  
  /**
   * すべてのプロジェクトの状態を取得
   */
  async getAllProjectsStatus() {
    const projects = [];
    
    for (const [projectId, project] of this.globalQueue.projects) {
      const queueStatus = this.globalQueue.getTasksByProject()[projectId] || {
        queued: 0,
        processing: 0
      };
      
      const stats = this.globalQueue.statistics.byProject[projectId] || {
        enqueued: 0,
        completed: 0,
        failed: 0
      };
      
      projects.push({
        ...project,
        currentQueue: queueStatus,
        statistics: stats,
        health: this.calculateProjectHealth(stats)
      });
    }
    
    return projects.sort((a, b) => b.priority - a.priority);
  }
  
  /**
   * プロジェクトの健全性を計算
   */
  calculateProjectHealth(stats) {
    const total = stats.completed + stats.failed;
    if (total === 0) return 'unknown';
    
    const successRate = stats.completed / total;
    if (successRate >= 0.9) return 'excellent';
    if (successRate >= 0.7) return 'good';
    if (successRate >= 0.5) return 'fair';
    return 'poor';
  }
  
  /**
   * プロジェクトのリソース使用状況を取得
   */
  async getProjectResourceUsage(projectId) {
    const project = await this.globalQueue.projects.get(projectId);
    if (!project) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    // 現在の実行中タスク数
    const runningTasks = Array.from(this.globalQueue.runningTasks.values())
      .filter(task => task.projectId === projectId).length;
    
    // キュー内のタスク数
    const queuedTasks = this.globalQueue.queue
      .filter(task => task.projectId === projectId && task.status === 'queued').length;
    
    // 過去1時間の処理タスク数
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentTasks = this.globalQueue.queue
      .filter(task => 
        task.projectId === projectId && 
        new Date(task.completedAt || task.startedAt).getTime() > oneHourAgo
      ).length;
    
    return {
      projectId,
      runningTasks,
      queuedTasks,
      maxConcurrentTasks: project.config.maxConcurrentTasks || 2,
      utilizationRate: runningTasks / (project.config.maxConcurrentTasks || 2),
      tasksPerHour: recentTasks
    };
  }
  
  /**
   * プロジェクト間のリソース割り当てを最適化
   */
  async optimizeResourceAllocation() {
    const projects = await this.getAllProjectsStatus();
    const totalResources = projects.reduce((sum, p) => sum + (p.config.maxConcurrentTasks || 2), 0);
    
    // 優先度とキュー長に基づいてリソースを再配分
    for (const project of projects) {
      const queueLength = project.currentQueue.queued;
      const priority = project.priority;
      
      // 基本割り当て + 優先度ボーナス + キュー長ボーナス
      const baseAllocation = 1;
      const priorityBonus = Math.floor(priority / 20);
      const queueBonus = Math.min(Math.floor(queueLength / 10), 3);
      
      const newAllocation = baseAllocation + priorityBonus + queueBonus;
      
      if (project.config.maxConcurrentTasks !== newAllocation) {
        project.config.maxConcurrentTasks = newAllocation;
        await this.updateProjectConfig(project.id, { maxConcurrentTasks: newAllocation });
        
        this.logger.info('リソース割り当てを最適化しました', {
          projectId: project.id,
          oldAllocation: project.config.maxConcurrentTasks,
          newAllocation
        });
      }
    }
  }
  
  /**
   * プロジェクト設定を更新
   */
  async updateProjectConfig(projectId, updates) {
    const project = await this.globalQueue.projects.get(projectId);
    if (!project) {
      throw new Error(`プロジェクト ${projectId} が見つかりません`);
    }
    
    project.config = { ...project.config, ...updates };
    await this.globalQueue.saveProjects();
    await this.saveProjectConfig(project.path, project);
    
    return project;
  }
}

module.exports = ProjectManager;