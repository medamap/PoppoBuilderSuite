/**
 * State Manager Factory
 * 
 * Factory for creating state managers based on configuration
 * Supports both file-based and Redis-based state management
 */

const path = require('path');
const StateManagerBase = require('./state-manager-base');
const FileStateManager = require('./file-state-manager');
const RedisStateManager = require('./redis-state-manager');
const { getInstance: getGlobalConfig } = require('../core/global-config-manager');

class StateManagerFactory {
  /**
   * Create a state manager instance based on configuration
   * @param {Object} options - State manager options
   * @param {string} options.projectPath - Project path for file-based storage
   * @param {string} options.projectId - Project ID for namespacing
   * @param {Object} options.config - Optional override configuration
   * @returns {StateManagerBase} State manager instance
   */
  static async create(options = {}) {
    const { projectPath, projectId, config: overrideConfig } = options;
    
    // Get global configuration
    const globalConfig = getGlobalConfig();
    const config = overrideConfig || await globalConfig.load();
    
    // Determine state management type
    const stateConfig = config.stateManagement || { type: 'file' };
    const stateType = stateConfig.type;
    
    switch (stateType) {
      case 'redis':
        return this.createRedisManager(projectId, stateConfig.redis);
        
      case 'file':
      default:
        return this.createFileManager(projectPath, projectId, stateConfig.file);
    }
  }
  
  /**
   * Create file-based state manager
   * @private
   */
  static createFileManager(projectPath, projectId, fileConfig = {}) {
    if (!projectPath) {
      throw new Error('Project path is required for file-based state management');
    }
    
    const stateDir = path.join(projectPath, '.poppo', 'state');
    const options = {
      stateDir,
      projectId,
      syncInterval: fileConfig.syncInterval || 5000,
      compactionInterval: fileConfig.compactionInterval || 86400000, // 24 hours
      maxBackups: fileConfig.maxBackups || 5,
      enableCompression: fileConfig.enableCompression || false
    };
    
    return new FileStateManager(options);
  }
  
  /**
   * Create Redis-based state manager
   * @private
   */
  static createRedisManager(projectId, redisConfig = {}) {
    if (!projectId) {
      throw new Error('Project ID is required for Redis state management');
    }
    
    const options = {
      projectId,
      redis: {
        host: redisConfig.host || '127.0.0.1',
        port: redisConfig.port || 6379,
        password: redisConfig.password,
        db: redisConfig.db || 0,
        keyPrefix: redisConfig.keyPrefix || 'poppo:',
        retryDelayOnFailover: redisConfig.retryDelayOnFailover || 100,
        enableReadyCheck: redisConfig.enableReadyCheck !== false,
        maxRetriesPerRequest: redisConfig.maxRetriesPerRequest || 3,
        connectTimeout: redisConfig.connectTimeout || 10000,
        keepAlive: redisConfig.keepAlive !== false,
        lazyConnect: redisConfig.lazyConnect || false
      },
      ttl: {
        completed: redisConfig.ttl?.completed || 7 * 24 * 60 * 60, // 7 days
        error: redisConfig.ttl?.error || 3 * 24 * 60 * 60, // 3 days
        running: redisConfig.ttl?.running || 24 * 60 * 60, // 1 day
        default: redisConfig.ttl?.default || 30 * 24 * 60 * 60 // 30 days
      }
    };
    
    return new RedisStateManager(options);
  }
  
  /**
   * Check if Redis is configured and available
   * @returns {Promise<boolean>}
   */
  static async isRedisConfigured() {
    try {
      const globalConfig = getGlobalConfig();
      const config = await globalConfig.load();
      
      return config.stateManagement?.type === 'redis';
    } catch (error) {
      return false;
    }
  }
  
  /**
   * Get current state management type
   * @returns {Promise<string>} 'redis' or 'file'
   */
  static async getStateType() {
    try {
      const globalConfig = getGlobalConfig();
      const config = await globalConfig.load();
      
      return config.stateManagement?.type || 'file';
    } catch (error) {
      return 'file';
    }
  }
  
  /**
   * Validate state manager configuration
   * @param {Object} config - Configuration to validate
   * @returns {Object} Validation result { valid: boolean, errors: string[] }
   */
  static validateConfig(config) {
    const errors = [];
    
    if (!config.stateManagement) {
      errors.push('State management configuration is missing');
      return { valid: false, errors };
    }
    
    const { type } = config.stateManagement;
    
    if (!['file', 'redis'].includes(type)) {
      errors.push(`Invalid state management type: ${type}`);
    }
    
    if (type === 'redis') {
      const redis = config.stateManagement.redis;
      if (!redis) {
        errors.push('Redis configuration is missing');
      } else {
        if (!redis.host) errors.push('Redis host is required');
        if (!redis.port || redis.port < 1 || redis.port > 65535) {
          errors.push('Redis port must be between 1 and 65535');
        }
      }
    }
    
    if (type === 'file') {
      const file = config.stateManagement.file;
      if (file) {
        if (file.syncInterval && file.syncInterval < 1000) {
          errors.push('File sync interval must be at least 1000ms');
        }
        if (file.compactionInterval && file.compactionInterval < 60000) {
          errors.push('File compaction interval must be at least 60000ms');
        }
      }
    }
    
    return { valid: errors.length === 0, errors };
  }
}

module.exports = StateManagerFactory;