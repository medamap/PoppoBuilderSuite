const { expect } = require('chai');
const sinon = require('sinon');
const i18n = require('../lib/i18n');

describe('i18n internationalization', () => {
  afterEach(() => {
    // Reset i18n state
    i18n.initialized = false;
  });

  it('should initialize with English by default', async () => {
    await i18n.init();
    expect(i18n.getCurrentLanguage()).to.equal('en');
  });

  it('should translate English strings', async () => {
    await i18n.init({ language: 'en' });
    expect(i18n.t('dashboard.disabled')).to.equal('Dashboard is disabled');
    expect(i18n.t('system.starting')).to.equal('PoppoBuilder Minimal Implementation Started');
  });

  it('should translate Japanese strings', async () => {
    await i18n.init({ language: 'ja' });
    expect(i18n.t('dashboard.disabled')).to.equal('ダッシュボードは無効化されています');
    expect(i18n.t('system.starting')).to.equal('PoppoBuilder 最小限実装 起動');
  });

  it('should handle interpolation', async () => {
    await i18n.init({ language: 'en' });
    expect(i18n.t('issue.processing', { number: 123, title: 'Test Issue' }))
      .to.equal('Processing issue #123: Test Issue');
  });

  it('should fall back to key if not initialized', () => {
    expect(i18n.t('dashboard.disabled')).to.equal('dashboard.disabled');
  });

  it('should change language dynamically', async () => {
    await i18n.init({ language: 'en' });
    expect(i18n.t('dashboard.disabled')).to.equal('Dashboard is disabled');
    
    await i18n.changeLanguage('ja');
    expect(i18n.t('dashboard.disabled')).to.equal('ダッシュボードは無効化されています');
  });
});