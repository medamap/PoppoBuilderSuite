/**
 * PoppoError - Enhanced Error Class with i18n Support
 * Provides structured error handling with automatic message translation
 */

const { ERROR_CODES, getErrorMetadata } = require('./error-codes');
const { t } = require('../i18n');

class PoppoError extends Error {
  /**
   * Create a PoppoError instance
   * @param {string} code - Error code from ERROR_CODES
   * @param {string|Object} messageOrData - Message key/string or interpolation data
   * @param {Object} data - Additional data for interpolation (if messageOrData is string)
   * @param {Error} cause - Original error that caused this error
   */
  constructor(code, messageOrData = {}, data = {}, cause = null) {
    // Determine message and interpolation data
    let messageKey;
    let interpolationData;
    
    if (typeof messageOrData === 'string') {
      messageKey = messageOrData;
      interpolationData = data;
    } else {
      // If messageOrData is object, use it as interpolation data
      messageKey = `errors:${code.toLowerCase()}`;
      interpolationData = messageOrData;
    }

    // Try to get translated message
    let message;
    try {
      message = t(messageKey, interpolationData);
      // If translation key not found, fallback to error code
      if (message === messageKey) {
        message = `${code}: ${messageKey}`;
      }
    } catch (translationError) {
      // Fallback if i18n is not available
      message = `${code}: ${messageKey}`;
    }

    super(message);

    // Set error properties
    this.name = 'PoppoError';
    this.code = code;
    this.messageKey = messageKey;
    this.data = interpolationData;
    this.cause = cause;
    this.timestamp = new Date().toISOString();

    // Get error metadata
    const metadata = getErrorMetadata(code);
    this.category = metadata.category;
    this.severity = metadata.severity;
    this.recoverable = metadata.recoverable;
    this.retryable = metadata.retryable;

    // Capture stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, PoppoError);
    }

    // Include cause stack trace if available
    if (cause && cause.stack) {
      this.stack = `${this.stack}\nCaused by: ${cause.stack}`;
    }
  }

  /**
   * Get translated message in specific language
   * @param {string} locale - Target locale (e.g., 'en', 'ja')
   * @returns {string} Translated message
   */
  getLocalizedMessage(locale = null) {
    try {
      return t(this.messageKey, this.data, locale);
    } catch (error) {
      return this.message;
    }
  }

  /**
   * Check if this error should be retried
   * @returns {boolean}
   */
  isRetryable() {
    return this.retryable;
  }

  /**
   * Check if this error is recoverable
   * @returns {boolean}
   */
  isRecoverable() {
    return this.recoverable;
  }

  /**
   * Get error severity level
   * @returns {string}
   */
  getSeverity() {
    return this.severity;
  }

  /**
   * Get error category
   * @returns {string}
   */
  getCategory() {
    return this.category;
  }

  /**
   * Convert error to JSON for logging/serialization
   * @returns {Object}
   */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      messageKey: this.messageKey,
      data: this.data,
      category: this.category,
      severity: this.severity,
      recoverable: this.recoverable,
      retryable: this.retryable,
      timestamp: this.timestamp,
      stack: this.stack,
      cause: this.cause ? {
        name: this.cause.name,
        message: this.cause.message,
        stack: this.cause.stack
      } : null
    };
  }

  /**
   * Convert error to string representation
   * @returns {string}
   */
  toString() {
    return `${this.name} [${this.code}]: ${this.message}`;
  }

  /**
   * Create error with additional context
   * @param {Object} additionalData - Additional context data
   * @returns {PoppoError}
   */
  withContext(additionalData) {
    return new PoppoError(
      this.code,
      { ...this.data, ...additionalData },
      {},
      this.cause
    );
  }

  // Static factory methods for common error types

  /**
   * Create a system error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static system(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create a GitHub API error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static github(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create a Claude API error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static claude(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create a task error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static task(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create an agent error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static agent(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create a file/IO error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static file(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create a process error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static process(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create a database/state error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static database(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Create a network error
   * @param {string} code - Error code
   * @param {Object} data - Error data
   * @param {Error} cause - Original error
   * @returns {PoppoError}
   */
  static network(code, data = {}, cause = null) {
    return new PoppoError(code, data, {}, cause);
  }

  /**
   * Wrap an existing error with PoppoError
   * @param {Error} originalError - Original error to wrap
   * @param {string} code - PoppoError code
   * @param {Object} data - Additional data
   * @returns {PoppoError}
   */
  static wrap(originalError, code, data = {}) {
    return new PoppoError(code, data, {}, originalError);
  }

  /**
   * Check if error is a PoppoError
   * @param {Error} error - Error to check
   * @returns {boolean}
   */
  static isPoppoError(error) {
    return error instanceof PoppoError;
  }
}

module.exports = PoppoError;