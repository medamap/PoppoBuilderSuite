const fs = require('fs').promises;
const path = require('path');

class TranslationLoader {
  constructor() {
    this.basePath = path.join(__dirname, '../../locales');
    this.cache = new Map();
  }

  /**
   * すべての翻訳リソースをロード
   * @param {string[]} locales - ロケールのリスト
   * @returns {Promise<Object>} 翻訳リソース
   */
  async loadAll(locales) {
    const resources = {};

    for (const locale of locales) {
      resources[locale] = await this.loadLocale(locale);
    }

    return resources;
  }

  /**
   * 特定のロケールの翻訳をロード
   * @param {string} locale - ロケール
   * @returns {Promise<Object>} ロケールの翻訳リソース
   */
  async loadLocale(locale) {
    // キャッシュをチェック
    const cacheKey = `locale:${locale}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    const localePath = path.join(this.basePath, locale);
    const resources = {};

    try {
      // ロケールディレクトリの存在を確認
      await fs.access(localePath);
      
      // ディレクトリ内のJSONファイルを読み込む
      const files = await fs.readdir(localePath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const namespace = path.basename(file, '.json');
          const filePath = path.join(localePath, file);
          
          try {
            const content = await fs.readFile(filePath, 'utf8');
            resources[namespace] = JSON.parse(content);
          } catch (error) {
            console.error(`Failed to load translation file: ${filePath}`, error);
            resources[namespace] = {};
          }
        }
      }
    } catch (error) {
      // ロケールディレクトリが存在しない場合
      console.warn(`Locale directory not found: ${localePath}`);
    }

    // キャッシュに保存
    this.cache.set(cacheKey, resources);
    
    return resources;
  }

  /**
   * 特定の名前空間をロード
   * @param {string} locale - ロケール
   * @param {string} namespace - 名前空間
   * @returns {Promise<Object>} 翻訳リソース
   */
  async loadNamespace(locale, namespace) {
    const filePath = path.join(this.basePath, locale, `${namespace}.json`);
    
    // キャッシュをチェック
    const cacheKey = `${locale}:${namespace}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const translations = JSON.parse(content);
      
      // キャッシュに保存
      this.cache.set(cacheKey, translations);
      
      return translations;
    } catch (error) {
      console.error(`Failed to load namespace: ${locale}/${namespace}`, error);
      return {};
    }
  }

  /**
   * 翻訳ファイルを保存
   * @param {string} locale - ロケール
   * @param {string} namespace - 名前空間
   * @param {Object} translations - 翻訳データ
   * @returns {Promise<void>}
   */
  async saveNamespace(locale, namespace, translations) {
    const localePath = path.join(this.basePath, locale);
    const filePath = path.join(localePath, `${namespace}.json`);

    try {
      // ディレクトリが存在しない場合は作成
      await fs.mkdir(localePath, { recursive: true });
      
      // 翻訳ファイルを保存
      await fs.writeFile(filePath, JSON.stringify(translations, null, 2));
      
      // キャッシュを更新
      const cacheKey = `${locale}:${namespace}`;
      this.cache.set(cacheKey, translations);
    } catch (error) {
      console.error(`Failed to save namespace: ${locale}/${namespace}`, error);
      throw error;
    }
  }

  /**
   * 翻訳ファイルをマージ
   * @param {string} locale - ロケール
   * @param {string} namespace - 名前空間
   * @param {Object} newTranslations - 新しい翻訳データ
   * @returns {Promise<void>}
   */
  async mergeNamespace(locale, namespace, newTranslations) {
    const existing = await this.loadNamespace(locale, namespace);
    const merged = this.deepMerge(existing, newTranslations);
    
    await this.saveNamespace(locale, namespace, merged);
  }

  /**
   * オブジェクトを深くマージ
   * @param {Object} target - ターゲットオブジェクト
   * @param {Object} source - ソースオブジェクト
   * @returns {Object} マージされたオブジェクト
   */
  deepMerge(target, source) {
    const result = { ...target };
    
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        if (typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])) {
          result[key] = this.deepMerge(result[key] || {}, source[key]);
        } else {
          result[key] = source[key];
        }
      }
    }
    
    return result;
  }

  /**
   * キャッシュをクリア
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * 利用可能なロケールを取得
   * @returns {Promise<string[]>} ロケールのリスト
   */
  async getAvailableLocales() {
    try {
      const entries = await fs.readdir(this.basePath, { withFileTypes: true });
      
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(name => !name.startsWith('.'));
    } catch (error) {
      console.error('Failed to get available locales:', error);
      return [];
    }
  }

  /**
   * 利用可能な名前空間を取得
   * @param {string} locale - ロケール
   * @returns {Promise<string[]>} 名前空間のリスト
   */
  async getAvailableNamespaces(locale) {
    const localePath = path.join(this.basePath, locale);
    
    try {
      const files = await fs.readdir(localePath);
      
      return files
        .filter(file => file.endsWith('.json'))
        .map(file => path.basename(file, '.json'));
    } catch (error) {
      console.error(`Failed to get namespaces for locale: ${locale}`, error);
      return [];
    }
  }

  /**
   * 翻訳の統計情報を取得
   * @param {string} locale - ロケール
   * @returns {Promise<Object>} 統計情報
   */
  async getStatistics(locale) {
    const stats = {
      locale,
      namespaces: {},
      totalKeys: 0,
      totalTranslations: 0,
    };

    const namespaces = await this.getAvailableNamespaces(locale);
    
    for (const namespace of namespaces) {
      const translations = await this.loadNamespace(locale, namespace);
      const keyCount = this.countKeys(translations);
      
      stats.namespaces[namespace] = keyCount;
      stats.totalKeys += keyCount;
      stats.totalTranslations += keyCount;
    }

    return stats;
  }

  /**
   * オブジェクト内のキー数をカウント
   * @param {Object} obj - カウント対象のオブジェクト
   * @returns {number} キー数
   */
  countKeys(obj) {
    let count = 0;
    
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
          count += this.countKeys(obj[key]);
        } else {
          count++;
        }
      }
    }
    
    return count;
  }

  /**
   * 欠落している翻訳キーを検出
   * @param {string} baseLocale - 基準ロケール
   * @param {string} targetLocale - 対象ロケール
   * @returns {Promise<Object>} 欠落キーの情報
   */
  async findMissingKeys(baseLocale, targetLocale) {
    const missing = {};
    const namespaces = await this.getAvailableNamespaces(baseLocale);

    for (const namespace of namespaces) {
      const baseTranslations = await this.loadNamespace(baseLocale, namespace);
      const targetTranslations = await this.loadNamespace(targetLocale, namespace);
      
      const missingKeys = this.findMissingKeysInObject(baseTranslations, targetTranslations);
      
      if (missingKeys.length > 0) {
        missing[namespace] = missingKeys;
      }
    }

    return missing;
  }

  /**
   * オブジェクト内の欠落キーを検出
   * @param {Object} base - 基準オブジェクト
   * @param {Object} target - 対象オブジェクト
   * @param {string} prefix - キーのプレフィックス
   * @returns {string[]} 欠落キーのリスト
   */
  findMissingKeysInObject(base, target, prefix = '') {
    const missingKeys = [];

    for (const key in base) {
      if (base.hasOwnProperty(key)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        
        if (!(key in target)) {
          missingKeys.push(fullKey);
        } else if (typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
          const nestedMissing = this.findMissingKeysInObject(
            base[key],
            target[key] || {},
            fullKey
          );
          missingKeys.push(...nestedMissing);
        }
      }
    }

    return missingKeys;
  }
}

module.exports = TranslationLoader;