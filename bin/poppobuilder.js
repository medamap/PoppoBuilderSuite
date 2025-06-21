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
const i18n = require('../lib/i18n');

// コマンドの実装をインポート
const InitCommand = require('../lib/commands/init');
const StartCommand = require('../lib/commands/start');
const StatusCommand = require('../lib/commands/status');
const ConfigCommand = require('../lib/commands/config');

// プログラム設定
const program = new Command();

program
  .name('poppobuilder')
  .description('AI-powered autonomous GitHub issue processor using Claude API')
  .version(packageInfo.version)
  .option('-v, --verbose', 'verbose output')
  .option('-q, --quiet', 'quiet output');

// init コマンド - プロジェクト初期化
program
  .command('init')
  .description('Initialize PoppoBuilder for this project')
  .option('-f, --force', 'overwrite existing configuration')
  .option('-l, --lang <language>', 'primary language (en/ja)', 'en')
  .option('-d, --dir <directory>', 'project directory to initialize')
  .option('-t, --template <template>', 'use a project template (default/minimal/advanced)')
  .option('--description <desc>', 'project description')
  .option('--priority <priority>', 'project priority (0-100)', '50')
  .option('--tags <tags>', 'comma-separated project tags')
  .option('--check-interval <ms>', 'check interval in milliseconds')
  .option('--max-concurrent <num>', 'maximum concurrent tasks')
  .option('--cpu-weight <weight>', 'CPU weight for resource allocation')
  .option('--memory-limit <limit>', 'memory limit (e.g., 512M, 2G)')
  .option('--disabled', 'register project as disabled')
  .option('--no-agents', 'disable agent features')
  .option('--no-interactive', 'skip interactive setup')
  .action(async (options) => {
    try {
      const initCommand = new InitCommand();
      await initCommand.execute(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// start コマンド - PoppoBuilder起動
program
  .command('start')
  .description('Start PoppoBuilder service')
  .option('-d, --daemon', 'run as daemon')
  .option('-c, --config <path>', 'config file path', '.poppobuilder/config.json')
  .option('--agents', 'enable agent mode')
  .option('--dry-run', 'simulate without making changes')
  .action(async (options) => {
    try {
      const startCommand = new StartCommand();
      await startCommand.execute(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// stop コマンド - PoppoBuilder停止
program
  .command('stop')
  .description('Stop PoppoBuilder service')
  .option('--force', 'force stop all processes')
  .action(async (options) => {
    try {
      const { stopService } = require('../lib/commands/stop');
      await stopService(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// status コマンド - 状態確認
program
  .command('status')
  .description('Show PoppoBuilder status')
  .option('-j, --json', 'output as JSON')
  .option('-w, --watch', 'watch mode')
  .action(async (options) => {
    try {
      const statusCommand = new StatusCommand();
      await statusCommand.execute(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// config コマンド - 設定管理
program
  .command('config [action] [args...]')
  .description('Manage PoppoBuilder configuration')
  .option('-g, --global', 'use global config')
  .option('-l, --list', 'list all settings')
  .option('-e, --edit', 'open config in editor')
  .option('--max-processes <n>', 'set maximum concurrent processes')
  .option('--strategy <strategy>', 'set scheduling strategy (round-robin, priority, weighted)')
  .allowUnknownOption()
  .action(async (action, args, options) => {
    try {
      const configCommand = new ConfigCommand();
      
      // Handle special option flags
      if (options.maxProcesses) {
        await configCommand.execute('--max-processes', [options.maxProcesses]);
      } else if (options.strategy) {
        await configCommand.execute('--strategy', [options.strategy]);
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
program
  .command('daemon <action>')
  .description('Manage PoppoBuilder daemon (start|stop|restart|status|reload|logs)')
  .option('-j, --json', 'output as JSON')
  .option('-v, --verbose', 'verbose output')
  .option('--detach', 'run daemon in detached mode', true)
  .option('--no-detach', 'run daemon in foreground')
  .action(async (action, options) => {
    try {
      const daemonCommand = new DaemonCommand();
      await daemonCommand.execute(action, options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// project コマンド - プロジェクト管理
program.addCommand(require('../lib/commands/project')());

// template コマンド - テンプレート管理
const TemplateCommand = require('../lib/commands/template');
const templateCommand = new TemplateCommand();
templateCommand.register(program);

// list コマンド - プロジェクト一覧
const ListCommand = require('../lib/commands/list');
program
  .command('list')
  .alias('ls')
  .description('List all registered PoppoBuilder projects')
  .option('--enabled', 'show only enabled projects')
  .option('--disabled', 'show only disabled projects')
  .option('--tag <tag>', 'filter by tag')
  .option('--sort <field>', 'sort by field (name|priority|path|created|updated|activity)', 'name')
  .option('--table', 'display as table')
  .option('--json', 'output as JSON')
  .option('--status', 'include runtime status information')
  .option('-v, --verbose', 'show detailed information')
  .option('-q, --quiet', 'minimal output')
  .action(async (options) => {
    try {
      const listCommand = new ListCommand();
      await listCommand.execute(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// logs コマンド - ログ表示
const LogsCommand = require('../lib/commands/logs');
const logsCommandDef = LogsCommand.getCommandDefinition();
const logsCommand = program
  .command(logsCommandDef.command)
  .description(logsCommandDef.description);

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
  .description(monitorCommandDef.description);

// Add all options from command definition
monitorCommandDef.options.forEach(option => {
  monitorCommand.option(...option);
});

monitorCommand.action(monitorCommandDef.action);

// doctor コマンド - 診断
program
  .command('doctor')
  .description('Diagnose PoppoBuilder installation and configuration')
  .option('--fix', 'attempt to fix issues automatically')
  .action(async (options) => {
    try {
      const { runDoctor } = require('../lib/commands/doctor');
      await runDoctor(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// upgrade コマンド - アップグレード
program
  .command('upgrade')
  .description('Upgrade PoppoBuilder to the latest version')
  .option('--check', 'check for updates only')
  .action(async (options) => {
    try {
      const { upgradePoppoBuilder } = require('../lib/commands/upgrade');
      await upgradePoppoBuilder(options);
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  });

// エラーハンドリング
program.on('command:*', () => {
  console.error(chalk.red(`Invalid command: ${program.args.join(' ')}`));
  console.log('Run', chalk.cyan('poppobuilder --help'), 'for a list of available commands.');
  process.exit(1);
});

// ヘルプ表示のカスタマイズ
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('');
  console.log('  $ poppobuilder init                    # Initialize in current directory');
  console.log('  $ poppobuilder init --template advanced # Initialize with advanced template');
  console.log('  $ poppobuilder start                   # Start processing issues');
  console.log('  $ poppobuilder start --daemon          # Start as background service');
  console.log('  $ poppobuilder status                  # Check service status');
  console.log('  $ poppobuilder logs -f                 # Follow logs in real-time');
  console.log('  $ poppobuilder config --list           # Show all configuration');
  console.log('  $ poppobuilder template list           # List available templates');
  console.log('  $ poppobuilder template create mytemp  # Create custom template');
  console.log('  $ poppobuilder global-config show      # Show global configuration');
  console.log('  $ poppobuilder global-config init      # Initialize global config');
  console.log('  $ poppobuilder daemon start            # Start daemon process');
  console.log('  $ poppobuilder daemon status           # Check daemon status');
  console.log('  $ poppobuilder project register ./     # Register current directory as project');
  console.log('  $ poppobuilder project list            # List all registered projects');
  console.log('  $ poppobuilder project show <id>       # Show project details');
  console.log('  $ poppobuilder list                    # List projects (default view)');
  console.log('  $ poppobuilder ls --table --verbose    # Detailed table view');
  console.log('  $ poppobuilder list --enabled --sort priority  # Enabled projects by priority');
  console.log('');
  console.log('For more information, visit:');
  console.log(chalk.cyan('https://github.com/medamap/PoppoBuilderSuite'));
});

// バージョン表示のカスタマイズ
program.on('option:version', () => {
  console.log(`PoppoBuilder v${packageInfo.version}`);
  console.log(`Node.js ${process.version}`);
  console.log(`Platform: ${process.platform} ${process.arch}`);
  process.exit(0);
});

// メイン処理
async function main() {
  try {
    // Initialize i18n with default language (English)
    await i18n.init({ language: 'en' });

    // グローバル設定の確認
    const globalConfigPath = path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'config.json');
    const localConfigPath = path.join(process.cwd(), '.poppobuilder', 'config.json');
    
    // 初期化されていない場合の警告
    if (process.argv[2] !== 'init' && !fs.existsSync(localConfigPath) && !fs.existsSync(globalConfigPath)) {
      console.log(chalk.yellow('PoppoBuilder is not initialized in this project.'));
      console.log('Run', chalk.cyan('poppobuilder init'), 'to get started.');
      console.log('');
    }
    
    // コマンド解析と実行
    await program.parseAsync(process.argv);
  } catch (error) {
    console.error(chalk.red('Fatal error:'), error.message);
    if (program.opts().verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// 実行
main();