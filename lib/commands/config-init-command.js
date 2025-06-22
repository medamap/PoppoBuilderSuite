/**
 * Config Init Command
 * Initializes global PoppoBuilder configuration
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const chalk = require('chalk');

class ConfigInitCommand {
  constructor() {
    this.configManager = getInstance();
  }

  /**
   * Execute the config init command
   * @param {Object} options - Command options
   * @returns {Promise<void>}
   */
  async execute(options = {}) {
    try {
      console.log(chalk.blue('Initializing PoppoBuilder global configuration...'));
      
      // Initialize the configuration manager
      await this.configManager.initialize();
      
      const configPath = this.configManager.getConfigPath();
      const configDir = this.configManager.getConfigDir();
      
      console.log(chalk.green('✓') + ' Configuration directory created: ' + chalk.gray(configDir));
      console.log(chalk.green('✓') + ' Configuration file created: ' + chalk.gray(configPath));
      
      // Show current configuration if verbose
      if (options.verbose) {
        console.log('\n' + chalk.yellow('Current configuration:'));
        const config = this.configManager.getAll();
        console.log(JSON.stringify(config, null, 2));
      }
      
      console.log('\n' + chalk.green('Global configuration initialized successfully!'));
      console.log('\nNext steps:');
      console.log('  1. Register a project: ' + chalk.cyan('poppo-builder project register'));
      console.log('  2. Start the daemon: ' + chalk.cyan('poppo-builder daemon start'));
      console.log('  3. View configuration: ' + chalk.cyan('poppo-builder config show'));
      
    } catch (error) {
      console.error(chalk.red('Error initializing configuration:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      throw error;
    }
  }

  /**
   * Get command description
   * @returns {string}
   */
  static getDescription() {
    return 'Initialize PoppoBuilder global configuration';
  }

  /**
   * Get command options
   * @returns {Array}
   */
  static getOptions() {
    return [
      {
        flags: '-v, --verbose',
        description: 'Show verbose output including current configuration'
      },
      {
        flags: '-f, --force',
        description: 'Force re-initialization (resets existing configuration)'
      }
    ];
  }

  /**
   * Check if initialization is needed
   * @returns {Promise<boolean>}
   */
  async isInitializationNeeded() {
    try {
      const status = this.configManager.getStatus();
      return !status.initialized;
    } catch {
      return true;
    }
  }
}

module.exports = ConfigInitCommand;