/**
 * PoppoBuilder Redis Management Commands
 * 
 * Enable/disable Redis and migrate data between JSON and Redis
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const ora = require('ora');
const inquirer = require('inquirer');
const Redis = require('ioredis');
const { getInstance: getGlobalConfig } = require('../../core/global-config-manager');
const { getInstance: getProjectRegistry } = require('../../core/project-registry');

/**
 * Enable Redis mode
 */
async function handleRedisEnable(options = {}) {
  console.log(chalk.blue('\n🔄 Enabling Redis mode...\n'));
  
  // Check Redis status
  const spinner = ora('Checking Redis status...').start();
  const redisStatus = await checkRedisStatus();
  
  if (!redisStatus.installed) {
    spinner.fail('Redis is not installed');
    const { install } = await inquirer.prompt([{
      type: 'confirm',
      name: 'install',
      message: 'Would you like to install Redis now?',
      default: true
    }]);
    
    if (!install) {
      console.log(chalk.yellow('\nRedis installation required. Aborting.'));
      return;
    }
    
    // Install Redis (reuse the function from init.js)
    console.log('Please run: brew install redis (macOS) or sudo apt-get install redis-server (Linux)');
    return;
  }
  
  if (!redisStatus.running) {
    spinner.warn('Redis is not running');
    const { start } = await inquirer.prompt([{
      type: 'confirm',
      name: 'start',
      message: 'Would you like to start Redis now?',
      default: true
    }]);
    
    if (!start) {
      console.log(chalk.yellow('\nRedis must be running. Aborting.'));
      return;
    }
    
    // Start Redis
    await startRedisService();
  } else {
    spinner.succeed('Redis is running');
  }
  
  // Get Redis connection details
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'host',
      message: 'Redis host:',
      default: '127.0.0.1'
    },
    {
      type: 'input',
      name: 'port',
      message: 'Redis port:',
      default: 6379,
      validate: (input) => {
        const port = parseInt(input);
        return port > 0 && port < 65536 || 'Port must be between 1 and 65535';
      }
    },
    {
      type: 'confirm',
      name: 'migrate',
      message: 'Migrate existing JSON data to Redis?',
      default: true
    }
  ]);
  
  // Update global configuration
  const globalConfig = getGlobalConfig();
  const config = await globalConfig.load();
  
  config.stateManagement = {
    type: 'redis',
    redis: {
      host: answers.host,
      port: parseInt(answers.port),
      retryDelayOnFailover: 100,
      enableReadyCheck: false,
      maxRetriesPerRequest: 3
    }
  };
  
  await globalConfig.save(config);
  
  // Migrate data if requested
  if (answers.migrate) {
    await migrateJsonToRedis(config.stateManagement.redis);
  }
  
  console.log(chalk.green('\n✅ Redis mode enabled successfully\n'));
  console.log(chalk.gray('Note: Restart PoppoBuilder daemon for changes to take effect'));
}

/**
 * Disable Redis mode
 */
async function handleRedisDisable(options = {}) {
  console.log(chalk.blue('\n🔄 Disabling Redis mode...\n'));
  
  const { migrate } = await inquirer.prompt([{
    type: 'confirm',
    name: 'migrate',
    message: 'Migrate existing Redis data to JSON files?',
    default: true
  }]);
  
  // Get current Redis config before disabling
  const globalConfig = getGlobalConfig();
  const config = await globalConfig.load();
  const redisConfig = config.stateManagement?.redis;
  
  // Migrate data if requested
  if (migrate && redisConfig) {
    await migrateRedisToJson(redisConfig);
  }
  
  // Update configuration
  config.stateManagement = {
    type: 'file',
    file: {
      syncInterval: 5000,
      compactionInterval: 86400000
    }
  };
  
  await globalConfig.save(config);
  
  console.log(chalk.green('\n✅ Redis mode disabled successfully\n'));
  console.log(chalk.gray('Note: Restart PoppoBuilder daemon for changes to take effect'));
}

/**
 * Migrate JSON data to Redis
 */
async function migrateJsonToRedis(redisConfig) {
  const spinner = ora('Migrating data to Redis...').start();
  
  try {
    // Connect to Redis
    const redis = new Redis(redisConfig);
    
    // Wait for connection
    await redis.ping();
    
    // Get all registered projects
    const registry = getProjectRegistry();
    const projects = await registry.getAllProjects();
    
    let totalMigrated = 0;
    
    // Migrate each project's data
    for (const project of projects) {
      if (!project.enabled) continue;
      
      spinner.text = `Migrating project: ${project.config.name}`;
      
      const projectStateDir = path.join(project.path, '.poppo', 'state');
      
      // Migrate issue-status.json
      const issueStatusPath = path.join(projectStateDir, 'issue-status.json');
      if (await fileExists(issueStatusPath)) {
        const data = JSON.parse(await fs.readFile(issueStatusPath, 'utf8'));
        
        for (const [issueNumber, status] of Object.entries(data.issues || {})) {
          const key = `poppo:project:${project.id}:issue:${issueNumber}`;
          await redis.hset(key, {
            status: status.status,
            lastUpdated: status.lastUpdated,
            processId: status.processId || '',
            pid: status.pid || '',
            startTime: status.startTime || '',
            endTime: status.endTime || '',
            taskType: status.taskType || '',
            metadata: JSON.stringify(status.metadata || {})
          });
          
          // Set TTL for completed issues (7 days)
          if (status.status === 'completed' || status.status === 'error') {
            await redis.expire(key, 7 * 24 * 60 * 60);
          }
          
          totalMigrated++;
        }
      }
      
      // Migrate processed-issues.json
      const processedIssuesPath = path.join(projectStateDir, 'processed-issues.json');
      if (await fileExists(processedIssuesPath)) {
        const processed = JSON.parse(await fs.readFile(processedIssuesPath, 'utf8'));
        const key = `poppo:project:${project.id}:processed_issues`;
        
        for (const issueNumber of processed) {
          await redis.sadd(key, issueNumber);
        }
      }
      
      // Migrate processed-comments.json
      const processedCommentsPath = path.join(projectStateDir, 'processed-comments.json');
      if (await fileExists(processedCommentsPath)) {
        const comments = JSON.parse(await fs.readFile(processedCommentsPath, 'utf8'));
        
        for (const [issueNumber, commentIds] of Object.entries(comments)) {
          const key = `poppo:project:${project.id}:issue:${issueNumber}:processed_comments`;
          for (const commentId of commentIds) {
            await redis.sadd(key, commentId);
          }
        }
      }
    }
    
    // Mark migration as complete
    await redis.set('poppo:migration:json_to_redis', new Date().toISOString());
    
    await redis.quit();
    spinner.succeed(`Migration complete: ${totalMigrated} issues migrated`);
    
  } catch (error) {
    spinner.fail(`Migration failed: ${error.message}`);
    throw error;
  }
}

/**
 * Migrate Redis data to JSON
 */
async function migrateRedisToJson(redisConfig) {
  const spinner = ora('Migrating data from Redis to JSON...').start();
  
  try {
    // Connect to Redis
    const redis = new Redis(redisConfig);
    
    // Wait for connection
    await redis.ping();
    
    // Get all registered projects
    const registry = getProjectRegistry();
    const projects = await registry.getAllProjects();
    
    let totalMigrated = 0;
    
    // Migrate each project's data
    for (const project of projects) {
      if (!project.enabled) continue;
      
      spinner.text = `Migrating project: ${project.config.name}`;
      
      const projectStateDir = path.join(project.path, '.poppo', 'state');
      await fs.mkdir(projectStateDir, { recursive: true });
      
      // Migrate issue statuses
      const issueKeys = await redis.keys(`poppo:project:${project.id}:issue:*`);
      const issueStatuses = { issues: {}, lastSync: null };
      
      for (const key of issueKeys) {
        const match = key.match(/issue:(\d+)$/);
        if (!match || match[1].includes(':')) continue;
        
        const issueNumber = match[1];
        const data = await redis.hgetall(key);
        
        if (data.status) {
          issueStatuses.issues[issueNumber] = {
            status: data.status,
            lastUpdated: data.lastUpdated,
            processId: data.processId || null,
            pid: data.pid ? parseInt(data.pid) : null,
            startTime: data.startTime || null,
            endTime: data.endTime || null,
            taskType: data.taskType || null,
            metadata: data.metadata ? JSON.parse(data.metadata) : {}
          };
          totalMigrated++;
        }
      }
      
      // Write issue-status.json
      await fs.writeFile(
        path.join(projectStateDir, 'issue-status.json'),
        JSON.stringify(issueStatuses, null, 2)
      );
      
      // Migrate processed issues
      const processedKey = `poppo:project:${project.id}:processed_issues`;
      const processedIssues = await redis.smembers(processedKey);
      
      await fs.writeFile(
        path.join(projectStateDir, 'processed-issues.json'),
        JSON.stringify(processedIssues.map(n => parseInt(n)), null, 2)
      );
      
      // Migrate processed comments
      const commentKeys = await redis.keys(`poppo:project:${project.id}:issue:*:processed_comments`);
      const processedComments = {};
      
      for (const key of commentKeys) {
        const match = key.match(/issue:(\d+):processed_comments$/);
        if (match) {
          const issueNumber = match[1];
          const comments = await redis.smembers(key);
          if (comments.length > 0) {
            processedComments[issueNumber] = comments;
          }
        }
      }
      
      await fs.writeFile(
        path.join(projectStateDir, 'processed-comments.json'),
        JSON.stringify(processedComments, null, 2)
      );
    }
    
    // Mark migration as complete
    await redis.set('poppo:migration:redis_to_json', new Date().toISOString());
    
    await redis.quit();
    spinner.succeed(`Migration complete: ${totalMigrated} issues migrated`);
    
  } catch (error) {
    spinner.fail(`Migration failed: ${error.message}`);
    throw error;
  }
}

/**
 * Check Redis status
 */
async function checkRedisStatus() {
  try {
    const redis = new Redis({
      host: '127.0.0.1',
      port: 6379,
      connectTimeout: 1000,
      lazyConnect: true
    });
    
    await redis.connect();
    await redis.ping();
    await redis.quit();
    
    return { installed: true, running: true };
  } catch (error) {
    // Try to determine if Redis is installed but not running
    try {
      const { execSync } = require('child_process');
      execSync('which redis-server', { stdio: 'ignore' });
      return { installed: true, running: false };
    } catch {
      return { installed: false, running: false };
    }
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

/**
 * Start Redis service
 */
async function startRedisService() {
  const { execSync } = require('child_process');
  
  try {
    if (process.platform === 'darwin') {
      execSync('brew services start redis', { stdio: 'inherit' });
    } else if (process.platform === 'linux') {
      try {
        execSync('sudo systemctl start redis-server', { stdio: 'inherit' });
      } catch {
        execSync('sudo systemctl start redis', { stdio: 'inherit' });
      }
    }
    
    // Wait a moment for Redis to start
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify Redis is running
    const redis = new Redis({ lazyConnect: true, connectTimeout: 1000 });
    await redis.connect();
    await redis.ping();
    await redis.quit();
    
    return true;
  } catch (error) {
    throw new Error(`Failed to start Redis: ${error.message}`);
  }
}

module.exports = {
  handleRedisEnable,
  handleRedisDisable
};