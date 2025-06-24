/**
 * Status Command
 * Shows PoppoBuilder status with multi-project support
 */

const StatusAggregator = require('../utils/status-aggregator');
const chalk = require('chalk');
const { t } = require('../i18n');
const tableFormatter = require('../utils/table-formatter');

class StatusCommand {
  constructor() {
    this.aggregator = new StatusAggregator();
  }

  async execute(options) {
    try {
      // Determine what to show
      if (options.projectId) {
        // Show specific project status
        await this.showProjectStatus(options.projectId, options.json);
      } else {
        // Show global status
        await this.showGlobalStatus(options.json);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Show global status
   */
  async showGlobalStatus(jsonFormat = false) {
    const status = await this.aggregator.getGlobalStatus();
    
    if (jsonFormat) {
      console.log(this.aggregator.formatStatus(status, 'json'));
    } else {
      this.displayGlobalStatus(status);
    }
  }

  /**
   * Show specific project status
   */
  async showProjectStatus(projectId, jsonFormat = false) {
    const project = await this.aggregator.getProjectStatus(projectId);
    
    if (jsonFormat) {
      console.log(this.aggregator.formatProjectStatus(project, 'json'));
    } else {
      this.displayProjectStatus(project);
    }
  }

  /**
   * Display global status with colors
   */
  displayGlobalStatus(status) {
    console.log(chalk.bold.blue(t('commands:status.title')));
    console.log(chalk.gray('=' .repeat(50)));
    console.log();

    // Daemon status
    console.log(chalk.bold(t('commands:status.daemon.title')));
    if (status.daemon.running) {
      console.log(chalk.green(`  ✓ ${t('common:status.running')}`) + chalk.gray(` (PID: ${status.daemon.pid})`));
      console.log(`  ${chalk.gray(t('commands:status.daemon.uptime'))} ${this.formatDuration(status.daemon.uptime)}`);
    } else {
      console.log(chalk.red(`  ✗ ${status.daemon.message}`));
    }
    console.log();

    // Summary
    const summaryData = {
      [t('commands:status.summary.totalProjects')]: status.summary.totalProjects,
      [t('commands:status.summary.activeProjects')]: chalk.green(status.summary.activeProjects),
      [t('commands:status.summary.runningProcesses')]: `${chalk.cyan(status.summary.activeProcesses)}/${status.summary.totalProcesses}`,
      [t('commands:status.summary.issuesProcessed')]: status.summary.totalIssuesProcessed
    };
    
    if (status.summary.totalErrors > 0) {
      summaryData[t('commands:status.summary.totalErrors')] = chalk.red(status.summary.totalErrors);
    }

    console.log(chalk.bold(t('commands:status.summary.title')));
    console.log(tableFormatter.formatKeyValue(summaryData, { compact: true }));
    console.log();

    // Projects Table
    console.log(chalk.bold(t('commands:status.projects.title')));
    const projectEntries = Object.entries(status.projects);
    
    if (projectEntries.length === 0) {
      console.log(chalk.gray(`  ${t('commands:status.projects.noProjects')}`));
    } else {
      const projectData = projectEntries.map(([projectId, project]) => ({
        id: projectId,
        status: project.enabled ? t('table:status.enabled') : t('table:status.disabled'),
        processes: `${project.processes.active}/${project.processes.total}`,
        activeIssues: project.activeIssues || 0,
        lastActivity: project.lastActivity ? this.getTimeAgo(new Date(project.lastActivity)) : '-'
      }));

      const columns = [
        { key: 'id', labelKey: 'table:columns.project' },
        { 
          key: 'status', 
          labelKey: 'table:columns.status',
          formatter: (value) => value === t('table:status.enabled') ? chalk.green(value) : chalk.gray(value)
        },
        { key: 'processes', labelKey: 'commands:status.columns.processes' },
        { key: 'activeIssues', labelKey: 'commands:status.columns.activeIssues', align: 'right' },
        { key: 'lastActivity', labelKey: 'table:columns.lastActivity' }
      ];

      console.log(tableFormatter.formatTable(projectData, { columns, compact: true }));
    }
  }

  /**
   * Display project summary
   */
  displayProjectSummary(projectId, project) {
    const statusIcon = project.enabled ? chalk.green('●') : chalk.gray('○');
    console.log(`  ${statusIcon} ${chalk.bold(projectId)}`);
    console.log(`    ${chalk.gray('Path:')} ${project.path}`);
    
    if (project.error) {
      console.log(`    ${chalk.red('Error:')} ${project.error}`);
    } else {
      const activeColor = project.processes.active > 0 ? chalk.green : chalk.gray;
      console.log(`    ${chalk.gray('Processes:')} ${activeColor(project.processes.active)}/${project.processes.total}`);
      
      if (project.activeIssues > 0) {
        console.log(`    ${chalk.gray('Active Issues:')} ${chalk.yellow(project.activeIssues)}`);
      }
      
      if (project.lastActivity) {
        const timeAgo = this.getTimeAgo(new Date(project.lastActivity));
        console.log(`    ${chalk.gray('Last Activity:')} ${timeAgo}`);
      }
    }
    console.log();
  }

  /**
   * Display detailed project status
   */
  displayProjectStatus(project) {
    console.log(chalk.bold.blue(`Project: ${project.id}`));
    console.log(chalk.gray('=' .repeat(50)));
    console.log();

    console.log(`${chalk.gray('Path:')} ${project.path}`);
    console.log(`${chalk.gray('Status:')} ${project.enabled ? chalk.green('Enabled') : chalk.red('Disabled')}`);
    console.log();

    if (project.error) {
      console.log(chalk.red('Error:'), project.error);
    } else {
      // Processes
      console.log(chalk.bold('Processes:'));
      console.log(`  ${chalk.gray('Total:')} ${project.processes.total}`);
      console.log(`  ${chalk.gray('Active:')} ${chalk.green(project.processes.active)}`);
      
      if (project.processes.running.length > 0) {
        console.log(`  ${chalk.gray('Running:')}`);
        for (const proc of project.processes.running) {
          const statusColor = proc.status === 'running' ? chalk.green : chalk.yellow;
          console.log(`    ${chalk.gray('•')} ${proc.type} ${statusColor(`(${proc.status})`)} ${chalk.gray(`- PID: ${proc.pid}`)}`);
          
          if (proc.startTime) {
            const duration = Date.now() - new Date(proc.startTime).getTime();
            console.log(`      ${chalk.gray('Running for:')} ${this.aggregator.formatDuration(duration)}`);
          }
        }
      }
      
      console.log();
      
      // Statistics
      console.log(chalk.bold('Statistics:'));
      console.log(`  ${chalk.gray('Issues Processed:')} ${project.stats.issuesProcessed || 0}`);
      console.log(`  ${chalk.gray('Total Errors:')} ${project.stats.errors || 0}`);
      
      if (project.stats.lastActivityAt) {
        console.log(`  ${chalk.gray('Average Processing Time:')} ${project.stats.averageProcessingTime || 0}ms`);
      }
      
      if (project.lastActivity) {
        console.log();
        const timeAgo = this.getTimeAgo(new Date(project.lastActivity));
        console.log(`${chalk.gray('Last Activity:')} ${timeAgo} (${new Date(project.lastActivity).toLocaleString()})`);
      }
    }
  }

  /**
   * Get time ago string
   */
  getTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    
    if (seconds < 60) {
      return t('commands:status.time.justNow');
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return t('common:time.ago', { time: t('common:time.minutes', { count: minutes }) });
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return t('common:time.ago', { time: t('common:time.hours', { count: hours }) });
    } else {
      const days = Math.floor(seconds / 86400);
      return t('common:time.ago', { time: t('common:time.days', { count: days }) });
    }
  }

  /**
   * Format duration
   */
  formatDuration(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      const remainingHours = hours % 24;
      return `${t('common:time.days', { count: days })} ${t('common:time.hours', { count: remainingHours })}`;
    } else if (hours > 0) {
      const remainingMinutes = minutes % 60;
      return `${t('common:time.hours', { count: hours })} ${t('common:time.minutes', { count: remainingMinutes })}`;
    } else if (minutes > 0) {
      const remainingSeconds = seconds % 60;
      return `${t('common:time.minutes', { count: minutes })} ${t('common:time.seconds', { count: remainingSeconds })}`;
    } else {
      return t('common:time.seconds', { count: seconds });
    }
  }
}

module.exports = StatusCommand;