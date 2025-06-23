/**
 * PoppoBuilder Stop Command
 * 
 * Stops the global PoppoBuilder daemon
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs').promises;
const chalk = require('chalk');
const { IPCClient } = require('../../daemon/ipc');
const DaemonState = require('../../daemon/daemon-state');

/**
 * Handle stop command
 */
async function handleStop(options) {
  try {
    console.log(chalk.blue('🛑 Stopping PoppoBuilder Daemon...'));
    
    // Check if daemon is running
    const existingState = await DaemonState.checkExisting();
    if (!existingState) {
      console.log(chalk.yellow('Daemon is not running'));
      return;
    }
    
    console.log(chalk.white(`Found daemon (PID: ${existingState.pid})`));
    
    if (options.force) {
      // Force kill the daemon
      await forceStop(existingState.pid);
    } else {
      // Graceful shutdown via IPC
      await gracefulStop();
    }
    
    // Verify daemon has stopped
    await verifyStop();
    
    console.log(chalk.green('✅ Daemon stopped successfully'));
    
    // Stop agent tmux sessions (default true, unless --no-agents flag is provided)
    if (options.withAgents !== false) {
      console.log(chalk.blue('\n🛑 Stopping agent tmux sessions...'));
      await stopAgentSessions();
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to stop daemon:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Graceful shutdown via IPC
 */
async function gracefulStop() {
  try {
    console.log(chalk.blue('📨 Sending shutdown signal...'));
    
    const ipcClient = new IPCClient();
    await ipcClient.connect();
    
    // Send shutdown command
    const response = await ipcClient.sendCommand('shutdown', {
      graceful: true,
      timeout: 30000
    });
    
    await ipcClient.disconnect();
    
    if (response.success) {
      console.log(chalk.gray('  Graceful shutdown initiated'));
      
      // Wait for daemon to stop
      let attempts = 0;
      const maxAttempts = 30; // 30 seconds
      
      while (attempts < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const state = await DaemonState.checkExisting();
        if (!state) {
          break;
        }
        
        attempts++;
        if (attempts % 5 === 0) {
          console.log(chalk.gray(`  Waiting for shutdown... (${attempts}s)`));
        }
      }
      
      if (attempts >= maxAttempts) {
        console.log(chalk.yellow('⚠️  Graceful shutdown timed out, forcing stop...'));
        const state = await DaemonState.checkExisting();
        if (state) {
          await forceStop(state.pid);
        }
      }
      
    } else {
      throw new Error(response.error || 'Shutdown command failed');
    }
    
  } catch (error) {
    console.log(chalk.yellow(`⚠️  IPC communication failed: ${error.message}`));
    console.log(chalk.yellow('Attempting force stop...'));
    
    const state = await DaemonState.checkExisting();
    if (state) {
      await forceStop(state.pid);
    }
  }
}

/**
 * Force stop daemon process
 */
async function forceStop(pid) {
  console.log(chalk.blue(`🔧 Force stopping daemon (PID: ${pid})...`));
  
  try {
    // Try SIGTERM first
    process.kill(pid, 'SIGTERM');
    
    // Wait a moment for graceful shutdown
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Check if still running
    try {
      process.kill(pid, 0); // Check if process exists
      
      // Still running, use SIGKILL
      console.log(chalk.yellow('  Process still running, using SIGKILL...'));
      process.kill(pid, 'SIGKILL');
      
      // Wait a moment more
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      // Process no longer exists (good)
    }
    
  } catch (error) {
    if (error.code === 'ESRCH') {
      // Process doesn't exist
      console.log(chalk.gray('  Process already stopped'));
    } else {
      throw new Error(`Failed to kill process: ${error.message}`);
    }
  }
}

/**
 * Verify daemon has stopped
 */
async function verifyStop() {
  const state = await DaemonState.checkExisting();
  if (state) {
    // Clean up stale state file
    try {
      await DaemonState.cleanup();
      console.log(chalk.gray('  Cleaned up stale state file'));
    } catch (error) {
      console.log(chalk.yellow(`  Warning: Could not clean up state file: ${error.message}`));
    }
  }
}

/**
 * Stop agent tmux sessions
 */
async function stopAgentSessions() {
  try {
    // Try multiple paths to find the tmux manager script
    const possiblePaths = [
      // Development path
      path.join(__dirname, '../../../scripts/poppo-tmux-manager.sh'),
      // Global install path (npm)
      path.join(__dirname, '../../../../poppo-builder-suite/scripts/poppo-tmux-manager.sh'),
      // Direct path (fallback)
      '/Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite/scripts/poppo-tmux-manager.sh'
    ];
    
    let tmuxManagerScript = null;
    for (const scriptPath of possiblePaths) {
      try {
        await fs.access(scriptPath);
        tmuxManagerScript = scriptPath;
        break;
      } catch {
        // Continue to next path
      }
    }
    
    if (!tmuxManagerScript) {
      console.log(chalk.yellow('⚠️  tmux manager script not found'));
      return;
    }
    
    // Check if tmux is available
    try {
      execSync('which tmux', { stdio: 'pipe' });
    } catch {
      console.log(chalk.yellow('⚠️  tmux is not installed'));
      return;
    }
    
    // Stop tmux sessions
    execSync(`bash ${tmuxManagerScript} stop`, { stdio: 'inherit' });
    
    console.log(chalk.green('✅ Agent sessions stopped'));
    
  } catch (error) {
    console.log(chalk.yellow('⚠️  Failed to stop agent sessions:'), error.message);
  }
}

module.exports = { handleStop };