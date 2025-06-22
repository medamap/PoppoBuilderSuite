const { expect } = require('chai');
const sinon = require('sinon');
const {
  t,
  tn,
  getNamespacedT,
  buildKey,
  hasTranslation,
  tWithFallback,
  tFirst,
  tIf,
  tList,
  interpolate,
  tRelativeTime,
  tError,
  tStatus,
  tNotification,
  tNumber,
  tDate,
  getCurrentLocale,
  setLocale,
  getSupportedLocales,
  initI18n
} = require('../lib/i18n');

describe('i18n Helpers Tests', () => {
  before(async () => {
    // 初期化
    await initI18n({ cliLocale: 'en' });
  });

  describe('Basic Translation Functions', () => {
    it('t() should translate simple keys', () => {
      expect(t('general.yes')).to.equal('Yes');
      expect(t('general.no')).to.equal('No');
    });

    it('t() should handle interpolation', () => {
      expect(t('time.ago', { time: '5 minutes' })).to.equal('5 minutes ago');
      expect(t('messages:issue.processing', { number: 123, title: 'Test' })).to.equal('Processing issue #123: Test');
    });

    it('t() should return key when translation not found', () => {
      const nonExistentKey = 'this.key.does.not.exist';
      expect(t(nonExistentKey)).to.equal(nonExistentKey);
    });

    it('tn() should handle pluralization', () => {
      expect(t('time.seconds', { count: 1 })).to.equal('1 second');
      expect(t('time.seconds', { count: 2 })).to.equal('2 seconds');
      expect(t('time.minutes', { count: 1 })).to.equal('1 minute');
      expect(t('time.minutes', { count: 5 })).to.equal('5 minutes');
    });
  });

  describe('Utility Functions', () => {
    it('getNamespacedT() should create namespaced translator', () => {
      const tErrors = getNamespacedT('errors');
      expect(tErrors('general.unknown')).to.equal('An unknown error occurred');
      expect(tErrors('file.notFound')).to.equal('File not found: {{path}}');
    });

    it('buildKey() should build translation keys', () => {
      expect(buildKey('errors', 'file', 'notFound')).to.equal('errors.file.notFound');
      expect(buildKey('common', null, 'test')).to.equal('common.test');
      expect(buildKey('', 'test', '')).to.equal('test');
    });

    it('hasTranslation() should check key existence', () => {
      expect(hasTranslation('general.yes')).to.equal(true);
      expect(hasTranslation('non.existent.key')).to.equal(false);
    });

    it('tWithFallback() should use fallback when key not found', () => {
      expect(tWithFallback('general.yes', 'Fallback')).to.equal('Yes');
      expect(tWithFallback('non.existent', 'Fallback')).to.equal('Fallback');
      
      // フォールバックでも補間が動作
      expect(tWithFallback('non.existent', 'Hello {{name}}', { name: 'World' }))
        .to.equal('Hello World');
    });

    it('tFirst() should return first available translation', () => {
      expect(tFirst(['non.existent', 'general.yes', 'general.no'])).to.equal('Yes');
      expect(tFirst(['non.existent.1', 'non.existent.2'])).to.equal('non.existent.2');
    });

    it('tIf() should translate conditionally', () => {
      expect(tIf(true, 'general.yes', 'general.no')).to.equal('Yes');
      expect(tIf(false, 'general.yes', 'general.no')).to.equal('No');
    });

    it('interpolate() should handle string interpolation', () => {
      expect(interpolate('Hello {{name}}!', { name: 'World' })).to.equal('Hello World!');
      expect(interpolate('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 }))
        .to.equal('1 + 2 = 3');
      expect(interpolate('No vars here', { unused: 'value' })).to.equal('No vars here');
    });
  });

  describe('Specialized Functions', () => {
    it('tRelativeTime() should format relative time', () => {
      const now = Date.now();
      
      // 30 seconds ago
      expect(tRelativeTime(now - 30 * 1000)).to.equal('30 seconds ago');
      
      // 5 minutes ago
      expect(tRelativeTime(now - 5 * 60 * 1000)).to.equal('5 minutes ago');
      
      // 2 hours ago
      expect(tRelativeTime(now - 2 * 60 * 60 * 1000)).to.equal('2 hours ago');
      
      // 3 days ago
      expect(tRelativeTime(now - 3 * 24 * 60 * 60 * 1000)).to.equal('3 days ago');
    });

    it('tError() should translate error messages', () => {
      // String error code
      expect(tError('errors:general.unknown')).to.equal('An unknown error occurred');
      
      // Unknown error
      const unknownError = new Error('Unknown error');
      expect(tError(unknownError)).to.equal('An unknown error occurred');
    });

    it('tStatus() should translate status messages', () => {
      expect(tStatus('pending')).to.equal('Pending');
      expect(tStatus('completed')).to.equal('Completed');
      expect(tStatus('unknown_status')).to.equal('unknown_status'); // Fallback to status code
    });

    it('tNotification() should format notification messages', () => {
      expect(tNotification('info', 'Test message')).to.equal('ℹ️ Test message');
      expect(tNotification('success', 'general.success')).to.equal('✅ Success');
      expect(tNotification('error', 'Operation failed')).to.equal('❌ Operation failed');
    });
  });

  describe('Formatting Functions', () => {
    it('tNumber() should format numbers', () => {
      const formatted = tNumber(1234567.89);
      expect(formatted).to.match(/1,234,567/); // Locale-dependent decimal handling
    });

    it('tDate() should format dates', () => {
      const date = new Date('2024-06-20T12:00:00');
      const formatted = tDate(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      expect(formatted).to.match(/2024/);
      expect(formatted).to.match(/06/);
      expect(formatted).to.match(/20/);
    });
  });

  describe('Locale Management', () => {
    it('getCurrentLocale() should return current locale', () => {
      expect(getCurrentLocale()).to.equal('en');
    });

    it('getSupportedLocales() should return supported locales', () => {
      const locales = getSupportedLocales();
      expect(locales).to.include('en');
      expect(locales).to.include('ja');
    });

    it('setLocale() should change locale', async () => {
      await setLocale('ja');
      expect(getCurrentLocale()).to.equal('ja');
      expect(t('general.yes')).to.equal('はい');
      
      // 元に戻す
      await setLocale('en');
      expect(getCurrentLocale()).to.equal('en');
      expect(t('general.yes')).to.equal('Yes');
    });
  });

  describe('Japanese Locale Tests', () => {
    before(async () => {
      await setLocale('ja');
    });

    after(async () => {
      await setLocale('en');
    });

    it('should translate to Japanese', () => {
      expect(t('general.save')).to.equal('保存');
      expect(t('status.processing')).to.equal('処理中');
      expect(t('commands:start.starting')).to.equal('PoppoBuilderを起動しています...');
    });

    it('should handle Japanese pluralization', () => {
      // 日本語では単数・複数の区別がない
      expect(t('time.days', { count: 1 })).to.equal('1日');
      expect(t('time.days', { count: 5 })).to.equal('5日');
    });

    it('should format Japanese dates', () => {
      const date = new Date('2024-06-20');
      const formatted = tDate(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      // 日本語ロケールでは年月日の順
      expect(formatted).to.match(/2024/);
    });
  });

  describe('Module Exports', () => {
    it('should export from index.js', () => {
      const i18n = require('../lib/i18n/index');
      
      expect(i18n.t).to.exist;
      expect(i18n.tn).to.exist;
      expect(i18n.initI18n).to.exist;
      expect(i18n.I18nManager).to.exist;
      expect(i18n.LocaleDetector).to.exist;
      expect(i18n.TranslationLoader).to.exist;
      expect(i18n.TranslationValidator).to.exist;
    });
  });
});