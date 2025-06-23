/**
 * PoppoBuilder Status Command
 * 
 * Shows daemon and project status information
 */

const chalk = require('chalk');
const { IPCClient } = require('../../daemon/ipc');
const DaemonState = require('../../daemon/daemon-state');
const { execSync } = require('child_process');

/**
 * Handle status command
 */
async function handleStatus(options) {
  try {
    if (options.watch) {
      await watchStatus(options);
    } else {
      await showStatus(options);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Failed to get status:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Show current status
 */
async function showStatus(options) {
  // Check if daemon is running
  const existingState = await DaemonState.checkExisting();
  if (!existingState) {
    const status = {
      daemon: {
        status: 'stopped',
        pid: null,
        uptime: 0
      },
      projects: {},
      workers: { totalWorkers: 0 },
      queue: { totalTasks: 0 }
    };
    
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
    } else {
      console.log(chalk.red('❌ Daemon is not running'));
      console.log(chalk.white('Use `poppobuilder start` to start the daemon'));
    }
    process.exit(0);
  }
  
  // Try to get detailed status via IPC
  let status;
  try {
    const ipcClient = new IPCClient();
    await ipcClient.connect();
    status = await ipcClient.sendCommand('status');
    await ipcClient.disconnect();
    
  } catch (error) {
    // Debug error
    if (process.env.DEBUG) {
      console.error('Status command error:', error);
    }
    
    // Daemon exists but not responsive
    status = {
      daemon: {
        status: 'unresponsive',
        pid: existingState.pid,
        error: error.message
      },
      projects: {},
      workers: { totalWorkers: 0 },
      queue: { totalTasks: 0 }
    };
  }
  
  if (options.json) {
    console.log(JSON.stringify(status, null, 2));
    process.exit(0);
  }
  
  // Display formatted status
  displayStatus(status);
  process.exit(0);
}

/**
 * Watch status with updates
 */
async function watchStatus(options) {
  console.log(chalk.blue('👁️  Watching PoppoBuilder status (Press Ctrl+C to exit)...\\n'));
  
  const updateInterval = 2000; // 2 seconds
  
  const update = async () => {
    // Clear screen
    process.stdout.write('\\x1Bc');
    
    console.log(chalk.blue('👁️  PoppoBuilder Status (Live)'));
    console.log(chalk.gray(`Updated: ${new Date().toLocaleTimeString()}\\n`));
    
    await showStatus({ ...options, json: false });
    
    console.log(chalk.gray('\\nPress Ctrl+C to exit'));
  };
  
  // Initial update
  await update();
  
  // Set up interval
  const interval = setInterval(update, updateInterval);
  
  // Handle Ctrl+C
  process.on('SIGINT', () => {
    clearInterval(interval);
    console.log(chalk.blue('\\n👋 Status monitoring stopped'));
    process.exit(0);
  });
}

/**
 * Display formatted status
 */
function displayStatus(status) {
  // Daemon status
  console.log(chalk.blue('🤖 Daemon Status:'));
  
  const daemonStatus = status.daemon?.status || 'unknown';
  const statusColor = {
    'running': 'green',
    'stopped': 'red',
    'starting': 'yellow',
    'stopping': 'yellow',
    'unresponsive': 'red',
    'unknown': 'gray'
  }[daemonStatus] || 'gray';
  
  console.log(chalk.white(`   Status: ${chalk[statusColor](daemonStatus)}`));
  
  if (status.daemon?.pid) {
    console.log(chalk.white(`   PID: ${status.daemon.pid}`));
  }
  
  if (status.daemon?.uptime !== undefined) {
    const uptimeSeconds = Math.floor(status.daemon.uptime);
    const uptime = formatUptime(uptimeSeconds);
    console.log(chalk.white(`   Uptime: ${uptime}`));
  }
  
  if (status.daemon?.error) {
    console.log(chalk.red(`   Error: ${status.daemon.error}`));
  }
  
  console.log();
  
  // Projects status
  const projects = status.projects || {};
  const projectList = Object.entries(projects);
  
  console.log(chalk.blue(`📦 Projects (${projectList.length}):`));
  
  if (projectList.length === 0) {
    console.log(chalk.gray('   No projects registered'));
    console.log(chalk.gray('   Use `poppobuilder register` to add projects'));
  } else {
    for (const [id, project] of projectList) {
      const enabled = project.enabled ? chalk.green('✓') : chalk.red('✗');
      const priority = project.priority || 50;
      const status = project.status || 'idle';
      
      const shortId = id.length > 8 ? id.substring(0, 8) : id;
      console.log(chalk.white(`   ${enabled} ${project.name || id} (${shortId})`));
      console.log(chalk.gray(`     Status: ${status}  Priority: ${priority}  Weight: ${project.weight || 1.0}`));
      
      if (project.lastActivity) {
        const lastActivity = new Date(project.lastActivity).toLocaleString();
        console.log(chalk.gray(`     Last activity: ${lastActivity}`));
      }
    }
  }
  
  console.log();
  
  // Workers status
  const workers = status.workers || {};
  console.log(chalk.blue('👷 Workers:'));
  console.log(chalk.white(`   Total: ${workers.total || 0}`));
  console.log(chalk.white(`   Active: ${workers.active || 0}`));
  console.log(chalk.white(`   Idle: ${workers.idle || 0}`));
  
  const workerList = Array.isArray(workers.workers) ? workers.workers : 
                     (workers.workers && typeof workers.workers === 'object' ? Object.values(workers.workers) : []);
  
  if (workerList.length > 0) {
    console.log(chalk.gray('   Worker details:'));
    for (const worker of workerList.slice(0, 5)) { // Show first 5
      const status = worker.state || worker.status || 'unknown';
      const task = worker.currentTask ? ` (${worker.currentTask})` : '';
      const shortId = worker.id.length > 8 ? worker.id.substring(0, 8) : worker.id;
      console.log(chalk.gray(`     ${shortId}: ${status}${task}`));
    }
    
    if (workerList.length > 5) {
      console.log(chalk.gray(`     ... and ${workerList.length - 5} more`));
    }
  }
  
  console.log();
  
  // Queue status
  const queue = status.queue || {};
  console.log(chalk.blue('📋 Task Queue:'));
  console.log(chalk.white(`   Total tasks: ${queue.total || 0}`));
  console.log(chalk.white(`   Pending: ${queue.pending || 0}`));
  console.log(chalk.white(`   Running: ${queue.running || 0}`));
  console.log(chalk.white(`   Completed: ${queue.completed || 0}`));
  
  if (queue.priorities) {
    console.log(chalk.gray('   By priority:'));
    for (const [priority, count] of Object.entries(queue.priorities)) {
      if (count > 0) {
        console.log(chalk.gray(`     ${priority}: ${count}`));
      }
    }
  }
  
  console.log();
  
  // Agent Sessions status
  const agentSessions = getAgentSessionStatus();
  console.log(chalk.blue('🚂 Agent Sessions:'));
  
  const sessionNames = {
    'pbs-main': 'PoppoBuilder Main',
    'pbs-medama': 'MedamaRepair (Monitor)',
    'pbs-mera': 'MeraCleaner (Error Clean)',
    'pbs-mirin': 'MirinOrphanManager (Orphan)'
  };
  
  for (const [sessionId, sessionInfo] of Object.entries(agentSessions)) {
    const name = sessionNames[sessionId] || sessionId;
    const statusIcon = sessionInfo.status === 'running' ? chalk.green('✓') : chalk.red('✗');
    const statusText = sessionInfo.status === 'running' ? chalk.green('running') : chalk.red('stopped');
    
    console.log(chalk.white(`   ${statusIcon} ${name}: ${statusText}`));
    if (sessionInfo.status === 'running' && sessionInfo.pid) {
      console.log(chalk.gray(`     PID: ${sessionInfo.pid}`));
    }
  }
  
  console.log();
  
  // System metrics
  if (status.system) {
    console.log(chalk.blue('📊 System Metrics:'));
    
    if (status.system.memory) {
      const memMB = Math.round(status.system.memory.heapUsed / 1024 / 1024);
      console.log(chalk.white(`   Memory: ${memMB} MB`));
    }
    
    if (status.system.cpu) {
      console.log(chalk.white(`   CPU: ${status.system.cpu.user + status.system.cpu.system}μs`));
    }
    
    if (status.system.tasksProcessed) {
      console.log(chalk.white(`   Tasks processed: ${status.system.tasksProcessed}`));
    }
    
    if (status.system.errors) {
      console.log(chalk.white(`   Errors: ${status.system.errors}`));
    }
  }
}

/**
 * Format uptime in human readable format
 */
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

/**
 * Get tmux agent session status
 */
function getAgentSessionStatus() {
  const sessions = ['pbs-main', 'pbs-medama', 'pbs-mera', 'pbs-mirin'];
  const sessionStatus = {};
  
  for (const session of sessions) {
    try {
      // Check if session exists
      execSync(`tmux has-session -t ${session} 2>/dev/null`);
      
      // Get session info
      const info = execSync(`tmux list-panes -t ${session} -F "#{pane_pid},#{pane_start_command}" 2>/dev/null`).toString().trim();
      const [pid, command] = info.split(',');
      
      sessionStatus[session] = {
        status: 'running',
        pid: pid || 'unknown',
        command: command || 'unknown'
      };
    } catch (error) {
      sessionStatus[session] = {
        status: 'stopped',
        pid: null,
        command: null
      };
    }
  }
  
  return sessionStatus;
}

module.exports = { handleStatus };