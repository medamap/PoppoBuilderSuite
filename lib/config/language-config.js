/**
 * Language Configuration Manager
 * Manages language settings across global, project, and runtime levels
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { EventEmitter } = require('events');

class LanguageConfigManager extends EventEmitter {
  constructor() {
    super();
    this.globalConfigPath = path.join(os.homedir(), '.poppobuilder', 'config.json');
    this.projectConfigPath = path.join(process.cwd(), '.poppobuilder', 'config.json');
    this.defaultLanguage = 'en';
    this.supportedLanguages = ['en', 'ja'];
    this.languageCache = null;
  }

  /**
   * Get current language with priority order:
   * 1. Runtime override (CLI flag)
   * 2. Environment variable
   * 3. Project config
   * 4. Global config
   * 5. System locale
   * 6. Default (en)
   */
  async getCurrentLanguage(runtimeOverride = null) {
    // 1. Runtime override
    if (runtimeOverride && this.supportedLanguages.includes(runtimeOverride)) {
      return runtimeOverride;
    }

    // 2. Environment variable
    const envLang = process.env.POPPOBUILDER_LANG || process.env.POPPO_LANG;
    if (envLang && this.supportedLanguages.includes(envLang)) {
      return envLang;
    }

    // 3. Project config
    try {
      const projectConfig = await this.loadConfig(this.projectConfigPath);
      if (projectConfig.language && this.supportedLanguages.includes(projectConfig.language)) {
        return projectConfig.language;
      }
    } catch (error) {
      // Project config not found or invalid
    }

    // 4. Global config
    try {
      const globalConfig = await this.loadConfig(this.globalConfigPath);
      if (globalConfig.language && this.supportedLanguages.includes(globalConfig.language)) {
        return globalConfig.language;
      }
    } catch (error) {
      // Global config not found or invalid
    }

    // 5. System locale
    const systemLocale = this.getSystemLanguage();
    if (systemLocale && this.supportedLanguages.includes(systemLocale)) {
      return systemLocale;
    }

    // 6. Default
    return this.defaultLanguage;
  }

  /**
   * Set language in config file
   * @param {string} language - Language code (en, ja)
   * @param {Object} options - { global: boolean, project: boolean }
   */
  async setLanguage(language, options = {}) {
    if (!this.supportedLanguages.includes(language)) {
      throw new Error(`Unsupported language: ${language}. Supported: ${this.supportedLanguages.join(', ')}`);
    }

    const configPath = options.global ? this.globalConfigPath : this.projectConfigPath;
    
    // Ensure directory exists
    await this.ensureDirectory(path.dirname(configPath));

    // Load existing config
    let config = {};
    try {
      config = await this.loadConfig(configPath);
    } catch (error) {
      // Config doesn't exist, create new
    }

    // Update language settings
    config.language = language;
    config.locale = this.getLocaleForLanguage(language);

    // Save config
    await this.saveConfig(configPath, config);

    // Clear cache
    this.languageCache = null;

    // Emit event
    this.emit('languageChanged', {
      language,
      scope: options.global ? 'global' : 'project',
      path: configPath
    });

    return {
      language,
      locale: config.locale,
      scope: options.global ? 'global' : 'project',
      path: configPath
    };
  }

  /**
   * Get language settings from all levels
   */
  async getLanguageHierarchy() {
    const hierarchy = {
      runtime: process.env.POPPOBUILDER_LANG || null,
      project: null,
      global: null,
      system: this.getSystemLanguage(),
      default: this.defaultLanguage
    };

    // Try to load project config
    try {
      const projectConfig = await this.loadConfig(this.projectConfigPath);
      if (projectConfig.language) {
        hierarchy.project = {
          language: projectConfig.language,
          locale: projectConfig.locale,
          path: this.projectConfigPath
        };
      }
    } catch (error) {
      // Ignore
    }

    // Try to load global config
    try {
      const globalConfig = await this.loadConfig(this.globalConfigPath);
      if (globalConfig.language) {
        hierarchy.global = {
          language: globalConfig.language,
          locale: globalConfig.locale,
          path: this.globalConfigPath
        };
      }
    } catch (error) {
      // Ignore
    }

    return hierarchy;
  }

  /**
   * Get system language from environment
   */
  getSystemLanguage() {
    const locale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || '';
    
    // Extract language code from locale (e.g., en_US.UTF-8 -> en)
    const match = locale.match(/^([a-z]{2})/i);
    if (match) {
      const lang = match[1].toLowerCase();
      return this.supportedLanguages.includes(lang) ? lang : null;
    }
    
    return null;
  }

  /**
   * Get locale string for language
   */
  getLocaleForLanguage(language) {
    const localeMap = {
      'en': 'en-US',
      'ja': 'ja-JP'
    };
    return localeMap[language] || 'en-US';
  }

  /**
   * Load config from file
   */
  async loadConfig(configPath) {
    const content = await fs.readFile(configPath, 'utf8');
    return JSON.parse(content);
  }

  /**
   * Save config to file
   */
  async saveConfig(configPath, config) {
    const content = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, content, 'utf8');
  }

  /**
   * Ensure directory exists
   */
  async ensureDirectory(dir) {
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Check if config file exists
   */
  async configExists(configPath) {
    try {
      await fs.access(configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get supported languages
   */
  getSupportedLanguages() {
    return [...this.supportedLanguages];
  }

  /**
   * Add support for a new language
   */
  addSupportedLanguage(language) {
    if (!this.supportedLanguages.includes(language)) {
      this.supportedLanguages.push(language);
    }
  }

  /**
   * Clear language cache
   */
  clearCache() {
    this.languageCache = null;
  }
}

// Export singleton instance
let instance = null;

module.exports = {
  /**
   * Get language config manager instance
   */
  getInstance() {
    if (!instance) {
      instance = new LanguageConfigManager();
    }
    return instance;
  },

  /**
   * Reset instance (for testing)
   */
  resetInstance() {
    instance = null;
  },

  LanguageConfigManager
};