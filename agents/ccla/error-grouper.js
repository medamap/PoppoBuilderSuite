const fs = require('fs').promises;
const path = require('path');

/**
 * エラーグループ化エンジン
 * 類似したエラーをグループ化して重複Issue作成を防止
 */
class ErrorGrouper {
  constructor(logger) {
    this.logger = logger;
    this.groupsFile = path.join(__dirname, '../../.poppo/error-groups.json');
    this.errorGroups = new Map();
    
    // 類似度計算の重み設定
    this.weights = {
      category: 0.3,      // カテゴリ一致: 30%
      message: 0.4,       // メッセージ類似度: 40%
      stackTrace: 0.3     // スタックトレース類似度: 30%
    };
    
    // グループ化の閾値
    this.similarityThreshold = 0.8;
  }

  /**
   * 初期化処理
   */
  async initialize() {
    try {
      const data = await fs.readFile(this.groupsFile, 'utf8');
      const groups = JSON.parse(data);
      this.errorGroups = new Map(Object.entries(groups));
      this.logger.info(`${this.errorGroups.size}個のエラーグループを読み込みました`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error(`エラーグループの読み込みエラー: ${error.message}`);
      }
    }
  }

  /**
   * エラーをグループ化
   * @param {Object} errorInfo エラー情報
   * @returns {Object} グループ情報
   */
  async groupError(errorInfo) {
    // 既存グループとの類似度計算
    let bestMatch = null;
    let bestSimilarity = 0;

    for (const [groupId, group] of this.errorGroups) {
      const similarity = this.calculateSimilarity(errorInfo, group.representative);
      
      if (similarity > bestSimilarity && similarity >= this.similarityThreshold) {
        bestSimilarity = similarity;
        bestMatch = groupId;
      }
    }

    if (bestMatch) {
      // 既存グループに追加
      const group = this.errorGroups.get(bestMatch);
      group.errors.push({
        hash: errorInfo.hash,
        timestamp: errorInfo.timestamp,
        similarity: bestSimilarity
      });
      group.lastOccurrence = errorInfo.timestamp;
      group.occurrenceCount++;
      
      this.logger.info(`エラーを既存グループ ${bestMatch} に追加 (類似度: ${(bestSimilarity * 100).toFixed(1)}%)`);
      
      await this.saveGroups();
      return {
        groupId: bestMatch,
        isNew: false,
        similarity: bestSimilarity,
        group
      };
    } else {
      // 新規グループ作成
      const groupId = this.generateGroupId();
      const newGroup = {
        id: groupId,
        representative: {
          category: errorInfo.category,
          message: errorInfo.message,
          stackTrace: errorInfo.stackTrace,
          file: errorInfo.file,
          line: errorInfo.line
        },
        errors: [{
          hash: errorInfo.hash,
          timestamp: errorInfo.timestamp,
          similarity: 1.0
        }],
        createdAt: errorInfo.timestamp,
        lastOccurrence: errorInfo.timestamp,
        occurrenceCount: 1,
        issueUrl: null,
        status: 'open'
      };
      
      this.errorGroups.set(groupId, newGroup);
      
      this.logger.info(`新規エラーグループ ${groupId} を作成`);
      
      await this.saveGroups();
      return {
        groupId,
        isNew: true,
        similarity: 1.0,
        group: newGroup
      };
    }
  }

  /**
   * エラーの類似度を計算
   * @param {Object} error1 エラー1
   * @param {Object} error2 エラー2
   * @returns {number} 類似度 (0.0 - 1.0)
   */
  calculateSimilarity(error1, error2) {
    // カテゴリの一致度
    const categorySimilarity = error1.category === error2.category ? 1.0 : 0.0;
    
    // メッセージの類似度
    const messageSimilarity = this.calculateTextSimilarity(
      error1.message || '',
      error2.message || ''
    );
    
    // スタックトレースの類似度
    const stackSimilarity = this.calculateStackTraceSimilarity(
      error1.stackTrace || '',
      error2.stackTrace || ''
    );
    
    // 重み付き平均
    const totalSimilarity = 
      this.weights.category * categorySimilarity +
      this.weights.message * messageSimilarity +
      this.weights.stackTrace * stackSimilarity;
    
    return totalSimilarity;
  }

  /**
   * テキストの類似度計算（レーベンシュタイン距離ベース）
   */
  calculateTextSimilarity(text1, text2) {
    if (!text1 || !text2) return 0;
    if (text1 === text2) return 1;
    
    // 正規化
    const normalized1 = this.normalizeText(text1);
    const normalized2 = this.normalizeText(text2);
    
    // レーベンシュタイン距離
    const distance = this.levenshteinDistance(normalized1, normalized2);
    const maxLength = Math.max(normalized1.length, normalized2.length);
    
    if (maxLength === 0) return 1;
    
    return 1 - (distance / maxLength);
  }

  /**
   * スタックトレースの類似度計算
   */
  calculateStackTraceSimilarity(stack1, stack2) {
    if (!stack1 || !stack2) return 0;
    
    // スタックトレースから重要な行を抽出
    const lines1 = this.extractImportantStackLines(stack1);
    const lines2 = this.extractImportantStackLines(stack2);
    
    if (lines1.length === 0 || lines2.length === 0) return 0;
    
    // 共通する行の割合を計算
    let matchCount = 0;
    for (const line1 of lines1) {
      if (lines2.some(line2 => this.areStackLinesSimiler(line1, line2))) {
        matchCount++;
      }
    }
    
    return matchCount / Math.max(lines1.length, lines2.length);
  }

  /**
   * テキストの正規化
   */
  normalizeText(text) {
    return text
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .replace(/[0-9]+/g, 'NUM')  // 数値を統一
      .replace(/0x[0-9a-f]+/gi, 'HEX')  // 16進数を統一
      .trim();
  }

  /**
   * スタックトレースから重要な行を抽出
   */
  extractImportantStackLines(stackTrace) {
    const lines = Array.isArray(stackTrace) ? stackTrace : stackTrace.split('\n');
    const importantLines = [];
    
    for (const line of lines) {
      // node_modulesを除外
      if (line.includes('node_modules')) continue;
      
      // ファイル名と関数名を抽出
      const match = line.match(/at\s+([^\s]+)\s+\(([^:)]+):(\d+):(\d+)\)/);
      if (match) {
        importantLines.push({
          function: match[1],
          file: match[2],
          line: match[3]
        });
      }
    }
    
    // 最初の3行のみを考慮
    return importantLines.slice(0, 3);
  }

  /**
   * スタックトレースの行が類似しているか判定
   */
  areStackLinesSimiler(line1, line2) {
    // ファイルと関数名が一致
    return line1.file === line2.file && line1.function === line2.function;
  }

  /**
   * レーベンシュタイン距離の計算
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];
    
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,  // 置換
            matrix[i][j - 1] + 1,       // 挿入
            matrix[i - 1][j] + 1        // 削除
          );
        }
      }
    }
    
    return matrix[str2.length][str1.length];
  }

  /**
   * グループIDの生成
   */
  generateGroupId() {
    return `EG-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * グループ情報の保存
   */
  async saveGroups() {
    try {
      const groupsData = Object.fromEntries(this.errorGroups);
      await fs.writeFile(this.groupsFile, JSON.stringify(groupsData, null, 2));
    } catch (error) {
      this.logger.error(`エラーグループ保存エラー: ${error.message}`);
    }
  }

  /**
   * グループのステータス更新
   */
  async updateGroupStatus(groupId, status, issueUrl = null) {
    const group = this.errorGroups.get(groupId);
    if (group) {
      group.status = status;
      if (issueUrl) {
        group.issueUrl = issueUrl;
      }
      await this.saveGroups();
    }
  }

  /**
   * グループの統計情報を取得
   */
  getGroupStatistics() {
    const stats = {
      totalGroups: this.errorGroups.size,
      openGroups: 0,
      closedGroups: 0,
      totalErrors: 0,
      averageOccurrences: 0
    };
    
    let totalOccurrences = 0;
    
    for (const group of this.errorGroups.values()) {
      stats.totalErrors += group.errors.length;
      totalOccurrences += group.occurrenceCount;
      
      if (group.status === 'open') {
        stats.openGroups++;
      } else {
        stats.closedGroups++;
      }
    }
    
    if (stats.totalGroups > 0) {
      stats.averageOccurrences = totalOccurrences / stats.totalGroups;
    }
    
    return stats;
  }

  /**
   * 類似度閾値の更新
   */
  updateSimilarityThreshold(threshold) {
    if (threshold >= 0.5 && threshold <= 1.0) {
      this.similarityThreshold = threshold;
      this.logger.info(`類似度閾値を ${threshold} に更新`);
    }
  }

  /**
   * グループの手動分離
   */
  async separateErrorFromGroup(errorHash, groupId) {
    const group = this.errorGroups.get(groupId);
    if (!group) return null;
    
    // エラーを検索
    const errorIndex = group.errors.findIndex(e => e.hash === errorHash);
    if (errorIndex === -1) return null;
    
    // エラーを削除
    const [removedError] = group.errors.splice(errorIndex, 1);
    group.occurrenceCount--;
    
    // グループが空になった場合は削除
    if (group.errors.length === 0) {
      this.errorGroups.delete(groupId);
    }
    
    await this.saveGroups();
    
    return removedError;
  }
}

module.exports = ErrorGrouper;