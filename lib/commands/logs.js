/**
 * Logs command - View and search logs across projects
 */

const { MultiLogger, getInstance: getLoggerInstance } = require('../utils/multi-logger');
const LogAggregator = require('../utils/log-aggregator');
const { DaemonAPIClient } = require('../daemon/api-client');
const { GlobalConfigManager } = require('../core/global-config-manager');
const chalk = require('chalk');
const path = require('path');
const fs = require('fs').promises;

class LogsCommand {
  constructor() {
    this.globalConfig = new GlobalConfig();
    this.aggregator = null;
  }

  async execute(options = {}) {
    try {
      // Initialize global config
      await this.globalConfig.initialize();
      const globalLogDir = path.join(
        this.globalConfig.getGlobalDir(),
        'logs'
      );

      // Initialize log aggregator
      this.aggregator = new LogAggregator({ globalLogDir });
      await this.aggregator.initialize();

      // Register projects from registry
      const registry = this.globalConfig.getProjectRegistry();
      for (const [projectId, projectInfo] of Object.entries(registry.projects || {})) {
        if (projectInfo.path) {
          this.aggregator.registerProject(projectId, projectInfo.path);
        }
      }

      // Handle different subcommands
      if (options.stream) {
        await this.streamLogs(options);
      } else if (options.aggregate) {
        await this.aggregateLogs(options);
      } else if (options.errors) {
        await this.showErrors(options);
      } else if (options.export) {
        await this.exportLogs(options);
      } else {
        await this.searchLogs(options);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Search and display logs
   */
  async searchLogs(options) {
    const criteria = this.buildSearchCriteria(options);
    const logs = await this.aggregator.search(criteria);

    if (logs.length === 0) {
      console.log(chalk.yellow('No logs found matching criteria'));
      return;
    }

    console.log(chalk.blue(`Found ${logs.length} log entries:\n`));

    for (const log of logs) {
      this.displayLogEntry(log, options);
    }
  }

  /**
   * Stream logs in real-time
   */
  async streamLogs(options) {
    console.log(chalk.blue('Streaming logs... (Press Ctrl+C to stop)\n'));

    const stream = this.aggregator.streamLogs({
      follow: true,
      tail: options.tail || 10,
      level: options.level,
      projectId: options.project
    });

    stream.on('log', (log) => {
      this.displayLogEntry(log, options);
    });

    stream.on('error', (error) => {
      console.error(chalk.red('Stream error:'), error.message);
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      stream.stop();
      process.exit(0);
    });

    // Keep process alive
    await new Promise(() => {});
  }

  /**
   * Show aggregated logs
   */
  async aggregateLogs(options) {
    const result = await this.aggregator.aggregate({
      groupBy: options.groupBy || 'level',
      startTime: options.since ? new Date(options.since) : undefined,
      endTime: options.until ? new Date(options.until) : undefined,
      includeStats: true
    });

    console.log(chalk.blue('Log Aggregation:\n'));

    // Display group statistics
    for (const [group, stats] of Object.entries(result.groupStats)) {
      console.log(chalk.cyan(`${group}:`), 
        `${stats.count} entries (${stats.percentage.toFixed(1)}%)`
      );
    }

    // Display overall statistics
    if (result.stats) {
      console.log(chalk.blue('\nOverall Statistics:'));
      console.log(`Total entries: ${result.stats.total}`);
      console.log(`Time range: ${result.stats.timeRange.start} - ${result.stats.timeRange.end}`);
      
      console.log(chalk.blue('\nBy Level:'));
      for (const [level, count] of Object.entries(result.stats.byLevel)) {
        console.log(`  ${this.formatLevel(level)}: ${count}`);
      }

      if (Object.keys(result.stats.byProject).length > 0) {
        console.log(chalk.blue('\nBy Project:'));
        for (const [project, count] of Object.entries(result.stats.byProject)) {
          console.log(`  ${project}: ${count}`);
        }
      }
    }
  }

  /**
   * Show error summary
   */
  async showErrors(options) {
    const summary = await this.aggregator.getErrorSummary({
      startTime: options.since ? new Date(options.since) : undefined,
      endTime: options.until ? new Date(options.until) : undefined
    });

    console.log(chalk.red(`Error Summary (${summary.total} total errors):\n`));

    if (summary.byComponent && Object.keys(summary.byComponent).length > 0) {
      console.log(chalk.red('By Component:'));
      for (const [component, count] of Object.entries(summary.byComponent)) {
        console.log(`  ${component}: ${count}`);
      }
      console.log();
    }

    if (summary.byProject && Object.keys(summary.byProject).length > 0) {
      console.log(chalk.red('By Project:'));
      for (const [project, count] of Object.entries(summary.byProject)) {
        console.log(`  ${project}: ${count}`);
      }
      console.log();
    }

    if (summary.topErrors && summary.topErrors.length > 0) {
      console.log(chalk.red('Top Errors:'));
      summary.topErrors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.message} (${error.count} occurrences)`);
      });
    }
  }

  /**
   * Export logs to file
   */
  async exportLogs(options) {
    const outputPath = options.export;
    const format = options.format || 'json';
    const criteria = this.buildSearchCriteria(options);

    console.log(chalk.blue(`Exporting logs to ${outputPath}...`));

    await this.aggregator.export(outputPath, criteria, format);

    console.log(chalk.green(`✓ Logs exported successfully to ${outputPath}`));
  }

  /**
   * Build search criteria from options
   */
  buildSearchCriteria(options) {
    const criteria = {};

    if (options.level) {
      criteria.level = options.level;
    }

    if (options.project) {
      criteria.projectId = options.project;
    }

    if (options.component) {
      criteria.component = options.component;
    }

    if (options.query) {
      criteria.query = options.query;
    }

    if (options.since) {
      criteria.startTime = new Date(options.since);
    }

    if (options.until) {
      criteria.endTime = new Date(options.until);
    }

    if (options.limit) {
      criteria.limit = parseInt(options.limit, 10);
    }

    criteria.includeGlobal = !options.noGlobal;
    criteria.includeProjects = !options.noProjects;
    criteria.includeDaemon = !options.noDaemon;

    return criteria;
  }

  /**
   * Display a log entry
   */
  displayLogEntry(log, options) {
    const timestamp = options.noTime ? '' : chalk.gray(log.timestamp) + ' ';
    const level = this.formatLevel(log.level);
    const source = options.noSource ? '' : chalk.cyan(`[${log.source}]`);
    const component = log.component ? chalk.magenta(`[${log.component}]`) : '';
    const project = log.projectId ? chalk.blue(`[${log.projectId}]`) : '';

    let message = log.message;
    if (options.json) {
      message = JSON.stringify(log, null, 2);
    } else if (log.error && options.verbose) {
      message += chalk.red(`\n  Error: ${log.error.message}`);
      if (log.error.stack) {
        message += chalk.gray(`\n  Stack: ${log.error.stack}`);
      }
    }

    console.log(`${timestamp}${level} ${source}${component}${project} ${message}`);
  }

  /**
   * Format log level with color
   */
  formatLevel(level) {
    const levelStr = level.toUpperCase().padEnd(5);
    switch (level) {
      case 'error':
        return chalk.red(levelStr);
      case 'warn':
        return chalk.yellow(levelStr);
      case 'info':
        return chalk.green(levelStr);
      case 'debug':
        return chalk.blue(levelStr);
      case 'trace':
        return chalk.gray(levelStr);
      default:
        return levelStr;
    }
  }

  /**
   * Get command definition for CLI
   */
  static getCommandDefinition() {
    return {
      command: 'logs [query]',
      description: 'View and search logs across projects',
      options: [
        ['-l, --level <level>', 'Filter by log level (error, warn, info, debug, trace)'],
        ['-p, --project <id>', 'Filter by project ID'],
        ['-c, --component <name>', 'Filter by component name'],
        ['--since <time>', 'Show logs since time (ISO 8601 or relative)'],
        ['--until <time>', 'Show logs until time (ISO 8601 or relative)'],
        ['--limit <n>', 'Limit number of results', '1000'],
        ['-f, --stream', 'Stream logs in real-time'],
        ['--tail <n>', 'Number of lines to show when streaming', '10'],
        ['-a, --aggregate', 'Show aggregated log statistics'],
        ['--group-by <field>', 'Group aggregation by field (level, project, component, hour)', 'level'],
        ['-e, --errors', 'Show error summary'],
        ['--export <file>', 'Export logs to file'],
        ['--format <format>', 'Export format (json, csv, text)', 'json'],
        ['--no-global', 'Exclude global logs'],
        ['--no-projects', 'Exclude project logs'],
        ['--no-daemon', 'Exclude daemon logs'],
        ['--no-time', 'Hide timestamps'],
        ['--no-source', 'Hide log source'],
        ['-j, --json', 'Output in JSON format'],
        ['-v, --verbose', 'Show detailed information']
      ],
      action: async (query, options) => {
        if (query) {
          options.query = query;
        }
        const command = new LogsCommand();
        await command.execute(options);
      }
    };
  }
}

module.exports = LogsCommand;