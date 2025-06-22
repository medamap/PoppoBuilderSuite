/**
 * Usage Analytics for CCSP
 * Provides comprehensive usage tracking, statistics, and analytics
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

class UsageAnalytics extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      persistPath: options.persistPath || path.join(__dirname, '.poppobuilder/ccsp/analytics'),
      aggregationInterval: options.aggregationInterval || 60000, // 1分ごとに集計
      retentionDays: options.retentionDays || 90, // 90日間保持
      ...options
    };
    
    // リアルタイム統計
    this.realtime = {
      currentMinute: {
        tokens: 0,
        requests: 0,
        errors: 0,
        avgLatency: 0,
        startTime: Date.now()
      },
      last5Minutes: [],
      last60Minutes: []
    };
    
    // エージェント別統計
    this.agentStats = new Map(); // agentId -> stats
    
    // 集計データ
    this.aggregated = {
      hourly: [],   // 過去24時間
      daily: [],    // 過去30日
      weekly: [],   // 過去12週
      monthly: []   // 過去12ヶ月
    };
    
    // エラー分析
    this.errorAnalysis = {
      byType: new Map(),      // エラータイプ別
      byAgent: new Map(),     // エージェント別
      recent: []              // 最近のエラー
    };
    
    // 使用パターン
    this.patterns = {
      peakHours: [],
      quietHours: [],
      trend: 'stable'  // increasing, decreasing, stable
    };
    
    // 初期化
    this.initialize();
  }
  
  async initialize() {
    try {
      // 永続化ディレクトリの作成
      await fs.mkdir(this.options.persistPath, { recursive: true });
      
      // 既存データの読み込み
      await this.loadPersistedData();
      
      // 集計タイマーの開始
      this.startAggregation();
      
      this.emit('initialized');
    } catch (error) {
      this.emit('error', { type: 'initialization', error });
    }
  }
  
  /**
   * 使用量を記録
   * @param {Object} usage - 使用量データ
   * @param {string} usage.agentId - エージェントID
   * @param {string} usage.taskId - タスクID
   * @param {number} usage.tokens - トークン数
   * @param {number} usage.latency - レイテンシ（ミリ秒）
   * @param {string} usage.model - 使用モデル
   * @param {Object} usage.metadata - その他のメタデータ
   */
  async recordUsage(usage) {
    const timestamp = Date.now();
    
    // リアルタイム統計の更新
    this.updateRealtimeStats(usage);
    
    // エージェント別統計の更新
    this.updateAgentStats(usage);
    
    // 詳細ログの保存
    await this.saveUsageLog({
      ...usage,
      timestamp
    });
    
    // イベント発行
    this.emit('usage:recorded', usage);
  }
  
  /**
   * エラーを記録
   * @param {Object} error - エラー情報
   * @param {string} error.agentId - エージェントID
   * @param {string} error.taskId - タスクID
   * @param {string} error.type - エラータイプ
   * @param {string} error.message - エラーメッセージ
   * @param {Object} error.context - エラーコンテキスト
   */
  async recordError(error) {
    const timestamp = Date.now();
    
    // エラー統計の更新
    this.updateErrorStats(error);
    
    // エラーログの保存
    await this.saveErrorLog({
      ...error,
      timestamp
    });
    
    // イベント発行
    this.emit('error:recorded', error);
  }
  
  /**
   * リアルタイム統計の更新
   */
  updateRealtimeStats(usage) {
    const now = Date.now();
    
    // 分が変わった場合
    if (now - this.realtime.currentMinute.startTime >= 60000) {
      // 過去の分を履歴に追加
      this.realtime.last60Minutes.push({ ...this.realtime.currentMinute });
      if (this.realtime.last60Minutes.length > 60) {
        this.realtime.last60Minutes.shift();
      }
      
      // 5分履歴の更新
      this.realtime.last5Minutes.push({ ...this.realtime.currentMinute });
      if (this.realtime.last5Minutes.length > 5) {
        this.realtime.last5Minutes.shift();
      }
      
      // 新しい分を開始
      this.realtime.currentMinute = {
        tokens: 0,
        requests: 0,
        errors: 0,
        avgLatency: 0,
        latencySum: 0,
        startTime: now
      };
    }
    
    // 現在の分の統計を更新
    this.realtime.currentMinute.tokens += usage.tokens || 0;
    this.realtime.currentMinute.requests += 1;
    
    if (usage.latency) {
      const count = this.realtime.currentMinute.requests;
      const sum = (this.realtime.currentMinute.latencySum || 0) + usage.latency;
      this.realtime.currentMinute.latencySum = sum;
      this.realtime.currentMinute.avgLatency = sum / count;
    }
  }
  
  /**
   * エージェント別統計の更新
   */
  updateAgentStats(usage) {
    const agentId = usage.agentId || 'unknown';
    
    if (!this.agentStats.has(agentId)) {
      this.agentStats.set(agentId, {
        totalTokens: 0,
        totalRequests: 0,
        totalErrors: 0,
        avgLatency: 0,
        latencySum: 0,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        models: new Map()
      });
    }
    
    const stats = this.agentStats.get(agentId);
    stats.totalTokens += usage.tokens || 0;
    stats.totalRequests += 1;
    stats.lastSeen = Date.now();
    
    if (usage.latency) {
      stats.latencySum += usage.latency;
      stats.avgLatency = stats.latencySum / stats.totalRequests;
    }
    
    // モデル別統計
    if (usage.model) {
      const modelStats = stats.models.get(usage.model) || { count: 0, tokens: 0 };
      modelStats.count += 1;
      modelStats.tokens += usage.tokens || 0;
      stats.models.set(usage.model, modelStats);
    }
  }
  
  /**
   * エラー統計の更新
   */
  updateErrorStats(error) {
    // 現在の分のエラー数を増加
    this.realtime.currentMinute.errors += 1;
    
    // エラータイプ別
    const errorType = error.type || 'unknown';
    const typeCount = this.errorAnalysis.byType.get(errorType) || 0;
    this.errorAnalysis.byType.set(errorType, typeCount + 1);
    
    // エージェント別
    const agentId = error.agentId || 'unknown';
    const agentErrors = this.errorAnalysis.byAgent.get(agentId) || 0;
    this.errorAnalysis.byAgent.set(agentId, agentErrors + 1);
    
    // エージェント統計のエラー数も更新
    if (this.agentStats.has(agentId)) {
      this.agentStats.get(agentId).totalErrors += 1;
    }
    
    // 最近のエラーリストに追加
    this.errorAnalysis.recent.unshift({
      ...error,
      timestamp: Date.now()
    });
    
    // 最大100件まで保持
    if (this.errorAnalysis.recent.length > 100) {
      this.errorAnalysis.recent = this.errorAnalysis.recent.slice(0, 100);
    }
  }
  
  /**
   * 統計情報の取得
   * @param {string} period - 期間 (realtime/hourly/daily/weekly/monthly)
   * @param {number} count - 取得する件数
   */
  getStatistics(period = 'realtime', count = 10) {
    switch (period) {
      case 'realtime':
        return {
          current: this.realtime.currentMinute,
          last5Minutes: this.realtime.last5Minutes,
          last60Minutes: this.realtime.last60Minutes
        };
      
      case 'hourly':
        return this.aggregated.hourly.slice(-count);
      
      case 'daily':
        return this.aggregated.daily.slice(-count);
      
      case 'weekly':
        return this.aggregated.weekly.slice(-count);
      
      case 'monthly':
        return this.aggregated.monthly.slice(-count);
      
      default:
        return null;
    }
  }
  
  /**
   * エージェント別統計の取得
   * @param {string} agentId - エージェントID（省略時は全て）
   */
  getAgentStatistics(agentId = null) {
    if (agentId) {
      return this.agentStats.get(agentId) || null;
    }
    
    // 全エージェントの統計を配列で返す
    const allStats = [];
    for (const [id, stats] of this.agentStats) {
      allStats.push({
        agentId: id,
        ...stats
      });
    }
    
    // リクエスト数でソート
    return allStats.sort((a, b) => b.totalRequests - a.totalRequests);
  }
  
  /**
   * エラー分析の取得
   */
  getErrorAnalysis() {
    return {
      summary: {
        total: Array.from(this.errorAnalysis.byType.values()).reduce((sum, count) => sum + count, 0),
        types: this.errorAnalysis.byType.size,
        affectedAgents: this.errorAnalysis.byAgent.size
      },
      byType: Object.fromEntries(this.errorAnalysis.byType),
      byAgent: Object.fromEntries(this.errorAnalysis.byAgent),
      recent: this.errorAnalysis.recent.slice(0, 20)
    };
  }
  
  /**
   * 使用パターンの分析
   */
  async analyzePatterns() {
    const hourlyData = this.aggregated.hourly;
    
    if (hourlyData.length < 24) {
      return this.patterns; // データ不足
    }
    
    // 時間別の平均使用量を計算
    const hourlyAverage = new Array(24).fill(0);
    const hourlyCounts = new Array(24).fill(0);
    
    hourlyData.forEach(data => {
      const hour = new Date(data.timestamp).getHours();
      hourlyAverage[hour] += data.tokens;
      hourlyCounts[hour] += 1;
    });
    
    // 平均を計算
    for (let i = 0; i < 24; i++) {
      if (hourlyCounts[i] > 0) {
        hourlyAverage[i] = hourlyAverage[i] / hourlyCounts[i];
      }
    }
    
    // ピーク時間と静かな時間を特定
    const sorted = hourlyAverage.map((avg, hour) => ({ hour, avg }))
      .sort((a, b) => b.avg - a.avg);
    
    this.patterns.peakHours = sorted.slice(0, 3).map(item => item.hour);
    this.patterns.quietHours = sorted.slice(-3).map(item => item.hour);
    
    // トレンドを分析
    this.patterns.trend = this.analyzeTrend(this.aggregated.daily);
    
    return this.patterns;
  }
  
  /**
   * トレンドを分析
   */
  analyzeTrend(data) {
    if (data.length < 7) return 'stable';
    
    // 最近7日間のデータ
    const recent = data.slice(-7);
    const firstHalf = recent.slice(0, 3);
    const secondHalf = recent.slice(4, 7);
    
    const firstAvg = firstHalf.reduce((sum, d) => sum + d.tokens, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, d) => sum + d.tokens, 0) / secondHalf.length;
    
    const changeRate = (secondAvg - firstAvg) / firstAvg;
    
    if (changeRate > 0.2) return 'increasing';
    if (changeRate < -0.2) return 'decreasing';
    return 'stable';
  }
  
  /**
   * 集計処理の開始
   */
  startAggregation() {
    this.aggregationTimer = setInterval(async () => {
      await this.aggregate();
    }, this.options.aggregationInterval);
  }
  
  /**
   * 集計処理
   */
  async aggregate() {
    const now = Date.now();
    
    // 時間別集計
    await this.aggregateHourly(now);
    
    // 日別集計
    await this.aggregateDaily(now);
    
    // 週別集計
    await this.aggregateWeekly(now);
    
    // 月別集計
    await this.aggregateMonthly(now);
    
    // 古いデータのクリーンアップ
    await this.cleanupOldData();
  }
  
  /**
   * 時間別集計
   */
  async aggregateHourly(now) {
    const hourStart = new Date(now);
    hourStart.setMinutes(0, 0, 0);
    
    // 前の時間のデータがまだ集計されていない場合
    const lastHourly = this.aggregated.hourly[this.aggregated.hourly.length - 1];
    if (!lastHourly || lastHourly.timestamp < hourStart.getTime() - 3600000) {
      // 過去60分のデータを集計
      const stats = this.calculatePeriodStats(this.realtime.last60Minutes);
      
      this.aggregated.hourly.push({
        timestamp: hourStart.getTime() - 3600000,
        ...stats
      });
      
      // 24時間分だけ保持
      if (this.aggregated.hourly.length > 24) {
        this.aggregated.hourly.shift();
      }
    }
  }
  
  /**
   * 期間統計の計算
   */
  calculatePeriodStats(data) {
    let totalTokens = 0;
    let totalRequests = 0;
    let totalErrors = 0;
    let totalLatency = 0;
    
    data.forEach(minute => {
      totalTokens += minute.tokens || 0;
      totalRequests += minute.requests || 0;
      totalErrors += minute.errors || 0;
      totalLatency += (minute.avgLatency || 0) * (minute.requests || 0);
    });
    
    return {
      tokens: totalTokens,
      requests: totalRequests,
      errors: totalErrors,
      avgLatency: totalRequests > 0 ? totalLatency / totalRequests : 0,
      errorRate: totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0
    };
  }
  
  /**
   * 日別集計（簡略版）
   */
  async aggregateDaily(now) {
    // 実装は時間別と同様のパターン
  }
  
  /**
   * 週別集計（簡略版）
   */
  async aggregateWeekly(now) {
    // 実装は時間別と同様のパターン
  }
  
  /**
   * 月別集計（簡略版）
   */
  async aggregateMonthly(now) {
    // 実装は時間別と同様のパターン
  }
  
  /**
   * 使用ログの保存
   */
  async saveUsageLog(usage) {
    try {
      const date = new Date(usage.timestamp);
      const fileName = `usage-${date.toISOString().split('T')[0]}.jsonl`;
      const filePath = path.join(this.options.persistPath, 'logs', fileName);
      
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, JSON.stringify(usage) + '\n');
    } catch (error) {
      this.emit('error', { type: 'save:usage', error });
    }
  }
  
  /**
   * エラーログの保存
   */
  async saveErrorLog(error) {
    try {
      const date = new Date(error.timestamp);
      const fileName = `errors-${date.toISOString().split('T')[0]}.jsonl`;
      const filePath = path.join(this.options.persistPath, 'logs', fileName);
      
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.appendFile(filePath, JSON.stringify(error) + '\n');
    } catch (error) {
      this.emit('error', { type: 'save:error', error });
    }
  }
  
  /**
   * 永続化データの読み込み
   */
  async loadPersistedData() {
    try {
      // 集計データの読み込み
      const aggregatedPath = path.join(this.options.persistPath, 'aggregated.json');
      const aggregatedData = await fs.readFile(aggregatedPath, 'utf8');
      this.aggregated = JSON.parse(aggregatedData);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.emit('error', { type: 'load:aggregated', error });
      }
    }
    
    try {
      // エージェント統計の読み込み
      const agentStatsPath = path.join(this.options.persistPath, 'agent-stats.json');
      const agentStatsData = await fs.readFile(agentStatsPath, 'utf8');
      const parsed = JSON.parse(agentStatsData);
      
      // MapオブジェクトとMapの再構築
      this.agentStats = new Map(Object.entries(parsed));
      for (const [agentId, stats] of this.agentStats) {
        if (stats.models) {
          stats.models = new Map(Object.entries(stats.models));
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.emit('error', { type: 'load:agentStats', error });
      }
    }
  }
  
  /**
   * 古いデータのクリーンアップ
   */
  async cleanupOldData() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.options.retentionDays);
    
    try {
      const logsDir = path.join(this.options.persistPath, 'logs');
      const files = await fs.readdir(logsDir);
      
      for (const file of files) {
        if (file.endsWith('.jsonl')) {
          const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const fileDate = new Date(dateMatch[1]);
            if (fileDate < cutoffDate) {
              await fs.unlink(path.join(logsDir, file));
            }
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.emit('error', { type: 'cleanup', error });
      }
    }
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    if (this.aggregationTimer) {
      clearInterval(this.aggregationTimer);
      this.aggregationTimer = null;
    }
    
    // 現在のデータを保存
    await this.saveAggregatedData();
    await this.saveAgentStats();
  }
  
  /**
   * 集計データの保存
   */
  async saveAggregatedData() {
    try {
      const data = JSON.stringify(this.aggregated, null, 2);
      await fs.writeFile(path.join(this.options.persistPath, 'aggregated.json'), data);
    } catch (error) {
      this.emit('error', { type: 'save:aggregated', error });
    }
  }
  
  /**
   * エージェント統計の保存
   */
  async saveAgentStats() {
    try {
      // MapをObjectに変換
      const obj = {};
      for (const [agentId, stats] of this.agentStats) {
        obj[agentId] = {
          ...stats,
          models: stats.models ? Object.fromEntries(stats.models) : {}
        };
      }
      
      const data = JSON.stringify(obj, null, 2);
      await fs.writeFile(path.join(this.options.persistPath, 'agent-stats.json'), data);
    } catch (error) {
      this.emit('error', { type: 'save:agentStats', error });
    }
  }
}

module.exports = UsageAnalytics;