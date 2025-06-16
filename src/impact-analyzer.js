const TraceabilityManager = require('./traceability-manager');

class ImpactAnalyzer {
  constructor(traceabilityManager) {
    this.tm = traceabilityManager;
    this.impactLevels = {
      HIGH: 'High',
      MEDIUM: 'Medium',
      LOW: 'Low'
    };
  }

  /**
   * 指定されたアイテムの変更による影響範囲を分析
   * @param {string} itemId - 変更されるアイテムのID
   * @param {string} changeType - 変更の種類 ('modify', 'delete', 'add')
   * @returns {Object} 影響分析結果
   */
  analyzeImpact(itemId, changeType = 'modify') {
    const item = this.tm.getItem(itemId);
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    const impact = {
      sourceItem: item,
      changeType,
      timestamp: new Date().toISOString(),
      affectedItems: [],
      summary: {
        total: 0,
        byPhase: {},
        byLevel: {
          [this.impactLevels.HIGH]: 0,
          [this.impactLevels.MEDIUM]: 0,
          [this.impactLevels.LOW]: 0
        }
      },
      recommendations: []
    };

    // 影響を受けるアイテムを収集
    const visited = new Set();
    this.collectImpactedItems(itemId, impact.affectedItems, visited, 0, changeType);

    // サマリー情報を計算
    this.calculateSummary(impact);

    // 推奨アクションを生成
    this.generateRecommendations(impact);

    return impact;
  }

  /**
   * 再帰的に影響を受けるアイテムを収集
   */
  collectImpactedItems(itemId, affectedItems, visited, depth, changeType) {
    if (visited.has(itemId)) {
      return;
    }
    visited.add(itemId);

    const item = this.tm.getItem(itemId);
    if (!item) {
      return;
    }

    // 直接的な影響を受けるアイテムを収集
    const directlyAffected = this.getDirectlyAffectedItems(item);
    
    directlyAffected.forEach(affectedId => {
      const affectedItem = this.tm.getItem(affectedId);
      if (affectedItem && !visited.has(affectedId)) {
        const impactLevel = this.calculateImpactLevel(item, affectedItem, depth, changeType);
        
        affectedItems.push({
          item: affectedItem,
          impactLevel,
          distance: depth + 1,
          reason: this.getImpactReason(item, affectedItem, changeType),
          updateRequired: this.isUpdateRequired(item, affectedItem, changeType)
        });

        // 再帰的に影響の波及を追跡
        this.collectImpactedItems(affectedId, affectedItems, visited, depth + 1, changeType);
      }
    });
  }

  /**
   * 直接影響を受けるアイテムのIDリストを取得
   */
  getDirectlyAffectedItems(item) {
    const affected = new Set();

    // すべてのリンクタイプをチェック
    Object.entries(item.links).forEach(([linkType, linkedIds]) => {
      linkedIds.forEach(id => affected.add(id));
    });

    // 逆方向のリンクもチェック
    Object.values(this.tm.data.items).forEach(otherItem => {
      Object.entries(otherItem.links).forEach(([linkType, linkedIds]) => {
        if (linkedIds.includes(item.id)) {
          affected.add(otherItem.id);
        }
      });
    });

    return Array.from(affected);
  }

  /**
   * 影響レベルを計算
   */
  calculateImpactLevel(sourceItem, affectedItem, distance, changeType) {
    // 削除の場合は常に高影響
    if (changeType === 'delete') {
      return this.impactLevels.HIGH;
    }

    // フェーズ間の関係による影響度
    const phaseImpact = this.getPhaseImpact(sourceItem.phase, affectedItem.phase);
    
    // 距離による影響度の減衰
    const distanceImpact = distance === 0 ? 3 : distance === 1 ? 2 : 1;
    
    // リンクタイプによる影響度
    const linkImpact = this.getLinkImpact(sourceItem, affectedItem);
    
    // 総合スコアを計算
    const totalScore = phaseImpact + distanceImpact + linkImpact;
    
    if (totalScore >= 7) {
      return this.impactLevels.HIGH;
    } else if (totalScore >= 4) {
      return this.impactLevels.MEDIUM;
    } else {
      return this.impactLevels.LOW;
    }
  }

  /**
   * フェーズ間の関係による影響度を取得
   */
  getPhaseImpact(sourcePhase, affectedPhase) {
    const phaseOrder = ['REQ', 'SPEC', 'HLD', 'DLD', 'IMP', 'TEST'];
    const sourceIndex = phaseOrder.indexOf(sourcePhase);
    const affectedIndex = phaseOrder.indexOf(affectedPhase);
    
    // 上流の変更が下流に与える影響は大きい
    if (sourceIndex < affectedIndex) {
      return 3;
    }
    // 下流の変更が上流に与える影響は中程度
    else if (sourceIndex > affectedIndex) {
      return 2;
    }
    // 同じフェーズ内の影響は小さい
    else {
      return 1;
    }
  }

  /**
   * リンクタイプによる影響度を取得
   */
  getLinkImpact(sourceItem, affectedItem) {
    // implementsリンクは最も強い影響
    if (sourceItem.links.implements?.includes(affectedItem.id) ||
        sourceItem.links.implemented_by?.includes(affectedItem.id)) {
      return 3;
    }
    // conflicts_withリンクも強い影響
    else if (sourceItem.links.conflicts_with?.includes(affectedItem.id)) {
      return 3;
    }
    // supersedesリンクは中程度の影響
    else if (sourceItem.links.supersedes?.includes(affectedItem.id) ||
             sourceItem.links.superseded_by?.includes(affectedItem.id)) {
      return 2;
    }
    // その他のリンクは弱い影響
    else {
      return 1;
    }
  }

  /**
   * 影響の理由を説明
   */
  getImpactReason(sourceItem, affectedItem, changeType) {
    const reasons = [];
    
    if (changeType === 'delete') {
      reasons.push(`${sourceItem.id}が削除されるため`);
    } else {
      reasons.push(`${sourceItem.id}が${changeType === 'add' ? '追加' : '変更'}されるため`);
    }

    // リンク関係を説明
    Object.entries(sourceItem.links).forEach(([linkType, linkedIds]) => {
      if (linkedIds.includes(affectedItem.id)) {
        reasons.push(`${sourceItem.id}が${affectedItem.id}を${linkType}している`);
      }
    });

    Object.entries(affectedItem.links).forEach(([linkType, linkedIds]) => {
      if (linkedIds.includes(sourceItem.id)) {
        reasons.push(`${affectedItem.id}が${sourceItem.id}を${linkType}している`);
      }
    });

    return reasons.join('、');
  }

  /**
   * 更新が必要かどうかを判定
   */
  isUpdateRequired(sourceItem, affectedItem, changeType) {
    // 削除の場合は必ず更新が必要
    if (changeType === 'delete') {
      return true;
    }

    // implementsリンクがある場合は更新が必要
    if (sourceItem.links.implements?.includes(affectedItem.id) ||
        affectedItem.links.implements?.includes(sourceItem.id)) {
      return true;
    }

    // conflicts_withリンクがある場合も更新が必要
    if (sourceItem.links.conflicts_with?.includes(affectedItem.id)) {
      return true;
    }

    return false;
  }

  /**
   * サマリー情報を計算
   */
  calculateSummary(impact) {
    impact.summary.total = impact.affectedItems.length;
    
    // フェーズ別集計
    impact.affectedItems.forEach(affected => {
      const phase = affected.item.phase;
      impact.summary.byPhase[phase] = (impact.summary.byPhase[phase] || 0) + 1;
      impact.summary.byLevel[affected.impactLevel]++;
    });
  }

  /**
   * 推奨アクションを生成
   */
  generateRecommendations(impact) {
    const { sourceItem, changeType, affectedItems } = impact;
    
    // 高影響度のアイテムがある場合
    const highImpactItems = affectedItems.filter(a => a.impactLevel === this.impactLevels.HIGH);
    if (highImpactItems.length > 0) {
      impact.recommendations.push({
        priority: 'HIGH',
        action: '以下の高影響度アイテムを必ず確認・更新してください',
        items: highImpactItems.map(a => `${a.item.id}: ${a.item.title}`)
      });
    }

    // テストへの影響がある場合
    const affectedTests = affectedItems.filter(a => a.item.phase === 'TEST');
    if (affectedTests.length > 0) {
      impact.recommendations.push({
        priority: 'HIGH',
        action: '影響を受けるテストを再実行してください',
        items: affectedTests.map(a => `${a.item.id}: ${a.item.title}`)
      });
    }

    // ドキュメントへの影響がある場合
    const affectedDocs = affectedItems.filter(a => 
      a.item.phase === 'SPEC' || a.item.phase === 'HLD' || a.item.phase === 'DLD'
    );
    if (affectedDocs.length > 0) {
      impact.recommendations.push({
        priority: 'MEDIUM',
        action: '関連ドキュメントの更新を検討してください',
        items: affectedDocs.map(a => `${a.item.id}: ${a.item.title}`)
      });
    }

    // 削除の場合の特別な推奨事項
    if (changeType === 'delete') {
      impact.recommendations.push({
        priority: 'HIGH',
        action: '削除前に以下を確認してください',
        items: [
          'すべての依存関係が解決されているか',
          '代替の実装が存在するか',
          '削除による機能への影響がないか'
        ]
      });
    }
  }

  /**
   * 変更履歴を記録
   */
  async recordChange(itemId, changeType, description = '') {
    const item = this.tm.getItem(itemId);
    if (!item) {
      throw new Error(`Item ${itemId} not found`);
    }

    if (!item.changeHistory) {
      item.changeHistory = [];
    }

    item.changeHistory.push({
      timestamp: new Date().toISOString(),
      changeType,
      description,
      impactAnalysis: this.analyzeImpact(itemId, changeType)
    });

    item.updated = new Date().toISOString();
    await this.tm.save();
  }

  /**
   * 影響分析レポートを生成
   */
  generateImpactReport(impact) {
    let report = `# 影響分析レポート\n\n`;
    report += `生成日時: ${impact.timestamp}\n\n`;
    
    report += `## 変更対象\n`;
    report += `- ID: ${impact.sourceItem.id}\n`;
    report += `- タイトル: ${impact.sourceItem.title}\n`;
    report += `- フェーズ: ${impact.sourceItem.phase}\n`;
    report += `- 変更種別: ${impact.changeType}\n\n`;
    
    report += `## 影響サマリー\n`;
    report += `- 影響を受けるアイテム総数: ${impact.summary.total}\n`;
    report += `- 影響度別:\n`;
    Object.entries(impact.summary.byLevel).forEach(([level, count]) => {
      report += `  - ${level}: ${count}件\n`;
    });
    report += `- フェーズ別:\n`;
    Object.entries(impact.summary.byPhase).forEach(([phase, count]) => {
      report += `  - ${phase}: ${count}件\n`;
    });
    report += '\n';
    
    report += `## 影響を受けるアイテム詳細\n\n`;
    
    // 影響度別にグループ化
    const groupedByLevel = {
      [this.impactLevels.HIGH]: [],
      [this.impactLevels.MEDIUM]: [],
      [this.impactLevels.LOW]: []
    };
    
    impact.affectedItems.forEach(affected => {
      groupedByLevel[affected.impactLevel].push(affected);
    });
    
    Object.entries(groupedByLevel).forEach(([level, items]) => {
      if (items.length > 0) {
        report += `### ${level}影響度\n\n`;
        items.forEach(affected => {
          report += `#### ${affected.item.id}: ${affected.item.title}\n`;
          report += `- フェーズ: ${affected.item.phase}\n`;
          report += `- 影響理由: ${affected.reason}\n`;
          report += `- 更新必要: ${affected.updateRequired ? 'はい' : 'いいえ'}\n`;
          report += `- 距離: ${affected.distance}ステップ\n\n`;
        });
      }
    });
    
    report += `## 推奨アクション\n\n`;
    impact.recommendations.forEach((rec, index) => {
      report += `### ${index + 1}. [${rec.priority}] ${rec.action}\n`;
      rec.items.forEach(item => {
        report += `- ${item}\n`;
      });
      report += '\n';
    });
    
    return report;
  }
}

module.exports = ImpactAnalyzer;