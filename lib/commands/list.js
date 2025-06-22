/**
 * PoppoBuilder List Command
 * 登録されたプロジェクトの一覧表示
 */

const colors = require('colors');
const { getInstance: getProjectRegistry } = require('../core/project-registry');
const { getInstance: getDaemonManager } = require('../daemon/daemon-manager');
const { t } = require('../i18n');
const tableFormatter = require('../utils/table-formatter');
const path = require('path');
const fs = require('fs').promises;

class ListCommand {
  constructor() {
    this.maxProjectNameLength = 20;
    this.maxPathLength = 50;
  }

  async execute(options) {
    try {
      console.log(colors.bold(`📋 ${t('commands:list.title')}`));
      console.log();

      // プロジェクトレジストリの初期化と取得
      const projectRegistry = getProjectRegistry();
      await projectRegistry.initialize();

      // プロジェクト一覧取得
      const allProjects = projectRegistry.getAllProjects();
      const projectIds = Object.keys(allProjects);

      if (projectIds.length === 0) {
        console.log(colors.yellow(t('commands:list.noProjects')));
        console.log();
        console.log(t('commands:list.howToRegister'));
        console.log(colors.cyan(`  poppobuilder init              # ${t('commands:list.initHint')}`));
        console.log(colors.cyan(`  poppobuilder project register  # ${t('commands:list.registerHint')}`));
        return;
      }

      // フィルタリング
      let filteredProjects = allProjects;
      if (options.enabled) {
        filteredProjects = projectRegistry.getEnabledProjects();
      }
      if (options.disabled) {
        filteredProjects = {};
        for (const [id, project] of Object.entries(allProjects)) {
          if (!project.enabled) {
            filteredProjects[id] = project;
          }
        }
      }
      if (options.tag) {
        const tagFilter = options.tag.toLowerCase();
        filteredProjects = {};
        for (const [id, project] of Object.entries(allProjects)) {
          if (project.config.tags && project.config.tags.some(tag => 
            tag.toLowerCase().includes(tagFilter)
          )) {
            filteredProjects[id] = project;
          }
        }
      }

      const filteredIds = Object.keys(filteredProjects);
      
      if (filteredIds.length === 0) {
        console.log(colors.yellow(t('commands:list.noMatches')));
        return;
      }

      // ソート
      const sortedIds = this.sortProjects(filteredIds, filteredProjects, options.sort);

      // 出力形式の決定
      if (options.json) {
        await this.outputJson(sortedIds, filteredProjects, options);
      } else if (options.table) {
        await this.outputTable(sortedIds, filteredProjects, options);
      } else {
        await this.outputDefault(sortedIds, filteredProjects, options);
      }

      // サマリー表示
      if (!options.json && !options.quiet) {
        this.showSummary(allProjects, filteredProjects, options);
      }

    } catch (error) {
      console.error(colors.red('Error:'), error.message);
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  sortProjects(projectIds, projects, sortBy = 'name') {
    return projectIds.sort((a, b) => {
      const projectA = projects[a];
      const projectB = projects[b];

      switch (sortBy) {
        case 'name':
          return (projectA.config.name || a).localeCompare(projectB.config.name || b);
        case 'priority':
          return (projectB.config.priority || 50) - (projectA.config.priority || 50);
        case 'path':
          return projectA.path.localeCompare(projectB.path);
        case 'created':
          return new Date(projectB.createdAt) - new Date(projectA.createdAt);
        case 'updated':
          return new Date(projectB.updatedAt) - new Date(projectA.updatedAt);
        case 'activity':
          const lastActivityA = projectA.stats?.lastActivityAt ? new Date(projectA.stats.lastActivityAt) : new Date(0);
          const lastActivityB = projectB.stats?.lastActivityAt ? new Date(projectB.stats.lastActivityAt) : new Date(0);
          return lastActivityB - lastActivityA;
        default:
          return 0;
      }
    });
  }

  async outputDefault(projectIds, projects, options) {
    for (const id of projectIds) {
      const project = projects[id];
      await this.displayProject(id, project, options);
      console.log();
    }
  }

  async outputTable(projectIds, projects, options) {
    // Prepare data for table formatter
    const data = projectIds.map(id => {
      const project = projects[id];
      const row = {
        id,
        name: project.config.name || id,
        status: project.enabled ? t('table:status.enabled') : t('table:status.disabled'),
        priority: project.config.priority || 50,
        path: this.truncatePath(project.path, 40)
      };

      if (options.verbose) {
        const stats = project.stats || {};
        row.issues = stats.totalIssuesProcessed || 0;
        row.errors = stats.totalErrors || 0;
        row.lastActivity = stats.lastActivityAt ? 
          new Date(stats.lastActivityAt).toLocaleDateString() : 
          '-';
      }

      return row;
    });

    // Define columns
    const columns = [
      { key: 'id', labelKey: 'table:columns.id', maxWidth: 20 },
      { key: 'name', labelKey: 'table:columns.name', maxWidth: 25 },
      { 
        key: 'status', 
        labelKey: 'table:columns.status',
        formatter: (value) => {
          return value === t('table:status.enabled') ? 
            colors.green(value) : colors.red(value);
        }
      },
      { key: 'priority', labelKey: 'table:columns.priority', align: 'right' },
      { key: 'path', labelKey: 'table:columns.path', maxWidth: 40 }
    ];

    if (options.verbose) {
      columns.push(
        { key: 'issues', labelKey: 'table:columns.issues', align: 'right' },
        { key: 'errors', labelKey: 'table:columns.errors', align: 'right' },
        { key: 'lastActivity', labelKey: 'table:columns.lastActivity' }
      );
    }

    // Format and print table
    const table = tableFormatter.formatTable(data, {
      columns,
      compact: options.compact
    });

    console.log(table);
  }

  async outputJson(projectIds, projects, options) {
    const output = {};
    
    for (const id of projectIds) {
      const project = projects[id];
      const projectData = { ...project };
      
      if (options.verbose) {
        // 追加情報を含める
        projectData.runtime = await this.getProjectRuntimeInfo(project);
      }
      
      output[id] = projectData;
    }

    console.log(JSON.stringify(output, null, 2));
  }

  async displayProject(id, project, options) {
    // プロジェクト名とステータス
    const name = project.config.name || id;
    const status = project.enabled ? 
      colors.green('✓ enabled') : 
      colors.red('✗ disabled');
    
    const priority = project.config.priority || 50;
    const priorityColor = priority >= 80 ? colors.red : priority >= 60 ? colors.yellow : colors.gray;
    
    console.log(`${colors.cyan(name)} ${status} ${priorityColor(`[P${priority}]`)}`);
    console.log(colors.gray(`  ID: ${id}`));
    
    // パス表示
    const displayPath = this.truncatePath(project.path, this.maxPathLength);
    console.log(colors.gray(`  Path: ${displayPath}`));

    // GitHub情報
    if (project.config.github && project.config.github.owner && project.config.github.repo) {
      const githubUrl = `https://github.com/${project.config.github.owner}/${project.config.github.repo}`;
      console.log(colors.gray(`  GitHub: ${project.config.github.owner}/${project.config.github.repo}`));
    }

    // 説明
    if (project.config.description) {
      console.log(colors.gray(`  Description: ${project.config.description}`));
    }

    // タグ
    if (project.config.tags && project.config.tags.length > 0) {
      const tagDisplay = project.config.tags.map(tag => colors.blue(`#${tag}`)).join(' ');
      console.log(colors.gray(`  Tags: ${tagDisplay}`));
    }

    // 詳細情報
    if (options.verbose) {
      await this.displayVerboseInfo(project, options);
    }

    // 統計情報
    if (project.stats && (project.stats.totalIssuesProcessed > 0 || options.verbose)) {
      const stats = project.stats;
      console.log(colors.gray(`  Stats: ${stats.totalIssuesProcessed} issues processed, ${stats.totalErrors} errors`));
      
      if (stats.averageProcessingTime > 0) {
        console.log(colors.gray(`         Average processing time: ${Math.round(stats.averageProcessingTime)}ms`));
      }
      
      if (stats.lastActivityAt) {
        const lastActivity = new Date(stats.lastActivityAt);
        console.log(colors.gray(`         Last activity: ${lastActivity.toLocaleString()}`));
      }
    }

    // 実行時情報
    if (options.status) {
      await this.displayRuntimeStatus(project, options);
    }
  }

  async displayVerboseInfo(project, options) {
    // 作成・更新日時
    console.log(colors.gray(`  Created: ${new Date(project.createdAt).toLocaleString()}`));
    console.log(colors.gray(`  Updated: ${new Date(project.updatedAt).toLocaleString()}`));

    // リソース設定
    if (project.config.resources) {
      const res = project.config.resources;
      const resourceInfo = [];
      if (res.maxConcurrent) resourceInfo.push(`concurrent: ${res.maxConcurrent}`);
      if (res.cpuWeight) resourceInfo.push(`cpu: ${res.cpuWeight}x`);
      if (res.memoryLimit) resourceInfo.push(`memory: ${res.memoryLimit}`);
      
      if (resourceInfo.length > 0) {
        console.log(colors.gray(`  Resources: ${resourceInfo.join(', ')}`));
      }
    }

    // スケジュール設定
    if (project.config.schedule && project.config.schedule.checkInterval) {
      const intervalMinutes = Math.round(project.config.schedule.checkInterval / 60000);
      console.log(colors.gray(`  Check interval: ${intervalMinutes} minutes`));
    }
  }

  async displayRuntimeStatus(project, options) {
    try {
      // プロジェクトディレクトリの存在確認
      const pathExists = await this.checkPathExists(project.path);
      const pathStatus = pathExists ? 
        colors.green('✓ exists') : 
        colors.red('✗ not found');
      console.log(colors.gray(`  Path status: ${pathStatus}`));

      // 設定ファイルの確認
      const configPath = path.join(project.path, '.poppobuilder', 'config.json');
      const configExists = await this.checkPathExists(configPath);
      const configStatus = configExists ? 
        colors.green('✓ configured') : 
        colors.yellow('⚠ not initialized');
      console.log(colors.gray(`  Config: ${configStatus}`));

      // Git状態の確認
      if (project.config.github) {
        const gitStatus = await this.checkGitStatus(project.path);
        console.log(colors.gray(`  Git: ${gitStatus}`));
      }

    } catch (error) {
      console.log(colors.gray(`  Status: ${colors.red('error checking')}`));
    }
  }

  async getProjectRuntimeInfo(project) {
    const info = {
      pathExists: await this.checkPathExists(project.path),
      configExists: await this.checkPathExists(path.join(project.path, '.poppobuilder', 'config.json')),
      gitStatus: null
    };

    if (project.config.github) {
      info.gitStatus = await this.checkGitStatus(project.path);
    }

    return info;
  }

  async checkPathExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async checkGitStatus(projectPath) {
    try {
      const { execSync } = require('child_process');
      const status = execSync('git status --porcelain', { 
        cwd: projectPath,
        encoding: 'utf8',
        timeout: 5000
      });
      
      if (status.trim() === '') {
        return colors.green('✓ clean');
      } else {
        const lines = status.trim().split('\n').length;
        return colors.yellow(`⚠ ${lines} changes`);
      }
    } catch (error) {
      return colors.red('✗ error');
    }
  }

  buildTableRow(id, project, options) {
    const name = project.config.name || id;
    const status = project.enabled ? 'enabled' : 'disabled';
    const priority = project.config.priority || 50;
    const displayPath = this.truncatePath(project.path, 30);

    const row = [id, name, status, priority.toString(), displayPath];

    if (options.verbose) {
      const stats = project.stats || {};
      row.push(stats.totalIssuesProcessed?.toString() || '0');
      row.push(stats.totalErrors?.toString() || '0');
      
      const lastActivity = stats.lastActivityAt ? 
        new Date(stats.lastActivityAt).toLocaleDateString() : 
        'never';
      row.push(lastActivity);
    }

    return row;
  }

  calculateColumnWidths(projectIds, projects, headers, options) {
    const widths = headers.map(h => h.length);

    for (const id of projectIds) {
      const project = projects[id];
      const row = this.buildTableRow(id, project, options);
      
      for (let i = 0; i < row.length; i++) {
        widths[i] = Math.max(widths[i], row[i].length);
      }
    }

    // 最大幅制限
    return widths.map((w, i) => Math.min(w, i === 0 ? 20 : i === 4 ? 40 : 30));
  }

  printTableRow(columns, widths, isHeader = false) {
    const row = columns.map((col, i) => {
      const width = widths[i];
      const truncated = col.length > width ? col.substring(0, width - 3) + '...' : col;
      return truncated.padEnd(width);
    }).join(' | ');

    if (isHeader) {
      console.log(colors.bold(row));
    } else {
      console.log(row);
    }
  }

  printTableSeparator(widths) {
    const separator = widths.map(w => '-'.repeat(w)).join('-+-');
    console.log(separator);
  }

  truncatePath(filePath, maxLength) {
    if (filePath.length <= maxLength) {
      return filePath;
    }
    
    const parts = filePath.split(path.sep);
    if (parts.length <= 2) {
      return '...' + filePath.substring(filePath.length - maxLength + 3);
    }
    
    // 最初と最後の部分を保持
    let result = path.join(parts[0], '...', parts[parts.length - 1]);
    
    // まだ長すぎる場合はさらに短縮
    if (result.length > maxLength) {
      const lastName = parts[parts.length - 1];
      const availableLength = maxLength - 3 - lastName.length - 1; // "...", lastName, "/"
      if (availableLength > 0) {
        result = parts[0].substring(0, availableLength) + '/.../' + lastName;
      } else {
        result = '.../' + lastName;
      }
    }
    
    return result;
  }

  showSummary(allProjects, filteredProjects, options) {
    const totalCount = Object.keys(allProjects).length;
    const enabledCount = Object.values(allProjects).filter(p => p.enabled).length;
    const disabledCount = totalCount - enabledCount;
    const filteredCount = Object.keys(filteredProjects).length;

    console.log(colors.gray('─'.repeat(60)));
    
    if (filteredCount !== totalCount) {
      console.log(colors.gray(t('table:summary.showing', { shown: filteredCount, total: totalCount })));
    } else {
      console.log(colors.gray(t('table:summary.total', { count: totalCount })));
    }
    
    console.log(colors.gray(
      `${t('table:status.enabled')}: ${colors.green(enabledCount)}  ` +
      `${t('table:status.disabled')}: ${colors.red(disabledCount)}`
    ));

    // 統計サマリー
    const totalIssues = Object.values(allProjects)
      .reduce((sum, p) => sum + (p.stats?.totalIssuesProcessed || 0), 0);
    const totalErrors = Object.values(allProjects)
      .reduce((sum, p) => sum + (p.stats?.totalErrors || 0), 0);

    if (totalIssues > 0) {
      console.log(colors.gray(
        `${t('commands:list.totalProcessed')}: ${colors.cyan(totalIssues)} ${t('table:columns.issues').toLowerCase()}, ` +
        `${colors.red(totalErrors)} ${t('table:columns.errors').toLowerCase()}`
      ));
    }
  }
}

module.exports = ListCommand;