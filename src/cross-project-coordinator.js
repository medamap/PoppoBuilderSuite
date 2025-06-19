const EventEmitter = require('events');
const { createLogger } = require('./logger');

/**
 * クロスプロジェクトコーディネーター
 * プロジェクト間の依存関係管理、共通Issue/PRのトラッキング、
 * 知識共有、統合レポート生成を実装
 */
class CrossProjectCoordinator extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = createLogger('CrossProjectCoordinator');
    
    // 設定
    this.config = {
      enableDependencyTracking: config.enableDependencyTracking !== false,
      enableKnowledgeSharing: config.enableKnowledgeSharing !== false,
      enableCrossProjectIssues: config.enableCrossProjectIssues !== false,
      knowledgeRetentionDays: config.knowledgeRetentionDays || 90,
      ...config
    };
    
    // プロジェクト依存関係
    this.dependencies = new Map(); // projectId -> Set<dependentProjectId>
    this.reverseDependencies = new Map(); // projectId -> Set<dependsOnProjectId>
    
    // 共通Issue/PRトラッキング
    this.crossProjectIssues = new Map(); // issueId -> { projects: Set, metadata }
    this.crossProjectPRs = new Map(); // prId -> { projects: Set, metadata }
    
    // 知識ベース
    this.knowledgeBase = new Map(); // topic -> { content, projects, metadata }
    this.projectKnowledge = new Map(); // projectId -> Set<topicId>
    
    // 統計情報
    this.statistics = {
      dependencies: {
        total: 0,
        circular: 0,
        depth: new Map() // projectId -> depth
      },
      crossProjectIssues: {
        total: 0,
        byStatus: {},
        byProjects: {}
      },
      knowledgeSharing: {
        topics: 0,
        contributions: 0,
        queries: 0
      }
    };
  }

  /**
   * 初期化
   */
  async initialize() {
    try {
      this.logger.info('クロスプロジェクトコーディネーターを初期化しました');
      return true;
    } catch (error) {
      this.logger.error('初期化エラー:', error);
      throw error;
    }
  }

  /**
   * プロジェクト依存関係を設定
   */
  async setDependency(projectId, dependsOn) {
    if (!this.config.enableDependencyTracking) {
      return;
    }
    
    // 依存関係の配列化
    const dependencies = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
    
    // 循環依存のチェック
    for (const depId of dependencies) {
      if (await this.checkCircularDependency(projectId, depId)) {
        throw new Error(`循環依存が検出されました: ${projectId} <-> ${depId}`);
      }
    }
    
    // 依存関係を設定
    if (!this.dependencies.has(projectId)) {
      this.dependencies.set(projectId, new Set());
    }
    
    for (const depId of dependencies) {
      this.dependencies.get(projectId).add(depId);
      
      // 逆依存関係も記録
      if (!this.reverseDependencies.has(depId)) {
        this.reverseDependencies.set(depId, new Set());
      }
      this.reverseDependencies.get(depId).add(projectId);
    }
    
    // 統計を更新
    this.updateDependencyStatistics();
    
    this.logger.info('プロジェクト依存関係を設定しました', {
      projectId,
      dependsOn: dependencies
    });
    
    this.emit('dependencySet', { projectId, dependsOn: dependencies });
  }

  /**
   * 循環依存をチェック
   */
  async checkCircularDependency(projectId, newDependency, visited = new Set()) {
    if (projectId === newDependency) {
      return true;
    }
    
    if (visited.has(newDependency)) {
      return false;
    }
    
    visited.add(newDependency);
    
    const deps = this.dependencies.get(newDependency);
    if (!deps) {
      return false;
    }
    
    for (const dep of deps) {
      if (dep === projectId) {
        return true;
      }
      if (await this.checkCircularDependency(projectId, dep, visited)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * プロジェクトの依存関係を取得
   */
  getDependencies(projectId) {
    return {
      dependsOn: Array.from(this.dependencies.get(projectId) || []),
      dependents: Array.from(this.reverseDependencies.get(projectId) || [])
    };
  }

  /**
   * 依存関係グラフを取得
   */
  getDependencyGraph() {
    const graph = {
      nodes: [],
      edges: []
    };
    
    // ノードを追加
    const allProjects = new Set([
      ...this.dependencies.keys(),
      ...this.reverseDependencies.keys()
    ]);
    
    for (const projectId of allProjects) {
      graph.nodes.push({
        id: projectId,
        depth: this.calculateDependencyDepth(projectId)
      });
    }
    
    // エッジを追加
    for (const [projectId, deps] of this.dependencies) {
      for (const depId of deps) {
        graph.edges.push({
          from: projectId,
          to: depId,
          type: 'depends_on'
        });
      }
    }
    
    return graph;
  }

  /**
   * 依存関係の深さを計算
   */
  calculateDependencyDepth(projectId, visited = new Set()) {
    if (visited.has(projectId)) {
      return 0;
    }
    
    visited.add(projectId);
    
    const deps = this.dependencies.get(projectId);
    if (!deps || deps.size === 0) {
      return 0;
    }
    
    let maxDepth = 0;
    for (const depId of deps) {
      const depth = this.calculateDependencyDepth(depId, visited);
      maxDepth = Math.max(maxDepth, depth + 1);
    }
    
    return maxDepth;
  }

  /**
   * クロスプロジェクトIssueを登録
   */
  async registerCrossProjectIssue(issueId, metadata) {
    if (!this.config.enableCrossProjectIssues) {
      return;
    }
    
    const {
      title,
      description,
      projects,
      labels = [],
      priority = 50,
      status = 'open'
    } = metadata;
    
    if (!projects || projects.length < 2) {
      throw new Error('クロスプロジェクトIssueには少なくとも2つのプロジェクトが必要です');
    }
    
    const issue = {
      id: issueId,
      title,
      description,
      projects: new Set(projects),
      labels,
      priority,
      status,
      createdAt: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      projectStatus: {} // projectId -> { status, progress }
    };
    
    // 各プロジェクトの初期ステータス
    for (const projectId of projects) {
      issue.projectStatus[projectId] = {
        status: 'pending',
        progress: 0,
        assignedTasks: []
      };
    }
    
    this.crossProjectIssues.set(issueId, issue);
    
    // 統計を更新
    this.updateCrossProjectStatistics();
    
    this.logger.info('クロスプロジェクトIssueを登録しました', {
      issueId,
      projects: projects.length
    });
    
    this.emit('crossProjectIssueRegistered', issue);
    
    return issue;
  }

  /**
   * クロスプロジェクトIssueのステータスを更新
   */
  async updateCrossProjectIssue(issueId, projectId, update) {
    const issue = this.crossProjectIssues.get(issueId);
    if (!issue) {
      throw new Error(`クロスプロジェクトIssue ${issueId} が見つかりません`);
    }
    
    if (!issue.projects.has(projectId)) {
      throw new Error(`プロジェクト ${projectId} はこのIssueに関連していません`);
    }
    
    // プロジェクト固有のステータスを更新
    if (update.status !== undefined) {
      issue.projectStatus[projectId].status = update.status;
    }
    if (update.progress !== undefined) {
      issue.projectStatus[projectId].progress = update.progress;
    }
    if (update.assignedTasks !== undefined) {
      issue.projectStatus[projectId].assignedTasks = update.assignedTasks;
    }
    
    // 全体のステータスを再計算
    issue.status = this.calculateOverallStatus(issue);
    issue.lastUpdated = new Date().toISOString();
    
    this.logger.info('クロスプロジェクトIssueを更新しました', {
      issueId,
      projectId,
      update
    });
    
    this.emit('crossProjectIssueUpdated', { issueId, projectId, update });
    
    return issue;
  }

  /**
   * 全体のステータスを計算
   */
  calculateOverallStatus(issue) {
    const statuses = Object.values(issue.projectStatus).map(ps => ps.status);
    
    if (statuses.every(s => s === 'completed')) {
      return 'completed';
    }
    if (statuses.some(s => s === 'failed')) {
      return 'failed';
    }
    if (statuses.some(s => s === 'in_progress')) {
      return 'in_progress';
    }
    if (statuses.some(s => s === 'pending')) {
      return 'open';
    }
    
    return 'unknown';
  }

  /**
   * 知識を共有
   */
  async shareKnowledge(topic, content, metadata = {}) {
    if (!this.config.enableKnowledgeSharing) {
      return;
    }
    
    const {
      projectId,
      category = 'general',
      tags = [],
      confidence = 1.0
    } = metadata;
    
    const topicId = this.generateTopicId(topic, category);
    
    // 既存の知識を更新または新規作成
    let knowledge = this.knowledgeBase.get(topicId);
    
    if (!knowledge) {
      knowledge = {
        id: topicId,
        topic,
        category,
        content: [],
        projects: new Set(),
        tags: new Set(tags),
        metadata: {
          createdAt: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          contributions: 0,
          queries: 0,
          averageConfidence: confidence
        }
      };
      this.knowledgeBase.set(topicId, knowledge);
    }
    
    // コンテンツを追加
    knowledge.content.push({
      text: content,
      projectId,
      confidence,
      timestamp: new Date().toISOString()
    });
    
    // プロジェクトを追加
    if (projectId) {
      knowledge.projects.add(projectId);
      
      // プロジェクトの知識マップを更新
      if (!this.projectKnowledge.has(projectId)) {
        this.projectKnowledge.set(projectId, new Set());
      }
      this.projectKnowledge.get(projectId).add(topicId);
    }
    
    // タグを追加
    tags.forEach(tag => knowledge.tags.add(tag));
    
    // メタデータを更新
    knowledge.metadata.lastUpdated = new Date().toISOString();
    knowledge.metadata.contributions++;
    knowledge.metadata.averageConfidence = 
      (knowledge.metadata.averageConfidence * (knowledge.metadata.contributions - 1) + confidence) / 
      knowledge.metadata.contributions;
    
    // 統計を更新
    this.statistics.knowledgeSharing.contributions++;
    
    this.logger.info('知識を共有しました', {
      topicId,
      category,
      projectId
    });
    
    this.emit('knowledgeShared', { topicId, knowledge });
    
    return knowledge;
  }

  /**
   * 知識を検索
   */
  async searchKnowledge(query, options = {}) {
    const {
      category = null,
      projectId = null,
      tags = [],
      minConfidence = 0.5,
      limit = 10
    } = options;
    
    const results = [];
    
    for (const [topicId, knowledge] of this.knowledgeBase) {
      // カテゴリフィルタ
      if (category && knowledge.category !== category) {
        continue;
      }
      
      // プロジェクトフィルタ
      if (projectId && !knowledge.projects.has(projectId)) {
        continue;
      }
      
      // タグフィルタ
      if (tags.length > 0 && !tags.some(tag => knowledge.tags.has(tag))) {
        continue;
      }
      
      // 信頼度フィルタ
      if (knowledge.metadata.averageConfidence < minConfidence) {
        continue;
      }
      
      // クエリマッチング
      const score = this.calculateRelevanceScore(query, knowledge);
      if (score > 0) {
        results.push({
          topicId,
          knowledge,
          score
        });
      }
    }
    
    // スコアでソート
    results.sort((a, b) => b.score - a.score);
    
    // クエリ数を更新
    results.slice(0, limit).forEach(result => {
      result.knowledge.metadata.queries++;
    });
    
    this.statistics.knowledgeSharing.queries++;
    
    return results.slice(0, limit);
  }

  /**
   * 関連性スコアを計算
   */
  calculateRelevanceScore(query, knowledge) {
    const queryLower = query.toLowerCase();
    let score = 0;
    
    // トピックとのマッチ
    if (knowledge.topic.toLowerCase().includes(queryLower)) {
      score += 10;
    }
    
    // コンテンツとのマッチ
    for (const content of knowledge.content) {
      if (content.text.toLowerCase().includes(queryLower)) {
        score += 5 * content.confidence;
      }
    }
    
    // タグとのマッチ
    for (const tag of knowledge.tags) {
      if (tag.toLowerCase().includes(queryLower)) {
        score += 3;
      }
    }
    
    return score;
  }

  /**
   * プロジェクト間の知識を転送
   */
  async transferKnowledge(fromProjectId, toProjectId, options = {}) {
    const {
      categories = null,
      minConfidence = 0.7
    } = options;
    
    const fromKnowledge = this.projectKnowledge.get(fromProjectId);
    if (!fromKnowledge) {
      return { transferred: 0 };
    }
    
    let transferred = 0;
    
    for (const topicId of fromKnowledge) {
      const knowledge = this.knowledgeBase.get(topicId);
      if (!knowledge) continue;
      
      // カテゴリフィルタ
      if (categories && !categories.includes(knowledge.category)) {
        continue;
      }
      
      // 信頼度フィルタ
      if (knowledge.metadata.averageConfidence < minConfidence) {
        continue;
      }
      
      // プロジェクトに知識を関連付け
      knowledge.projects.add(toProjectId);
      
      if (!this.projectKnowledge.has(toProjectId)) {
        this.projectKnowledge.set(toProjectId, new Set());
      }
      this.projectKnowledge.get(toProjectId).add(topicId);
      
      transferred++;
    }
    
    this.logger.info('プロジェクト間で知識を転送しました', {
      from: fromProjectId,
      to: toProjectId,
      transferred
    });
    
    this.emit('knowledgeTransferred', {
      from: fromProjectId,
      to: toProjectId,
      count: transferred
    });
    
    return { transferred };
  }

  /**
   * 統合レポートを生成
   */
  async generateIntegratedReport(projectIds = null) {
    const report = {
      metadata: {
        generatedAt: new Date().toISOString(),
        projectCount: 0,
        scope: projectIds ? 'selected' : 'all'
      },
      dependencies: {
        graph: null,
        circular: [],
        orphaned: [],
        maxDepth: 0
      },
      crossProjectIssues: {
        total: 0,
        byStatus: {},
        byProject: {},
        critical: []
      },
      knowledgeSharing: {
        totalTopics: this.knowledgeBase.size,
        topContributors: [],
        popularTopics: [],
        knowledgeGaps: []
      },
      recommendations: []
    };
    
    // 対象プロジェクトの決定
    const targetProjects = projectIds ? new Set(projectIds) : null;
    
    // 依存関係分析
    if (this.config.enableDependencyTracking) {
      report.dependencies.graph = this.getDependencyGraph();
      
      // 循環依存の検出
      for (const [projectId, deps] of this.dependencies) {
        if (targetProjects && !targetProjects.has(projectId)) continue;
        
        for (const depId of deps) {
          if (await this.checkCircularDependency(projectId, depId)) {
            report.dependencies.circular.push([projectId, depId]);
          }
        }
      }
      
      // 孤立プロジェクトの検出
      const allProjects = new Set([
        ...this.dependencies.keys(),
        ...this.reverseDependencies.keys()
      ]);
      
      for (const projectId of allProjects) {
        if (targetProjects && !targetProjects.has(projectId)) continue;
        
        const deps = this.dependencies.get(projectId) || new Set();
        const revDeps = this.reverseDependencies.get(projectId) || new Set();
        
        if (deps.size === 0 && revDeps.size === 0) {
          report.dependencies.orphaned.push(projectId);
        }
      }
      
      // 最大深度
      report.dependencies.maxDepth = Math.max(
        ...Array.from(allProjects).map(p => this.calculateDependencyDepth(p))
      );
    }
    
    // クロスプロジェクトIssue分析
    if (this.config.enableCrossProjectIssues) {
      for (const [issueId, issue] of this.crossProjectIssues) {
        // プロジェクトフィルタ
        if (targetProjects) {
          const relevantProjects = Array.from(issue.projects).filter(p => targetProjects.has(p));
          if (relevantProjects.length === 0) continue;
        }
        
        report.crossProjectIssues.total++;
        
        // ステータス別集計
        const status = issue.status;
        report.crossProjectIssues.byStatus[status] = 
          (report.crossProjectIssues.byStatus[status] || 0) + 1;
        
        // プロジェクト別集計
        for (const projectId of issue.projects) {
          if (targetProjects && !targetProjects.has(projectId)) continue;
          
          if (!report.crossProjectIssues.byProject[projectId]) {
            report.crossProjectIssues.byProject[projectId] = {
              total: 0,
              byStatus: {}
            };
          }
          
          report.crossProjectIssues.byProject[projectId].total++;
          report.crossProjectIssues.byProject[projectId].byStatus[status] = 
            (report.crossProjectIssues.byProject[projectId].byStatus[status] || 0) + 1;
        }
        
        // 重要なIssueの特定
        if (issue.priority >= 80 || issue.status === 'failed') {
          report.crossProjectIssues.critical.push({
            id: issueId,
            title: issue.title,
            status: issue.status,
            priority: issue.priority,
            projects: Array.from(issue.projects)
          });
        }
      }
    }
    
    // 知識共有分析
    if (this.config.enableKnowledgeSharing) {
      // トップ貢献者
      const contributorCount = new Map();
      for (const [projectId, topics] of this.projectKnowledge) {
        if (targetProjects && !targetProjects.has(projectId)) continue;
        contributorCount.set(projectId, topics.size);
      }
      
      report.knowledgeSharing.topContributors = Array.from(contributorCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([projectId, count]) => ({ projectId, contributions: count }));
      
      // 人気トピック
      const topicPopularity = [];
      for (const [topicId, knowledge] of this.knowledgeBase) {
        topicPopularity.push({
          topicId,
          topic: knowledge.topic,
          category: knowledge.category,
          score: knowledge.metadata.contributions + knowledge.metadata.queries
        });
      }
      
      report.knowledgeSharing.popularTopics = topicPopularity
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
      
      // 知識ギャップの検出
      const projectTopicCoverage = new Map();
      for (const [projectId, topics] of this.projectKnowledge) {
        if (targetProjects && !targetProjects.has(projectId)) continue;
        
        const categories = new Set();
        for (const topicId of topics) {
          const knowledge = this.knowledgeBase.get(topicId);
          if (knowledge) {
            categories.add(knowledge.category);
          }
        }
        projectTopicCoverage.set(projectId, categories);
      }
      
      // カテゴリカバレッジが低いプロジェクトを特定
      const allCategories = new Set();
      for (const knowledge of this.knowledgeBase.values()) {
        allCategories.add(knowledge.category);
      }
      
      for (const [projectId, categories] of projectTopicCoverage) {
        const missingCategories = Array.from(allCategories)
          .filter(cat => !categories.has(cat));
        
        if (missingCategories.length > allCategories.size * 0.5) {
          report.knowledgeSharing.knowledgeGaps.push({
            projectId,
            missingCategories
          });
        }
      }
    }
    
    // 推奨事項の生成
    report.recommendations = this.generateRecommendations(report);
    
    report.metadata.projectCount = targetProjects ? targetProjects.size : 
      new Set([
        ...this.dependencies.keys(),
        ...this.reverseDependencies.keys(),
        ...this.projectKnowledge.keys()
      ]).size;
    
    return report;
  }

  /**
   * 推奨事項を生成
   */
  generateRecommendations(report) {
    const recommendations = [];
    
    // 循環依存の解消
    if (report.dependencies.circular.length > 0) {
      recommendations.push({
        type: 'critical',
        category: 'dependencies',
        message: '循環依存が検出されました',
        action: '依存関係を見直し、循環を解消してください',
        details: report.dependencies.circular
      });
    }
    
    // 孤立プロジェクトの統合
    if (report.dependencies.orphaned.length > 0) {
      recommendations.push({
        type: 'warning',
        category: 'dependencies',
        message: '依存関係のない孤立プロジェクトがあります',
        action: '他のプロジェクトとの関連性を検討してください',
        details: report.dependencies.orphaned
      });
    }
    
    // 重要なクロスプロジェクトIssue
    if (report.crossProjectIssues.critical.length > 0) {
      recommendations.push({
        type: 'high',
        category: 'issues',
        message: '優先度の高いクロスプロジェクトIssueがあります',
        action: '早急に対処してください',
        details: report.crossProjectIssues.critical
      });
    }
    
    // 知識ギャップの解消
    if (report.knowledgeSharing.knowledgeGaps.length > 0) {
      recommendations.push({
        type: 'improvement',
        category: 'knowledge',
        message: '知識共有が不足しているプロジェクトがあります',
        action: '知識の転送や文書化を検討してください',
        details: report.knowledgeSharing.knowledgeGaps
      });
    }
    
    return recommendations;
  }

  /**
   * 依存関係統計を更新
   */
  updateDependencyStatistics() {
    this.statistics.dependencies.total = this.dependencies.size;
    
    // 循環依存の数を更新
    let circularCount = 0;
    for (const [projectId, deps] of this.dependencies) {
      for (const depId of deps) {
        if (this.checkCircularDependency(projectId, depId)) {
          circularCount++;
        }
      }
    }
    this.statistics.dependencies.circular = circularCount;
    
    // 深さを更新
    this.statistics.dependencies.depth.clear();
    const allProjects = new Set([
      ...this.dependencies.keys(),
      ...this.reverseDependencies.keys()
    ]);
    
    for (const projectId of allProjects) {
      const depth = this.calculateDependencyDepth(projectId);
      this.statistics.dependencies.depth.set(projectId, depth);
    }
  }

  /**
   * クロスプロジェクト統計を更新
   */
  updateCrossProjectStatistics() {
    this.statistics.crossProjectIssues.total = this.crossProjectIssues.size;
    
    // ステータス別集計
    this.statistics.crossProjectIssues.byStatus = {};
    this.statistics.crossProjectIssues.byProjects = {};
    
    for (const issue of this.crossProjectIssues.values()) {
      // ステータス
      const status = issue.status;
      this.statistics.crossProjectIssues.byStatus[status] = 
        (this.statistics.crossProjectIssues.byStatus[status] || 0) + 1;
      
      // プロジェクト別
      for (const projectId of issue.projects) {
        this.statistics.crossProjectIssues.byProjects[projectId] = 
          (this.statistics.crossProjectIssues.byProjects[projectId] || 0) + 1;
      }
    }
  }

  /**
   * トピックIDを生成
   */
  generateTopicId(topic, category) {
    const normalizedTopic = topic.toLowerCase().replace(/\s+/g, '-');
    const normalizedCategory = category.toLowerCase();
    return `${normalizedCategory}:${normalizedTopic}`;
  }

  /**
   * 古い知識を削除
   */
  async cleanupOldKnowledge() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.config.knowledgeRetentionDays);
    
    let deletedCount = 0;
    
    for (const [topicId, knowledge] of this.knowledgeBase) {
      const lastUpdated = new Date(knowledge.metadata.lastUpdated);
      
      if (lastUpdated < cutoffDate && knowledge.metadata.queries < 10) {
        this.knowledgeBase.delete(topicId);
        
        // プロジェクトの知識マップからも削除
        for (const projectId of knowledge.projects) {
          const projectTopics = this.projectKnowledge.get(projectId);
          if (projectTopics) {
            projectTopics.delete(topicId);
          }
        }
        
        deletedCount++;
      }
    }
    
    if (deletedCount > 0) {
      this.logger.info('古い知識を削除しました', { count: deletedCount });
    }
    
    return deletedCount;
  }

  /**
   * デバッグ情報を取得
   */
  getDebugInfo() {
    return {
      config: this.config,
      statistics: this.statistics,
      dependencies: {
        count: this.dependencies.size,
        graph: this.getDependencyGraph()
      },
      crossProjectIssues: {
        count: this.crossProjectIssues.size,
        issues: Array.from(this.crossProjectIssues.values()).slice(0, 10)
      },
      knowledgeBase: {
        topics: this.knowledgeBase.size,
        projects: this.projectKnowledge.size
      }
    };
  }
}

module.exports = CrossProjectCoordinator;