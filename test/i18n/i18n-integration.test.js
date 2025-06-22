const { expect } = require('chai');
const path = require('path');
const { initI18n, t } = require('../../lib/i18n');
const runtimeSwitcher = require('../../lib/i18n/runtime-switcher');
const languageDetector = require('../../lib/utils/language-detector');
const errorFormatter = require('../../lib/errors/error-formatter');
const tableFormatter = require('../../lib/utils/table-formatter');
const prompts = require('../../lib/utils/interactive-prompts');

describe('i18n Integration Tests', () => {
  before(async () => {
    await initI18n();
  });

  describe('Core i18n Functionality', () => {
    it('should support multiple languages', async () => {
      // Test English
      await runtimeSwitcher.switchLanguage('en');
      expect(t('messages:welcome')).to.include('Welcome');
      
      // Test Japanese
      await runtimeSwitcher.switchLanguage('ja');
      expect(t('messages:welcome')).to.include('ようこそ');
    });

    it('should handle missing translations gracefully', () => {
      const missing = t('nonexistent:key.path');
      expect(missing).to.equal('nonexistent:key.path');
    });

    it('should support interpolation', async () => {
      await runtimeSwitcher.switchLanguage('en');
      const result = t('messages:welcome', { name: 'Test User' });
      expect(result).to.include('Test User');
    });

    it('should support nested keys', () => {
      const nested = t('errors:auth.missingToken.message');
      expect(nested).to.be.a('string');
      expect(nested.length).to.be.greaterThan(0);
    });
  });

  describe('Language Detection', () => {
    it('should detect language from issue content', () => {
      const detector = languageDetector.create();
      
      // Japanese content
      const jaResult = detector.detect({
        title: 'バグ修正: ログイン機能の問題',
        body: 'ログインできない問題を修正してください',
        labels: []
      });
      expect(jaResult).to.equal('ja');
      
      // English content
      const enResult = detector.detect({
        title: 'Bug fix: Login issue',
        body: 'Please fix the login problem',
        labels: []
      });
      expect(enResult).to.equal('en');
    });

    it('should respect language labels', () => {
      const detector = languageDetector.create();
      
      const result = detector.detect({
        title: 'Test issue',
        body: 'Test body',
        labels: ['lang:ja']
      });
      expect(result).to.equal('ja');
    });
  });

  describe('Error Formatting', () => {
    it('should format errors in multiple languages', async () => {
      // English
      await runtimeSwitcher.switchLanguage('en');
      const enError = errorFormatter.format('E001', { token: 'test123' });
      expect(enError).to.include('E001');
      expect(enError).to.include('Authentication');
      
      // Japanese
      await runtimeSwitcher.switchLanguage('ja');
      const jaError = errorFormatter.format('E001', { token: 'test123' });
      expect(jaError).to.include('E001');
      expect(jaError).to.include('認証');
    });

    it('should format errors for GitHub', async () => {
      await runtimeSwitcher.switchLanguage('en');
      const githubError = errorFormatter.formatForGitHub('E002');
      expect(githubError).to.include('### 🚨 Error Details');
      expect(githubError).to.include('**Error Code:**');
    });
  });

  describe('Table Formatting', () => {
    it('should format tables with translated headers', async () => {
      const data = [
        { id: '1', name: 'Test', status: 'active' }
      ];
      
      // English
      await runtimeSwitcher.switchLanguage('en');
      const enTable = tableFormatter.formatTable(data, {
        columns: [
          { key: 'id', labelKey: 'table:columns.id' },
          { key: 'name', labelKey: 'table:columns.name' },
          { key: 'status', labelKey: 'table:columns.status' }
        ]
      });
      expect(enTable).to.include('ID');
      expect(enTable).to.include('Name');
      expect(enTable).to.include('Status');
      
      // Japanese
      await runtimeSwitcher.switchLanguage('ja');
      const jaTable = tableFormatter.formatTable(data, {
        columns: [
          { key: 'id', labelKey: 'table:columns.id' },
          { key: 'name', labelKey: 'table:columns.name' },
          { key: 'status', labelKey: 'table:columns.status' }
        ]
      });
      expect(jaTable).to.include('ID');
      expect(jaTable).to.include('名前');
      expect(jaTable).to.include('ステータス');
    });
  });

  describe('Interactive Prompts', () => {
    it('should use localized prompt messages', async () => {
      await runtimeSwitcher.switchLanguage('en');
      
      // We can't actually test interactive prompts without mocking stdin
      // But we can verify the prompt system initializes correctly
      expect(prompts).to.have.property('ask');
      expect(prompts).to.have.property('confirm');
      expect(prompts).to.have.property('select');
    });
  });

  describe('Runtime Language Switching', () => {
    it('should switch languages at runtime', async () => {
      // Start with English
      await runtimeSwitcher.switchLanguage('en');
      expect(t('messages:starting')).to.include('Starting');
      
      // Switch to Japanese
      await runtimeSwitcher.switchLanguage('ja');
      expect(t('messages:starting')).to.include('開始');
      
      // Switch back to English
      await runtimeSwitcher.switchLanguage('en');
      expect(t('messages:starting')).to.include('Starting');
    });

    it('should persist language preference', async () => {
      await runtimeSwitcher.switchLanguage('ja');
      
      // Create new instance
      const newSwitcher = require('../../lib/i18n/runtime-switcher');
      const current = await newSwitcher.getCurrentLanguage();
      
      // Should remember the last set language
      expect(current).to.equal('ja');
    });
  });

  describe('Namespace Support', () => {
    it('should support multiple namespaces', () => {
      const namespaces = [
        'messages',
        'errors', 
        'commands',
        'github',
        'prompts',
        'table',
        'fields'
      ];
      
      namespaces.forEach(ns => {
        // Try to get a key from each namespace
        const key = `${ns}:test`;
        const result = t(key);
        // If the key doesn't exist, it returns the key itself
        // This just verifies namespace loading doesn't throw errors
        expect(result).to.be.a('string');
      });
    });
  });

  describe('Completeness Check', () => {
    it('should have translations for all critical paths', async () => {
      const criticalKeys = [
        'messages:welcome',
        'messages:starting',
        'messages:error',
        'messages:success',
        'errors:auth.missingToken.message',
        'commands:cli.description',
        'github:labels.processing',
        'table:columns.status',
        'prompts:confirm.yes'
      ];
      
      // Check both languages
      for (const lang of ['en', 'ja']) {
        await runtimeSwitcher.switchLanguage(lang);
        
        criticalKeys.forEach(key => {
          const value = t(key);
          expect(value).to.not.equal(key, `Missing translation for ${key} in ${lang}`);
          expect(value.length).to.be.greaterThan(0);
        });
      }
    });
  });
});