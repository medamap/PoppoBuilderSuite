const i18next = require('i18next');
const Backend = require('i18next-fs-backend');
const path = require('path');
const fs = require('fs');

let instance = null;

class I18n {
  constructor() {
    if (instance) {
      return instance;
    }
    
    this.i18next = i18next.createInstance();
    this.initialized = false;
    instance = this;
  }

  async init(options = {}) {
    if (this.initialized) {
      return this.i18next;
    }

    const defaultOptions = {
      lng: options.language || process.env.POPPO_LANGUAGE || 'en',
      fallbackLng: 'en',
      backend: {
        loadPath: path.join(__dirname, 'locales/{{lng}}/{{ns}}.json')
      },
      ns: ['common', 'cli', 'dashboard', 'errors'],
      defaultNS: 'common',
      interpolation: {
        escapeValue: false
      },
      debug: process.env.NODE_ENV === 'development'
    };

    await this.i18next
      .use(Backend)
      .init({ ...defaultOptions, ...options });

    this.initialized = true;
    return this.i18next;
  }

  t(key, options) {
    if (!this.initialized) {
      console.warn('i18n not initialized, returning key:', key);
      return key;
    }
    return this.i18next.t(key, options);
  }

  changeLanguage(language) {
    if (!this.initialized) {
      console.warn('i18n not initialized');
      return;
    }
    return this.i18next.changeLanguage(language);
  }

  getCurrentLanguage() {
    if (!this.initialized) {
      return 'en';
    }
    return this.i18next.language;
  }

  // Helper method to get user's config language
  getUserLanguage() {
    const configPath = path.join(process.cwd(), '.poppo/config.json');
    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        return config.language?.primary || 'en';
      } catch (error) {
        // Ignore errors
      }
    }
    return process.env.POPPO_LANGUAGE || 'en';
  }
}

module.exports = new I18n();