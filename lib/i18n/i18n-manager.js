const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const path = require('path');
const LocaleDetector = require('./locale-detector');
const TranslationLoader = require('./translation-loader');

class I18nManager {
  constructor() {
    this.initialized = false;
    this.currentLocale = null;
    this.fallbackLocale = 'en';
    this.supportedLocales = ['en', 'ja'];
    this.translationLoader = new TranslationLoader();
    this.localeDetector = new LocaleDetector();
  }

  /**
   * i18nシステムを初期化
   * @param {Object} options - 初期化オプション
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
    if (this.initialized) {
      return;
    }

    // ロケールを検出
    const detectedLocale = await this.localeDetector.detect(options);
    this.currentLocale = this.supportedLocales.includes(detectedLocale) 
      ? detectedLocale 
      : this.fallbackLocale;

    // i18next設定
    const i18nConfig = {
      lng: this.currentLocale,
      fallbackLng: this.fallbackLocale,
      supportedLngs: this.supportedLocales,
      debug: process.env.I18N_DEBUG === 'true',
      
      // バックエンド設定
      backend: {
        loadPath: path.join(__dirname, '../../locales/{{lng}}/{{ns}}.json'),
        addPath: path.join(__dirname, '../../locales/{{lng}}/{{ns}}.json'),
      },
      
      // 名前空間設定
      ns: ['common', 'commands', 'errors', 'messages', 'github'],
      defaultNS: 'common',
      nsSeparator: ':',
      keySeparator: '.',
      
      // 補間設定
      interpolation: {
        escapeValue: false, // XSS対策はGitHub/CLI出力で別途行う
        prefix: '{{',
        suffix: '}}',
      },
      
      // リソース設定
      resources: await this.translationLoader.loadAll(this.supportedLocales),
      
      // その他の設定
      cleanCode: true,
      returnEmptyString: false,
      returnNull: false,
      ...options.i18nextOptions,
    };

    // i18nextを初期化
    await i18next
      .use(Backend)
      .init(i18nConfig);

    this.initialized = true;
  }

  /**
   * 翻訳関数を取得
   * @param {string} namespace - 名前空間
   * @returns {Function} 翻訳関数
   */
  getTranslator(namespace = 'common') {
    if (!this.initialized) {
      throw new Error('I18nManager not initialized. Call initialize() first.');
    }
    
    return i18next.getFixedT(this.currentLocale, namespace);
  }

  /**
   * キーを翻訳
   * @param {string} key - 翻訳キー
   * @param {Object} options - 翻訳オプション
   * @returns {string} 翻訳されたテキスト
   */
  translate(key, options = {}) {
    if (!this.initialized) {
      console.warn('I18nManager not initialized. Returning key as-is.');
      return key;
    }
    
    return i18next.t(key, options);
  }

  /**
   * 短縮形の翻訳関数
   */
  t(key, options = {}) {
    return this.translate(key, options);
  }

  /**
   * 現在のロケールを取得
   * @returns {string} 現在のロケール
   */
  getCurrentLocale() {
    return this.currentLocale || this.fallbackLocale;
  }

  /**
   * ロケールを変更
   * @param {string} locale - 新しいロケール
   * @returns {Promise<void>}
   */
  async changeLocale(locale) {
    if (!this.supportedLocales.includes(locale)) {
      throw new Error(`Unsupported locale: ${locale}. Supported locales: ${this.supportedLocales.join(', ')}`);
    }

    await i18next.changeLanguage(locale);
    this.currentLocale = locale;
    
    // ロケール変更を設定に保存
    await this.localeDetector.savePreference(locale);
  }

  /**
   * サポートされているロケールのリストを取得
   * @returns {string[]} サポートされているロケール
   */
  getSupportedLocales() {
    return [...this.supportedLocales];
  }

  /**
   * 指定されたキーが存在するかチェック
   * @param {string} key - 翻訳キー
   * @param {Object} options - オプション
   * @returns {boolean} キーが存在するか
   */
  hasKey(key, options = {}) {
    return i18next.exists(key, options);
  }

  /**
   * 名前空間をリロード
   * @param {string} namespace - 名前空間
   * @param {string} locale - ロケール（省略時は全ロケール）
   * @returns {Promise<void>}
   */
  async reloadNamespace(namespace, locale = null) {
    const locales = locale ? [locale] : this.supportedLocales;
    
    for (const loc of locales) {
      await i18next.reloadResources(loc, namespace);
    }
  }

  /**
   * 新しい翻訳リソースを追加
   * @param {string} locale - ロケール
   * @param {string} namespace - 名前空間
   * @param {Object} resources - 翻訳リソース
   */
  addResources(locale, namespace, resources) {
    i18next.addResources(locale, namespace, resources);
  }

  /**
   * i18nextインスタンスを取得（高度な操作用）
   * @returns {Object} i18nextインスタンス
   */
  getInstance() {
    return i18next;
  }

  /**
   * リソースバンドルを取得
   * @param {string} locale - ロケール
   * @param {string} namespace - 名前空間
   * @returns {Object} リソースバンドル
   */
  getResourceBundle(locale, namespace) {
    return i18next.getResourceBundle(locale, namespace);
  }

  /**
   * 全リソースを取得
   * @returns {Object} 全リソース
   */
  getAllResources() {
    const resources = {};
    
    for (const locale of this.supportedLocales) {
      resources[locale] = {};
      for (const ns of i18next.options.ns) {
        resources[locale][ns] = this.getResourceBundle(locale, ns);
      }
    }
    
    return resources;
  }

  /**
   * フォーマット関数を登録
   * @param {string} name - フォーマット名
   * @param {Function} fn - フォーマット関数
   */
  addFormatter(name, fn) {
    i18next.services.formatter.add(name, fn);
  }

  /**
   * 数値フォーマット
   * @param {number} value - 数値
   * @param {Object} options - フォーマットオプション
   * @returns {string} フォーマットされた数値
   */
  formatNumber(value, options = {}) {
    const locale = this.getCurrentLocale();
    return new Intl.NumberFormat(locale, options).format(value);
  }

  /**
   * 日付フォーマット
   * @param {Date} date - 日付
   * @param {Object} options - フォーマットオプション
   * @returns {string} フォーマットされた日付
   */
  formatDate(date, options = {}) {
    const locale = this.getCurrentLocale();
    return new Intl.DateTimeFormat(locale, options).format(date);
  }

  /**
   * 相対時間フォーマット
   * @param {number} value - 値
   * @param {string} unit - 単位
   * @returns {string} フォーマットされた相対時間
   */
  formatRelativeTime(value, unit) {
    const locale = this.getCurrentLocale();
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    return rtf.format(value, unit);
  }

  /**
   * 複数形処理
   * @param {string} key - 翻訳キー
   * @param {number} count - カウント
   * @param {Object} options - オプション
   * @returns {string} 翻訳されたテキスト
   */
  plural(key, count, options = {}) {
    return this.translate(key, { count, ...options });
  }
}

// シングルトンインスタンスをエクスポート
module.exports = new I18nManager();