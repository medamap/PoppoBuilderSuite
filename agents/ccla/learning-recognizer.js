/**
 * 学習型エラーパターン認識エンジン
 * エラーパターンの学習と新パターンの自動登録を行う
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class LearningErrorRecognizer {
  constructor(logger = console) {
    this.logger = logger;
    
    // 学習データの保存先
    this.learningDataPath = path.join(__dirname, '../../.poppo/learning-data.json');
    this.patternRegistryPath = path.join(__dirname, '../../.poppo/learned-patterns.json');
    
    // 学習設定
    this.config = {
      minOccurrencesForLearning: 3,    // パターン学習に必要な最小発生回数
      successRateThreshold: 0.8,        // 新パターン登録に必要な成功率
      confidenceDecayRate: 0.05,       // 信頼度の減衰率（失敗時）
      confidenceGrowthRate: 0.1,       // 信頼度の成長率（成功時）
      maxPatternAge: 30 * 24 * 60 * 60 * 1000  // 30日間のパターン保持期間
    };
    
    // 学習データ
    this.learningData = {};
    this.learnedPatterns = {};
    
    // 初期化
    this.loadLearningData();
  }
  
  /**
   * 学習データの読み込み
   */
  async loadLearningData() {
    try {
      // 学習データ
      if (await this.fileExists(this.learningDataPath)) {
        const data = await fs.readFile(this.learningDataPath, 'utf8');
        this.learningData = JSON.parse(data);
        this.cleanupOldData();
      }
      
      // 学習済みパターン
      if (await this.fileExists(this.patternRegistryPath)) {
        const data = await fs.readFile(this.patternRegistryPath, 'utf8');
        this.learnedPatterns = JSON.parse(data);
      }
    } catch (error) {
      this.logger.error('学習データ読み込みエラー:', error.message);
    }
  }
  
  /**
   * エラーパターンの記録
   */
  async recordError(errorInfo) {
    const patternKey = this.generatePatternKey(errorInfo);
    const timestamp = Date.now();
    
    if (!this.learningData[patternKey]) {
      this.learningData[patternKey] = {
        firstSeen: timestamp,
        lastSeen: timestamp,
        occurrences: 0,
        repairs: {
          attempted: 0,
          successful: 0,
          failed: 0
        },
        errorSamples: [],
        metadata: {
          category: errorInfo.analysis?.category || 'unknown',
          level: errorInfo.level || 'ERROR',
          pattern: errorInfo.analysis?.pattern || null
        }
      };
    }
    
    const data = this.learningData[patternKey];
    data.lastSeen = timestamp;
    data.occurrences++;
    
    // エラーサンプルを保存（最大5件）
    if (data.errorSamples.length < 5) {
      data.errorSamples.push({
        hash: errorInfo.hash,
        message: errorInfo.message,
        stackTrace: errorInfo.stackTrace?.slice(0, 3),
        timestamp: timestamp
      });
    }
    
    await this.saveLearningData();
    
    // 学習条件のチェック
    if (data.occurrences >= this.config.minOccurrencesForLearning) {
      await this.analyzePatternForLearning(patternKey);
    }
  }
  
  /**
   * 修復結果の記録
   */
  async recordRepairResult(errorHashOrInfo, patternIdOrSuccess, successOrDetails = {}) {
    // 引数の形式を判定
    let errorInfo, success, repairDetails;
    
    if (typeof errorHashOrInfo === 'string') {
      // 新しい形式: (errorHash, patternId, success)
      errorInfo = {
        hash: errorHashOrInfo,
        message: '',  // パターンキー生成には使用しない
        analysis: {
          patternId: patternIdOrSuccess
        }
      };
      success = successOrDetails;
      repairDetails = {};
    } else {
      // 従来の形式: (errorInfo, success, repairDetails)
      errorInfo = errorHashOrInfo;
      success = patternIdOrSuccess;
      repairDetails = successOrDetails;
    }
    
    const patternKey = errorInfo.hash || this.generatePatternKey(errorInfo);
    
    if (!this.learningData[patternKey]) {
      return;
    }
    
    const data = this.learningData[patternKey];
    data.repairs.attempted++;
    
    if (success) {
      data.repairs.successful++;
      
      // 修復方法の記録
      if (!data.successfulRepairs) {
        data.successfulRepairs = [];
      }
      
      data.successfulRepairs.push({
        timestamp: Date.now(),
        method: repairDetails.method || 'unknown',
        pattern: repairDetails.pattern || null,
        duration: repairDetails.duration || 0
      });
    } else {
      data.repairs.failed++;
    }
    
    // 成功率の計算
    const successRate = data.repairs.successful / data.repairs.attempted;
    data.successRate = successRate;
    
    await this.saveLearningData();
    
    // パターンの信頼度更新
    await this.updatePatternConfidence(patternKey, success);
  }
  
  /**
   * パターンの学習分析
   */
  async analyzePatternForLearning(patternKey) {
    const data = this.learningData[patternKey];
    
    // 十分な修復試行がない場合はスキップ
    if (data.repairs.attempted < 5) {
      return;
    }
    
    // 成功率チェック
    const successRate = data.repairs.successful / data.repairs.attempted;
    if (successRate < this.config.successRateThreshold) {
      this.logger.info(`パターン ${patternKey} の成功率が閾値未満: ${(successRate * 100).toFixed(1)}%`);
      return;
    }
    
    // 新パターンとして登録
    await this.registerNewPattern(patternKey, data);
  }
  
  /**
   * 新パターンの登録
   */
  async registerNewPattern(patternKey, learningData) {
    const patternId = `LP${Date.now().toString(36).toUpperCase()}`;
    
    const newPattern = {
      id: patternId,
      key: patternKey,
      name: `LEARNED_PATTERN_${patternId}`,
      description: `自動学習されたパターン（発生回数: ${learningData.occurrences}回）`,
      confidence: learningData.successRate,
      metadata: learningData.metadata,
      statistics: {
        occurrences: learningData.occurrences,
        repairAttempts: learningData.repairs.attempted,
        successRate: learningData.successRate,
        firstSeen: learningData.firstSeen,
        lastSeen: learningData.lastSeen
      },
      repairStrategy: this.inferRepairStrategy(learningData),
      active: true,
      createdAt: Date.now()
    };
    
    this.learnedPatterns[patternId] = newPattern;
    await this.saveLearnedPatterns();
    
    this.logger.info(`新しいエラーパターンを学習しました: ${patternId}`);
    this.logger.info(`成功率: ${(newPattern.confidence * 100).toFixed(1)}%`);
    
    return newPattern;
  }
  
  /**
   * 修復戦略の推論
   */
  inferRepairStrategy(learningData) {
    if (!learningData.successfulRepairs || learningData.successfulRepairs.length === 0) {
      return null;
    }
    
    // 最も成功した修復方法を特定
    const methodCounts = {};
    learningData.successfulRepairs.forEach(repair => {
      methodCounts[repair.method] = (methodCounts[repair.method] || 0) + 1;
    });
    
    const mostSuccessfulMethod = Object.entries(methodCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
    
    return {
      preferredMethod: mostSuccessfulMethod,
      averageDuration: learningData.successfulRepairs
        .reduce((sum, r) => sum + r.duration, 0) / learningData.successfulRepairs.length,
      samples: learningData.successfulRepairs.slice(-3)  // 最新3件のサンプル
    };
  }
  
  /**
   * パターンの信頼度更新
   */
  async updatePatternConfidence(patternKey, success) {
    // 学習済みパターンを検索
    const pattern = Object.values(this.learnedPatterns)
      .find(p => p.key === patternKey);
    
    if (!pattern) {
      return;
    }
    
    // 信頼度の更新
    if (success) {
      pattern.confidence = Math.min(1.0, pattern.confidence + this.config.confidenceGrowthRate);
    } else {
      pattern.confidence = Math.max(0.0, pattern.confidence - this.config.confidenceDecayRate);
    }
    
    // 信頼度が低すぎる場合は無効化
    if (pattern.confidence < 0.3) {
      pattern.active = false;
      this.logger.warn(`パターン ${pattern.id} を無効化しました（信頼度: ${(pattern.confidence * 100).toFixed(1)}%）`);
    }
    
    await this.saveLearnedPatterns();
  }
  
  /**
   * 学習済みパターンの取得
   */
  getLearnedPattern(errorInfo) {
    const patternKey = this.generatePatternKey(errorInfo);
    
    return Object.values(this.learnedPatterns)
      .find(p => p.key === patternKey && p.active);
  }
  
  /**
   * アクティブなパターンの取得
   */
  getActivePatterns() {
    return Object.values(this.learnedPatterns)
      .filter(p => p.active)
      .sort((a, b) => b.confidence - a.confidence);
  }
  
  /**
   * 統計情報の取得
   */
  getStatistics() {
    const stats = {
      totalErrors: Object.keys(this.learningData).length,
      learnedPatterns: Object.keys(this.learnedPatterns).length,
      activePatterns: this.getActivePatterns().length,
      averageSuccessRate: 0,
      topPatterns: []
    };
    
    // 平均成功率の計算
    const patternsWithRepairs = Object.values(this.learningData)
      .filter(d => d.repairs.attempted > 0);
    
    if (patternsWithRepairs.length > 0) {
      stats.averageSuccessRate = patternsWithRepairs
        .reduce((sum, d) => sum + (d.repairs.successful / d.repairs.attempted), 0) 
        / patternsWithRepairs.length;
    }
    
    // トップパターン
    stats.topPatterns = Object.values(this.learningData)
      .sort((a, b) => b.occurrences - a.occurrences)
      .slice(0, 5)
      .map(d => ({
        occurrences: d.occurrences,
        successRate: d.successRate || 0,
        category: d.metadata.category
      }));
    
    return stats;
  }
  
  /**
   * パターンが学習対象かどうかを判定
   */
  shouldLearnPattern(patternId) {
    // すべての学習データを確認
    for (const [key, data] of Object.entries(this.learningData)) {
      if (data.patternId === patternId || data.category === patternId) {
        const successRate = this.calculateSuccessRate(data);
        return data.occurrences >= this.config.minOccurrencesForLearning && 
               successRate >= this.config.successRateThreshold;
      }
    }
    return false;
  }
  
  /**
   * パターンの信頼度を取得
   */
  getPatternConfidence(patternId) {
    for (const [key, data] of Object.entries(this.learningData)) {
      if (data.patternId === patternId || data.category === patternId) {
        return data.confidence || 0;
      }
    }
    return 0;
  }
  
  /**
   * パターンキーの生成
   */
  generatePatternKey(errorInfo) {
    // エラーメッセージから変数部分を除去
    let normalizedMessage = errorInfo.message
      .replace(/\d+/g, 'N')  // 数値を置換
      .replace(/'[^']*'/g, "'X'")  // 文字列リテラルを置換
      .replace(/"[^"]*"/g, '"X"')  // 文字列リテラルを置換
      .replace(/\s+/g, ' ')  // 空白を正規化
      .trim();
    
    // カテゴリとメッセージのハッシュを生成
    const hash = crypto.createHash('md5')
      .update(`${errorInfo.analysis?.category || 'unknown'}:${normalizedMessage}`)
      .digest('hex')
      .substring(0, 8);
    
    return hash;
  }
  
  /**
   * 古いデータのクリーンアップ
   */
  cleanupOldData() {
    const now = Date.now();
    const maxAge = this.config.maxPatternAge;
    
    // 古い学習データを削除
    Object.keys(this.learningData).forEach(key => {
      if (now - this.learningData[key].lastSeen > maxAge) {
        delete this.learningData[key];
      }
    });
    
    // 非アクティブな学習済みパターンを削除
    Object.keys(this.learnedPatterns).forEach(id => {
      const pattern = this.learnedPatterns[id];
      if (!pattern.active && now - pattern.createdAt > maxAge) {
        delete this.learnedPatterns[id];
      }
    });
  }
  
  /**
   * 学習データの保存
   */
  async saveLearningData() {
    try {
      await this.ensureDirectoryExists(path.dirname(this.learningDataPath));
      await fs.writeFile(
        this.learningDataPath,
        JSON.stringify(this.learningData, null, 2),
        'utf8'
      );
    } catch (error) {
      this.logger.error('学習データ保存エラー:', error.message);
    }
  }
  
  /**
   * 学習済みパターンの保存
   */
  async saveLearnedPatterns() {
    try {
      await this.ensureDirectoryExists(path.dirname(this.patternRegistryPath));
      await fs.writeFile(
        this.patternRegistryPath,
        JSON.stringify(this.learnedPatterns, null, 2),
        'utf8'
      );
    } catch (error) {
      this.logger.error('学習済みパターン保存エラー:', error.message);
    }
  }
  
  /**
   * ファイル存在確認
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * ディレクトリ作成
   */
  async ensureDirectoryExists(dirPath) {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }
}

module.exports = LearningErrorRecognizer;