/**
 * Storage Factory
 * Creates and manages storage adapters based on configuration
 */

const JsonStorage = require('./json-storage');
const SqliteStorage = require('./sqlite-storage');
const RedisStorage = require('./redis-storage');

class StorageFactory {
  /**
   * Create a storage adapter based on type
   * @param {string} type - Storage type (json, sqlite, redis)
   * @param {Object} options - Storage-specific options
   * @returns {BaseStorage} Storage adapter instance
   */
  static create(type, options = {}) {
    switch (type.toLowerCase()) {
      case 'json':
      case 'file':
        return new JsonStorage(options);
        
      case 'sqlite':
      case 'sql':
        return new SqliteStorage(options);
        
      case 'redis':
        return new RedisStorage(options);
        
      default:
        throw new Error(`Unknown storage type: ${type}`);
    }
  }

  /**
   * Create storage adapter from configuration object
   * @param {Object} config - Configuration object
   * @returns {BaseStorage} Storage adapter instance
   */
  static createFromConfig(config) {
    const { type = 'json', ...options } = config;
    return this.create(type, options);
  }

  /**
   * Get available storage types
   * @returns {Array} List of available storage types
   */
  static getAvailableTypes() {
    return ['json', 'sqlite', 'redis'];
  }

  /**
   * Check if a storage type is available
   * @param {string} type - Storage type to check
   * @returns {boolean} True if available
   */
  static isTypeAvailable(type) {
    // Check if required dependencies are installed
    switch (type.toLowerCase()) {
      case 'json':
      case 'file':
        return true; // Always available
        
      case 'sqlite':
      case 'sql':
        try {
          require.resolve('sqlite3');
          return true;
        } catch {
          return false;
        }
        
      case 'redis':
        try {
          require.resolve('redis');
          return true;
        } catch {
          return false;
        }
        
      default:
        return false;
    }
  }

  /**
   * Get default options for a storage type
   * @param {string} type - Storage type
   * @returns {Object} Default options
   */
  static getDefaultOptions(type) {
    switch (type.toLowerCase()) {
      case 'json':
      case 'file':
        return {
          backupCount: 5,
          compressBackups: false
        };
        
      case 'sqlite':
      case 'sql':
        return {
          busyTimeout: 5000,
          walMode: true
        };
        
      case 'redis':
        return {
          host: 'localhost',
          port: 6379,
          db: 0
        };
        
      default:
        return {};
    }
  }

  /**
   * Create a custom storage adapter
   * @param {BaseStorage} StorageClass - Custom storage class
   * @param {Object} options - Storage options
   * @returns {BaseStorage} Storage adapter instance
   */
  static createCustom(StorageClass, options = {}) {
    return new StorageClass(options);
  }
}

module.exports = StorageFactory;