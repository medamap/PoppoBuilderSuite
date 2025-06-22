/**
 * Error System Index
 * Exports all error-related components
 */

const PoppoError = require('./poppo-error');
const ErrorHandler = require('./error-handler');
const { 
  ERROR_CODES, 
  ERROR_SEVERITY, 
  ERROR_CATEGORIES,
  ERROR_METADATA,
  getErrorMetadata,
  isRetryableError,
  isRecoverableError,
  getErrorCategory,
  getErrorSeverity
} = require('./error-codes');

/**
 * Create a new PoppoError instance
 * @param {string} code - Error code from ERROR_CODES
 * @param {Object} data - Error data for interpolation
 * @param {Error} cause - Original error that caused this error
 * @returns {PoppoError}
 */
function createError(code, data = {}, cause = null) {
  return new PoppoError(code, data, {}, cause);
}

/**
 * Create a system error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function systemError(code, data = {}, cause = null) {
  return PoppoError.system(code, data, cause);
}

/**
 * Create a GitHub API error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function githubError(code, data = {}, cause = null) {
  return PoppoError.github(code, data, cause);
}

/**
 * Create a Claude API error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function claudeError(code, data = {}, cause = null) {
  return PoppoError.claude(code, data, cause);
}

/**
 * Create a task error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function taskError(code, data = {}, cause = null) {
  return PoppoError.task(code, data, cause);
}

/**
 * Create an agent error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function agentError(code, data = {}, cause = null) {
  return PoppoError.agent(code, data, cause);
}

/**
 * Create a file/IO error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function fileError(code, data = {}, cause = null) {
  return PoppoError.file(code, data, cause);
}

/**
 * Create a process error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function processError(code, data = {}, cause = null) {
  return PoppoError.process(code, data, cause);
}

/**
 * Create a database/state error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function databaseError(code, data = {}, cause = null) {
  return PoppoError.database(code, data, cause);
}

/**
 * Create a network error
 * @param {string} code - Error code
 * @param {Object} data - Error data
 * @param {Error} cause - Original error
 * @returns {PoppoError}
 */
function networkError(code, data = {}, cause = null) {
  return PoppoError.network(code, data, cause);
}

/**
 * Wrap an existing error with PoppoError
 * @param {Error} originalError - Original error to wrap
 * @param {string} code - PoppoError code
 * @param {Object} data - Additional data
 * @returns {PoppoError}
 */
function wrapError(originalError, code, data = {}) {
  return PoppoError.wrap(originalError, code, data);
}

/**
 * Check if error is a PoppoError
 * @param {Error} error - Error to check
 * @returns {boolean}
 */
function isPoppoError(error) {
  return PoppoError.isPoppoError(error);
}

/**
 * Create a new ErrorHandler instance
 * @param {Object} options - Handler options
 * @returns {ErrorHandler}
 */
function createErrorHandler(options = {}) {
  return new ErrorHandler(options);
}

// Export everything
module.exports = {
  // Classes
  PoppoError,
  ErrorHandler,
  
  // Constants
  ERROR_CODES,
  ERROR_SEVERITY,
  ERROR_CATEGORIES,
  ERROR_METADATA,
  
  // Utility functions
  getErrorMetadata,
  isRetryableError,
  isRecoverableError,
  getErrorCategory,
  getErrorSeverity,
  
  // Factory functions
  createError,
  systemError,
  githubError,
  claudeError,
  taskError,
  agentError,
  fileError,
  processError,
  databaseError,
  networkError,
  wrapError,
  isPoppoError,
  createErrorHandler
};