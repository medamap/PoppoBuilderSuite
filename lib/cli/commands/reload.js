/**
 * PoppoBuilder Reload Command
 * 
 * Reloads configuration without restarting the daemon
 */

const chalk = require('chalk');
const { IPCClient } = require('../../daemon/ipc');
const DaemonState = require('../../daemon/daemon-state');

/**
 * Handle reload command
 */
async function handleReload(options) {
  try {
    console.log(chalk.blue('🔄 Reloading PoppoBuilder configuration...'));
    
    // Check if daemon is running
    const existingState = await DaemonState.checkExisting();
    if (!existingState) {
      console.error(chalk.red('❌ Daemon is not running'));
      console.log(chalk.white('Use `poppobuilder start` to start the daemon first'));
      process.exit(1);
    }
    
    console.log(chalk.white(`Found daemon (PID: ${existingState.pid})`));
    
    // Send reload command via IPC
    try {
      const ipcClient = new IPCClient();
      await ipcClient.connect();
      
      console.log(chalk.blue('📨 Sending reload signal...'));
      const response = await ipcClient.sendCommand('reload');
      
      await ipcClient.disconnect();
      
      if (response.success) {
        console.log(chalk.green('✅ Configuration reloaded successfully'));
        
        if (response.changes) {
          console.log(chalk.white('\\n📝 Changes applied:'));
          for (const change of response.changes) {
            console.log(chalk.gray(`  • ${change}`));
          }
        }
        
        if (response.warnings && response.warnings.length > 0) {
          console.log(chalk.yellow('\\n⚠️  Warnings:'));
          for (const warning of response.warnings) {
            console.log(chalk.yellow(`  • ${warning}`));
          }
        }
        
        if (response.restartRequired) {
          console.log(chalk.yellow('\\n🔄 Some changes require a restart to take effect'));
          console.log(chalk.white('Use `poppobuilder restart` to apply all changes'));
        }
        
      } else {
        throw new Error(response.error || 'Reload command failed');
      }
      
    } catch (error) {
      console.error(chalk.red('❌ Failed to reload configuration:'), error.message);
      console.log(chalk.white('\\nTroubleshooting:'));
      console.log(chalk.white('  • Check that the daemon is responsive'));
      console.log(chalk.white('  • Verify configuration file syntax'));
      console.log(chalk.white('  • Try `poppobuilder restart` if reload fails'));
      throw error;
    }
    
  } catch (error) {
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

module.exports = { handleReload };