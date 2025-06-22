/**
 * Config Command
 * Manages PoppoBuilder global configuration
 */

const { GlobalConfigManager, getInstance } = require('../core/global-config-manager');
const ConfigUpdater = require('../utils/config-updater');
const { getInstance: getLanguageConfig } = require('../config/language-config');
const { t } = require('../i18n');
const chalk = require('chalk');

class ConfigCommand {
  constructor() {
    this.configManager = getInstance();
    this.configUpdater = new ConfigUpdater();
    this.languageConfig = getLanguageConfig();
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
      } else if (action === 'language' || action === 'lang') {
        await this.handleLanguageCommand(options);
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
        
      case '--lang':
      case '--language':
        if (!value) {
          console.error(chalk.red('--lang requires a language value (en or ja)'));
          return;
        }
        await this.setLanguage(value, { global: true });
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
   * Handle language configuration commands
   */
  async handleLanguageCommand(options) {
    if (options.length === 0) {
      // Show current language settings
      await this.showLanguageStatus();
    } else if (options[0] === 'set' && options.length >= 2) {
      // Set language: config language set ja --global
      const language = options[1];
      const scope = options.includes('--global') ? { global: true } : { global: false };
      await this.setLanguage(language, scope);
    } else if (options[0] === 'list' || options[0] === 'hierarchy') {
      // Show language hierarchy
      await this.showLanguageHierarchy();
    } else {
      console.error(chalk.red('Invalid language command usage'));
      this.showLanguageUsage();
    }
  }

  /**
   * Set language configuration
   */
  async setLanguage(language, options = {}) {
    try {
      const result = await this.languageConfig.setLanguage(language, options);
      
      const scope = result.scope === 'global' ? t('commands:config.language.global') : t('commands:config.language.project');
      console.log(chalk.green('✓'), t('commands:config.language.setSuccess', { 
        language: result.language, 
        scope: scope,
        locale: result.locale 
      }));
      
      console.log(chalk.dim(`Config file: ${result.path}`));
      
      // Notify about restart requirement
      console.log(chalk.yellow('⚠ '), t('commands:config.language.restartRequired'));
      
    } catch (error) {
      console.error(chalk.red('Error setting language:'), error.message);
    }
  }

  /**
   * Show current language status
   */
  async showLanguageStatus() {
    try {
      const currentLanguage = await this.languageConfig.getCurrentLanguage();
      const supportedLanguages = this.languageConfig.getSupportedLanguages();
      
      console.log(chalk.bold('\nLanguage Configuration:'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(`  ${chalk.cyan('Current Language')}: ${chalk.white(currentLanguage)}`);
      console.log(`  ${chalk.cyan('Supported Languages')}: ${chalk.white(supportedLanguages.join(', '))}`);
      console.log(chalk.gray('─'.repeat(40)));
      
      // Show where the current language comes from
      const hierarchy = await this.languageConfig.getLanguageHierarchy();
      console.log(chalk.bold('\nLanguage Source:'));
      
      if (hierarchy.runtime) {
        console.log(`  ${chalk.green('●')} Runtime override: ${hierarchy.runtime}`);
      } else if (hierarchy.project && hierarchy.project.language) {
        console.log(`  ${chalk.green('●')} Project config: ${hierarchy.project.language}`);
        console.log(`    ${chalk.dim('Path:')} ${hierarchy.project.path}`);
      } else if (hierarchy.global && hierarchy.global.language) {
        console.log(`  ${chalk.green('●')} Global config: ${hierarchy.global.language}`);
        console.log(`    ${chalk.dim('Path:')} ${hierarchy.global.path}`);
      } else if (hierarchy.system) {
        console.log(`  ${chalk.green('●')} System locale: ${hierarchy.system}`);
      } else {
        console.log(`  ${chalk.green('●')} Default: ${hierarchy.default}`);
      }
      
    } catch (error) {
      console.error(chalk.red('Error showing language status:'), error.message);
    }
  }

  /**
   * Show language configuration hierarchy
   */
  async showLanguageHierarchy() {
    try {
      const hierarchy = await this.languageConfig.getLanguageHierarchy();
      
      console.log(chalk.bold('\nLanguage Configuration Hierarchy:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(chalk.dim('(Priority: highest to lowest)'));
      console.log('');
      
      // 1. Runtime override
      console.log(`${chalk.cyan('1. Runtime Override')}: ${hierarchy.runtime || chalk.gray('(not set)')}`);
      
      // 2. Project config
      if (hierarchy.project && hierarchy.project.language) {
        console.log(`${chalk.cyan('2. Project Config')}: ${hierarchy.project.language}`);
        console.log(`   ${chalk.dim('Locale:')} ${hierarchy.project.locale}`);
        console.log(`   ${chalk.dim('Path:')} ${hierarchy.project.path}`);
      } else {
        console.log(`${chalk.cyan('2. Project Config')}: ${chalk.gray('(not set)')}`);
      }
      
      // 3. Global config
      if (hierarchy.global && hierarchy.global.language) {
        console.log(`${chalk.cyan('3. Global Config')}: ${hierarchy.global.language}`);
        console.log(`   ${chalk.dim('Locale:')} ${hierarchy.global.locale}`);
        console.log(`   ${chalk.dim('Path:')} ${hierarchy.global.path}`);
      } else {
        console.log(`${chalk.cyan('3. Global Config')}: ${chalk.gray('(not set)')}`);
      }
      
      // 4. System locale
      console.log(`${chalk.cyan('4. System Locale')}: ${hierarchy.system || chalk.gray('(not detected)')}`);
      
      // 5. Default
      console.log(`${chalk.cyan('5. Default')}: ${hierarchy.default}`);
      
      console.log(chalk.gray('─'.repeat(50)));
      
    } catch (error) {
      console.error(chalk.red('Error showing language hierarchy:'), error.message);
    }
  }

  /**
   * Show language command usage
   */
  showLanguageUsage() {
    console.log(`
${chalk.bold('Language Configuration Usage:')}
  poppobuilder config language                      Show current language settings
  poppobuilder config language set <lang>          Set project language (en, ja)
  poppobuilder config language set <lang> --global Set global language (en, ja)
  poppobuilder config language hierarchy           Show language configuration hierarchy
  
${chalk.bold('Quick Options:')}
  poppobuilder config --lang <lang>                Set global language
  
${chalk.bold('Examples:')}
  poppobuilder config language                     # Show current language
  poppobuilder config language set ja              # Set project language to Japanese
  poppobuilder config language set en --global     # Set global language to English
  poppobuilder config --lang ja                    # Quick set global language to Japanese
`);
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
  language [action]                Manage language configuration
  
${chalk.bold('Language Actions:')}
  language                         Show current language settings
  language set <lang>              Set project language (en, ja)
  language set <lang> --global     Set global language (en, ja)
  language hierarchy               Show language configuration hierarchy
  
${chalk.bold('Quick Options:')}
  --max-processes <n>              Set maximum concurrent processes
  --strategy <strategy>            Set scheduling strategy (round-robin, priority, weighted)
  --lang <language>                Set global language (en, ja)
  
${chalk.bold('Examples:')}
  poppobuilder config --list
  poppobuilder config --max-processes 3
  poppobuilder config --strategy weighted
  poppobuilder config set daemon.port 45678
  poppobuilder config get daemon.maxProcesses
  poppobuilder config language                    # Show current language
  poppobuilder config language set ja             # Set project language to Japanese
  poppobuilder config --lang en                   # Quick set global language to English
`);
  }
}

module.exports = ConfigCommand;