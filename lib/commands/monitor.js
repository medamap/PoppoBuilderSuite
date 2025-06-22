/**
 * Monitor command - View system health and process monitoring
 */

const { DaemonAPIClient } = require('../daemon/api-client');
const chalk = require('chalk');
const Table = require('cli-table3');

class MonitorCommand {
  constructor() {
    this.client = null;
  }

  async execute(action = 'status', options = {}) {
    try {
      this.client = await getDaemonClient();
      
      switch (action) {
        case 'status':
          await this.showStatus(options);
          break;
          
        case 'health':
          await this.showHealth(options);
          break;
          
        case 'processes':
          await this.showProcesses(options);
          break;
          
        case 'metrics':
          await this.showMetrics(options);
          break;
          
        case 'recovery':
          await this.showRecovery(options);
          break;
          
        default:
          console.error(chalk.red(`Unknown action: ${action}`));
          console.log('Available actions: status, health, processes, metrics, recovery');
          process.exit(1);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      process.exit(1);
    }
  }

  /**
   * Show overall monitoring status
   */
  async showStatus(options) {
    const response = await this.client.request('GET', '/api/monitoring/status');
    const status = response.data;
    
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    
    console.log(chalk.bold('\n=== Monitoring Status ===\n'));
    
    console.log(`Running: ${status.running ? chalk.green('Yes') : chalk.red('No')}`);
    if (status.running) {
      console.log(`Uptime: ${this.formatDuration(status.uptime)}`);
    }
    
    // Health summary
    if (status.health) {
      console.log(chalk.bold('\nHealth Status:'));
      console.log(`  Overall: ${this.formatHealthStatus(status.health.overall)}`);
      console.log(`  Last Update: ${new Date(status.health.lastUpdate).toLocaleString()}`);
    }
    
    // Process summary
    if (status.processes) {
      console.log(chalk.bold('\nProcess Monitoring:'));
      console.log(`  Active Processes: ${status.processes.count}`);
      console.log(`  Total CPU: ${status.processes.metrics.totalCpu?.toFixed(2) || 0}%`);
      console.log(`  Total Memory: ${status.processes.metrics.totalMemory?.toFixed(2) || 0}%`);
    }
    
    // Recovery summary
    if (status.recovery) {
      console.log(chalk.bold('\nAuto Recovery:'));
      console.log(`  Total Attempts: ${status.recovery.totalAttempts}`);
      console.log(`  Successful: ${chalk.green(status.recovery.successfulRecoveries)}`);
      console.log(`  Failed: ${chalk.red(status.recovery.failedRecoveries)}`);
    }
  }

  /**
   * Show health check details
   */
  async showHealth(options) {
    const response = await this.client.request('GET', '/api/monitoring/health');
    const health = response.data;
    
    if (options.json) {
      console.log(JSON.stringify(health, null, 2));
      return;
    }
    
    console.log(chalk.bold('\n=== Health Check Results ===\n'));
    
    console.log(`Overall Status: ${this.formatHealthStatus(health.overall)}`);
    console.log(`Last Update: ${new Date(health.lastUpdate).toLocaleString()}`);
    console.log(`Duration: ${health.duration}ms`);
    
    // Create health checks table
    const table = new Table({
      head: ['Check', 'Status', 'Metric', 'Threshold', 'Details'],
      colWidths: [15, 10, 10, 10, 40]
    });
    
    for (const [name, check] of Object.entries(health.checks)) {
      const metric = check.metric !== undefined ? 
        (check.metric * 100).toFixed(2) + '%' : 
        'N/A';
      
      const threshold = check.threshold !== undefined ?
        (check.threshold * 100).toFixed(2) + '%' :
        'N/A';
        
      const details = check.details ? 
        this.formatDetails(check.details) :
        check.error || '';
      
      table.push([
        name,
        this.formatHealthStatus(check.status),
        metric,
        threshold,
        details
      ]);
    }
    
    console.log('\n' + table.toString());
  }

  /**
   * Show process monitoring details
   */
  async showProcesses(options) {
    const response = await this.client.request('GET', '/api/monitoring/processes');
    const processes = response.data;
    
    if (options.json) {
      console.log(JSON.stringify(processes, null, 2));
      return;
    }
    
    console.log(chalk.bold('\n=== Process Monitoring ===\n'));
    
    if (processes.length === 0) {
      console.log(chalk.yellow('No processes being monitored'));
      return;
    }
    
    // Create process table
    const table = new Table({
      head: ['PID', 'Name', 'Type', 'CPU %', 'Memory %', 'RSS', 'State', 'Uptime'],
      colWidths: [10, 20, 10, 10, 10, 15, 8, 15]
    });
    
    for (const process of processes) {
      const uptime = process.startTime ? 
        this.formatDuration(Date.now() - process.startTime) : 
        'N/A';
        
      table.push([
        process.pid,
        process.name || 'unknown',
        process.type || 'worker',
        (process.cpu || 0).toFixed(2),
        (process.memory || 0).toFixed(2),
        this.formatBytes(process.rss || 0),
        process.state || 'R',
        uptime
      ]);
    }
    
    console.log(table.toString());
    
    // Show specific process details if requested
    if (options.pid) {
      await this.showProcessDetails(options.pid);
    }
  }

  /**
   * Show process details
   */
  async showProcessDetails(pid) {
    try {
      const response = await this.client.request('GET', `/api/monitoring/processes/${pid}`);
      const data = response.data;
      
      console.log(chalk.bold(`\n=== Process ${pid} Details ===\n`));
      
      // Process info
      console.log(chalk.bold('Process Information:'));
      console.log(`  Name: ${data.process.name}`);
      console.log(`  Type: ${data.process.type}`);
      console.log(`  Start Time: ${new Date(data.process.startTime).toLocaleString()}`);
      console.log(`  Command: ${data.process.command || 'N/A'}`);
      
      // Statistics
      if (data.stats) {
        console.log(chalk.bold('\nResource Statistics:'));
        console.log(`  CPU: Current=${data.stats.cpu.current.toFixed(2)}%, Average=${data.stats.cpu.average.toFixed(2)}%, Max=${data.stats.cpu.max.toFixed(2)}%`);
        console.log(`  Memory: Current=${data.stats.memory.current.toFixed(2)}%, Average=${data.stats.memory.average.toFixed(2)}%, Max=${data.stats.memory.max.toFixed(2)}%`);
        console.log(`  RSS: Current=${this.formatBytes(data.stats.rss.current)}, Average=${this.formatBytes(data.stats.rss.average)}, Max=${this.formatBytes(data.stats.rss.max)}`);
      }
      
    } catch (error) {
      console.error(chalk.red(`Error getting process ${pid} details:`), error.message);
    }
  }

  /**
   * Show metrics
   */
  async showMetrics(options) {
    const format = options.format || 'json';
    const response = await this.client.request('GET', `/api/monitoring/metrics?format=${format}`);
    
    if (format === 'prometheus') {
      console.log(response.data);
    } else {
      if (options.raw) {
        console.log(JSON.stringify(response.data, null, 2));
      } else {
        console.log(chalk.bold('\n=== System Metrics ===\n'));
        console.log(JSON.stringify(response.data, null, 2));
      }
    }
  }

  /**
   * Show recovery information
   */
  async showRecovery(options) {
    const response = await this.client.request('GET', '/api/monitoring/recovery');
    const data = response.data;
    
    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    
    console.log(chalk.bold('\n=== Auto Recovery ===\n'));
    
    // Statistics
    console.log(chalk.bold('Recovery Statistics:'));
    console.log(`  Total Attempts: ${data.stats.totalAttempts}`);
    console.log(`  Successful: ${chalk.green(data.stats.successfulRecoveries)}`);
    console.log(`  Failed: ${chalk.red(data.stats.failedRecoveries)}`);
    
    // By issue type
    if (Object.keys(data.stats.byIssue).length > 0) {
      console.log(chalk.bold('\nBy Issue Type:'));
      for (const [issue, stats] of Object.entries(data.stats.byIssue)) {
        console.log(`  ${issue}:`);
        console.log(`    Attempts: ${stats.attempts}`);
        console.log(`    Success: ${stats.successes}, Failed: ${stats.failures}`);
        if (stats.lastAttempt) {
          console.log(`    Last Attempt: ${new Date(stats.lastAttempt).toLocaleString()}`);
        }
      }
    }
    
    // Recent history
    if (options.history) {
      console.log(chalk.bold('\nRecent Recovery History:'));
      
      const allHistory = [];
      for (const [issue, history] of Object.entries(data.history)) {
        for (const attempt of history) {
          allHistory.push({ ...attempt, issue });
        }
      }
      
      // Sort by timestamp
      allHistory.sort((a, b) => b.timestamp - a.timestamp);
      
      // Show last 10
      const recent = allHistory.slice(0, 10);
      for (const attempt of recent) {
        const time = new Date(attempt.timestamp).toLocaleString();
        const status = attempt.success ? chalk.green('SUCCESS') : chalk.red('FAILED');
        console.log(`  [${time}] ${attempt.issue}: ${status}`);
        if (attempt.result?.message) {
          console.log(`    ${attempt.result.message}`);
        }
      }
    }
  }

  /**
   * Format health status with color
   */
  formatHealthStatus(status) {
    switch (status) {
      case 'healthy':
        return chalk.green(status);
      case 'unhealthy':
        return chalk.red(status);
      case 'error':
        return chalk.red.bold(status);
      default:
        return chalk.yellow(status);
    }
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format bytes
   */
  formatBytes(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Format details object
   */
  formatDetails(details) {
    const parts = [];
    for (const [key, value] of Object.entries(details)) {
      if (typeof value === 'number' && key.includes('memory') || key.includes('size')) {
        parts.push(`${key}: ${this.formatBytes(value)}`);
      } else {
        parts.push(`${key}: ${value}`);
      }
    }
    return parts.join(', ');
  }

  /**
   * Get command definition for CLI
   */
  static getCommandDefinition() {
    return {
      command: 'monitor [action]',
      description: 'Monitor system health and processes',
      options: [
        ['-j, --json', 'Output in JSON format'],
        ['--pid <pid>', 'Show details for specific process'],
        ['--format <format>', 'Output format (json, prometheus)', 'json'],
        ['--history', 'Show recovery history'],
        ['--raw', 'Show raw output']
      ],
      action: async (action, options) => {
        const command = new MonitorCommand();
        await command.execute(action, options);
      }
    };
  }
}

module.exports = MonitorCommand;