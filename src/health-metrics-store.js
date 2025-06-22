const fs = require('fs').promises;
const path = require('path');
const Logger = require('./logger');

/**
 * ヘルスメトリクスストア
 * ヘルスチェックの履歴を保存し、トレンド分析を提供
 */
class HealthMetricsStore {
  constructor() {
    this.logger = new Logger('HealthMetricsStore');
    this.dataFile = path.join(__dirname, '../.poppo/health-metrics.json');
    this.maxRecords = 1440; // 24時間分（1分間隔で）
    this.metrics = [];
    this.loaded = false;
  }
  
  /**
   * メトリクスデータの読み込み
   */
  async load() {
    try {
      const data = await fs.readFile(this.dataFile, 'utf8');
      this.metrics = JSON.parse(data);
      this.loaded = true;
      
      // 古いレコードを削除
      if (this.metrics.length > this.maxRecords) {
        this.metrics = this.metrics.slice(-this.maxRecords);
      }
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('メトリクスデータ読み込みエラー:', error);
      }
      this.metrics = [];
      this.loaded = true;
    }
  }
  
  /**
   * メトリクスデータの保存
   */
  async save() {
    try {
      const dir = path.dirname(this.dataFile);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(
        this.dataFile,
        JSON.stringify(this.metrics, null, 2)
      );
      
    } catch (error) {
      this.logger.error('メトリクスデータ保存エラー:', error);
    }
  }
  
  /**
   * ヘルスデータの記録
   */
  async record(healthData) {
    if (!this.loaded) {
      await this.load();
    }
    
    // タイムスタンプを追加
    const record = {
      ...healthData,
      recordedAt: new Date().toISOString()
    };
    
    this.metrics.push(record);
    
    // 最大レコード数を超えた場合は古いものを削除
    if (this.metrics.length > this.maxRecords) {
      this.metrics.shift();
    }
    
    // 非同期で保存
    this.save().catch(error => {
      this.logger.error('メトリクス保存エラー:', error);
    });
  }
  
  /**
   * 最新のヘルスデータを取得
   */
  async getLatest() {
    if (!this.loaded) {
      await this.load();
    }
    
    return this.metrics.length > 0 
      ? this.metrics[this.metrics.length - 1]
      : null;
  }
  
  /**
   * 指定時間分の履歴を取得
   */
  async getHistory(hours = 24) {
    if (!this.loaded) {
      await this.load();
    }
    
    const cutoffTime = Date.now() - (hours * 60 * 60 * 1000);
    
    return this.metrics.filter(record => {
      const recordTime = new Date(record.recordedAt || record.timestamp).getTime();
      return recordTime >= cutoffTime;
    });
  }
  
  /**
   * トレンド分析
   */
  async analyzeTrends() {
    if (!this.loaded) {
      await this.load();
    }
    
    if (this.metrics.length < 10) {
      return {
        hasEnoughData: false,
        message: 'トレンド分析には最低10個のデータポイントが必要です'
      };
    }
    
    const recentMetrics = this.metrics.slice(-60); // 直近1時間
    const analysis = {
      hasEnoughData: true,
      score: {
        current: 0,
        average: 0,
        trend: 'stable',
        change: 0
      },
      components: {},
      alerts: []
    };
    
    // 現在のスコア
    if (recentMetrics.length > 0) {
      analysis.score.current = recentMetrics[recentMetrics.length - 1].score || 0;
    }
    
    // 平均スコア
    const scores = recentMetrics
      .map(m => m.score || 0)
      .filter(s => s > 0);
    
    if (scores.length > 0) {
      analysis.score.average = Math.round(
        scores.reduce((a, b) => a + b, 0) / scores.length
      );
    }
    
    // トレンド分析（線形回帰）
    if (scores.length >= 5) {
      const trend = this.calculateTrend(scores);
      analysis.score.trend = trend.slope > 0.5 ? 'improving' :
                            trend.slope < -0.5 ? 'declining' : 'stable';
      analysis.score.change = Math.round(trend.slope * 10); // 10データポイント分の変化
    }
    
    // コンポーネント別分析
    const components = ['application', 'system', 'network', 'data'];
    for (const component of components) {
      const componentScores = recentMetrics
        .map(m => m.components?.[component]?.score || 0)
        .filter(s => s > 0);
      
      if (componentScores.length > 0) {
        const avg = Math.round(
          componentScores.reduce((a, b) => a + b, 0) / componentScores.length
        );
        
        const trend = componentScores.length >= 5 
          ? this.calculateTrend(componentScores)
          : { slope: 0 };
        
        analysis.components[component] = {
          average: avg,
          current: componentScores[componentScores.length - 1],
          trend: trend.slope > 0.5 ? 'improving' :
                trend.slope < -0.5 ? 'declining' : 'stable'
        };
        
        // コンポーネント固有のアラート
        if (avg < 60) {
          analysis.alerts.push({
            component,
            type: 'low_score',
            message: `${component}の平均スコアが低下しています（${avg}）`
          });
        }
        
        if (trend.slope < -1) {
          analysis.alerts.push({
            component,
            type: 'declining_trend',
            message: `${component}のスコアが急速に低下しています`
          });
        }
      }
    }
    
    // 全体的なアラート
    if (analysis.score.trend === 'declining') {
      analysis.alerts.push({
        type: 'overall_declining',
        message: 'システム全体の健全性が低下傾向にあります'
      });
    }
    
    // 変動性の分析
    const volatility = this.calculateVolatility(scores);
    if (volatility > 20) {
      analysis.alerts.push({
        type: 'high_volatility',
        message: 'システムの健全性が不安定です（変動が大きい）'
      });
    }
    
    analysis.score.volatility = Math.round(volatility);
    
    return analysis;
  }
  
  /**
   * トレンド計算（線形回帰）
   */
  calculateTrend(values) {
    const n = values.length;
    if (n < 2) return { slope: 0, intercept: values[0] || 0 };
    
    // x座標は0から始まる連番
    const sumX = (n - 1) * n / 2;
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = values.reduce((sum, y, x) => sum + x * y, 0);
    const sumX2 = values.reduce((sum, _, x) => sum + x * x, 0);
    
    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    return { slope, intercept };
  }
  
  /**
   * 変動性の計算（標準偏差）
   */
  calculateVolatility(values) {
    if (values.length < 2) return 0;
    
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / values.length;
    
    return Math.sqrt(variance);
  }
  
  /**
   * 統計サマリーの生成
   */
  async generateSummary(hours = 24) {
    const history = await this.getHistory(hours);
    
    if (history.length === 0) {
      return {
        period: `${hours}時間`,
        dataPoints: 0,
        message: 'データがありません'
      };
    }
    
    const scores = history.map(h => h.score || 0).filter(s => s > 0);
    const statuses = history.map(h => h.status);
    
    const summary = {
      period: `${hours}時間`,
      dataPoints: history.length,
      score: {
        min: Math.min(...scores),
        max: Math.max(...scores),
        average: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      },
      status: {
        healthy: statuses.filter(s => s === 'healthy').length,
        degraded: statuses.filter(s => s === 'degraded').length,
        unhealthy: statuses.filter(s => s === 'unhealthy').length,
        error: statuses.filter(s => s === 'error').length
      },
      availability: Math.round(
        (statuses.filter(s => s !== 'error').length / statuses.length) * 100
      )
    };
    
    // 最も問題の多いコンポーネント
    const componentIssues = {};
    for (const record of history) {
      if (record.components) {
        for (const [component, data] of Object.entries(record.components)) {
          if (data.score < 60) {
            componentIssues[component] = (componentIssues[component] || 0) + 1;
          }
        }
      }
    }
    
    if (Object.keys(componentIssues).length > 0) {
      const sorted = Object.entries(componentIssues)
        .sort((a, b) => b[1] - a[1]);
      
      summary.problematicComponents = sorted.map(([component, count]) => ({
        component,
        incidents: count,
        percentage: Math.round((count / history.length) * 100)
      }));
    }
    
    return summary;
  }
  
  /**
   * データのクリーンアップ
   */
  async cleanup(daysToKeep = 7) {
    if (!this.loaded) {
      await this.load();
    }
    
    const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
    const before = this.metrics.length;
    
    this.metrics = this.metrics.filter(record => {
      const recordTime = new Date(record.recordedAt || record.timestamp).getTime();
      return recordTime >= cutoffTime;
    });
    
    const removed = before - this.metrics.length;
    
    if (removed > 0) {
      await this.save();
      this.logger.info(`${removed}個の古いメトリクスレコードを削除しました`);
    }
    
    return { before, after: this.metrics.length, removed };
  }
}

module.exports = HealthMetricsStore;