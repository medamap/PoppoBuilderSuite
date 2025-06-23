/**
 * Simplified PoppoBuilder Global Initialization
 * Maximum 3 questions for better UX
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { getInstance: getGlobalConfigManager } = require('../../core/global-config-manager');
const { 
  validateGlobalConfigDir, 
  validatePort, 
  checkPortAvailable,
  validateProcessCount 
} = require('../utils/validation');
const { execSync } = require('child_process');
const ora = require('ora');
const {
  saveProgress,
  loadProgress,
  clearRecovery,
  hasRecoverableSetup,
  getRecoverySummary
} = require('../utils/setup-recovery');

/**
 * Simplified configuration collection - only essential questions
 */
async function collectSimpleConfiguration() {
  console.log(chalk.cyan('PoppoBuilder グローバル設定\n'));
  console.log(chalk.gray('必要最小限の設定のみ行います。詳細設定は後から変更できます。\n'));

  // Check GitHub authentication status first
  try {
    execSync('gh auth status', { stdio: 'ignore' });
    console.log(chalk.green('✓ GitHub CLI already authenticated'));
  } catch {
    console.log(chalk.yellow('⚠️  GitHub CLI not authenticated'));
    console.log(chalk.gray('実行してください: ') + chalk.cyan('gh auth login'));
    console.log(chalk.gray('その後、このコマンドを再実行してください。\n'));
    process.exit(1);
  }

  // Detect system locale for default language
  const systemLocale = process.env.LANG || process.env.LC_ALL || process.env.LC_MESSAGES || 'en_US';
  const defaultLanguage = systemLocale.toLowerCase().includes('ja') ? 'ja' : 'en';

  // Use 2 as default for concurrent processes
  const defaultProcesses = 2;

  const questions = [
    {
      type: 'input',
      name: 'maxProcesses',
      message: '同時実行タスク数:',
      default: defaultProcesses,
      validate: (input) => {
        const validation = validateProcessCount(input);
        if (validation.valid) return true;
        
        // Return first error message with hint
        const error = validation.errors[0];
        return error.hint ? `${error.message} (${error.hint})` : error.message;
      },
      filter: (input) => parseInt(input)
    },
    {
      type: 'list',
      name: 'language',
      message: '表示言語:',
      choices: [
        { name: '日本語', value: 'ja' },
        { name: 'English', value: 'en' }
      ],
      default: defaultLanguage
    },
    {
      type: 'confirm',
      name: 'useRedis',
      message: 'Redisを使用しますか？ (高速化されます)',
      default: false
    }
  ];

  return await inquirer.prompt(questions);
}

/**
 * Build complete configuration with sensible defaults
 */
function buildConfiguration(answers) {
  const config = {
    version: "1.0.0",
    daemon: {
      enabled: true,
      maxProcesses: answers.maxProcesses,
      schedulingStrategy: "weighted-round-robin", // Best default
      port: 3003,
      socketPath: null
    },
    resources: {
      maxMemoryMB: 4096,
      maxCpuPercent: 80
    },
    defaults: {
      pollingInterval: 300000, // 5 minutes
      timeout: 600000, // 10 minutes
      retryAttempts: 3,
      retryDelay: 5000,
      language: answers.language
    },
    registry: {
      maxProjects: 20,
      autoDiscovery: false,
      discoveryPaths: []
    },
    logging: {
      level: "info",
      directory: "~/.poppobuilder/logs",
      maxFiles: 30,
      maxSize: "10M"
    },
    telemetry: {
      enabled: false,
      endpoint: null
    },
    updates: {
      checkForUpdates: true,
      autoUpdate: false,
      channel: "stable"
    }
  };

  // Add Redis configuration if selected
  if (answers.useRedis) {
    config.stateManagement = {
      type: 'redis',
      redis: {
        host: '127.0.0.1',
        port: 6379,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3
      }
    };
  } else {
    config.stateManagement = {
      type: 'file',
      file: {
        syncInterval: 5000,
        compactionInterval: 86400000
      }
    };
  }

  return config;
}

/**
 * Simplified init handler
 */
async function handleSimpleInit(options) {
  try {
    // Skip banner if non-interactive mode
    if (!options.maxProcesses && !options.language) {
      console.clear();
      console.log(chalk.cyan('╔════════════════════════════════════════╗'));
      console.log(chalk.cyan('║      PoppoBuilder 初期設定 (簡易版)    ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════╝'));
      console.log();
    }

    // Check for recoverable setup
    if (await hasRecoverableSetup() && !options.force) {
      // Skip recovery prompt if CLI options are provided
      if (options.maxProcesses && options.language) {
        await clearRecovery();
      } else {
        const summary = await getRecoverySummary();
        console.log(chalk.yellow('⚠️  未完了の設定が見つかりました。'));
        console.log(chalk.gray(`最終更新: ${new Date(summary.lastTimestamp).toLocaleString()}`));
        console.log(chalk.gray(`完了ステップ: ${summary.completedSteps.join(', ')}\n`));
        
        const { resume } = await inquirer.prompt([{
          type: 'confirm',
          name: 'resume',
          message: '前回の設定を続行しますか？',
          default: true
        }]);
        
        if (!resume) {
          await clearRecovery();
        }
      }
    }

    // Validate global config directory
    const dirValidation = await validateGlobalConfigDir();
    if (!dirValidation.valid && !dirValidation.needsCreation) {
      console.error(chalk.red('\n❌ 設定ディレクトリの検証に失敗しました:'));
      dirValidation.errors.forEach(error => {
        console.error(chalk.red(`  • ${error.message}`));
        if (error.hint) {
          console.error(chalk.yellow(`    💡 ${error.hint}`));
        }
      });
      process.exit(1);
    }

    // Check if already initialized
    const globalConfigDir = path.join(os.homedir(), '.poppobuilder');
    const configFile = path.join(globalConfigDir, 'config.json');
    
    if (!dirValidation.needsCreation && !options.force) {
      // Skip confirmation if CLI options are provided
      if (!(options.maxProcesses && options.language)) {
        console.log(chalk.yellow('⚠️  PoppoBuilderは既に初期化されています。'));
        console.log(chalk.gray(`設定ファイル: ${configFile}\n`));
        
        const { overwrite } = await inquirer.prompt([{
          type: 'confirm',
          name: 'overwrite',
          message: '既存の設定を上書きしますか？',
          default: false
        }]);
        
        if (!overwrite) {
          console.log(chalk.yellow('\n初期化をキャンセルしました。'));
          console.log(chalk.gray('現在の設定を確認: poppo-builder config show'));
          return;
        }
      } else {
        console.log(chalk.yellow('⚠️  既存の設定を上書きします。'));
      }
    }

    // Load previous answers if resuming
    const recovery = await loadProgress();
    let answers;
    
    // Check if options provided via CLI
    if (options.maxProcesses && options.language) {
      // Use CLI options directly
      answers = {
        maxProcesses: parseInt(options.maxProcesses),
        language: options.language
      };
      console.log(chalk.blue('📝 CLI オプションから設定を読み込みました'));
    } else if (recovery && recovery.configuration) {
      console.log(chalk.blue('♻️  前回の設定を復元中...'));
      answers = recovery.configuration.data;
    } else {
      // Collect simplified configuration
      answers = await collectSimpleConfiguration();
      await saveProgress('configuration', answers);
    }
    
    // Check Redis if selected
    if (answers.useRedis) {
      const spinner = ora('Redisの状態を確認中...').start();
      const redisStatus = await checkRedisStatus();
      
      if (!redisStatus.installed) {
        spinner.fail('Redisがインストールされていません');
        const { installRedis } = await inquirer.prompt([{
          type: 'confirm',
          name: 'installRedis',
          message: 'Redisをインストールしますか？',
          default: true
        }]);
        
        if (!installRedis) {
          console.log(chalk.yellow('Redisを使用しない設定に変更します。'));
          answers.useRedis = false;
        } else {
          await installAndStartRedis();
        }
      } else if (!redisStatus.running) {
        spinner.warn('Redisが起動していません');
        const { startRedis } = await inquirer.prompt([{
          type: 'confirm',
          name: 'startRedis',
          message: 'Redisを起動しますか？',
          default: true
        }]);
        
        if (!startRedis) {
          console.log(chalk.yellow('Redisを使用しない設定に変更します。'));
          answers.useRedis = false;
        } else {
          await startRedisService();
        }
      } else {
        spinner.succeed('Redisが利用可能です');
      }
    }
    
    const config = buildConfiguration(answers);

    // Validate port availability
    console.log(chalk.blue('\n🔍 システム設定を検証中...'));
    const portValidation = validatePort(config.daemon.port);
    if (!portValidation.valid) {
      console.error(chalk.red('\n❌ ポート設定エラー:'));
      portValidation.errors.forEach(error => {
        console.error(chalk.red(`  • ${error.message}`));
        if (error.hint) {
          console.error(chalk.yellow(`    💡 ${error.hint}`));
        }
      });
      process.exit(1);
    }

    const portCheck = await checkPortAvailable(config.daemon.port);
    if (!portCheck.available) {
      console.error(chalk.red('\n❌ ポートエラー:'));
      console.error(chalk.red(`  • ${portCheck.error.message}`));
      if (portCheck.error.hint) {
        console.error(chalk.yellow(`    💡 ${portCheck.error.hint}`));
      }
      process.exit(1);
    }

    // Check if directories already created
    if (!recovery || !recovery.directories) {
      // Create directory structure
      console.log(chalk.blue('\n📁 ディレクトリを作成中...'));
      const dirs = [
        globalConfigDir,
        path.join(globalConfigDir, 'logs'),
        path.join(globalConfigDir, 'data'),
        path.join(globalConfigDir, 'projects'),
        path.join(globalConfigDir, 'cache')
      ];
      
      for (const dir of dirs) {
        await fs.mkdir(dir, { recursive: true });
      }
      
      await saveProgress('directories', { created: dirs });
    }

    // Save configuration
    console.log(chalk.blue('\n💾 設定を保存中...'));
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    await saveProgress('config_saved', { path: configFile });
    
    // Initialize global components
    console.log(chalk.blue('\n🔧 コンポーネントを初期化中...'));
    const globalConfigManager = getGlobalConfigManager();
    await globalConfigManager.initialize();
    
    // Clean up to prevent hanging
    globalConfigManager.stopWatching();

    // Success message
    console.log(chalk.green('\n✅ PoppoBuilderの初期設定が完了しました！'));
    console.log();
    console.log(chalk.yellow('次のステップ:'));
    console.log(chalk.white('1. プロジェクトディレクトリに移動'));
    console.log(chalk.white('2. 実行: ') + chalk.cyan('poppo-builder register'));
    console.log();
    
    // Show helpful commands
    console.log(chalk.gray('\n便利なコマンド:'));
    console.log(chalk.gray('  poppo-builder status    - 状態確認'));
    console.log(chalk.gray('  poppo-builder start     - デーモン起動'));
    console.log(chalk.gray('  poppo-builder config    - 設定確認・変更'));
    
    // Clear recovery file on success
    await clearRecovery();
    
    // Exit successfully
    process.exit(0);

  } catch (error) {
    console.error(chalk.red('\n❌ エラーが発生しました:'));
    console.error(chalk.red(error.message));
    
    if (error.message.includes('EACCES')) {
      console.error(chalk.yellow('\n💡 ヒント: 権限エラーです。管理者権限で実行するか、ホームディレクトリの権限を確認してください。'));
    }
    
    process.exit(1);
  }
}

/**
 * Check Redis status
 */
async function checkRedisStatus() {
  try {
    // Check if Redis is running
    execSync('redis-cli ping', { stdio: 'ignore' });
    return { installed: true, running: true };
  } catch (error) {
    // Try to determine if Redis is installed but not running
    try {
      execSync('which redis-server', { stdio: 'ignore' });
      return { installed: true, running: false };
    } catch {
      return { installed: false, running: false };
    }
  }
}

/**
 * Install and start Redis
 */
async function installAndStartRedis() {
  const spinner = ora('Redisをインストール中...').start();
  
  try {
    if (process.platform === 'darwin') {
      // macOS: Install via Homebrew
      spinner.text = 'Homebrew経由でRedisをインストール中...';
      
      // Check if Homebrew is installed
      try {
        execSync('which brew', { stdio: 'ignore' });
      } catch {
        spinner.fail('Homebrewがインストールされていません。先にHomebrewをインストールしてください: https://brew.sh');
        return false;
      }
      
      // Install Redis
      execSync('brew install redis', { stdio: 'inherit' });
      
      // Start Redis service
      spinner.text = 'Redisサービスを起動中...';
      execSync('brew services start redis', { stdio: 'inherit' });
      
    } else if (process.platform === 'linux') {
      // Linux: Try apt-get first, then yum
      spinner.text = 'Redisをインストール中...';
      
      try {
        // Try apt-get (Debian/Ubuntu)
        execSync('sudo apt-get update && sudo apt-get install -y redis-server', { stdio: 'inherit' });
        execSync('sudo systemctl start redis-server', { stdio: 'inherit' });
      } catch {
        try {
          // Try yum (RHEL/CentOS)
          execSync('sudo yum install -y redis', { stdio: 'inherit' });
          execSync('sudo systemctl start redis', { stdio: 'inherit' });
        } catch {
          spinner.fail('Redisのインストールに失敗しました。手動でインストールしてください。');
          return false;
        }
      }
    } else {
      spinner.fail(`${process.platform}でのRedisインストールはサポートされていません。手動でインストールしてください。`);
      return false;
    }
    
    spinner.succeed('Redisのインストールと起動が完了しました');
    return true;
    
  } catch (error) {
    spinner.fail(`Redisのインストールに失敗しました: ${error.message}`);
    return false;
  }
}

/**
 * Start Redis service
 */
async function startRedisService() {
  const spinner = ora('Redisサービスを起動中...').start();
  
  try {
    if (process.platform === 'darwin') {
      execSync('brew services start redis', { stdio: 'inherit' });
    } else if (process.platform === 'linux') {
      try {
        execSync('sudo systemctl start redis-server', { stdio: 'inherit' });
      } catch {
        execSync('sudo systemctl start redis', { stdio: 'inherit' });
      }
    }
    
    // Verify Redis is running
    execSync('redis-cli ping', { stdio: 'ignore' });
    
    spinner.succeed('Redisサービスが起動しました');
    return true;
    
  } catch (error) {
    spinner.fail(`Redisの起動に失敗しました: ${error.message}`);
    return false;
  }
}

module.exports = {
  handleSimpleInit,
  collectSimpleConfiguration,
  buildConfiguration
};