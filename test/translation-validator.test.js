const { expect } = require('chai');
const sinon = require('sinon');
const TranslationValidator = require('../lib/i18n/translation-validator');
const TranslationLoader = require('../lib/i18n/translation-loader');
const fs = require('fs').promises;
const path = require('path');

describe('TranslationValidator Tests', () => {
  let validator;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    validator = new TranslationValidator();
  })

  afterEach(() => {
    sandbox.restore();
  });;

  describe('Basic Validation', () => {
    it('should validate all translation files successfully', async () => {
      const results = await validator.validateAll();
      
      // 現在の翻訳ファイルは有効であるべき
      expect(results.valid).to.equal(true);
      expect(results.errors).toHaveLength(0);
      
      // 基本的な統計を確認
      expect(results.summary.totalKeys).to.be.greaterThan(0);
      expect(results.summary.missingKeys).to.equal(0);
      expect(results.summary.invalidInterpolations).to.equal(0);
    });

    it('should count keys correctly', () => {
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
      expect(count).to.equal(4); // a, c, e, f
    });
  });

  describe('Missing Keys Detection', () => {
    it('should detect missing keys', () => {
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
      expect(missing).to.deep.equal(['nested.key3']);
    });

    it('should handle deeply nested missing keys', () => {
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
      expect(missing).to.deep.equal(['prefix.a.b.c']);
    });
  });

  describe('Extra Keys Detection', () => {
    it('should detect extra keys', () => {
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
      expect(extra).to.deep.equal(['key2', 'nested']);
    });
  });

  describe('Interpolation Validation', () => {
    it('should extract interpolations correctly', () => {
      const text = 'Hello {{name}}, you have {{count}} messages';
      const interpolations = validator.extractInterpolations(text);
      
      expect(interpolations).to.deep.equal(['name', 'count']);
    });

    it('should validate interpolation variable names', () => {
      const valid = ['name', 'user_id', 'count123', '_private'];
      const invalid = validator.validateInterpolations(valid);
      expect(invalid).toHaveLength(0);
      
      const invalidVars = ['123start', 'dash-name', 'space name', 'special!char'];
      const invalidResults = validator.validateInterpolations(invalidVars);
      expect(invalidResults).to.deep.equal(invalidVars);
    });

    it('should detect invalid interpolations in translations', async () => {
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
        expect(results.errors[0].type).to.equal('invalid_interpolation');
        expect(results.errors[0].invalidVars).to.include('123invalid');
        expect(results.errors[0].invalidVars).to.include('valid-name');
      } finally {
        // クリーンアップ
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Empty Values Detection', () => {
    it('should detect empty values', async () => {
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
        
        expect(results.summary.emptyValues).to.equal(3); // empty, whitespace, nested.empty
        expect(results.warnings.filter(w => w.type === 'empty_value')).toHaveLength(3);
      } finally {
        // クリーンアップ
        await fs.rm(testDir, { recursive: true, force: true });
      }
    });
  });

  describe('Report Generation', () => {
    it('should format validation report correctly', () => {
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
      
      expect(report).to.include('❌ INVALID');
      expect(report).to.include('Total keys: 100');
      expect(report).to.include('Missing keys: 1');
      expect(report).to.include('Errors (1):');
      expect(report).to.include('Warnings (1):');
    });

    it('should generate fix suggestions', () => {
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
      expect(fixes.missingKeys.ja.common).to.include('test.key');
      expect(fixes.emptyValues.ja.common).to.include('common.empty');
      expect(fixes.suggestions).to.include('Run translation sync to copy missing keys from the base locale');
    });
  });

  describe('URL Validation', () => {
    it('should check URL consistency', () => {
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
      expect(results.warnings[0].type).to.equal('invalid_url');
      expect(results.warnings[0].value).to.equal('https://[invalid]');
    });
  });

  describe('Integration with Current Files', () => {
    it('should validate actual translation files', async () => {
      const results = await validator.validateAll();
      
      // レポートを生成
      const report = validator.formatReport(results);
      
      // 現在のファイルは有効であるべき
      expect(results.valid).to.equal(true);
      expect(report).to.include('✅ VALID');
      
      // 各名前空間が存在することを確認
      const loader = new TranslationLoader();
      const enTranslations = await loader.loadLocale('en');
      const jaTranslations = await loader.loadLocale('ja');
      
      expect(Object.keys(enTranslations)).to.include('common');
      expect(Object.keys(enTranslations)).to.include('commands');
      expect(Object.keys(enTranslations)).to.include('errors');
      expect(Object.keys(enTranslations)).to.include('messages');
      
      expect(Object.keys(jaTranslations)).to.deep.equal(Object.keys(enTranslations));
    });
  });
});