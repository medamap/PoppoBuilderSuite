/**
 * Environment Manager
 * 環境変数の分離、保存、復元を管理
 */

const fs = require('fs').promises;
const path = require('path');

class EnvironmentManager {
  constructor() {
    this.snapshots = new Map();
    this.isolatedEnvs = new Map();
  }

  /**
   * 現在の環境変数のスナップショットを作成
   * @param {string} name - スナップショット名
   * @returns {Object} スナップショットオブジェクト
   */
  createSnapshot(name = 'default') {
    const snapshot = {
      env: { ...process.env },
      timestamp: new Date().toISOString(),
      name
    };
    
    this.snapshots.set(name, snapshot);
    return snapshot;
  }

  /**
   * スナップショットから環境変数を復元
   * @param {string} name - スナップショット名
   * @returns {boolean} 復元成功フラグ
   */
  restoreSnapshot(name = 'default') {
    const snapshot = this.snapshots.get(name);
    if (!snapshot) {
      return false;
    }

    // 現在の環境変数をクリア
    Object.keys(process.env).forEach(key => {
      delete process.env[key];
    });

    // スナップショットから復元
    Object.assign(process.env, snapshot.env);
    return true;
  }

  /**
   * 分離された環境を作成
   * @param {string} projectId - プロジェクトID
   * @param {Object} baseEnv - ベース環境変数（省略時は現在の環境）
   * @returns {Object} 分離された環境オブジェクト
   */
  createIsolatedEnvironment(projectId, baseEnv = null) {
    const isolated = {
      ...((baseEnv || process.env)),
      POPPO_PROJECT_ID: projectId,
      POPPO_ISOLATED_ENV: 'true'
    };

    this.isolatedEnvs.set(projectId, isolated);
    return isolated;
  }

  /**
   * 分離された環境で関数を実行
   * @param {string} projectId - プロジェクトID
   * @param {Function} fn - 実行する関数
   * @param {Object} additionalEnv - 追加の環境変数
   * @returns {*} 関数の実行結果
   */
  async runInIsolatedEnvironment(projectId, fn, additionalEnv = {}) {
    // 現在の環境を保存
    const originalEnv = { ...process.env };
    
    try {
      // 分離された環境を取得または作成
      let isolatedEnv = this.isolatedEnvs.get(projectId);
      if (!isolatedEnv) {
        isolatedEnv = this.createIsolatedEnvironment(projectId);
      }

      // 環境変数を一時的に置き換え
      Object.keys(process.env).forEach(key => {
        delete process.env[key];
      });
      Object.assign(process.env, isolatedEnv, additionalEnv);

      // 関数を実行
      return await fn();
    } finally {
      // 元の環境を復元
      Object.keys(process.env).forEach(key => {
        delete process.env[key];
      });
      Object.assign(process.env, originalEnv);
    }
  }

  /**
   * 環境変数をファイルに保存
   * @param {string} filePath - 保存先ファイルパス
   * @param {Object} env - 保存する環境変数（省略時は現在の環境）
   */
  async saveToFile(filePath, env = null) {
    const envToSave = env || process.env;
    const content = Object.entries(envToSave)
      .filter(([key]) => !key.startsWith('POPPO_INTERNAL_'))
      .map(([key, value]) => `${key}="${value}"`)
      .join('\n');

    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * ファイルから環境変数を読み込み
   * @param {string} filePath - 読み込むファイルパス
   * @returns {Object} 読み込まれた環境変数
   */
  async loadFromFile(filePath) {
    const content = await fs.readFile(filePath, 'utf8');
    const env = {};

    const lines = content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^([^=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        let value = match[2].trim();
        
        // クォートを除去
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        
        env[key] = value;
      }
    }

    return env;
  }

  /**
   * 環境変数の差分を取得
   * @param {Object} env1 - 比較元の環境変数
   * @param {Object} env2 - 比較先の環境変数
   * @returns {Object} 差分情報
   */
  getDifference(env1, env2) {
    const added = {};
    const removed = {};
    const changed = {};

    // env2に追加または変更された変数
    for (const [key, value] of Object.entries(env2)) {
      if (!(key in env1)) {
        added[key] = value;
      } else if (env1[key] !== value) {
        changed[key] = { from: env1[key], to: value };
      }
    }

    // env1から削除された変数
    for (const key of Object.keys(env1)) {
      if (!(key in env2)) {
        removed[key] = env1[key];
      }
    }

    return { added, removed, changed };
  }

  /**
   * 環境変数をマージ
   * @param {Object} base - ベース環境変数
   * @param {Object} overlay - 上書きする環境変数
   * @param {Object} options - マージオプション
   * @returns {Object} マージされた環境変数
   */
  merge(base, overlay, options = {}) {
    const merged = { ...base };
    const { prefix, override = true } = options;

    for (const [key, value] of Object.entries(overlay)) {
      const finalKey = prefix ? `${prefix}_${key}` : key;
      
      if (override || !(finalKey in merged)) {
        merged[finalKey] = value;
      }
    }

    return merged;
  }

  /**
   * 環境変数をフィルタリング
   * @param {Object} env - フィルタリングする環境変数
   * @param {Function|RegExp|Array<string>} filter - フィルター条件
   * @returns {Object} フィルタリングされた環境変数
   */
  filter(env, filter) {
    const filtered = {};

    for (const [key, value] of Object.entries(env)) {
      let include = false;

      if (typeof filter === 'function') {
        include = filter(key, value);
      } else if (filter instanceof RegExp) {
        include = filter.test(key);
      } else if (Array.isArray(filter)) {
        include = filter.includes(key);
      }

      if (include) {
        filtered[key] = value;
      }
    }

    return filtered;
  }

  /**
   * 環境変数の検証
   * @param {Object} env - 検証する環境変数
   * @param {Object} schema - 検証スキーマ
   * @returns {Object} 検証結果
   */
  validate(env, schema) {
    const errors = [];
    const warnings = [];

    for (const [key, rules] of Object.entries(schema)) {
      const value = env[key];

      // 必須チェック
      if (rules.required && !value) {
        errors.push(`Required environment variable '${key}' is missing`);
        continue;
      }

      if (value) {
        // 型チェック
        if (rules.type) {
          if (rules.type === 'number' && isNaN(Number(value))) {
            errors.push(`Environment variable '${key}' must be a number`);
          } else if (rules.type === 'boolean' && !['true', 'false', '1', '0'].includes(value.toLowerCase())) {
            errors.push(`Environment variable '${key}' must be a boolean`);
          }
        }

        // パターンチェック
        if (rules.pattern && !new RegExp(rules.pattern).test(value)) {
          errors.push(`Environment variable '${key}' does not match pattern: ${rules.pattern}`);
        }

        // 選択肢チェック
        if (rules.enum && !rules.enum.includes(value)) {
          errors.push(`Environment variable '${key}' must be one of: ${rules.enum.join(', ')}`);
        }
      }

      // 非推奨チェック
      if (rules.deprecated && value) {
        warnings.push(`Environment variable '${key}' is deprecated: ${rules.deprecated}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * すべてのスナップショットをクリア
   */
  clearSnapshots() {
    this.snapshots.clear();
  }

  /**
   * すべての分離環境をクリア
   */
  clearIsolatedEnvironments() {
    this.isolatedEnvs.clear();
  }
}

module.exports = EnvironmentManager;