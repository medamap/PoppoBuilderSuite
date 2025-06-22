/**
 * Issue #126: Comprehensive Error Recovery System
 * 
 * Advanced error recovery system with:
 * - Automatic retry mechanisms
 * - Circuit breakers
 * - Fallback strategies
 * - Self-healing capabilities
 * - Error pattern learning
 * - Recovery orchestration
 */

const EventEmitter = require('events');
const ProductionLogger = require('../utils/production-logger');

class ErrorRecoverySystem extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      maxRetries: options.maxRetries || 3,
      baseDelay: options.baseDelay || 1000,
      maxDelay: options.maxDelay || 30000,
      backoffMultiplier: options.backoffMultiplier || 2,
      jitterFactor: options.jitterFactor || 0.1,
      circuitBreakerThreshold: options.circuitBreakerThreshold || 5,
      circuitBreakerTimeout: options.circuitBreakerTimeout || 60000,
      learningEnabled: options.learningEnabled !== false,
      selfHealingEnabled: options.selfHealingEnabled !== false,
      ...options
    };
    
    this.logger = new ProductionLogger('ErrorRecoverySystem', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true,
      enableErrorCorrelation: true
    });
    
    this.circuitBreakers = new Map();
    this.retryCounters = new Map();
    this.errorPatterns = new Map();
    this.recoveryStrategies = new Map();
    this.fallbackHandlers = new Map();
    
    this.isInitialized = false;
    this.totalRecoveryAttempts = 0;
    this.successfulRecoveries = 0;
    
    this.initializeRecoveryStrategies();
  }

  /**
   * Initialize the error recovery system
   */
  async initialize() {
    if (this.isInitialized) return;
    
    try {
      await this.logger.info('Initializing Error Recovery System');
      
      // Register default recovery strategies
      this.registerDefaultStrategies();
      
      // Start background monitoring
      this.startBackgroundMonitoring();
      
      this.isInitialized = true;
      await this.logger.info('Error Recovery System initialized successfully');
      
    } catch (error) {
      await this.logger.error('Failed to initialize Error Recovery System', { error });
      throw error;
    }
  }

  /**
   * Execute operation with error recovery
   */
  async executeWithRecovery(operationId, operation, options = {}) {
    const startTime = Date.now();
    const correlationId = await this.logger.generateCorrelationId();
    
    const config = {
      maxRetries: options.maxRetries || this.options.maxRetries,
      strategy: options.strategy || 'exponential-backoff',
      fallback: options.fallback,
      circuitBreaker: options.circuitBreaker !== false,
      ...options
    };
    
    await this.logger.logStructured('info', `Starting operation with recovery: ${operationId}`, {
      correlationId,
      operationId,
      config,
      component: 'OperationExecution'
    });
    
    try {
      // Check circuit breaker
      if (config.circuitBreaker && this.isCircuitBreakerOpen(operationId)) {
        throw new Error(`Circuit breaker is open for operation: ${operationId}`);
      }
      
      // Execute operation with retry logic
      const result = await this.executeWithRetry(
        operationId,
        operation,
        config,
        correlationId
      );
      
      // Record success
      this.recordSuccess(operationId);
      
      const duration = Date.now() - startTime;
      await this.logger.logStructured('info', `Operation completed successfully: ${operationId}`, {
        correlationId,
        operationId,
        duration,
        component: 'OperationExecution'
      });
      
      return result;
      
    } catch (error) {
      // Record failure
      this.recordFailure(operationId, error);
      
      // Attempt fallback if configured
      if (config.fallback) {
        try {
          await this.logger.logStructured('warn', `Attempting fallback for operation: ${operationId}`, {
            correlationId,
            operationId,
            error: error.message,
            component: 'FallbackExecution'
          });
          
          const fallbackResult = await this.executeFallback(operationId, config.fallback, error);
          
          await this.logger.logStructured('info', `Fallback succeeded for operation: ${operationId}`, {
            correlationId,
            operationId,
            component: 'FallbackExecution'
          });
          
          return fallbackResult;
          
        } catch (fallbackError) {
          await this.logger.logCorrelatedError(fallbackError, correlationId, {
            operationId,
            component: 'FallbackExecution',
            originalError: error.message
          });
          
          throw fallbackError;
        }
      }
      
      const duration = Date.now() - startTime;
      await this.logger.logCorrelatedError(error, correlationId, {
        operationId,
        duration,
        component: 'OperationExecution'
      });
      
      throw error;
    }
  }

  /**
   * Execute operation with retry logic
   */
  async executeWithRetry(operationId, operation, config, correlationId) {
    let lastError;
    
    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = this.calculateDelay(attempt, config.strategy);
          
          await this.logger.logStructured('info', `Retrying operation: ${operationId} (attempt ${attempt + 1})`, {
            correlationId,
            operationId,
            attempt: attempt + 1,
            delay,
            component: 'RetryLogic'
          });
          
          await this.sleep(delay);
        }
        
        const result = await operation();
        
        if (attempt > 0) {
          this.successfulRecoveries++;
          
          await this.logger.logStructured('info', `Operation recovered successfully: ${operationId}`, {
            correlationId,
            operationId,
            attempt: attempt + 1,
            component: 'RecoverySuccess'
          });
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        this.totalRecoveryAttempts++;
        
        await this.logger.logStructured('warn', `Operation attempt failed: ${operationId}`, {
          correlationId,
          operationId,
          attempt: attempt + 1,
          error: error.message,
          component: 'RetryLogic'
        });
        
        // Learn from error pattern
        if (this.options.learningEnabled) {
          this.learnFromError(operationId, error, attempt);
        }
        
        // Check if this error is recoverable
        if (!this.isRecoverableError(error)) {
          await this.logger.logStructured('error', `Non-recoverable error detected: ${operationId}`, {
            correlationId,
            operationId,
            error: error.message,
            component: 'RecoverabilityCheck'
          });
          break;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Calculate retry delay
   */
  calculateDelay(attempt, strategy) {
    let delay;
    
    switch (strategy) {
      case 'linear':
        delay = this.options.baseDelay * attempt;
        break;
      case 'exponential-backoff':
        delay = this.options.baseDelay * Math.pow(this.options.backoffMultiplier, attempt - 1);
        break;
      case 'fibonacci':
        delay = this.options.baseDelay * this.fibonacci(attempt);
        break;
      default:
        delay = this.options.baseDelay;
    }
    
    // Apply jitter
    const jitter = delay * this.options.jitterFactor * (Math.random() - 0.5);
    delay += jitter;
    
    // Cap at maximum delay
    return Math.min(delay, this.options.maxDelay);
  }

  /**
   * Fibonacci sequence for delay calculation
   */
  fibonacci(n) {
    if (n <= 1) return 1;
    let a = 1, b = 1;
    for (let i = 2; i <= n; i++) {
      [a, b] = [b, a + b];
    }
    return b;
  }

  /**
   * Check if error is recoverable
   */
  isRecoverableError(error) {
    const nonRecoverablePatterns = [
      /ENOENT/i,           // File not found
      /EACCES/i,           // Permission denied
      /syntax.*error/i,    // Syntax errors
      /Invalid.*API.*key/i,// Invalid credentials
      /404.*not.*found/i   // HTTP 404
    ];
    
    const message = error.message || String(error);
    
    return !nonRecoverablePatterns.some(pattern => pattern.test(message));
  }

  /**
   * Circuit breaker management
   */
  isCircuitBreakerOpen(operationId) {
    const breaker = this.circuitBreakers.get(operationId);
    if (!breaker) return false;
    
    if (breaker.state === 'open') {
      // Check if timeout has elapsed
      if (Date.now() - breaker.lastFailureTime > this.options.circuitBreakerTimeout) {
        breaker.state = 'half-open';
        breaker.consecutiveFailures = 0;
        return false;
      }
      return true;
    }
    
    return false;
  }

  /**
   * Record operation success
   */
  recordSuccess(operationId) {
    const breaker = this.circuitBreakers.get(operationId);
    if (breaker) {
      breaker.state = 'closed';
      breaker.consecutiveFailures = 0;
    }
    
    this.retryCounters.delete(operationId);
  }

  /**
   * Record operation failure
   */
  recordFailure(operationId, error) {
    let breaker = this.circuitBreakers.get(operationId);
    if (!breaker) {
      breaker = {
        state: 'closed',
        consecutiveFailures: 0,
        lastFailureTime: null
      };
      this.circuitBreakers.set(operationId, breaker);
    }
    
    breaker.consecutiveFailures++;
    breaker.lastFailureTime = Date.now();
    
    if (breaker.consecutiveFailures >= this.options.circuitBreakerThreshold) {
      breaker.state = 'open';
      
      this.logger.logSecurityEvent('circuit_breaker_opened', {
        operationId,
        consecutiveFailures: breaker.consecutiveFailures,
        action: 'open_circuit_breaker',
        resource: operationId,
        result: 'blocked'
      });
    }
  }

  /**
   * Learn from error patterns
   */
  learnFromError(operationId, error, attempt) {
    const errorSignature = this.generateErrorSignature(error);
    
    let pattern = this.errorPatterns.get(errorSignature);
    if (!pattern) {
      pattern = {
        signature: errorSignature,
        occurrences: 0,
        operations: new Set(),
        lastSeen: null,
        recoverability: null,
        averageAttemptsToRecover: 0
      };
      this.errorPatterns.set(errorSignature, pattern);
    }
    
    pattern.occurrences++;
    pattern.operations.add(operationId);
    pattern.lastSeen = new Date().toISOString();
    
    // Update recoverability statistics
    if (attempt > 0) {
      pattern.averageAttemptsToRecover = 
        (pattern.averageAttemptsToRecover + attempt) / 2;
    }
  }

  /**
   * Generate error signature for learning
   */
  generateErrorSignature(error) {
    const message = error.message || String(error);
    const type = error.constructor.name;
    const code = error.code || 'unknown';
    
    // Create a normalized signature
    const normalizedMessage = message
      .replace(/\d+/g, 'NUMBER')
      .replace(/["'][^"']*["']/g, 'STRING')
      .replace(/\s+/g, ' ')
      .trim();
    
    return `${type}:${code}:${normalizedMessage}`;
  }

  /**
   * Execute fallback strategy
   */
  async executeFallback(operationId, fallbackConfig, originalError) {
    if (typeof fallbackConfig === 'function') {
      return await fallbackConfig(originalError);
    }
    
    if (typeof fallbackConfig === 'string') {
      const handler = this.fallbackHandlers.get(fallbackConfig);
      if (handler) {
        return await handler(operationId, originalError);
      }
    }
    
    if (fallbackConfig.handler) {
      return await fallbackConfig.handler(originalError);
    }
    
    throw new Error(`No valid fallback configured for operation: ${operationId}`);
  }

  /**
   * Register recovery strategy
   */
  registerRecoveryStrategy(name, strategy) {
    this.recoveryStrategies.set(name, strategy);
  }

  /**
   * Register fallback handler
   */
  registerFallbackHandler(name, handler) {
    this.fallbackHandlers.set(name, handler);
  }

  /**
   * Initialize default recovery strategies
   */
  initializeRecoveryStrategies() {
    // Default strategies will be registered here
    this.registerRecoveryStrategy('exponential-backoff', {
      calculateDelay: (attempt) => this.calculateDelay(attempt, 'exponential-backoff')
    });
    
    this.registerRecoveryStrategy('linear', {
      calculateDelay: (attempt) => this.calculateDelay(attempt, 'linear')
    });
  }

  /**
   * Register default strategies
   */
  registerDefaultStrategies() {
    // File system fallback
    this.registerFallbackHandler('file-system-fallback', async (operationId, error) => {
      if (error.code === 'ENOENT') {
        // Try to create the missing file/directory
        const fs = require('fs').promises;
        const path = require('path');
        
        try {
          const match = error.message.match(/no such file or directory.*'([^']+)'/);
          if (match) {
            const filePath = match[1];
            const dirPath = path.dirname(filePath);
            await fs.mkdir(dirPath, { recursive: true });
            await fs.writeFile(filePath, '{}'); // Create empty JSON file
            return { recovered: true, action: 'created_missing_file' };
          }
        } catch (recoveryError) {
          throw new Error(`Fallback failed: ${recoveryError.message}`);
        }
      }
      
      throw error;
    });
    
    // Network fallback
    this.registerFallbackHandler('network-fallback', async (operationId, error) => {
      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        // Return cached data or default response
        return {
          recovered: true,
          action: 'used_cached_data',
          data: null,
          warning: 'Network unavailable, using fallback response'
        };
      }
      
      throw error;
    });
  }

  /**
   * Start background monitoring
   */
  startBackgroundMonitoring() {
    // Monitor circuit breakers every minute
    setInterval(async () => {
      try {
        await this.monitorCircuitBreakers();
      } catch (error) {
        await this.logger.error('Circuit breaker monitoring failed', { error });
      }
    }, 60000);
    
    // Generate recovery statistics every 5 minutes
    setInterval(async () => {
      try {
        await this.generateRecoveryReport();
      } catch (error) {
        await this.logger.error('Recovery report generation failed', { error });
      }
    }, 300000);
  }

  /**
   * Monitor circuit breakers
   */
  async monitorCircuitBreakers() {
    for (const [operationId, breaker] of this.circuitBreakers.entries()) {
      if (breaker.state === 'open') {
        const timeSinceLastFailure = Date.now() - breaker.lastFailureTime;
        
        if (timeSinceLastFailure > this.options.circuitBreakerTimeout) {
          breaker.state = 'half-open';
          
          await this.logger.logStructured('info', `Circuit breaker half-opened: ${operationId}`, {
            operationId,
            timeSinceLastFailure,
            component: 'CircuitBreakerMonitoring'
          });
        }
      }
    }
  }

  /**
   * Generate recovery report
   */
  async generateRecoveryReport() {
    const report = {
      timestamp: new Date().toISOString(),
      totalRecoveryAttempts: this.totalRecoveryAttempts,
      successfulRecoveries: this.successfulRecoveries,
      recoverySuccessRate: this.totalRecoveryAttempts > 0 ? 
        (this.successfulRecoveries / this.totalRecoveryAttempts) * 100 : 0,
      circuitBreakers: {
        total: this.circuitBreakers.size,
        open: Array.from(this.circuitBreakers.values()).filter(b => b.state === 'open').length,
        halfOpen: Array.from(this.circuitBreakers.values()).filter(b => b.state === 'half-open').length
      },
      errorPatterns: {
        total: this.errorPatterns.size,
        topPatterns: Array.from(this.errorPatterns.entries())
          .sort((a, b) => b[1].occurrences - a[1].occurrences)
          .slice(0, 5)
          .map(([signature, pattern]) => ({
            signature,
            occurrences: pattern.occurrences,
            operations: pattern.operations.size,
            averageAttemptsToRecover: pattern.averageAttemptsToRecover
          }))
      }
    };
    
    await this.logger.logStructured('info', 'Error Recovery System Report', {
      component: 'RecoveryReport',
      metadata: report
    });
    
    this.emit('recovery-report', report);
    return report;
  }

  /**
   * Get system statistics
   */
  getStatistics() {
    return {
      totalRecoveryAttempts: this.totalRecoveryAttempts,
      successfulRecoveries: this.successfulRecoveries,
      recoverySuccessRate: this.totalRecoveryAttempts > 0 ? 
        (this.successfulRecoveries / this.totalRecoveryAttempts) * 100 : 0,
      circuitBreakersCount: this.circuitBreakers.size,
      errorPatternsLearned: this.errorPatterns.size,
      isInitialized: this.isInitialized
    };
  }

  /**
   * Utility: Sleep
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    await this.logger.info('Cleaning up Error Recovery System');
    
    // Clear all maps
    this.circuitBreakers.clear();
    this.retryCounters.clear();
    this.errorPatterns.clear();
    this.recoveryStrategies.clear();
    this.fallbackHandlers.clear();
    
    this.isInitialized = false;
  }
}

module.exports = ErrorRecoverySystem;