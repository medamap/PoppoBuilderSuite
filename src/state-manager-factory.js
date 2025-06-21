const path = require('path');

/**
 * StateManagerFactory
 * 
 * 設定に基づいて適切なStateManagerを選択・作成するファクトリークラス
 */
class StateManagerFactory {
  static createUnifiedStateManager(config, stateDir = null) {
    const unifiedConfig = config.unifiedStateManagement || {};
    const backend = unifiedConfig.backend || 'file';
    const statePath = stateDir || path.join(__dirname, '../state');

    if (backend === 'redis' && unifiedConfig.redis && unifiedConfig.redis.enabled) {
      // Redis版を使用
      const UnifiedStateManagerRedis = require('./unified-state-manager-redis');
      const options = {
        ...unifiedConfig.redis,
        redis: {
          host: unifiedConfig.redis.host,
          port: unifiedConfig.redis.port,
          password: unifiedConfig.redis.password,
          db: unifiedConfig.redis.db
        }
      };
      return new UnifiedStateManagerRedis(statePath, options);
    } else {
      // ファイル版を使用
      const UnifiedStateManager = require('./unified-state-manager');
      return new UnifiedStateManager(statePath);
    }
  }

  static createStatusManager(config, configPath = null) {
    const unifiedConfig = config.unifiedStateManagement || {};
    const backend = unifiedConfig.backend || 'file';
    const statePath = configPath || path.join(__dirname, '../state');

    if (backend === 'redis' && unifiedConfig.redis && unifiedConfig.redis.enabled) {
      // Redis版を使用
      const StatusManagerRedis = require('./status-manager-redis');
      const options = {
        ...unifiedConfig.redis,
        redis: {
          host: unifiedConfig.redis.host,
          port: unifiedConfig.redis.port,
          password: unifiedConfig.redis.password,
          db: unifiedConfig.redis.db
        }
      };
      return new StatusManagerRedis(statePath, options);
    } else {
      // Unified版を使用（ファイルベース）
      const StatusManagerUnified = require('./status-manager-unified');
      return new StatusManagerUnified(statePath);
    }
  }

  static getBackendType(config) {
    const unifiedConfig = config.unifiedStateManagement || {};
    if (unifiedConfig.backend === 'redis' && unifiedConfig.redis && unifiedConfig.redis.enabled) {
      return 'redis';
    }
    return 'file';
  }

  static isRedisBackend(config) {
    return this.getBackendType(config) === 'redis';
  }

  static isFileBackend(config) {
    return this.getBackendType(config) === 'file';
  }

  /**
   * 設定の検証
   */
  static validateConfig(config) {
    const unifiedConfig = config.unifiedStateManagement || {};
    
    if (!unifiedConfig.enabled) {
      return { valid: false, error: 'Unified state management is not enabled' };
    }

    if (unifiedConfig.backend === 'redis') {
      if (!unifiedConfig.redis) {
        return { valid: false, error: 'Redis configuration is missing' };
      }
      
      if (!unifiedConfig.redis.enabled) {
        return { valid: false, error: 'Redis backend is not enabled' };
      }
      
      if (!unifiedConfig.redis.host || !unifiedConfig.redis.port) {
        return { valid: false, error: 'Redis host or port is missing' };
      }
    }

    return { valid: true };
  }

  /**
   * 設定情報の取得
   */
  static getConfigInfo(config) {
    const validation = this.validateConfig(config);
    const backend = this.getBackendType(config);
    
    return {
      ...validation,
      backend,
      isRedis: backend === 'redis',
      isFile: backend === 'file',
      config: config.unifiedStateManagement
    };
  }
}

module.exports = StateManagerFactory;