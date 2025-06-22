/**
 * PoppoBuilder i18n (Internationalization) Module
 * 
 * This module provides internationalization support for PoppoBuilder Suite.
 * It exports all necessary functions and utilities for translating the application.
 * 
 * Basic usage:
 * ```javascript
 * const { t, tn, initI18n } = require('./lib/i18n');
 * 
 * // Initialize i18n
 * await initI18n();
 * 
 * // Use translations
 * console.log(t('general.welcome'));
 * console.log(tn('items.count', 5));
 * ```
 */

// Re-export everything from helpers
const helpers = require('./helpers');

// Re-export main components for advanced usage
const i18nManager = require('./i18n-manager');
const LocaleDetector = require('./locale-detector');
const TranslationLoader = require('./translation-loader');
const TranslationValidator = require('./translation-validator');

// Create a convenience object with all exports
const i18n = {
  // Helper functions
  ...helpers,
  
  // Components
  I18nManager: i18nManager,
  LocaleDetector,
  TranslationLoader,
  TranslationValidator,
  
  // Convenience aliases
  translate: helpers.t,
  translatePlural: helpers.tn,
  init: helpers.initI18n,
  
  // Singleton instance for global use
  instance: i18nManager
};

// Default export
module.exports = i18n;

// Named exports for ES6-style imports
module.exports.t = helpers.t;
module.exports.tn = helpers.tn;
module.exports.initI18n = helpers.initI18n;
module.exports.getCurrentLocale = helpers.getCurrentLocale;
module.exports.setLocale = helpers.setLocale;
module.exports.i18nManager = i18nManager;