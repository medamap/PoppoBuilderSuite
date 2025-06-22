/**
 * グローバル設定管理システム
 * ~/.poppobuilder/config.json の読み込みと管理
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class GlobalConfigManager {
  constructor() {
    this.config = null;
    this.configPath = null;
    this.defaults = {
      version: '1.0.0',
      storage: {
        baseDir: '~/.poppobuilder',
        logs: {
          enabled: true,
          retention: '30d',
          maxSize: '1GB',
          compress: true
        },
        temp: {
          baseDir: null, // null = OS default
          autoCleanup: true,
          cleanupInterval: '1h'
        },
        state: {
          persistent: true,
          backupEnabled: true
        }
      },
      projects: {},
      maintenance: {
        allowedProcesses: ['dashboard', 'monitor']
      },
      monitoring: {
        enabled: true,
        interval: '5m',
        alerts: {
          diskSpace: {
            threshold: '1GB',
            enabled: true
          }
        }
      }
    };
  }

  /**
   * 設定の初期化
   */
  async initialize() {
    // 設定ファイルパスの決定
    this.configPath = this.getConfigPath();
    
    // 設定ディレクトリの作成
    const configDir = path.dirname(this.configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    // 設定の読み込み
    await this.load();
  }

  /**
   * 設定ファイルパスの取得
   */
  getConfigPath() {
    // 環境変数優先
    if (process.env.POPPOBUILDER_CONFIG) {
      return path.resolve(process.env.POPPOBUILDER_CONFIG);
    }
    
    // デフォルトパス
    return path.join(os.homedir(), '.poppobuilder', 'config.json');
  }

  /**
   * 設定の読み込み
   */
  async load() {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf8');
        const userConfig = JSON.parse(data);
        
        // デフォルト設定とマージ
        this.config = this.mergeDeep(this.defaults, userConfig);
      } else {
        // 初回作成
        this.config = { ...this.defaults };
        await this.save();
      }
    } catch (error) {
      console.error('Failed to load global config:', error);
      this.config = { ...this.defaults };
    }
  }

  /**
   * 設定の保存
   */
  async save() {
    try {
      const data = JSON.stringify(this.config, null, 2);
      fs.writeFileSync(this.configPath, data, 'utf8');
    } catch (error) {
      console.error('Failed to save global config:', error);
      throw error;
    }
  }

  /**
   * 設定の取得
   */
  get(keyPath, defaultValue = null) {
    if (!this.config) return defaultValue;
    
    const keys = keyPath.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  /**
   * 設定の更新
   */
  async set(keyPath, value) {
    const keys = keyPath.split('.');
    let target = this.config;
    
    // 最後のキー以外を辿る
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in target) || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }
    
    // 値を設定
    target[keys[keys.length - 1]] = value;
    
    // 保存
    await this.save();
  }

  /**
   * プロジェクト設定の取得
   */
  getProjectConfig(projectName) {
    return this.config.projects[projectName] || {};
  }

  /**
   * プロジェクト設定の更新
   */
  async setProjectConfig(projectName, config) {
    if (!this.config.projects) {
      this.config.projects = {};
    }
    
    this.config.projects[projectName] = config;
    await this.save();
  }

  /**
   * 設定の検証
   */
  validate() {
    const errors = [];
    
    // バージョンチェック
    if (!this.config.version) {
      errors.push('Missing version field');
    }
    
    // ストレージ設定チェック
    if (!this.config.storage) {
      errors.push('Missing storage configuration');
    } else {
      // baseDirの存在確認
      const baseDir = this.expandPath(this.config.storage.baseDir);
      if (!fs.existsSync(baseDir)) {
        try {
          fs.mkdirSync(baseDir, { recursive: true });
        } catch (error) {
          errors.push(`Cannot create base directory: ${baseDir}`);
        }
      }
    }
    
    return errors;
  }

  /**
   * パスの展開
   */
  expandPath(inputPath) {
    if (!inputPath) return inputPath;
    
    if (inputPath.startsWith('~')) {
      return path.join(os.homedir(), inputPath.slice(1));
    }
    
    // 環境変数の展開
    return inputPath.replace(/\$([A-Z_]+)/g, (match, envVar) => {
      return process.env[envVar] || match;
    });
  }

  /**
   * 深いマージ
   */
  mergeDeep(target, source) {
    const output = { ...target };
    
    if (this.isObject(target) && this.isObject(source)) {
      Object.keys(source).forEach(key => {
        if (this.isObject(source[key])) {
          if (!(key in target)) {
            output[key] = source[key];
          } else {
            output[key] = this.mergeDeep(target[key], source[key]);
          }
        } else {
          output[key] = source[key];
        }
      });
    }
    
    return output;
  }

  /**
   * オブジェクト判定
   */
  isObject(item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * 設定のエクスポート
   */
  export() {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * 設定のインポート
   */
  async import(configJson) {
    try {
      const newConfig = JSON.parse(configJson);
      this.config = this.mergeDeep(this.defaults, newConfig);
      await this.save();
    } catch (error) {
      throw new Error(`Invalid configuration JSON: ${error.message}`);
    }
  }

  /**
   * 設定のリセット
   */
  async reset() {
    this.config = { ...this.defaults };
    await this.save();
  }
}

// シングルトンインスタンス
const globalConfig = new GlobalConfigManager();

module.exports = globalConfig;