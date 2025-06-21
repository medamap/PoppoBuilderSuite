const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const { createLogger } = require('./logger');

/**
 * プロジェクト設定マネージャー
 * プロジェクト固有の設定管理、テンプレート、継承を実装
 */
class ProjectConfigManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = createLogger('ProjectConfigManager');
    
    // 設定
    this.config = {
      dataDir: config.dataDir || path.join(process.env.HOME, '.poppo-builder'),
      projectConfigFile: 'project-configs.json',
      templateDir: config.templateDir || path.join(__dirname, '../config/templates'),
      enableInheritance: config.enableInheritance !== false,
      enableTemplates: config.enableTemplates !== false,
      ...config
    };
    
    // ファイルパス
    this.projectConfigPath = path.join(this.config.dataDir, this.config.projectConfigFile);
    
    // プロジェクト設定
    this.projectConfigs = new Map();
    this.templates = new Map();
    this.inheritanceTree = new Map();
    
    // デフォルト設定
    this.defaultConfig = {
      // 基本設定
      language: {
        primary: 'ja',
        fallback: 'en'
      },
      
      // Claude設定
      claude: {
        timeout: 600000,
        maxRetries: 3,
        maxConcurrent: 2,
        model: 'claude-2'
      },
      
      // GitHub設定
      github: {
        pollingInterval: 30000,
        maxIssuesPerRun: 10,
        labels: {
          processing: 'processing',
          completed: 'completed',
          failed: 'failed'
        }
      },
      
      // エージェント設定
      agents: {
        enabled: true,
        ccla: { enabled: true, interval: 300000 },
        ccag: { enabled: true },
        ccpm: { enabled: true },
        ccqa: { enabled: true }
      },
      
      // リソース設定
      resources: {
        cpu: '1000m',
        memory: '1Gi',
        maxConcurrent: 3,
        elastic: true
      },
      
      // 実行設定
      execution: {
        workingDirectory: null,
        environment: {},
        taskTimeout: 1800000, // 30分
        retryDelay: 60000
      },
      
      // 通知設定
      notification: {
        enabled: false,
        channels: ['log'],
        events: ['task-failed', 'task-completed']
      },
      
      // カスタム設定
      custom: {}
    };
  }

  /**
   * 初期化
   */
  async initialize() {
    try {
      // データディレクトリの作成
      await fs.mkdir(this.config.dataDir, { recursive: true });
      
      // テンプレートディレクトリの作成
      if (this.config.enableTemplates) {
        await fs.mkdir(this.config.templateDir, { recursive: true });
      }
      
      // 既存の設定を読み込み
      await this.loadProjectConfigs();
      
      // テンプレートを読み込み
      if (this.config.enableTemplates) {
        await this.loadTemplates();
      }
      
      this.logger.info('プロジェクト設定マネージャーを初期化しました', {
        projects: this.projectConfigs.size,
        templates: this.templates.size
      });
      
      return true;
    } catch (error) {
      this.logger.error('初期化エラー:', error);
      throw error;
    }
  }

  /**
   * プロジェクト設定を登録
   */
  async registerProjectConfig(projectId, config = {}) {
    // ベース設定の決定
    let baseConfig = { ...this.defaultConfig };
    
    // 継承元がある場合
    if (config.extends) {
      const parentConfig = await this.resolveExtends(config.extends);
      baseConfig = this.mergeConfigs(baseConfig, parentConfig);
    }
    
    // テンプレートを適用
    if (config.template) {
      const templateConfig = await this.applyTemplate(config.template);
      baseConfig = this.mergeConfigs(baseConfig, templateConfig);
    }
    
    // プロジェクト固有の設定をマージ
    const finalConfig = this.mergeConfigs(baseConfig, config);
    
    // 継承情報を保存
    if (config.extends) {
      this.inheritanceTree.set(projectId, config.extends);
    }
    
    // メタデータを追加
    finalConfig._metadata = {
      projectId,
      registeredAt: new Date().toISOString(),
      lastModified: new Date().toISOString(),
      template: config.template || null,
      extends: config.extends || null
    };
    
    // 設定を保存
    this.projectConfigs.set(projectId, finalConfig);
    await this.saveProjectConfigs();
    
    this.logger.info('プロジェクト設定を登録しました', {
      projectId,
      template: config.template,
      extends: config.extends
    });
    
    this.emit('configRegistered', { projectId, config: finalConfig });
    
    return finalConfig;
  }

  /**
   * プロジェクト設定を取得
   */
  getProjectConfig(projectId) {
    const config = this.projectConfigs.get(projectId);
    if (!config) {
      this.logger.warn('プロジェクト設定が見つかりません', { projectId });
      return { ...this.defaultConfig };
    }
    return config;
  }

  /**
   * プロジェクト設定を更新
   */
  async updateProjectConfig(projectId, updates) {
    const currentConfig = this.getProjectConfig(projectId);
    
    // 設定をマージ
    const updatedConfig = this.mergeConfigs(currentConfig, updates);
    
    // メタデータを更新
    if (updatedConfig._metadata) {
      updatedConfig._metadata.lastModified = new Date().toISOString();
    }
    
    // 設定を保存
    this.projectConfigs.set(projectId, updatedConfig);
    await this.saveProjectConfigs();
    
    this.logger.info('プロジェクト設定を更新しました', { projectId });
    this.emit('configUpdated', { projectId, config: updatedConfig });
    
    return updatedConfig;
  }

  /**
   * プロジェクト設定を削除
   */
  async deleteProjectConfig(projectId) {
    if (!this.projectConfigs.has(projectId)) {
      throw new Error(`プロジェクト設定が見つかりません: ${projectId}`);
    }
    
    // 継承関係をチェック
    const dependents = this.findDependentProjects(projectId);
    if (dependents.length > 0) {
      throw new Error(
        `このプロジェクトは他のプロジェクトから継承されています: ${dependents.join(', ')}`
      );
    }
    
    this.projectConfigs.delete(projectId);
    this.inheritanceTree.delete(projectId);
    await this.saveProjectConfigs();
    
    this.logger.info('プロジェクト設定を削除しました', { projectId });
    this.emit('configDeleted', { projectId });
  }

  /**
   * テンプレートを登録
   */
  async registerTemplate(templateName, config) {
    if (!this.config.enableTemplates) {
      throw new Error('テンプレート機能が無効になっています');
    }
    
    // テンプレートの検証
    this.validateTemplate(config);
    
    // メタデータを追加
    config._metadata = {
      name: templateName,
      createdAt: new Date().toISOString(),
      description: config.description || ''
    };
    
    this.templates.set(templateName, config);
    
    // ファイルに保存
    const templatePath = path.join(this.config.templateDir, `${templateName}.json`);
    await fs.writeFile(templatePath, JSON.stringify(config, null, 2));
    
    this.logger.info('テンプレートを登録しました', { templateName });
    this.emit('templateRegistered', { templateName, config });
    
    return config;
  }

  /**
   * 継承元を解決
   */
  async resolveExtends(extends_) {
    if (!this.config.enableInheritance) {
      return {};
    }
    
    // 配列の場合は順番にマージ
    if (Array.isArray(extends_)) {
      let result = {};
      for (const parent of extends_) {
        const parentConfig = await this.resolveExtends(parent);
        result = this.mergeConfigs(result, parentConfig);
      }
      return result;
    }
    
    // プロジェクトIDの場合
    if (this.projectConfigs.has(extends_)) {
      const parentConfig = this.projectConfigs.get(extends_);
      // 再帰的に継承を解決
      if (parentConfig.extends) {
        const grandParentConfig = await this.resolveExtends(parentConfig.extends);
        return this.mergeConfigs(grandParentConfig, parentConfig);
      }
      return parentConfig;
    }
    
    // テンプレート名の場合
    if (extends_.startsWith('template:')) {
      const templateName = extends_.substring(9);
      return this.templates.get(templateName) || {};
    }
    
    this.logger.warn('継承元が見つかりません', { extends: extends_ });
    return {};
  }

  /**
   * テンプレートを適用
   */
  async applyTemplate(templateName) {
    if (!this.config.enableTemplates) {
      return {};
    }
    
    const template = this.templates.get(templateName);
    if (!template) {
      this.logger.warn('テンプレートが見つかりません', { templateName });
      return {};
    }
    
    // テンプレートのコピーを返す（メタデータを除く）
    const { _metadata, ...templateConfig } = template;
    return JSON.parse(JSON.stringify(templateConfig));
  }

  /**
   * 依存しているプロジェクトを検索
   */
  findDependentProjects(projectId) {
    const dependents = [];
    
    for (const [childId, parentId] of this.inheritanceTree) {
      if (parentId === projectId || 
          (Array.isArray(parentId) && parentId.includes(projectId))) {
        dependents.push(childId);
      }
    }
    
    return dependents;
  }

  /**
   * 設定をマージ
   */
  mergeConfigs(base, override) {
    const result = JSON.parse(JSON.stringify(base));
    
    const merge = (target, source) => {
      for (const key in source) {
        if (source[key] === null || source[key] === undefined) {
          continue;
        }
        
        if (typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) target[key] = {};
          merge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };
    
    merge(result, override);
    return result;
  }

  /**
   * プロジェクト設定を読み込み
   */
  async loadProjectConfigs() {
    try {
      const data = await fs.readFile(this.projectConfigPath, 'utf-8');
      const configs = JSON.parse(data);
      
      // Mapに変換
      for (const [projectId, config] of Object.entries(configs)) {
        this.projectConfigs.set(projectId, config);
        
        // 継承関係を復元
        if (config.extends || config._metadata?.extends) {
          this.inheritanceTree.set(projectId, config.extends || config._metadata.extends);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('プロジェクト設定の読み込みエラー:', error);
      }
    }
  }

  /**
   * プロジェクト設定を保存
   */
  async saveProjectConfigs() {
    const configs = {};
    
    for (const [projectId, config] of this.projectConfigs) {
      configs[projectId] = config;
    }
    
    await fs.writeFile(this.projectConfigPath, JSON.stringify(configs, null, 2));
  }

  /**
   * テンプレートを読み込み
   */
  async loadTemplates() {
    try {
      const files = await fs.readdir(this.config.templateDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const templateName = file.replace('.json', '');
          const templatePath = path.join(this.config.templateDir, file);
          
          try {
            const data = await fs.readFile(templatePath, 'utf-8');
            const template = JSON.parse(data);
            this.templates.set(templateName, template);
          } catch (error) {
            this.logger.error(`テンプレート読み込みエラー: ${file}`, error);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('テンプレートディレクトリ読み込みエラー:', error);
      }
    }
  }

  /**
   * テンプレートを検証
   */
  validateTemplate(template) {
    if (!template || typeof template !== 'object') {
      throw new Error('テンプレートはオブジェクトである必要があります');
    }
    
    // 必須フィールドのチェック
    // 現在は特に必須フィールドはない
    
    return true;
  }

  /**
   * 設定の継承ツリーを取得
   */
  getInheritanceTree() {
    const tree = {};
    
    for (const [projectId, config] of this.projectConfigs) {
      const extends_ = config.extends || config._metadata?.extends;
      tree[projectId] = {
        extends: extends_,
        template: config.template || config._metadata?.template,
        children: this.findDependentProjects(projectId)
      };
    }
    
    return tree;
  }

  /**
   * 特定の設定項目を取得
   */
  getConfigValue(projectId, path) {
    const config = this.getProjectConfig(projectId);
    
    const keys = path.split('.');
    let value = config;
    
    for (const key of keys) {
      if (value && typeof value === 'object') {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * 特定の設定項目を更新
   */
  async setConfigValue(projectId, path, value) {
    const config = this.getProjectConfig(projectId);
    
    const keys = path.split('.');
    let target = config;
    
    // 最後のキーまでナビゲート
    for (let i = 0; i < keys.length - 1; i++) {
      if (!target[keys[i]]) {
        target[keys[i]] = {};
      }
      target = target[keys[i]];
    }
    
    // 値を設定
    target[keys[keys.length - 1]] = value;
    
    // 設定を保存
    await this.updateProjectConfig(projectId, config);
  }

  /**
   * プロジェクト設定をエクスポート
   */
  async exportProjectConfig(projectId, format = 'json') {
    const config = this.getProjectConfig(projectId);
    
    switch (format) {
      case 'json':
        return JSON.stringify(config, null, 2);
      
      case 'yaml':
        // YAML形式への変換（要: js-yaml等のライブラリ）
        throw new Error('YAML形式はまだサポートされていません');
      
      default:
        throw new Error(`未サポートの形式: ${format}`);
    }
  }

  /**
   * プロジェクト設定をインポート
   */
  async importProjectConfig(projectId, data, format = 'json') {
    let config;
    
    switch (format) {
      case 'json':
        config = typeof data === 'string' ? JSON.parse(data) : data;
        break;
      
      case 'yaml':
        // YAML形式からの変換（要: js-yaml等のライブラリ）
        throw new Error('YAML形式はまだサポートされていません');
      
      default:
        throw new Error(`未サポートの形式: ${format}`);
    }
    
    return await this.registerProjectConfig(projectId, config);
  }

  /**
   * 設定の差分を取得
   */
  getConfigDiff(projectId, newConfig) {
    const currentConfig = this.getProjectConfig(projectId);
    
    const diff = {
      added: {},
      modified: {},
      removed: {}
    };
    
    const compareObjects = (current, new_, path = '') => {
      // 新しいキーと変更されたキー
      for (const key in new_) {
        const fullPath = path ? `${path}.${key}` : key;
        
        if (!(key in current)) {
          diff.added[fullPath] = new_[key];
        } else if (typeof new_[key] === 'object' && typeof current[key] === 'object') {
          compareObjects(current[key], new_[key], fullPath);
        } else if (new_[key] !== current[key]) {
          diff.modified[fullPath] = {
            old: current[key],
            new: new_[key]
          };
        }
      }
      
      // 削除されたキー
      for (const key in current) {
        if (!(key in new_)) {
          const fullPath = path ? `${path}.${key}` : key;
          diff.removed[fullPath] = current[key];
        }
      }
    };
    
    compareObjects(currentConfig, newConfig);
    
    return diff;
  }

  /**
   * 全プロジェクトの設定サマリーを取得
   */
  getConfigSummary() {
    const summary = {
      totalProjects: this.projectConfigs.size,
      templates: Array.from(this.templates.keys()),
      inheritanceRelations: this.inheritanceTree.size,
      projects: {}
    };
    
    for (const [projectId, config] of this.projectConfigs) {
      summary.projects[projectId] = {
        template: config._metadata?.template,
        extends: config._metadata?.extends,
        language: config.language?.primary,
        agents: Object.keys(config.agents || {}).filter(a => config.agents[a]?.enabled),
        resources: {
          cpu: config.resources?.cpu,
          memory: config.resources?.memory,
          maxConcurrent: config.resources?.maxConcurrent
        }
      };
    }
    
    return summary;
  }
}

module.exports = ProjectConfigManager;