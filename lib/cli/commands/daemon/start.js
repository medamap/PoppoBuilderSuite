/**
 * Start Command
 * Start the PoppoBuilder daemon process
 */

const { Command } = require('commander');
const IPCClient = require('../../../daemon/ipc/ipc-client');
const DaemonManager = require('../../../daemon/daemon-manager');
const colors = require('@colors/colors');
const ora = require('ora');
const path = require('path');
const fs = require('fs').promises;

class StartCommand {
  constructor() {
    this.ipcClient = new IPCClient();
    this.daemonManager = new DaemonManager();
  }

  /**
   * Create the start command
   * @returns {Command} The start command
   */
  static create() {
    const cmd = new Command('start');
    
    cmd
      .description('Start the PoppoBuilder daemon')
      .option('-f, --foreground', 'Run daemon in foreground (do not detach)')
      .option('-d, --debug', 'Enable debug mode logging')
      .option('--log-level <level>', 'Set log level (error, warn, info, debug)', 'info')
      .option('--config <path>', 'Use custom configuration file')
      .option('--port <port>', 'API server port', parseInt)
      .option('--no-api', 'Disable HTTP API server')
      .option('--json', 'Output in JSON format')
      .action(async (options) => {
        const command = new StartCommand();
        await command.execute(options);
      });

    return cmd;
  }

  /**
   * Execute the start command
   * @param {Object} options Command options
   */
  async execute(options) {
    try {
      // Check if daemon is already running
      if (await this.isDaemonRunning()) {
        const message = 'Daemon is already running';
        
        if (options.json) {
          console.log(JSON.stringify({
            status: 'already_running',
            message
          }));
        } else {
          console.log(colors.yellow(`⚠️  ${message}`));
          
          // Show current status
          const statusInfo = await this.ipcClient.getDaemonStatus();
          console.log(`   PID: ${colors.cyan(statusInfo.pid)}`);
          console.log(`   Uptime: ${colors.cyan(this.formatUptime(statusInfo.uptime))}`);
        }
        
        return;
      }

      // Start the daemon
      if (options.json) {
        console.log(JSON.stringify({
          status: 'starting',
          message: 'Starting PoppoBuilder daemon...'
        }));
        await this.startDaemon(options);
      } else {
        await this.startDaemonWithProgress(options);
      }

    } catch (error) {
      if (options.json) {
        console.log(JSON.stringify({
          status: 'error',
          error: error.message
        }));
      } else {
        console.error(colors.red(`❌ Failed to start daemon: ${error.message}`));
        
        if (options.debug) {
          console.error(colors.gray(error.stack));
        }
      }
      
      process.exit(1);
    }
  }

  /**
   * Start daemon with progress indicator
   * @param {Object} options Command options
   */
  async startDaemonWithProgress(options) {
    const spinner = ora('Starting PoppoBuilder daemon...').start();
    
    try {
      // Initialize daemon manager
      spinner.text = 'Initializing daemon environment...';
      await this.daemonManager.initialize();
      
      // Validate configuration
      if (options.config) {
        spinner.text = 'Validating configuration...';
        await this.validateConfig(options.config);
      }
      
      // Start daemon
      spinner.text = 'Starting daemon process...';
      
      if (options.foreground) {
        // Run in foreground
        spinner.succeed('Starting daemon in foreground mode');
        console.log(colors.gray('Press Ctrl+C to stop'));
        
        await this.daemonManager.start({
          detached: false,
          logLevel: options.logLevel,
          debug: options.debug,
          config: options.config,
          port: options.port,
          noApi: options.noApi
        });
      } else {
        // Start detached
        await this.startDetached(options);
        
        // Verify startup
        spinner.text = 'Verifying daemon startup...';
        await this.verifyStartup();
        
        spinner.succeed('PoppoBuilder daemon started successfully');
        
        // Show post-start information
        await this.showPostStartInfo();
      }
      
    } catch (error) {
      spinner.fail(`Failed to start daemon: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start daemon without progress (for JSON output)
   * @param {Object} options Command options
   */
  async startDaemon(options) {
    await this.daemonManager.initialize();
    
    if (options.config) {
      await this.validateConfig(options.config);
    }
    
    if (options.foreground) {
      await this.daemonManager.start({
        detached: false,
        logLevel: options.logLevel,
        debug: options.debug,
        config: options.config,
        port: options.port,
        noApi: options.noApi
      });
    } else {
      await this.startDetached(options);
      await this.verifyStartup();
    }
    
    console.log(JSON.stringify({
      status: 'started',
      message: 'Daemon started successfully',
      pid: await this.getDaemonPid()
    }));
  }

  /**
   * Start daemon in detached mode
   * @param {Object} options Command options
   */
  async startDetached(options) {
    const { spawn } = require('child_process');
    const daemonScript = path.join(__dirname, '..', '..', '..', '..', 'scripts', 'daemon-runner.js');
    
    // Prepare environment
    const env = { ...process.env };
    
    if (options.debug) {
      env.DEBUG = '*';
    }
    
    if (options.logLevel) {
      env.LOG_LEVEL = options.logLevel;
    }
    
    if (options.config) {
      env.POPPO_CONFIG = options.config;
    }
    
    if (options.port) {
      env.POPPO_API_PORT = options.port;
    }
    
    if (options.noApi) {
      env.POPPO_NO_API = 'true';
    }
    
    // Start daemon as detached process
    const child = spawn(process.execPath, [daemonScript], {
      detached: true,
      stdio: 'ignore',
      env
    });
    
    child.unref();
  }

  /**
   * Verify daemon startup
   */
  async verifyStartup() {
    const maxAttempts = 10;
    const delay = 500;
    
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.isDaemonRunning()) {
        return;
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    throw new Error('Daemon failed to start within expected time');
  }

  /**
   * Show post-start information
   */
  async showPostStartInfo() {
    try {
      await this.ipcClient.connect();
      const status = await this.ipcClient.getDaemonStatus();
      
      console.log('');
      console.log(colors.bold('Daemon Information:'));
      console.log(`  PID: ${colors.cyan(status.pid)}`);
      console.log(`  Socket: ${colors.cyan(this.ipcClient.socketPath)}`);
      
      if (status.apiServer && status.apiServer.enabled) {
        console.log(`  API Server: ${colors.cyan(`http://${status.apiServer.host}:${status.apiServer.port}`)}`);
      }
      
      console.log(`  Log Level: ${colors.cyan(status.logLevel || 'info')}`);
      console.log('');
      console.log(colors.gray('Use "poppo daemon status" to view detailed status'));
      console.log(colors.gray('Use "poppo daemon stop" to stop the daemon'));
      
      await this.ipcClient.disconnect();
    } catch (error) {
      // Not critical if we can't show this info
      console.log(colors.gray('\nUse "poppo daemon status" for more information'));
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
   * Get daemon PID
   * @returns {Promise<number|null>} The daemon PID or null
   */
  async getDaemonPid() {
    try {
      await this.ipcClient.connect();
      const status = await this.ipcClient.getDaemonStatus();
      await this.ipcClient.disconnect();
      return status.pid;
    } catch (error) {
      return null;
    }
  }

  /**
   * Validate configuration file
   * @param {string} configPath Path to configuration file
   */
  async validateConfig(configPath) {
    try {
      const absolutePath = path.resolve(configPath);
      await fs.access(absolutePath, fs.constants.R_OK);
      
      // Try to parse as JSON
      const content = await fs.readFile(absolutePath, 'utf8');
      JSON.parse(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw new Error(`Configuration file not found: ${configPath}`);
      } else if (error instanceof SyntaxError) {
        throw new Error(`Invalid JSON in configuration file: ${error.message}`);
      } else {
        throw error;
      }
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

module.exports = StartCommand;