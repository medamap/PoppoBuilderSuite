/**
 * Runtime Language Switcher
 * Provides dynamic language switching functionality
 */

const i18nManager = require('./i18n-manager');
const path = require('path');
const fs = require('fs');

class RuntimeLanguageSwitcher {
  constructor() {
    this.defaultLanguage = 'en';
    this.sessionLanguage = null;
    this.initialized = false;
  }

  /**
   * Initialize the language system with dynamic switching support
   * @param {Object} options - Options including command line args
   * @returns {Promise<string>} The selected language
   */
  async initialize(options = {}) {
    if (this.initialized && !options.force) {
      return this.getCurrentLanguage();
    }

    // Priority order for language selection:
    // 1. Command line --lang option
    // 2. POPPOBUILDER_LANG environment variable
    // 3. Session-specific language (if set)
    // 4. Project config (.poppo/config.json)
    // 5. System default

    let selectedLanguage = null;

    // 1. Check command line option
    if (options.lang) {
      selectedLanguage = this.normalizeLanguageCode(options.lang);
    }

    // 2. Check environment variable
    if (!selectedLanguage && process.env.POPPOBUILDER_LANG) {
      selectedLanguage = this.normalizeLanguageCode(process.env.POPPOBUILDER_LANG);
    }

    // 3. Check session language
    if (!selectedLanguage && this.sessionLanguage) {
      selectedLanguage = this.sessionLanguage;
    }

    // 4. Check project config
    if (!selectedLanguage) {
      selectedLanguage = await this.getProjectLanguage();
    }

    // 5. Use default
    if (!selectedLanguage) {
      selectedLanguage = this.defaultLanguage;
    }

    // Validate the selected language
    if (!this.isSupported(selectedLanguage)) {
      console.warn(`Language '${selectedLanguage}' is not supported. Using default: ${this.defaultLanguage}`);
      selectedLanguage = this.defaultLanguage;
    }

    // Initialize i18n with the selected language
    await i18nManager.initialize({
      i18nextOptions: {
        lng: selectedLanguage
      }
    });

    this.initialized = true;
    return selectedLanguage;
  }

  /**
   * Switch language at runtime
   * @param {string} language - Language code
   * @returns {Promise<boolean>} Success status
   */
  async switchLanguage(language) {
    const normalizedLang = this.normalizeLanguageCode(language);
    
    if (!this.isSupported(normalizedLang)) {
      throw new Error(`Language '${language}' is not supported. Supported languages: ${this.getSupportedLanguages().join(', ')}`);
    }

    try {
      await i18nManager.changeLocale(normalizedLang);
      this.sessionLanguage = normalizedLang;
      return true;
    } catch (error) {
      console.error(`Failed to switch language to '${language}':`, error);
      return false;
    }
  }

  /**
   * Get current language
   * @returns {string} Current language code
   */
  getCurrentLanguage() {
    return i18nManager.getCurrentLocale();
  }

  /**
   * Set session language (persists for the current session)
   * @param {string} language - Language code
   */
  setSessionLanguage(language) {
    const normalizedLang = this.normalizeLanguageCode(language);
    if (this.isSupported(normalizedLang)) {
      this.sessionLanguage = normalizedLang;
    }
  }

  /**
   * Clear session language
   */
  clearSessionLanguage() {
    this.sessionLanguage = null;
  }

  /**
   * Get project language from config
   * @private
   * @returns {Promise<string|null>} Project language or null
   */
  async getProjectLanguage() {
    try {
      const configPath = path.join(process.cwd(), '.poppo/config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(await fs.promises.readFile(configPath, 'utf-8'));
        return config.language?.primary || null;
      }
    } catch (error) {
      // Ignore errors, will fall back to default
    }
    return null;
  }

  /**
   * Normalize language code
   * @private
   * @param {string} code - Language code
   * @returns {string} Normalized code
   */
  normalizeLanguageCode(code) {
    if (!code) return this.defaultLanguage;
    
    // Handle common variations
    const normalized = code.toLowerCase().trim();
    
    // Map variations to standard codes
    const mapping = {
      'japanese': 'ja',
      'jp': 'ja',
      'jpn': 'ja',
      'english': 'en',
      'eng': 'en',
      'us': 'en',
      'uk': 'en'
    };

    return mapping[normalized] || normalized.substring(0, 2);
  }

  /**
   * Check if language is supported
   * @param {string} language - Language code
   * @returns {boolean} Is supported
   */
  isSupported(language) {
    return this.getSupportedLanguages().includes(language);
  }

  /**
   * Get list of supported languages
   * @returns {string[]} Supported language codes
   */
  getSupportedLanguages() {
    return i18nManager.getSupportedLocales();
  }

  /**
   * Get language display name
   * @param {string} code - Language code
   * @param {string} displayLocale - Locale to display the name in
   * @returns {string} Display name
   */
  getLanguageDisplayName(code, displayLocale = null) {
    const currentLocale = displayLocale || this.getCurrentLanguage();
    
    const names = {
      en: {
        en: 'English',
        ja: 'Japanese'
      },
      ja: {
        en: '英語',
        ja: '日本語'
      }
    };

    return names[currentLocale]?.[code] || code;
  }

  /**
   * Parse command line arguments for language option
   * @param {string[]} argv - Command line arguments
   * @returns {Object} Parsed options including language
   */
  parseCommandLineArgs(argv = process.argv) {
    const options = {};
    
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === '--lang' || argv[i] === '-l') {
        if (i + 1 < argv.length) {
          options.lang = argv[i + 1];
          i++; // Skip next argument
        }
      }
    }

    return options;
  }

  /**
   * Get environment information
   * @returns {Object} Environment info
   */
  getEnvironmentInfo() {
    return {
      commandLineLanguage: this.parseCommandLineArgs().lang || null,
      environmentVariable: process.env.POPPOBUILDER_LANG || null,
      sessionLanguage: this.sessionLanguage,
      projectLanguage: null, // Will be loaded asynchronously
      currentLanguage: this.getCurrentLanguage(),
      supportedLanguages: this.getSupportedLanguages(),
      defaultLanguage: this.defaultLanguage
    };
  }

  /**
   * Create a CLI-friendly language selector
   * @returns {string} Language selector help text
   */
  getLanguageSelectorHelp() {
    const current = this.getCurrentLanguage();
    const supported = this.getSupportedLanguages();
    
    const lines = [
      'Language Options:',
      `  --lang, -l <code>    Set language (current: ${current})`,
      `  Supported: ${supported.join(', ')}`,
      '',
      'Environment:',
      '  POPPOBUILDER_LANG    Set default language via environment variable',
      '',
      'Examples:',
      '  poppobuilder status --lang ja',
      '  POPPOBUILDER_LANG=en poppobuilder list'
    ];

    return lines.join('\n');
  }
}

// Export singleton instance
module.exports = new RuntimeLanguageSwitcher();