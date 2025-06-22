/**
 * Error Catalog
 * Centralized error code management system
 */

const path = require('path');
const fs = require('fs');

class ErrorCatalog {
  constructor() {
    this.errors = new Map();
    this.loaded = false;
  }

  /**
   * Load error definitions from catalog files
   * @param {string[]} locales - Supported locales
   */
  async load(locales = ['en', 'ja']) {
    if (this.loaded) return;

    for (const locale of locales) {
      // Load from error-codes.json (structured error codes)
      const errorCodesPath = path.join(__dirname, '../../locales', locale, 'error-codes.json');
      
      try {
        if (fs.existsSync(errorCodesPath)) {
          const catalog = JSON.parse(fs.readFileSync(errorCodesPath, 'utf-8'));
          
          for (const [code, data] of Object.entries(catalog)) {
            // Skip non-error entries (like labels)
            if (!code.match(/^E\d{3,4}$/)) continue;
            
            if (!this.errors.has(code)) {
              this.errors.set(code, {});
            }
            
            const errorDef = this.errors.get(code);
            errorDef[locale] = {
              message: data.message,
              description: data.description,
              solution: data.solution,
              link: data.link,
              category: data.category || 'general'
            };
          }
        }
      } catch (error) {
        console.error(`Failed to load error codes catalog for locale ${locale}:`, error);
      }
      
      // Also load from errors.json (existing format for backward compatibility)
      const catalogPath = path.join(__dirname, '../../locales', locale, 'errors.json');
      
      try {
        if (fs.existsSync(catalogPath)) {
          const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));
          
          // Process e-prefixed error codes (e1001, e2001, etc.)
          for (const [code, message] of Object.entries(catalog)) {
            if (code.match(/^e\d{4}$/)) {
              const errorCode = 'E' + code.substring(1).toUpperCase();
              
              if (!this.errors.has(errorCode)) {
                this.errors.set(errorCode, {});
              }
              
              const errorDef = this.errors.get(errorCode);
              if (!errorDef[locale]) {
                errorDef[locale] = {
                  message: typeof message === 'string' ? message : message.message,
                  category: this.getCategoryFromCode(errorCode)
                };
              }
            }
          }
        }
      } catch (error) {
        console.error(`Failed to load error catalog for locale ${locale}:`, error);
      }
    }

    this.loaded = true;
  }

  /**
   * Get category from error code
   * @private
   */
  getCategoryFromCode(code) {
    const prefix = code.substring(0, 2);
    const categoryMap = {
      'E0': 'auth',
      'E1': 'system',
      'E2': 'github',
      'E3': 'claude',
      'E4': 'task',
      'E5': 'agent',
      'E6': 'file',
      'E7': 'process',
      'E8': 'database',
      'E9': 'network'
    };
    return categoryMap[prefix] || 'general';
  }

  /**
   * Get error definition by code
   * @param {string} code - Error code (e.g., 'E001')
   * @param {string} locale - Locale
   * @returns {Object|null} Error definition
   */
  getError(code, locale = 'en') {
    if (!this.loaded) {
      throw new Error('Error catalog not loaded. Call load() first.');
    }

    const errorDef = this.errors.get(code);
    if (!errorDef) return null;

    return errorDef[locale] || errorDef['en'] || null;
  }

  /**
   * Register a new error dynamically
   * @param {string} code - Error code
   * @param {Object} definitions - Locale-based definitions
   */
  registerError(code, definitions) {
    this.errors.set(code, definitions);
  }

  /**
   * Get all error codes by category
   * @param {string} category - Category name
   * @param {string} locale - Locale
   * @returns {string[]} Error codes
   */
  getErrorsByCategory(category, locale = 'en') {
    const codes = [];
    
    for (const [code, def] of this.errors.entries()) {
      const localeDef = def[locale] || def['en'];
      if (localeDef && localeDef.category === category) {
        codes.push(code);
      }
    }
    
    return codes;
  }

  /**
   * Get all categories
   * @param {string} locale - Locale
   * @returns {string[]} Unique categories
   */
  getCategories(locale = 'en') {
    const categories = new Set();
    
    for (const def of this.errors.values()) {
      const localeDef = def[locale] || def['en'];
      if (localeDef && localeDef.category) {
        categories.add(localeDef.category);
      }
    }
    
    return Array.from(categories);
  }

  /**
   * Validate error code format
   * @param {string} code - Error code
   * @returns {boolean} Is valid
   */
  isValidCode(code) {
    // Expected format: E + 3-4 digits (e.g., E001, E1001)
    return /^E\d{3,4}$/.test(code);
  }

  /**
   * Generate next available error code for a category
   * @param {string} category - Category name
   * @returns {string} Next error code
   */
  generateNextCode(category) {
    const categoryPrefixes = {
      'auth': 'E1',
      'api': 'E2',
      'system': 'E3',
      'file': 'E4',
      'network': 'E5',
      'validation': 'E6',
      'config': 'E7',
      'agent': 'E8',
      'general': 'E9'
    };

    const prefix = categoryPrefixes[category] || 'E0';
    const existingCodes = Array.from(this.errors.keys())
      .filter(code => code.startsWith(prefix))
      .map(code => parseInt(code.substring(prefix.length)))
      .filter(num => !isNaN(num));

    const nextNum = existingCodes.length > 0 
      ? Math.max(...existingCodes) + 1 
      : 1;

    return `${prefix}${String(nextNum).padStart(3 - prefix.length + 1, '0')}`;
  }

  /**
   * Export catalog as JSON
   * @param {string} locale - Locale to export
   * @returns {Object} Catalog data
   */
  exportCatalog(locale = 'en') {
    const catalog = {};
    
    for (const [code, def] of this.errors.entries()) {
      const localeDef = def[locale];
      if (localeDef) {
        catalog[code] = {
          message: localeDef.message,
          description: localeDef.description,
          solution: localeDef.solution,
          link: localeDef.link,
          category: localeDef.category
        };
      }
    }
    
    return catalog;
  }

  /**
   * Search errors by keyword
   * @param {string} keyword - Search keyword
   * @param {string} locale - Locale
   * @returns {Array} Matching errors
   */
  search(keyword, locale = 'en') {
    const results = [];
    const lowerKeyword = keyword.toLowerCase();
    
    for (const [code, def] of this.errors.entries()) {
      const localeDef = def[locale] || def['en'];
      if (localeDef) {
        const searchText = [
          code,
          localeDef.message,
          localeDef.description,
          localeDef.category
        ].join(' ').toLowerCase();
        
        if (searchText.includes(lowerKeyword)) {
          results.push({ code, ...localeDef });
        }
      }
    }
    
    return results;
  }
}

// Export singleton instance
module.exports = new ErrorCatalog();