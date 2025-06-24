/**
 * Stop Command
 * Stops PoppoBuilder daemon
 */

const chalk = require('chalk');
const { IPCClient } = require('../daemon/ipc');
const DaemonState = require('../daemon/daemon-state');
const { execSync } = require('child_process');

/**
 * Stop the PoppoBuilder service
 */
async function stopService(options) {
  try {
    console.log(chalk.blue('🛑 Stopping PoppoBuilder Daemon...'));
    
    // Check if daemon is running
    const existingState = await DaemonState.checkExisting();
    if (!existingState) {
      console.log(chalk.yellow('ℹ️  Daemon is not running'));
      return;
    }
    
    const pid = existingState.pid;
    console.log(chalk.white(`   Found daemon PID: ${pid}`));
    
    // Try graceful shutdown first
    try {
      const ipcClient = new IPCClient();
      await ipcClient.connect();
      await ipcClient.sendCommand('shutdown');
      await ipcClient.disconnect();
      
      console.log(chalk.green('✅ Sent shutdown command to daemon'));
      
      // Wait for graceful shutdown
      let retries = 10;
      while (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        try {
          process.kill(pid, 0); // Check if process exists
          retries--;
        } catch {
          // Process no longer exists
          break;
        }
      }
      
      if (retries === 0 && options.force) {
        console.log(chalk.yellow('⚠️  Graceful shutdown timeout, forcing...'));
        process.kill(pid, 'SIGKILL');
      }
      
    } catch (error) {
      if (options.force) {
        console.log(chalk.yellow('⚠️  Failed to connect to daemon, forcing shutdown...'));
        try {
          process.kill(pid, 'SIGTERM');
          await new Promise(resolve => setTimeout(resolve, 1000));
          process.kill(pid, 'SIGKILL');
        } catch (killError) {
          console.error(chalk.red('❌ Failed to kill process:'), killError.message);
        }
      } else {
        console.error(chalk.red('❌ Failed to stop daemon gracefully:'), error.message);
        console.log(chalk.white('   Use --force to force stop'));
        process.exit(1);
      }
    }
    
    // Clean up PID file
    await DaemonState.cleanup();
    
    console.log(chalk.green('✅ PoppoBuilder Daemon stopped'));
    
  } catch (error) {
    console.error(chalk.red('❌ Error stopping daemon:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

module.exports = {
  stopService
};