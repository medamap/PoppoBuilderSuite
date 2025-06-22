/**
 * Config Reset Command
 * Resets global configuration to defaults
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const DirectoryManager = require('../core/directory-manager');
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');

class ConfigResetCommand {
  constructor() {
    this.configManager = getInstance();
    this.directoryManager = new DirectoryManager();
  }

  /**
   * Execute the config reset command
   * @param {Object} options - Command options
   * @returns {Promise<void>}
   */
  async execute(options = {}) {
    try {
      // Ensure config is initialized
      await this.configManager.initialize();
      
      // Get current configuration for display
      const currentConfig = this.configManager.getAll();
      
      // Confirm reset unless forced
      if (!options.force) {
        console.log(chalk.yellow('⚠️  Warning: This will reset all global configuration to defaults.'));
        console.log(chalk.gray('Current configuration will be backed up.'));
        console.log();
        
        const { confirmed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'confirmed',
            message: 'Are you sure you want to reset the configuration?',
            default: false
          }
        ]);
        
        if (!confirmed) {
          console.log(chalk.gray('Reset cancelled.'));
          return;
        }
      }
      
      // Create backup unless skipped
      let backupPath = null;
      if (!options.skipBackup) {
        backupPath = await this.createBackup(currentConfig);
        console.log(chalk.green('✓'), 'Backup created:', chalk.gray(backupPath));
      }
      
      // Reset configuration
      await this.configManager.reset(false); // false = don't create another backup
      
      console.log(chalk.green('✓'), 'Configuration reset to defaults');
      
      // Show new configuration if verbose
      if (options.verbose) {
        console.log('\n' + chalk.yellow('New configuration:'));
        const newConfig = this.configManager.getAll();
        console.log(JSON.stringify(newConfig, null, 2));
      }
      
      // Show restore command if backup was created
      if (backupPath) {
        console.log('\n' + chalk.gray('To restore from backup:'));
        console.log(chalk.cyan(`poppo-builder config import ${backupPath}`));
      }
      
    } catch (error) {
      console.error(chalk.red('Error resetting configuration:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Create a backup of current configuration
   * @param {Object} config - Configuration to backup
   * @returns {Promise<string>} Backup file path
   */
  async createBackup(config) {
    // Ensure backup directory exists
    await this.directoryManager.initialize();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFileName = `config-backup-${timestamp}.json`;
    const backupPath = path.join(this.directoryManager.directories.backup, backupFileName);
    
    await fs.writeFile(
      backupPath,
      JSON.stringify(config, null, 2),
      { mode: 0o600 }
    );
    
    return backupPath;
  }

  /**
   * Get command description
   * @returns {string}
   */
  static getDescription() {
    return 'Reset global configuration to defaults';
  }

  /**
   * Get command options
   * @returns {Array}
   */
  static getOptions() {
    return [
      {
        flags: '-f, --force',
        description: 'Skip confirmation prompt'
      },
      {
        flags: '-n, --skip-backup',
        description: 'Do not create a backup'
      },
      {
        flags: '-v, --verbose',
        description: 'Show verbose output'
      }
    ];
  }
}

module.exports = ConfigResetCommand;