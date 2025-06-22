/**
 * Round Robin Scheduling Strategy
 * ラウンドロビンスケジューリング戦略
 */

/**
 * ラウンドロビン戦略クラス
 * プロジェクトを順番に巡回してタスクを割り当てる
 */
class RoundRobinStrategy {
  constructor(scheduler) {
    this.scheduler = scheduler;
    this.name = 'round-robin';
    this.currentIndex = 0;
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
    
    // アクティブなプロジェクトのみをフィルタ
    const activeProjects = projects.filter(p => p.active);
    
    if (activeProjects.length === 0) {
      return null;
    }
    
    // 並行実行数が上限に達していないプロジェクトを探す
    let attempts = 0;
    while (attempts < activeProjects.length) {
      const project = activeProjects[this.currentIndex % activeProjects.length];
      const projectStats = stats.get(project.id);
      
      // 次のインデックスに移動
      this.currentIndex = (this.currentIndex + 1) % activeProjects.length;
      attempts++;
      
      // 並行実行数をチェック
      if (projectStats && projectStats.currentConcurrent < project.maxConcurrent) {
        return project.id;
      }
    }
    
    // すべてのプロジェクトが上限に達している場合
    // 最も並行実行数が少ないプロジェクトを選択
    let selectedProject = null;
    let minConcurrent = Infinity;
    
    for (const project of activeProjects) {
      const projectStats = stats.get(project.id);
      const currentConcurrent = projectStats ? projectStats.currentConcurrent : 0;
      
      if (currentConcurrent < minConcurrent) {
        minConcurrent = currentConcurrent;
        selectedProject = project;
      }
    }
    
    return selectedProject ? selectedProject.id : null;
  }
  
  /**
   * 戦略をリセット
   */
  reset() {
    this.currentIndex = 0;
  }
  
  /**
   * 戦略の設定を更新
   */
  updateConfig(config) {
    // ラウンドロビンには特別な設定はない
  }
  
  /**
   * 戦略の統計を取得
   */
  getStats() {
    return {
      strategy: this.name,
      currentIndex: this.currentIndex
    };
  }
}

module.exports = RoundRobinStrategy;