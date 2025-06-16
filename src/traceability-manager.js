const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

class TraceabilityManager {
  constructor(dataPath = '.poppo/traceability.yaml') {
    this.dataPath = dataPath;
    this.data = {
      items: {},
      metadata: {
        lastUpdated: new Date().toISOString(),
        version: '1.0'
      }
    };
    this.phases = ['REQ', 'SPEC', 'HLD', 'DLD', 'IMP', 'TEST'];
    this.linkTypes = ['implements', 'references', 'derives_from', 'conflicts_with', 'supersedes'];
  }

  async load() {
    try {
      const content = await fs.readFile(this.dataPath, 'utf8');
      this.data = yaml.load(content) || this.data;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      // ファイルが存在しない場合は初期データを使用
    }
  }

  async save() {
    this.data.metadata.lastUpdated = new Date().toISOString();
    const yamlStr = yaml.dump(this.data, { lineWidth: 120 });
    await fs.mkdir(path.dirname(this.dataPath), { recursive: true });
    await fs.writeFile(this.dataPath, yamlStr, 'utf8');
  }

  generateId(phase) {
    if (!this.phases.includes(phase)) {
      throw new Error(`Invalid phase: ${phase}. Must be one of: ${this.phases.join(', ')}`);
    }

    // 指定されたフェーズのIDを検索して最大番号を取得
    const prefix = `PBS-${phase}-`;
    const existingIds = Object.keys(this.data.items)
      .filter(id => id.startsWith(prefix))
      .map(id => parseInt(id.replace(prefix, ''), 10))
      .filter(num => !isNaN(num));

    const nextNumber = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;
    return `${prefix}${String(nextNumber).padStart(3, '0')}`;
  }

  addItem(phase, title, description = '', customId = null) {
    const id = customId || this.generateId(phase);
    
    if (this.data.items[id]) {
      throw new Error(`Item with ID ${id} already exists`);
    }

    this.data.items[id] = {
      id,
      phase,
      title,
      description,
      status: 'active',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      links: {}
    };

    // 各リンクタイプの初期化
    this.linkTypes.forEach(type => {
      this.data.items[id].links[type] = [];
    });

    return id;
  }

  addLink(fromId, toId, linkType = 'implements') {
    if (!this.data.items[fromId]) {
      throw new Error(`Source item ${fromId} not found`);
    }
    if (!this.data.items[toId]) {
      throw new Error(`Target item ${toId} not found`);
    }
    if (!this.linkTypes.includes(linkType)) {
      throw new Error(`Invalid link type: ${linkType}. Must be one of: ${this.linkTypes.join(', ')}`);
    }

    // 双方向リンクの追加
    if (!this.data.items[fromId].links[linkType].includes(toId)) {
      this.data.items[fromId].links[linkType].push(toId);
    }

    // 逆方向のリンクタイプを決定
    const reverseType = this.getReverseType(linkType);
    
    // 逆方向のリンクタイプが存在しない場合は追加
    if (!this.data.items[toId].links[reverseType]) {
      this.data.items[toId].links[reverseType] = [];
    }
    
    if (!this.data.items[toId].links[reverseType].includes(fromId)) {
      this.data.items[toId].links[reverseType].push(fromId);
    }

    // 更新日時を記録
    this.data.items[fromId].updated = new Date().toISOString();
    this.data.items[toId].updated = new Date().toISOString();
  }

  getReverseType(linkType) {
    const reverseMap = {
      'implements': 'implemented_by',
      'references': 'referenced_by',
      'derives_from': 'derived_by',
      'conflicts_with': 'conflicts_with',
      'supersedes': 'superseded_by'
    };
    return reverseMap[linkType] || linkType + '_by';
  }

  getItem(id) {
    return this.data.items[id] || null;
  }

  getAllItems() {
    return Object.values(this.data.items);
  }

  getItemsByPhase(phase) {
    return Object.values(this.data.items).filter(item => item.phase === phase);
  }

  generateMatrix() {
    const matrix = [];
    const processedIds = new Set();

    // 要求定義から開始して、リンクをたどる
    const reqItems = this.getItemsByPhase('REQ');
    
    reqItems.forEach(req => {
      const chain = this.traceChain(req.id);
      if (chain.length > 0) {
        matrix.push(chain);
      }
    });

    // 孤立したアイテムも追加
    Object.values(this.data.items).forEach(item => {
      if (!processedIds.has(item.id)) {
        matrix.push([item]);
      }
    });

    return matrix;
  }

  traceChain(startId, visited = new Set()) {
    if (visited.has(startId)) {
      return [];
    }
    
    visited.add(startId);
    const item = this.getItem(startId);
    if (!item) {
      return [];
    }

    const chain = [item];
    
    // implementsリンクを優先的にたどる
    const implementedBy = item.links.implemented_by || [];
    implementedBy.forEach(nextId => {
      const subChain = this.traceChain(nextId, visited);
      chain.push(...subChain);
    });

    return chain;
  }

  checkConsistency() {
    const issues = [];

    Object.values(this.data.items).forEach(item => {
      // 要求定義は必ず実装を持つべき
      if (item.phase === 'REQ' && (!item.links.implemented_by || item.links.implemented_by.length === 0)) {
        issues.push({
          type: 'warning',
          itemId: item.id,
          message: `要求定義 ${item.id} には実装がありません`
        });
      }

      // 実装は必ずテストを持つべき
      if (item.phase === 'IMP') {
        const hasTest = Object.values(this.data.items).some(
          other => other.phase === 'TEST' && other.links.implements?.includes(item.id)
        );
        if (!hasTest) {
          issues.push({
            type: 'warning',
            itemId: item.id,
            message: `実装 ${item.id} にはテストがありません`
          });
        }
      }

      // 孤立したアイテムの検出
      const hasIncomingLinks = Object.values(this.data.items).some(other => 
        other.id !== item.id && 
        Object.values(other.links).some(links => links.includes(item.id))
      );
      const hasOutgoingLinks = Object.values(item.links).some(links => links.length > 0);
      
      if (!hasIncomingLinks && !hasOutgoingLinks && item.phase !== 'REQ') {
        issues.push({
          type: 'error',
          itemId: item.id,
          message: `${item.phase} ${item.id} は孤立しています（リンクがありません）`
        });
      }
    });

    return issues;
  }

  async exportMatrix(filePath = 'traceability-matrix.md') {
    const matrix = this.generateMatrix();
    const issues = this.checkConsistency();
    
    let content = '# トレーサビリティマトリックス\n\n';
    content += `生成日時: ${new Date().toISOString()}\n\n`;
    
    content += '## トレーサビリティチェーン\n\n';
    matrix.forEach((chain, index) => {
      const chainStr = chain.map(item => `${item.id} (${item.phase})`).join(' → ');
      content += `${index + 1}. ${chainStr}\n`;
    });

    if (issues.length > 0) {
      content += '\n## 整合性チェック結果\n\n';
      const errors = issues.filter(i => i.type === 'error');
      const warnings = issues.filter(i => i.type === 'warning');
      
      if (errors.length > 0) {
        content += '### エラー\n\n';
        errors.forEach(issue => {
          content += `- ❌ ${issue.message}\n`;
        });
      }
      
      if (warnings.length > 0) {
        content += '\n### 警告\n\n';
        warnings.forEach(issue => {
          content += `- ⚠️ ${issue.message}\n`;
        });
      }
    }

    content += '\n## アイテム詳細\n\n';
    Object.values(this.data.items).forEach(item => {
      content += `### ${item.id}: ${item.title}\n`;
      content += `- フェーズ: ${item.phase}\n`;
      content += `- ステータス: ${item.status}\n`;
      if (item.description) {
        content += `- 説明: ${item.description}\n`;
      }
      
      // リンク情報
      Object.entries(item.links).forEach(([type, ids]) => {
        if (ids.length > 0) {
          content += `- ${type}: ${ids.join(', ')}\n`;
        }
      });
      content += '\n';
    });

    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  /**
   * アイテムを削除
   */
  async deleteItem(id) {
    if (!this.data.items[id]) {
      throw new Error(`Item ${id} not found`);
    }

    // 他のアイテムから参照を削除
    Object.values(this.data.items).forEach(item => {
      Object.keys(item.links).forEach(linkType => {
        item.links[linkType] = item.links[linkType].filter(linkedId => linkedId !== id);
      });
    });

    delete this.data.items[id];
    await this.save();
  }

  /**
   * アイテムを更新
   */
  async updateItem(id, updates) {
    if (!this.data.items[id]) {
      throw new Error(`Item ${id} not found`);
    }

    const item = this.data.items[id];
    
    if (updates.title !== undefined) {
      item.title = updates.title;
    }
    if (updates.description !== undefined) {
      item.description = updates.description;
    }
    if (updates.status !== undefined) {
      item.status = updates.status;
    }
    
    item.updated = new Date().toISOString();
    await this.save();
    
    return item;
  }
}

module.exports = TraceabilityManager;