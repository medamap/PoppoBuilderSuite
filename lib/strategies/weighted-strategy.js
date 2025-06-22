/**
 * Weighted Scheduling Strategy
 * 重み付きスケジューリング戦略
 */

/**
 * 重み付き戦略クラス
 * プロジェクトの重みに基づいて確率的にタスクを割り当てる
 */
class WeightedStrategy {
  constructor(scheduler) {
    this.scheduler = scheduler;
    this.name = 'weighted';
    this.random = Math.random; // テスト時にモック可能
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
    
    // アクティブで容量のあるプロジェクトを取得
    const availableProjects = projects.filter(p => {
      if (!p.active) return false;
      
      const projectStats = stats.get(p.id);
      const currentConcurrent = projectStats ? projectStats.currentConcurrent : 0;
      return currentConcurrent < p.maxConcurrent;
    });
    
    if (availableProjects.length === 0) {
      // 容量のあるプロジェクトがない場合は、すべてのアクティブプロジェクトから選択
      return this.selectFromFullProjects(projects.filter(p => p.active), stats);
    }
    
    // 重みの合計を計算
    const totalWeight = availableProjects.reduce((sum, p) => sum + p.weight, 0);
    
    if (totalWeight === 0) {
      // すべての重みが0の場合は、最初のプロジェクトを選択
      return availableProjects[0].id;
    }
    
    // 重み付きランダム選択
    const randomValue = this.random() * totalWeight;
    let cumulativeWeight = 0;
    
    for (const project of availableProjects) {
      cumulativeWeight += project.weight;
      if (randomValue <= cumulativeWeight) {
        return project.id;
      }
    }
    
    // フォールバック（通常は到達しない）
    return availableProjects[availableProjects.length - 1].id;
  }
  
  /**
   * すべてのプロジェクトが満杯の場合の選択
   */
  selectFromFullProjects(projects, stats) {
    if (projects.length === 0) {
      return null;
    }
    
    // 重みと負荷を考慮してスコアを計算
    let bestProject = null;
    let bestScore = -Infinity;
    
    for (const project of projects) {
      const projectStats = stats.get(project.id);
      const currentConcurrent = projectStats ? projectStats.currentConcurrent : 0;
      
      // スコア = 重み / (1 + 現在の並行実行数)
      // 重みが高く、負荷が低いプロジェクトが高スコア
      const score = project.weight / (1 + currentConcurrent);
      
      if (score > bestScore) {
        bestScore = score;
        bestProject = project;
      }
    }
    
    return bestProject ? bestProject.id : null;
  }
  
  /**
   * 戦略をリセット
   */
  reset() {
    // 重み付き戦略には内部状態がないため、リセット不要
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
   * プロジェクトの実効重みを計算
   * 負荷状況を考慮した動的な重み
   */
  calculateEffectiveWeight(project, stats) {
    const projectStats = stats.get(project.id);
    if (!projectStats) {
      return project.weight;
    }
    
    // 基本重み
    let effectiveWeight = project.weight;
    
    // 負荷による調整
    const loadRatio = projectStats.currentConcurrent / project.maxConcurrent;
    const loadFactor = 1 - (loadRatio * 0.5); // 最大50%減少
    effectiveWeight *= loadFactor;
    
    // 最近のタスク完了率による調整
    if (projectStats.tasksScheduled > 0) {
      const completionRate = projectStats.tasksCompleted / projectStats.tasksScheduled;
      effectiveWeight *= completionRate;
    }
    
    return Math.max(0.1, effectiveWeight); // 最小重みを保証
  }
}

module.exports = WeightedStrategy;