/**
 * Restart Command
 * Restart the PoppoBuilder daemon process
 */

const { Command } = require('commander');
const IPCClient = require('../../../daemon/ipc/ipc-client');
const StartCommand = require('./start');
const StopCommand = require('./stop');
const colors = require('@colors/colors');
const ora = require('ora');

class RestartCommand {
  constructor() {
    this.ipcClient = new IPCClient();
    this.startCommand = new StartCommand();
    this.stopCommand = new StopCommand();
  }

  /**
   * Create the restart command
   * @returns {Command} The restart command
   */
  static create() {
    const cmd = new Command('restart');
    
    cmd
      .description('Restart the PoppoBuilder daemon')
      .option('-g, --graceful', 'Perform graceful restart (wait for tasks to complete)')
      .option('-f, --force', 'Force restart without waiting')
      .option('--timeout <seconds>', 'Timeout for graceful restart', parseInt, 30)
      .option('--preserve-queue', 'Preserve task queue during restart')
      .option('--debug', 'Enable debug mode after restart')
      .option('--log-level <level>', 'Set log level after restart')
      .option('--config <path>', 'Use custom configuration file after restart')
      .option('--json', 'Output in JSON format')
      .action(async (options) => {
        const command = new RestartCommand();
        await command.execute(options);
      });

    return cmd;
  }

  /**
   * Execute the restart command
   * @param {Object} options Command options
   */
  async execute(options) {
    try {
      const wasRunning = await this.isDaemonRunning();
      
      if (!wasRunning && !options.force) {
        // Daemon not running, just start it
        if (options.json) {
          console.log(JSON.stringify({
            status: 'starting',
            message: 'Daemon not running, starting it...'
          }));
        } else {
          console.log(colors.yellow('⚠️  Daemon is not running, starting it...'));
        }
        
        await this.startCommand.execute({
          ...options,
          foreground: false
        });
        return;
      }

      // Perform restart
      if (options.json) {
        await this.restartDaemon(options);
      } else {
        await this.restartDaemonWithProgress(options);
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          status: 'error',
          error: error.message
        }));
      } else {
        console.error(colors.red(`❌ Failed to restart daemon: ${error.message}`));
      }
      
      process.exit(1);
    }
  }

  /**
   * Restart daemon with progress indicator
   * @param {Object} options Command options
   */
  async restartDaemonWithProgress(options) {
    const spinner = ora('Restarting PoppoBuilder daemon...').start();
    
    try {
      // Save current state if needed
      let savedState = null;
      if (options.preserveQueue) {
        spinner.text = 'Saving queue state...';
        savedState = await this.saveQueueState();
      }
      
      // Check if we can do in-place restart
      if (options.graceful && await this.canInPlaceRestart()) {
        spinner.text = 'Performing graceful in-place restart...';
        await this.inPlaceRestart(options);
        spinner.succeed('PoppoBuilder daemon restarted successfully (in-place)');
      } else {
        // Stop daemon
        spinner.text = 'Stopping daemon...';
        await this.stopDaemon(options);
        
        // Wait a moment to ensure clean shutdown
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Start daemon
        spinner.text = 'Starting daemon...';
        await this.startDaemon(options);
        
        // Restore queue state if saved
        if (savedState) {
          spinner.text = 'Restoring queue state...';
          await this.restoreQueueState(savedState);
        }
        
        spinner.succeed('PoppoBuilder daemon restarted successfully');
      }
      
      // Show new status
      if (!options.quiet) {
        console.log('');
        await this.showNewStatus();
      }
      
    } catch (error) {
      spinner.fail(`Failed to restart daemon: ${error.message}`);
      throw error;
    }
  }

  /**
   * Restart daemon without progress (for JSON output)
   * @param {Object} options Command options
   */
  async restartDaemon(options) {
    let savedState = null;
    
    const steps = [];
    
    if (options.preserveQueue) {
      savedState = await this.saveQueueState();
      steps.push({ step: 'save_queue', status: 'completed' });
    }
    
    if (options.graceful && await this.canInPlaceRestart()) {
      await this.inPlaceRestart(options);
      steps.push({ step: 'in_place_restart', status: 'completed' });
    } else {
      await this.stopDaemon(options);
      steps.push({ step: 'stop', status: 'completed' });
      
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      await this.startDaemon(options);
      steps.push({ step: 'start', status: 'completed' });
      
      if (savedState) {
        await this.restoreQueueState(savedState);
        steps.push({ step: 'restore_queue', status: 'completed' });
      }
    }
    
    const newStatus = await this.getDaemonStatus();
    
    console.log(JSON.stringify({
      status: 'restarted',
      message: 'Daemon restarted successfully',
      pid: newStatus.pid,
      steps
    }));
  }

  /**
   * Check if in-place restart is possible
   * @returns {Promise<boolean>} True if in-place restart is supported
   */
  async canInPlaceRestart() {
    try {
      await this.ipcClient.connect();
      const capabilities = await this.ipcClient.sendCommand('daemon.capabilities');
      await this.ipcClient.disconnect();
      
      return capabilities && capabilities.includes('in-place-restart');
    } catch (error) {
      return false;
    }
  }

  /**
   * Perform in-place restart
   * @param {Object} options Command options
   */
  async inPlaceRestart(options) {
    await this.ipcClient.connect();
    
    try {
      await this.ipcClient.sendCommand('daemon.restart', {
        graceful: options.graceful,
        timeout: options.timeout,
        config: options.config,
        logLevel: options.logLevel,
        debug: options.debug
      });
      
      // Wait for restart to complete
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } finally {
      await this.ipcClient.disconnect();
    }
  }

  /**
   * Stop the daemon
   * @param {Object} options Command options
   */
  async stopDaemon(options) {
    const stopOptions = {
      force: options.force,
      timeout: options.timeout,
      wait: true,
      json: false
    };
    
    await this.stopCommand.execute(stopOptions);
  }

  /**
   * Start the daemon
   * @param {Object} options Command options
   */
  async startDaemon(options) {
    const startOptions = {
      foreground: false,
      debug: options.debug,
      logLevel: options.logLevel,
      config: options.config,
      json: false
    };
    
    await this.startCommand.execute(startOptions);
  }

  /**
   * Save queue state before restart
   * @returns {Promise<Object>} Saved queue state
   */
  async saveQueueState() {
    try {
      await this.ipcClient.connect();
      const state = await this.ipcClient.sendCommand('queue.export');
      await this.ipcClient.disconnect();
      
      return state;
    } catch (error) {
      console.warn(colors.yellow('Warning: Could not save queue state'));
      return null;
    }
  }

  /**
   * Restore queue state after restart
   * @param {Object} state Saved queue state
   */
  async restoreQueueState(state) {
    if (!state) return;
    
    try {
      // Wait for daemon to be fully ready
      await this.waitForDaemonReady();
      
      await this.ipcClient.connect();
      await this.ipcClient.sendCommand('queue.import', { state });
      await this.ipcClient.disconnect();
    } catch (error) {
      console.warn(colors.yellow(`Warning: Could not restore queue state: ${error.message}`));
    }
  }

  /**
   * Wait for daemon to be ready
   */
  async waitForDaemonReady() {
    const maxAttempts = 20;
    const delay = 500;
    
    for (let i = 0; i < maxAttempts; i++) {
      try {
        await this.ipcClient.connect();
        const health = await this.ipcClient.sendCommand('health.status');
        await this.ipcClient.disconnect();
        
        if (health.daemon && health.daemon.healthy) {
          return;
        }
      } catch (error) {
        // Not ready yet
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    throw new Error('Daemon did not become ready in time');
  }

  /**
   * Show new daemon status after restart
   */
  async showNewStatus() {
    try {
      await this.ipcClient.connect();
      const status = await this.ipcClient.getDaemonStatus();
      await this.ipcClient.disconnect();
      
      console.log(colors.bold('New Daemon Status:'));
      console.log(`  PID: ${colors.cyan(status.pid)}`);
      console.log(`  Version: ${colors.cyan(status.version)}`);
      console.log(`  Status: ${colors.green('Running')}`);
      
      if (status.apiServer) {
        console.log(`  API Server: ${colors.cyan(`${status.apiServer.host}:${status.apiServer.port}`)}`);
      }
    } catch (error) {
      // Not critical
    }
  }

  /**
   * Get daemon status
   * @returns {Promise<Object>} Daemon status
   */
  async getDaemonStatus() {
    await this.ipcClient.connect();
    const status = await this.ipcClient.getDaemonStatus();
    await this.ipcClient.disconnect();
    return status;
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
}

module.exports = RestartCommand;