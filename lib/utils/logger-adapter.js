/**
 * Logger Adapter
 * Provides backward compatibility with existing Logger interface
 * while using MultiLogger internally
 */

const { MultiLogger, getInstance: getMultiLoggerInstance } = require('./multi-logger');
const path = require('path');
const os = require('os');

/**
 * LoggerAdapter class
 * Adapts the old Logger interface to use MultiLogger
 */
class LoggerAdapter {
  constructor(category, options = {}) {
    // Handle backward compatibility with the old constructor
    if (typeof category === 'string' && category.includes(path.sep)) {
      // Old style: new Logger('/path/to/logs')
      this.logDir = category;
      this.category = 'default';
      this.options = options;
    } else {
      // New style: new Logger('ModuleName', { logDir: '...' })
      this.category = category || 'default';
      this.logDir = options.logDir || path.join(process.cwd(), 'logs');
      this.options = options;
    }

    // Get the shared MultiLogger instance
    this.multiLogger = getMultiLoggerInstance({
      globalLogDir: path.join(os.homedir(), '.poppobuilder', 'logs'),
      logLevel: options.logLevel || 'info'
    });

    // Initialize if not already done
    this.initPromise = this.multiLogger.initialize().catch(err => {
      console.error('Failed to initialize MultiLogger:', err);
    });

    // Determine if this is a project-specific logger
    this.projectId = options.projectId || this.detectProjectId();
    this.component = this.category;
  }

  /**
   * Detect project ID from log directory path
   */
  detectProjectId() {
    // Try to detect project from path
    const match = this.logDir.match(/projects[\/\\]([^\/\\]+)/);
    return match ? match[1] : null;
  }

  /**
   * Ensure logger is initialized before use
   */
  async ensureInitialized() {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
  }

  /**
   * Log method - compatible with old Logger interface
   */
  async log(level, category, message, data = null) {
    await this.ensureInitialized();

    const options = {
      component: category || this.component,
      projectId: this.projectId,
      metadata: data
    };

    // Handle error objects
    if (data instanceof Error) {
      options.error = data;
      options.metadata = undefined;
    }

    await this.multiLogger.log(level.toLowerCase(), message, options);
  }

  /**
   * Issue-specific logging
   */
  async logIssue(issueNumber, event, details) {
    await this.ensureInitialized();

    const options = {
      component: `Issue#${issueNumber}`,
      projectId: this.projectId,
      metadata: {
        issueNumber,
        event,
        ...details
      }
    };

    await this.multiLogger.info(`[Issue #${issueNumber}] ${event}`, options);
  }

  /**
   * Process-specific logging
   */
  async logProcess(taskId, event, details) {
    await this.ensureInitialized();

    const options = {
      component: `Process:${taskId}`,
      projectId: this.projectId,
      metadata: {
        taskId,
        event,
        ...details
      }
    };

    await this.multiLogger.info(`[Process ${taskId}] ${event}`, options);
  }

  /**
   * Convenience methods
   */
  async info(category, message, data) {
    if (arguments.length === 1) {
      // Single argument: info(message)
      return this.log('info', this.component, category);
    } else if (arguments.length === 2 && typeof category === 'string') {
      // Two arguments: could be info(message, data) or info(category, message)
      if (typeof message === 'object') {
        return this.log('info', this.component, category, message);
      } else {
        return this.log('info', category, message);
      }
    }
    return this.log('info', category, message, data);
  }

  async error(category, message, data) {
    if (arguments.length === 1) {
      return this.log('error', this.component, category);
    } else if (arguments.length === 2 && typeof category === 'string') {
      if (typeof message === 'object') {
        return this.log('error', this.component, category, message);
      } else {
        return this.log('error', category, message);
      }
    }
    return this.log('error', category, message, data);
  }

  async warn(category, message, data) {
    if (arguments.length === 1) {
      return this.log('warn', this.component, category);
    } else if (arguments.length === 2 && typeof category === 'string') {
      if (typeof message === 'object') {
        return this.log('warn', this.component, category, message);
      } else {
        return this.log('warn', category, message);
      }
    }
    return this.log('warn', category, message, data);
  }

  async debug(category, message, data) {
    if (arguments.length === 1) {
      return this.log('debug', this.component, category);
    } else if (arguments.length === 2 && typeof category === 'string') {
      if (typeof message === 'object') {
        return this.log('debug', this.component, category, message);
      } else {
        return this.log('debug', category, message);
      }
    }
    return this.log('debug', category, message, data);
  }

  /**
   * Register a project for project-specific logging
   */
  async registerProject(projectId, projectPath) {
    await this.ensureInitialized();
    await this.multiLogger.registerProject(projectId, projectPath);
    this.projectId = projectId;
  }

  /**
   * Get the underlying MultiLogger instance
   */
  getMultiLogger() {
    return this.multiLogger;
  }
}

module.exports = LoggerAdapter;