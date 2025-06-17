const fs = require('fs').promises;
const path = require('path');

/**
 * エラー統計分析エンジン
 * エラーの発生パターンやトレンドを分析
 */
class ErrorStatistics {
  constructor(logger) {
    this.logger = logger;
    this.statsFile = path.join(__dirname, '../../.poppo/error-statistics.json');
    this.statistics = {
      overall: {},
      byCategory: {},
      bySeverity: {},
      byHour: {},
      byDay: {},
      trends: [],
      lastUpdated: null
    };
    
    // トレンド分析の設定
    this.trendWindow = 7; // 7日間のトレンドを分析
    this.trendThresholds = {
      increasing: 0.15,  // 15%以上の増加
      decreasing: -0.15  // 15%以上の減少
    };
  }

  /**
   * 初期化処理
   */
  async initialize() {
    try {
      const data = await fs.readFile(this.statsFile, 'utf8');
      this.statistics = JSON.parse(data);
      this.logger.info('エラー統計データを読み込みました');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`統計データの読み込みエラー: ${error.message}`);
      }
      // 初期統計データの作成
      await this.initializeStatistics();
    }
  }

  /**
   * 初期統計データの作成
   */
  async initializeStatistics() {
    this.statistics = {
      overall: {
        totalErrors: 0,
        uniqueErrors: 0,
        firstSeen: new Date().toISOString(),
        lastSeen: null
      },
      byCategory: {},
      bySeverity: {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0
      },
      byHour: Array(24).fill(0),
      byDay: Array(7).fill(0),  // 0: 日曜日, 6: 土曜日
      trends: [],
      dailyData: {},  // 日別詳細データ
      lastUpdated: new Date().toISOString()
    };
    
    await this.saveStatistics();
  }

  /**
   * エラーを統計に追加
   * @param {Object} errorInfo エラー情報
   * @param {Object} groupInfo グループ情報
   */
  async addError(errorInfo, groupInfo = null) {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    const dateKey = now.toISOString().split('T')[0];
    
    // 全体統計の更新
    this.statistics.overall.totalErrors++;
    this.statistics.overall.lastSeen = now.toISOString();
    
    if (groupInfo && groupInfo.isNew) {
      this.statistics.overall.uniqueErrors++;
    }
    
    // カテゴリ別統計
    if (!this.statistics.byCategory[errorInfo.category]) {
      this.statistics.byCategory[errorInfo.category] = {
        count: 0,
        firstSeen: now.toISOString(),
        lastSeen: null,
        severityDistribution: {}
      };
    }
    
    const categoryStats = this.statistics.byCategory[errorInfo.category];
    categoryStats.count++;
    categoryStats.lastSeen = now.toISOString();
    
    // 重要度別統計
    const severity = errorInfo.severity || 'medium';
    this.statistics.bySeverity[severity] = (this.statistics.bySeverity[severity] || 0) + 1;
    
    // カテゴリ内の重要度分布
    categoryStats.severityDistribution[severity] = 
      (categoryStats.severityDistribution[severity] || 0) + 1;
    
    // 時間帯別統計
    this.statistics.byHour[hour]++;
    
    // 曜日別統計
    this.statistics.byDay[dayOfWeek]++;
    
    // 日別詳細データ
    if (!this.statistics.dailyData[dateKey]) {
      this.statistics.dailyData[dateKey] = {
        total: 0,
        byCategory: {},
        bySeverity: {},
        errors: []
      };
    }
    
    const dailyData = this.statistics.dailyData[dateKey];
    dailyData.total++;
    dailyData.byCategory[errorInfo.category] = 
      (dailyData.byCategory[errorInfo.category] || 0) + 1;
    dailyData.bySeverity[severity] = 
      (dailyData.bySeverity[severity] || 0) + 1;
    
    // エラー詳細を保存（最大100件/日）
    if (dailyData.errors.length < 100) {
      dailyData.errors.push({
        hash: errorInfo.hash,
        category: errorInfo.category,
        severity: severity,
        timestamp: now.toISOString()
      });
    }
    
    // 更新日時
    this.statistics.lastUpdated = now.toISOString();
    
    // トレンド分析の実行
    await this.analyzeTrends();
    
    // 統計の保存
    await this.saveStatistics();
  }

  /**
   * トレンド分析
   */
  async analyzeTrends() {
    const now = new Date();
    const trends = [];
    
    // カテゴリ別トレンド分析
    for (const [category, stats] of Object.entries(this.statistics.byCategory)) {
      const trend = this.calculateCategoryTrend(category);
      if (trend) {
        trends.push(trend);
      }
    }
    
    // 全体トレンド分析
    const overallTrend = this.calculateOverallTrend();
    if (overallTrend) {
      trends.push(overallTrend);
    }
    
    // トレンドを重要度でソート
    this.statistics.trends = trends.sort((a, b) => 
      Math.abs(b.rate) - Math.abs(a.rate)
    );
  }

  /**
   * カテゴリのトレンド計算
   */
  calculateCategoryTrend(category) {
    const dailyData = this.getDailyDataForTrendAnalysis();
    if (dailyData.length < 3) return null;  // 最低3日分のデータが必要
    
    const counts = dailyData.map(day => 
      day.byCategory[category] || 0
    );
    
    const trend = this.calculateTrend(counts);
    if (Math.abs(trend.rate) >= Math.abs(this.trendThresholds.increasing)) {
      return {
        category,
        trend: trend.direction,
        rate: trend.rate,
        recentCount: counts.slice(-3).reduce((a, b) => a + b, 0),
        message: this.getTrendMessage(category, trend)
      };
    }
    
    return null;
  }

  /**
   * 全体トレンド計算
   */
  calculateOverallTrend() {
    const dailyData = this.getDailyDataForTrendAnalysis();
    if (dailyData.length < 3) return null;
    
    const counts = dailyData.map(day => day.total);
    const trend = this.calculateTrend(counts);
    
    if (Math.abs(trend.rate) >= Math.abs(this.trendThresholds.increasing)) {
      return {
        category: 'Overall',
        trend: trend.direction,
        rate: trend.rate,
        recentCount: counts.slice(-3).reduce((a, b) => a + b, 0),
        message: this.getTrendMessage('全体のエラー', trend)
      };
    }
    
    return null;
  }

  /**
   * トレンド分析用の日別データ取得
   */
  getDailyDataForTrendAnalysis() {
    const now = new Date();
    const days = [];
    
    for (let i = this.trendWindow - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = date.toISOString().split('T')[0];
      
      days.push(this.statistics.dailyData[dateKey] || {
        total: 0,
        byCategory: {},
        bySeverity: {}
      });
    }
    
    return days;
  }

  /**
   * トレンドの計算（線形回帰）
   */
  calculateTrend(values) {
    const n = values.length;
    if (n < 2) return { direction: 'stable', rate: 0 };
    
    // 単純移動平均でスムージング
    const smoothed = this.movingAverage(values, 3);
    
    // 線形回帰
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
    
    for (let i = 0; i < smoothed.length; i++) {
      sumX += i;
      sumY += smoothed[i];
      sumXY += i * smoothed[i];
      sumX2 += i * i;
    }
    
    const avgX = sumX / smoothed.length;
    const avgY = sumY / smoothed.length;
    
    const slope = (sumXY - smoothed.length * avgX * avgY) / 
                  (sumX2 - smoothed.length * avgX * avgX);
    
    // 変化率を計算
    const firstValue = smoothed[0] || 1;
    const rate = slope / firstValue;
    
    let direction = 'stable';
    if (rate >= this.trendThresholds.increasing) {
      direction = 'increasing';
    } else if (rate <= this.trendThresholds.decreasing) {
      direction = 'decreasing';
    }
    
    return { direction, rate };
  }

  /**
   * 移動平均の計算
   */
  movingAverage(values, window) {
    if (values.length < window) return values;
    
    const result = [];
    for (let i = 0; i < values.length - window + 1; i++) {
      const sum = values.slice(i, i + window).reduce((a, b) => a + b, 0);
      result.push(sum / window);
    }
    
    return result;
  }

  /**
   * トレンドメッセージの生成
   */
  getTrendMessage(category, trend) {
    const percentage = Math.abs(trend.rate * 100).toFixed(0);
    
    if (trend.direction === 'increasing') {
      return `${category}のエラーが${percentage}%増加傾向です`;
    } else if (trend.direction === 'decreasing') {
      return `${category}のエラーが${percentage}%減少傾向です`;
    } else {
      return `${category}のエラーは安定しています`;
    }
  }

  /**
   * 統計レポートの生成
   */
  generateReport() {
    const peakHour = this.findPeakHour();
    const peakDay = this.findPeakDay();
    const mostFrequentCategory = this.findMostFrequentCategory();
    
    return {
      summary: {
        totalErrors: this.statistics.overall.totalErrors,
        uniqueErrors: this.statistics.overall.uniqueErrors,
        mostFrequentCategory: mostFrequentCategory.name,
        peakHour: peakHour.hour,
        peakDay: peakDay.name,
        activePeriod: {
          from: this.statistics.overall.firstSeen,
          to: this.statistics.overall.lastSeen
        }
      },
      trends: this.statistics.trends.map(t => ({
        category: t.category,
        trend: t.trend,
        rate: t.rate,
        message: t.message
      })),
      distribution: {
        byCategory: this.getCategoryDistribution(),
        bySeverity: this.getSeverityDistribution(),
        byTime: {
          hourly: this.getHourlyDistribution(),
          daily: this.getDailyDistribution()
        }
      },
      insights: this.generateInsights()
    };
  }

  /**
   * ピーク時間帯の検出
   */
  findPeakHour() {
    let maxCount = 0;
    let peakHour = 0;
    
    this.statistics.byHour.forEach((count, hour) => {
      if (count > maxCount) {
        maxCount = count;
        peakHour = hour;
      }
    });
    
    return { hour: peakHour, count: maxCount };
  }

  /**
   * ピーク曜日の検出
   */
  findPeakDay() {
    const days = ['日曜日', '月曜日', '火曜日', '水曜日', '木曜日', '金曜日', '土曜日'];
    let maxCount = 0;
    let peakDay = 0;
    
    this.statistics.byDay.forEach((count, day) => {
      if (count > maxCount) {
        maxCount = count;
        peakDay = day;
      }
    });
    
    return { name: days[peakDay], day: peakDay, count: maxCount };
  }

  /**
   * 最頻出カテゴリの検出
   */
  findMostFrequentCategory() {
    let maxCount = 0;
    let mostFrequent = 'Unknown';
    
    for (const [category, stats] of Object.entries(this.statistics.byCategory)) {
      if (stats.count > maxCount) {
        maxCount = stats.count;
        mostFrequent = category;
      }
    }
    
    return { name: mostFrequent, count: maxCount };
  }

  /**
   * カテゴリ分布の取得
   */
  getCategoryDistribution() {
    const total = this.statistics.overall.totalErrors;
    const distribution = {};
    
    for (const [category, stats] of Object.entries(this.statistics.byCategory)) {
      distribution[category] = {
        count: stats.count,
        percentage: (stats.count / total * 100).toFixed(1)
      };
    }
    
    return distribution;
  }

  /**
   * 重要度分布の取得
   */
  getSeverityDistribution() {
    const total = this.statistics.overall.totalErrors;
    const distribution = {};
    
    for (const [severity, count] of Object.entries(this.statistics.bySeverity)) {
      distribution[severity] = {
        count: count,
        percentage: (count / total * 100).toFixed(1)
      };
    }
    
    return distribution;
  }

  /**
   * 時間別分布の取得
   */
  getHourlyDistribution() {
    return this.statistics.byHour.map((count, hour) => ({
      hour,
      count
    }));
  }

  /**
   * 曜日別分布の取得
   */
  getDailyDistribution() {
    const days = ['日', '月', '火', '水', '木', '金', '土'];
    return this.statistics.byDay.map((count, day) => ({
      day: days[day],
      count
    }));
  }

  /**
   * インサイトの生成
   */
  generateInsights() {
    const insights = [];
    
    // ピーク時間帯のインサイト
    const peakHour = this.findPeakHour();
    if (peakHour.count > this.statistics.overall.totalErrors * 0.1) {
      insights.push(`エラーの多くは${peakHour.hour}時台に発生しています。この時間帯の負荷を確認してください。`);
    }
    
    // 重要度別インサイト
    const criticalRatio = this.statistics.bySeverity.critical / this.statistics.overall.totalErrors;
    if (criticalRatio > 0.1) {
      insights.push(`致命的なエラーが${(criticalRatio * 100).toFixed(0)}%を占めています。優先的な対応が必要です。`);
    }
    
    // トレンドインサイト
    const increasingTrends = this.statistics.trends.filter(t => t.trend === 'increasing');
    if (increasingTrends.length > 0) {
      const topTrend = increasingTrends[0];
      insights.push(`${topTrend.category}のエラーが増加傾向にあります。原因の調査が推奨されます。`);
    }
    
    return insights;
  }

  /**
   * 統計データの保存
   */
  async saveStatistics() {
    try {
      // 古いデータのクリーンアップ（30日以上前のデータを削除）
      this.cleanupOldData();
      
      await fs.writeFile(this.statsFile, JSON.stringify(this.statistics, null, 2));
    } catch (error) {
      this.logger.error(`統計データ保存エラー: ${error.message}`);
    }
  }

  /**
   * 古いデータのクリーンアップ
   */
  cleanupOldData() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoffDate = thirtyDaysAgo.toISOString().split('T')[0];
    
    // 日別データのクリーンアップ
    for (const dateKey of Object.keys(this.statistics.dailyData)) {
      if (dateKey < cutoffDate) {
        delete this.statistics.dailyData[dateKey];
      }
    }
  }

  /**
   * API用の統計データ取得
   */
  getStatistics() {
    return {
      overview: this.statistics.overall,
      currentTrends: this.statistics.trends.slice(0, 5),
      recentErrors: this.getRecentErrors(10),
      report: this.generateReport()
    };
  }

  /**
   * 最近のエラーを取得
   */
  getRecentErrors(limit = 10) {
    const today = new Date().toISOString().split('T')[0];
    const todayData = this.statistics.dailyData[today];
    
    if (!todayData || !todayData.errors) return [];
    
    return todayData.errors.slice(-limit).reverse();
  }
}

module.exports = ErrorStatistics;