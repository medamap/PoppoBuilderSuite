const path = require('path');
const fs = require('fs').promises;
const i18nManager = require('../lib/i18n/i18n-manager');
const LocaleDetector = require('../lib/i18n/locale-detector');
const TranslationLoader = require('../lib/i18n/translation-loader');

describe('i18n System Tests', () => {
  beforeEach(() => {
    // 環境変数をクリア
    delete process.env.POPPOBUILDER_LANG;
    delete process.env.POPPOBUILDER_LOCALE;
    
    // キャッシュをクリア
    const loader = new TranslationLoader();
    loader.clearCache();
  });

  describe('LocaleDetector', () => {
    let detector;

    beforeEach(() => {
      detector = new LocaleDetector();
    });

    test('should detect locale from environment variable', async () => {
      process.env.POPPOBUILDER_LANG = 'ja';
      const locale = await detector.detect();
      expect(locale).toBe('ja');
    });

    test('should normalize locale codes', () => {
      expect(detector.normalizeLocale('en-US')).toBe('en');
      expect(detector.normalizeLocale('ja_JP')).toBe('ja');
      expect(detector.normalizeLocale('japanese')).toBe('ja');
      expect(detector.normalizeLocale('ENG')).toBe('en');
    });

    test('should detect from system locale', () => {
      const originalLang = process.env.LANG;
      process.env.LANG = 'ja_JP.UTF-8';
      
      const locale = detector.detectFromSystem();
      expect(locale).toBe('ja');
      
      // 元に戻す
      if (originalLang) {
        process.env.LANG = originalLang;
      } else {
        delete process.env.LANG;
      }
    });

    test('should return default locale when nothing detected', async () => {
      const locale = await detector.detect();
      expect(['en', 'ja']).toContain(locale); // システムによって異なる
    });
  });

  describe('TranslationLoader', () => {
    let loader;

    beforeEach(() => {
      loader = new TranslationLoader();
    });

    test('should load translations for a locale', async () => {
      const translations = await loader.loadLocale('en');
      expect(translations).toHaveProperty('common');
      expect(translations.common).toHaveProperty('app');
    });

    test('should load specific namespace', async () => {
      const translations = await loader.loadNamespace('ja', 'common');
      expect(translations).toHaveProperty('app');
      expect(translations.app.description).toBe('AI駆動のGitHub自動化システム');
    });

    test('should cache loaded translations', async () => {
      // 最初のロード
      const start = Date.now();
      await loader.loadNamespace('en', 'common');
      const firstLoadTime = Date.now() - start;

      // キャッシュからのロード
      const cacheStart = Date.now();
      await loader.loadNamespace('en', 'common');
      const cacheLoadTime = Date.now() - cacheStart;

      // キャッシュからの読み込みは高速
      expect(cacheLoadTime).toBeLessThan(firstLoadTime + 1);
    });

    test('should get available locales', async () => {
      const locales = await loader.getAvailableLocales();
      expect(locales).toContain('en');
      expect(locales).toContain('ja');
    });

    test('should deep merge objects', () => {
      const target = {
        a: 1,
        b: { c: 2, d: 3 },
        e: [1, 2, 3]
      };
      const source = {
        b: { c: 4, f: 5 },
        g: 6
      };
      
      const merged = loader.deepMerge(target, source);
      
      expect(merged).toEqual({
        a: 1,
        b: { c: 4, d: 3, f: 5 },
        e: [1, 2, 3],
        g: 6
      });
    });

    test('should count keys correctly', () => {
      const obj = {
        a: 'value',
        b: {
          c: 'value',
          d: {
            e: 'value',
            f: 'value'
          }
        },
        g: ['array', 'values']
      };
      
      const count = loader.countKeys(obj);
      expect(count).toBe(5); // a, c, e, f, g (配列は1つのキーとしてカウント)
    });
  });

  describe('I18nManager', () => {
    beforeEach(async () => {
      // 新しいインスタンスで初期化
      await i18nManager.initialize({ cliLocale: 'en' });
    });

    test('should initialize successfully', () => {
      expect(i18nManager.initialized).toBe(true);
      expect(i18nManager.getCurrentLocale()).toBe('en');
    });

    test('should translate keys', () => {
      const translated = i18nManager.t('general.yes');
      expect(translated).toBe('Yes');
    });

    test('should handle interpolation', () => {
      const translated = i18nManager.t('time.ago', { time: '5 minutes' });
      expect(translated).toBe('5 minutes ago');
    });

    test('should change locale', async () => {
      await i18nManager.changeLocale('ja');
      expect(i18nManager.getCurrentLocale()).toBe('ja');
      
      const translated = i18nManager.t('general.yes');
      expect(translated).toBe('はい');
    });

    test('should check if key exists', () => {
      expect(i18nManager.hasKey('general.yes')).toBe(true);
      expect(i18nManager.hasKey('nonexistent.key')).toBe(false);
    });

    test('should format numbers', () => {
      const formatted = i18nManager.formatNumber(1234567.89);
      expect(formatted).toMatch(/1,234,567/); // ロケールによって小数点以下の表示が異なる
    });

    test('should format dates', () => {
      const date = new Date('2024-06-20T12:00:00');
      const formatted = i18nManager.formatDate(date, { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      expect(formatted).toMatch(/2024/);
      expect(formatted).toMatch(/06/);
      expect(formatted).toMatch(/20/);
    });

    test('should get translator for namespace', () => {
      const t = i18nManager.getTranslator('common');
      const translated = t('app.name');
      expect(translated).toBe('PoppoBuilder Suite');
    });

    test('should get all resources', () => {
      const resources = i18nManager.getAllResources();
      expect(resources).toHaveProperty('en');
      expect(resources).toHaveProperty('ja');
      expect(resources.en).toHaveProperty('common');
      expect(resources.ja).toHaveProperty('common');
    });

    test('should handle missing translations gracefully', () => {
      const key = 'nonexistent.translation.key';
      const translated = i18nManager.t(key);
      expect(translated).toBe(key); // Returns key when translation not found
    });
  });

  describe('Integration Tests', () => {
    test('should work end-to-end with Japanese locale', async () => {
      // 環境変数を設定
      process.env.POPPOBUILDER_LANG = 'ja';
      
      // 新しいインスタンスで初期化
      const detector = new LocaleDetector();
      const detectedLocale = await detector.detect();
      expect(detectedLocale).toBe('ja');
      
      // i18nManagerを日本語で初期化
      await i18nManager.initialize({ cliLocale: detectedLocale });
      
      // 翻訳確認
      expect(i18nManager.t('general.save')).toBe('保存');
      expect(i18nManager.t('status.running')).toBe('実行中');
      expect(i18nManager.t('time.minutes', { count: 5 })).toBe('分');
    });

    test('should save and load locale preference', async () => {
      const detector = new LocaleDetector();
      const testConfigPath = path.join(process.cwd(), '.poppobuilder', 'test-config.json');
      
      // テスト用の設定パスを使用
      detector.configPaths = [testConfigPath];
      
      try {
        // ロケール設定を保存
        await detector.savePreference('ja');
        
        // 保存された設定を読み込む
        const locale = await detector.detectFromConfig();
        expect(locale).toBe('ja');
        
        // ファイルの内容を確認
        const content = await fs.readFile(testConfigPath, 'utf8');
        const config = JSON.parse(content);
        expect(config.i18n.locale).toBe('ja');
      } finally {
        // クリーンアップ
        try {
          await fs.unlink(testConfigPath);
          await fs.rmdir(path.dirname(testConfigPath));
        } catch (error) {
          // ファイルが存在しない場合は無視
        }
      }
    });
  });
});