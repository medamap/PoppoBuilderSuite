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

/**
 * Simplified configuration collection - only essential questions
 */
async function collectSimpleConfiguration() {
  console.log(chalk.cyan('PoppoBuilder グローバル設定\n'));
  console.log(chalk.gray('必要最小限の設定のみ行います。詳細設定は後から変更できます。\n'));

  // Auto-detect CPU cores for default
  const cpuCount = os.cpus().length;
  const recommendedProcesses = Math.max(2, Math.ceil(cpuCount / 2));

  const questions = [
    {
      type: 'input',
      name: 'maxProcesses',
      message: `同時実行タスク数 (推奨: ${recommendedProcesses}):`,
      default: recommendedProcesses,
      validate: (input) => {
        const num = parseInt(input);
        if (num > 0 && num <= 10) return true;
        return '1から10の間で入力してください';
      },
      filter: (input) => parseInt(input)
    },
    {
      type: 'confirm',
      name: 'autoStart',
      message: 'システム起動時に自動的にPoppoBuilderを開始しますか？',
      default: false
    },
    {
      type: 'list',
      name: 'language',
      message: '表示言語:',
      choices: [
        { name: '日本語', value: 'ja' },
        { name: 'English', value: 'en' }
      ],
      default: 'ja'
    }
  ];

  return await inquirer.prompt(questions);
}

/**
 * Build complete configuration with sensible defaults
 */
function buildConfiguration(answers) {
  return {
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
    },
    // Enable all advanced features by default - they just work
    taskQueue: {
      priorityManagement: {
        enabled: true,
        ageEscalation: { enabled: true },
        sla: { enabled: true },
        preemption: { enabled: false }, // Keep disabled for stability
        starvationPrevention: { enabled: true }
      }
    },
    monitoring: {
      enabled: true
    },
    autoStart: answers.autoStart
  };
}

/**
 * Simplified init handler
 */
async function handleSimpleInit(options) {
  try {
    console.clear();
    console.log(chalk.cyan('╔════════════════════════════════════════╗'));
    console.log(chalk.cyan('║      PoppoBuilder 初期設定 (簡易版)    ║'));
    console.log(chalk.cyan('╚════════════════════════════════════════╝'));
    console.log();

    // Check if already initialized
    const globalConfigDir = path.join(os.homedir(), '.poppobuilder');
    const configFile = path.join(globalConfigDir, 'config.json');
    
    try {
      await fs.access(configFile);
      if (!options.force) {
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
      }
    } catch {
      // File doesn't exist, continue
    }

    // Collect simplified configuration
    const answers = await collectSimpleConfiguration();
    const config = buildConfiguration(answers);

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

    // Save configuration
    console.log(chalk.blue('\n💾 設定を保存中...'));
    await fs.writeFile(configFile, JSON.stringify(config, null, 2));
    
    // Initialize global components
    console.log(chalk.blue('\n🔧 コンポーネントを初期化中...'));
    const globalConfigManager = getGlobalConfigManager();
    await globalConfigManager.initialize();

    // Success message
    console.log(chalk.green('\n✅ PoppoBuilderの初期設定が完了しました！'));
    console.log();
    console.log(chalk.yellow('次のステップ:'));
    console.log(chalk.white('1. プロジェクトディレクトリに移動'));
    console.log(chalk.white('2. 実行: ') + chalk.cyan('poppo-builder register'));
    console.log();
    
    if (answers.autoStart) {
      console.log(chalk.gray('※ 自動起動の設定は、次回のシステム起動時から有効になります'));
    }
    
    // Show helpful commands
    console.log(chalk.gray('\n便利なコマンド:'));
    console.log(chalk.gray('  poppo-builder status    - 状態確認'));
    console.log(chalk.gray('  poppo-builder start     - デーモン起動'));
    console.log(chalk.gray('  poppo-builder config    - 設定確認・変更'));

  } catch (error) {
    console.error(chalk.red('\n❌ エラーが発生しました:'));
    console.error(chalk.red(error.message));
    
    if (error.message.includes('EACCES')) {
      console.error(chalk.yellow('\n💡 ヒント: 権限エラーです。管理者権限で実行するか、ホームディレクトリの権限を確認してください。'));
    }
    
    process.exit(1);
  }
}

module.exports = {
  handleSimpleInit,
  collectSimpleConfiguration,
  buildConfiguration
};