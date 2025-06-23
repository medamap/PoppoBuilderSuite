/**
 * PoppoBuilder Project Commands
 * 
 * Commands for managing individual projects
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { getInstance: getProjectRegistry } = require('../../core/project-registry');
const { IPCClient } = require('../../daemon/ipc');

/**
 * Handle project subcommands
 */
async function handleProject(action, projectId, options = {}) {
  try {
    switch (action) {
      case 'enable':
        await enableProject(projectId);
        break;
      case 'disable':
        await disableProject(projectId);
        break;
      case 'info':
        await showProjectInfo(projectId, options);
        break;
      case 'config':
        await configureProject(projectId, options);
        break;
      case 'logs':
        await showProjectLogs(projectId, options);
        break;
      case 'restart':
        await restartProject(projectId, options);
        break;
      case 'validate':
        await validateProject(projectId);
        break;
      default:
        throw new Error(`Unknown project action: ${action}`);
    }
    
  } catch (error) {
    console.error(chalk.red(`❌ Project ${action} failed:`), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Enable a project
 */
async function enableProject(projectId) {
  console.log(chalk.blue(`🔓 Enabling project: ${projectId}`));
  
  const registry = getProjectRegistry();
  await registry.initialize();
  
  const project = registry.getProject(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }
  
  if (project.config.enabled) {
    console.log(chalk.yellow('Project is already enabled'));
    return;
  }
  
  // Update project configuration
  project.config.enabled = true;
  await registry.updateProject(projectId, project);
  
  console.log(chalk.green('✅ Project enabled successfully'));
  
  // Notify daemon
  await notifyDaemon('project-enabled', { id: projectId });
}

/**
 * Disable a project
 */
async function disableProject(projectId) {
  console.log(chalk.blue(`🔒 Disabling project: ${projectId}`));
  
  const registry = getProjectRegistry();
  await registry.initialize();
  
  const project = registry.getProject(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }
  
  if (!project.config.enabled) {
    console.log(chalk.yellow('Project is already disabled'));
    return;
  }
  
  // Update project configuration
  project.config.enabled = false;
  await registry.updateProject(projectId, project);
  
  console.log(chalk.green('✅ Project disabled successfully'));
  
  // Notify daemon
  await notifyDaemon('project-disabled', { id: projectId });
}

/**
 * Show project information
 */
async function showProjectInfo(projectId, options) {
  const registry = getProjectRegistry();
  await registry.initialize();
  
  const project = registry.getProject(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }
  
  // Get runtime information from daemon
  let runtimeInfo = {};
  try {
    const ipcClient = new IPCClient();
    await ipcClient.connect();
    const response = await ipcClient.sendCommand('get-project-info', { projectId });
    await ipcClient.disconnect();
    
    runtimeInfo = response.project || {};
  } catch (error) {
    // Daemon not running or not responsive
  }
  
  if (options.json) {
    const info = {
      ...project,
      runtime: runtimeInfo
    };
    console.log(JSON.stringify(info, null, 2));
    return;
  }
  
  // Display formatted information
  displayProjectInfo(project, runtimeInfo);
}

/**
 * Configure a project
 */
async function configureProject(projectId, options) {
  console.log(chalk.blue(`⚙️  Configuring project: ${projectId}`));
  
  const registry = getProjectRegistry();
  await registry.initialize();
  
  const project = registry.getProject(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }
  
  let updated = false;
  
  // Update configuration from options
  if (options.priority !== undefined) {
    const priority = parseInt(options.priority);
    if (priority < 1 || priority > 100) {
      throw new Error('Priority must be between 1 and 100');
    }
    project.config.priority = priority;
    updated = true;
  }
  
  if (options.weight !== undefined) {
    const weight = parseFloat(options.weight);
    if (weight < 0.1 || weight > 10.0) {
      throw new Error('Weight must be between 0.1 and 10.0');
    }
    project.config.weight = weight;
    updated = true;
  }
  
  if (options.pollingInterval !== undefined) {
    const interval = parseInt(options.pollingInterval);
    if (interval < 30000) {
      console.log(chalk.yellow('⚠️  Warning: Polling interval less than 30 seconds may cause rate limiting'));
    }
    project.config.pollingInterval = interval;
    updated = true;
  }
  
  // Interactive configuration if no options provided
  if (!updated) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'priority',
        message: 'Priority (1-100):',
        default: project.config.priority,
        validate: (input) => {
          const num = parseInt(input);
          return (num >= 1 && num <= 100) || 'Priority must be between 1 and 100';
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'input',
        name: 'weight',
        message: 'Weight (0.1-10.0):',
        default: project.config.weight,
        validate: (input) => {
          const num = parseFloat(input);
          return (num >= 0.1 && num <= 10.0) || 'Weight must be between 0.1 and 10.0';
        },
        filter: (input) => parseFloat(input)
      },
      {
        type: 'input',
        name: 'pollingInterval',
        message: 'Polling interval (ms):',
        default: project.config.pollingInterval,
        validate: (input) => {
          const num = parseInt(input);
          return num > 0 || 'Polling interval must be positive';
        },
        filter: (input) => parseInt(input)
      },
      {
        type: 'confirm',
        name: 'enabled',
        message: 'Enabled:',
        default: project.config.enabled
      }
    ]);
    
    Object.assign(project.config, answers);
    updated = true;
  }
  
  if (updated) {
    await registry.updateProject(projectId, project);
    console.log(chalk.green('✅ Project configuration updated'));
    
    // Notify daemon
    await notifyDaemon('project-updated', { id: projectId, project });
  } else {
    console.log(chalk.yellow('No changes made'));
  }
}

/**
 * Show project logs
 */
async function showProjectLogs(projectId, options) {
  console.log(chalk.blue(`📋 Project logs: ${projectId}`));
  
  // Get log file path
  const logDir = path.join(os.homedir(), '.poppobuilder', 'logs');
  const logFile = path.join(logDir, `${projectId}.log`);
  
  if (!await fileExists(logFile)) {
    console.log(chalk.yellow('No logs found for this project'));
    console.log(chalk.gray(`Expected log file: ${logFile}`));
    return;
  }
  
  const lines = parseInt(options.lines) || 50;
  
  if (options.follow) {
    // Follow logs in real-time
    const { spawn } = require('child_process');
    const tailArgs = ['-f', '-n', lines.toString()];
    
    if (options.level) {
      // Use grep to filter by level
      const tail = spawn('tail', tailArgs.concat([logFile]));
      const grep = spawn('grep', ['--line-buffered', `-i`, options.level]);
      
      tail.stdout.pipe(grep.stdin);
      grep.stdout.pipe(process.stdout);
      grep.stderr.pipe(process.stderr);
      
      console.log(chalk.gray(`Following logs for ${projectId} (level: ${options.level})`));
      console.log(chalk.gray('Press Ctrl+C to exit\\n'));
      
      process.on('SIGINT', () => {
        tail.kill();
        grep.kill();
        process.exit(0);
      });
      
    } else {
      const tail = spawn('tail', tailArgs.concat([logFile]), {
        stdio: 'inherit'
      });
      
      console.log(chalk.gray(`Following logs for ${projectId}`));
      console.log(chalk.gray('Press Ctrl+C to exit\\n'));
      
      process.on('SIGINT', () => {
        tail.kill();
        process.exit(0);
      });
    }
    
  } else {
    // Show static logs
    const logContent = await fs.readFile(logFile, 'utf8');
    const logLines = logContent.split('\\n').filter(line => line.trim());
    
    // Filter by level if specified
    let filteredLines = logLines;
    if (options.level) {
      const levelRegex = new RegExp(`\\\\b${options.level}\\\\b`, 'i');
      filteredLines = logLines.filter(line => levelRegex.test(line));
    }
    
    // Show last N lines
    const displayLines = filteredLines.slice(-lines);
    
    if (displayLines.length === 0) {
      console.log(chalk.yellow('No matching log entries found'));
      return;
    }
    
    console.log(chalk.gray(`Showing last ${displayLines.length} entries:\\n`));
    
    for (const line of displayLines) {
      // Color-code log levels
      let coloredLine = line;
      if (line.includes('ERROR')) {
        coloredLine = chalk.red(line);
      } else if (line.includes('WARN')) {
        coloredLine = chalk.yellow(line);
      } else if (line.includes('INFO')) {
        coloredLine = chalk.blue(line);
      } else if (line.includes('DEBUG')) {
        coloredLine = chalk.gray(line);
      }
      
      console.log(coloredLine);
    }
  }
}

/**
 * Restart project tasks
 */
async function restartProject(projectId, options) {
  console.log(chalk.blue(`🔄 Restarting project: ${projectId}`));
  
  try {
    const ipcClient = new IPCClient();
    await ipcClient.connect();
    
    const response = await ipcClient.sendCommand('restart-project', {
      projectId,
      force: options.force
    });
    
    await ipcClient.disconnect();
    
    if (response.success) {
      console.log(chalk.green('✅ Project restarted successfully'));
      
      if (response.tasksKilled > 0) {
        console.log(chalk.white(`   Stopped ${response.tasksKilled} running tasks`));
      }
      
      if (response.tasksStarted > 0) {
        console.log(chalk.white(`   Started ${response.tasksStarted} new tasks`));
      }
      
    } else {
      throw new Error(response.error || 'Restart failed');
    }
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('❌ Daemon is not running'));
      console.log(chalk.white('Use `poppobuilder start` to start the daemon first'));
    } else {
      throw error;
    }
  }
}

/**
 * Validate project configuration and setup
 */
async function validateProject(projectId) {
  console.log(chalk.blue(`🔍 Validating project: ${projectId}`));
  
  const registry = getProjectRegistry();
  await registry.initialize();
  
  const project = registry.getProject(projectId);
  if (!project) {
    throw new Error(`Project '${projectId}' not found`);
  }
  
  const validation = {
    valid: true,
    warnings: [],
    errors: []
  };
  
  // Validate project path
  console.log(chalk.blue('  📁 Checking project path...'));
  if (!await fileExists(project.path)) {
    validation.errors.push(`Project path does not exist: ${project.path}`);
  } else {
    console.log(chalk.green('    ✓ Project path exists'));
  }
  
  // Validate configuration
  console.log(chalk.blue('  ⚙️  Checking configuration...'));
  
  if (project.config.priority < 1 || project.config.priority > 100) {
    validation.errors.push('Priority must be between 1 and 100');
  } else {
    console.log(chalk.green(`    ✓ Priority: ${project.config.priority}`));
  }
  
  if (project.config.weight < 0.1 || project.config.weight > 10.0) {
    validation.errors.push('Weight must be between 0.1 and 10.0');
  } else {
    console.log(chalk.green(`    ✓ Weight: ${project.config.weight}`));
  }
  
  if (project.config.pollingInterval < 30000) {
    validation.warnings.push('Polling interval less than 30 seconds may cause rate limiting');
  } else {
    console.log(chalk.green(`    ✓ Polling interval: ${project.config.pollingInterval}ms`));
  }
  
  // Check for PoppoBuilder files
  console.log(chalk.blue('  📄 Checking PoppoBuilder files...'));
  
  const poppoFiles = [
    'src/minimal-poppo.js',
    'lib/minimal-poppo.js',
    'minimal-poppo.js'
  ];
  
  let hasPoppoFile = false;
  for (const file of poppoFiles) {
    const filePath = path.join(project.path, file);
    if (await fileExists(filePath)) {
      hasPoppoFile = true;
      console.log(chalk.green(`    ✓ Found: ${file}`));
      break;
    }
  }
  
  if (!hasPoppoFile) {
    validation.warnings.push('No PoppoBuilder main file found');
  }
  
  // Check for configuration files
  console.log(chalk.blue('  🔧 Checking configuration files...'));
  
  const configFiles = [
    '.poppo/config.json',
    'config.json',
    '.env'
  ];
  
  for (const file of configFiles) {
    const filePath = path.join(project.path, file);
    if (await fileExists(filePath)) {
      console.log(chalk.green(`    ✓ Found: ${file}`));
    }
  }
  
  // Check dependencies
  console.log(chalk.blue('  📦 Checking dependencies...'));
  
  const packageFile = path.join(project.path, 'package.json');
  if (await fileExists(packageFile)) {
    try {
      const packageContent = await fs.readFile(packageFile, 'utf8');
      const packageJson = JSON.parse(packageContent);
      
      if (packageJson.dependencies?.poppobuilder || packageJson.devDependencies?.poppobuilder) {
        console.log(chalk.green('    ✓ PoppoBuilder dependency found'));
      } else {
        validation.warnings.push('PoppoBuilder dependency not found in package.json');
      }
      
      // Check for node_modules
      const nodeModules = path.join(project.path, 'node_modules');
      if (await fileExists(nodeModules)) {
        console.log(chalk.green('    ✓ Dependencies installed'));
      } else {
        validation.warnings.push('Dependencies not installed (run npm install)');
      }
      
    } catch (error) {
      validation.warnings.push(`Invalid package.json: ${error.message}`);
    }
  } else {
    validation.warnings.push('No package.json found');
  }
  
  // Show results
  console.log();
  
  if (validation.errors.length > 0) {
    console.log(chalk.red('❌ Validation Errors:'));
    for (const error of validation.errors) {
      console.log(chalk.red(`   • ${error}`));
    }
    validation.valid = false;
  }
  
  if (validation.warnings.length > 0) {
    console.log(chalk.yellow('⚠️  Validation Warnings:'));
    for (const warning of validation.warnings) {
      console.log(chalk.yellow(`   • ${warning}`));
    }
  }
  
  if (validation.valid && validation.warnings.length === 0) {
    console.log(chalk.green('✅ Project validation passed'));
  } else if (validation.valid) {
    console.log(chalk.yellow('⚠️  Project validation passed with warnings'));
  } else {
    console.log(chalk.red('❌ Project validation failed'));
  }
}

/**
 * Display formatted project information
 */
function displayProjectInfo(project, runtimeInfo) {
  console.log(chalk.blue(`📦 Project Information: ${project.id}`));
  console.log();
  
  // Basic information
  console.log(chalk.white(`${chalk.bold('Name:')} ${project.name}`));
  console.log(chalk.white(`${chalk.bold('ID:')} ${project.id}`));
  console.log(chalk.white(`${chalk.bold('Path:')} ${project.path}`));
  console.log(chalk.white(`${chalk.bold('Version:')} ${project.version || 'Unknown'}`));
  
  if (project.description) {
    console.log(chalk.white(`${chalk.bold('Description:')} ${project.description}`));
  }
  
  console.log();
  
  // Configuration
  console.log(chalk.blue('⚙️  Configuration:'));
  const enabled = project.config.enabled ? chalk.green('Yes') : chalk.red('No');
  console.log(chalk.white(`   Status: ${enabled}`));
  console.log(chalk.white(`   Priority: ${project.config.priority}`));
  console.log(chalk.white(`   Weight: ${project.config.weight}`));
  console.log(chalk.white(`   Polling Interval: ${project.config.pollingInterval / 1000}s`));
  
  if (project.config.migrated) {
    console.log(chalk.gray(`   Migrated: ${new Date(project.config.migratedAt).toLocaleString()}`));
  }
  
  console.log();
  
  // Runtime information
  if (Object.keys(runtimeInfo).length > 0) {
    console.log(chalk.blue('🔄 Runtime Status:'));
    
    if (runtimeInfo.status) {
      const statusColor = runtimeInfo.status === 'active' ? 'green' : 'yellow';
      console.log(chalk.white(`   Status: ${chalk[statusColor](runtimeInfo.status)}`));
    }
    
    if (runtimeInfo.lastActivity) {
      const lastActivity = new Date(runtimeInfo.lastActivity).toLocaleString();
      console.log(chalk.white(`   Last Activity: ${lastActivity}`));
    }
    
    if (runtimeInfo.tasksProcessed !== undefined) {
      console.log(chalk.white(`   Tasks Processed: ${runtimeInfo.tasksProcessed}`));
    }
    
    if (runtimeInfo.currentTasks !== undefined) {
      console.log(chalk.white(`   Current Tasks: ${runtimeInfo.currentTasks}`));
    }
    
    if (runtimeInfo.errors !== undefined) {
      console.log(chalk.white(`   Errors: ${runtimeInfo.errors}`));
    }
  } else {
    console.log(chalk.gray('🔄 Runtime Status: Not available (daemon not running)'));
  }
}

/**
 * Notify daemon of changes
 */
async function notifyDaemon(event, data) {
  try {
    const ipcClient = new IPCClient();
    await ipcClient.connect();
    
    await ipcClient.sendCommand('notify-project-change', {
      event,
      data
    });
    
    await ipcClient.disconnect();
    console.log(chalk.gray('  Daemon notified of changes'));
    
  } catch (error) {
    console.log(chalk.gray('  Daemon not running (changes will sync on next start)'));
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

module.exports = { handleProject };