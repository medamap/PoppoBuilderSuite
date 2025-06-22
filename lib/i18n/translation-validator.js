const fs = require('fs').promises;
const path = require('path');
const TranslationLoader = require('./translation-loader');

class TranslationValidator {
  constructor() {
    this.loader = new TranslationLoader();
    this.supportedLocales = ['en', 'ja'];
    this.defaultLocale = 'en';
  }

  /**
   * すべての翻訳ファイルを検証
   * @returns {Promise<Object>} 検証結果
   */
  async validateAll() {
    const results = {
      valid: true,
      errors: [],
      warnings: [],
      summary: {
        totalKeys: 0,
        missingKeys: 0,
        extraKeys: 0,
        invalidInterpolations: 0,
        emptyValues: 0
      }
    };

    try {
      // 基準となる翻訳を読み込む
      const baseTranslations = await this.loader.loadLocale(this.defaultLocale);
      const namespaces = Object.keys(baseTranslations);

      // 各ロケールを検証
      for (const locale of this.supportedLocales) {
        if (locale === this.defaultLocale) continue;

        const localeResults = await this.validateLocale(locale, baseTranslations);
        results.errors.push(...localeResults.errors);
        results.warnings.push(...localeResults.warnings);
        
        // サマリーを更新
        results.summary.missingKeys += localeResults.summary.missingKeys;
        results.summary.extraKeys += localeResults.summary.extraKeys;
        results.summary.invalidInterpolations += localeResults.summary.invalidInterpolations;
        results.summary.emptyValues += localeResults.summary.emptyValues;
      }

      // 基準ロケールも検証
      const baseResults = await this.validateBaseLocale(this.defaultLocale);
      results.errors.push(...baseResults.errors);
      results.warnings.push(...baseResults.warnings);
      results.summary.totalKeys = baseResults.summary.totalKeys;
      results.summary.invalidInterpolations += baseResults.summary.invalidInterpolations;
      results.summary.emptyValues += baseResults.summary.emptyValues;

      // 全体の有効性を判定
      results.valid = results.errors.length === 0;

    } catch (error) {
      results.valid = false;
      results.errors.push({
        type: 'fatal',
        message: `Failed to validate translations: ${error.message}`
      });
    }

    return results;
  }

  /**
   * 特定のロケールを検証
   * @param {string} locale - 検証するロケール
   * @param {Object} baseTranslations - 基準となる翻訳
   * @returns {Promise<Object>} 検証結果
   */
  async validateLocale(locale, baseTranslations) {
    const results = {
      locale,
      errors: [],
      warnings: [],
      summary: {
        missingKeys: 0,
        extraKeys: 0,
        invalidInterpolations: 0,
        emptyValues: 0
      }
    };

    try {
      const translations = await this.loader.loadLocale(locale);

      // 各名前空間を検証
      for (const namespace of Object.keys(baseTranslations)) {
        const baseNs = baseTranslations[namespace];
        const targetNs = translations[namespace] || {};

        // 欠落キーをチェック
        const missingKeys = this.findMissingKeys(baseNs, targetNs, `${namespace}`);
        results.summary.missingKeys += missingKeys.length;
        missingKeys.forEach(key => {
          results.errors.push({
            type: 'missing_key',
            locale,
            namespace,
            key,
            message: `Missing translation key: ${key}`
          });
        });

        // 余分なキーをチェック
        const extraKeys = this.findExtraKeys(baseNs, targetNs, `${namespace}`);
        results.summary.extraKeys += extraKeys.length;
        extraKeys.forEach(key => {
          results.warnings.push({
            type: 'extra_key',
            locale,
            namespace,
            key,
            message: `Extra translation key: ${key}`
          });
        });

        // 翻訳値を検証
        this.validateTranslationValues(targetNs, locale, namespace, results);
      }

      // ロケールに存在するが基準にない名前空間をチェック
      for (const namespace of Object.keys(translations)) {
        if (!baseTranslations[namespace]) {
          results.warnings.push({
            type: 'extra_namespace',
            locale,
            namespace,
            message: `Extra namespace found: ${namespace}`
          });
        }
      }

    } catch (error) {
      results.errors.push({
        type: 'load_error',
        locale,
        message: `Failed to load locale: ${error.message}`
      });
    }

    return results;
  }

  /**
   * 基準ロケールを検証
   * @param {string} locale - 基準ロケール
   * @returns {Promise<Object>} 検証結果
   */
  async validateBaseLocale(locale) {
    const results = {
      locale,
      errors: [],
      warnings: [],
      summary: {
        totalKeys: 0,
        invalidInterpolations: 0,
        emptyValues: 0
      }
    };

    try {
      const translations = await this.loader.loadLocale(locale);

      for (const namespace of Object.keys(translations)) {
        const nsTranslations = translations[namespace];
        
        // キー数をカウント
        results.summary.totalKeys += this.countKeys(nsTranslations);
        
        // 翻訳値を検証
        this.validateTranslationValues(nsTranslations, locale, namespace, results);
      }

    } catch (error) {
      results.errors.push({
        type: 'load_error',
        locale,
        message: `Failed to load base locale: ${error.message}`
      });
    }

    return results;
  }

  /**
   * 欠落しているキーを検出
   * @param {Object} base - 基準オブジェクト
   * @param {Object} target - 対象オブジェクト
   * @param {string} prefix - キーのプレフィックス
   * @returns {string[]} 欠落キーのリスト
   */
  findMissingKeys(base, target, prefix = '') {
    const missing = [];

    for (const key in base) {
      if (!base.hasOwnProperty(key)) continue;

      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (!(key in target)) {
        missing.push(fullKey);
      } else if (typeof base[key] === 'object' && base[key] !== null && !Array.isArray(base[key])) {
        const nestedMissing = this.findMissingKeys(
          base[key],
          target[key] || {},
          fullKey
        );
        missing.push(...nestedMissing);
      }
    }

    return missing;
  }

  /**
   * 余分なキーを検出
   * @param {Object} base - 基準オブジェクト
   * @param {Object} target - 対象オブジェクト
   * @param {string} prefix - キーのプレフィックス
   * @returns {string[]} 余分なキーのリスト
   */
  findExtraKeys(base, target, prefix = '') {
    const extra = [];

    for (const key in target) {
      if (!target.hasOwnProperty(key)) continue;

      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (!(key in base)) {
        extra.push(fullKey);
      } else if (typeof target[key] === 'object' && target[key] !== null && !Array.isArray(target[key])) {
        const nestedExtra = this.findExtraKeys(
          base[key] || {},
          target[key],
          fullKey
        );
        extra.push(...nestedExtra);
      }
    }

    return extra;
  }

  /**
   * 翻訳値を検証
   * @param {Object} translations - 翻訳オブジェクト
   * @param {string} locale - ロケール
   * @param {string} namespace - 名前空間
   * @param {Object} results - 結果オブジェクト
   * @param {string} prefix - キーのプレフィックス
   */
  validateTranslationValues(translations, locale, namespace, results, prefix = '') {
    for (const key in translations) {
      if (!translations.hasOwnProperty(key)) continue;

      const value = translations[key];
      const fullKey = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'string') {
        // 空の値をチェック
        if (!value.trim()) {
          results.summary.emptyValues++;
          results.warnings.push({
            type: 'empty_value',
            locale,
            namespace,
            key: `${namespace}.${fullKey}`,
            message: `Empty translation value`
          });
        }

        // 補間変数を検証
        const interpolations = this.extractInterpolations(value);
        const invalidInterpolations = this.validateInterpolations(interpolations);
        
        if (invalidInterpolations.length > 0) {
          results.summary.invalidInterpolations += invalidInterpolations.length;
          results.errors.push({
            type: 'invalid_interpolation',
            locale,
            namespace,
            key: `${namespace}.${fullKey}`,
            value,
            invalidVars: invalidInterpolations,
            message: `Invalid interpolation variables: ${invalidInterpolations.join(', ')}`
          });
        }

        // 一貫性チェック（将来の拡張用）
        this.checkConsistency(value, fullKey, locale, namespace, results);

      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // ネストされたオブジェクトを再帰的に検証
        this.validateTranslationValues(value, locale, namespace, results, fullKey);
      }
    }
  }

  /**
   * 補間変数を抽出
   * @param {string} text - テキスト
   * @returns {string[]} 補間変数のリスト
   */
  extractInterpolations(text) {
    const pattern = /\{\{([^}]+)\}\}/g;
    const matches = [];
    let match;

    while ((match = pattern.exec(text)) !== null) {
      matches.push(match[1].trim());
    }

    return matches;
  }

  /**
   * 補間変数を検証
   * @param {string[]} interpolations - 補間変数のリスト
   * @returns {string[]} 無効な補間変数のリスト
   */
  validateInterpolations(interpolations) {
    const invalid = [];
    const validPattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

    for (const varName of interpolations) {
      if (!validPattern.test(varName)) {
        invalid.push(varName);
      }
    }

    return invalid;
  }

  /**
   * 翻訳の一貫性をチェック
   * @param {string} value - 翻訳値
   * @param {string} key - キー
   * @param {string} locale - ロケール
   * @param {string} namespace - 名前空間
   * @param {Object} results - 結果オブジェクト
   */
  checkConsistency(value, key, locale, namespace, results) {
    // 日本語と英語で異なる補間変数を使用していないかチェック
    // URLやメールアドレスの形式が正しいかチェック
    // 数値や日付の形式が適切かチェック
    
    // 例: URLパターンのチェック
    if (value.includes('http://') || value.includes('https://')) {
      const urlPattern = /https?:\/\/[^\s]+/g;
      const urls = value.match(urlPattern);
      
      if (urls) {
        urls.forEach(url => {
          try {
            new URL(url);
          } catch (error) {
            results.warnings.push({
              type: 'invalid_url',
              locale,
              namespace,
              key: `${namespace}.${key}`,
              value: url,
              message: `Invalid URL format: ${url}`
            });
          }
        });
      }
    }
  }

  /**
   * キー数をカウント
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
   * 検証結果を表示用にフォーマット
   * @param {Object} results - 検証結果
   * @returns {string} フォーマットされたレポート
   */
  formatReport(results) {
    const lines = [];
    
    lines.push('Translation Validation Report');
    lines.push('=' .repeat(50));
    lines.push('');
    
    lines.push(`Status: ${results.valid ? '✅ VALID' : '❌ INVALID'}`);
    lines.push('');
    
    lines.push('Summary:');
    lines.push(`  Total keys: ${results.summary.totalKeys}`);
    lines.push(`  Missing keys: ${results.summary.missingKeys}`);
    lines.push(`  Extra keys: ${results.summary.extraKeys}`);
    lines.push(`  Invalid interpolations: ${results.summary.invalidInterpolations}`);
    lines.push(`  Empty values: ${results.summary.emptyValues}`);
    lines.push('');
    
    if (results.errors.length > 0) {
      lines.push(`Errors (${results.errors.length}):`);
      results.errors.forEach((error, index) => {
        lines.push(`  ${index + 1}. [${error.type}] ${error.message}`);
        if (error.locale) lines.push(`     Locale: ${error.locale}`);
        if (error.key) lines.push(`     Key: ${error.key}`);
      });
      lines.push('');
    }
    
    if (results.warnings.length > 0) {
      lines.push(`Warnings (${results.warnings.length}):`);
      results.warnings.forEach((warning, index) => {
        lines.push(`  ${index + 1}. [${warning.type}] ${warning.message}`);
        if (warning.locale) lines.push(`     Locale: ${warning.locale}`);
        if (warning.key) lines.push(`     Key: ${warning.key}`);
      });
      lines.push('');
    }
    
    return lines.join('\n');
  }

  /**
   * 修正提案を生成
   * @param {Object} results - 検証結果
   * @returns {Object} 修正提案
   */
  generateFixes(results) {
    const fixes = {
      missingKeys: {},
      emptyValues: {},
      suggestions: []
    };

    // 欠落キーの修正提案
    results.errors.forEach(error => {
      if (error.type === 'missing_key') {
        if (!fixes.missingKeys[error.locale]) {
          fixes.missingKeys[error.locale] = {};
        }
        if (!fixes.missingKeys[error.locale][error.namespace]) {
          fixes.missingKeys[error.locale][error.namespace] = [];
        }
        fixes.missingKeys[error.locale][error.namespace].push(error.key);
      }
    });

    // 空の値の修正提案
    results.warnings.forEach(warning => {
      if (warning.type === 'empty_value') {
        if (!fixes.emptyValues[warning.locale]) {
          fixes.emptyValues[warning.locale] = {};
        }
        if (!fixes.emptyValues[warning.locale][warning.namespace]) {
          fixes.emptyValues[warning.locale][warning.namespace] = [];
        }
        fixes.emptyValues[warning.locale][warning.namespace].push(warning.key);
      }
    });

    // 一般的な提案
    if (results.summary.missingKeys > 0) {
      fixes.suggestions.push('Run translation sync to copy missing keys from the base locale');
    }
    if (results.summary.extraKeys > 0) {
      fixes.suggestions.push('Review extra keys and remove if they are no longer needed');
    }
    if (results.summary.invalidInterpolations > 0) {
      fixes.suggestions.push('Fix invalid interpolation variable names to use only alphanumeric characters and underscores');
    }

    return fixes;
  }
}

module.exports = TranslationValidator;