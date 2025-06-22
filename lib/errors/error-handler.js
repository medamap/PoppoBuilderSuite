/**
 * Error Handler Utility
 * Provides centralized error handling with logging and recovery
 */

const PoppoError = require('./poppo-error');
const { ERROR_CODES, getErrorMetadata } = require('./error-codes');
const LoggerFactory = require('../utils/logger-factory');

class ErrorHandler {
  constructor(options = {}) {
    this.logger = options.logger || LoggerFactory.createI18n('ErrorHandler');
    this.enableRecovery = options.enableRecovery !== false;
    this.enableRetry = options.enableRetry !== false;
    this.maxRetries = options.maxRetries || 3;
    this.retryDelay = options.retryDelay || 1000;
    this.recoveryCallbacks = new Map();
    this.errorStats = new Map();
    this.globalErrorHandler = options.globalHandler || null;
  }

  /**
   * Handle an error with appropriate logging and recovery
   * @param {Error|PoppoError} error - Error to handle
   * @param {Object} context - Additional context information
   * @returns {Promise<Object>} Handling result
   */
  async handleError(error, context = {}) {
    const startTime = Date.now();
    
    try {
      // Convert to PoppoError if needed
      const poppoError = this._ensurePoppoError(error, context);
      
      // Log the error
      await this._logError(poppoError, context);
      
      // Update error statistics
      this._updateStats(poppoError);
      
      // Determine handling strategy
      const strategy = this._determineStrategy(poppoError, context);
      
      // Execute handling strategy
      const result = await this._executeStrategy(poppoError, strategy, context);
      
      // Log handling result
      await this.logger.info('errors:handling_completed', {
        code: poppoError.code,
        strategy: strategy.type,
        duration: Date.now() - startTime,
        success: result.success
      });
      
      return result;
      
    } catch (handlingError) {
      // Error in error handling - this is critical
      await this.logger.error('errors:handler_failed', {
        originalError: error.message,
        handlingError: handlingError.message,
        context
      });
      
      // Call global error handler if available
      if (this.globalErrorHandler) {
        try {
          await this.globalErrorHandler(handlingError, { originalError: error, context });
        } catch (globalError) {
          console.error('Global error handler failed:', globalError);
        }
      }
      
      return {
        success: false,
        strategy: 'none',
        error: handlingError,
        originalError: error
      };
    }
  }

  /**
   * Register a recovery callback for specific error codes
   * @param {string|Array<string>} codes - Error code(s) to handle
   * @param {Function} callback - Recovery function
   */
  registerRecovery(codes, callback) {
    const codeArray = Array.isArray(codes) ? codes : [codes];
    for (const code of codeArray) {
      this.recoveryCallbacks.set(code, callback);
    }
  }

  /**
   * Check if error should be retried
   * @param {PoppoError} error - Error to check
   * @param {Object} context - Context with retry count
   * @returns {boolean}
   */
  shouldRetry(error, context = {}) {
    if (!this.enableRetry) return false;
    if (!error.isRetryable()) return false;
    
    const retryCount = context.retryCount || 0;
    return retryCount < this.maxRetries;
  }

  /**
   * Execute retry with exponential backoff
   * @param {Function} operation - Operation to retry
   * @param {Object} context - Context information
   * @returns {Promise<any>} Operation result
   */
  async executeWithRetry(operation, context = {}) {
    const maxRetries = context.maxRetries || this.maxRetries;
    let lastError;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation(attempt);
        
        if (attempt > 0) {
          await this.logger.info('errors:retry_succeeded', {
            attempt,
            operation: context.operation || 'unknown'
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        const poppoError = this._ensurePoppoError(error, context);
        
        if (attempt < maxRetries && this.shouldRetry(poppoError, { retryCount: attempt })) {
          const delay = this._calculateRetryDelay(attempt);
          
          await this.logger.warn('errors:retry_attempt', {
            attempt: attempt + 1,
            maxRetries,
            delay,
            error: poppoError.code || poppoError.message,
            operation: context.operation || 'unknown'
          });
          
          await this._sleep(delay);
        } else {
          await this.logger.error('errors:retry_exhausted', {
            attempts: attempt + 1,
            finalError: poppoError.code || poppoError.message,
            operation: context.operation || 'unknown'
          });
          break;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Get error statistics
   * @returns {Object} Error statistics
   */
  getStats() {
    const stats = {};
    for (const [code, count] of this.errorStats.entries()) {
      const metadata = getErrorMetadata(code);
      stats[code] = {
        count,
        category: metadata.category,
        severity: metadata.severity
      };
    }
    return stats;
  }

  /**
   * Reset error statistics
   */
  resetStats() {
    this.errorStats.clear();
  }

  /**
   * Create a standardized error response
   * @param {PoppoError} error - Error to format
   * @param {Object} context - Additional context
   * @returns {Object} Standardized error response
   */
  formatErrorResponse(error, context = {}) {
    const poppoError = this._ensurePoppoError(error, context);
    
    return {
      success: false,
      error: {
        code: poppoError.code,
        message: poppoError.message,
        category: poppoError.category,
        severity: poppoError.severity,
        recoverable: poppoError.recoverable,
        retryable: poppoError.retryable,
        timestamp: poppoError.timestamp,
        context: context
      }
    };
  }

  // Private methods

  _ensurePoppoError(error, context = {}) {
    if (PoppoError.isPoppoError(error)) {
      return error;
    }
    
    // Try to map common errors to PoppoError codes
    const code = this._inferErrorCode(error);
    return PoppoError.wrap(error, code, context);
  }

  _inferErrorCode(error) {
    const message = error.message?.toLowerCase() || '';
    
    // File system errors
    if (message.includes('enoent') || message.includes('file not found')) {
      return ERROR_CODES.FILE_NOT_FOUND;
    }
    if (message.includes('eacces') || message.includes('permission denied')) {
      return ERROR_CODES.FILE_PERMISSION_DENIED;
    }
    if (message.includes('enospc') || message.includes('no space')) {
      return ERROR_CODES.DISK_SPACE_INSUFFICIENT;
    }
    
    // Network errors
    if (message.includes('timeout') || message.includes('etimedout')) {
      return ERROR_CODES.NETWORK_TIMEOUT;
    }
    if (message.includes('econnrefused') || message.includes('connection refused')) {
      return ERROR_CODES.NETWORK_CONNECTION_FAILED;
    }
    if (message.includes('dns') || message.includes('enotfound')) {
      return ERROR_CODES.DNS_RESOLUTION_FAILED;
    }
    
    // GitHub specific errors
    if (message.includes('github') && message.includes('rate limit')) {
      return ERROR_CODES.GITHUB_RATE_LIMIT_EXCEEDED;
    }
    if (message.includes('github') && message.includes('unauthorized')) {
      return ERROR_CODES.GITHUB_AUTH_FAILED;
    }
    
    // Claude specific errors
    if (message.includes('claude') && message.includes('rate limit')) {
      return ERROR_CODES.CLAUDE_RATE_LIMIT_EXCEEDED;
    }
    if (message.includes('claude') && message.includes('unauthorized')) {
      return ERROR_CODES.CLAUDE_AUTH_FAILED;
    }
    
    // Process errors
    if (message.includes('spawn') || message.includes('child process')) {
      return ERROR_CODES.PROCESS_SPAWN_FAILED;
    }
    
    // Default to system error
    return ERROR_CODES.SYSTEM_INITIALIZATION_FAILED;
  }

  async _logError(error, context) {
    const logData = {
      code: error.code,
      message: error.message,
      category: error.category,
      severity: error.severity,
      recoverable: error.recoverable,
      retryable: error.retryable,
      context
    };

    switch (error.severity) {
      case 'critical':
        await this.logger.error('errors:critical_error', logData);
        break;
      case 'high':
        await this.logger.error('errors:high_severity_error', logData);
        break;
      case 'medium':
        await this.logger.warn('errors:medium_severity_error', logData);
        break;
      case 'low':
        await this.logger.info('errors:low_severity_error', logData);
        break;
      default:
        await this.logger.info('errors:unknown_severity_error', logData);
    }
  }

  _updateStats(error) {
    const code = error.code;
    this.errorStats.set(code, (this.errorStats.get(code) || 0) + 1);
  }

  _determineStrategy(error, context) {
    // Check for custom recovery callback
    if (this.recoveryCallbacks.has(error.code)) {
      return { type: 'recovery', callback: this.recoveryCallbacks.get(error.code) };
    }
    
    // Check if retryable
    if (this.enableRetry && this.shouldRetry(error, context)) {
      return { type: 'retry' };
    }
    
    // Check if recoverable
    if (this.enableRecovery && error.isRecoverable()) {
      return { type: 'recovery', callback: this._defaultRecovery.bind(this) };
    }
    
    // No recovery possible
    return { type: 'none' };
  }

  async _executeStrategy(error, strategy, context) {
    switch (strategy.type) {
      case 'recovery':
        try {
          const recoveryResult = await strategy.callback(error, context);
          return {
            success: true,
            strategy: 'recovery',
            result: recoveryResult
          };
        } catch (recoveryError) {
          return {
            success: false,
            strategy: 'recovery',
            error: recoveryError
          };
        }
        
      case 'retry':
        return {
          success: false,
          strategy: 'retry',
          shouldRetry: true,
          retryDelay: this._calculateRetryDelay(context.retryCount || 0)
        };
        
      default:
        return {
          success: false,
          strategy: 'none'
        };
    }
  }

  async _defaultRecovery(error, context) {
    await this.logger.info('errors:attempting_default_recovery', {
      code: error.code,
      context
    });
    
    // Default recovery strategies based on error category
    switch (error.category) {
      case 'file':
        return this._recoverFileError(error, context);
      case 'network':
        return this._recoverNetworkError(error, context);
      case 'process':
        return this._recoverProcessError(error, context);
      default:
        throw new Error(`No default recovery for category: ${error.category}`);
    }
  }

  async _recoverFileError(error, context) {
    // Simple file recovery strategies
    if (error.code === ERROR_CODES.DIRECTORY_CREATION_FAILED) {
      // Try to create parent directories
      const path = context.path;
      if (path) {
        const fs = require('fs').promises;
        await fs.mkdir(path, { recursive: true });
        return { recovered: true, action: 'created_directories' };
      }
    }
    
    throw new Error('No recovery strategy available');
  }

  async _recoverNetworkError(error, context) {
    // Simple network recovery - wait and retry
    await this._sleep(this.retryDelay);
    return { recovered: true, action: 'waited_for_network' };
  }

  async _recoverProcessError(error, context) {
    // Process recovery strategies
    if (error.code === ERROR_CODES.PROCESS_TIMEOUT) {
      return { recovered: false, action: 'process_timeout_no_recovery' };
    }
    
    throw new Error('No recovery strategy available');
  }

  _calculateRetryDelay(attempt) {
    // Exponential backoff with jitter
    const baseDelay = this.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt);
    const jitter = Math.random() * 0.1 * exponentialDelay;
    return Math.min(exponentialDelay + jitter, 30000); // Max 30 seconds
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = ErrorHandler;