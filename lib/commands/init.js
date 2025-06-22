/**
 * PoppoBuilder Init Command
 * プロジェクトの初期化を行う
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const { t } = require('../i18n');
const prompts = require('../utils/interactive-prompts');
const { getInstance: getProjectRegistry } = require('../core/project-registry');
const { getInstance: getGlobalConfigManager } = require('../core/global-config-manager');
const TemplateManager = require('../templates/template-manager');

class InitCommand {
  constructor() {
    this.configDir = '.poppobuilder';
    this.configFile = 'config.json';
    this.stateDir = 'state';
    this.logsDir = 'logs';
    this.templateManager = new TemplateManager();
  }

  async execute(options) {
    console.log(chalk.blue(`🚀 ${t('commands:init.description')}`));
    console.log();

    // プロジェクトディレクトリの決定
    const projectDir = options.dir ? path.resolve(options.dir) : process.cwd();
    
    console.log(chalk.gray(`Initializing project in: ${projectDir}`));
    console.log();

    // テンプレートの初期化
    await this.templateManager.initialize();

    // テンプレートが指定されている場合はテンプレートからの初期化を実行
    if (options.template) {
      return await this.initFromTemplate(projectDir, options);
    }

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
    const configPath = path.join(projectDir, this.configDir, this.configFile);
    if (await this.fileExists(configPath) && !options.force) {
      console.log(chalk.yellow(`⚠️  ${t('commands:init.alreadyInitialized')}`));
      console.log('Use --force to overwrite existing configuration.');
      return;
    }

    // プロジェクト情報の取得
    const projectInfo = await this.getProjectInfo(projectDir);
    
    // 対話的セットアップ
    let config;
    if (options.interactive !== false) {
      config = await this.interactiveSetup(options, projectInfo);
    } else {
      config = this.createDefaultConfig(options, projectInfo);
    }

    // ディレクトリ作成
    await this.createDirectories(projectDir);

    // 設定ファイル保存
    await this.saveConfig(config, projectDir);

    // .gitignore更新
    await this.updateGitignore(projectDir);

    // グローバル設定とプロジェクトレジストリの初期化
    await this.initializeGlobalComponents();

    // プロジェクトレジストリに登録
    await this.registerProject(projectDir, config, options);

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

  async getProjectInfo(projectDir = process.cwd()) {
    const info = {
      name: path.basename(projectDir),
      path: projectDir,
      hasGit: await this.fileExists(path.join(projectDir, '.git')),
      hasPackageJson: await this.fileExists(path.join(projectDir, 'package.json')),
      gitRemote: null
    };

    // Gitリモート情報の取得
    if (info.hasGit) {
      try {
        const { execSync } = require('child_process');
        const remoteUrl = execSync('git remote get-url origin', { 
          encoding: 'utf8',
          cwd: projectDir 
        }).trim();
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
    console.log(chalk.cyan(t('messages:setupWizard.configuring')));
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

    try {
      // プロジェクト名
      config.project.name = await prompts.ask('prompts:init.projectName', {
        default: projectInfo.name
      }) || projectInfo.name;

      // GitHub設定
      if (projectInfo.gitRemote) {
        const useDetected = await prompts.confirm('prompts:init.useDetectedRepo', {
          context: {
            owner: projectInfo.gitRemote.owner,
            repo: projectInfo.gitRemote.repo
          },
          default: true
        });
        
        if (useDetected) {
          config.github.owner = projectInfo.gitRemote.owner;
          config.github.repo = projectInfo.gitRemote.repo;
        }
      }

      if (!config.github.owner) {
        config.github.owner = await prompts.ask('prompts:init.githubOwner');
        config.github.repo = await prompts.ask('prompts:init.githubRepo');
      }

      // GitHub Token
      const hasToken = await prompts.confirm('prompts:init.hasGithubToken', { default: false });
      if (hasToken) {
        config.github.token = await prompts.password('prompts:init.githubToken');
      } else {
        console.log(chalk.yellow(t('prompts:init.githubTokenLater')));
      }

      // 言語設定
      config.language.primary = await prompts.ask('prompts:init.primaryLanguage', {
        default: options.lang || 'en'
      }) || options.lang || 'en';

      // Claude設定
      const useClaude = await prompts.confirm('prompts:init.enableClaude', { default: true });
      if (useClaude) {
        config.claude.enabled = true;
        config.claude.maxConcurrent = parseInt(
          await prompts.ask('prompts:init.maxConcurrentClaude', { default: '5' }) || '5'
        );
        
        const hasClaudeKey = await prompts.confirm('prompts:init.hasClaudeKey', { default: false });
        if (hasClaudeKey) {
          config.claude.apiKey = await prompts.password('prompts:init.claudeApiKey');
        } else {
          console.log(chalk.yellow(t('prompts:init.claudeKeyLater')));
        }
      }

      // エージェント機能
      if (options.agents !== false) {
        config.features.agents = await prompts.confirm('prompts:init.enableAgents', { default: false });
      }

      // 監視機能
      config.monitoring.enabled = await prompts.confirm('prompts:init.enableMonitoring', { default: false });
      
      if (config.monitoring.enabled) {
        config.monitoring.port = parseInt(
          await prompts.ask('prompts:init.dashboardPort', { default: '3001' }) || '3001'
        );
      }

      return config;
    } finally {
      prompts.close();
    }
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

  async createDirectories(projectDir = process.cwd()) {
    const dirs = [
      this.configDir,
      path.join(this.configDir, this.stateDir),
      path.join(this.configDir, this.logsDir),
      path.join(this.configDir, 'data')
    ];

    for (const dir of dirs) {
      const fullPath = path.join(projectDir, dir);
      await fs.mkdir(fullPath, { recursive: true });
    }
  }

  async saveConfig(config, projectDir = process.cwd()) {
    const configPath = path.join(projectDir, this.configDir, this.configFile);
    
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
      const envPath = path.join(projectDir, this.configDir, '.env.local');
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
      const statePath = path.join(projectDir, this.configDir, this.stateDir, filename);
      await fs.writeFile(statePath, JSON.stringify(content, null, 2), 'utf8');
    }
  }

  async updateGitignore(projectDir = process.cwd()) {
    const gitignorePath = path.join(projectDir, '.gitignore');
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

  async initializeGlobalComponents() {
    try {
      console.log(chalk.gray('Initializing global configuration...'));
      
      // グローバル設定の初期化
      const globalConfigManager = getGlobalConfigManager();
      await globalConfigManager.initialize();
      
      // プロジェクトレジストリの初期化
      const projectRegistry = getProjectRegistry();
      await projectRegistry.initialize();
      
      console.log(chalk.green('✓ Global components initialized'));
    } catch (error) {
      console.log(chalk.yellow(`⚠️  Warning: Failed to initialize global components: ${error.message}`));
      console.log(chalk.gray('You can initialize them later with: poppobuilder global-config init'));
    }
  }

  async registerProject(projectDir, config, options) {
    try {
      console.log(chalk.gray('Registering project in global registry...'));
      
      const projectRegistry = getProjectRegistry();
      
      // プロジェクト設定の構築
      const projectConfig = {
        name: config.project.name,
        description: options.description || `PoppoBuilder project: ${config.project.name}`,
        priority: parseInt(options.priority) || 50,
        tags: options.tags ? options.tags.split(',').map(t => t.trim()) : []
      };

      // GitHub情報があれば追加
      if (config.github.owner && config.github.repo) {
        projectConfig.github = {
          owner: config.github.owner,
          repo: config.github.repo
        };
      }

      // スケジュール設定
      if (options.checkInterval) {
        projectConfig.schedule = {
          checkInterval: parseInt(options.checkInterval)
        };
      }

      // リソース設定
      if (options.maxConcurrent || options.cpuWeight || options.memoryLimit) {
        projectConfig.resources = {};
        if (options.maxConcurrent) projectConfig.resources.maxConcurrent = parseInt(options.maxConcurrent);
        if (options.cpuWeight) projectConfig.resources.cpuWeight = parseFloat(options.cpuWeight);
        if (options.memoryLimit) projectConfig.resources.memoryLimit = options.memoryLimit;
      }

      const projectId = await projectRegistry.register(projectDir, {
        enabled: !options.disabled,
        config: projectConfig
      });

      console.log(chalk.green(`✓ Project registered with ID: ${chalk.cyan(projectId)}`));
      
      return projectId;
    } catch (error) {
      if (error.message.includes('already registered')) {
        console.log(chalk.yellow('⚠️  Project is already registered in the global registry'));
        
        // 既存プロジェクトの情報を表示
        const projectRegistry = getProjectRegistry();
        const existingProject = projectRegistry.getProjectByPath(projectDir);
        if (existingProject) {
          console.log(chalk.gray(`   Project ID: ${existingProject.id}`));
        }
        return null;
      } else {
        console.log(chalk.yellow(`⚠️  Warning: Failed to register project: ${error.message}`));
        console.log(chalk.gray('You can register the project later with: poppobuilder project register .'));
        return null;
      }
    }
  }

  showCompletionMessage(config) {
    console.log();
    console.log(chalk.green(`✨ ${t('prompts:init.initSuccess')}`));
    console.log();
    console.log(t('prompts:init.nextSteps'));
    console.log();
    
    if (!config.github.token) {
      console.log(`1. ${t('prompts:init.nextStep1')}:`);
      console.log(chalk.cyan('   export GITHUB_TOKEN=your_github_token'));
      console.log();
    }
    
    if (config.claude?.enabled && !config.claude.apiKey) {
      console.log(`2. ${t('prompts:init.nextStep1')}:`);
      console.log(chalk.cyan('   export CLAUDE_API_KEY=your_claude_api_key'));
      console.log();
    }
    
    console.log(`3. ${t('prompts:init.nextStep2')}:`);
    console.log(chalk.cyan('   poppobuilder start'));
    console.log();
    
    if (config.monitoring?.enabled) {
      console.log(`4. ${t('prompts:init.nextStep3', { port: config.monitoring.port })}:`);
      console.log(chalk.cyan(`   http://localhost:${config.monitoring.port}`));
      console.log();
    }
  }

  async initFromTemplate(projectDir, options) {
    console.log(chalk.cyan(`📋 Initializing from template: ${options.template}`));
    console.log();

    try {
      // テンプレートの検証
      const template = await this.templateManager.findTemplate(options.template);
      if (!template) {
        console.log(chalk.red(`Template '${options.template}' not found`));
        console.log();
        console.log('Available templates:');
        const templates = await this.templateManager.listTemplates();
        templates.forEach(t => {
          console.log(`  - ${chalk.cyan(t.name)} (${t.type}): ${t.description}`);
        });
        return;
      }

      // プロジェクト情報の収集
      const projectInfo = await this.getProjectInfo(projectDir);
      
      // 対話的な変数収集
      const variables = await this.collectTemplateVariables(options, projectInfo, template);

      // テンプレートからの初期化
      const result = await this.templateManager.initializeFromTemplate(
        projectDir,
        options.template,
        variables
      );

      if (result.success) {
        console.log();
        console.log(chalk.green(`✨ Project initialized from template '${options.template}'`));
        console.log();

        // グローバルコンポーネントの初期化
        await this.initializeGlobalComponents();

        // プロジェクトの登録
        const configPath = path.join(projectDir, this.configDir, this.configFile);
        if (await this.fileExists(configPath)) {
          const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
          await this.registerProject(projectDir, config, options);
        }

        // 完了メッセージ
        this.showTemplateCompletionMessage(template);
      }
    } catch (error) {
      console.log(chalk.red(`Failed to initialize from template: ${error.message}`));
      console.error(error);
    }
  }

  async collectTemplateVariables(options, projectInfo, template) {
    const variables = {
      PROJECT_NAME: projectInfo.name,
      GITHUB_OWNER: projectInfo.gitRemote?.owner || '',
      GITHUB_REPO: projectInfo.gitRemote?.repo || '',
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || '',
      CLAUDE_API_KEY: process.env.CLAUDE_API_KEY || '',
      DASHBOARD_PASSWORD: '',
      DISCORD_WEBHOOK_URL: '',
      TELEGRAM_TOKEN: '',
      PUSHOVER_USER_KEY: '',
      PUSHOVER_APP_TOKEN: ''
    };

    // 非対話モードの場合は環境変数から取得
    if (options.interactive === false) {
      return variables;
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const question = (query) => new Promise((resolve) => rl.question(query, resolve));

    console.log(chalk.cyan('Template variables configuration:'));
    console.log();

    // プロジェクト名
    variables.PROJECT_NAME = await question(
      `Project name (${projectInfo.name}): `
    ) || projectInfo.name;

    // GitHub情報
    if (!variables.GITHUB_OWNER || !variables.GITHUB_REPO) {
      if (projectInfo.gitRemote) {
        const useDetected = await question(
          `Use detected GitHub repo ${projectInfo.gitRemote.owner}/${projectInfo.gitRemote.repo}? (Y/n): `
        );
        if (useDetected.toLowerCase() !== 'n') {
          variables.GITHUB_OWNER = projectInfo.gitRemote.owner;
          variables.GITHUB_REPO = projectInfo.gitRemote.repo;
        }
      }

      if (!variables.GITHUB_OWNER) {
        variables.GITHUB_OWNER = await question('GitHub owner/organization: ');
        variables.GITHUB_REPO = await question('GitHub repository name: ');
      }
    }

    // トークン設定（環境変数がない場合のみ）
    if (!variables.GITHUB_TOKEN) {
      const hasToken = await question('Do you have a GitHub token? (y/N): ');
      if (hasToken.toLowerCase() === 'y') {
        variables.GITHUB_TOKEN = await question('GitHub token: ');
      }
    }

    if (!variables.CLAUDE_API_KEY) {
      const hasKey = await question('Do you have a Claude API key? (y/N): ');
      if (hasKey.toLowerCase() === 'y') {
        variables.CLAUDE_API_KEY = await question('Claude API key: ');
      }
    }

    // 高度なテンプレートの場合は追加設定
    if (template.name === 'advanced') {
      const setupDashboard = await question('Setup dashboard authentication? (y/N): ');
      if (setupDashboard.toLowerCase() === 'y') {
        variables.DASHBOARD_PASSWORD = await question('Dashboard password: ') || 'changeme';
      }

      const setupNotifications = await question('Setup notification providers? (y/N): ');
      if (setupNotifications.toLowerCase() === 'y') {
        // Discord
        const useDiscord = await question('Use Discord notifications? (y/N): ');
        if (useDiscord.toLowerCase() === 'y') {
          variables.DISCORD_WEBHOOK_URL = await question('Discord webhook URL: ');
        }
      }
    }

    rl.close();
    return variables;
  }

  showTemplateCompletionMessage(template) {
    console.log(i18n.t('commands.init.nextSteps'));
    console.log();

    // テンプレート固有の手順
    if (template.name === 'advanced') {
      console.log('1. Start Redis (required for advanced features):');
      console.log(chalk.cyan('   docker-compose up -d'));
      console.log();
    }

    console.log('2. Install dependencies:');
    console.log(chalk.cyan('   npm install'));
    console.log();

    console.log('3. Set environment variables (if not already set):');
    console.log(chalk.cyan('   export GITHUB_TOKEN=your_github_token'));
    console.log(chalk.cyan('   export CLAUDE_API_KEY=your_claude_api_key'));
    console.log();

    console.log('4. Start PoppoBuilder:');
    if (template.name === 'advanced') {
      console.log(chalk.cyan('   npm run start:agents'));
    } else {
      console.log(chalk.cyan('   npm start'));
    }
    console.log();

    console.log('For more information:');
    console.log(chalk.cyan('   poppobuilder --help'));
  }
}

module.exports = InitCommand;