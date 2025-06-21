/**
 * Status Command
 * Shows PoppoBuilder status with multi-project support
 */

const StatusAggregator = require('../utils/status-aggregator');
const chalk = require('chalk');

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
    console.log(chalk.bold.blue('PoppoBuilder Status'));
    console.log(chalk.gray('=' .repeat(50)));
    console.log();

    // Daemon status
    console.log(chalk.bold('Daemon Status:'));
    if (status.daemon.running) {
      console.log(chalk.green(`  ✓ Running`) + chalk.gray(` (PID: ${status.daemon.pid})`));
      console.log(`  ${chalk.gray('Uptime:')} ${this.aggregator.formatDuration(status.daemon.uptime)}`);
    } else {
      console.log(chalk.red(`  ✗ ${status.daemon.message}`));
    }
    console.log();

    // Summary
    console.log(chalk.bold('Summary:'));
    console.log(`  ${chalk.gray('Total Projects:')} ${status.summary.totalProjects}`);
    console.log(`  ${chalk.gray('Active Projects:')} ${chalk.green(status.summary.activeProjects)}`);
    console.log(`  ${chalk.gray('Running Processes:')} ${chalk.cyan(status.summary.activeProcesses)}/${status.summary.totalProcesses}`);
    console.log(`  ${chalk.gray('Issues Processed:')} ${status.summary.totalIssuesProcessed}`);
    if (status.summary.totalErrors > 0) {
      console.log(`  ${chalk.gray('Total Errors:')} ${chalk.red(status.summary.totalErrors)}`);
    }
    console.log();

    // Projects
    console.log(chalk.bold('Projects:'));
    const projectEntries = Object.entries(status.projects);
    
    if (projectEntries.length === 0) {
      console.log(chalk.gray('  No projects registered'));
    } else {
      for (const [projectId, project] of projectEntries) {
        this.displayProjectSummary(projectId, project);
      }
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
      return 'just now';
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
      const days = Math.floor(seconds / 86400);
      return `${days} day${days > 1 ? 's' : ''} ago`;
    }
  }
}

module.exports = StatusCommand;