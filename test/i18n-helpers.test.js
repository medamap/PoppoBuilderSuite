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
  beforeAll(async () => {
    // 初期化
    await initI18n({ cliLocale: 'en' });
  });

  describe('Basic Translation Functions', () => {
    test('t() should translate simple keys', () => {
      expect(t('general.yes')).toBe('Yes');
      expect(t('general.no')).toBe('No');
    });

    test('t() should handle interpolation', () => {
      expect(t('time.ago', { time: '5 minutes' })).toBe('5 minutes ago');
      expect(t('messages:issue.processing', { number: 123, title: 'Test' })).toBe('Processing issue #123: Test');
    });

    test('t() should return key when translation not found', () => {
      const nonExistentKey = 'this.key.does.not.exist';
      expect(t(nonExistentKey)).toBe(nonExistentKey);
    });

    test('tn() should handle pluralization', () => {
      expect(t('time.seconds', { count: 1 })).toBe('1 second');
      expect(t('time.seconds', { count: 2 })).toBe('2 seconds');
      expect(t('time.minutes', { count: 1 })).toBe('1 minute');
      expect(t('time.minutes', { count: 5 })).toBe('5 minutes');
    });
  });

  describe('Utility Functions', () => {
    test('getNamespacedT() should create namespaced translator', () => {
      const tErrors = getNamespacedT('errors');
      expect(tErrors('general.unknown')).toBe('An unknown error occurred');
      expect(tErrors('file.notFound')).toBe('File not found: {{path}}');
    });

    test('buildKey() should build translation keys', () => {
      expect(buildKey('errors', 'file', 'notFound')).toBe('errors.file.notFound');
      expect(buildKey('common', null, 'test')).toBe('common.test');
      expect(buildKey('', 'test', '')).toBe('test');
    });

    test('hasTranslation() should check key existence', () => {
      expect(hasTranslation('general.yes')).toBe(true);
      expect(hasTranslation('non.existent.key')).toBe(false);
    });

    test('tWithFallback() should use fallback when key not found', () => {
      expect(tWithFallback('general.yes', 'Fallback')).toBe('Yes');
      expect(tWithFallback('non.existent', 'Fallback')).toBe('Fallback');
      
      // フォールバックでも補間が動作
      expect(tWithFallback('non.existent', 'Hello {{name}}', { name: 'World' }))
        .toBe('Hello World');
    });

    test('tFirst() should return first available translation', () => {
      expect(tFirst(['non.existent', 'general.yes', 'general.no'])).toBe('Yes');
      expect(tFirst(['non.existent.1', 'non.existent.2'])).toBe('non.existent.2');
    });

    test('tIf() should translate conditionally', () => {
      expect(tIf(true, 'general.yes', 'general.no')).toBe('Yes');
      expect(tIf(false, 'general.yes', 'general.no')).toBe('No');
    });

    test('interpolate() should handle string interpolation', () => {
      expect(interpolate('Hello {{name}}!', { name: 'World' })).toBe('Hello World!');
      expect(interpolate('{{a}} + {{b}} = {{c}}', { a: 1, b: 2, c: 3 }))
        .toBe('1 + 2 = 3');
      expect(interpolate('No vars here', { unused: 'value' })).toBe('No vars here');
    });
  });

  describe('Specialized Functions', () => {
    test('tRelativeTime() should format relative time', () => {
      const now = Date.now();
      
      // 30 seconds ago
      expect(tRelativeTime(now - 30 * 1000)).toBe('30 seconds ago');
      
      // 5 minutes ago
      expect(tRelativeTime(now - 5 * 60 * 1000)).toBe('5 minutes ago');
      
      // 2 hours ago
      expect(tRelativeTime(now - 2 * 60 * 60 * 1000)).toBe('2 hours ago');
      
      // 3 days ago
      expect(tRelativeTime(now - 3 * 24 * 60 * 60 * 1000)).toBe('3 days ago');
    });

    test('tError() should translate error messages', () => {
      // String error code
      expect(tError('errors:general.unknown')).toBe('An unknown error occurred');
      
      // Unknown error
      const unknownError = new Error('Unknown error');
      expect(tError(unknownError)).toBe('An unknown error occurred');
    });

    test('tStatus() should translate status messages', () => {
      expect(tStatus('pending')).toBe('Pending');
      expect(tStatus('completed')).toBe('Completed');
      expect(tStatus('unknown_status')).toBe('unknown_status'); // Fallback to status code
    });

    test('tNotification() should format notification messages', () => {
      expect(tNotification('info', 'Test message')).toBe('ℹ️ Test message');
      expect(tNotification('success', 'general.success')).toBe('✅ Success');
      expect(tNotification('error', 'Operation failed')).toBe('❌ Operation failed');
    });
  });

  describe('Formatting Functions', () => {
    test('tNumber() should format numbers', () => {
      const formatted = tNumber(1234567.89);
      expect(formatted).toMatch(/1,234,567/); // Locale-dependent decimal handling
    });

    test('tDate() should format dates', () => {
      const date = new Date('2024-06-20T12:00:00');
      const formatted = tDate(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      expect(formatted).toMatch(/2024/);
      expect(formatted).toMatch(/06/);
      expect(formatted).toMatch(/20/);
    });
  });

  describe('Locale Management', () => {
    test('getCurrentLocale() should return current locale', () => {
      expect(getCurrentLocale()).toBe('en');
    });

    test('getSupportedLocales() should return supported locales', () => {
      const locales = getSupportedLocales();
      expect(locales).toContain('en');
      expect(locales).toContain('ja');
    });

    test('setLocale() should change locale', async () => {
      await setLocale('ja');
      expect(getCurrentLocale()).toBe('ja');
      expect(t('general.yes')).toBe('はい');
      
      // 元に戻す
      await setLocale('en');
      expect(getCurrentLocale()).toBe('en');
      expect(t('general.yes')).toBe('Yes');
    });
  });

  describe('Japanese Locale Tests', () => {
    beforeAll(async () => {
      await setLocale('ja');
    });

    afterAll(async () => {
      await setLocale('en');
    });

    test('should translate to Japanese', () => {
      expect(t('general.save')).toBe('保存');
      expect(t('status.processing')).toBe('処理中');
      expect(t('commands:start.starting')).toBe('PoppoBuilderを起動しています...');
    });

    test('should handle Japanese pluralization', () => {
      // 日本語では単数・複数の区別がない
      expect(t('time.days', { count: 1 })).toBe('1日');
      expect(t('time.days', { count: 5 })).toBe('5日');
    });

    test('should format Japanese dates', () => {
      const date = new Date('2024-06-20');
      const formatted = tDate(date, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      // 日本語ロケールでは年月日の順
      expect(formatted).toMatch(/2024/);
    });
  });

  describe('Module Exports', () => {
    test('should export from index.js', () => {
      const i18n = require('../lib/i18n/index');
      
      expect(i18n.t).toBeDefined();
      expect(i18n.tn).toBeDefined();
      expect(i18n.initI18n).toBeDefined();
      expect(i18n.I18nManager).toBeDefined();
      expect(i18n.LocaleDetector).toBeDefined();
      expect(i18n.TranslationLoader).toBeDefined();
      expect(i18n.TranslationValidator).toBeDefined();
    });
  });
});