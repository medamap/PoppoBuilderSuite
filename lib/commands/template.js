'use strict';

const { Command } = require('commander');
const chalk = require('chalk');
const readline = require('readline');
const TemplateManager = require('../templates/template-manager');
const Logger = require('../../src/logger');
const i18n = require('../i18n');

class TemplateCommand {
  constructor() {
    this.logger = new Logger('TemplateCommand');
    this.templateManager = new TemplateManager();
  }

  /**
   * コマンドの登録
   */
  register(program) {
    const templateCmd = new Command('template')
      .description(i18n.t('cli.template.description', 'Manage project templates'));

    // テンプレート一覧
    templateCmd
      .command('list')
      .alias('ls')
      .description(i18n.t('cli.template.list.description', 'List available templates'))
      .option('-j, --json', i18n.t('cli.template.list.jsonOption', 'Output in JSON format'))
      .action(async (options) => {
        try {
          await this.listTemplates(options);
        } catch (error) {
          this.logger.error('Failed to list templates', error);
          console.error(chalk.red(i18n.t('errors.template.listFailed', 'Failed to list templates: {{error}}', { error: error.message })));
          process.exit(1);
        }
      });

    // カスタムテンプレート作成
    templateCmd
      .command('create <name>')
      .description(i18n.t('cli.template.create.description', 'Create a custom template'))
      .option('-f, --from <project>', i18n.t('cli.template.create.fromOption', 'Create template from existing project'))
      .option('-i, --interactive', i18n.t('cli.template.create.interactiveOption', 'Interactive mode'))
      .action(async (name, options) => {
        try {
          await this.createTemplate(name, options);
        } catch (error) {
          this.logger.error('Failed to create template', error);
          console.error(chalk.red(i18n.t('errors.template.createFailed', 'Failed to create template: {{error}}', { error: error.message })));
          process.exit(1);
        }
      });

    // テンプレート削除
    templateCmd
      .command('delete <name>')
      .alias('rm')
      .description(i18n.t('cli.template.delete.description', 'Delete a custom template'))
      .option('-f, --force', i18n.t('cli.template.delete.forceOption', 'Skip confirmation'))
      .action(async (name, options) => {
        try {
          await this.deleteTemplate(name, options);
        } catch (error) {
          this.logger.error('Failed to delete template', error);
          console.error(chalk.red(i18n.t('errors.template.deleteFailed', 'Failed to delete template: {{error}}', { error: error.message })));
          process.exit(1);
        }
      });

    // テンプレート詳細表示
    templateCmd
      .command('info <name>')
      .description(i18n.t('cli.template.info.description', 'Show template details'))
      .action(async (name) => {
        try {
          await this.showTemplateInfo(name);
        } catch (error) {
          this.logger.error('Failed to show template info', error);
          console.error(chalk.red(i18n.t('errors.template.infoFailed', 'Failed to show template info: {{error}}', { error: error.message })));
          process.exit(1);
        }
      });

    program.addCommand(templateCmd);
  }

  /**
   * テンプレート一覧表示
   */
  async listTemplates(options) {
    await this.templateManager.initialize();
    const templates = await this.templateManager.listTemplates();

    if (options.json) {
      console.log(JSON.stringify(templates, null, 2));
      return;
    }

    if (templates.length === 0) {
      console.log(chalk.yellow(i18n.t('cli.template.list.noTemplates', 'No templates found')));
      return;
    }

    // 簡易テーブル表示
    const headers = [
      i18n.t('cli.template.list.name', 'Name'),
      i18n.t('cli.template.list.type', 'Type'),
      i18n.t('cli.template.list.description', 'Description'),
      i18n.t('cli.template.list.tags', 'Tags')
    ];
    
    console.log(chalk.cyan(headers.join(' | ')));
    console.log(chalk.gray('-'.repeat(headers.join(' | ').length)));
    
    templates.forEach(template => {
      const row = [
        chalk.bold(template.name),
        template.type === 'system' ? chalk.blue('System') : chalk.green('User'),
        (template.description || '').substring(0, 40) + (template.description && template.description.length > 40 ? '...' : ''),
        (template.tags || []).join(', ')
      ];
      console.log(row.join(' | '));
    });
    console.log();
    console.log(chalk.gray(i18n.t('cli.template.list.total', 'Total: {{count}} templates', { count: templates.length })));
  }

  /**
   * カスタムテンプレート作成
   */
  async createTemplate(name, options) {
    await this.templateManager.initialize();

    // 既存チェック
    const existing = await this.templateManager.findTemplate(name);
    if (existing) {
      throw new Error(i18n.t('errors.template.alreadyExists', 'Template "{{name}}" already exists', { name }));
    }

    let templateOptions = {
      name,
      fromProject: options.from
    };

    if (options.interactive) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const question = (query) => new Promise((resolve) => rl.question(query, resolve));

      const description = await question(i18n.t('cli.template.create.descriptionPrompt', 'Template description: ')) || `Custom template ${name}`;
      const tagsInput = await question(i18n.t('cli.template.create.tagsPrompt', 'Tags (comma separated): '));
      const tags = tagsInput ? tagsInput.split(',').map(tag => tag.trim()).filter(tag => tag) : [];

      if (!options.from) {
        const fromProject = await question(i18n.t('cli.template.create.fromProjectPrompt', 'Create from existing project? (y/N): '));

        if (fromProject.toLowerCase() === 'y') {
          const projectPath = await question(i18n.t('cli.template.create.projectPathPrompt', 'Project path: ')) || process.cwd();
          templateOptions.fromProject = projectPath;
        }
      }

      templateOptions = { ...templateOptions, description, tags };
      rl.close();
    }

    console.log(chalk.cyan(i18n.t('cli.template.create.creating', 'Creating template "{{name}}"...', { name })));

    const result = await this.templateManager.createCustomTemplate(
      name,
      templateOptions.fromProject
    );

    console.log(chalk.green(i18n.t('cli.template.create.success', 'Template "{{name}}" created successfully!', { name })));
    console.log(chalk.gray(i18n.t('cli.template.create.location', 'Location: {{path}}', { path: result.path })));

    if (templateOptions.description || templateOptions.tags) {
      // メタデータを更新
      const fs = require('fs').promises;
      const path = require('path');
      const metadataPath = path.join(result.path, 'template.json');
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));

      if (templateOptions.description) {
        metadata.description = templateOptions.description;
      }
      if (templateOptions.tags) {
        metadata.tags = [...(metadata.tags || []), ...templateOptions.tags];
      }

      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
    }
  }

  /**
   * テンプレート削除
   */
  async deleteTemplate(name, options) {
    await this.templateManager.initialize();

    const template = await this.templateManager.findTemplate(name);
    if (!template) {
      throw new Error(i18n.t('errors.template.notFound', 'Template "{{name}}" not found', { name }));
    }

    if (template.type === 'system') {
      throw new Error(i18n.t('errors.template.cannotDeleteSystem', 'Cannot delete system template'));
    }

    if (!options.force) {
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const question = (query) => new Promise((resolve) => rl.question(query, resolve));
      
      const confirm = await question(i18n.t('cli.template.delete.confirmPrompt', 'Are you sure you want to delete template "{{name}}"? (y/N): ', { name }));
      rl.close();

      if (confirm.toLowerCase() !== 'y') {
        console.log(chalk.yellow(i18n.t('cli.template.delete.cancelled', 'Deletion cancelled')));
        return;
      }
    }

    console.log(chalk.cyan(i18n.t('cli.template.delete.deleting', 'Deleting template "{{name}}"...', { name })));

    await this.templateManager.deleteTemplate(name);

    console.log(chalk.green(i18n.t('cli.template.delete.success', 'Template "{{name}}" deleted successfully!', { name })));
  }

  /**
   * テンプレート詳細表示
   */
  async showTemplateInfo(name) {
    await this.templateManager.initialize();

    const template = await this.templateManager.findTemplate(name);
    if (!template) {
      throw new Error(i18n.t('errors.template.notFound', 'Template "{{name}}" not found', { name }));
    }

    console.log();
    console.log(chalk.bold.cyan(i18n.t('cli.template.info.title', 'Template Information')));
    console.log(chalk.gray('─'.repeat(50)));
    console.log(`${chalk.bold(i18n.t('cli.template.info.name', 'Name:'))} ${template.name}`);
    console.log(`${chalk.bold(i18n.t('cli.template.info.type', 'Type:'))} ${template.type === 'system' ? chalk.blue('System') : chalk.green('User')}`);
    console.log(`${chalk.bold(i18n.t('cli.template.info.description', 'Description:'))} ${template.description || 'N/A'}`);
    console.log(`${chalk.bold(i18n.t('cli.template.info.version', 'Version:'))} ${template.version || 'N/A'}`);
    console.log(`${chalk.bold(i18n.t('cli.template.info.author', 'Author:'))} ${template.author || 'N/A'}`);
    console.log(`${chalk.bold(i18n.t('cli.template.info.tags', 'Tags:'))} ${(template.tags || []).join(', ') || 'N/A'}`);
    console.log(`${chalk.bold(i18n.t('cli.template.info.path', 'Path:'))} ${template.path}`);

    if (template.createdAt) {
      console.log(`${chalk.bold(i18n.t('cli.template.info.created', 'Created:'))} ${new Date(template.createdAt).toLocaleString()}`);
    }

    // テンプレート内容の概要
    const fs = require('fs').promises;
    const path = require('path');

    console.log();
    console.log(chalk.bold.cyan(i18n.t('cli.template.info.contents', 'Template Contents')));
    console.log(chalk.gray('─'.repeat(50)));

    try {
      const entries = await fs.readdir(template.path);
      const tree = await this._buildFileTree(template.path, entries, '', 0, 3);
      console.log(tree);
    } catch (error) {
      console.log(chalk.red(i18n.t('errors.template.cannotReadContents', 'Cannot read template contents')));
    }
  }

  /**
   * ファイルツリーの構築
   */
  async _buildFileTree(basePath, entries, prefix, depth, maxDepth) {
    if (depth >= maxDepth) {
      return '';
    }

    const fs = require('fs').promises;
    const path = require('path');
    let tree = '';

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLast = i === entries.length - 1;
      const entryPath = path.join(basePath, entry);
      const stat = await fs.stat(entryPath);

      const connector = isLast ? '└── ' : '├── ';
      const extension = isLast ? '    ' : '│   ';

      tree += prefix + connector + entry;

      if (stat.isDirectory()) {
        tree += '/\n';
        try {
          const subEntries = await fs.readdir(entryPath);
          tree += await this._buildFileTree(entryPath, subEntries, prefix + extension, depth + 1, maxDepth);
        } catch (error) {
          // アクセスできないディレクトリは無視
        }
      } else {
        tree += '\n';
      }
    }

    return tree;
  }
}

module.exports = TemplateCommand;