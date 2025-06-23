/**
 * Stop Command
 * Stop the PoppoBuilder daemon process
 */

const { Command } = require('commander');
const IPCClient = require('../../../daemon/ipc/ipc-client');
const colors = require('@colors/colors');
const ora = require('ora');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

class StopCommand {
  constructor() {
    this.ipcClient = new IPCClient();
  }

  /**
   * Create the stop command
   * @returns {Command} The stop command
   */
  static create() {
    const cmd = new Command('stop');
    
    cmd
      .description('Stop the PoppoBuilder daemon')
      .option('-f, --force', 'Force stop (kill) the daemon')
      .option('--timeout <seconds>', 'Timeout for graceful shutdown', parseInt, 30)
      .option('--no-wait', 'Do not wait for daemon to stop')
      .option('--json', 'Output in JSON format')
      .action(async (options) => {
        const command = new StopCommand();
        await command.execute(options);
      });

    return cmd;
  }

  /**
   * Execute the stop command
   * @param {Object} options Command options
   */
  async execute(options) {
    try {
      // Check if daemon is running
      if (!(await this.isDaemonRunning())) {
        const message = 'Daemon is not running';
        
        if (options.json) {
          console.log(JSON.stringify({
            status: 'not_running',
            message
          }));
        } else {
          console.log(colors.yellow(`⚠️  ${message}`));
        }
        
        return;
      }

      // Stop the daemon
      if (options.json) {
        await this.stopDaemon(options);
      } else {
        await this.stopDaemonWithProgress(options);
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          status: 'error',
          error: error.message
        }));
      } else {
        console.error(colors.red(`❌ Failed to stop daemon: ${error.message}`));
      }
      
      process.exit(1);
    }
  }

  /**
   * Stop daemon with progress indicator
   * @param {Object} options Command options
   */
  async stopDaemonWithProgress(options) {
    const spinner = ora('Stopping PoppoBuilder daemon...').start();
    
    try {
      // Get daemon info before stopping
      await this.ipcClient.connect();
      const status = await this.ipcClient.getDaemonStatus();
      const pid = status.pid;
      
      // Send stop command
      spinner.text = 'Sending stop signal to daemon...';
      
      if (options.force) {
        await this.forceStopDaemon(pid);
        spinner.warn('Daemon was forcefully terminated');
      } else {
        await this.gracefulStopDaemon(options);
        
        if (!options.wait) {
          spinner.succeed('Stop signal sent to daemon');
          console.log(colors.gray('Daemon will stop gracefully in the background'));
        } else {
          // Wait for daemon to stop
          spinner.text = 'Waiting for daemon to stop...';
          const stopped = await this.waitForStop(options.timeout || 30);
          
          if (stopped) {
            spinner.succeed('PoppoBuilder daemon stopped successfully');
          } else {
            spinner.warn('Daemon did not stop within timeout');
            console.log(colors.gray('Use --force to forcefully terminate the daemon'));
          }
        }
      }
      
      // Clean up resources
      await this.cleanupResources();
      
    } catch (error) {
      spinner.fail(`Failed to stop daemon: ${error.message}`);
      throw error;
    } finally {
      try {
        await this.ipcClient.disconnect();
      } catch (err) {
        // Ignore disconnect errors
      }
    }
  }

  /**
   * Stop daemon without progress (for JSON output)
   * @param {Object} options Command options
   */
  async stopDaemon(options) {
    await this.ipcClient.connect();
    const status = await this.ipcClient.getDaemonStatus();
    const pid = status.pid;
    
    if (options.force) {
      await this.forceStopDaemon(pid);
      console.log(JSON.stringify({
        status: 'stopped',
        message: 'Daemon was forcefully terminated',
        pid
      }));
    } else {
      await this.gracefulStopDaemon(options);
      
      if (!options.wait) {
        console.log(JSON.stringify({
          status: 'stopping',
          message: 'Stop signal sent to daemon',
          pid
        }));
      } else {
        const stopped = await this.waitForStop(options.timeout || 30);
        
        console.log(JSON.stringify({
          status: stopped ? 'stopped' : 'timeout',
          message: stopped ? 'Daemon stopped successfully' : 'Daemon did not stop within timeout',
          pid
        }));
      }
    }
    
    await this.ipcClient.disconnect();
    await this.cleanupResources();
  }

  /**
   * Gracefully stop the daemon
   * @param {Object} options Command options
   */
  async gracefulStopDaemon(options) {
    try {
      // Send stop command via IPC
      await this.ipcClient.sendCommand('daemon.stop', {
        graceful: true,
        timeout: options.timeout
      });
    } catch (error) {
      // If IPC fails, try sending SIGTERM directly
      const status = await this.ipcClient.getDaemonStatus();
      if (status && status.pid) {
        try {
          process.kill(status.pid, 'SIGTERM');
        } catch (killError) {
          if (killError.code !== 'ESRCH') {
            throw killError;
          }
        }
      }
    }
  }

  /**
   * Force stop the daemon
   * @param {number} pid Process ID
   */
  async forceStopDaemon(pid) {
    try {
      // First try SIGTERM
      process.kill(pid, 'SIGTERM');
      
      // Wait a short time
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Then force with SIGKILL if still running
      if (this.isProcessRunning(pid)) {
        process.kill(pid, 'SIGKILL');
      }
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
      // Process already dead
    }
  }

  /**
   * Wait for daemon to stop
   * @param {number} timeout Timeout in seconds
   * @returns {Promise<boolean>} True if stopped, false if timeout
   */
  async waitForStop(timeout) {
    const startTime = Date.now();
    const timeoutMs = timeout * 1000;
    
    while (Date.now() - startTime < timeoutMs) {
      if (!(await this.isDaemonRunning())) {
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    return false;
  }

  /**
   * Clean up daemon resources
   */
  async cleanupResources() {
    try {
      // Clean up socket file on Unix systems
      if (process.platform !== 'win32') {
        const socketPath = this.ipcClient.socketPath;
        const fs = require('fs').promises;
        
        try {
          await fs.unlink(socketPath);
        } catch (error) {
          // Ignore if file doesn't exist
          if (error.code !== 'ENOENT') {
            console.warn(colors.yellow(`Warning: Could not remove socket file: ${error.message}`));
          }
        }
      }
      
      // Clean up PID file if exists
      const pidFile = require('path').join(
        require('os').homedir(),
        '.poppobuilder',
        'daemon.pid'
      );
      
      try {
        await require('fs').promises.unlink(pidFile);
      } catch (error) {
        // Ignore if file doesn't exist
      }
      
    } catch (error) {
      // Non-critical errors
      console.warn(colors.yellow(`Warning: Error during cleanup: ${error.message}`));
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
   * Check if process is running
   * @param {number} pid Process ID
   * @returns {boolean} True if process is running
   */
  isProcessRunning(pid) {
    try {
      // Signal 0 is used to check if process exists
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }
}

module.exports = StopCommand;