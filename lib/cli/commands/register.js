/**
 * PoppoBuilder Register Commands
 * 
 * Commands for registering, unregistering, and listing projects
 */

const fs = require('fs').promises;
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { getInstance: getProjectRegistry } = require('../../core/project-registry');
const { IPCClient } = require('../../daemon/ipc');

/**
 * Handle register command
 */
async function handleRegister(projectPath, options) {
  try {
    const registry = getProjectRegistry();
    await registry.initialize();
    
    // Determine project path
    const targetPath = projectPath ? path.resolve(projectPath) : process.cwd();
    
    console.log(chalk.blue(`📦 Registering project at: ${targetPath}`));
    
    // Check if path exists and is a directory
    const stats = await fs.stat(targetPath);
    if (!stats.isDirectory()) {
      throw new Error('Path must be a directory');
    }
    
    // Detect project information
    const projectInfo = await detectProjectInfo(targetPath, options);
    
    // Interactive configuration if not all options provided
    if (!options.name || !options.id) {
      const answers = await collectProjectInfo(projectInfo, options);
      Object.assign(projectInfo, answers);
    }
    
    // Validate project
    const validationResult = await validateProject(targetPath, projectInfo);
    if (!validationResult.valid) {
      console.log(chalk.yellow('⚠️  Project validation warnings:'));
      for (const warning of validationResult.warnings) {
        console.log(chalk.yellow(`  • ${warning}`));
      }
      
      if (validationResult.errors.length > 0) {
        console.log(chalk.red('❌ Project validation errors:'));
        for (const error of validationResult.errors) {
          console.log(chalk.red(`  • ${error}`));
        }
        
        const { proceed } = await inquirer.prompt([{
          type: 'confirm',
          name: 'proceed',
          message: 'Project has validation errors. Register anyway?',
          default: false
        }]);
        
        if (!proceed) {
          console.log(chalk.yellow('Registration cancelled.'));
          return;
        }
      }
    }
    
    // Check if project already exists
    const existingProjects = registry.getAllProjects();
    if (existingProjects[projectInfo.id]) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: `Project '${projectInfo.id}' already exists. Overwrite?`,
        default: false
      }]);
      
      if (!overwrite) {
        console.log(chalk.yellow('Registration cancelled.'));
        return;
      }
    }
    
    // Register project
    await registry.register(projectInfo.path, projectInfo.config);
    
    console.log(chalk.green(`✅ Project '${projectInfo.name}' registered successfully!`));
    console.log(chalk.white(`   ID: ${projectInfo.id}`));
    console.log(chalk.white(`   Path: ${projectInfo.path}`));
    console.log(chalk.white(`   Priority: ${projectInfo.config.priority}`));
    console.log(chalk.white(`   Enabled: ${projectInfo.config.enabled ? 'Yes' : 'No'}`));
    
    // Notify daemon if running
    await notifyDaemon('project-registered', projectInfo);
    
  } catch (error) {
    console.error(chalk.red('❌ Registration failed:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Handle unregister command
 */
async function handleUnregister(projectId, options) {
  try {
    const registry = getProjectRegistry();
    await registry.initialize();
    
    // Check if project exists
    const projects = registry.getAllProjects();
    if (!projects[projectId]) {
      console.error(chalk.red(`❌ Project '${projectId}' not found`));
      process.exit(1);
    }
    
    const project = projects[projectId];
    
    // Confirmation
    if (!options.force) {
      console.log(chalk.yellow(`⚠️  About to unregister project:`));
      console.log(chalk.white(`   Name: ${project.name}`));
      console.log(chalk.white(`   Path: ${project.path}`));
      
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Are you sure you want to unregister this project?',
        default: false
      }]);
      
      if (!confirm) {
        console.log(chalk.yellow('Unregistration cancelled.'));
        return;
      }
    }
    
    // Unregister project
    await registry.unregisterProject(projectId);
    
    console.log(chalk.green(`✅ Project '${projectId}' unregistered successfully!`));
    
    // Notify daemon if running
    await notifyDaemon('project-unregistered', { id: projectId });
    
  } catch (error) {
    console.error(chalk.red('❌ Unregistration failed:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Handle list command
 */
async function handleList(options) {
  try {
    const registry = getProjectRegistry();
    await registry.initialize();
    
    const projects = registry.getAllProjects();
    const projectList = Object.entries(projects).map(([id, project]) => ({
      id,
      ...project
    }));
    
    // Filter projects
    let filteredProjects = projectList;
    if (options.enabledOnly) {
      filteredProjects = projectList.filter(p => p.config.enabled);
    } else if (options.disabledOnly) {
      filteredProjects = projectList.filter(p => !p.config.enabled);
    }
    
    if (options.json) {
      console.log(JSON.stringify(filteredProjects, null, 2));
      return;
    }
    
    // Display projects
    if (filteredProjects.length === 0) {
      console.log(chalk.yellow('No projects found.'));
      console.log(chalk.white('Use `poppobuilder register` to add projects.'));
      return;
    }
    
    console.log(chalk.blue(`📋 Registered Projects (${filteredProjects.length})`));
    console.log();
    
    for (const project of filteredProjects) {
      const status = project.config.enabled ? chalk.green('✓ Enabled') : chalk.red('✗ Disabled');
      const priority = `Priority: ${project.config.priority}`;
      const weight = `Weight: ${project.config.weight}`;
      
      console.log(chalk.white(`${chalk.bold(project.name)} (${project.id})`));
      console.log(chalk.gray(`  Path: ${project.path}`));
      console.log(chalk.gray(`  Status: ${status}  ${priority}  ${weight}`));
      console.log(chalk.gray(`  Polling: ${project.config.pollingInterval / 1000}s`));
      console.log();
    }
    
    // Show summary
    const enabled = filteredProjects.filter(p => p.config.enabled).length;
    const disabled = filteredProjects.length - enabled;
    console.log(chalk.blue(`Summary: ${enabled} enabled, ${disabled} disabled`));
    
  } catch (error) {
    console.error(chalk.red('❌ List failed:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Detect project information from directory
 */
async function detectProjectInfo(projectPath, options) {
  const info = {
    path: projectPath,
    config: {
      priority: parseInt(options.priority) || 50,
      weight: parseFloat(options.weight) || 1.0,
      pollingInterval: parseInt(options.pollingInterval) || 300000,
      enabled: options.disable ? false : true
    }
  };
  
  // Try to read package.json
  const packageFile = path.join(projectPath, 'package.json');
  try {
    const packageContent = await fs.readFile(packageFile, 'utf8');
    const packageJson = JSON.parse(packageContent);
    
    info.name = options.name || packageJson.name || path.basename(projectPath);
    info.id = options.id || sanitizeId(info.name);
    info.version = packageJson.version || '1.0.0';
    info.description = packageJson.description;
    
    // Check for PoppoBuilder-specific configuration
    if (packageJson.poppobuilder) {
      Object.assign(info.config, packageJson.poppobuilder);
    }
    
  } catch (error) {
    // No package.json or invalid JSON
    info.name = options.name || path.basename(projectPath);
    info.id = options.id || sanitizeId(info.name);
    info.version = '1.0.0';
  }
  
  // Try to read .poppo config
  const poppoConfigFile = path.join(projectPath, '.poppo', 'config.json');
  try {
    const poppoContent = await fs.readFile(poppoConfigFile, 'utf8');
    const poppoConfig = JSON.parse(poppoContent);
    Object.assign(info.config, poppoConfig);
  } catch (error) {
    // No .poppo config
  }
  
  return info;
}

/**
 * Collect additional project information interactively
 */
async function collectProjectInfo(projectInfo, options) {
  const questions = [];
  
  if (!options.name && !projectInfo.name) {
    questions.push({
      type: 'input',
      name: 'name',
      message: 'Project name:',
      default: path.basename(projectInfo.path),
      validate: (input) => input.trim().length > 0 || 'Name is required'
    });
  }
  
  if (!options.id && !projectInfo.id) {
    questions.push({
      type: 'input',
      name: 'id',
      message: 'Project ID:',
      default: sanitizeId(projectInfo.name || path.basename(projectInfo.path)),
      validate: (input) => {
        const sanitized = sanitizeId(input);
        return sanitized.length > 0 || 'ID is required';
      },
      filter: sanitizeId
    });
  }
  
  questions.push({
    type: 'input',
    name: 'description',
    message: 'Project description (optional):',
    default: projectInfo.description || ''
  });
  
  questions.push({
    type: 'list',
    name: 'template',
    message: 'Configuration template:',
    choices: [
      { name: 'Basic - Standard PoppoBuilder project', value: 'basic' },
      { name: 'High Priority - Critical projects with fast polling', value: 'high-priority' },
      { name: 'Low Priority - Background projects with slow polling', value: 'low-priority' },
      { name: 'Development - Projects in development', value: 'development' }
    ],
    default: options.template || 'basic'
  });
  
  if (questions.length > 0) {
    return await inquirer.prompt(questions);
  }
  
  return {};
}

/**
 * Validate project directory and configuration
 */
async function validateProject(projectPath, projectInfo) {
  const result = {
    valid: true,
    warnings: [],
    errors: []
  };
  
  // Check for package.json
  const packageFile = path.join(projectPath, 'package.json');
  if (!await fileExists(packageFile)) {
    result.warnings.push('No package.json found');
  }
  
  // Check for PoppoBuilder files
  const poppoFiles = [
    'src/minimal-poppo.js',
    'lib/minimal-poppo.js',
    'minimal-poppo.js'
  ];
  
  let hasPoppoFile = false;
  for (const file of poppoFiles) {
    if (await fileExists(path.join(projectPath, file))) {
      hasPoppoFile = true;
      break;
    }
  }
  
  if (!hasPoppoFile) {
    result.warnings.push('No PoppoBuilder main file found (minimal-poppo.js)');
  }
  
  // Check for .poppo directory
  const poppoDir = path.join(projectPath, '.poppo');
  if (!await fileExists(poppoDir)) {
    result.warnings.push('No .poppo configuration directory found');
  }
  
  // Check for node_modules
  const nodeModules = path.join(projectPath, 'node_modules');
  if (!await fileExists(nodeModules)) {
    result.warnings.push('No node_modules found - run npm install');
  }
  
  // Validate configuration values
  if (projectInfo.config.priority < 1 || projectInfo.config.priority > 100) {
    result.errors.push('Priority must be between 1 and 100');
  }
  
  if (projectInfo.config.weight < 0.1 || projectInfo.config.weight > 10.0) {
    result.errors.push('Weight must be between 0.1 and 10.0');
  }
  
  if (projectInfo.config.pollingInterval < 30000) {
    result.warnings.push('Polling interval less than 30 seconds may cause rate limiting');
  }
  
  // Check for write permissions
  try {
    await fs.access(projectPath, fs.constants.W_OK);
  } catch (error) {
    result.errors.push('No write permission to project directory');
  }
  
  result.valid = result.errors.length === 0;
  return result;
}

/**
 * Sanitize project ID
 */
function sanitizeId(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Apply configuration template
 */
function applyTemplate(template, config) {
  const templates = {
    'basic': {
      priority: 50,
      weight: 1.0,
      pollingInterval: 300000, // 5 minutes
      enabled: true
    },
    'high-priority': {
      priority: 80,
      weight: 2.0,
      pollingInterval: 60000, // 1 minute
      enabled: true
    },
    'low-priority': {
      priority: 20,
      weight: 0.5,
      pollingInterval: 900000, // 15 minutes
      enabled: true
    },
    'development': {
      priority: 30,
      weight: 0.8,
      pollingInterval: 600000, // 10 minutes
      enabled: false
    }
  };
  
  const templateConfig = templates[template] || templates['basic'];
  return { ...templateConfig, ...config };
}

/**
 * Notify daemon of project changes
 */
async function notifyDaemon(event, data) {
  try {
    const ipcClient = new IPCClient();
    await ipcClient.connect();
    
    const response = await ipcClient.sendCommand('notify-project-change', {
      event,
      data
    });
    
    if (response.success) {
      console.log(chalk.gray('  Daemon notified of changes'));
    }
    
    await ipcClient.disconnect();
  } catch (error) {
    // Daemon may not be running, ignore error
    console.log(chalk.gray('  Daemon not running (will sync on next start)'));
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

module.exports = { handleRegister, handleUnregister, handleList };