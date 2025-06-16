const fs = require('fs');
const path = require('path');

/**
 * タスクのタイムアウトを動的に制御するコントローラー
 */
class TimeoutController {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.historyFile = path.join(__dirname, '../logs/execution-history.json');
    this.executionHistory = this.loadHistory();
  }

  /**
   * 実行履歴の読み込み
   */
  loadHistory() {
    try {
      if (fs.existsSync(this.historyFile)) {
        const data = fs.readFileSync(this.historyFile, 'utf8');
        return JSON.parse(data);
      }
    } catch (error) {
      this.logger?.log('ERROR', '実行履歴の読み込みエラー', { error: error.message });
    }
    return {
      taskTypes: {},
      complexityHistory: []
    };
  }

  /**
   * 実行履歴の保存
   */
  saveHistory() {
    try {
      const dir = path.dirname(this.historyFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.historyFile, JSON.stringify(this.executionHistory, null, 2));
    } catch (error) {
      this.logger?.log('ERROR', '実行履歴の保存エラー', { error: error.message });
    }
  }

  /**
   * タスクの複雑度を判定
   * @param {Object} issue - GitHubのIssue情報
   * @returns {Object} 複雑度情報
   */
  calculateComplexity(issue) {
    const complexityFactors = {
      bodyLength: 0,
      codeBlockCount: 0,
      linkCount: 0,
      imageCount: 0,
      listItemCount: 0,
      labelScore: 0,
      total: 0
    };

    const body = issue.body || '';
    
    // 本文の長さ（文字数に基づくスコア）
    complexityFactors.bodyLength = Math.min(body.length / 100, 10);
    
    // コードブロックの数
    const codeBlocks = body.match(/```[\s\S]*?```/g) || [];
    complexityFactors.codeBlockCount = codeBlocks.length * 2;
    
    // リンクの数
    const links = body.match(/\[.*?\]\(.*?\)/g) || [];
    complexityFactors.linkCount = links.length * 0.5;
    
    // 画像の数
    const images = body.match(/!\[.*?\]\(.*?\)/g) || [];
    complexityFactors.imageCount = images.length * 1;
    
    // リストアイテムの数
    const listItems = body.match(/^[\s]*[-*+]\s/gm) || [];
    complexityFactors.listItemCount = listItems.length * 0.3;
    
    // ラベルによるスコア
    const labels = issue.labels || [];
    for (const label of labels) {
      const labelName = label.name || label;
      if (labelName.includes('complex')) {
        complexityFactors.labelScore += 10;
      } else if (labelName.includes('documentation')) {
        complexityFactors.labelScore += 3;
      } else if (labelName.includes('feature')) {
        complexityFactors.labelScore += 5;
      } else if (labelName.includes('bug')) {
        complexityFactors.labelScore += 2;
      }
    }
    
    // 合計スコア計算
    complexityFactors.total = Object.values(complexityFactors)
      .filter(v => typeof v === 'number' && v !== complexityFactors.total)
      .reduce((sum, v) => sum + v, 0);
    
    // 複雑度レベルの判定
    let level = 'simple';
    if (complexityFactors.total >= 20) {
      level = 'complex';
    } else if (complexityFactors.total >= 10) {
      level = 'moderate';
    }
    
    return {
      factors: complexityFactors,
      level,
      score: complexityFactors.total
    };
  }

  /**
   * タスクタイプの識別
   * @param {Object} issue - GitHubのIssue情報
   * @returns {string} タスクタイプ
   */
  identifyTaskType(issue) {
    const labels = issue.labels || [];
    
    // ラベルから直接タスクタイプを判定
    for (const label of labels) {
      const labelName = label.name || label;
      if (labelName.startsWith('task:')) {
        return labelName.substring(5); // 'task:' を除去
      }
    }
    
    // デフォルトはmisc
    return 'misc';
  }

  /**
   * タイムアウトの計算
   * @param {Object} issue - GitHubのIssue情報
   * @returns {Object} タイムアウト情報
   */
  calculateTimeout(issue) {
    const taskType = this.identifyTaskType(issue);
    const complexity = this.calculateComplexity(issue);
    
    // デフォルトタイムアウト設定（ミリ秒）
    const defaultTimeouts = this.config.timeoutProfiles || {
      misc: 30 * 60 * 1000,          // 30分
      dogfooding: 2 * 60 * 60 * 1000, // 2時間
      documentation: 60 * 60 * 1000,   // 1時間
      complex: 6 * 60 * 60 * 1000,    // 6時間
      feature: 2 * 60 * 60 * 1000,    // 2時間
      bug: 60 * 60 * 1000             // 1時間
    };
    
    // 基本タイムアウトの取得
    let baseTimeout = defaultTimeouts[taskType] || defaultTimeouts.misc;
    
    // 実行履歴による調整
    const history = this.executionHistory.taskTypes[taskType];
    if (history && history.averageExecutionTime) {
      // 平均実行時間の1.5倍を基準とする
      const historicalTimeout = history.averageExecutionTime * 1.5;
      // 履歴と設定の中間値を採用（学習の影響を緩やかにする）
      baseTimeout = (baseTimeout + historicalTimeout) / 2;
    }
    
    // 複雑度による調整
    let complexityMultiplier = 1.0;
    switch (complexity.level) {
      case 'simple':
        complexityMultiplier = 0.8;
        break;
      case 'moderate':
        complexityMultiplier = 1.2;
        break;
      case 'complex':
        complexityMultiplier = 2.0;
        break;
    }
    
    // 最終タイムアウトの計算
    const finalTimeout = Math.round(baseTimeout * complexityMultiplier);
    
    // 最小値と最大値の制限
    const minTimeout = this.config.minTimeout || 10 * 60 * 1000;      // 最小10分
    const maxTimeout = this.config.maxTimeout || 24 * 60 * 60 * 1000; // 最大24時間
    const constrainedTimeout = Math.max(minTimeout, Math.min(maxTimeout, finalTimeout));
    
    return {
      timeout: constrainedTimeout,
      taskType,
      complexity,
      baseTimeout,
      complexityMultiplier,
      historicalAdjustment: history ? 'applied' : 'none',
      reasoning: this.generateTimeoutReasoning(taskType, complexity, baseTimeout, complexityMultiplier)
    };
  }

  /**
   * タイムアウト決定理由の生成
   */
  generateTimeoutReasoning(taskType, complexity, baseTimeout, multiplier) {
    const baseMinutes = Math.round(baseTimeout / 60000);
    const reasons = [
      `タスクタイプ '${taskType}' の基本タイムアウト: ${baseMinutes}分`
    ];
    
    if (complexity.level !== 'simple') {
      reasons.push(`複雑度レベル '${complexity.level}' による調整: x${multiplier}`);
    }
    
    if (complexity.factors.codeBlockCount > 0) {
      reasons.push(`コードブロック数: ${complexity.factors.codeBlockCount}`);
    }
    
    if (complexity.factors.labelScore > 0) {
      reasons.push(`ラベルスコア: ${complexity.factors.labelScore}`);
    }
    
    return reasons.join(', ');
  }

  /**
   * タスク実行結果の記録
   * @param {string} taskId - タスクID
   * @param {Object} issue - GitHubのIssue情報
   * @param {number} executionTime - 実際の実行時間（ミリ秒）
   * @param {string} status - 完了ステータス
   */
  recordExecution(taskId, issue, executionTime, status) {
    const taskType = this.identifyTaskType(issue);
    const complexity = this.calculateComplexity(issue);
    
    // タスクタイプ別の記録を更新
    if (!this.executionHistory.taskTypes[taskType]) {
      this.executionHistory.taskTypes[taskType] = {
        count: 0,
        totalTime: 0,
        averageExecutionTime: 0,
        successCount: 0,
        timeoutCount: 0,
        errorCount: 0
      };
    }
    
    const typeHistory = this.executionHistory.taskTypes[taskType];
    typeHistory.count++;
    
    if (status === 'completed') {
      typeHistory.successCount++;
      typeHistory.totalTime += executionTime;
      typeHistory.averageExecutionTime = typeHistory.totalTime / typeHistory.successCount;
    } else if (status === 'timeout') {
      typeHistory.timeoutCount++;
    } else {
      typeHistory.errorCount++;
    }
    
    // 複雑度履歴の記録
    this.executionHistory.complexityHistory.push({
      taskId,
      timestamp: new Date().toISOString(),
      taskType,
      complexity: complexity.score,
      complexityLevel: complexity.level,
      executionTime,
      status
    });
    
    // 履歴のサイズ制限（最新1000件のみ保持）
    if (this.executionHistory.complexityHistory.length > 1000) {
      this.executionHistory.complexityHistory = 
        this.executionHistory.complexityHistory.slice(-1000);
    }
    
    // 履歴を保存
    this.saveHistory();
    
    // ログ出力
    this.logger?.log('INFO', 'タスク実行記録', {
      taskId,
      taskType,
      executionTime: Math.round(executionTime / 1000) + '秒',
      status,
      complexityScore: complexity.score,
      averageTime: Math.round(typeHistory.averageExecutionTime / 1000) + '秒'
    });
  }

  /**
   * タイムアウト延長リクエストの処理
   * @param {string} taskId - タスクID
   * @param {number} currentTimeout - 現在のタイムアウト
   * @param {string} reason - 延長理由
   * @returns {number} 新しいタイムアウト値
   */
  requestTimeoutExtension(taskId, currentTimeout, reason) {
    // 延長は現在のタイムアウトの50%を追加
    const extension = currentTimeout * 0.5;
    const newTimeout = currentTimeout + extension;
    
    // 最大値を超えないようにする
    const maxTimeout = this.config.maxTimeout || 24 * 60 * 60 * 1000;
    const finalTimeout = Math.min(newTimeout, maxTimeout);
    
    this.logger?.log('INFO', 'タイムアウト延長リクエスト', {
      taskId,
      currentTimeout: Math.round(currentTimeout / 60000) + '分',
      extension: Math.round(extension / 60000) + '分',
      newTimeout: Math.round(finalTimeout / 60000) + '分',
      reason
    });
    
    return finalTimeout;
  }

  /**
   * 統計情報の取得
   */
  getStatistics() {
    const stats = {
      taskTypes: {},
      overallStats: {
        totalTasks: 0,
        successRate: 0,
        averageExecutionTime: 0,
        timeoutRate: 0
      }
    };
    
    let totalSuccess = 0;
    let totalTimeout = 0;
    let totalCount = 0;
    let totalTime = 0;
    
    for (const [type, history] of Object.entries(this.executionHistory.taskTypes)) {
      stats.taskTypes[type] = {
        count: history.count,
        successRate: history.count > 0 ? (history.successCount / history.count * 100).toFixed(1) + '%' : '0%',
        averageExecutionTime: Math.round(history.averageExecutionTime / 60000) + '分',
        timeoutRate: history.count > 0 ? (history.timeoutCount / history.count * 100).toFixed(1) + '%' : '0%'
      };
      
      totalCount += history.count;
      totalSuccess += history.successCount;
      totalTimeout += history.timeoutCount;
      totalTime += history.totalTime;
    }
    
    if (totalCount > 0) {
      stats.overallStats.totalTasks = totalCount;
      stats.overallStats.successRate = (totalSuccess / totalCount * 100).toFixed(1) + '%';
      stats.overallStats.timeoutRate = (totalTimeout / totalCount * 100).toFixed(1) + '%';
      stats.overallStats.averageExecutionTime = Math.round(totalTime / totalSuccess / 60000) + '分';
    }
    
    return stats;
  }
}

module.exports = TimeoutController;