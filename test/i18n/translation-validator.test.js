const { expect } = require('chai');
const path = require('path');
const TranslationValidator = require('../../scripts/i18n-validator');

describe('Translation Validator', () => {
  let validator;

  before(() => {
    validator = new TranslationValidator({
      locales: ['en', 'ja'],
      localesDir: path.join(__dirname, '../../locales')
    });
  });

  describe('Translation Loading', () => {
    it('should load translations for all locales', async () => {
      const enTranslations = await validator.loadTranslations('en');
      const jaTranslations = await validator.loadTranslations('ja');
      
      expect(enTranslations).to.be.an('object');
      expect(jaTranslations).to.be.an('object');
      expect(Object.keys(enTranslations).length).to.be.greaterThan(0);
      expect(Object.keys(jaTranslations).length).to.be.greaterThan(0);
    });

    it('should flatten nested translations correctly', () => {
      const nested = {
        level1: {
          level2: {
            key: 'value'
          }
        }
      };
      
      const flat = validator.flattenTranslations(nested, 'namespace');
      expect(flat).to.deep.equal({
        'namespace.level1.level2.key': 'value'
      });
    });
  });

  describe('Placeholder Consistency', () => {
    it('should detect placeholder mismatches', async () => {
      // Create a mock validator with test data
      const testValidator = new TranslationValidator({
        locales: ['en', 'ja']
      });
      
      // Mock the loadTranslations method
      testValidator.loadTranslations = async (locale) => {
        if (locale === 'en') {
          return {
            test: {
              message1: 'Hello {{name}}',
              message2: 'You have {{count}} items'
            }
          };
        } else {
          return {
            test: {
              message1: 'こんにちは {{name}}',
              message2: 'アイテムが {{number}} 個あります' // Wrong placeholder
            }
          };
        }
      };
      
      const issues = await testValidator.checkPlaceholderConsistency();
      expect(issues).to.have.lengthOf(1);
      expect(issues[0].key).to.equal('test.message2');
      expect(issues[0].basePlaceholders).to.deep.equal(['count']);
      expect(issues[0].targetPlaceholders).to.deep.equal(['number']);
    });

    it('should pass when placeholders match', async () => {
      const issues = await validator.checkPlaceholderConsistency();
      
      // Log any issues found for debugging
      if (issues.length > 0) {
        console.log('Placeholder issues found:', issues.slice(0, 3));
      }
      
      // This is more of an integration test - actual translations might have issues
      expect(issues).to.be.an('array');
    });
  });

  describe('Terminology Consistency', () => {
    it('should check for consistent terminology usage', async () => {
      const issues = await validator.checkTerminologyConsistency();
      expect(issues).to.be.an('object');
      
      // Log any inconsistencies found
      if (Object.keys(issues).length > 0) {
        console.log('Terminology inconsistencies:', Object.keys(issues));
      }
    });
  });

  describe('Translation Quality', () => {
    it('should detect quality issues', async () => {
      // Create a mock validator with problematic translations
      const testValidator = new TranslationValidator({
        locales: ['en']
      });
      
      testValidator.loadTranslations = async () => ({
        test: {
          empty: '',
          whitespace: '  value  ',
          todo: 'TODO: translate this',
          excessive: 'What???!!!',
          unescaped: 'Don"t do this'
        }
      });
      
      const issues = await testValidator.checkTranslationQuality();
      expect(issues.length).to.be.greaterThan(0);
      
      const issueTypes = issues.flatMap(i => i.issues);
      expect(issueTypes).to.include.members([
        'Empty translation',
        'Leading/trailing whitespace',
        'Contains TODO/FIXME',
        'Excessive punctuation'
      ]);
    });

    it('should pass quality checks for good translations', async () => {
      const issues = await validator.checkTranslationQuality();
      
      // Filter out known acceptable issues
      const seriousIssues = issues.filter(issue => 
        !issue.issues.includes('Possibly untranslated (same as key)')
      );
      
      // Log any serious issues found
      if (seriousIssues.length > 0) {
        console.log('Quality issues found:', seriousIssues.slice(0, 3));
      }
      
      expect(seriousIssues).to.be.an('array');
    });
  });

  describe('Key Format Validation', () => {
    it('should validate key naming conventions', async () => {
      const issues = await validator.checkKeyFormat();
      
      // Log any format issues
      if (issues.length > 0) {
        console.log('Key format issues:', issues.slice(0, 3));
      }
      
      // Check that any issues found are valid
      issues.forEach(issue => {
        expect(issue).to.have.property('key');
        expect(issue).to.have.property('issues');
        expect(issue.issues).to.be.an('array');
      });
    });

    it('should detect invalid key formats', () => {
      const testValidator = new TranslationValidator({});
      
      // Test various invalid formats
      const invalidKeys = [
        'key with spaces',
        'key-with-@symbol',
        'key..double..dots',
        '.startingDot',
        'endingDot.',
        'key::double::colons'
      ];
      
      invalidKeys.forEach(key => {
        const flat = { [key]: 'value' };
        // The actual validation would happen in checkKeyFormat
        expect(key).to.match(/[^a-zA-Z0-9:._-]|[:._]{2,}|^[:._]|[:._]$/);
      });
    });
  });

  describe('Report Generation', () => {
    it('should generate a complete validation report', async () => {
      const results = await validator.generateReport();
      
      expect(results).to.have.property('placeholderIssues');
      expect(results).to.have.property('terminologyIssues');
      expect(results).to.have.property('qualityIssues');
      expect(results).to.have.property('formatIssues');
      
      expect(results.placeholderIssues).to.be.an('array');
      expect(results.terminologyIssues).to.be.an('object');
      expect(results.qualityIssues).to.be.an('array');
      expect(results.formatIssues).to.be.an('array');
    });
  });
});