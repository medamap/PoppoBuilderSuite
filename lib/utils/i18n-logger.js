/**
 * I18n Logger
 * Provides internationalized logging capabilities
 */

const { t } = require('../i18n');

class I18nLogger {
  constructor(logger) {
    this.logger = logger;
    this.category = logger.category || 'default';
  }

  /**
   * Log with i18n support
   * @param {string} level - Log level
   * @param {string} messageKey - Translation key or raw message
   * @param {Object} data - Data for interpolation and metadata
   */
  async log(level, messageKey, data = {}) {
    let message;
    
    // Check if messageKey looks like a translation key (contains : or .)
    if (messageKey.includes(':') || messageKey.includes('.')) {
      // Try to translate
      const translated = t(messageKey, data);
      // If translation found (not same as key), use it
      message = translated !== messageKey ? translated : messageKey;
    } else {
      // Use as raw message
      message = messageKey;
    }

    // Call the underlying logger
    if (this.logger.log) {
      await this.logger.log(level, this.category, message, data);
    } else {
      // Fallback for simple loggers
      const method = this.logger[level] || this.logger.info;
      if (method) {
        method.call(this.logger, message, data);
      }
    }
  }

  // Convenience methods
  async info(messageKey, data) {
    return this.log('info', messageKey, data);
  }

  async warn(messageKey, data) {
    return this.log('warn', messageKey, data);
  }

  async error(messageKey, data) {
    return this.log('error', messageKey, data);
  }

  async debug(messageKey, data) {
    return this.log('debug', messageKey, data);
  }

  // System logging with i18n
  async logSystem(eventKey, data) {
    const messageKey = `messages:system.${eventKey.toLowerCase()}`;
    return this.log('info', messageKey, data);
  }

  // Issue logging with i18n
  async logIssue(issueNumber, eventKey, data) {
    const messageKey = `messages:issue.${eventKey.toLowerCase()}`;
    const issueData = { issueNumber, ...data };
    
    if (this.logger.logIssue) {
      // If the underlying logger has logIssue, use translated message
      const message = t(messageKey, issueData);
      await this.logger.logIssue(issueNumber, eventKey, { ...data, message });
    } else {
      // Otherwise use regular log
      return this.log('info', messageKey, issueData);
    }
  }

  // Agent logging with i18n
  async logAgent(agentName, eventKey, data) {
    const messageKey = `messages:agent.${eventKey.toLowerCase()}`;
    const agentData = { name: agentName, ...data };
    return this.log('info', messageKey, agentData);
  }

  // Task logging with i18n
  async logTask(taskId, eventKey, data) {
    const messageKey = `messages:task.${eventKey.toLowerCase()}`;
    const taskData = { id: taskId, ...data };
    return this.log('info', messageKey, taskData);
  }

  // Process logging with i18n
  async logProcess(pid, eventKey, data) {
    const messageKey = `messages:process.${eventKey.toLowerCase()}`;
    const processData = { pid, ...data };
    return this.log('info', messageKey, processData);
  }

  // Wrap an existing logger with i18n support
  static wrap(logger) {
    // If already wrapped, return as is
    if (logger instanceof I18nLogger) {
      return logger;
    }
    
    // Create a new I18nLogger wrapper
    const i18nLogger = new I18nLogger(logger);
    
    // Preserve any custom properties/methods from the original logger
    const descriptors = Object.getOwnPropertyDescriptors(logger);
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (key === 'constructor') continue;
      if (typeof descriptor.value === 'function' && !i18nLogger[key]) {
        // Wrap methods that aren't already defined
        i18nLogger[key] = descriptor.value.bind(logger);
      } else if (!i18nLogger.hasOwnProperty(key)) {
        // Copy properties
        Object.defineProperty(i18nLogger, key, descriptor);
      }
    }
    
    return i18nLogger;
  }
}

module.exports = I18nLogger;