/**
 * エラーパターン学習システム
 * 
 * Issue #37 (Phase 3拡張): エラーログ収集機能 - 学習機能の実装
 * 修復結果から学習し、パターンの有効性を評価・最適化する
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('../../src/logger');

class ErrorPatternLearner {
  constructor(options = {}) {
    this.logger = new Logger('ErrorPatternLearner');
    this.config = {
      dataFile: options.dataFile || path.join(__dirname, '../../data/ccla/learning-data.json'),
      minSampleSize: options.minSampleSize || 5,
      successRateThreshold: options.successRateThreshold || 0.7,
      autoDisableThreshold: options.autoDisableThreshold || 0.3,
      maxHistorySize: options.maxHistorySize || 10000,
      ...options
    };
    
    this.learningData = new Map();
    this.patternHistory = [];
    this.initialized = false;
  }
  
  /**
   * 初期化
   */
  async initialize() {
    try {
      await this.loadLearningData();
      this.initialized = true;
      this.logger.info('ErrorPatternLearner initialized', {
        patterns: this.learningData.size,
        historySize: this.patternHistory.length
      });
    } catch (error) {
      this.logger.error('Failed to initialize learner', error);
      throw error;
    }
  }
  
  /**
   * 学習データの読み込み
   */
  async loadLearningData() {
    try {
      const data = await fs.readFile(this.config.dataFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // マップに変換
      if (parsed.patterns) {
        Object.entries(parsed.patterns).forEach(([pattern, data]) => {
          this.learningData.set(pattern, data);
        });
      }
      
      if (parsed.history) {
        this.patternHistory = parsed.history;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // ファイルが存在しない場合は初期化
      this.logger.info('No existing learning data found, starting fresh');
    }
  }
  
  /**
   * 学習データの保存
   */
  async saveLearningData() {
    try {
      const data = {
        patterns: Object.fromEntries(this.learningData),
        history: this.patternHistory.slice(-this.config.maxHistorySize),
        lastUpdated: new Date().toISOString()
      };
      
      const dir = path.dirname(this.config.dataFile);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.config.dataFile, JSON.stringify(data, null, 2));
      
      this.logger.debug('Learning data saved', {
        patterns: this.learningData.size,
        historySize: this.patternHistory.length
      });
    } catch (error) {
      this.logger.error('Failed to save learning data', error);
      throw error;
    }
  }
  
  /**
   * 修復結果の記録
   */
  async recordRepairResult(pattern, success, details = {}) {
    if (!this.initialized) {
      await this.initialize();
    }
    
    // パターンデータの取得または初期化
    let patternData = this.learningData.get(pattern) || {
      pattern,
      successCount: 0,
      failureCount: 0,
      totalCount: 0,
      successRate: 0,
      averageRepairTime: 0,
      totalRepairTime: 0,
      firstSeen: new Date().toISOString(),
      lastUpdated: new Date().toISOString(),
      disabled: false,
      disabledReason: null
    };
    
    // カウントの更新
    patternData.totalCount++;
    if (success) {
      patternData.successCount++;
    } else {
      patternData.failureCount++;
    }
    
    // 成功率の計算
    patternData.successRate = patternData.successCount / patternData.totalCount;
    
    // 修復時間の更新
    if (details.repairTime) {
      patternData.totalRepairTime += details.repairTime;
      patternData.averageRepairTime = patternData.totalRepairTime / patternData.totalCount;
    }
    
    // 最終更新時刻
    patternData.lastUpdated = new Date().toISOString();
    
    // 自動無効化のチェック
    if (patternData.totalCount >= this.config.minSampleSize && 
        patternData.successRate < this.config.autoDisableThreshold) {
      patternData.disabled = true;
      patternData.disabledReason = `Success rate (${(patternData.successRate * 100).toFixed(1)}%) below threshold`;
      this.logger.warn('Pattern auto-disabled due to low success rate', {
        pattern,
        successRate: patternData.successRate,
        totalCount: patternData.totalCount
      });
    }
    
    // データの保存
    this.learningData.set(pattern, patternData);
    
    // 履歴に記録
    this.patternHistory.push({
      pattern,
      success,
      timestamp: new Date().toISOString(),
      details
    });
    
    // 定期的に保存
    if (this.patternHistory.length % 10 === 0) {
      await this.saveLearningData();
    }
    
    return patternData;
  }
  
  /**
   * パターンの有効性評価
   */
  evaluatePattern(pattern) {
    const data = this.learningData.get(pattern);
    if (!data) {
      return {
        pattern,
        effective: false,
        reason: 'No learning data available',
        recommendation: 'Collect more data'
      };
    }
    
    // 無効化されている場合
    if (data.disabled) {
      return {
        pattern,
        effective: false,
        reason: data.disabledReason,
        recommendation: 'Pattern should not be used',
        data
      };
    }
    
    // サンプル数が少ない場合
    if (data.totalCount < this.config.minSampleSize) {
      return {
        pattern,
        effective: true, // 暫定的に有効
        reason: 'Insufficient data',
        recommendation: `Need ${this.config.minSampleSize - data.totalCount} more samples`,
        data
      };
    }
    
    // 成功率による評価
    const effective = data.successRate >= this.config.successRateThreshold;
    
    return {
      pattern,
      effective,
      reason: effective ? 'Good success rate' : 'Low success rate',
      recommendation: effective ? 'Continue using' : 'Consider disabling',
      data
    };
  }
  
  /**
   * 全パターンの統計情報取得
   */
  getStatistics() {
    const stats = {
      totalPatterns: this.learningData.size,
      activePatterns: 0,
      disabledPatterns: 0,
      effectivePatterns: 0,
      ineffectivePatterns: 0,
      totalRepairs: 0,
      totalSuccesses: 0,
      totalFailures: 0,
      overallSuccessRate: 0,
      patterns: []
    };
    
    for (const [pattern, data] of this.learningData) {
      if (data.disabled) {
        stats.disabledPatterns++;
      } else {
        stats.activePatterns++;
        
        const evaluation = this.evaluatePattern(pattern);
        if (evaluation.effective) {
          stats.effectivePatterns++;
        } else {
          stats.ineffectivePatterns++;
        }
      }
      
      stats.totalRepairs += data.totalCount;
      stats.totalSuccesses += data.successCount;
      stats.totalFailures += data.failureCount;
      
      stats.patterns.push({
        pattern,
        ...data,
        evaluation: this.evaluatePattern(pattern)
      });
    }
    
    // 全体の成功率
    if (stats.totalRepairs > 0) {
      stats.overallSuccessRate = stats.totalSuccesses / stats.totalRepairs;
    }
    
    // パターンを成功率でソート
    stats.patterns.sort((a, b) => b.successRate - a.successRate);
    
    return stats;
  }
  
  /**
   * 新しいパターンの提案
   */
  async suggestNewPatterns() {
    const suggestions = [];
    
    // 失敗履歴から共通パターンを抽出
    const recentFailures = this.patternHistory
      .filter(h => !h.success && h.timestamp > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
      .slice(-100);
    
    // エラーメッセージのグループ化
    const errorGroups = new Map();
    for (const failure of recentFailures) {
      if (failure.details && failure.details.errorMessage) {
        const key = this.normalizeErrorMessage(failure.details.errorMessage);
        if (!errorGroups.has(key)) {
          errorGroups.set(key, []);
        }
        errorGroups.get(key).push(failure);
      }
    }
    
    // 頻出エラーから新パターンを提案
    for (const [errorKey, failures] of errorGroups) {
      if (failures.length >= 3) { // 3回以上発生
        suggestions.push({
          errorPattern: errorKey,
          occurrences: failures.length,
          examples: failures.slice(0, 3),
          suggestedPattern: this.generatePatternId(errorKey),
          confidence: Math.min(failures.length / 10, 1) // 最大1.0
        });
      }
    }
    
    return suggestions.sort((a, b) => b.occurrences - a.occurrences);
  }
  
  /**
   * エラーメッセージの正規化
   */
  normalizeErrorMessage(message) {
    return message
      .replace(/\d+/g, 'N') // 数字を置換
      .replace(/["'].*?["']/g, 'STRING') // 文字列リテラルを置換
      .replace(/\s+/g, ' ') // 空白を正規化
      .trim()
      .substring(0, 100); // 最初の100文字
  }
  
  /**
   * パターンIDの生成
   */
  generatePatternId(errorKey) {
    const hash = require('crypto')
      .createHash('md5')
      .update(errorKey)
      .digest('hex')
      .substring(0, 6);
    
    return `EP_AUTO_${hash.toUpperCase()}`;
  }
  
  /**
   * パターンの手動有効化/無効化
   */
  async setPatternStatus(pattern, enabled, reason = null) {
    const data = this.learningData.get(pattern);
    if (!data) {
      throw new Error(`Pattern ${pattern} not found`);
    }
    
    data.disabled = !enabled;
    data.disabledReason = enabled ? null : (reason || 'Manually disabled');
    data.lastUpdated = new Date().toISOString();
    
    this.learningData.set(pattern, data);
    await this.saveLearningData();
    
    this.logger.info('Pattern status updated', {
      pattern,
      enabled,
      reason
    });
    
    return data;
  }
  
  /**
   * 学習データのエクスポート
   */
  async exportLearningData(format = 'json') {
    const stats = this.getStatistics();
    
    if (format === 'csv') {
      const csv = [
        'Pattern,Success Count,Failure Count,Total Count,Success Rate,Avg Repair Time,Status',
        ...stats.patterns.map(p => 
          `${p.pattern},${p.successCount},${p.failureCount},${p.totalCount},${(p.successRate * 100).toFixed(1)}%,${p.averageRepairTime.toFixed(0)}ms,${p.disabled ? 'Disabled' : 'Active'}`
        )
      ].join('\n');
      
      return csv;
    }
    
    return stats;
  }
}

module.exports = ErrorPatternLearner;