/**
 * PoppoBuilder Start Command
 * 
 * Starts the global PoppoBuilder daemon
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const chalk = require('chalk');
const { IPCClient } = require('../../daemon/ipc');
const DaemonState = require('../../daemon/daemon-state');

/**
 * Handle start command
 */
async function handleStart(options) {
  try {
    console.log(chalk.blue('🚀 Starting PoppoBuilder Daemon...'));
    
    // Check if daemon is already running
    const existingState = await DaemonState.checkExisting();
    if (existingState) {
      console.log(chalk.yellow(`Daemon is already running (PID: ${existingState.pid})`));
      
      // Try to connect to verify it's responsive
      try {
        const ipcClient = new IPCClient();
        await ipcClient.connect();
        const status = await ipcClient.sendCommand('status');
        await ipcClient.disconnect();
        
        console.log(chalk.green(`✅ Daemon is healthy and responsive`));
        console.log(chalk.white(`   Status: ${status.daemon?.status || status.status || 'running'}`));
        console.log(chalk.white(`   Uptime: ${status.daemon?.uptime ? Math.round(status.daemon.uptime / 1000) + 's' : 'N/A'}`));
        console.log(chalk.white(`   Projects: ${status.projects?.length || Object.keys(status.projects || {}).length || 0}`));
        process.exit(0); // 明示的に終了
        
      } catch (error) {
        console.log(chalk.yellow('⚠️  Daemon PID exists but not responsive. Starting new instance...'));
      }
    }
    
    // Verify global configuration exists
    const globalConfigDir = path.join(os.homedir(), '.poppobuilder');
    const configFile = path.join(globalConfigDir, 'config.json');
    
    if (!await fileExists(configFile)) {
      console.error(chalk.red('❌ Global configuration not found'));
      console.log(chalk.white('Run `poppobuilder init` first to set up the global configuration.'));
      process.exit(1);
    }
    
    // Load configuration
    const config = await loadConfiguration(configFile);
    
    // Determine daemon script path
    const daemonScript = path.join(__dirname, '../../daemon/poppo-daemon.js');
    
    if (!await fileExists(daemonScript)) {
      console.error(chalk.red(`❌ Daemon script not found: ${daemonScript}`));
      process.exit(1);
    }
    
    // Start daemon
    if (options.detach) {
      await startDetached(daemonScript, config, options);
    } else {
      await startForeground(daemonScript, config, options);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to start daemon:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Start daemon in detached mode (background)
 */
async function startDetached(daemonScript, config, options) {
  console.log(chalk.blue('📦 Starting daemon in background...'));
  
  // Prepare environment
  const env = {
    ...process.env,
    POPPO_DAEMON_PORT: options.port || config.daemon?.port || '3003',
    POPPO_DAEMON_HOST: options.host || config.daemon?.host || '127.0.0.1',
    NODE_ENV: process.env.NODE_ENV || 'production'
  };
  
  // Set up logging
  const logDir = path.join(os.homedir(), '.poppobuilder', 'logs');
  await fs.mkdir(logDir, { recursive: true });
  
  const logFile = path.join(logDir, 'daemon.log');
  const errorFile = path.join(logDir, 'daemon.error.log');
  
  const logStream = await fs.open(logFile, 'a');
  const errorStream = await fs.open(errorFile, 'a');
  
  // Start daemon process
  const daemonProcess = spawn(process.execPath, [daemonScript], {
    detached: true,
    stdio: ['ignore', logStream.fd, errorStream.fd],
    env,
    cwd: process.cwd()
  });
  
  // Detach from parent
  daemonProcess.unref();
  
  // Wait a moment to see if it starts successfully
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Check if daemon started successfully
  const startedState = await DaemonState.checkExisting();
  if (startedState) {
    console.log(chalk.green('✅ Daemon started successfully'));
    console.log(chalk.white(`   PID: ${startedState.pid}`));
    console.log(chalk.white(`   Port: ${env.POPPO_DAEMON_PORT}`));
    console.log(chalk.white(`   Logs: ${logFile}`));
    
    // Try to connect and get status
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const ipcClient = new IPCClient();
      await ipcClient.connect();
      const status = await ipcClient.sendCommand('status');
      await ipcClient.disconnect();
      
      console.log(chalk.white(`   Projects: ${Object.keys(status.projects || {}).length}`));
      console.log(chalk.white(`   Workers: ${status.workers?.totalWorkers || 0}`));
      
    } catch (error) {
      console.log(chalk.yellow('⚠️  Daemon started but not yet ready for connections'));
    }
    
  } else {
    console.error(chalk.red('❌ Daemon failed to start'));
    console.log(chalk.white(`Check logs: ${errorFile}`));
    process.exit(1);
  }
  
  await logStream.close();
  await errorStream.close();
}

/**
 * Start daemon in foreground mode
 */
async function startForeground(daemonScript, config, options) {
  console.log(chalk.blue('🖥️  Starting daemon in foreground...'));
  console.log(chalk.gray('Press Ctrl+C to stop\\n'));
  
  // Prepare environment
  const env = {
    ...process.env,
    POPPO_DAEMON_PORT: options.port || config.daemon?.port || '3003',
    POPPO_DAEMON_HOST: options.host || config.daemon?.host || '127.0.0.1',
    NODE_ENV: process.env.NODE_ENV || 'development'
  };
  
  // Start daemon process
  const daemonProcess = spawn(process.execPath, [daemonScript], {
    stdio: 'inherit',
    env,
    cwd: process.cwd()
  });
  
  // Handle process events
  daemonProcess.on('close', (code) => {
    if (code === 0) {
      console.log(chalk.green('\\n✅ Daemon stopped gracefully'));
    } else {
      console.log(chalk.red(`\\n❌ Daemon exited with code ${code}`));
      process.exit(code);
    }
  });
  
  daemonProcess.on('error', (error) => {
    console.error(chalk.red('❌ Daemon process error:'), error.message);
    process.exit(1);
  });
  
  // Handle signals
  const signals = ['SIGINT', 'SIGTERM'];
  signals.forEach(signal => {
    process.on(signal, () => {
      console.log(chalk.blue(`\\n🛑 Received ${signal}, stopping daemon...`));
      daemonProcess.kill(signal);
    });
  });
  
  // Wait for daemon process to complete
  return new Promise((resolve, reject) => {
    daemonProcess.on('close', resolve);
    daemonProcess.on('error', reject);
  });
}

/**
 * Load configuration from file
 */
async function loadConfiguration(configFile) {
  try {
    const configContent = await fs.readFile(configFile, 'utf8');
    return JSON.parse(configContent);
  } catch (error) {
    throw new Error(`Failed to load configuration: ${error.message}`);
  }
}

/**
 * Check if file exists
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

module.exports = { handleStart };