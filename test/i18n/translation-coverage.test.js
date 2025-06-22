const { expect } = require('chai');
const path = require('path');
const TranslationCoverageChecker = require('../../scripts/i18n-coverage');

describe('Translation Coverage', () => {
  let checker;

  before(() => {
    checker = new TranslationCoverageChecker({
      baseLocale: 'en',
      targetLocales: ['ja'],
      localesDir: path.join(__dirname, '../../locales')
    });
  });

  describe('Key Extraction', () => {
    it('should extract all translation keys from base locale', async () => {
      const keys = await checker.getAllTranslationKeys();
      expect(keys).to.be.instanceof(Set);
      expect(keys.size).to.be.greaterThan(0);
      
      // Check for expected namespaces
      const namespaces = new Set();
      keys.forEach(key => {
        const namespace = key.split(':')[0];
        namespaces.add(namespace);
      });
      
      expect(namespaces).to.include.members(['messages', 'errors', 'commands']);
    });

    it('should handle nested translation objects', () => {
      const keys = new Set();
      const obj = {
        level1: {
          level2: {
            level3: 'value'
          },
          simple: 'value'
        }
      };
      
      checker.extractKeys(obj, 'test', keys);
      
      expect(keys).to.include('test:level1.level2.level3');
      expect(keys).to.include('test:level1.simple');
    });
  });

  describe('Coverage Calculation', () => {
    it('should calculate coverage percentage correctly', async () => {
      const allKeys = await checker.getAllTranslationKeys();
      const result = await checker.checkLocaleTranslations('ja', allKeys);
      
      expect(result).to.have.property('total');
      expect(result).to.have.property('translated');
      expect(result).to.have.property('missing');
      expect(result).to.have.property('coverage');
      expect(result).to.have.property('missingKeys');
      
      expect(result.total).to.equal(allKeys.size);
      expect(result.translated + result.missing).to.equal(result.total);
      expect(parseFloat(result.coverage)).to.be.within(0, 100);
    });
  });

  describe('Missing Keys Detection', () => {
    it('should identify missing translation keys', async () => {
      const allKeys = await checker.getAllTranslationKeys();
      const result = await checker.checkLocaleTranslations('ja', allKeys);
      
      expect(result.missingKeys).to.be.an('array');
      
      // If there are missing keys, they should be valid key format
      result.missingKeys.forEach(key => {
        expect(key).to.match(/^[a-z]+:[a-zA-Z0-9._]+$/);
      });
    });
  });

  describe('Report Generation', () => {
    it('should generate a complete coverage report', async () => {
      // This test just ensures the report runs without errors
      await expect(checker.generateReport()).to.be.fulfilled;
    });
  });

  describe('Coverage Targets', () => {
    it('should have acceptable coverage for production', async () => {
      const allKeys = await checker.getAllTranslationKeys();
      const result = await checker.checkLocaleTranslations('ja', allKeys);
      
      // Set minimum coverage target
      const MIN_COVERAGE = 80; // 80% minimum coverage
      
      expect(parseFloat(result.coverage)).to.be.at.least(
        MIN_COVERAGE,
        `Translation coverage for 'ja' is below ${MIN_COVERAGE}%. Missing keys: ${result.missingKeys.slice(0, 5).join(', ')}...`
      );
    });
  });
});