/**
 * Logger Factory
 * Creates logger instances with optional i18n support
 */

const Logger = require('../../src/logger');
const I18nLogger = require('./i18n-logger');

class LoggerFactory {
  /**
   * Create a logger instance
   * @param {string} category - Logger category or path
   * @param {Object} options - Logger options
   * @param {boolean} options.i18n - Enable i18n support
   * @returns {Logger|I18nLogger} Logger instance
   */
  static create(category = 'default', options = {}) {
    // Create base logger
    const baseLogger = new Logger(category, options);
    
    // Check if i18n is enabled
    const i18nEnabled = options.i18n !== false && 
                       process.env.POPPOBUILDER_I18N !== 'false';
    
    if (i18nEnabled) {
      // Wrap with i18n support
      return I18nLogger.wrap(baseLogger);
    }
    
    return baseLogger;
  }
  
  /**
   * Create a logger with i18n support (convenience method)
   */
  static createI18n(category = 'default', options = {}) {
    return this.create(category, { ...options, i18n: true });
  }
  
  /**
   * Create a logger without i18n support (convenience method)
   */
  static createPlain(category = 'default', options = {}) {
    return this.create(category, { ...options, i18n: false });
  }
}

module.exports = LoggerFactory;