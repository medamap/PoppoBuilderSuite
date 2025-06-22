const TranslationValidator = require('../lib/i18n/translation-validator');
const TranslationLoader = require('../lib/i18n/translation-loader');
const fs = require('fs').promises;
const path = require('path');

describe('TranslationValidator Tests', () => {
  let validator;

  beforeEach(() => {
    validator = new TranslationValidator();
  });

  describe('Basic Validation', () => {
    test('should validate all translation files successfully', async () => {
      const results = await validator.validateAll();
      
      // 現在の翻訳ファイルは有効であるべき
      expect(results.valid).toBe(true);
      expect(results.errors).toHaveLength(0);
      
      // 基本的な統計を確認
      expect(results.summary.totalKeys).toBeGreaterThan(0);
      expect(results.summary.missingKeys).toBe(0);
      expect(results.summary.invalidInterpolations).toBe(0);
    });

    test('should count keys correctly', () => {
      const testObj = {
        a: 'value',
        b: {
          c: 'value',
          d: {
            e: 'value'
          }
        },
        f: 'value'
      };
      
      const count = validator.countKeys(testObj);
      expect(count).toBe(4); // a, c, e, f
    });
  });

  describe('Missing Keys Detection', () => {
    test('should detect missing keys', () => {
      const base = {
        key1: 'value1',
        nested: {
          key2: 'value2',
          key3: 'value3'
        }
      };
      
      const target = {
        key1: 'translated1',
        nested: {
          key2: 'translated2'
          // key3 is missing
        }
      };
      
      const missing = validator.findMissingKeys(base, target);
      expect(missing).toEqual(['nested.key3']);
    });

    test('should handle deeply nested missing keys', () => {
      const base = {
        a: {
          b: {
            c: {
              d: 'value'
            }
          }
        }
      };
      
      const target = {
        a: {
          b: {}
        }
      };
      
      const missing = validator.findMissingKeys(base, target, 'prefix');
      expect(missing).toEqual(['prefix.a.b.c']);
    });
  });

  describe('Extra Keys Detection', () => {
    test('should detect extra keys', () => {
      const base = {
        key1: 'value1'
      };
      
      const target = {
        key1: 'translated1',
        key2: 'extra',
        nested: {
          extra: 'value'
        }
      };
      
      const extra = validator.findExtraKeys(base, target);
      expect(extra).toEqual(['key2', 'nested']);
    });
  });

  describe('Interpolation Validation', () => {
    test('should extract interpolations correctly', () => {
      const text = 'Hello {{name}}, you have {{count}} messages';
      const interpolations = validator.extractInterpolations(text);
      
      expect(interpolations).toEqual(['name', 'count']);
    });

    test('should validate interpolation variable names', () => {
      const valid = ['name', 'user_id', 'count123', '_private'];
      const invalid = validator.validateInterpolations(valid);
      expect(invalid).toHaveLength(0);
      
      const invalidVars = ['123start', 'dash-name', 'space name', 'special!char'];
      const invalidResults = validator.validateInterpolations(invalidVars);
      expect(invalidResults).toEqual(invalidVars);
    });

    test('should detect invalid interpolations in translations', async () => {
      // 一時的なテスト用翻訳ファイルを作成
      const testLocale = 'test';
      const testDir = path.join(__dirname, '../locales', testLocale);
      await fs.mkdir(testDir, { recursive: true });
      
      const testTranslations = {
        test: 'Invalid var: {{123invalid}} and {{valid-name}}'
      };
      
      await fs.writeFile(
        path.join(testDir, 'test.json'),
        JSON.stringify(testTranslations, null, 2)
      );
      
      // テスト用のバリデーターを作成
      const testValidator = new TranslationValidator();
      testValidator.supportedLocales = ['en', testLocale];
      
      try {
        // 特定のロケールを検証
        const baseTranslations = { test: { test: 'Test {{valid}}' } };
        const results = await testValidator.validateLocale(testLocale, baseTranslations);
        
        expect(results.errors).toHaveLength(1);
        expect(results.errors[0].type).toBe('invalid_interpolation');
        expect(results.errors[0].invalidVars).toContain('123invalid');
        expect(results.errors[0].invalidVars).toContain('valid-name');
      } finally {
        // クリーンアップ
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Empty Values Detection', () => {
    test('should detect empty values', async () => {
      // 一時的なテスト用翻訳ファイルを作成
      const testLocale = 'test-empty';
      const testDir = path.join(__dirname, '../locales', testLocale);
      await fs.mkdir(testDir, { recursive: true });
      
      const testTranslations = {
        filled: 'This has content',
        empty: '',
        whitespace: '   ',
        nested: {
          empty: '  '
        }
      };
      
      await fs.writeFile(
        path.join(testDir, 'test.json'),
        JSON.stringify(testTranslations, null, 2)
      );
      
      // テスト用のバリデーターを作成
      const testValidator = new TranslationValidator();
      testValidator.supportedLocales = ['en', testLocale];
      
      try {
        const baseTranslations = {
          test: {
            filled: 'Content',
            empty: 'Content',
            whitespace: 'Content',
            nested: { empty: 'Content' }
          }
        };
        
        const results = await testValidator.validateLocale(testLocale, baseTranslations);
        
        expect(results.summary.emptyValues).toBe(3); // empty, whitespace, nested.empty
        expect(results.warnings.filter(w => w.type === 'empty_value')).toHaveLength(3);
      } finally {
        // クリーンアップ
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Report Generation', () => {
    test('should format validation report correctly', () => {
      const results = {
        valid: false,
        errors: [
          {
            type: 'missing_key',
            locale: 'ja',
            namespace: 'common',
            key: 'test.key',
            message: 'Missing translation key: test.key'
          }
        ],
        warnings: [
          {
            type: 'empty_value',
            locale: 'ja',
            namespace: 'common',
            key: 'empty.key',
            message: 'Empty translation value'
          }
        ],
        summary: {
          totalKeys: 100,
          missingKeys: 1,
          extraKeys: 0,
          invalidInterpolations: 0,
          emptyValues: 1
        }
      };
      
      const report = validator.formatReport(results);
      
      expect(report).toContain('❌ INVALID');
      expect(report).toContain('Total keys: 100');
      expect(report).toContain('Missing keys: 1');
      expect(report).toContain('Errors (1):');
      expect(report).toContain('Warnings (1):');
    });

    test('should generate fix suggestions', () => {
      const results = {
        errors: [
          {
            type: 'missing_key',
            locale: 'ja',
            namespace: 'common',
            key: 'test.key'
          }
        ],
        warnings: [
          {
            type: 'empty_value',
            locale: 'ja',
            namespace: 'common',
            key: 'common.empty'
          }
        ],
        summary: {
          missingKeys: 1,
          extraKeys: 2,
          invalidInterpolations: 1,
          emptyValues: 1
        }
      };
      
      const fixes = validator.generateFixes(results);
      
      expect(fixes.missingKeys).toHaveProperty('ja');
      expect(fixes.missingKeys.ja.common).toContain('test.key');
      expect(fixes.emptyValues.ja.common).toContain('common.empty');
      expect(fixes.suggestions).toContain('Run translation sync to copy missing keys from the base locale');
    });
  });

  describe('URL Validation', () => {
    test('should check URL consistency', () => {
      const results = {
        warnings: [],
        summary: {}
      };
      
      // 有効なURL
      validator.checkConsistency(
        'Visit https://example.com for more info',
        'test.url',
        'en',
        'common',
        results
      );
      expect(results.warnings).toHaveLength(0);
      
      // 無効なURL
      validator.checkConsistency(
        'Visit https://[invalid] for more info',  // 無効な文字を含むURL
        'test.badurl',
        'en',
        'common',
        results
      );
      // 無効なURLとして警告が生成される
      expect(results.warnings).toHaveLength(1);
      expect(results.warnings[0].type).toBe('invalid_url');
      expect(results.warnings[0].value).toBe('https://[invalid]');
    });
  });

  describe('Integration with Current Files', () => {
    test('should validate actual translation files', async () => {
      const results = await validator.validateAll();
      
      // レポートを生成
      const report = validator.formatReport(results);
      
      // 現在のファイルは有効であるべき
      expect(results.valid).toBe(true);
      expect(report).toContain('✅ VALID');
      
      // 各名前空間が存在することを確認
      const loader = new TranslationLoader();
      const enTranslations = await loader.loadLocale('en');
      const jaTranslations = await loader.loadLocale('ja');
      
      expect(Object.keys(enTranslations)).toContain('common');
      expect(Object.keys(enTranslations)).toContain('commands');
      expect(Object.keys(enTranslations)).toContain('errors');
      expect(Object.keys(enTranslations)).toContain('messages');
      
      expect(Object.keys(jaTranslations)).toEqual(Object.keys(enTranslations));
    });
  });
});