/**
 * PoppoBuilder Init Command
 * プロジェクトの初期化を行う
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const readline = require('readline');
const { promisify } = require('util');
const i18n = require('../i18n');

class InitCommand {
  constructor() {
    this.configDir = '.poppobuilder';
    this.configFile = 'config.json';
    this.stateDir = 'state';
    this.logsDir = 'logs';
  }

  async execute(options) {
    // Initialize i18n
    await i18n.init({ language: options.lang || 'en' });

    console.log(chalk.blue(`🚀 ${i18n.t('commands.init.description')}`));
    console.log();

    // Run setup wizard first (Git, gh, branch setup)
    const SetupWizard = require('./setup-wizard');
    const wizard = new SetupWizard();
    
    console.log(chalk.cyan('First, let\'s ensure your development environment is properly set up...'));
    const setupSuccess = await wizard.runSetup(options);
    
    if (!setupSuccess) {
      console.log(chalk.red('Setup wizard failed. Please complete the setup before initializing PoppoBuilder.'));
      return;
    }

    // 既存設定の確認
    const configPath = path.join(process.cwd(), this.configDir, this.configFile);
    if (await this.fileExists(configPath) && !options.force) {
      console.log(chalk.yellow(`⚠️  ${i18n.t('commands.init.alreadyExists')}`));
      console.log('Use --force to overwrite existing configuration.');
      return;
    }

    // プロジェクト情報の取得
    const projectInfo = await this.getProjectInfo();
    
    // 対話的セットアップ
    let config;
    if (options.interactive !== false) {
      config = await this.interactiveSetup(options, projectInfo);
    } else {
      config = this.createDefaultConfig(options, projectInfo);
    }

    // ディレクトリ作成
    await this.createDirectories();

    // 設定ファイル保存
    await this.saveConfig(config);

    // .gitignore更新
    await this.updateGitignore();

    // 完了メッセージ
    this.showCompletionMessage(config);
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async getProjectInfo() {
    const info = {
      name: path.basename(process.cwd()),
      hasGit: await this.fileExists('.git'),
      hasPackageJson: await this.fileExists('package.json'),
      gitRemote: null
    };

    // Gitリモート情報の取得
    if (info.hasGit) {
      try {
        const { execSync } = require('child_process');
        const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
        const match = remoteUrl.match(/github\.com[:/]([^/]+)\/(.+?)(\.git)?$/);
        if (match) {
          info.gitRemote = {
            owner: match[1],
            repo: match[2]
          };
        }
      } catch {
        // Git remote not found
      }
    }

    return info;
  }

  async interactiveSetup(options, projectInfo) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    console.log(chalk.cyan(`📋 ${i18n.t('commands.init.creating')}`));
    console.log();

    const config = {
      version: '1.0',
      project: {},
      language: {},
      github: {},
      claude: {},
      features: {},
      monitoring: {}
    };

    // プロジェクト名
    config.project.name = await question(
      `Project name (${projectInfo.name}): `
    ) || projectInfo.name;

    // GitHub設定
    if (projectInfo.gitRemote) {
      const useDetected = await question(
        `Use detected GitHub repo ${projectInfo.gitRemote.owner}/${projectInfo.gitRemote.repo}? (Y/n): `
      );
      if (useDetected.toLowerCase() !== 'n') {
        config.github.owner = projectInfo.gitRemote.owner;
        config.github.repo = projectInfo.gitRemote.repo;
      }
    }

    if (!config.github.owner) {
      config.github.owner = await question('GitHub owner/organization: ');
      config.github.repo = await question('GitHub repository name: ');
    }

    // GitHub Token
    const hasToken = await question('Do you have a GitHub token? (y/N): ');
    if (hasToken.toLowerCase() === 'y') {
      config.github.token = await question('GitHub token (will be stored securely): ');
    } else {
      console.log(chalk.yellow('You will need to set GITHUB_TOKEN environment variable later.'));
    }

    // 言語設定
    config.language.primary = await question(
      `Primary language (en/ja) [${options.lang || 'en'}]: `
    ) || options.lang || 'en';

    // Claude設定
    const useClaude = await question('Enable Claude API integration? (Y/n): ');
    if (useClaude.toLowerCase() !== 'n') {
      config.claude.enabled = true;
      config.claude.maxConcurrent = parseInt(
        await question('Max concurrent Claude requests (5): ') || '5'
      );
      
      const hasClaudeKey = await question('Do you have a Claude API key? (y/N): ');
      if (hasClaudeKey.toLowerCase() === 'y') {
        config.claude.apiKey = await question('Claude API key (will be stored securely): ');
      } else {
        console.log(chalk.yellow('You will need to set CLAUDE_API_KEY environment variable later.'));
      }
    }

    // エージェント機能
    if (options.agents !== false) {
      const useAgents = await question('Enable AI agents for enhanced features? (y/N): ');
      config.features.agents = useAgents.toLowerCase() === 'y';
    }

    // 監視機能
    const useMonitoring = await question('Enable monitoring and dashboard? (y/N): ');
    config.monitoring.enabled = useMonitoring.toLowerCase() === 'y';
    
    if (config.monitoring.enabled) {
      config.monitoring.port = parseInt(
        await question('Dashboard port (3001): ') || '3001'
      );
    }

    rl.close();
    return config;
  }

  createDefaultConfig(options, projectInfo) {
    return {
      version: '1.0',
      project: {
        name: projectInfo.name,
        type: 'github'
      },
      language: {
        primary: options.lang || 'en',
        fallback: 'en'
      },
      github: {
        owner: projectInfo.gitRemote?.owner || 'YOUR_GITHUB_OWNER',
        repo: projectInfo.gitRemote?.repo || 'YOUR_GITHUB_REPO',
        token: process.env.GITHUB_TOKEN || null
      },
      claude: {
        enabled: true,
        apiKey: process.env.CLAUDE_API_KEY || null,
        maxConcurrent: 5,
        timeout: 300000,
        maxRetries: 3
      },
      features: {
        agents: options.agents !== false,
        autoLabeling: true,
        issueTemplates: true,
        monitoring: true
      },
      monitoring: {
        enabled: true,
        port: 3001,
        logLevel: 'info'
      },
      paths: {
        logs: '.poppobuilder/logs',
        state: '.poppobuilder/state',
        data: '.poppobuilder/data'
      },
      tasks: {
        labels: ['task:misc', 'task:dogfooding', 'task:bug', 'task:feature', 'task:docs'],
        priorityLabels: {
          high: ['priority:high', 'urgent'],
          medium: ['priority:medium'],
          low: ['priority:low']
        }
      }
    };
  }

  async createDirectories() {
    const dirs = [
      this.configDir,
      path.join(this.configDir, this.stateDir),
      path.join(this.configDir, this.logsDir),
      path.join(this.configDir, 'data')
    ];

    for (const dir of dirs) {
      const fullPath = path.join(process.cwd(), dir);
      await fs.mkdir(fullPath, { recursive: true });
    }
  }

  async saveConfig(config) {
    const configPath = path.join(process.cwd(), this.configDir, this.configFile);
    
    // 機密情報を環境変数として分離
    const publicConfig = { ...config };
    const envVars = [];

    if (config.github.token) {
      envVars.push(`GITHUB_TOKEN=${config.github.token}`);
      publicConfig.github.token = '${GITHUB_TOKEN}';
    }

    if (config.claude?.apiKey) {
      envVars.push(`CLAUDE_API_KEY=${config.claude.apiKey}`);
      publicConfig.claude.apiKey = '${CLAUDE_API_KEY}';
    }

    // 設定ファイル保存
    await fs.writeFile(
      configPath,
      JSON.stringify(publicConfig, null, 2),
      'utf8'
    );

    // .env.localファイル作成（機密情報用）
    if (envVars.length > 0) {
      const envPath = path.join(process.cwd(), this.configDir, '.env.local');
      await fs.writeFile(
        envPath,
        envVars.join('\n') + '\n',
        'utf8'
      );
      await fs.chmod(envPath, 0o600); // 読み取り専用
    }

    // 初期状態ファイル作成
    const stateFiles = {
      'processed-issues.json': [],
      'processed-comments.json': {},
      'running-tasks.json': [],
      'issue-status.json': {}
    };

    for (const [filename, content] of Object.entries(stateFiles)) {
      const statePath = path.join(process.cwd(), this.configDir, this.stateDir, filename);
      await fs.writeFile(statePath, JSON.stringify(content, null, 2), 'utf8');
    }
  }

  async updateGitignore() {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    const ignorePatterns = [
      '',
      '# PoppoBuilder',
      '.poppobuilder/logs/',
      '.poppobuilder/state/',
      '.poppobuilder/data/',
      '.poppobuilder/.env.local',
      '.poppobuilder/*.log',
      ''
    ];

    try {
      let content = '';
      if (await this.fileExists(gitignorePath)) {
        content = await fs.readFile(gitignorePath, 'utf8');
      }

      // 既にPoppoBuilder設定がある場合はスキップ
      if (content.includes('# PoppoBuilder')) {
        return;
      }

      // 追加
      await fs.appendFile(gitignorePath, ignorePatterns.join('\n'), 'utf8');
      console.log(chalk.green('✓ Updated .gitignore'));
    } catch (error) {
      console.log(chalk.yellow('⚠️  Could not update .gitignore. Please add .poppobuilder/logs/ and .poppobuilder/state/ manually.'));
    }
  }

  showCompletionMessage(config) {
    console.log();
    console.log(chalk.green(`✨ ${i18n.t('commands.init.success')}`));
    console.log();
    console.log(i18n.t('commands.init.nextSteps'));
    console.log();
    
    if (!config.github.token) {
      console.log('1. Set your GitHub token:');
      console.log(chalk.cyan('   export GITHUB_TOKEN=your_github_token'));
      console.log();
    }
    
    if (config.claude?.enabled && !config.claude.apiKey) {
      console.log('2. Set your Claude API key:');
      console.log(chalk.cyan('   export CLAUDE_API_KEY=your_claude_api_key'));
      console.log();
    }
    
    console.log('3. Start PoppoBuilder:');
    console.log(chalk.cyan('   poppobuilder start'));
    console.log();
    console.log('4. Check status:');
    console.log(chalk.cyan('   poppobuilder status'));
    console.log();
    console.log('For more information:');
    console.log(chalk.cyan('   poppobuilder --help'));
  }
}

module.exports = InitCommand;