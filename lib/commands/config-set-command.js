/**
 * Config Set Command
 * Sets configuration values with validation
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const chalk = require('chalk');

class ConfigSetCommand {
  constructor() {
    this.configManager = getInstance();
  }

  /**
   * Execute the config set command
   * @param {string} keyPath - Configuration key path to set
   * @param {string} value - Value to set
   * @param {Object} options - Command options
   * @returns {Promise<void>}
   */
  async execute(keyPath, value, options = {}) {
    try {
      if (!keyPath || value === undefined) {
        console.error(chalk.red('Error: Both key path and value are required'));
        console.error('Usage: poppo-builder config set <key.path> <value>');
        console.error('Example: poppo-builder config set daemon.maxProcesses 4');
        process.exit(1);
      }

      // Ensure config is initialized
      await this.configManager.initialize();
      
      // Parse the value
      const parsedValue = this.parseValue(value);
      
      // Show current value if requested
      if (options.showCurrent) {
        const currentValue = this.configManager.get(keyPath);
        if (currentValue !== undefined) {
          console.log(chalk.gray('Current value:'), this.formatValue(currentValue));
        }
      }
      
      // Validate the new value
      if (!options.skipValidation) {
        const validationError = this.validateValue(keyPath, parsedValue);
        if (validationError) {
          console.error(chalk.red('Validation error:'), validationError);
          process.exit(1);
        }
      }
      
      // Set the value
      await this.configManager.set(keyPath, parsedValue);
      
      // Show success message
      console.log(chalk.green('✓'), `Configuration updated: ${chalk.cyan(keyPath)} = ${chalk.yellow(this.formatValue(parsedValue))}`);
      
      // Show related settings if verbose
      if (options.verbose) {
        this.showRelatedSettings(keyPath);
      }
      
    } catch (error) {
      console.error(chalk.red('Error setting configuration:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Parse string value to appropriate type
   * @param {string} value - String value to parse
   * @returns {*} Parsed value
   */
  parseValue(value) {
    // Try to parse as JSON first (for objects and arrays)
    try {
      return JSON.parse(value);
    } catch {}
    
    // Check for boolean
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
    
    // Check for null
    if (value.toLowerCase() === 'null') return null;
    
    // Check for number
    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;
    
    // Return as string
    return value;
  }

  /**
   * Format value for display
   * @param {*} value - Value to format
   * @returns {string} Formatted value
   */
  formatValue(value) {
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  /**
   * Validate configuration value
   * @param {string} keyPath - Configuration key path
   * @param {*} value - Value to validate
   * @returns {string|null} Error message or null if valid
   */
  validateValue(keyPath, value) {
    // Special validation for known keys
    const validations = {
      'daemon.maxProcesses': (val) => {
        if (typeof val !== 'number') return 'Must be a number';
        if (val < 1 || val > 10) return 'Must be between 1 and 10';
        return null;
      },
      'daemon.port': (val) => {
        if (val !== null && typeof val !== 'number') return 'Must be a number or null';
        if (typeof val === 'number' && (val < 1024 || val > 65535)) return 'Must be between 1024 and 65535';
        return null;
      },
      'daemon.schedulingStrategy': (val) => {
        const valid = ['round-robin', 'priority', 'weighted', 'weighted-round-robin', 'deadline-aware'];
        if (!valid.includes(val)) return `Must be one of: ${valid.join(', ')}`;
        return null;
      },
      'resources.maxMemoryMB': (val) => {
        if (typeof val !== 'number') return 'Must be a number';
        if (val < 512) return 'Must be at least 512';
        return null;
      },
      'resources.maxCpuPercent': (val) => {
        if (typeof val !== 'number') return 'Must be a number';
        if (val < 10 || val > 100) return 'Must be between 10 and 100';
        return null;
      },
      'logging.level': (val) => {
        const valid = ['debug', 'info', 'warn', 'error'];
        if (!valid.includes(val)) return `Must be one of: ${valid.join(', ')}`;
        return null;
      },
      'defaults.language': (val) => {
        const valid = ['en', 'ja'];
        if (!valid.includes(val)) return `Must be one of: ${valid.join(', ')}`;
        return null;
      },
      'updates.channel': (val) => {
        const valid = ['stable', 'beta', 'dev'];
        if (!valid.includes(val)) return `Must be one of: ${valid.join(', ')}`;
        return null;
      }
    };
    
    const validator = validations[keyPath];
    if (validator) {
      return validator(value);
    }
    
    // Generic validations based on key patterns
    if (keyPath.includes('.enabled') || keyPath.includes('autoUpdate') || keyPath.includes('autoDiscovery')) {
      if (typeof value !== 'boolean') return 'Must be true or false';
    }
    
    if (keyPath.endsWith('Interval') || keyPath.endsWith('Timeout') || keyPath.endsWith('Delay')) {
      if (typeof value !== 'number') return 'Must be a number (milliseconds)';
      if (value < 0) return 'Must be a positive number';
    }
    
    return null;
  }

  /**
   * Show related settings for context
   * @param {string} keyPath - Configuration key path
   */
  showRelatedSettings(keyPath) {
    const parts = keyPath.split('.');
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('.');
      const parentValue = this.configManager.get(parentPath);
      
      if (parentValue && typeof parentValue === 'object') {
        console.log('\n' + chalk.gray('Related settings in'), chalk.cyan(parentPath) + ':');
        for (const [key, value] of Object.entries(parentValue)) {
          console.log(chalk.gray('  ' + key + ':'), this.formatValue(value));
        }
      }
    }
  }

  /**
   * Get command description
   * @returns {string}
   */
  static getDescription() {
    return 'Set a configuration value';
  }

  /**
   * Get command options
   * @returns {Array}
   */
  static getOptions() {
    return [
      {
        flags: '-s, --show-current',
        description: 'Show current value before setting'
      },
      {
        flags: '-n, --skip-validation',
        description: 'Skip value validation'
      },
      {
        flags: '-v, --verbose',
        description: 'Show related settings and verbose output'
      }
    ];
  }

  /**
   * Get command examples
   * @returns {Array}
   */
  static getExamples() {
    return [
      {
        description: 'Set max processes',
        command: 'poppo-builder config set daemon.maxProcesses 4'
      },
      {
        description: 'Set scheduling strategy',
        command: 'poppo-builder config set daemon.schedulingStrategy priority'
      },
      {
        description: 'Set boolean value',
        command: 'poppo-builder config set telemetry.enabled false'
      },
      {
        description: 'Set array value',
        command: 'poppo-builder config set registry.discoveryPaths \'["/home/user/projects"]\'',
      },
      {
        description: 'Set with current value shown',
        command: 'poppo-builder config set logging.level debug --show-current'
      }
    ];
  }
}

module.exports = ConfigSetCommand;