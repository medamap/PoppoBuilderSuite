/**
 * Reload Command
 * Reload configuration without stopping the daemon
 */

const { Command } = require('commander');
const IPCClient = require('../../../daemon/ipc/ipc-client');
const colors = require('@colors/colors');
const ora = require('ora');
const path = require('path');
const fs = require('fs').promises;
const diff = require('diff');

class ReloadCommand {
  constructor() {
    this.ipcClient = new IPCClient();
  }

  /**
   * Create the reload command
   * @returns {Command} The reload command
   */
  static create() {
    const cmd = new Command('reload');
    
    cmd
      .description('Reload daemon configuration without stopping')
      .option('--config <path>', 'Use a different configuration file')
      .option('--validate-only', 'Only validate configuration without reloading')
      .option('--show-diff', 'Show configuration differences')
      .option('--force', 'Force reload even with validation warnings')
      .option('--components <list>', 'Reload specific components only', (val) => val.split(','))
      .option('--json', 'Output in JSON format')
      .action(async (options) => {
        const command = new ReloadCommand();
        await command.execute(options);
      });

    return cmd;
  }

  /**
   * Execute the reload command
   * @param {Object} options Command options
   */
  async execute(options) {
    try {
      // Check if daemon is running
      if (!(await this.isDaemonRunning())) {
        const message = 'Daemon is not running';
        
        if (options.json) {
          console.log(JSON.stringify({
            status: 'not_running',
            message
          }));
        } else {
          console.log(colors.yellow(`⚠️  ${message}`));
        }
        
        return;
      }

      // Execute reload
      if (options.json) {
        await this.reloadConfig(options);
      } else {
        await this.reloadConfigWithProgress(options);
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          status: 'error',
          error: error.message
        }));
      } else {
        console.error(colors.red(`❌ Failed to reload configuration: ${error.message}`));
      }
      
      process.exit(1);
    }
  }

  /**
   * Reload configuration with progress indicator
   * @param {Object} options Command options
   */
  async reloadConfigWithProgress(options) {
    const spinner = ora('Reloading configuration...').start();
    
    try {
      await this.ipcClient.connect();
      
      // Get current configuration
      spinner.text = 'Fetching current configuration...';
      const currentConfig = await this.getCurrentConfig();
      
      // Load new configuration if specified
      let newConfig = currentConfig;
      if (options.config) {
        spinner.text = 'Loading new configuration...';
        newConfig = await this.loadConfigFile(options.config);
      } else {
        spinner.text = 'Reading configuration from disk...';
        newConfig = await this.getLatestConfig();
      }
      
      // Validate configuration
      spinner.text = 'Validating configuration...';
      const validation = await this.validateConfig(newConfig, options);
      
      if (!validation.valid) {
        spinner.fail('Configuration validation failed');
        this.displayValidationErrors(validation.errors);
        
        if (!options.force) {
          throw new Error('Configuration validation failed');
        }
        
        console.log(colors.yellow('⚠️  Proceeding with reload despite validation errors (--force)'));
      }
      
      if (options.validateOnly) {
        spinner.succeed('Configuration is valid');
        return;
      }
      
      // Show diff if requested
      if (options.showDiff) {
        spinner.stop();
        this.showConfigDiff(currentConfig, newConfig);
        spinner.start('Reloading configuration...');
      }
      
      // Perform reload
      spinner.text = 'Applying configuration changes...';
      const result = await this.performReload(newConfig, options);
      
      await this.ipcClient.disconnect();
      
      // Display results
      spinner.succeed('Configuration reloaded successfully');
      this.displayReloadResults(result);
      
    } catch (error) {
      spinner.fail(`Failed to reload: ${error.message}`);
      throw error;
    } finally {
      try {
        await this.ipcClient.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
    }
  }

  /**
   * Reload configuration without progress (for JSON output)
   * @param {Object} options Command options
   */
  async reloadConfig(options) {
    await this.ipcClient.connect();
    
    const currentConfig = await this.getCurrentConfig();
    let newConfig = currentConfig;
    
    if (options.config) {
      newConfig = await this.loadConfigFile(options.config);
    } else {
      newConfig = await this.getLatestConfig();
    }
    
    const validation = await this.validateConfig(newConfig, options);
    
    if (!validation.valid && !options.force) {
      console.log(JSON.stringify({
        status: 'validation_failed',
        errors: validation.errors
      }));
      throw new Error('Configuration validation failed');
    }
    
    if (options.validateOnly) {
      console.log(JSON.stringify({
        status: 'valid',
        message: 'Configuration is valid'
      }));
      return;
    }
    
    const result = await this.performReload(newConfig, options);
    
    await this.ipcClient.disconnect();
    
    console.log(JSON.stringify({
      status: 'reloaded',
      message: 'Configuration reloaded successfully',
      result
    }));
  }

  /**
   * Get current daemon configuration
   * @returns {Promise<Object>} Current configuration
   */
  async getCurrentConfig() {
    return await this.ipcClient.sendCommand('config.get');
  }

  /**
   * Get latest configuration from disk
   * @returns {Promise<Object>} Latest configuration
   */
  async getLatestConfig() {
    const configPaths = [
      path.join(process.cwd(), 'config', 'config.json'),
      path.join(process.cwd(), '.poppobuilder', 'config.json'),
      path.join(require('os').homedir(), '.poppobuilder', 'config.json')
    ];
    
    for (const configPath of configPaths) {
      try {
        return await this.loadConfigFile(configPath);
      } catch (error) {
        // Try next path
      }
    }
    
    throw new Error('Could not find configuration file');
  }

  /**
   * Load configuration from file
   * @param {string} configPath Path to configuration file
   * @returns {Promise<Object>} Configuration object
   */
  async loadConfigFile(configPath) {
    const absolutePath = path.resolve(configPath);
    
    try {
      const content = await fs.readFile(absolutePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Configuration file not found: ${configPath}`);
      } else if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in configuration file: ${error.message}`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Validate configuration
   * @param {Object} config Configuration to validate
   * @param {Object} options Command options
   * @returns {Promise<Object>} Validation result
   */
  async validateConfig(config, options) {
    try {
      const result = await this.ipcClient.sendCommand('config.validate', {
        config,
        components: options.components
      });
      
      return result;
    } catch (error) {
      return {
        valid: false,
        errors: [{ message: error.message }]
      };
    }
  }

  /**
   * Perform configuration reload
   * @param {Object} config New configuration
   * @param {Object} options Command options
   * @returns {Promise<Object>} Reload result
   */
  async performReload(config, options) {
    return await this.ipcClient.sendCommand('config.reload', {
      config,
      components: options.components,
      force: options.force
    });
  }

  /**
   * Show configuration differences
   * @param {Object} oldConfig Current configuration
   * @param {Object} newConfig New configuration
   */
  showConfigDiff(oldConfig, newConfig) {
    console.log('');
    console.log(colors.bold('Configuration Changes:'));
    console.log('');
    
    const oldJson = JSON.stringify(oldConfig, null, 2);
    const newJson = JSON.stringify(newConfig, null, 2);
    
    const changes = diff.diffLines(oldJson, newJson);
    
    changes.forEach(part => {
      if (part.added) {
        process.stdout.write(colors.green('+ ' + part.value));
      } else if (part.removed) {
        process.stdout.write(colors.red('- ' + part.value));
      } else {
        // Only show a few lines of context
        const lines = part.value.split('\n');
        if (lines.length > 6) {
          process.stdout.write(colors.gray('  ' + lines[0] + '\n'));
          process.stdout.write(colors.gray('  ...\n'));
          process.stdout.write(colors.gray('  ' + lines[lines.length - 2] + '\n'));
        } else {
          process.stdout.write(colors.gray('  ' + part.value));
        }
      }
    });
    
    console.log('');
  }

  /**
   * Display validation errors
   * @param {Array} errors Validation errors
   */
  displayValidationErrors(errors) {
    console.log('');
    console.log(colors.red('Validation Errors:'));
    
    errors.forEach(error => {
      console.log(`  ${colors.red('•')} ${error.path ? `${error.path}: ` : ''}${error.message}`);
    });
    
    console.log('');
  }

  /**
   * Display reload results
   * @param {Object} result Reload result
   */
  displayReloadResults(result) {
    if (!result || !result.changes || result.changes.length === 0) {
      console.log(colors.gray('No configuration changes were applied'));
      return;
    }
    
    console.log('');
    console.log(colors.bold('Applied Changes:'));
    
    result.changes.forEach(change => {
      const icon = change.status === 'success' ? colors.green('✓') : 
                  change.status === 'warning' ? colors.yellow('⚠') : 
                  colors.red('✗');
      
      console.log(`  ${icon} ${change.component}: ${change.message}`);
    });
    
    if (result.restartRequired) {
      console.log('');
      console.log(colors.yellow('⚠️  Some changes require a daemon restart to take full effect'));
      console.log(colors.gray('   Use "poppo daemon restart" to apply all changes'));
    }
  }

  /**
   * Check if daemon is running
   * @returns {Promise<boolean>} True if daemon is running
   */
  async isDaemonRunning() {
    try {
      await this.ipcClient.connect();
      const isRunning = this.ipcClient.connected;
      await this.ipcClient.disconnect();
      return isRunning;
    } catch (error) {
      return false;
    }
  }
}

module.exports = ReloadCommand;