#!/usr/bin/env node

/**
 * PoppoBuilder CLI
 * AI-powered autonomous GitHub issue processor
 */

const { Command } = require('commander');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs');
const packageInfo = require('../package.json');
const { t, initI18n } = require('../lib/i18n');
const runtimeSwitcher = require('../lib/i18n/runtime-switcher');

// コマンドの実装をインポート
const InitCommand = require('../lib/commands/init');
const StartCommand = require('../lib/commands/start');
const StatusCommand = require('../lib/commands/status');
const ConfigCommand = require('../lib/commands/config');

// プログラム設定
const program = new Command();

// Setup program (description will be set after i18n init)
function setupProgram() {
  program
    .name('poppobuilder')
    .description(t('commands:cli.description'))
    .version(packageInfo.version)
    .option('-v, --verbose', t('commands:cli.options.verbose'))
    .option('-q, --quiet', t('commands:cli.options.quiet'))
    .option('--lang <language>', t('commands:cli.options.lang'), 'en');

  // init コマンド - プロジェクト初期化
  program
    .command('init')
    .description(t('commands:init.description'))
    .option('-f, --force', t('commands:init.options.force'))
    .option('-l, --lang <language>', t('commands:init.options.lang'), 'en')
    .option('-d, --dir <directory>', t('commands:init.options.dir'))
    .option('-t, --template <template>', t('commands:init.options.template'))
    .option('--description <desc>', t('commands:init.options.description'))
    .option('--priority <priority>', t('commands:init.options.priority'), '50')
    .option('--tags <tags>', t('commands:init.options.tags'))
    .option('--check-interval <ms>', t('commands:init.options.checkInterval'))
    .option('--max-concurrent <num>', t('commands:init.options.maxConcurrent'))
    .option('--cpu-weight <weight>', t('commands:init.options.cpuWeight'))
    .option('--memory-limit <limit>', t('commands:init.options.memoryLimit'))
    .option('--disabled', t('commands:init.options.disabled'))
    .option('--no-agents', t('commands:init.options.noAgents'))
    .option('--no-interactive', t('commands:init.options.noInteractive'))
    .action(async (options) => {
      try {
        const initCommand = new InitCommand();
        await initCommand.execute(options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // init-simple コマンド - 簡易初期化
  program
    .command('init-simple')
    .description('Initialize PoppoBuilder with minimal configuration (3 questions only)')
    .option('-f, --force', 'Force overwrite existing configuration')
    .action(async (options) => {
      try {
        const { handleSimpleInit } = require('../lib/cli/commands/init-simple');
        await handleSimpleInit(options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // start コマンド - PoppoBuilder起動
  program
    .command('start')
    .description(t('commands:start.description'))
    .option('-d, --daemon', t('commands:start.options.daemon'))
    .option('-c, --config <path>', t('commands:start.options.config'), '.poppobuilder/config.json')
    .option('--agents', t('commands:start.options.agents'))
    .option('--dry-run', t('commands:start.options.dryRun'))
    .action(async (options) => {
      try {
        const startCommand = new StartCommand();
        await startCommand.execute(options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // stop コマンド - PoppoBuilder停止
  program
    .command('stop')
    .description(t('commands:stop.description'))
    .option('--force', t('commands:stop.options.force'))
    .action(async (options) => {
      try {
        const { stopService } = require('../lib/commands/stop');
        await stopService(options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // status コマンド - 状態確認
  program
    .command('status [projectId]')
    .description(t('commands:status.description'))
    .option('-j, --json', t('commands:status.options.json'))
    .option('-w, --watch', t('commands:status.options.watch'))
    .action(async (projectId, options) => {
      try {
        const statusCommand = new StatusCommand();
        await statusCommand.execute({ ...options, projectId });
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // config コマンド - 設定管理
  program
    .command('config [action] [args...]')
    .description(t('commands:config.description'))
    .option('-g, --global', t('commands:config.options.global'))
    .option('-l, --list', t('commands:config.options.list'))
    .option('-e, --edit', t('commands:config.options.edit'))
    .option('--max-processes <n>', t('commands:config.options.maxProcesses'))
    .option('--strategy <strategy>', t('commands:config.options.strategy'))
    .option('--lang <language>', 'set global language (en, ja)')
    .allowUnknownOption()
  .action(async (action, args, options) => {
    try {
      const configCommand = new ConfigCommand();
      
      // Handle special option flags
      if (options.maxProcesses) {
        await configCommand.execute('--max-processes', [options.maxProcesses]);
      } else if (options.strategy) {
        await configCommand.execute('--strategy', [options.strategy]);
      } else if (options.lang) {
        await configCommand.execute('--lang', [options.lang]);
      } else if (options.list) {
        await configCommand.execute('--list', []);
      } else {
        await configCommand.execute(action, args);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// global-config コマンド - グローバル設定管理
program
  .command('global-config <action> [args...]')
  .description('Manage PoppoBuilder global configuration')
  .action(async (action, args) => {
    try {
      // Spawn the global-config command
      const { spawn } = require('child_process');
      const globalConfigPath = path.join(__dirname, '..', 'lib', 'commands', 'global-config.js');
      const child = spawn('node', [globalConfigPath, action, ...args], {
        stdio: 'inherit'
      });
      
      child.on('exit', (code) => {
        process.exit(code);
      });
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// daemon コマンド - デーモン管理
const DaemonCommand = require('../lib/commands/daemon');
const daemonCmd = program
  .command('daemon <action>')
  .description('Manage PoppoBuilder daemon process')
  .option('-j, --json', 'Output in JSON format')
  .option('-f, --follow', 'Follow logs in real-time')
  .option('-n, --lines <number>', 'Number of log lines to show', '50')
  .action(async (action, options) => {
    try {
      const daemonCommand = new DaemonCommand();
      await daemonCommand.execute(action, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

  // project コマンド - プロジェクト管理
  program.addCommand(require('../lib/commands/project')());

  // redis コマンド - Redis管理
  program
    .command('redis-enable')
    .description('Enable Redis mode for state management')
    .action(async () => {
      try {
        const { handleRedisEnable } = require('../lib/cli/commands/redis');
        await handleRedisEnable();
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  program
    .command('redis-disable')
    .description('Disable Redis mode and revert to file-based state management')
    .action(async () => {
      try {
        const { handleRedisDisable } = require('../lib/cli/commands/redis');
        await handleRedisDisable();
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // template コマンド - テンプレート管理
  const TemplateCommand = require('../lib/commands/template');
  const templateCommand = new TemplateCommand();
  templateCommand.register(program);

  // list コマンド - プロジェクト一覧
  const ListCommand = require('../lib/commands/list');
  program
    .command('list')
    .alias('ls')
    .description(t('commands:list.description'))
    .option('--enabled', t('commands:list.options.enabled'))
    .option('--disabled', t('commands:list.options.disabled'))
    .option('--tag <tag>', t('commands:list.options.tag'))
    .option('--sort <field>', t('commands:list.options.sort'), 'name')
    .option('--table', t('commands:list.options.table'))
    .option('--json', t('commands:list.options.json'))
    .option('--status', t('commands:list.options.status'))
    .option('-v, --verbose', t('commands:list.options.verbose'))
    .option('-q, --quiet', t('commands:list.options.quiet'))
    .action(async (options) => {
      try {
        const listCommand = new ListCommand();
        await listCommand.execute(options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // logs コマンド - ログ表示
  const LogsCommand = require('../lib/commands/logs');
  const logsCommandDef = LogsCommand.getCommandDefinition();
  const logsCommand = program
    .command(logsCommandDef.command)
    .description(t('commands:logs.description'));

  // Add all options from command definition
  logsCommandDef.options.forEach(option => {
    logsCommand.option(...option);
  });

  logsCommand.action(logsCommandDef.action);

  // monitor コマンド - システム監視
  const MonitorCommand = require('../lib/commands/monitor');
  const monitorCommandDef = MonitorCommand.getCommandDefinition();
  const monitorCommand = program
    .command(monitorCommandDef.command)
    .description(t('commands:monitor.description'));

  // Add all options from command definition
  monitorCommandDef.options.forEach(option => {
    monitorCommand.option(...option);
  });

  monitorCommand.action(monitorCommandDef.action);

  // memory コマンド - メモリ監視・最適化
  const MemoryCommand = require('../lib/commands/memory');
  program
    .command('memory [action]')
    .description('Monitor and optimize memory usage')
    .option('--json', 'output in JSON format')
    .option('--interval <ms>', 'monitoring interval in milliseconds')
    .option('--graph', 'show graph in monitor mode')
    .option('--clear', 'clear screen in monitor mode')
    .option('--output <file>', 'output file for reports/snapshots')
    .option('--format <format>', 'report format (json, markdown)')
    .option('--samples <n>', 'number of history samples')
    .option('--clear-cache', 'clear require cache during optimization')
    .option('--low-priority', 'set process to low priority')
    .option('--quiet', 'minimal output')
    .action(async (action, options) => {
      try {
        const memoryCommand = new MemoryCommand();
        await memoryCommand.execute(action, options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // enable コマンド - プロジェクト有効化
  const EnableCommand = require('../lib/commands/enable');
  program
    .command('enable <projectname>')
    .alias('on')
    .description(t('commands:enable.description'))
    .action(async (projectName, options) => {
      try {
        const enableCommand = new EnableCommand();
        await enableCommand.execute(projectName, options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // disable コマンド - プロジェクト無効化
  const DisableCommand = require('../lib/commands/disable');
  program
    .command('disable <projectname>')
    .alias('off')
    .description(t('commands:disable.description'))
    .option('--force', t('commands:disable.options.force'))
    .action(async (projectName, options) => {
      try {
        const disableCommand = new DisableCommand();
        await disableCommand.execute(projectName, options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // remove コマンド - プロジェクト削除
  const RemoveCommand = require('../lib/commands/remove');
  program
    .command('remove <projectname>')
    .alias('rm')
    .alias('del')
    .description(t('commands:remove.description'))
    .option('--force', t('commands:remove.options.force'))
    .option('--clean', t('commands:remove.options.clean'))
    .action(async (projectName, options) => {
      try {
        const removeCommand = new RemoveCommand();
        await removeCommand.execute(projectName, options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // move コマンド - プロジェクト移動
  const MoveCommand = require('../lib/commands/move');
  program
    .command('move <projectIdOrPath> <newPath>')
    .alias('mv')
    .description(t('commands:move.description'))
    .option('--force', t('commands:move.options.force'))
    .option('--parents', t('commands:move.options.parents'))
    .option('--merge', t('commands:move.options.merge'))
    .option('--symlink', t('commands:move.options.symlink'))
    .action(async (projectIdOrPath, newPath, options) => {
      try {
        const moveCommand = new MoveCommand();
        await moveCommand.execute(projectIdOrPath, newPath, options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // doctor コマンド - 診断
  program
    .command('doctor')
    .description(t('commands:doctor.description'))
    .option('--fix', t('commands:doctor.options.fix'))
    .action(async (options) => {
      try {
        const { runDoctor } = require('../lib/commands/doctor');
        await runDoctor(options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // upgrade コマンド - アップグレード
  program
    .command('upgrade')
    .description(t('commands:upgrade.description'))
    .option('--check', t('commands:upgrade.options.check'))
    .action(async (options) => {
      try {
        const { upgradePoppoBuilder } = require('../lib/commands/upgrade');
        await upgradePoppoBuilder(options);
      } catch (error) {
        console.error(chalk.red(t('general.error') + ':'), error.message);
        process.exit(1);
      }
    });

  // pr コマンド - PR作成ガイド
  const PRCommand = require('../lib/commands/pr');
  const prCommandDef = PRCommand.getCommandDefinition();
  const prCommand = program
    .command(prCommandDef.command)
    .description(t('commands:pr.description'));

  // Add all options from command definition
  prCommandDef.options.forEach(option => {
    prCommand.option(...option);
  });

  prCommand.action(prCommandDef.action);

  // エラーハンドリング
  program.on('command:*', () => {
    console.error(chalk.red(t('errors:command.invalid', { command: program.args.join(' ') })));
    console.log(t('general.runHelp', { command: chalk.cyan('poppobuilder --help') }));
    process.exit(1);
  });

  // ヘルプ表示のカスタマイズ
  program.configureHelp({
    // Override the built-in help formatter to support i18n
    formatHelp: (cmd, helper) => {
      const termWidth = helper.padWidth(cmd, helper);
      const helpWidth = helper.helpWidth || 80;
      const itemIndentWidth = 2;
      const itemSeparatorWidth = 2;

      function formatItem(term, description) {
        if (description) {
          const fullText = `${term.padEnd(termWidth + itemSeparatorWidth)}${description}`;
          return helper.wrap(fullText, helpWidth - itemIndentWidth, termWidth + itemSeparatorWidth);
        }
        return term;
      }

      function formatList(textArray) {
        return textArray.join('\n').replace(/^/gm, ' '.repeat(itemIndentWidth));
      }

      let output = [];

      // Usage
      const commandUsage = helper.commandUsage(cmd);
      output = output.concat([t('commands:help.usage', { command: commandUsage }), '']);

      // Description
      const commandDescription = helper.commandDescription(cmd);
      if (commandDescription.length > 0) {
        output = output.concat([commandDescription, '']);
      }

      // Arguments
      const argumentList = helper.visibleArguments(cmd).map((argument) => {
        return formatItem(helper.argumentTerm(argument), helper.argumentDescription(argument));
      });
      if (argumentList.length > 0) {
        output = output.concat(['Arguments:', formatList(argumentList), '']);
      }

      // Options  
      const optionList = helper.visibleOptions(cmd).map((option) => {
        return formatItem(helper.optionTerm(option), helper.optionDescription(option));
      });
      if (optionList.length > 0) {
        output = output.concat([t('commands:help.options'), formatList(optionList), '']);
      }

      // Commands
      const commandList = helper.visibleCommands(cmd).map((cmd) => {
        return formatItem(helper.subcommandTerm(cmd), helper.subcommandDescription(cmd));
      });
      if (commandList.length > 0) {
        output = output.concat([t('commands:help.commands'), formatList(commandList), '']);
      }

      return output.join('\n');
    }
  });

  program.on('--help', () => {
    console.log('');
    console.log(t('commands:help.examples'));
    console.log('');
    console.log(`  $ poppobuilder init                    # ${t('commands:help.examplesList.init')}`);
    console.log(`  $ poppobuilder init --template advanced # ${t('commands:help.examplesList.initTemplate')}`);
    console.log(`  $ poppobuilder start                   # ${t('commands:help.examplesList.start')}`);
    console.log(`  $ poppobuilder start --daemon          # ${t('commands:help.examplesList.startDaemon')}`);
    console.log(`  $ poppobuilder status                  # ${t('commands:help.examplesList.status')}`);
    console.log(`  $ poppobuilder logs -f                 # ${t('commands:help.examplesList.logs')}`);
    console.log(`  $ poppobuilder config --list           # ${t('commands:help.examplesList.config')}`);
    console.log('');
    console.log(t('commands:help.moreInfo'));
    console.log(chalk.cyan('https://github.com/medamap/PoppoBuilderSuite'));
  });

  // バージョン表示のカスタマイズ
  program.on('option:version', () => {
    console.log(`PoppoBuilder v${packageInfo.version}`);
    console.log(`Node.js ${process.version}`);
    console.log(`${t('general.platform')}: ${process.platform} ${process.arch}`);
    process.exit(0);
  });
} // End of setupProgram function

// メイン処理
async function main() {
  try {
    // For init-simple, skip complex initialization
    if (process.argv[2] === 'init-simple') {
      // Minimal setup for init-simple
      const { Command } = require('commander');
      const program = new Command();
      
      program
        .name('poppobuilder')
        .version(packageInfo.version);
        
      program
        .command('init-simple')
        .description('Initialize PoppoBuilder with minimal configuration (3 questions only)')
        .option('-f, --force', 'Force overwrite existing configuration')
        .action(async (options) => {
          try {
            const { handleSimpleInit } = require('../lib/cli/commands/init-simple');
            await handleSimpleInit(options);
          } catch (error) {
            console.error(chalk.red('Error:'), error.message);
            process.exit(1);
          }
        });
        
      await program.parseAsync(process.argv);
      return;
    }
    
    // Parse command line args to get language option early
    const commandLineOptions = runtimeSwitcher.parseCommandLineArgs(process.argv);
    
    // Initialize runtime language switcher with command line options
    const selectedLanguage = await runtimeSwitcher.initialize(commandLineOptions);
    
    // Initialize i18n with the selected language
    await initI18n({ i18nextOptions: { lng: selectedLanguage } });

    // Setup program with i18n translations
    setupProgram();

    // グローバル設定の確認
    const globalConfigPath = path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'config.json');
    const localConfigPath = path.join(process.cwd(), '.poppobuilder', 'config.json');
    
    // 初期化されていない場合の警告
    if (process.argv[2] !== 'init' && process.argv[2] !== 'init-simple' && !fs.existsSync(localConfigPath) && !fs.existsSync(globalConfigPath)) {
      console.log(chalk.yellow(t('messages:notInitialized')));
      console.log(t('messages:runInit', { command: chalk.cyan('poppobuilder init') }));
      console.log(chalk.gray('For quick setup with only 3 questions: ' + chalk.cyan('poppobuilder init-simple')));
      console.log('');
    }
    
    // コマンド解析と実行
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(chalk.red(t('errors:fatal')), error.message);
    if (program.opts().verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// 実行
main();