/**
 * Global Configuration Manager
 * Manages PoppoBuilder's global configuration stored in ~/.poppobuilder/config.json
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { validate, defaultConfig } = require('../schemas/global-config-schema');
const EventEmitter = require('events');

class GlobalConfigManager extends EventEmitter {
  constructor() {
    super();
    this.configDir = path.join(os.homedir(), '.poppobuilder');
    this.configPath = path.join(this.configDir, 'config.json');
    this.config = null;
    this.fileWatcher = null;
    this.saveTimeout = null;
  }

  /**
   * Initialize the global configuration
   * Creates config directory and file if they don't exist
   */
  async initialize() {
    try {
      // Ensure config directory exists
      await this.ensureConfigDirectory();

      // Load or create configuration
      if (await this.exists()) {
        await this.load();
      } else {
        await this.createDefault();
      }

      // Start watching for changes
      this.startWatching();

      this.emit('initialized', this.config);
      return this.config;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to initialize global config: ${error.message}`);
    }
  }

  /**
   * Ensure the config directory exists
   */
  async ensureConfigDirectory() {
    try {
      await fs.mkdir(this.configDir, { recursive: true });
      
      // Also create logs directory
      const logsDir = path.join(this.configDir, 'logs');
      await fs.mkdir(logsDir, { recursive: true });
      
      // Create projects registry directory
      const projectsDir = path.join(this.configDir, 'projects');
      await fs.mkdir(projectsDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
    }
  }

  /**
   * Check if config file exists
   */
  async exists() {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create default configuration
   */
  async createDefault() {
    this.config = JSON.parse(JSON.stringify(defaultConfig));
    await this.save();
    this.emit('created', this.config);
    return this.config;
  }

  /**
   * Load configuration from file
   */
  async load() {
    try {
      const content = await fs.readFile(this.configPath, 'utf8');
      const parsed = JSON.parse(content);
      
      // Validate configuration
      if (!this.validateConfig(parsed)) {
        throw new Error('Invalid configuration format');
      }
      
      // Merge with defaults to ensure all fields exist
      this.config = this.mergeWithDefaults(parsed);
      
      this.emit('loaded', this.config);
      return this.config;
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to load config: ${error.message}`);
    }
  }

  /**
   * Save configuration to file
   */
  async save() {
    try {
      // Cancel any pending save
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
        this.saveTimeout = null;
      }

      // Validate before saving
      if (!this.validateConfig(this.config)) {
        throw new Error('Invalid configuration');
      }

      // Write atomically
      const tempPath = `${this.configPath}.tmp`;
      await fs.writeFile(tempPath, JSON.stringify(this.config, null, 2));
      await fs.rename(tempPath, this.configPath);
      
      this.emit('saved', this.config);
    } catch (error) {
      this.emit('error', error);
      throw new Error(`Failed to save config: ${error.message}`);
    }
  }

  /**
   * Save configuration with debouncing
   */
  async saveDebounced(delay = 1000) {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
    }
    
    this.saveTimeout = setTimeout(() => {
      this.save().catch(error => {
        this.emit('error', error);
      });
    }, delay);
  }

  /**
   * Get configuration value by path
   * @param {string} keyPath - Dot-separated path (e.g., 'daemon.maxProcesses')
   */
  get(keyPath) {
    if (!this.config) {
      return undefined;
    }

    const keys = keyPath.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }
    
    return value;
  }

  /**
   * Set configuration value by path
   * @param {string} keyPath - Dot-separated path
   * @param {any} value - Value to set
   */
  async set(keyPath, value) {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    const keys = keyPath.split('.');
    let current = this.config;
    
    // Navigate to the parent object
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    // Set the value
    const lastKey = keys[keys.length - 1];
    const oldValue = current[lastKey];
    current[lastKey] = value;
    
    // Validate the updated config
    if (!this.validateConfig(this.config)) {
      // Rollback on validation failure
      current[lastKey] = oldValue;
      throw new Error(`Invalid value for ${keyPath}`);
    }
    
    // Save with debouncing
    await this.saveDebounced();
    
    this.emit('changed', { path: keyPath, oldValue, newValue: value });
  }

  /**
   * Update multiple configuration values
   * @param {object} updates - Object with configuration updates
   */
  async update(updates) {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }

    const oldConfig = JSON.parse(JSON.stringify(this.config));
    
    try {
      // Deep merge updates
      this.config = this.deepMerge(this.config, updates);
      
      // Validate the updated config
      if (!this.validateConfig(this.config)) {
        throw new Error('Invalid configuration after update');
      }
      
      await this.save();
      this.emit('updated', { oldConfig, newConfig: this.config });
    } catch (error) {
      // Rollback on error
      this.config = oldConfig;
      throw error;
    }
  }

  /**
   * Reset configuration to defaults
   */
  async reset() {
    const oldConfig = this.config;
    this.config = JSON.parse(JSON.stringify(defaultConfig));
    await this.save();
    this.emit('reset', { oldConfig, newConfig: this.config });
  }

  /**
   * Validate configuration against schema
   */
  validateConfig(config) {
    const valid = validate(config);
    if (!valid) {
      const errors = validate.errors.map(err => 
        `${err.dataPath} ${err.message}`
      ).join(', ');
      
      // Temporary debug logging
      console.error('❌ Configuration validation failed:');
      console.error('Errors:', JSON.stringify(validate.errors, null, 2));
      console.error('Config being validated:', JSON.stringify(config, null, 2));
      
      this.emit('validation-error', { errors: validate.errors, message: errors });
      return false;
    }
    return true;
  }

  /**
   * Merge configuration with defaults
   */
  mergeWithDefaults(config) {
    return this.deepMerge(JSON.parse(JSON.stringify(defaultConfig)), config);
  }

  /**
   * Deep merge two objects
   */
  deepMerge(target, source) {
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this.deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
    return target;
  }

  /**
   * Start watching config file for external changes
   */
  startWatching() {
    if (this.fileWatcher) {
      return;
    }

    const fs = require('fs');
    let lastMtime = null;

    this.fileWatcher = fs.watchFile(this.configPath, { interval: 1000 }, async (curr, prev) => {
      // Check if file was modified
      if (curr.mtime > prev.mtime && curr.mtime !== lastMtime) {
        lastMtime = curr.mtime;
        try {
          await this.load();
          this.emit('external-change', this.config);
        } catch (error) {
          this.emit('error', error);
        }
      }
    });
  }

  /**
   * Stop watching config file
   */
  stopWatching() {
    if (this.fileWatcher) {
      const fs = require('fs');
      fs.unwatchFile(this.configPath);
      this.fileWatcher = null;
    }
  }

  /**
   * Get all configuration
   */
  getAll() {
    return JSON.parse(JSON.stringify(this.config || {}));
  }

  /**
   * Get configuration directory path
   */
  getConfigDir() {
    return this.configDir;
  }

  /**
   * Get configuration file path
   */
  getConfigPath() {
    return this.configPath;
  }

  /**
   * Get status information about the configuration manager
   */
  getStatus() {
    return {
      initialized: this.config !== null,
      configDir: this.configDir,
      configPath: this.configPath,
      hasConfig: this.config !== null,
      isWatching: this.fileWatcher !== null
    };
  }

  /**
   * Export configuration as JSON string
   */
  async export() {
    if (!this.config) {
      throw new Error('Configuration not initialized');
    }
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Import configuration from JSON string
   */
  async import(jsonString) {
    try {
      const parsed = JSON.parse(jsonString);
      
      if (!this.validateConfig(parsed)) {
        throw new Error('Invalid configuration format');
      }
      
      this.config = parsed;
      await this.save();
      this.emit('imported', this.config);
    } catch (error) {
      throw new Error(`Failed to import config: ${error.message}`);
    }
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    this.stopWatching();
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout);
      await this.save();
    }
    this.removeAllListeners();
  }
}

// Export singleton instance
let instance = null;

module.exports = {
  GlobalConfigManager,
  getInstance: () => {
    if (!instance) {
      instance = new GlobalConfigManager();
    }
    return instance;
  }
};