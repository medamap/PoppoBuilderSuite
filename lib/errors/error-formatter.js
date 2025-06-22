/**
 * Error Formatter
 * Formats error messages with i18n support and structured output
 */

const errorCatalog = require('./error-catalog');
const { t } = require('../i18n');

class ErrorFormatter {
  constructor() {
    this.defaultLocale = 'en';
  }

  /**
   * Format an error with code and context
   * @param {string} code - Error code
   * @param {Object} context - Context data for interpolation
   * @param {Object} options - Formatting options
   * @returns {Object} Formatted error
   */
  format(code, context = {}, options = {}) {
    const locale = options.locale || this.defaultLocale;
    const includeDetails = options.includeDetails !== false;
    const includeStack = options.includeStack === true;

    // Get error definition from catalog
    const errorDef = errorCatalog.getError(code, locale);
    
    if (!errorDef) {
      return this.formatUnknownError(code, context, locale);
    }

    // Interpolate message
    const message = this.interpolate(errorDef.message, context);
    
    const formatted = {
      code,
      message,
      timestamp: new Date().toISOString()
    };

    if (includeDetails) {
      if (errorDef.description) {
        formatted.description = this.interpolate(errorDef.description, context);
      }
      
      if (errorDef.solution) {
        formatted.solution = this.interpolate(errorDef.solution, context);
      }
      
      if (errorDef.link) {
        formatted.link = errorDef.link;
      }
      
      if (errorDef.category) {
        formatted.category = errorDef.category;
      }
    }

    if (includeStack && context.stack) {
      formatted.stack = context.stack;
    }

    return formatted;
  }

  /**
   * Format unknown error
   * @private
   */
  formatUnknownError(code, context, locale) {
    return {
      code: code || 'E000',
      message: t('errors:unknown', { code, ...context }) || `Unknown error: ${code}`,
      timestamp: new Date().toISOString(),
      category: 'unknown'
    };
  }

  /**
   * Interpolate variables in message
   * @private
   */
  interpolate(template, context) {
    if (!template) return '';
    
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return context[key] !== undefined ? context[key] : match;
    });
  }

  /**
   * Format error for console output
   * @param {string|Error|Object} error - Error to format
   * @param {Object} options - Formatting options
   * @returns {string} Console-friendly error message
   */
  formatForConsole(error, options = {}) {
    const useColor = options.color !== false && process.stdout.isTTY;
    const locale = options.locale || this.defaultLocale;

    let formatted;

    // Handle different error types
    if (typeof error === 'string') {
      // Error code
      formatted = this.format(error, {}, { locale, includeDetails: true });
    } else if (error instanceof Error) {
      // Error object with potential code
      const code = error.code || 'E000';
      formatted = this.format(code, {
        error: error.message,
        stack: error.stack
      }, { locale, includeDetails: true });
    } else if (error && typeof error === 'object') {
      // Pre-formatted error object
      formatted = error;
    } else {
      formatted = this.formatUnknownError('E000', {}, locale);
    }

    // Build console output
    const lines = [];

    if (useColor) {
      lines.push(`\x1b[31m[${formatted.code}]\x1b[0m ${formatted.message}`);
    } else {
      lines.push(`[${formatted.code}] ${formatted.message}`);
    }

    if (formatted.description) {
      lines.push(`  ${t('errors:description', { locale })}: ${formatted.description}`);
    }

    if (formatted.solution) {
      lines.push(`  ${t('errors:solution', { locale })}: ${formatted.solution}`);
    }

    if (formatted.link) {
      lines.push(`  ${t('errors:moreInfo', { locale })}: ${formatted.link}`);
    }

    return lines.join('\n');
  }

  /**
   * Format error for GitHub comment
   * @param {string|Error|Object} error - Error to format
   * @param {Object} options - Formatting options
   * @returns {string} GitHub-formatted error message
   */
  formatForGitHub(error, options = {}) {
    const locale = options.locale || this.defaultLocale;
    const includeDetails = options.includeDetails !== false;

    let formatted;

    // Handle different error types
    if (typeof error === 'string') {
      formatted = this.format(error, {}, { locale, includeDetails });
    } else if (error instanceof Error) {
      const code = error.code || 'E000';
      formatted = this.format(code, {
        error: error.message,
        stack: error.stack
      }, { locale, includeDetails });
    } else if (error && typeof error === 'object') {
      formatted = error;
    } else {
      formatted = this.formatUnknownError('E000', {}, locale);
    }

    // Build GitHub comment
    const lines = [
      `## ❌ ${t('errors:errorOccurred', { locale }) || 'Error Occurred'}`,
      '',
      `**${t('errors:errorCode', { locale }) || 'Error Code'}:** \`${formatted.code}\``,
      `**${t('errors:message', { locale }) || 'Message'}:** ${formatted.message}`,
      ''
    ];

    if (formatted.description) {
      lines.push(`### 📋 ${t('errors:description', { locale }) || 'Description'}`);
      lines.push(formatted.description);
      lines.push('');
    }

    if (formatted.solution) {
      lines.push(`### 💡 ${t('errors:solution', { locale }) || 'Solution'}`);
      lines.push(formatted.solution);
      lines.push('');
    }

    if (formatted.link) {
      lines.push(`### 🔗 ${t('errors:moreInfo', { locale }) || 'More Information'}`);
      lines.push(`[${t('errors:clickHere', { locale }) || 'Click here'}](${formatted.link})`);
      lines.push('');
    }

    if (formatted.stack && options.includeStack) {
      lines.push(`### 🔍 ${t('errors:stackTrace', { locale }) || 'Stack Trace'}`);
      lines.push('```');
      lines.push(formatted.stack);
      lines.push('```');
    }

    return lines.join('\n');
  }

  /**
   * Format error for JSON response
   * @param {string|Error|Object} error - Error to format
   * @param {Object} options - Formatting options
   * @returns {Object} JSON-formatted error
   */
  formatForJSON(error, options = {}) {
    const locale = options.locale || this.defaultLocale;

    if (typeof error === 'string') {
      return this.format(error, {}, { locale, includeDetails: true });
    } else if (error instanceof Error) {
      const code = error.code || 'E000';
      return this.format(code, {
        error: error.message,
        stack: error.stack,
        name: error.name
      }, { locale, includeDetails: true, includeStack: options.includeStack });
    } else if (error && typeof error === 'object') {
      return error;
    } else {
      return this.formatUnknownError('E000', {}, locale);
    }
  }

  /**
   * Create a formatted error object that can be thrown
   * @param {string} code - Error code
   * @param {Object} context - Context data
   * @param {Object} options - Options
   * @returns {Error} Error object with code and formatted message
   */
  createError(code, context = {}, options = {}) {
    const formatted = this.format(code, context, options);
    const error = new Error(formatted.message);
    error.code = code;
    error.formatted = formatted;
    
    return error;
  }
}

// Export singleton instance
module.exports = new ErrorFormatter();