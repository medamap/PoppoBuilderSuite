/**
 * Task Retry Manager
 * Intelligent retry system with configurable strategies and error classification
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const Logger = require('../../src/logger');
const { PoppoError, ErrorCodes } = require('../errors');

class TaskRetryManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      // Retry configuration
      maxRetries: {
        default: 3,
        'rate-limit': 5,
        'network': 5,
        'timeout': 3,
        'api-error': 2,
        'validation': 0
      },
      
      // Backoff configuration
      backoff: {
        initial: 1000,        // 1 second
        max: 300000,          // 5 minutes
        multiplier: 2,
        jitter: 0.1,
        strategy: 'exponential' // 'exponential', 'linear', 'fixed'
      },
      
      // Dead letter queue
      deadLetterQueue: {
        enabled: true,
        path: path.join(os.homedir(), '.poppobuilder', 'dead-letters'),
        retentionDays: 30
      },
      
      // Circuit breaker
      circuitBreaker: {
        enabled: true,
        threshold: 5,         // failures before opening
        timeout: 60000,       // 1 minute
        halfOpenRequests: 2   // test requests when half-open
      },
      
      // Retry state persistence
      statePersistence: {
        enabled: true,
        path: path.join(os.homedir(), '.poppobuilder', 'retry-state.json'),
        saveInterval: 30000   // 30 seconds
      },
      
      // Monitoring
      monitoring: {
        alertThreshold: 10,   // alert after N consecutive failures
        metricsWindow: 3600000 // 1 hour
      },
      
      ...options
    };
    
    // Initialize logger
    this.logger = new Logger('TaskRetryManager', options.loggerOptions);
    
    // Retry state
    this.retryState = new Map();
    this.deadLetterQueue = [];
    
    // Circuit breaker state per task type
    this.circuitBreakers = new Map();
    
    // Metrics tracking
    this.metrics = {
      byTaskType: new Map(),
      byErrorType: new Map(),
      hourlyStats: []
    };
    
    // Error classifiers
    this.errorClassifiers = new Map([
      ['rate-limit', this.isRateLimitError.bind(this)],
      ['network', this.isNetworkError.bind(this)],
      ['timeout', this.isTimeoutError.bind(this)],
      ['api-error', this.isApiError.bind(this)],
      ['validation', this.isValidationError.bind(this)],
      ['auth', this.isAuthError.bind(this)]
    ]);
    
    // Custom error classifiers
    this.customClassifiers = new Map();
    
    // Initialize
    this.initialize();
  }
  
  /**
   * Initialize retry manager
   */
  async initialize() {
    // Load persisted state
    if (this.options.statePersistence.enabled) {
      await this.loadRetryState();
    }
    
    // Create dead letter queue directory
    if (this.options.deadLetterQueue.enabled) {
      await fs.mkdir(this.options.deadLetterQueue.path, { recursive: true });
    }
    
    // Start periodic state save
    if (this.options.statePersistence.enabled) {
      this.stateSaveInterval = setInterval(
        () => this.saveRetryState(),
        this.options.statePersistence.saveInterval
      );
    }
    
    // Start metrics cleanup
    this.metricsCleanupInterval = setInterval(
      () => this.cleanupMetrics(),
      3600000 // 1 hour
    );
  }
  
  /**
   * Process task failure and determine retry strategy
   */
  async processFailure(task, error, result = {}) {
    const taskId = task.id;
    const taskType = task.type || 'unknown';
    
    // Get or create retry state
    const retryState = this.getOrCreateRetryState(taskId, task);
    
    // Classify error
    const errorType = this.classifyError(error);
    
    // Update retry state
    retryState.attempts++;
    retryState.lastError = {
      type: errorType,
      message: error.message,
      code: error.code,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    retryState.errors.push(retryState.lastError);
    
    // Check circuit breaker
    if (this.options.circuitBreaker.enabled && this.isCircuitOpen(taskType)) {
      this.logger.warn(`Circuit breaker open for task type ${taskType}`);
      await this.sendToDeadLetter(task, 'circuit-breaker-open', retryState);
      return { retry: false, reason: 'circuit-breaker-open' };
    }
    
    // Determine if we should retry
    const shouldRetry = await this.shouldRetry(task, errorType, retryState);
    
    if (!shouldRetry.retry) {
      // Send to dead letter queue
      await this.sendToDeadLetter(task, shouldRetry.reason, retryState);
      this.updateMetrics(taskType, errorType, false);
      return shouldRetry;
    }
    
    // Calculate retry delay
    const delay = this.calculateRetryDelay(retryState, errorType);
    
    // Update retry state
    retryState.nextRetryAt = new Date(Date.now() + delay).toISOString();
    retryState.status = 'scheduled';
    
    // Emit retry event
    this.emit('task-retry-scheduled', {
      taskId,
      taskType,
      attempt: retryState.attempts,
      delay,
      errorType,
      nextRetryAt: retryState.nextRetryAt
    });
    
    // Update metrics
    this.updateMetrics(taskType, errorType, true);
    
    return {
      retry: true,
      delay,
      attempt: retryState.attempts,
      strategy: this.getRetryStrategy(errorType)
    };
  }
  
  /**
   * Process successful task to clear retry state
   */
  async processSuccess(task) {
    const taskId = task.id;
    const taskType = task.type || 'unknown';
    
    // Clear retry state
    if (this.retryState.has(taskId)) {
      const retryState = this.retryState.get(taskId);
      
      // Update metrics for successful retry
      if (retryState.attempts > 0) {
        this.emit('task-retry-success', {
          taskId,
          taskType,
          attempts: retryState.attempts,
          totalDuration: Date.now() - new Date(retryState.firstAttemptAt).getTime()
        });
        
        // Update success metrics
        const metrics = this.getTaskTypeMetrics(taskType);
        metrics.retrySuccesses++;
      }
      
      this.retryState.delete(taskId);
    }
    
    // Update circuit breaker
    this.updateCircuitBreaker(taskType, true);
  }
  
  /**
   * Classify error type
   */
  classifyError(error) {
    // Check custom classifiers first
    for (const [type, classifier] of this.customClassifiers) {
      if (classifier(error)) {
        return type;
      }
    }
    
    // Check built-in classifiers
    for (const [type, classifier] of this.errorClassifiers) {
      if (classifier(error)) {
        return type;
      }
    }
    
    return 'unknown';
  }
  
  /**
   * Determine if task should be retried
   */
  async shouldRetry(task, errorType, retryState) {
    // Check max retries for error type
    const maxRetries = this.getMaxRetries(errorType);
    
    if (maxRetries === 0) {
      return { retry: false, reason: 'non-retryable-error' };
    }
    
    if (retryState.attempts >= maxRetries) {
      return { retry: false, reason: 'max-retries-exceeded' };
    }
    
    // Check task-specific retry limit
    if (task.maxRetries !== undefined && retryState.attempts >= task.maxRetries) {
      return { retry: false, reason: 'task-retry-limit' };
    }
    
    // Check deadline if present
    if (task.deadline) {
      const deadline = new Date(task.deadline);
      const estimatedRetryTime = this.calculateRetryDelay(retryState, errorType);
      
      if (Date.now() + estimatedRetryTime > deadline.getTime()) {
        return { retry: false, reason: 'deadline-exceeded' };
      }
    }
    
    // Custom retry handler
    if (task.retryHandler) {
      try {
        const customDecision = await task.retryHandler(task, retryState);
        if (!customDecision) {
          return { retry: false, reason: 'custom-handler-rejected' };
        }
      } catch (handlerError) {
        this.logger.error('Custom retry handler failed:', handlerError);
      }
    }
    
    return { retry: true };
  }
  
  /**
   * Calculate retry delay based on strategy
   */
  calculateRetryDelay(retryState, errorType) {
    const strategy = this.getRetryStrategy(errorType);
    const { initial, max, multiplier, jitter } = this.options.backoff;
    
    let delay;
    
    switch (strategy) {
      case 'immediate':
        delay = 0;
        break;
        
      case 'fixed':
        delay = initial;
        break;
        
      case 'linear':
        delay = initial * retryState.attempts;
        break;
        
      case 'exponential':
      default:
        delay = initial * Math.pow(multiplier, retryState.attempts - 1);
        break;
    }
    
    // Apply maximum delay cap
    delay = Math.min(delay, max);
    
    // Apply jitter
    if (jitter > 0) {
      const jitterAmount = delay * jitter;
      delay = delay + (Math.random() * 2 - 1) * jitterAmount;
    }
    
    // Special handling for rate limits
    if (errorType === 'rate-limit' && retryState.lastError) {
      const retryAfter = this.extractRetryAfter(retryState.lastError);
      if (retryAfter) {
        delay = Math.max(delay, retryAfter);
      }
    }
    
    return Math.round(delay);
  }
  
  /**
   * Get retry strategy for error type
   */
  getRetryStrategy(errorType) {
    const strategies = {
      'rate-limit': 'fixed',
      'network': 'exponential',
      'timeout': 'exponential',
      'api-error': 'exponential',
      'unknown': this.options.backoff.strategy
    };
    
    return strategies[errorType] || this.options.backoff.strategy;
  }
  
  /**
   * Get max retries for error type
   */
  getMaxRetries(errorType) {
    return this.options.maxRetries[errorType] !== undefined
      ? this.options.maxRetries[errorType]
      : this.options.maxRetries.default;
  }
  
  /**
   * Send task to dead letter queue
   */
  async sendToDeadLetter(task, reason, retryState) {
    if (!this.options.deadLetterQueue.enabled) {
      return;
    }
    
    const deadLetter = {
      id: `dl-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      task,
      reason,
      retryState,
      timestamp: new Date().toISOString()
    };
    
    // Add to in-memory queue
    this.deadLetterQueue.push(deadLetter);
    
    // Persist to file
    const filename = `${deadLetter.id}.json`;
    const filepath = path.join(this.options.deadLetterQueue.path, filename);
    
    await fs.writeFile(filepath, JSON.stringify(deadLetter, null, 2));
    
    // Emit event
    this.emit('dead-letter-created', {
      taskId: task.id,
      taskType: task.type,
      reason,
      attempts: retryState.attempts
    });
    
    // Update metrics
    const metrics = this.getTaskTypeMetrics(task.type);
    metrics.deadLetters++;
  }
  
  /**
   * Manually retry a dead letter task
   */
  async retryDeadLetter(deadLetterId) {
    // Find in memory
    let deadLetter = this.deadLetterQueue.find(dl => dl.id === deadLetterId);
    
    // If not in memory, load from file
    if (!deadLetter) {
      const filepath = path.join(this.options.deadLetterQueue.path, `${deadLetterId}.json`);
      try {
        const content = await fs.readFile(filepath, 'utf8');
        deadLetter = JSON.parse(content);
      } catch (error) {
        throw new PoppoError(
          ErrorCodes.TASK_NOT_FOUND,
          'Dead letter not found',
          { deadLetterId }
        );
      }
    }
    
    // Reset retry state
    const { task } = deadLetter;
    this.retryState.delete(task.id);
    
    // Remove from dead letter queue
    this.deadLetterQueue = this.deadLetterQueue.filter(dl => dl.id !== deadLetterId);
    
    // Delete file
    const filepath = path.join(this.options.deadLetterQueue.path, `${deadLetterId}.json`);
    await fs.unlink(filepath).catch(() => {});
    
    // Emit retry event
    this.emit('dead-letter-retry', {
      deadLetterId,
      taskId: task.id,
      taskType: task.type
    });
    
    return task;
  }
  
  /**
   * Circuit breaker management
   */
  isCircuitOpen(taskType) {
    const breaker = this.circuitBreakers.get(taskType);
    if (!breaker) return false;
    
    const now = Date.now();
    
    switch (breaker.state) {
      case 'open':
        // Check if timeout has passed
        if (now - breaker.lastFailureTime > this.options.circuitBreaker.timeout) {
          breaker.state = 'half-open';
          breaker.halfOpenAttempts = 0;
        }
        return breaker.state === 'open';
        
      case 'half-open':
        // Allow limited requests through
        return breaker.halfOpenAttempts >= this.options.circuitBreaker.halfOpenRequests;
        
      default:
        return false;
    }
  }
  
  updateCircuitBreaker(taskType, success) {
    let breaker = this.circuitBreakers.get(taskType);
    
    if (!breaker) {
      breaker = {
        state: 'closed',
        failures: 0,
        lastFailureTime: 0,
        halfOpenAttempts: 0
      };
      this.circuitBreakers.set(taskType, breaker);
    }
    
    if (success) {
      if (breaker.state === 'half-open') {
        // Success in half-open state, close the circuit
        breaker.state = 'closed';
        breaker.failures = 0;
        this.emit('circuit-breaker-closed', { taskType });
      }
    } else {
      breaker.failures++;
      breaker.lastFailureTime = Date.now();
      
      if (breaker.state === 'half-open') {
        // Failure in half-open state, reopen the circuit
        breaker.state = 'open';
        this.emit('circuit-breaker-reopened', { taskType });
      } else if (breaker.failures >= this.options.circuitBreaker.threshold) {
        // Threshold reached, open the circuit
        breaker.state = 'open';
        this.emit('circuit-breaker-opened', { taskType });
      }
    }
    
    if (breaker.state === 'half-open') {
      breaker.halfOpenAttempts++;
    }
  }
  
  /**
   * Error classification methods
   */
  isRateLimitError(error) {
    const patterns = [
      /rate limit/i,
      /too many requests/i,
      /quota exceeded/i,
      /429/
    ];
    
    return patterns.some(pattern => 
      pattern.test(error.message) || 
      (error.code && pattern.test(error.code.toString()))
    );
  }
  
  isNetworkError(error) {
    const patterns = [
      /ECONNREFUSED/,
      /ENOTFOUND/,
      /ETIMEDOUT/,
      /ECONNRESET/,
      /network/i,
      /fetch failed/i
    ];
    
    return patterns.some(pattern => 
      pattern.test(error.message) || 
      (error.code && pattern.test(error.code))
    );
  }
  
  isTimeoutError(error) {
    const patterns = [
      /timeout/i,
      /timed out/i,
      /ETIMEDOUT/,
      /deadline/i
    ];
    
    return patterns.some(pattern => 
      pattern.test(error.message) || 
      (error.code && pattern.test(error.code))
    );
  }
  
  isApiError(error) {
    const patterns = [
      /5\d{2}/,  // 5xx errors
      /internal server error/i,
      /service unavailable/i,
      /bad gateway/i
    ];
    
    return patterns.some(pattern => 
      pattern.test(error.message) || 
      (error.code && pattern.test(error.code.toString()))
    );
  }
  
  isValidationError(error) {
    const patterns = [
      /validation/i,
      /invalid/i,
      /required/i,
      /format/i,
      /4\d{2}/  // 4xx errors (except 429)
    ];
    
    // Exclude rate limit errors
    if (this.isRateLimitError(error)) {
      return false;
    }
    
    return patterns.some(pattern => 
      pattern.test(error.message) || 
      (error.code && pattern.test(error.code.toString()))
    );
  }
  
  isAuthError(error) {
    const patterns = [
      /unauthorized/i,
      /authentication/i,
      /permission/i,
      /forbidden/i,
      /401/,
      /403/
    ];
    
    return patterns.some(pattern => 
      pattern.test(error.message) || 
      (error.code && pattern.test(error.code.toString()))
    );
  }
  
  /**
   * Extract retry-after header or value
   */
  extractRetryAfter(error) {
    // Check for Retry-After header in error
    if (error.headers && error.headers['retry-after']) {
      const retryAfter = error.headers['retry-after'];
      
      // Check if it's a delay in seconds or a date
      if (/^\d+$/.test(retryAfter)) {
        return parseInt(retryAfter) * 1000; // Convert to milliseconds
      } else {
        // Try to parse as date
        const retryDate = new Date(retryAfter);
        if (!isNaN(retryDate.getTime())) {
          return Math.max(0, retryDate.getTime() - Date.now());
        }
      }
    }
    
    // Check for rate limit reset time
    if (error.reset || error.rateLimitReset) {
      const resetTime = error.reset || error.rateLimitReset;
      if (typeof resetTime === 'number') {
        // Assume it's a Unix timestamp
        const resetDate = new Date(resetTime * 1000);
        return Math.max(0, resetDate.getTime() - Date.now());
      }
    }
    
    return null;
  }
  
  /**
   * Register custom error classifier
   */
  registerErrorClassifier(type, classifier) {
    if (typeof classifier !== 'function') {
      throw new Error('Classifier must be a function');
    }
    
    this.customClassifiers.set(type, classifier);
    
    // Add default max retries if not set
    if (this.options.maxRetries[type] === undefined) {
      this.options.maxRetries[type] = this.options.maxRetries.default;
    }
  }
  
  /**
   * Get or create retry state
   */
  getOrCreateRetryState(taskId, task) {
    if (!this.retryState.has(taskId)) {
      this.retryState.set(taskId, {
        taskId,
        taskType: task.type,
        attempts: 0,
        errors: [],
        firstAttemptAt: new Date().toISOString(),
        status: 'active'
      });
    }
    
    return this.retryState.get(taskId);
  }
  
  /**
   * Update metrics
   */
  updateMetrics(taskType, errorType, willRetry) {
    // Task type metrics
    const taskMetrics = this.getTaskTypeMetrics(taskType);
    taskMetrics.totalFailures++;
    
    if (willRetry) {
      taskMetrics.retries++;
    } else {
      taskMetrics.permanentFailures++;
    }
    
    // Error type metrics
    const errorMetrics = this.getErrorTypeMetrics(errorType);
    errorMetrics.count++;
    
    if (willRetry) {
      errorMetrics.retries++;
    }
    
    // Hourly stats
    const hourlyStats = {
      timestamp: Date.now(),
      taskType,
      errorType,
      willRetry
    };
    
    this.metrics.hourlyStats.push(hourlyStats);
    
    // Check for alert conditions
    this.checkAlertConditions(taskType, taskMetrics);
  }
  
  getTaskTypeMetrics(taskType) {
    if (!this.metrics.byTaskType.has(taskType)) {
      this.metrics.byTaskType.set(taskType, {
        totalFailures: 0,
        retries: 0,
        permanentFailures: 0,
        deadLetters: 0,
        retrySuccesses: 0,
        consecutiveFailures: 0
      });
    }
    
    return this.metrics.byTaskType.get(taskType);
  }
  
  getErrorTypeMetrics(errorType) {
    if (!this.metrics.byErrorType.has(errorType)) {
      this.metrics.byErrorType.set(errorType, {
        count: 0,
        retries: 0
      });
    }
    
    return this.metrics.byErrorType.get(errorType);
  }
  
  /**
   * Check alert conditions
   */
  checkAlertConditions(taskType, metrics) {
    // Check consecutive failures
    if (metrics.consecutiveFailures >= this.options.monitoring.alertThreshold) {
      this.emit('retry-alert', {
        type: 'excessive-failures',
        taskType,
        failures: metrics.consecutiveFailures,
        message: `Task type ${taskType} has failed ${metrics.consecutiveFailures} times consecutively`
      });
    }
    
    // Check retry storm (too many retries in short time)
    const recentRetries = this.metrics.hourlyStats.filter(
      stat => stat.taskType === taskType && 
              stat.willRetry && 
              Date.now() - stat.timestamp < 300000 // 5 minutes
    ).length;
    
    if (recentRetries > 20) {
      this.emit('retry-alert', {
        type: 'retry-storm',
        taskType,
        retries: recentRetries,
        message: `Potential retry storm detected for task type ${taskType}`
      });
    }
  }
  
  /**
   * Get retry statistics
   */
  getStatistics() {
    const stats = {
      overview: {
        activeRetries: this.retryState.size,
        deadLetters: this.deadLetterQueue.length,
        circuitBreakers: {}
      },
      byTaskType: {},
      byErrorType: {},
      recentActivity: []
    };
    
    // Circuit breaker states
    for (const [taskType, breaker] of this.circuitBreakers) {
      stats.overview.circuitBreakers[taskType] = breaker.state;
    }
    
    // Task type statistics
    for (const [taskType, metrics] of this.metrics.byTaskType) {
      stats.byTaskType[taskType] = {
        ...metrics,
        successRate: metrics.retrySuccesses / (metrics.retries || 1) * 100,
        permanentFailureRate: metrics.permanentFailures / (metrics.totalFailures || 1) * 100
      };
    }
    
    // Error type statistics
    for (const [errorType, metrics] of this.metrics.byErrorType) {
      stats.byErrorType[errorType] = {
        ...metrics,
        retryRate: metrics.retries / (metrics.count || 1) * 100
      };
    }
    
    // Recent activity (last hour)
    const oneHourAgo = Date.now() - 3600000;
    stats.recentActivity = this.metrics.hourlyStats
      .filter(stat => stat.timestamp > oneHourAgo)
      .slice(-100); // Last 100 events
    
    return stats;
  }
  
  /**
   * Get retry state for a task
   */
  getRetryState(taskId) {
    return this.retryState.get(taskId);
  }
  
  /**
   * Query retry history
   */
  async queryRetryHistory(options = {}) {
    const {
      taskType,
      errorType,
      status,
      startDate,
      endDate,
      limit = 100
    } = options;
    
    const results = [];
    
    // Filter active retries
    for (const [taskId, state] of this.retryState) {
      if (taskType && state.taskType !== taskType) continue;
      if (status && state.status !== status) continue;
      if (startDate && new Date(state.firstAttemptAt) < new Date(startDate)) continue;
      if (endDate && new Date(state.firstAttemptAt) > new Date(endDate)) continue;
      
      if (errorType) {
        const hasErrorType = state.errors.some(e => e.type === errorType);
        if (!hasErrorType) continue;
      }
      
      results.push(state);
    }
    
    // Sort by first attempt time (newest first)
    results.sort((a, b) => 
      new Date(b.firstAttemptAt) - new Date(a.firstAttemptAt)
    );
    
    return results.slice(0, limit);
  }
  
  /**
   * Clean up old metrics
   */
  cleanupMetrics() {
    const cutoff = Date.now() - this.options.monitoring.metricsWindow;
    
    // Clean hourly stats
    this.metrics.hourlyStats = this.metrics.hourlyStats.filter(
      stat => stat.timestamp > cutoff
    );
    
    // Clean up dead letters
    if (this.options.deadLetterQueue.enabled) {
      this.cleanupDeadLetters();
    }
  }
  
  /**
   * Clean up old dead letters
   */
  async cleanupDeadLetters() {
    const cutoffDate = Date.now() - (this.options.deadLetterQueue.retentionDays * 24 * 60 * 60 * 1000);
    
    try {
      const files = await fs.readdir(this.options.deadLetterQueue.path);
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filepath = path.join(this.options.deadLetterQueue.path, file);
        const stats = await fs.stat(filepath);
        
        if (stats.mtime.getTime() < cutoffDate) {
          await fs.unlink(filepath);
          
          // Remove from memory
          const deadLetterId = file.replace('.json', '');
          this.deadLetterQueue = this.deadLetterQueue.filter(
            dl => dl.id !== deadLetterId
          );
        }
      }
    } catch (error) {
      this.logger.error('Failed to cleanup dead letters:', error);
    }
  }
  
  /**
   * Load retry state from disk
   */
  async loadRetryState() {
    try {
      const content = await fs.readFile(this.options.statePersistence.path, 'utf8');
      const data = JSON.parse(content);
      
      // Restore retry state
      if (data.retryState) {
        this.retryState = new Map(data.retryState);
      }
      
      // Restore circuit breakers
      if (data.circuitBreakers) {
        this.circuitBreakers = new Map(data.circuitBreakers);
      }
      
      // Restore metrics
      if (data.metrics) {
        this.metrics = data.metrics;
        
        // Convert Maps
        this.metrics.byTaskType = new Map(data.metrics.byTaskType || []);
        this.metrics.byErrorType = new Map(data.metrics.byErrorType || []);
      }
      
      this.logger.info(`Loaded retry state with ${this.retryState.size} active retries`);
      
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('Failed to load retry state:', error);
      }
    }
  }
  
  /**
   * Save retry state to disk
   */
  async saveRetryState() {
    if (!this.options.statePersistence.enabled) {
      return;
    }
    
    try {
      const data = {
        retryState: Array.from(this.retryState.entries()),
        circuitBreakers: Array.from(this.circuitBreakers.entries()),
        metrics: {
          ...this.metrics,
          byTaskType: Array.from(this.metrics.byTaskType.entries()),
          byErrorType: Array.from(this.metrics.byErrorType.entries())
        },
        savedAt: new Date().toISOString()
      };
      
      const dir = path.dirname(this.options.statePersistence.path);
      await fs.mkdir(dir, { recursive: true });
      
      await fs.writeFile(
        this.options.statePersistence.path,
        JSON.stringify(data, null, 2)
      );
      
    } catch (error) {
      this.logger.error('Failed to save retry state:', error);
    }
  }
  
  /**
   * Generate retry report
   */
  async generateReport(period = 'daily') {
    const stats = this.getStatistics();
    const deadLetters = await this.getDeadLetterSummary();
    
    const report = {
      period,
      generatedAt: new Date().toISOString(),
      overview: stats.overview,
      performance: {
        byTaskType: stats.byTaskType,
        byErrorType: stats.byErrorType
      },
      deadLetters,
      recommendations: this.generateRecommendations(stats),
      alerts: this.getActiveAlerts()
    };
    
    return report;
  }
  
  /**
   * Get dead letter summary
   */
  async getDeadLetterSummary() {
    const summary = {
      total: this.deadLetterQueue.length,
      byReason: {},
      byTaskType: {},
      oldestTask: null
    };
    
    for (const dl of this.deadLetterQueue) {
      // By reason
      summary.byReason[dl.reason] = (summary.byReason[dl.reason] || 0) + 1;
      
      // By task type
      const taskType = dl.task.type || 'unknown';
      summary.byTaskType[taskType] = (summary.byTaskType[taskType] || 0) + 1;
      
      // Find oldest
      if (!summary.oldestTask || 
          new Date(dl.timestamp) < new Date(summary.oldestTask.timestamp)) {
        summary.oldestTask = {
          id: dl.id,
          taskId: dl.task.id,
          timestamp: dl.timestamp,
          reason: dl.reason
        };
      }
    }
    
    return summary;
  }
  
  /**
   * Generate recommendations based on statistics
   */
  generateRecommendations(stats) {
    const recommendations = [];
    
    // Check for high failure rates
    for (const [taskType, metrics] of Object.entries(stats.byTaskType)) {
      if (metrics.permanentFailureRate > 20) {
        recommendations.push({
          type: 'high-failure-rate',
          severity: 'warning',
          taskType,
          message: `Task type ${taskType} has a high permanent failure rate (${metrics.permanentFailureRate.toFixed(1)}%). Consider reviewing the task implementation.`
        });
      }
      
      if (metrics.successRate < 50 && metrics.retries > 10) {
        recommendations.push({
          type: 'low-retry-success',
          severity: 'warning',
          taskType,
          message: `Task type ${taskType} has a low retry success rate (${metrics.successRate.toFixed(1)}%). Consider adjusting retry strategies.`
        });
      }
    }
    
    // Check for dominant error types
    for (const [errorType, metrics] of Object.entries(stats.byErrorType)) {
      if (metrics.count > 50 && metrics.retryRate < 30) {
        recommendations.push({
          type: 'non-retryable-errors',
          severity: 'info',
          errorType,
          message: `Error type ${errorType} has many occurrences but low retry rate. Consider if these errors should be retryable.`
        });
      }
    }
    
    // Check circuit breakers
    const openCircuits = Object.entries(stats.overview.circuitBreakers)
      .filter(([_, state]) => state === 'open');
    
    if (openCircuits.length > 0) {
      recommendations.push({
        type: 'open-circuits',
        severity: 'critical',
        taskTypes: openCircuits.map(([type, _]) => type),
        message: `Circuit breakers are open for: ${openCircuits.map(([type, _]) => type).join(', ')}. These task types are currently blocked.`
      });
    }
    
    return recommendations;
  }
  
  /**
   * Get active alerts
   */
  getActiveAlerts() {
    // This would integrate with an alert management system
    // For now, return empty array
    return [];
  }
  
  /**
   * Shutdown handler
   */
  async shutdown() {
    this.logger.info('Shutting down TaskRetryManager');
    
    // Clear intervals
    if (this.stateSaveInterval) {
      clearInterval(this.stateSaveInterval);
    }
    
    if (this.metricsCleanupInterval) {
      clearInterval(this.metricsCleanupInterval);
    }
    
    // Save final state
    await this.saveRetryState();
    
    this.emit('shutdown');
  }
}

module.exports = TaskRetryManager;