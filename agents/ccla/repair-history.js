/**
 * 修復履歴管理システム
 * 
 * Issue #37 (Phase 3拡張): エラーログ収集機能 - 修復履歴管理の実装
 * 修復の完全な履歴を記録し、分析・検索機能を提供
 */

const fs = require('fs').promises;
const path = require('path');
const Logger = require('../../src/logger');
const crypto = require('crypto');

class RepairHistoryManager {
  constructor(options = {}) {
    this.logger = new Logger('RepairHistoryManager');
    this.config = {
      historyDir: options.historyDir || path.join(__dirname, '../../data/ccla/repair-history'),
      maxHistoryFiles: options.maxHistoryFiles || 1000,
      historyRetentionDays: options.historyRetentionDays || 90,
      indexFile: options.indexFile || 'repair-history-index.json',
      ...options
    };
    
    this.historyIndex = new Map();
    this.statistics = {
      totalRepairs: 0,
      successfulRepairs: 0,
      failedRepairs: 0,
      averageRepairTime: 0,
      totalRepairTime: 0
    };
  }
  
  /**
   * 初期化
   */
  async initialize() {
    try {
      // ディレクトリの作成
      await fs.mkdir(this.config.historyDir, { recursive: true });
      
      // インデックスの読み込み
      await this.loadIndex();
      
      // 古い履歴のクリーンアップ
      await this.cleanupOldHistory();
      
      this.logger.info('RepairHistoryManager initialized', {
        totalEntries: this.historyIndex.size,
        statistics: this.statistics
      });
    } catch (error) {
      this.logger.error('Failed to initialize repair history', error);
      throw error;
    }
  }
  
  /**
   * インデックスの読み込み
   */
  async loadIndex() {
    try {
      const indexPath = path.join(this.config.historyDir, this.config.indexFile);
      const data = await fs.readFile(indexPath, 'utf8');
      const parsed = JSON.parse(data);
      
      // マップに変換
      if (parsed.entries) {
        Object.entries(parsed.entries).forEach(([id, entry]) => {
          this.historyIndex.set(id, entry);
        });
      }
      
      // 統計情報
      if (parsed.statistics) {
        this.statistics = parsed.statistics;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      this.logger.info('No existing history index found');
    }
  }
  
  /**
   * インデックスの保存
   */
  async saveIndex() {
    try {
      const indexPath = path.join(this.config.historyDir, this.config.indexFile);
      const data = {
        entries: Object.fromEntries(this.historyIndex),
        statistics: this.statistics,
        lastUpdated: new Date().toISOString()
      };
      
      await fs.writeFile(indexPath, JSON.stringify(data, null, 2));
    } catch (error) {
      this.logger.error('Failed to save history index', error);
      throw error;
    }
  }
  
  /**
   * 修復履歴の記録
   */
  async recordRepair(repairInfo) {
    const repairId = this.generateRepairId();
    const timestamp = new Date().toISOString();
    
    const historyEntry = {
      id: repairId,
      timestamp,
      pattern: repairInfo.pattern,
      errorHash: repairInfo.errorHash,
      file: repairInfo.file,
      success: repairInfo.success,
      repairTime: repairInfo.repairTime || 0,
      changes: repairInfo.changes || [],
      testResults: repairInfo.testResults || null,
      rollbackInfo: repairInfo.rollbackInfo || null,
      errorDetails: {
        message: repairInfo.errorMessage,
        stack: repairInfo.errorStack,
        category: repairInfo.errorCategory
      },
      repairDetails: {
        method: repairInfo.repairMethod,
        confidence: repairInfo.confidence || 0,
        backupFile: repairInfo.backupFile || null
      }
    };
    
    // 詳細ファイルの保存
    const detailPath = path.join(this.config.historyDir, `${repairId}.json`);
    await fs.writeFile(detailPath, JSON.stringify(historyEntry, null, 2));
    
    // インデックスエントリ
    const indexEntry = {
      id: repairId,
      timestamp,
      pattern: repairInfo.pattern,
      file: repairInfo.file,
      success: repairInfo.success,
      repairTime: repairInfo.repairTime,
      detailFile: `${repairId}.json`
    };
    
    this.historyIndex.set(repairId, indexEntry);
    
    // 統計の更新
    this.updateStatistics(historyEntry);
    
    // 定期的に保存
    if (this.historyIndex.size % 10 === 0) {
      await this.saveIndex();
    }
    
    this.logger.info('Repair recorded', {
      repairId,
      pattern: repairInfo.pattern,
      success: repairInfo.success
    });
    
    return repairId;
  }
  
  /**
   * 統計情報の更新
   */
  updateStatistics(entry) {
    this.statistics.totalRepairs++;
    
    if (entry.success) {
      this.statistics.successfulRepairs++;
    } else {
      this.statistics.failedRepairs++;
    }
    
    if (entry.repairTime) {
      this.statistics.totalRepairTime += entry.repairTime;
      this.statistics.averageRepairTime = 
        this.statistics.totalRepairTime / this.statistics.totalRepairs;
    }
  }
  
  /**
   * 修復履歴の検索
   */
  async searchHistory(criteria = {}) {
    const results = [];
    
    for (const [id, entry] of this.historyIndex) {
      let match = true;
      
      // パターンでフィルタ
      if (criteria.pattern && entry.pattern !== criteria.pattern) {
        match = false;
      }
      
      // ファイルでフィルタ
      if (criteria.file && !entry.file.includes(criteria.file)) {
        match = false;
      }
      
      // 成功/失敗でフィルタ
      if (criteria.success !== undefined && entry.success !== criteria.success) {
        match = false;
      }
      
      // 日付範囲でフィルタ
      if (criteria.startDate && new Date(entry.timestamp) < new Date(criteria.startDate)) {
        match = false;
      }
      
      if (criteria.endDate && new Date(entry.timestamp) > new Date(criteria.endDate)) {
        match = false;
      }
      
      if (match) {
        results.push(entry);
      }
    }
    
    // ソート
    if (criteria.sortBy === 'timestamp') {
      results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } else if (criteria.sortBy === 'repairTime') {
      results.sort((a, b) => b.repairTime - a.repairTime);
    }
    
    // 制限
    if (criteria.limit) {
      return results.slice(0, criteria.limit);
    }
    
    return results;
  }
  
  /**
   * 修復詳細の取得
   */
  async getRepairDetails(repairId) {
    const indexEntry = this.historyIndex.get(repairId);
    if (!indexEntry) {
      return null;
    }
    
    try {
      const detailPath = path.join(this.config.historyDir, indexEntry.detailFile);
      const data = await fs.readFile(detailPath, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      this.logger.error('Failed to load repair details', { repairId, error });
      return null;
    }
  }
  
  /**
   * パターン別統計の取得
   */
  async getPatternStatistics() {
    const patternStats = new Map();
    
    for (const [id, entry] of this.historyIndex) {
      if (!patternStats.has(entry.pattern)) {
        patternStats.set(entry.pattern, {
          pattern: entry.pattern,
          totalRepairs: 0,
          successfulRepairs: 0,
          failedRepairs: 0,
          totalRepairTime: 0,
          averageRepairTime: 0,
          files: new Set()
        });
      }
      
      const stats = patternStats.get(entry.pattern);
      stats.totalRepairs++;
      
      if (entry.success) {
        stats.successfulRepairs++;
      } else {
        stats.failedRepairs++;
      }
      
      if (entry.repairTime) {
        stats.totalRepairTime += entry.repairTime;
        stats.averageRepairTime = stats.totalRepairTime / stats.totalRepairs;
      }
      
      stats.files.add(entry.file);
    }
    
    // Setをarrayに変換
    const results = [];
    for (const [pattern, stats] of patternStats) {
      results.push({
        ...stats,
        files: Array.from(stats.files),
        successRate: stats.totalRepairs > 0 ? stats.successfulRepairs / stats.totalRepairs : 0
      });
    }
    
    return results.sort((a, b) => b.totalRepairs - a.totalRepairs);
  }
  
  /**
   * 類似修復の検索
   */
  async findSimilarRepairs(errorInfo, limit = 10) {
    const similarRepairs = [];
    
    // エラーメッセージの正規化
    const normalizedError = this.normalizeErrorMessage(errorInfo.message);
    
    for (const [id, entry] of this.historyIndex) {
      const details = await this.getRepairDetails(id);
      if (!details || !details.errorDetails) continue;
      
      const normalizedHistoricError = this.normalizeErrorMessage(details.errorDetails.message);
      
      // 類似度計算
      const similarity = this.calculateSimilarity(normalizedError, normalizedHistoricError);
      
      if (similarity > 0.6) { // 60%以上の類似度
        similarRepairs.push({
          ...entry,
          similarity,
          errorMessage: details.errorDetails.message,
          repairMethod: details.repairDetails.method
        });
      }
    }
    
    // 類似度でソート
    similarRepairs.sort((a, b) => b.similarity - a.similarity);
    
    return similarRepairs.slice(0, limit);
  }
  
  /**
   * エラーメッセージの正規化
   */
  normalizeErrorMessage(message) {
    return message
      .toLowerCase()
      .replace(/\d+/g, 'N')
      .replace(/["'].*?["']/g, 'STRING')
      .replace(/\s+/g, ' ')
      .trim();
  }
  
  /**
   * 文字列の類似度計算（Jaccard係数）
   */
  calculateSimilarity(str1, str2) {
    const set1 = new Set(str1.split(' '));
    const set2 = new Set(str2.split(' '));
    
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }
  
  /**
   * 修復時間の見積もり
   */
  async estimateRepairTime(pattern, file) {
    const history = await this.searchHistory({ 
      pattern, 
      file,
      success: true,
      limit: 10 
    });
    
    if (history.length === 0) {
      // パターンのみで再検索
      const patternHistory = await this.searchHistory({ 
        pattern,
        success: true,
        limit: 10 
      });
      
      if (patternHistory.length === 0) {
        return {
          estimated: null,
          confidence: 0,
          basedOn: 0
        };
      }
      
      history.push(...patternHistory);
    }
    
    const times = history.map(h => h.repairTime).filter(t => t > 0);
    if (times.length === 0) {
      return {
        estimated: null,
        confidence: 0,
        basedOn: 0
      };
    }
    
    // 平均と標準偏差を計算
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
    const stdDev = Math.sqrt(variance);
    
    return {
      estimated: Math.round(avg),
      min: Math.round(avg - stdDev),
      max: Math.round(avg + stdDev),
      confidence: Math.min(times.length / 10, 1), // 最大1.0
      basedOn: times.length
    };
  }
  
  /**
   * 古い履歴のクリーンアップ
   */
  async cleanupOldHistory() {
    const cutoffDate = new Date(
      Date.now() - this.config.historyRetentionDays * 24 * 60 * 60 * 1000
    );
    
    const toDelete = [];
    for (const [id, entry] of this.historyIndex) {
      if (new Date(entry.timestamp) < cutoffDate) {
        toDelete.push(id);
      }
    }
    
    if (toDelete.length > 0) {
      this.logger.info('Cleaning up old history', { count: toDelete.length });
      
      for (const id of toDelete) {
        const entry = this.historyIndex.get(id);
        if (entry && entry.detailFile) {
          try {
            await fs.unlink(path.join(this.config.historyDir, entry.detailFile));
          } catch (error) {
            // ファイルが既に削除されている可能性
          }
        }
        this.historyIndex.delete(id);
      }
      
      await this.saveIndex();
    }
  }
  
  /**
   * 修復IDの生成
   */
  generateRepairId() {
    return `repair-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  }
  
  /**
   * 履歴のエクスポート
   */
  async exportHistory(format = 'json', criteria = {}) {
    const history = await this.searchHistory(criteria);
    
    if (format === 'csv') {
      const csv = [
        'ID,Timestamp,Pattern,File,Success,Repair Time (ms)',
        ...history.map(h => 
          `${h.id},${h.timestamp},${h.pattern},${h.file},${h.success},${h.repairTime || 0}`
        )
      ].join('\n');
      
      return csv;
    }
    
    return {
      criteria,
      totalResults: history.length,
      history,
      statistics: this.statistics
    };
  }
}

module.exports = RepairHistoryManager;