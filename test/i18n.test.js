const i18n = require('../lib/i18n');

describe('i18n internationalization', () => {
  afterEach(() => {
    // Reset i18n state
    i18n.initialized = false;
  });

  it('should initialize with English by default', async () => {
    await i18n.init();
    expect(i18n.getCurrentLanguage()).toBe('en');
  });

  it('should translate English strings', async () => {
    await i18n.init({ language: 'en' });
    expect(i18n.t('dashboard.disabled')).toBe('Dashboard is disabled');
    expect(i18n.t('system.starting')).toBe('PoppoBuilder Minimal Implementation Started');
  });

  it('should translate Japanese strings', async () => {
    await i18n.init({ language: 'ja' });
    expect(i18n.t('dashboard.disabled')).toBe('ダッシュボードは無効化されています');
    expect(i18n.t('system.starting')).toBe('PoppoBuilder 最小限実装 起動');
  });

  it('should handle interpolation', async () => {
    await i18n.init({ language: 'en' });
    expect(i18n.t('issue.processing', { number: 123, title: 'Test Issue' }))
      .toBe('Processing issue #123: Test Issue');
  });

  it('should fall back to key if not initialized', () => {
    expect(i18n.t('dashboard.disabled')).toBe('dashboard.disabled');
  });

  it('should change language dynamically', async () => {
    await i18n.init({ language: 'en' });
    expect(i18n.t('dashboard.disabled')).toBe('Dashboard is disabled');
    
    await i18n.changeLanguage('ja');
    expect(i18n.t('dashboard.disabled')).toBe('ダッシュボードは無効化されています');
  });
});