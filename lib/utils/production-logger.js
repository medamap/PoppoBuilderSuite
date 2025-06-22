/**
 * Issue #125: Production-Ready Logging System
 * 
 * Enhanced logging system for production environments with:
 * - Structured logging (JSON)
 * - Log aggregation and centralization
 * - Performance monitoring
 * - Security audit logging
 * - Error correlation and tracing
 * - Configurable log retention
 */

const { MultiLogger } = require('./multi-logger');
const LoggerAdapter = require('./logger-adapter');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * Production Logger with enhanced features
 */
class ProductionLogger extends LoggerAdapter {
  constructor(category, options = {}) {
    super(category, options);
    
    this.productionOptions = {
      enableStructuredLogging: options.enableStructuredLogging !== false,
      enablePerformanceTracking: options.enablePerformanceTracking !== false,
      enableSecurityAudit: options.enableSecurityAudit !== false,
      enableErrorCorrelation: options.enableErrorCorrelation !== false,
      logRetentionDays: options.logRetentionDays || 30,
      maxLogFileSize: options.maxLogFileSize || 100 * 1024 * 1024, // 100MB
      compressionEnabled: options.compressionEnabled !== false,
      sensitiveDataMasking: options.sensitiveDataMasking !== false,
      ...options
    };
    
    this.correlationMap = new Map();
    this.performanceMetrics = new Map();
    this.securityEvents = [];
    
    // Initialize correlation ID for this session
    this.sessionId = this.generateCorrelationId();
    
    // Setup cleanup intervals
    this.setupCleanupSchedule();
  }

  /**
   * Generate unique correlation ID
   */
  generateCorrelationId() {
    return crypto.randomUUID();
  }

  /**
   * Enhanced structured logging
   */
  async logStructured(level, message, context = {}) {
    await this.ensureInitialized();

    const timestamp = new Date().toISOString();
    const correlationId = context.correlationId || this.generateCorrelationId();
    
    const structuredLog = {
      timestamp,
      level: level.toUpperCase(),
      message: this.productionOptions.sensitiveDataMasking ? this.maskSensitiveData(message) : message,
      category: this.category,
      sessionId: this.sessionId,
      correlationId,
      component: context.component || this.component,
      projectId: context.projectId || this.projectId,
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '1.0.0',
      hostname: require('os').hostname(),
      pid: process.pid,
      metadata: this.productionOptions.sensitiveDataMasking ? 
        this.maskSensitiveData(context.metadata) : context.metadata,
      performance: context.performance,
      security: context.security,
      error: context.error ? {
        name: context.error.name,
        message: context.error.message,
        stack: context.error.stack,
        code: context.error.code
      } : undefined
    };

    // Store correlation for error tracking
    if (this.productionOptions.enableErrorCorrelation && level === 'error') {
      this.correlationMap.set(correlationId, {
        timestamp,
        message,
        context,
        sessionId: this.sessionId
      });
    }

    // Log to MultiLogger
    await this.multiLogger.log(level, JSON.stringify(structuredLog), {
      component: this.component,
      projectId: this.projectId,
      metadata: structuredLog
    });

    return correlationId;
  }

  /**
   * Performance tracking
   */
  startPerformanceTimer(operationId) {
    if (!this.productionOptions.enablePerformanceTracking) return null;
    
    const startTime = process.hrtime.bigint();
    const timer = {
      operationId,
      startTime,
      sessionId: this.sessionId
    };
    
    this.performanceMetrics.set(operationId, timer);
    return timer;
  }

  async endPerformanceTimer(operationId, additionalContext = {}) {
    if (!this.productionOptions.enablePerformanceTracking) return;
    
    const timer = this.performanceMetrics.get(operationId);
    if (!timer) return;
    
    const endTime = process.hrtime.bigint();
    const duration = Number(endTime - timer.startTime) / 1000000; // Convert to milliseconds
    
    const performanceData = {
      operationId,
      duration,
      startTime: new Date(Date.now() - duration).toISOString(),
      endTime: new Date().toISOString(),
      sessionId: this.sessionId,
      ...additionalContext
    };
    
    await this.logStructured('info', `Performance: ${operationId} completed`, {
      performance: performanceData,
      ...additionalContext
    });
    
    this.performanceMetrics.delete(operationId);
    return performanceData;
  }

  /**
   * Security audit logging
   */
  async logSecurityEvent(event, details, severity = 'medium') {
    if (!this.productionOptions.enableSecurityAudit) return;
    
    const securityEvent = {
      id: this.generateCorrelationId(),
      event,
      severity,
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      userAgent: details.userAgent,
      ip: details.ip,
      userId: details.userId,
      action: details.action,
      resource: details.resource,
      result: details.result,
      reason: details.reason,
      metadata: details.metadata
    };
    
    this.securityEvents.push(securityEvent);
    
    await this.logStructured('warn', `Security Event: ${event}`, {
      security: securityEvent,
      component: 'SecurityAudit'
    });
    
    // Keep only recent security events in memory
    if (this.securityEvents.length > 1000) {
      this.securityEvents = this.securityEvents.slice(-500);
    }
    
    return securityEvent.id;
  }

  /**
   * Error correlation and tracking
   */
  async logCorrelatedError(error, originalCorrelationId, additionalContext = {}) {
    const correlationId = this.generateCorrelationId();
    
    let rootCause = null;
    if (originalCorrelationId && this.correlationMap.has(originalCorrelationId)) {
      rootCause = this.correlationMap.get(originalCorrelationId);
    }
    
    await this.logStructured('error', error.message || String(error), {
      error: error instanceof Error ? error : new Error(String(error)),
      correlationId,
      rootCause,
      component: 'ErrorCorrelation',
      ...additionalContext
    });
    
    return correlationId;
  }

  /**
   * Mask sensitive data
   */
  maskSensitiveData(data) {
    if (!data || typeof data !== 'object') {
      if (typeof data === 'string') {
        return data.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '***@***.***')
                  .replace(/(password|token|key|secret)["\s]*[:=]["\s]*[^,}\s]*/gi, '$1":"***"')
                  .replace(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, '****-****-****-****');
      }
      return data;
    }
    
    const masked = Array.isArray(data) ? [] : {};
    
    for (const [key, value] of Object.entries(data)) {
      const keyLower = key.toLowerCase();
      
      if (['password', 'token', 'secret', 'key', 'auth', 'credential'].some(sensitive => 
          keyLower.includes(sensitive))) {
        masked[key] = '***';
      } else if (keyLower.includes('email')) {
        masked[key] = typeof value === 'string' ? 
          value.replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '***@***.***') : 
          '***';
      } else if (typeof value === 'object') {
        masked[key] = this.maskSensitiveData(value);
      } else {
        masked[key] = value;
      }
    }
    
    return masked;
  }

  /**
   * Log retention and cleanup
   */
  async cleanupOldLogs() {
    try {
      const logsDir = this.logDir;
      const retentionDate = new Date();
      retentionDate.setDate(retentionDate.getDate() - this.productionOptions.logRetentionDays);
      
      const files = await fs.readdir(logsDir);
      
      for (const file of files) {
        const filePath = path.join(logsDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < retentionDate) {
          await fs.unlink(filePath);
          await this.logStructured('info', `Cleaned up old log file: ${file}`, {
            component: 'LogRetention',
            metadata: { filePath, age: Date.now() - stats.mtime.getTime() }
          });
        }
      }
    } catch (error) {
      await this.logStructured('error', 'Failed to cleanup old logs', {
        error,
        component: 'LogRetention'
      });
    }
  }

  /**
   * Setup cleanup schedule
   */
  setupCleanupSchedule() {
    // Run cleanup daily
    const cleanupInterval = setInterval(() => {
      this.cleanupOldLogs().catch(console.error);
    }, 24 * 60 * 60 * 1000); // 24 hours
    
    // Cleanup correlation map every hour
    const correlationCleanup = setInterval(() => {
      const oneHourAgo = Date.now() - (60 * 60 * 1000);
      for (const [id, data] of this.correlationMap.entries()) {
        if (new Date(data.timestamp).getTime() < oneHourAgo) {
          this.correlationMap.delete(id);
        }
      }
    }, 60 * 60 * 1000); // 1 hour
    
    // Ensure cleanup on exit
    process.on('beforeExit', () => {
      clearInterval(cleanupInterval);
      clearInterval(correlationCleanup);
    });
  }

  /**
   * Generate production health report
   */
  async generateHealthReport() {
    const report = {
      timestamp: new Date().toISOString(),
      sessionId: this.sessionId,
      loggerHealth: {
        initialized: this.initPromise === null,
        activeCorrelations: this.correlationMap.size,
        activePerformanceTimers: this.performanceMetrics.size,
        securityEventsCount: this.securityEvents.length
      },
      configuration: {
        structuredLogging: this.productionOptions.enableStructuredLogging,
        performanceTracking: this.productionOptions.enablePerformanceTracking,
        securityAudit: this.productionOptions.enableSecurityAudit,
        errorCorrelation: this.productionOptions.enableErrorCorrelation,
        retentionDays: this.productionOptions.logRetentionDays,
        sensitiveDataMasking: this.productionOptions.sensitiveDataMasking
      },
      recentSecurityEvents: this.securityEvents.slice(-10),
      environment: {
        nodeEnv: process.env.NODE_ENV,
        hostname: require('os').hostname(),
        pid: process.pid,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage()
      }
    };

    await this.logStructured('info', 'Production Logger Health Report', {
      component: 'HealthCheck',
      metadata: report
    });

    return report;
  }

  /**
   * Enhanced logging methods with production features
   */
  async info(message, context = {}) {
    if (this.productionOptions.enableStructuredLogging) {
      return this.logStructured('info', message, context);
    }
    return super.info(message, context);
  }

  async error(message, context = {}) {
    if (this.productionOptions.enableStructuredLogging) {
      return this.logStructured('error', message, context);
    }
    return super.error(message, context);
  }

  async warn(message, context = {}) {
    if (this.productionOptions.enableStructuredLogging) {
      return this.logStructured('warn', message, context);
    }
    return super.warn(message, context);
  }

  async debug(message, context = {}) {
    if (this.productionOptions.enableStructuredLogging) {
      return this.logStructured('debug', message, context);
    }
    return super.debug(message, context);
  }
}

module.exports = ProductionLogger;