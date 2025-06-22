/**
 * Priority-based Scheduling Strategy
 * 優先度ベースのスケジューリング戦略
 */

/**
 * 優先度戦略クラス
 * プロジェクトの優先度に基づいてタスクを割り当てる
 */
class PriorityStrategy {
  constructor(scheduler) {
    this.scheduler = scheduler;
    this.name = 'priority';
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
    
    // アクティブなプロジェクトを優先度順にソート（降順）
    const sortedProjects = projects
      .filter(p => p.active)
      .sort((a, b) => b.priority - a.priority);
    
    if (sortedProjects.length === 0) {
      return null;
    }
    
    // 優先度の高い順にプロジェクトをチェック
    for (const project of sortedProjects) {
      const projectStats = stats.get(project.id);
      const currentConcurrent = projectStats ? projectStats.currentConcurrent : 0;
      
      // 並行実行数が上限に達していない場合
      if (currentConcurrent < project.maxConcurrent) {
        return project.id;
      }
    }
    
    // すべてのプロジェクトが上限に達している場合
    // 優先度が最も高く、負荷が最も低いプロジェクトを選択
    let selectedProject = null;
    let bestScore = -Infinity;
    
    for (const project of sortedProjects) {
      const projectStats = stats.get(project.id);
      const currentConcurrent = projectStats ? projectStats.currentConcurrent : 0;
      
      // スコア = 優先度 - (現在の並行実行数 / 最大並行実行数) * 100
      const loadRatio = currentConcurrent / project.maxConcurrent;
      const score = project.priority - (loadRatio * 100);
      
      if (score > bestScore) {
        bestScore = score;
        selectedProject = project;
      }
    }
    
    return selectedProject ? selectedProject.id : null;
  }
  
  /**
   * 戦略をリセット
   */
  reset() {
    // 優先度戦略には内部状態がないため、リセット不要
  }
  
  /**
   * 戦略の設定を更新
   */
  updateConfig(config) {
    // 必要に応じて設定を更新
  }
  
  /**
   * 戦略の統計を取得
   */
  getStats() {
    return {
      strategy: this.name
    };
  }
  
  /**
   * プロジェクトの優先度スコアを計算
   */
  calculatePriorityScore(project, stats) {
    const projectStats = stats.get(project.id);
    if (!projectStats) {
      return project.priority;
    }
    
    // 基本スコアは優先度
    let score = project.priority;
    
    // 最近スケジュールされていない場合はボーナス
    if (projectStats.lastScheduledAt) {
      const timeSinceLastSchedule = Date.now() - projectStats.lastScheduledAt;
      const starvationBonus = Math.min(timeSinceLastSchedule / 60000, 10); // 最大10ポイント
      score += starvationBonus;
    }
    
    // 負荷によるペナルティ
    const loadRatio = projectStats.currentConcurrent / project.maxConcurrent;
    const loadPenalty = loadRatio * 20; // 最大20ポイントのペナルティ
    score -= loadPenalty;
    
    return score;
  }
}

module.exports = PriorityStrategy;