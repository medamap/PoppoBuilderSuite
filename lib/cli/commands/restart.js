/**
 * PoppoBuilder Restart Command
 * 
 * Restarts the global PoppoBuilder daemon
 */

const chalk = require('chalk');
const { handleStop } = require('./stop');
const { handleStart } = require('./start');

/**
 * Handle restart command
 */
async function handleRestart(options) {
  try {
    console.log(chalk.blue('🔄 Restarting PoppoBuilder Daemon...'));
    
    // Stop the daemon first
    console.log(chalk.blue('1️⃣  Stopping daemon...'));
    await handleStop({ 
      force: options.force,
      verbose: options.verbose 
    });
    
    // Wait a moment before starting
    console.log(chalk.blue('⏳ Waiting before restart...'));
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Start the daemon again
    console.log(chalk.blue('2️⃣  Starting daemon...'));
    await handleStart({ 
      detach: true,
      verbose: options.verbose 
    });
    
    console.log(chalk.green('✅ Daemon restarted successfully'));
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to restart daemon:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

module.exports = { handleRestart };