/**
 * Status Command
 * Display status information about the PoppoBuilder daemon
 */

const { Command } = require('commander');
const IPCClient = require('../../../daemon/ipc/ipc-client');
const colors = require('@colors/colors');
const Table = require('cli-table3');

// Simple filesize formatter
const formatFilesize = (bytes) => {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
};

class StatusCommand {
  constructor() {
    this.ipcClient = new IPCClient();
  }

  /**
   * Create the status command
   * @returns {Command} The status command
   */
  static create() {
    const cmd = new Command('status');
    
    cmd
      .description('Show daemon status and health information')
      .option('-v, --verbose', 'Show detailed information')
      .option('-w, --workers', 'Show worker details')
      .option('-q, --queues', 'Show queue statistics')
      .option('-p, --projects', 'Show project status')
      .option('-h, --health', 'Show component health status')
      .option('--continuous', 'Continuously update status')
      .option('--interval <seconds>', 'Update interval for continuous mode', parseInt, 2)
      .option('--json', 'Output in JSON format')
      .action(async (options) => {
        const command = new StatusCommand();
        await command.execute(options);
      });

    return cmd;
  }

  /**
   * Execute the status command
   * @param {Object} options Command options
   */
  async execute(options) {
    try {
      // Check if daemon is running
      if (!(await this.isDaemonRunning())) {
        const message = 'Daemon is not running';
        
        if (options.json) {
          console.log(JSON.stringify({
            running: false,
            message
          }));
        } else {
          console.log(colors.red(`❌ ${message}`));
          console.log('');
          console.log(colors.gray('Use "poppo daemon start" to start the daemon'));
        }
        
        return;
      }

      // Connect to daemon
      await this.ipcClient.connect();

      // Display status
      if (options.continuous && !options.json) {
        await this.displayContinuousStatus(options);
      } else {
        await this.displayStatus(options);
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          error: error.message
        }));
      } else {
        console.error(colors.red(`❌ Failed to get status: ${error.message}`));
      }
      
      process.exit(1);
    } finally {
      try {
        await this.ipcClient.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
    }
  }

  /**
   * Display status information
   * @param {Object} options Command options
   */
  async displayStatus(options) {
    // Gather all status information
    const status = await this.ipcClient.getDaemonStatus();
    const health = await this.getHealthStatus();
    
    let workerStatus, queueStatus, projectStatus;
    
    if (options.workers || options.verbose) {
      workerStatus = await this.getWorkerStatus();
    }
    
    if (options.queues || options.verbose) {
      queueStatus = await this.getQueueStatus();
    }
    
    if (options.projects || options.verbose) {
      projectStatus = await this.getProjectStatus();
    }

    // Output based on format
    if (options.json) {
      console.log(JSON.stringify({
        running: true,
        daemon: status,
        health,
        workers: workerStatus,
        queues: queueStatus,
        projects: projectStatus
      }, null, 2));
    } else {
      this.displayFormattedStatus(status, health, {
        workers: workerStatus,
        queues: queueStatus,
        projects: projectStatus,
        verbose: options.verbose,
        showHealth: options.health
      });
    }
  }

  /**
   * Display formatted status information
   */
  displayFormattedStatus(status, health, options = {}) {
    console.log(colors.green.bold('✅ PoppoBuilder Daemon Status'));
    console.log('');
    
    // Basic Information
    this.displayBasicInfo(status);
    
    // Health Status
    if (options.showHealth || options.verbose) {
      this.displayHealthStatus(health);
    }
    
    // Worker Status
    if (options.workers) {
      this.displayWorkerStatus(options.workers);
    }
    
    // Queue Status
    if (options.queues) {
      this.displayQueueStatus(options.queues);
    }
    
    // Project Status
    if (options.projects) {
      this.displayProjectStatus(options.projects);
    }
    
    // System Resources
    if (options.verbose) {
      this.displaySystemResources(status);
    }
  }

  /**
   * Display basic daemon information
   */
  displayBasicInfo(status) {
    const table = new Table({
      style: { head: ['cyan'] }
    });
    
    table.push(
      ['PID', colors.white(status.pid)],
      ['Version', colors.white(status.version)],
      ['Uptime', colors.white(this.formatUptime(status.uptime))],
      ['Started', colors.white(new Date(status.startTime).toLocaleString())],
      ['Node Version', colors.white(status.nodeVersion)],
      ['Platform', colors.white(`${status.platform} ${status.arch}`)]
    );
    
    if (status.apiServer) {
      table.push(
        ['API Server', colors.white(`${status.apiServer.host}:${status.apiServer.port}`)]
      );
    }
    
    console.log(colors.bold('Basic Information:'));
    console.log(table.toString());
    console.log('');
  }

  /**
   * Display health status
   */
  displayHealthStatus(health) {
    console.log(colors.bold('Component Health:'));
    
    const table = new Table({
      head: ['Component', 'Status', 'Details'],
      style: { head: ['cyan'] }
    });
    
    for (const [component, status] of Object.entries(health)) {
      const statusIcon = status.healthy ? '✅' : '❌';
      const statusText = status.healthy ? colors.green('Healthy') : colors.red('Unhealthy');
      const details = status.message || '';
      
      table.push([
        component,
        `${statusIcon} ${statusText}`,
        colors.gray(details)
      ]);
    }
    
    console.log(table.toString());
    console.log('');
  }

  /**
   * Display worker status
   */
  displayWorkerStatus(workers) {
    console.log(colors.bold('Workers:'));
    
    if (!workers || workers.length === 0) {
      console.log(colors.gray('  No active workers'));
      console.log('');
      return;
    }
    
    const table = new Table({
      head: ['ID', 'PID', 'Status', 'Tasks', 'CPU', 'Memory', 'Uptime'],
      style: { head: ['cyan'] }
    });
    
    for (const worker of workers) {
      const statusColor = worker.status === 'idle' ? 'green' : 
                         worker.status === 'busy' ? 'yellow' : 'red';
      
      table.push([
        worker.id,
        worker.pid,
        colors[statusColor](worker.status),
        `${worker.completedTasks} completed`,
        `${worker.cpu.toFixed(1)}%`,
        formatFilesize(worker.memory),
        this.formatUptime(worker.uptime / 1000)
      ]);
    }
    
    console.log(table.toString());
    console.log('');
  }

  /**
   * Display queue status
   */
  displayQueueStatus(queues) {
    console.log(colors.bold('Queues:'));
    
    if (!queues || Object.keys(queues).length === 0) {
      console.log(colors.gray('  No active queues'));
      console.log('');
      return;
    }
    
    const table = new Table({
      head: ['Queue', 'Status', 'Active', 'Waiting', 'Completed', 'Failed'],
      style: { head: ['cyan'] }
    });
    
    for (const [name, queue] of Object.entries(queues)) {
      const statusColor = queue.paused ? 'yellow' : 'green';
      const statusText = queue.paused ? 'Paused' : 'Active';
      
      table.push([
        name,
        colors[statusColor](statusText),
        queue.active || 0,
        queue.waiting || 0,
        queue.completed || 0,
        queue.failed || 0
      ]);
    }
    
    console.log(table.toString());
    console.log('');
  }

  /**
   * Display project status
   */
  displayProjectStatus(projects) {
    console.log(colors.bold('Projects:'));
    
    if (!projects || projects.length === 0) {
      console.log(colors.gray('  No active projects'));
      console.log('');
      return;
    }
    
    const table = new Table({
      head: ['Project', 'Status', 'Tasks', 'Issues', 'Last Activity'],
      style: { head: ['cyan'] }
    });
    
    for (const project of projects) {
      const statusColor = project.active ? 'green' : 'gray';
      const statusText = project.active ? 'Active' : 'Inactive';
      
      table.push([
        project.name,
        colors[statusColor](statusText),
        `${project.runningTasks}/${project.totalTasks}`,
        `${project.openIssues} open`,
        project.lastActivity ? new Date(project.lastActivity).toLocaleString() : 'Never'
      ]);
    }
    
    console.log(table.toString());
    console.log('');
  }

  /**
   * Display system resources
   */
  displaySystemResources(status) {
    console.log(colors.bold('System Resources:'));
    
    const table = new Table({
      style: { head: ['cyan'] }
    });
    
    if (status.system) {
      table.push(
        ['CPU Usage', `${status.system.cpuUsage.toFixed(1)}%`],
        ['Memory Usage', `${formatFilesize(status.system.memoryUsage.used)} / ${formatFilesize(status.system.memoryUsage.total)}`],
        ['Load Average', status.system.loadAverage.map(l => l.toFixed(2)).join(', ')],
        ['Free Memory', formatFilesize(status.system.memoryUsage.free)]
      );
    }
    
    console.log(table.toString());
    console.log('');
  }

  /**
   * Display continuous status updates
   */
  async displayContinuousStatus(options) {
    console.clear();
    
    const interval = options.interval * 1000;
    let running = true;
    
    // Handle Ctrl+C
    process.on('SIGINT', () => {
      running = false;
      console.clear();
      console.log(colors.yellow('\nStopped continuous status display'));
      process.exit(0);
    });
    
    while (running) {
      console.clear();
      console.log(colors.gray(`Updating every ${options.interval} seconds. Press Ctrl+C to stop.`));
      console.log('');
      
      await this.displayStatus({ ...options, continuous: false });
      
      await new Promise(resolve => setTimeout(resolve, interval));
    }
  }

  /**
   * Get health status from daemon
   */
  async getHealthStatus() {
    try {
      return await this.ipcClient.sendCommand('health.status');
    } catch (error) {
      return {
        daemon: { healthy: true, message: 'Running' },
        api: { healthy: false, message: 'Unable to get health status' }
      };
    }
  }

  /**
   * Get worker status from daemon
   */
  async getWorkerStatus() {
    try {
      return await this.ipcClient.sendCommand('worker.status');
    } catch (error) {
      return [];
    }
  }

  /**
   * Get queue status from daemon
   */
  async getQueueStatus() {
    try {
      return await this.ipcClient.sendCommand('queue.status');
    } catch (error) {
      return {};
    }
  }

  /**
   * Get project status from daemon
   */
  async getProjectStatus() {
    try {
      return await this.ipcClient.sendCommand('project.list', { includeStats: true });
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if daemon is running
   * @returns {Promise<boolean>} True if daemon is running
   */
  async isDaemonRunning() {
    try {
      await this.ipcClient.connect();
      const isRunning = this.ipcClient.connected;
      await this.ipcClient.disconnect();
      return isRunning;
    } catch (error) {
      return false;
    }
  }

  /**
   * Format uptime in human-readable format
   * @param {number} seconds Uptime in seconds
   * @returns {string} Formatted uptime
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    const parts = [];
    
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
    
    return parts.join(' ');
  }
}

module.exports = StatusCommand;