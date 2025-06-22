/**
 * Fair Share Scheduling Strategy
 * 公平配分スケジューリング戦略
 */

/**
 * 公平配分戦略クラス
 * すべてのプロジェクトに公平にタスクを配分する
 */
class FairShareStrategy {
  constructor(scheduler) {
    this.scheduler = scheduler;
    this.name = 'fair-share';
    this.shareWindow = scheduler.options.fairShareWindow || 60000; // 60秒
  }
  
  /**
   * タスクをスケジュール
   * @param {Object} task - スケジュールするタスク
   * @param {Object} context - スケジューリングコンテキスト
   * @returns {string|null} 選択されたプロジェクトID
   */
  async schedule(task, context) {
    const { projects, stats } = context;
    
    if (!projects || projects.length === 0) {
      return null;
    }
    
    // アクティブなプロジェクトのみ
    const activeProjects = projects.filter(p => p.active);
    
    if (activeProjects.length === 0) {
      return null;
    }
    
    // 各プロジェクトのフェアシェアスコアを計算
    const projectScores = new Map();
    
    for (const project of activeProjects) {
      const score = this.calculateFairShareScore(project, stats);
      projectScores.set(project.id, score);
    }
    
    // スコアが最も高い（最も不足している）プロジェクトを選択
    let selectedProject = null;
    let highestScore = -Infinity;
    
    for (const project of activeProjects) {
      const projectStats = stats.get(project.id);
      const currentConcurrent = projectStats ? projectStats.currentConcurrent : 0;
      
      // 容量チェック
      if (currentConcurrent < project.maxConcurrent) {
        const score = projectScores.get(project.id);
        if (score > highestScore) {
          highestScore = score;
          selectedProject = project;
        }
      }
    }
    
    // 容量のあるプロジェクトがない場合
    if (!selectedProject) {
      // 最も負荷の低いプロジェクトを選択
      let minLoad = Infinity;
      
      for (const project of activeProjects) {
        const projectStats = stats.get(project.id);
        const currentConcurrent = projectStats ? projectStats.currentConcurrent : 0;
        const loadRatio = currentConcurrent / project.maxConcurrent;
        
        if (loadRatio < minLoad) {
          minLoad = loadRatio;
          selectedProject = project;
        }
      }
    }
    
    return selectedProject ? selectedProject.id : null;
  }
  
  /**
   * フェアシェアスコアを計算
   * スコアが高いほど、そのプロジェクトはより多くのタスクを受け取るべき
   */
  calculateFairShareScore(project, stats) {
    const projectStats = stats.get(project.id);
    if (!projectStats) {
      return 100; // 新しいプロジェクトは高優先度
    }
    
    // 期待されるシェア（重みベース）
    const totalWeight = Array.from(this.scheduler.projects.values())
      .filter(p => p.active)
      .reduce((sum, p) => sum + p.weight, 0);
    
    const expectedShare = totalWeight > 0 ? project.weight / totalWeight : 0;
    
    // 実際のシェア（最近のタスク数ベース）
    const recentTasks = this.getRecentTaskCount(projectStats);
    const totalRecentTasks = this.getTotalRecentTasks(stats);
    const actualShare = totalRecentTasks > 0 ? recentTasks / totalRecentTasks : 0;
    
    // スコア = 期待シェア - 実際のシェア
    // 正の値：不足している、負の値：過剰
    let score = (expectedShare - actualShare) * 100;
    
    // 優先度による調整
    score += project.priority / 10;
    
    // 現在の負荷による調整
    const loadRatio = projectStats.currentConcurrent / project.maxConcurrent;
    score -= loadRatio * 20;
    
    // 待機時間による調整
    if (projectStats.lastScheduledAt) {
      const waitTime = Date.now() - projectStats.lastScheduledAt;
      const waitBonus = Math.min(waitTime / 10000, 10); // 最大10ポイント
      score += waitBonus;
    }
    
    return score;
  }
  
  /**
   * 最近のタスク数を取得
   */
  getRecentTaskCount(projectStats) {
    // 簡易実装：全期間の完了タスク数を使用
    // 実際の実装では時間窓を考慮する必要がある
    return projectStats.tasksCompleted;
  }
  
  /**
   * 全プロジェクトの最近のタスク数合計を取得
   */
  getTotalRecentTasks(stats) {
    let total = 0;
    for (const projectStats of stats.values()) {
      total += this.getRecentTaskCount(projectStats);
    }
    return total;
  }
  
  /**
   * 戦略をリセット
   */
  reset() {
    // フェアシェア戦略には永続的な内部状態がないため、リセット不要
  }
  
  /**
   * 戦略の設定を更新
   */
  updateConfig(config) {
    if (config.fairShareWindow !== undefined) {
      this.shareWindow = config.fairShareWindow;
    }
  }
  
  /**
   * 戦略の統計を取得
   */
  getStats() {
    const projectShares = new Map();
    
    // 各プロジェクトの実際のシェアを計算
    for (const [projectId, project] of this.scheduler.projects) {
      if (!project.active) continue;
      
      const projectStats = this.scheduler.projectStats.get(projectId);
      if (projectStats) {
        const recentTasks = this.getRecentTaskCount(projectStats);
        const totalRecentTasks = this.getTotalRecentTasks(this.scheduler.projectStats);
        const actualShare = totalRecentTasks > 0 ? recentTasks / totalRecentTasks : 0;
        
        projectShares.set(projectId, {
          expectedShare: project.weight / this.getTotalWeight(),
          actualShare: actualShare,
          difference: (project.weight / this.getTotalWeight()) - actualShare
        });
      }
    }
    
    return {
      strategy: this.name,
      shareWindow: this.shareWindow,
      projectShares: Object.fromEntries(projectShares)
    };
  }
  
  /**
   * 全プロジェクトの重み合計を取得
   */
  getTotalWeight() {
    let total = 0;
    for (const project of this.scheduler.projects.values()) {
      if (project.active) {
        total += project.weight;
      }
    }
    return total || 1;
  }
}

module.exports = FairShareStrategy;