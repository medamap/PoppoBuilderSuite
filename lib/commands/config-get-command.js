/**
 * Config Get Command
 * Gets a specific configuration value
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const chalk = require('chalk');

class ConfigGetCommand {
  constructor() {
    this.configManager = getInstance();
  }

  /**
   * Execute the config get command
   * @param {string} keyPath - Configuration key path to get
   * @param {Object} options - Command options
   * @returns {Promise<void>}
   */
  async execute(keyPath, options = {}) {
    try {
      if (!keyPath) {
        console.error(chalk.red('Error: Key path is required'));
        console.error('Usage: poppo-builder config get <key.path>');
        console.error('Example: poppo-builder config get daemon.maxProcesses');
        process.exit(1);
      }

      // Ensure config is initialized
      await this.configManager.initialize();
      
      // Get the value
      const value = this.configManager.get(keyPath);
      
      if (value === undefined) {
        if (!options.quiet) {
          console.error(chalk.red(`Configuration key not found: ${keyPath}`));
        }
        process.exit(1);
      }
      
      // Output the value
      if (typeof value === 'object') {
        console.log(JSON.stringify(value, null, options.pretty ? 2 : 0));
      } else {
        console.log(value);
      }
      
    } catch (error) {
      if (!options.quiet) {
        console.error(chalk.red('Error getting configuration:'), error.message);
        if (options.verbose) {
          console.error(error.stack);
        }
      }
      process.exit(1);
    }
  }

  /**
   * Get command description
   * @returns {string}
   */
  static getDescription() {
    return 'Get a specific configuration value';
  }

  /**
   * Get command options
   * @returns {Array}
   */
  static getOptions() {
    return [
      {
        flags: '-p, --pretty',
        description: 'Pretty print JSON output'
      },
      {
        flags: '-q, --quiet',
        description: 'Suppress error messages'
      },
      {
        flags: '-v, --verbose',
        description: 'Show verbose error messages'
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
        description: 'Get daemon max processes',
        command: 'poppo-builder config get daemon.maxProcesses'
      },
      {
        description: 'Get all daemon settings',
        command: 'poppo-builder config get daemon'
      },
      {
        description: 'Get logging level',
        command: 'poppo-builder config get logging.level'
      },
      {
        description: 'Get value with pretty JSON',
        command: 'poppo-builder config get daemon --pretty'
      }
    ];
  }
}

module.exports = ConfigGetCommand;