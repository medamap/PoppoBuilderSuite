/**
 * Daemon Command
 * デーモンプロセスの管理コマンド
 */

const DaemonManager = require('../daemon/daemon-manager');
const DaemonAPIClient = require('../daemon/api-client');
const i18n = require('../i18n');
const colors = require('colors');

class DaemonCommand {
  constructor() {
    this.daemonManager = new DaemonManager();
    this.apiClient = new DaemonAPIClient();
  }

  /**
   * Execute daemon command
   */
  async execute(action, options = {}) {
    try {
      await i18n.init();
      
      switch (action) {
        case 'start':
          return await this.startDaemon(options);
        case 'stop':
          return await this.stopDaemon(options);
        case 'restart':
          return await this.restartDaemon(options);
        case 'status':
          return await this.showStatus(options);
        case 'reload':
          return await this.reloadConfig(options);
        case 'logs':
          return await this.showLogs(options);
        default:
          throw new Error(`Unknown daemon action: ${action}`);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }, null, 2));
      } else {
        console.error(colors.red(`Error: ${error.message}`));
      }
      process.exit(1);
    }
  }

  /**
   * Start daemon
   */
  async startDaemon(options) {
    // Check if daemon is already running
    if (await this.isDaemonRunning()) {
      const message = 'Daemon is already running';
      if (options.json) {
        console.log(JSON.stringify({ status: 'already_running', message }));
      } else {
        console.log(colors.yellow(message));
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({ status: 'starting', message: 'Starting daemon...' }));
    } else {
      console.log(colors.blue('Starting PoppoBuilder daemon...'));
    }

    try {
      await this.daemonManager.initialize();
      
      // Start daemon in detached mode
      if (options.detach !== false) {
        await this.startDetached(options);
      } else {
        await this.daemonManager.start();
      }

      if (options.json) {
        console.log(JSON.stringify({ 
          status: 'started', 
          message: 'Daemon started successfully' 
        }));
      } else {
        console.log(colors.green('Daemon started successfully'));
        if (options.verbose) {
          await this.showStatus({ brief: true });
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: error.message }));
      } else {
        console.error(colors.red(`Failed to start daemon: ${error.message}`));
      }
      throw error;
    }
  }

  /**
   * Stop daemon
   */
  async stopDaemon(options) {
    if (!(await this.isDaemonRunning())) {
      const message = 'Daemon is not running';
      if (options.json) {
        console.log(JSON.stringify({ status: 'not_running', message }));
      } else {
        console.log(colors.yellow(message));
      }
      return;
    }

    if (options.json) {
      console.log(JSON.stringify({ status: 'stopping', message: 'Stopping daemon...' }));
    } else {
      console.log(colors.blue('Stopping PoppoBuilder daemon...'));
    }

    try {
      await this.apiClient.initialize();
      await this.apiClient.stopDaemon();

      if (options.json) {
        console.log(JSON.stringify({ 
          status: 'stopped', 
          message: 'Daemon stopped successfully' 
        }));
      } else {
        console.log(colors.green('Daemon stopped successfully'));
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: error.message }));
      } else {
        console.error(colors.red(`Failed to stop daemon: ${error.message}`));
      }
      throw error;
    }
  }

  /**
   * Restart daemon
   */
  async restartDaemon(options) {
    if (options.json) {
      console.log(JSON.stringify({ status: 'restarting', message: 'Restarting daemon...' }));
    } else {
      console.log(colors.blue('Restarting PoppoBuilder daemon...'));
    }

    try {
      if (await this.isDaemonRunning()) {
        await this.apiClient.initialize();
        await this.apiClient.restartDaemon();
      } else {
        // If not running, just start it
        await this.startDaemon(options);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify({ 
          status: 'restarted', 
          message: 'Daemon restarted successfully' 
        }));
      } else {
        console.log(colors.green('Daemon restarted successfully'));
        if (options.verbose) {
          await this.showStatus({ brief: true });
        }
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: error.message }));
      } else {
        console.error(colors.red(`Failed to restart daemon: ${error.message}`));
      }
      throw error;
    }
  }

  /**
   * Show daemon status
   */
  async showStatus(options) {
    try {
      const isRunning = await this.isDaemonRunning();
      
      if (!isRunning) {
        const message = 'Daemon is not running';
        if (options.json) {
          console.log(JSON.stringify({ running: false, message }));
        } else {
          console.log(colors.red('❌ ' + message));
        }
        return;
      }

      await this.apiClient.initialize();
      const status = await this.apiClient.getStatus();
      const info = await this.apiClient.getInfo();

      if (options.json) {
        console.log(JSON.stringify({ running: true, status, info }, null, 2));
      } else {
        this.displayStatus(status, info, options);
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ error: error.message }));
      } else {
        console.error(colors.red(`Failed to get status: ${error.message}`));
      }
      throw error;
    }
  }

  /**
   * Reload configuration
   */
  async reloadConfig(options) {
    if (!(await this.isDaemonRunning())) {
      const message = 'Daemon is not running';
      if (options.json) {
        console.log(JSON.stringify({ status: 'not_running', message }));
      } else {
        console.log(colors.yellow(message));
      }
      return;
    }

    try {
      await this.apiClient.initialize();
      await this.apiClient.reloadDaemon();

      if (options.json) {
        console.log(JSON.stringify({ 
          status: 'reloaded', 
          message: 'Configuration reloaded successfully' 
        }));
      } else {
        console.log(colors.green('Configuration reloaded successfully'));
      }
    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({ status: 'error', error: error.message }));
      } else {
        console.error(colors.red(`Failed to reload configuration: ${error.message}`));
      }
      throw error;
    }
  }

  /**
   * Show daemon logs
   */
  async showLogs(options) {
    // This would be implemented to show daemon logs
    // For now, show a placeholder message
    if (options.json) {
      console.log(JSON.stringify({ 
        status: 'not_implemented', 
        message: 'Log viewing will be implemented in a future version' 
      }));
    } else {
      console.log(colors.yellow('Log viewing will be implemented in a future version'));
      console.log(colors.gray('Logs are currently available in ~/.poppobuilder/logs/'));
    }
  }

  /**
   * Display formatted status
   */
  displayStatus(status, info, options) {
    console.log(colors.green('✅ PoppoBuilder Daemon Status'));
    console.log('');
    
    // Basic info
    console.log(colors.bold('Basic Information:'));
    console.log(`  Status: ${colors.green('Running')}`);
    console.log(`  PID: ${colors.cyan(status.pid)}`);
    console.log(`  Version: ${colors.cyan(info.version)}`);
    console.log(`  Uptime: ${this.formatUptime(info.daemon.uptime)}`);
    console.log('');
    
    // Workers
    console.log(colors.bold('Workers:'));
    console.log(`  Total: ${colors.cyan(status.workers.length)}`);
    
    if (!options.brief && status.workers.length > 0) {
      status.workers.forEach(worker => {
        const uptime = this.formatUptime(worker.uptime / 1000);
        const restarts = worker.restarts > 0 ? colors.yellow(`(${worker.restarts} restarts)`) : '';
        console.log(`    Worker ${worker.id}: PID ${colors.cyan(worker.pid)}, uptime ${uptime} ${restarts}`);
      });
    }
    console.log('');
    
    // API Server
    if (status.apiServer) {
      console.log(colors.bold('API Server:'));
      console.log(`  Address: ${colors.cyan(status.apiServer.host + ':' + status.apiServer.port)}`);
      console.log(`  WebSocket: ${status.apiServer.websocket ? colors.green('Enabled') : colors.red('Disabled')}`);
      console.log(`  Connections: ${colors.cyan(status.apiServer.connections)}`);
      console.log('');
    }
    
    // Process Pool (if available)
    if (options.pool || options.verbose) {
      this.displayProcessPoolStatus(options);
    }
  }

  /**
   * Display process pool status
   */
  async displayProcessPoolStatus(options) {
    try {
      const poolStats = await this.apiClient.request('GET', '/api/process-pool/stats');
      const projectUsage = await this.apiClient.request('GET', '/api/process-pool/project-usage');
      
      console.log(colors.bold('Process Pool:'));
      
      if (poolStats.data && poolStats.data.totals) {
        const totals = poolStats.data.totals;
        console.log(`  Total Processes: ${colors.cyan(totals.workers)}`);
        console.log(`  Available: ${colors.green(totals.available)}`);
        console.log(`  Busy: ${colors.yellow(totals.busy)}`);
        console.log(`  Queued Tasks: ${colors.cyan(totals.queued)}`);
        console.log(`  Completed: ${colors.green(totals.completed)}`);
        console.log(`  Failed: ${colors.red(totals.failed)}`);
        if (totals.avgTime > 0) {
          console.log(`  Avg Task Time: ${colors.cyan(totals.avgTime + 'ms')}`);
        }
      }
      
      if (projectUsage.data && Object.keys(projectUsage.data).length > 0) {
        console.log('');
        console.log(colors.bold('Project Usage:'));
        for (const [projectId, usage] of Object.entries(projectUsage.data)) {
          if (typeof usage === 'object') {
            const percent = usage.limit > 0 ? Math.round((usage.used / usage.limit) * 100) : 0;
            const color = percent > 80 ? colors.red : percent > 50 ? colors.yellow : colors.green;
            console.log(`  ${projectId}: ${color(usage.used)}/${usage.limit} (${color(percent + '%')})`);
          } else {
            console.log(`  ${projectId}: ${colors.cyan(usage)}`);
          }
        }
      }
      
      console.log('');
    } catch (error) {
      // Process pool stats might not be available
      if (!options.quiet) {
        console.log(colors.gray('  Process pool information not available'));
        console.log('');
      }
    }
  }

  /**
   * Start daemon in detached mode
   */
  async startDetached(options) {
    const { spawn } = require('child_process');
    const path = require('path');
    
    // Start daemon as a detached child process
    const daemonScript = path.join(__dirname, '..', '..', 'scripts', 'daemon-runner.js');
    
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: 'ignore'
    });
    
    child.unref();
    
    // Wait a bit and check if it started successfully
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    if (!(await this.isDaemonRunning())) {
      throw new Error('Failed to start daemon in detached mode');
    }
  }

  /**
   * Check if daemon is running
   */
  async isDaemonRunning() {
    try {
      return await this.apiClient.isRunning();
    } catch (error) {
      return false;
    }
  }

  /**
   * Format uptime in human readable format
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (days > 0) {
      return `${days}d ${hours}h ${minutes}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
}

module.exports = DaemonCommand;