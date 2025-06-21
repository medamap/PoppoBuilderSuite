/**
 * Config Command
 * Manages PoppoBuilder global configuration
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const ConfigUpdater = require('../utils/config-updater');
const chalk = require('chalk');

class ConfigCommand {
  constructor() {
    this.configManager = getInstance();
    this.configUpdater = new ConfigUpdater();
  }

  async execute(action, options) {
    try {
      // Initialize config manager
      await this.configManager.initialize();

      // Handle different actions or direct key-value setting
      if (!action || action === 'list' || action === '--list') {
        await this.listConfig();
      } else if (action === 'get' && options.length > 0) {
        await this.getConfig(options[0]);
      } else if (action === 'set' && options.length >= 2) {
        await this.setConfig(options[0], options[1]);
      } else if (action === 'reset') {
        await this.resetConfig();
      } else if (action.startsWith('--')) {
        // Handle flag-style options (e.g., --max-processes 3)
        await this.handleFlagOptions(action, options);
      } else {
        console.error(chalk.red('Invalid config command usage'));
        this.showUsage();
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
      process.exit(1);
    }
  }

  /**
   * List all configuration values
   */
  async listConfig() {
    const config = this.configManager.getAll();
    
    console.log(chalk.bold('\nPoppoBuilder Global Configuration:'));
    console.log(chalk.gray('─'.repeat(50)));
    
    // Format and display configuration
    this.displayConfig(config, '');
    
    console.log(chalk.gray('\n─'.repeat(50)));
    console.log(chalk.dim(`Config file: ${this.configManager.getConfigPath()}`));
  }

  /**
   * Get a specific configuration value
   */
  async getConfig(keyPath) {
    const value = this.configManager.get(keyPath);
    
    if (value === undefined) {
      console.error(chalk.red(`Configuration key '${keyPath}' not found`));
      return;
    }
    
    console.log(chalk.green(`${keyPath}:`), value);
  }

  /**
   * Set a configuration value
   */
  async setConfig(keyPath, value) {
    // Parse value if it looks like JSON
    let parsedValue = value;
    if (value === 'true') parsedValue = true;
    else if (value === 'false') parsedValue = false;
    else if (/^\d+$/.test(value)) parsedValue = parseInt(value);
    else if (/^\d+\.\d+$/.test(value)) parsedValue = parseFloat(value);
    else if (value.startsWith('{') || value.startsWith('[')) {
      try {
        parsedValue = JSON.parse(value);
      } catch (e) {
        // Keep as string if JSON parse fails
      }
    }
    
    await this.configManager.set(keyPath, parsedValue);
    console.log(chalk.green('✓'), `Set ${keyPath} = ${parsedValue}`);
    
    // Notify daemon of configuration change if running
    await this.configUpdater.notifyDaemon({ [keyPath]: parsedValue });
  }

  /**
   * Reset configuration to defaults
   */
  async resetConfig() {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      readline.question(chalk.yellow('Are you sure you want to reset all configuration to defaults? (y/N) '), resolve);
    });
    readline.close();
    
    if (answer.toLowerCase() === 'y') {
      await this.configManager.reset();
      console.log(chalk.green('✓ Configuration reset to defaults'));
      
      // Notify daemon
      await this.configUpdater.notifyDaemon({ reset: true });
    } else {
      console.log('Reset cancelled');
    }
  }

  /**
   * Handle flag-style options
   */
  async handleFlagOptions(flag, args) {
    const value = args[0];
    
    switch (flag) {
      case '--max-processes':
        if (!value || isNaN(value)) {
          console.error(chalk.red('--max-processes requires a numeric value'));
          return;
        }
        await this.setConfig('daemon.maxProcesses', parseInt(value));
        break;
        
      case '--strategy':
        const validStrategies = ['round-robin', 'priority', 'weighted'];
        if (!value || !validStrategies.includes(value)) {
          console.error(chalk.red(`--strategy requires one of: ${validStrategies.join(', ')}`));
          return;
        }
        await this.setConfig('daemon.schedulingStrategy', value);
        break;
        
      case '--list':
        await this.listConfig();
        break;
        
      default:
        console.error(chalk.red(`Unknown option: ${flag}`));
        this.showUsage();
    }
  }

  /**
   * Display configuration in a formatted way
   */
  displayConfig(obj, prefix) {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        console.log(chalk.cyan(`${fullKey}:`));
        this.displayConfig(value, fullKey);
      } else {
        const displayValue = Array.isArray(value) ? `[${value.join(', ')}]` : value;
        console.log(`  ${chalk.gray(fullKey)}: ${chalk.white(displayValue)}`);
      }
    }
  }

  /**
   * Show usage information
   */
  showUsage() {
    console.log(`
${chalk.bold('Usage:')}
  poppobuilder config [action] [options]
  
${chalk.bold('Actions:')}
  list, --list                     List all configuration values
  get <key>                        Get a specific configuration value
  set <key> <value>                Set a configuration value
  reset                            Reset configuration to defaults
  
${chalk.bold('Quick Options:')}
  --max-processes <n>              Set maximum concurrent processes
  --strategy <strategy>            Set scheduling strategy (round-robin, priority, weighted)
  
${chalk.bold('Examples:')}
  poppobuilder config --list
  poppobuilder config --max-processes 3
  poppobuilder config --strategy weighted
  poppobuilder config set daemon.port 45678
  poppobuilder config get daemon.maxProcesses
`);
  }
}

module.exports = ConfigCommand;