'use strict';

const fs = require('fs').promises;
const path = require('path');
const Logger = require('../../src/logger');

/**
 * テンプレート管理クラス
 * プロジェクトテンプレートの管理、作成、適用を行う
 */
class TemplateManager {
  constructor() {
    this.logger = new Logger('TemplateManager');
    this.templatesDir = path.join(__dirname, 'definitions');
    this.userTemplatesDir = path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'templates');
  }

  /**
   * 初期化処理
   */
  async initialize() {
    try {
      // システムテンプレートディレクトリの確認
      await fs.mkdir(this.templatesDir, { recursive: true });
      
      // ユーザーテンプレートディレクトリの作成
      await fs.mkdir(this.userTemplatesDir, { recursive: true });
      
      // デフォルトテンプレートの作成
      await this._createDefaultTemplates();
      
      this.logger.info('TemplateManager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize TemplateManager', error);
      throw error;
    }
  }

  /**
   * デフォルトテンプレートの作成
   */
  async _createDefaultTemplates() {
    const templates = ['default', 'minimal', 'advanced'];
    
    for (const templateName of templates) {
      const templatePath = path.join(this.templatesDir, templateName);
      if (!await this._pathExists(templatePath)) {
        await this._createTemplate(templateName);
      }
    }
  }

  /**
   * テンプレートの作成
   */
  async _createTemplate(name) {
    const templatePath = path.join(this.templatesDir, name);
    await fs.mkdir(templatePath, { recursive: true });

    switch (name) {
      case 'default':
        await this._createDefaultTemplate(templatePath);
        break;
      case 'minimal':
        await this._createMinimalTemplate(templatePath);
        break;
      case 'advanced':
        await this._createAdvancedTemplate(templatePath);
        break;
    }
  }

  /**
   * デフォルトテンプレートの作成
   */
  async _createDefaultTemplate(templatePath) {
    // template.json - テンプレートメタデータ
    const metadata = {
      name: 'default',
      description: 'PoppoBuilder標準テンプレート',
      version: '1.0.0',
      author: 'PoppoBuilder Team',
      tags: ['standard', 'recommended']
    };
    await fs.writeFile(path.join(templatePath, 'template.json'), JSON.stringify(metadata, null, 2));

    // config/config.json
    const config = {
      github: {
        owner: '{{GITHUB_OWNER}}',
        repo: '{{GITHUB_REPO}}',
        token: '{{GITHUB_TOKEN}}'
      },
      claude: {
        apiKey: '{{CLAUDE_API_KEY}}',
        model: 'claude-3-opus-20240229',
        timeout: 300000,
        maxRetries: 3,
        maxConcurrent: 3
      },
      language: {
        primary: 'ja',
        fallback: 'en'
      },
      dashboard: {
        enabled: true,
        port: 3001
      },
      notification: {
        enabled: false,
        providers: []
      }
    };
    await fs.mkdir(path.join(templatePath, 'config'), { recursive: true });
    await fs.writeFile(path.join(templatePath, 'config', 'config.json'), JSON.stringify(config, null, 2));

    // .poppo/config.json
    const poppoConfig = {
      language: 'ja',
      features: {
        dogfooding: true,
        autoRepair: true,
        errorCollection: true
      }
    };
    await fs.mkdir(path.join(templatePath, '.poppo'), { recursive: true });
    await fs.writeFile(path.join(templatePath, '.poppo', 'config.json'), JSON.stringify(poppoConfig, null, 2));

    // .gitignore
    const gitignore = `node_modules/
logs/
*.log
.env
.env.local
state/
data/
temp/
messages/
.poppo/locks/
config/config-auth.json
`;
    await fs.writeFile(path.join(templatePath, '.gitignore'), gitignore);

    // README.md
    const readme = `# {{PROJECT_NAME}}

PoppoBuilderで管理されるプロジェクトです。

## セットアップ

1. 依存関係のインストール:
   \`\`\`bash
   npm install
   \`\`\`

2. 設定ファイルの編集:
   - \`config/config.json\` を環境に合わせて編集

3. PoppoBuilderの起動:
   \`\`\`bash
   npm start
   \`\`\`

## 設定

詳細な設定については [PoppoBuilder Documentation](https://github.com/medamap/PoppoBuilderSuite) を参照してください。
`;
    await fs.writeFile(path.join(templatePath, 'README.md'), readme);
  }

  /**
   * ミニマルテンプレートの作成
   */
  async _createMinimalTemplate(templatePath) {
    // template.json
    const metadata = {
      name: 'minimal',
      description: '最小構成のPoppoBuilderテンプレート',
      version: '1.0.0',
      author: 'PoppoBuilder Team',
      tags: ['minimal', 'lightweight']
    };
    await fs.writeFile(path.join(templatePath, 'template.json'), JSON.stringify(metadata, null, 2));

    // config/config.json - 最小限の設定
    const config = {
      github: {
        owner: '{{GITHUB_OWNER}}',
        repo: '{{GITHUB_REPO}}',
        token: '{{GITHUB_TOKEN}}'
      },
      claude: {
        apiKey: '{{CLAUDE_API_KEY}}',
        model: 'claude-3-opus-20240229'
      },
      language: {
        primary: 'ja'
      }
    };
    await fs.mkdir(path.join(templatePath, 'config'), { recursive: true });
    await fs.writeFile(path.join(templatePath, 'config', 'config.json'), JSON.stringify(config, null, 2));

    // .gitignore
    const gitignore = `node_modules/
logs/
*.log
.env
state/
`;
    await fs.writeFile(path.join(templatePath, '.gitignore'), gitignore);
  }

  /**
   * 高度なテンプレートの作成
   */
  async _createAdvancedTemplate(templatePath) {
    // template.json
    const metadata = {
      name: 'advanced',
      description: '高度な機能を含むPoppoBuilderテンプレート',
      version: '1.0.0',
      author: 'PoppoBuilder Team',
      tags: ['advanced', 'full-featured', 'enterprise']
    };
    await fs.writeFile(path.join(templatePath, 'template.json'), JSON.stringify(metadata, null, 2));

    // config/config.json - フル機能設定
    const config = {
      github: {
        owner: '{{GITHUB_OWNER}}',
        repo: '{{GITHUB_REPO}}',
        token: '{{GITHUB_TOKEN}}'
      },
      claude: {
        apiKey: '{{CLAUDE_API_KEY}}',
        model: 'claude-3-opus-20240229',
        timeout: 300000,
        maxRetries: 3,
        maxConcurrent: 5
      },
      language: {
        primary: 'ja',
        fallback: 'en'
      },
      dashboard: {
        enabled: true,
        port: 3001,
        auth: {
          enabled: true,
          username: 'admin',
          password: '{{DASHBOARD_PASSWORD}}'
        }
      },
      notification: {
        enabled: true,
        providers: [
          {
            type: 'discord',
            enabled: false,
            webhookUrl: '{{DISCORD_WEBHOOK_URL}}'
          }
        ]
      },
      agents: {
        ccla: { enabled: true },
        ccag: { enabled: true },
        ccpm: { enabled: true },
        ccqa: { enabled: true },
        ccra: { enabled: true },
        ccta: { enabled: true },
        ccsp: { enabled: true }
      },
      multiProject: {
        enabled: true,
        schedulingAlgorithm: 'weighted-fair'
      },
      backup: {
        enabled: true,
        schedule: '0 2 * * *',
        retention: 30
      },
      healthCheck: {
        enabled: true,
        interval: 60000
      }
    };
    await fs.mkdir(path.join(templatePath, 'config'), { recursive: true });
    await fs.writeFile(path.join(templatePath, 'config', 'config.json'), JSON.stringify(config, null, 2));

    // .poppo/config.json
    const poppoConfig = {
      language: 'ja',
      features: {
        dogfooding: true,
        autoRepair: true,
        errorCollection: true,
        traceability: true,
        dynamicTimeout: true
      }
    };
    await fs.mkdir(path.join(templatePath, '.poppo'), { recursive: true });
    await fs.writeFile(path.join(templatePath, '.poppo', 'config.json'), JSON.stringify(poppoConfig, null, 2));

    // docker-compose.yml
    const dockerCompose = `version: '3.8'

services:
  redis:
    image: redis:alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data

  redis-commander:
    image: rediscommander/redis-commander:latest
    restart: unless-stopped
    environment:
      - REDIS_HOSTS=local:redis:6379
    ports:
      - "8081:8081"
    depends_on:
      - redis

volumes:
  redis-data:
`;
    await fs.writeFile(path.join(templatePath, 'docker-compose.yml'), dockerCompose);

    // .gitignore
    const gitignore = `node_modules/
logs/
*.log
.env
.env.local
state/
data/
temp/
messages/
.poppo/locks/
config/config-auth.json
backups/
*.sqlite
dump.rdb
`;
    await fs.writeFile(path.join(templatePath, '.gitignore'), gitignore);

    // README.md
    const readme = `# {{PROJECT_NAME}}

高度な機能を備えたPoppoBuilderプロジェクトです。

## 機能

- 複数エージェントによる自動処理
- マルチプロジェクト対応
- 自動バックアップ
- ヘルスチェック
- 通知機能
- Redis統合

## セットアップ

1. Redisの起動:
   \`\`\`bash
   docker-compose up -d
   \`\`\`

2. 依存関係のインストール:
   \`\`\`bash
   npm install
   \`\`\`

3. 設定ファイルの編集:
   - \`config/config.json\` を環境に合わせて編集
   - 環境変数の設定

4. PoppoBuilderの起動:
   \`\`\`bash
   npm start:agents
   \`\`\`

## 管理

- ダッシュボード: http://localhost:3001
- Redis Commander: http://localhost:8081

詳細は [PoppoBuilder Documentation](https://github.com/medamap/PoppoBuilderSuite) を参照してください。
`;
    await fs.writeFile(path.join(templatePath, 'README.md'), readme);
  }

  /**
   * 利用可能なテンプレートの一覧を取得
   */
  async listTemplates() {
    try {
      const templates = [];
      
      // システムテンプレート
      const systemTemplates = await this._getTemplatesFromDir(this.templatesDir, 'system');
      templates.push(...systemTemplates);
      
      // ユーザーテンプレート
      const userTemplates = await this._getTemplatesFromDir(this.userTemplatesDir, 'user');
      templates.push(...userTemplates);
      
      return templates;
    } catch (error) {
      this.logger.error('Failed to list templates', error);
      throw error;
    }
  }

  /**
   * 指定ディレクトリからテンプレート情報を取得
   */
  async _getTemplatesFromDir(dir, type) {
    const templates = [];
    
    if (!await this._pathExists(dir)) {
      return templates;
    }
    
    const entries = await fs.readdir(dir);
    
    for (const entry of entries) {
      const templatePath = path.join(dir, entry);
      const stat = await fs.stat(templatePath);
      
      if (stat.isDirectory()) {
        const metadataPath = path.join(templatePath, 'template.json');
        
        if (await this._pathExists(metadataPath)) {
          try {
            const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
            templates.push({
              ...metadata,
              type,
              path: templatePath
            });
          } catch (error) {
            this.logger.warn(`Invalid template metadata in ${entry}`, error);
          }
        }
      }
    }
    
    return templates;
  }

  /**
   * テンプレートからプロジェクトを初期化
   */
  async initializeFromTemplate(projectPath, templateName, variables = {}) {
    try {
      // テンプレートの検索
      const template = await this.findTemplate(templateName);
      if (!template) {
        throw new Error(`Template '${templateName}' not found`);
      }
      
      this.logger.info(`Initializing project from template: ${templateName}`);
      
      // プロジェクトディレクトリの作成
      await fs.mkdir(projectPath, { recursive: true });
      
      // テンプレートファイルのコピー
      await this._copyTemplateFiles(template.path, projectPath, variables);
      
      // package.jsonの作成（存在しない場合）
      await this._createPackageJson(projectPath, variables);
      
      this.logger.info(`Project initialized successfully at: ${projectPath}`);
      
      return {
        success: true,
        projectPath,
        template: template.name
      };
    } catch (error) {
      this.logger.error('Failed to initialize from template', error);
      throw error;
    }
  }

  /**
   * テンプレートを検索
   */
  async findTemplate(name) {
    const templates = await this.listTemplates();
    return templates.find(t => t.name === name);
  }

  /**
   * テンプレートファイルをコピーして変数を置換
   */
  async _copyTemplateFiles(templatePath, projectPath, variables) {
    const entries = await fs.readdir(templatePath);
    
    for (const entry of entries) {
      if (entry === 'template.json') continue;
      
      const sourcePath = path.join(templatePath, entry);
      const destPath = path.join(projectPath, entry);
      const stat = await fs.stat(sourcePath);
      
      if (stat.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this._copyTemplateFiles(sourcePath, destPath, variables);
      } else {
        // ファイルの内容を読み込んで変数を置換
        let content = await fs.readFile(sourcePath, 'utf8');
        content = this._replaceVariables(content, variables);
        await fs.writeFile(destPath, content);
      }
    }
  }

  /**
   * 変数の置換
   */
  _replaceVariables(content, variables) {
    return content.replace(/\{\{(\w+)\}\}/g, (match, varName) => {
      return variables[varName] || match;
    });
  }

  /**
   * package.jsonの作成
   */
  async _createPackageJson(projectPath, variables) {
    const packageJsonPath = path.join(projectPath, 'package.json');
    
    if (await this._pathExists(packageJsonPath)) {
      return;
    }
    
    const packageJson = {
      name: variables.PROJECT_NAME || 'poppobuilder-project',
      version: '1.0.0',
      description: 'PoppoBuilder managed project',
      scripts: {
        start: 'poppobuilder start',
        'start:agents': 'poppobuilder start --agents',
        dashboard: 'poppobuilder dashboard',
        status: 'poppobuilder status',
        logs: 'poppobuilder logs'
      },
      dependencies: {
        'poppobuilder': '^1.0.0'
      }
    };
    
    await fs.writeFile(packageJsonPath, JSON.stringify(packageJson, null, 2));
  }

  /**
   * カスタムテンプレートの作成
   */
  async createCustomTemplate(name, fromProject = null) {
    try {
      const templatePath = path.join(this.userTemplatesDir, name);
      
      if (await this._pathExists(templatePath)) {
        throw new Error(`Template '${name}' already exists`);
      }
      
      await fs.mkdir(templatePath, { recursive: true });
      
      if (fromProject) {
        // 既存プロジェクトからテンプレートを作成
        await this._createTemplateFromProject(fromProject, templatePath, name);
      } else {
        // 空のカスタムテンプレートを作成
        await this._createEmptyCustomTemplate(templatePath, name);
      }
      
      this.logger.info(`Custom template '${name}' created successfully`);
      
      return {
        success: true,
        name,
        path: templatePath
      };
    } catch (error) {
      this.logger.error('Failed to create custom template', error);
      throw error;
    }
  }

  /**
   * プロジェクトからテンプレートを作成
   */
  async _createTemplateFromProject(projectPath, templatePath, name) {
    // 除外するファイル/ディレクトリ
    const excludes = [
      'node_modules',
      'logs',
      'state',
      'data',
      'temp',
      'messages',
      '.git',
      '.poppo/locks',
      'package-lock.json',
      'dump.rdb',
      '*.log'
    ];
    
    // プロジェクトファイルをコピー
    await this._copyProjectFiles(projectPath, templatePath, excludes);
    
    // template.jsonの作成
    const metadata = {
      name,
      description: `Custom template created from ${path.basename(projectPath)}`,
      version: '1.0.0',
      author: process.env.USER || 'Unknown',
      tags: ['custom'],
      createdAt: new Date().toISOString()
    };
    
    await fs.writeFile(path.join(templatePath, 'template.json'), JSON.stringify(metadata, null, 2));
    
    // 設定ファイルの変数化
    await this._variablizeConfigFiles(templatePath);
  }

  /**
   * プロジェクトファイルをコピー（除外対象を考慮）
   */
  async _copyProjectFiles(sourcePath, destPath, excludes) {
    const entries = await fs.readdir(sourcePath);
    
    for (const entry of entries) {
      // 除外対象をチェック
      if (excludes.some(pattern => {
        if (pattern.includes('*')) {
          const regex = new RegExp(pattern.replace('*', '.*'));
          return regex.test(entry);
        }
        return entry === pattern;
      })) {
        continue;
      }
      
      const sourceFile = path.join(sourcePath, entry);
      const destFile = path.join(destPath, entry);
      const stat = await fs.stat(sourceFile);
      
      if (stat.isDirectory()) {
        await fs.mkdir(destFile, { recursive: true });
        await this._copyProjectFiles(sourceFile, destFile, excludes);
      } else {
        await fs.copyFile(sourceFile, destFile);
      }
    }
  }

  /**
   * 設定ファイルの変数化
   */
  async _variablizeConfigFiles(templatePath) {
    const configPath = path.join(templatePath, 'config', 'config.json');
    
    if (await this._pathExists(configPath)) {
      let config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      
      // センシティブな情報を変数に置換
      if (config.github) {
        if (config.github.owner) config.github.owner = '{{GITHUB_OWNER}}';
        if (config.github.repo) config.github.repo = '{{GITHUB_REPO}}';
        if (config.github.token) config.github.token = '{{GITHUB_TOKEN}}';
      }
      
      if (config.claude) {
        if (config.claude.apiKey) config.claude.apiKey = '{{CLAUDE_API_KEY}}';
      }
      
      if (config.dashboard?.auth?.password) {
        config.dashboard.auth.password = '{{DASHBOARD_PASSWORD}}';
      }
      
      if (config.notification?.providers) {
        config.notification.providers.forEach(provider => {
          if (provider.webhookUrl) provider.webhookUrl = '{{' + provider.type.toUpperCase() + '_WEBHOOK_URL}}';
          if (provider.token) provider.token = '{{' + provider.type.toUpperCase() + '_TOKEN}}';
        });
      }
      
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    }
  }

  /**
   * 空のカスタムテンプレートを作成
   */
  async _createEmptyCustomTemplate(templatePath, name) {
    const metadata = {
      name,
      description: 'Custom template',
      version: '1.0.0',
      author: process.env.USER || 'Unknown',
      tags: ['custom'],
      createdAt: new Date().toISOString()
    };
    
    await fs.writeFile(path.join(templatePath, 'template.json'), JSON.stringify(metadata, null, 2));
    
    // 基本的な構造を作成
    await fs.mkdir(path.join(templatePath, 'config'), { recursive: true });
    await fs.mkdir(path.join(templatePath, '.poppo'), { recursive: true });
    
    // READMEを作成
    const readme = `# ${name}

カスタムテンプレートです。

必要なファイルを追加してテンプレートをカスタマイズしてください。
`;
    
    await fs.writeFile(path.join(templatePath, 'README.md'), readme);
  }

  /**
   * テンプレートの削除
   */
  async deleteTemplate(name) {
    try {
      // ユーザーテンプレートのみ削除可能
      const templatePath = path.join(this.userTemplatesDir, name);
      
      if (!await this._pathExists(templatePath)) {
        throw new Error(`Template '${name}' not found or is a system template`);
      }
      
      await fs.rm(templatePath, { recursive: true, force: true });
      
      this.logger.info(`Template '${name}' deleted successfully`);
      
      return {
        success: true,
        name
      };
    } catch (error) {
      this.logger.error('Failed to delete template', error);
      throw error;
    }
  }

  /**
   * ファイル/ディレクトリの存在確認
   */
  async _pathExists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = TemplateManager;