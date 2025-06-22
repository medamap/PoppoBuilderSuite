/**
 * Config Show Command
 * Shows current global configuration
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const chalk = require('chalk');

class ConfigShowCommand {
  constructor() {
    this.configManager = getInstance();
  }

  /**
   * Execute the config show command
   * @param {string} keyPath - Optional specific key path to show
   * @param {Object} options - Command options
   * @returns {Promise<void>}
   */
  async execute(keyPath = null, options = {}) {
    try {
      // Ensure config is initialized
      await this.configManager.initialize();
      
      if (keyPath) {
        // Show specific value
        const value = this.configManager.get(keyPath);
        
        if (value === undefined) {
          console.error(chalk.red(`Configuration key not found: ${keyPath}`));
          process.exit(1);
        }
        
        if (options.json || typeof value !== 'object') {
          // Output raw value for scripting
          console.log(typeof value === 'object' ? JSON.stringify(value) : value);
        } else {
          // Pretty print objects
          console.log(chalk.blue(`${keyPath}:`));
          console.log(JSON.stringify(value, null, 2));
        }
      } else {
        // Show all configuration
        const config = this.configManager.getAll();
        
        if (options.json) {
          // Output raw JSON
          console.log(JSON.stringify(config));
        } else {
          // Pretty print with sections
          console.log(chalk.blue.bold('PoppoBuilder Global Configuration'));
          console.log(chalk.gray('─'.repeat(50)));
          console.log();
          
          // Version
          console.log(chalk.yellow('Version:'), config.version);
          console.log();
          
          // Daemon settings
          console.log(chalk.yellow('Daemon Settings:'));
          this.printObject(config.daemon, 1);
          console.log();
          
          // Resources
          console.log(chalk.yellow('Resource Limits:'));
          this.printObject(config.resources, 1);
          console.log();
          
          // Defaults
          console.log(chalk.yellow('Default Settings:'));
          this.printObject(config.defaults, 1);
          console.log();
          
          // Registry
          console.log(chalk.yellow('Project Registry:'));
          this.printObject(config.registry, 1);
          console.log();
          
          // Logging
          console.log(chalk.yellow('Logging:'));
          this.printObject(config.logging, 1);
          console.log();
          
          // Other sections
          if (config.telemetry) {
            console.log(chalk.yellow('Telemetry:'));
            this.printObject(config.telemetry, 1);
            console.log();
          }
          
          if (config.updates) {
            console.log(chalk.yellow('Updates:'));
            this.printObject(config.updates, 1);
            console.log();
          }
          
          // Config file location
          console.log(chalk.gray('─'.repeat(50)));
          console.log(chalk.gray('Configuration file: ' + this.configManager.getConfigPath()));
        }
      }
    } catch (error) {
      console.error(chalk.red('Error showing configuration:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Pretty print an object with indentation
   * @param {Object} obj - Object to print
   * @param {number} indent - Indentation level
   */
  printObject(obj, indent = 0) {
    const spaces = '  '.repeat(indent);
    
    for (const [key, value] of Object.entries(obj)) {
      if (value === null) {
        console.log(spaces + chalk.cyan(key + ':'), chalk.gray('null'));
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        console.log(spaces + chalk.cyan(key + ':'));
        this.printObject(value, indent + 1);
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          console.log(spaces + chalk.cyan(key + ':'), chalk.gray('[]'));
        } else {
          console.log(spaces + chalk.cyan(key + ':'));
          value.forEach(item => {
            console.log(spaces + '  - ' + item);
          });
        }
      } else if (typeof value === 'boolean') {
        console.log(spaces + chalk.cyan(key + ':'), value ? chalk.green(value) : chalk.red(value));
      } else if (typeof value === 'number') {
        console.log(spaces + chalk.cyan(key + ':'), chalk.magenta(value));
      } else {
        console.log(spaces + chalk.cyan(key + ':'), value);
      }
    }
  }

  /**
   * Get command description
   * @returns {string}
   */
  static getDescription() {
    return 'Show global configuration';
  }

  /**
   * Get command options
   * @returns {Array}
   */
  static getOptions() {
    return [
      {
        flags: '-j, --json',
        description: 'Output raw JSON format'
      },
      {
        flags: '-v, --verbose',
        description: 'Show verbose error messages'
      }
    ];
  }
}

module.exports = ConfigShowCommand;