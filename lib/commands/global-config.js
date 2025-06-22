#!/usr/bin/env node

/**
 * PoppoBuilder Global Configuration CLI
 * Manage global PoppoBuilder configuration
 */

const { program } = require('commander');
const chalk = require('chalk');
const { GlobalConfigManager } = require('../core/global-config-manager');
const i18n = require('../i18n');

// Initialize i18n
i18n.init().then(() => {
  const configManager = new GlobalConfigManager();

  // Helper function to display config
  const displayConfig = (config, path = '') => {
    if (typeof config === 'object' && config !== null) {
      for (const [key, value] of Object.entries(config)) {
        const currentPath = path ? `${path}.${key}` : key;
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          displayConfig(value, currentPath);
        } else {
          console.log(`${chalk.cyan(currentPath)}: ${chalk.yellow(JSON.stringify(value))}`);
        }
      }
    }
  };

  // Helper to handle async commands
  const handleCommand = (fn) => {
    return async (...args) => {
      try {
        await configManager.initialize();
        await fn(...args);
        await configManager.cleanup();
      } catch (error) {
        console.error(chalk.red(i18n.t('errors.commandFailed')), error.message);
        process.exit(1);
      }
    };
  };

  program
    .name('poppobuilder config')
    .description(i18n.t('commands.globalConfig.description'))
    .version('1.0.0');

  // Show command
  program
    .command('show [path]')
    .description(i18n.t('commands.globalConfig.show.description'))
    .action(handleCommand(async (path) => {
      if (path) {
        const value = configManager.get(path);
        if (value !== undefined) {
          console.log(`${chalk.cyan(path)}: ${chalk.yellow(JSON.stringify(value, null, 2))}`);
        } else {
          console.log(chalk.red(i18n.t('commands.globalConfig.show.notFound', { path })));
        }
      } else {
        console.log(chalk.bold(i18n.t('commands.globalConfig.show.title')));
        console.log(chalk.gray('─'.repeat(50)));
        displayConfig(configManager.getAll());
      }
    }));

  // Set command
  program
    .command('set <path> <value>')
    .description(i18n.t('commands.globalConfig.set.description'))
    .action(handleCommand(async (path, value) => {
      // Parse value
      let parsedValue = value;
      if (value === 'true') parsedValue = true;
      else if (value === 'false') parsedValue = false;
      else if (!isNaN(value)) parsedValue = Number(value);
      else if (value.startsWith('[') || value.startsWith('{')) {
        try {
          parsedValue = JSON.parse(value);
        } catch (e) {
          // Keep as string if JSON parse fails
        }
      }

      await configManager.set(path, parsedValue);
      console.log(chalk.green(i18n.t('commands.globalConfig.set.success', { path, value: parsedValue })));
    }));

  // Reset command
  program
    .command('reset')
    .description(i18n.t('commands.globalConfig.reset.description'))
    .option('-y, --yes', i18n.t('commands.globalConfig.reset.skipConfirmation'))
    .action(handleCommand(async (options) => {
      if (!options.yes) {
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });

        const answer = await new Promise(resolve => {
          readline.question(chalk.yellow(i18n.t('commands.globalConfig.reset.confirm')) + ' (y/N) ', resolve);
        });
        readline.close();

        if (answer.toLowerCase() !== 'y') {
          console.log(chalk.gray(i18n.t('commands.common.cancelled')));
          return;
        }
      }

      await configManager.reset();
      console.log(chalk.green(i18n.t('commands.globalConfig.reset.success')));
    }));

  // Path command
  program
    .command('path')
    .description(i18n.t('commands.globalConfig.path.description'))
    .action(handleCommand(async () => {
      console.log(chalk.bold(i18n.t('commands.globalConfig.path.title')));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(`${chalk.cyan('Config directory')}: ${chalk.yellow(configManager.getConfigDir())}`);
      console.log(`${chalk.cyan('Config file')}: ${chalk.yellow(configManager.getConfigPath())}`);
      console.log(`${chalk.cyan('Logs directory')}: ${chalk.yellow(configManager.getConfigDir() + '/logs')}`);
      console.log(`${chalk.cyan('Projects directory')}: ${chalk.yellow(configManager.getConfigDir() + '/projects')}`);
    }));

  // Export command
  program
    .command('export [file]')
    .description(i18n.t('commands.globalConfig.export.description'))
    .action(handleCommand(async (file) => {
      const content = await configManager.export();
      
      if (file) {
        const fs = require('fs').promises;
        await fs.writeFile(file, content);
        console.log(chalk.green(i18n.t('commands.globalConfig.export.success', { file })));
      } else {
        console.log(content);
      }
    }));

  // Import command
  program
    .command('import <file>')
    .description(i18n.t('commands.globalConfig.import.description'))
    .action(handleCommand(async (file) => {
      const fs = require('fs').promises;
      const content = await fs.readFile(file, 'utf8');
      await configManager.import(content);
      console.log(chalk.green(i18n.t('commands.globalConfig.import.success', { file })));
    }));

  // Validate command
  program
    .command('validate [file]')
    .description(i18n.t('commands.globalConfig.validate.description'))
    .action(handleCommand(async (file) => {
      let config;
      if (file) {
        const fs = require('fs').promises;
        const content = await fs.readFile(file, 'utf8');
        config = JSON.parse(content);
      } else {
        config = configManager.getAll();
      }

      const { validate } = require('../schemas/global-config-schema');
      const valid = validate(config);

      if (valid) {
        console.log(chalk.green(i18n.t('commands.globalConfig.validate.valid')));
      } else {
        console.log(chalk.red(i18n.t('commands.globalConfig.validate.invalid')));
        validate.errors.forEach(err => {
          console.log(chalk.red(`  - ${err.instancePath || '/'}: ${err.message}`));
        });
      }
    }));

  // Initialize command (creates default config if not exists)
  program
    .command('init')
    .description(i18n.t('commands.globalConfig.init.description'))
    .action(handleCommand(async () => {
      if (await configManager.exists()) {
        console.log(chalk.yellow(i18n.t('commands.globalConfig.init.exists')));
      } else {
        await configManager.createDefault();
        console.log(chalk.green(i18n.t('commands.globalConfig.init.success', { 
          path: configManager.getConfigPath() 
        })));
      }
    }));

  program.parse(process.argv);
}).catch(error => {
  console.error(chalk.red('Failed to initialize:'), error);
  process.exit(1);
});