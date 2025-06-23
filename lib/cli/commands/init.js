/**
 * PoppoBuilder Init Command
 * 
 * Initializes global PoppoBuilder configuration and directory structure
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { spawn } = require('child_process');
const { getInstance: getGlobalConfig } = require('../../core/global-config-manager');
const { getInstance: getProjectRegistry } = require('../../core/project-registry');
const { handleSimpleInit } = require('./init-simple');

// Default configuration templates
const defaultConfig = {
  version: '3.0.0',
  daemon: {
    enabled: true,
    port: 3003,
    host: '127.0.0.1',
    maxProcesses: Math.max(2, Math.ceil(os.cpus().length / 2)),
    schedulingStrategy: 'weighted-round-robin',
    heartbeatInterval: 30000,
    autoStart: true,
    logging: {
      level: 'info',
      file: true,
      console: true
    }
  },
  api: {
    enabled: true,
    cors: true,
    rateLimit: {
      windowMs: 900000, // 15 minutes
      max: 100
    },
    authentication: {
      required: false,
      secret: null
    }
  },
  taskQueue: {
    maxQueueSize: 1000,
    persistence: {
      enabled: true,
      backend: 'json',
      path: 'queue-state.json'
    },
    priorityManagement: {
      enabled: true,
      priorityLevels: {
        urgent: 1000,
        critical: 800,
        dogfooding: 100,
        bug: 75,
        feature: 50,
        documentation: 40,
        misc: 25,
        low: 10
      },
      ageEscalation: {
        enabled: true,
        hourlyIncrease: 1.5,
        maxIncrease: 100,
        thresholdHours: 24
      },
      sla: {
        enabled: true,
        levels: {
          critical: { hours: 4, priorityBoost: 300 },
          high: { hours: 24, priorityBoost: 150 },
          normal: { hours: 72, priorityBoost: 75 },
          low: { hours: 168, priorityBoost: 25 }
        }
      },
      preemption: {
        enabled: false,
        minPriorityDifference: 300,
        allowedTaskTypes: ['urgent', 'critical']
      },
      starvationPrevention: {
        enabled: true,
        maxWaitTime: 172800000,
        priorityBoost: 100
      }
    }
  },
  workerPool: {
    minWorkers: 1,
    maxWorkers: 10,
    strategy: 'load-balanced',
    timeout: 300000,
    healthCheck: {
      enabled: true,
      interval: 30000,
      timeout: 10000
    }
  },
  monitoring: {
    enabled: true,
    metrics: {
      collection: true,
      retention: '7d'
    },
    alerts: {
      enabled: true,
      channels: ['log']
    }
  },
  security: {
    enableCors: true,
    trustProxy: false,
    helmet: true
  }
};

/**
 * Handle init command - redirect to simplified version
 */
async function handleInit(options) {
  // Use simplified init for better UX
  return handleSimpleInit(options);
}

/**
 * Original complex init (deprecated - kept for reference)
 */
async function handleInitComplex(options) {
  try {
    console.log(chalk.blue('🚀 PoppoBuilder Global Setup\n'));
    
    // Check if already initialized
    const globalConfigDir = path.join(os.homedir(), '.poppobuilder');
    const configFile = path.join(globalConfigDir, 'config.json');
    const exists = await fileExists(configFile);
    
    if (exists && !options.force) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: 'PoppoBuilder is already initialized. Overwrite existing configuration?',
        default: false
      }]);
      
      if (!overwrite) {
        console.log(chalk.yellow('Initialization cancelled.'));
        return;
      }
    }
    
    // Collect configuration
    const config = await collectConfiguration(options);
    
    // Create directory structure
    console.log(chalk.blue('📁 Creating directory structure...'));
    await createDirectoryStructure(globalConfigDir);
    
    // Save configuration
    console.log(chalk.blue('⚙️  Saving configuration...'));
    await saveConfiguration(configFile, config);
    
    // Setup daemon if requested
    if (!options.skipDaemon && config.daemon.enabled) {
      console.log(chalk.blue('🔧 Setting up daemon...'));
      await setupDaemon(config);
    }
    
    // Discover and register projects if requested
    if (!options.skipProjects) {
      console.log(chalk.blue('🔍 Discovering projects...'));
      await discoverProjects();
    }
    
    // Success message
    console.log(chalk.green('\\n✅ PoppoBuilder initialized successfully!'));
    console.log(chalk.white('\\nNext steps:'));
    console.log(chalk.white('  • Run `poppobuilder register` to add projects'));
    console.log(chalk.white('  • Run `poppobuilder start` to start the daemon'));
    console.log(chalk.white('  • Check status with `poppobuilder status`'));
    
    if (config.daemon.autoStart) {
      console.log(chalk.blue('\\n🚀 Auto-starting daemon...'));
      await startDaemon(config);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ Initialization failed:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Collect configuration from user
 */
async function collectConfiguration(options) {
  const questions = [
    {
      type: 'input',
      name: 'daemonPort',
      message: 'Daemon port:',
      default: 3003,
      validate: (input) => {
        const port = parseInt(input);
        return port > 0 && port < 65536 || 'Port must be between 1 and 65535';
      }
    },
    {
      type: 'input',
      name: 'maxProcesses',
      message: 'Maximum concurrent processes:',
      default: Math.max(2, Math.ceil(os.cpus().length / 2)),
      validate: (input) => {
        const num = parseInt(input);
        return num > 0 && num <= 20 || 'Must be between 1 and 20';
      }
    },
    {
      type: 'list',
      name: 'schedulingStrategy',
      message: 'Task scheduling strategy:',
      choices: [
        { name: 'Weighted Round Robin (recommended)', value: 'weighted-round-robin' },
        { name: 'Priority-based', value: 'priority-based' },
        { name: 'Round Robin', value: 'round-robin' },
        { name: 'Load Balanced', value: 'load-balanced' }
      ],
      default: 'weighted-round-robin'
    },
    {
      type: 'confirm',
      name: 'enablePriority',
      message: 'Enable advanced priority management?',
      default: true
    },
    {
      type: 'confirm',
      name: 'enableMonitoring',
      message: 'Enable monitoring and metrics?',
      default: true
    },
    {
      type: 'confirm',
      name: 'autoStart',
      message: 'Auto-start daemon after initialization?',
      default: true
    }
  ];
  
  const answers = await inquirer.prompt(questions);
  
  // Build configuration
  const config = { ...defaultConfig };
  
  config.daemon.port = parseInt(answers.daemonPort);
  config.daemon.maxProcesses = parseInt(answers.maxProcesses);
  config.daemon.schedulingStrategy = answers.schedulingStrategy;
  config.daemon.autoStart = answers.autoStart;
  config.taskQueue.priorityManagement.enabled = answers.enablePriority;
  config.monitoring.enabled = answers.enableMonitoring;
  
  // Advanced configuration if priority is enabled
  if (answers.enablePriority) {
    const { enablePreemption } = await inquirer.prompt([{
      type: 'confirm',
      name: 'enablePreemption',
      message: 'Enable task preemption for urgent tasks?',
      default: false
    }]);
    
    config.taskQueue.priorityManagement.preemption.enabled = enablePreemption;
  }
  
  return config;
}

/**
 * Create directory structure
 */
async function createDirectoryStructure(baseDir) {
  const dirs = [
    baseDir,
    path.join(baseDir, 'logs'),
    path.join(baseDir, 'data'),
    path.join(baseDir, 'projects'),
    path.join(baseDir, 'plugins'),
    path.join(baseDir, 'cache')
  ];
  
  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
    console.log(chalk.gray(`  Created: ${dir}`));
  }
}

/**
 * Save configuration to file
 */
async function saveConfiguration(configFile, config) {
  await fs.writeFile(configFile, JSON.stringify(config, null, 2));
  console.log(chalk.gray(`  Saved: ${configFile}`));
  
  // Save default project registry
  const registryFile = path.join(path.dirname(configFile), 'projects.json');
  const registry = {
    version: '1.0.0',
    projects: {},
    templates: {
      'basic': {
        name: 'Basic PoppoBuilder Project',
        config: {
          pollingInterval: 300000,
          priority: 50,
          weight: 1.0,
          enabled: true
        }
      }
    }
  };
  
  await fs.writeFile(registryFile, JSON.stringify(registry, null, 2));
  console.log(chalk.gray(`  Saved: ${registryFile}`));
}

/**
 * Setup daemon configuration
 */
async function setupDaemon(config) {
  // Create systemd service file if on Linux
  if (process.platform === 'linux') {
    await createSystemdService(config);
  }
  
  // Create launch agent if on macOS
  if (process.platform === 'darwin') {
    await createLaunchAgent(config);
  }
  
  console.log(chalk.gray('  Daemon setup completed'));
}

/**
 * Create systemd service file
 */
async function createSystemdService(config) {
  const serviceContent = `[Unit]
Description=PoppoBuilder Daemon
After=network.target
Wants=network.target

[Service]
Type=simple
User=${os.userInfo().username}
WorkingDirectory=${process.cwd()}
ExecStart=${process.execPath} ${path.join(__dirname, '../../../bin/poppobuilder')} start --detach
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;

  const serviceFile = path.join(os.homedir(), '.config/systemd/user/poppobuilder.service');
  await fs.mkdir(path.dirname(serviceFile), { recursive: true });
  await fs.writeFile(serviceFile, serviceContent);
  console.log(chalk.gray(`  Created systemd service: ${serviceFile}`));
}

/**
 * Create macOS launch agent
 */
async function createLaunchAgent(config) {
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.medamap.poppobuilder</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${path.join(__dirname, '../../../bin/poppobuilder')}</string>
    <string>start</string>
    <string>--detach</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${process.cwd()}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${path.join(os.homedir(), '.poppobuilder/logs/daemon.log')}</string>
  <key>StandardErrorPath</key>
  <string>${path.join(os.homedir(), '.poppobuilder/logs/daemon.error.log')}</string>
</dict>
</plist>
`;

  const plistFile = path.join(os.homedir(), 'Library/LaunchAgents/com.medamap.poppobuilder.plist');
  await fs.mkdir(path.dirname(plistFile), { recursive: true });
  await fs.writeFile(plistFile, plistContent);
  console.log(chalk.gray(`  Created launch agent: ${plistFile}`));
}

/**
 * Discover existing PoppoBuilder projects
 */
async function discoverProjects() {
  const registry = getProjectRegistry();
  await registry.initialize();
  
  // Look for package.json files with PoppoBuilder dependencies
  const homeDir = os.homedir();
  const commonDirs = [
    path.join(homeDir, 'Projects'),
    path.join(homeDir, 'Code'),
    path.join(homeDir, 'Development'),
    path.join(homeDir, 'dev'),
    process.cwd()
  ];
  
  let found = 0;
  
  for (const dir of commonDirs) {
    if (await fileExists(dir)) {
      const projects = await findPoppoBuilderProjects(dir);
      for (const project of projects) {
        try {
          await registry.registerProject(project.id, project);
          console.log(chalk.gray(`  Found: ${project.name} at ${project.path}`));
          found++;
        } catch (error) {
          console.log(chalk.yellow(`  Warning: Could not register ${project.name}: ${error.message}`));
        }
      }
    }
  }
  
  if (found > 0) {
    console.log(chalk.green(`  Discovered ${found} projects`));
  } else {
    console.log(chalk.yellow('  No projects found. Use `poppobuilder register` to add projects manually.'));
  }
}

/**
 * Find PoppoBuilder projects in directory
 */
async function findPoppoBuilderProjects(dir, maxDepth = 3) {
  const projects = [];
  
  if (maxDepth <= 0) return projects;
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const subDir = path.join(dir, entry.name);
        const packageFile = path.join(subDir, 'package.json');
        
        if (await fileExists(packageFile)) {
          try {
            const packageContent = await fs.readFile(packageFile, 'utf8');
            const packageJson = JSON.parse(packageContent);
            
            // Check if it's a PoppoBuilder project
            if (packageJson.dependencies?.['poppobuilder'] || 
                packageJson.devDependencies?.['poppobuilder'] ||
                await fileExists(path.join(subDir, 'src/minimal-poppo.js')) ||
                await fileExists(path.join(subDir, '.poppo'))) {
              
              projects.push({
                id: entry.name,
                name: packageJson.name || entry.name,
                path: subDir,
                version: packageJson.version || '1.0.0',
                config: {
                  pollingInterval: 300000,
                  priority: 50,
                  weight: 1.0,
                  enabled: true
                }
              });
            }
          } catch (error) {
            // Ignore invalid package.json files
          }
        }
        
        // Recurse into subdirectories
        const subProjects = await findPoppoBuilderProjects(subDir, maxDepth - 1);
        projects.push(...subProjects);
      }
    }
  } catch (error) {
    // Ignore permission errors
  }
  
  return projects;
}

/**
 * Start daemon
 */
async function startDaemon(config) {
  return new Promise((resolve, reject) => {
    const daemonProcess = spawn(process.execPath, [
      path.join(__dirname, '../../../bin/poppobuilder'),
      'start',
      '--detach'
    ], {
      detached: true,
      stdio: 'ignore'
    });
    
    daemonProcess.on('error', reject);
    daemonProcess.on('spawn', () => {
      console.log(chalk.green('  Daemon started successfully'));
      resolve();
    });
    
    daemonProcess.unref();
  });
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

module.exports = { handleInit };