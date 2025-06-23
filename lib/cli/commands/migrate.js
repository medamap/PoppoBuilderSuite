/**
 * PoppoBuilder Migration Tool
 * 
 * Migrates local PoppoBuilder projects to global daemon architecture
 */

const fs = require('fs').promises;
const path = require('path');
const inquirer = require('inquirer');
const chalk = require('chalk');
const { getInstance: getGlobalConfig } = require('../../core/global-config-manager');
const { getInstance: getProjectRegistry } = require('../../core/project-registry');

/**
 * Handle migrate command
 */
async function handleMigrate(projectPath, options) {
  try {
    const targetPath = projectPath ? path.resolve(projectPath) : process.cwd();
    
    console.log(chalk.blue('🔄 PoppoBuilder Migration Tool'));
    console.log(chalk.white(`Analyzing project at: ${targetPath}\n`));
    
    // Analyze the project
    const analysis = await analyzeProject(targetPath);
    
    if (!analysis.isPoppoBuilderProject) {
      console.error(chalk.red('❌ This does not appear to be a PoppoBuilder project'));
      console.log(chalk.white('Expected to find one of:'));
      console.log(chalk.white('  • src/minimal-poppo.js'));
      console.log(chalk.white('  • minimal-poppo.js'));
      console.log(chalk.white('  • .poppo/ directory'));
      process.exit(1);
    }
    
    // Display analysis
    await displayAnalysis(analysis);
    
    if (options.dryRun) {
      console.log(chalk.yellow('🔍 Dry run mode - no changes will be made'));
      await showMigrationPlan(analysis);
      return;
    }
    
    // Confirm migration
    if (!options.force) {
      const { proceed } = await inquirer.prompt([{
        type: 'confirm',
        name: 'proceed',
        message: 'Proceed with migration?',
        default: true
      }]);
      
      if (!proceed) {
        console.log(chalk.yellow('Migration cancelled.'));
        return;
      }
    }
    
    // Create backup if requested
    if (options.backup) {
      console.log(chalk.blue('📦 Creating backup...'));
      await createBackup(targetPath, analysis);
    }
    
    // Perform migration
    await performMigration(targetPath, analysis, options);
    
    console.log(chalk.green('\\n✅ Migration completed successfully!'));
    console.log(chalk.white('\\nNext steps:'));
    console.log(chalk.white('  • Run `poppobuilder start` to start the daemon'));
    console.log(chalk.white('  • Check status with `poppobuilder status`'));
    console.log(chalk.white('  • Use `poppobuilder list` to see registered projects'));
    
  } catch (error) {
    console.error(chalk.red('❌ Migration failed:'), error.message);
    if (options.verbose) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

/**
 * Analyze project for migration
 */
async function analyzeProject(projectPath) {
  const analysis = {
    path: projectPath,
    isPoppoBuilderProject: false,
    configFiles: [],
    dataFiles: [],
    logFiles: [],
    dependencies: {},
    scripts: {},
    issues: [],
    recommendations: []
  };
  
  try {
    // Check for PoppoBuilder files
    const poppoFiles = [
      'src/minimal-poppo.js',
      'lib/minimal-poppo.js', 
      'minimal-poppo.js',
      'poppo.js'
    ];
    
    for (const file of poppoFiles) {
      const filePath = path.join(projectPath, file);
      if (await fileExists(filePath)) {
        analysis.isPoppoBuilderProject = true;
        analysis.configFiles.push(file);
      }
    }
    
    // Check for .poppo directory
    const poppoDir = path.join(projectPath, '.poppo');
    if (await fileExists(poppoDir)) {
      analysis.isPoppoBuilderProject = true;
      analysis.configFiles.push('.poppo/');
      
      // Scan .poppo directory
      const poppoContents = await scanDirectory(poppoDir);
      analysis.configFiles.push(...poppoContents.map(f => `.poppo/${f}`));
    }
    
    // Check for package.json
    const packageFile = path.join(projectPath, 'package.json');
    if (await fileExists(packageFile)) {
      const packageContent = await fs.readFile(packageFile, 'utf8');
      const packageJson = JSON.parse(packageContent);
      
      analysis.dependencies = packageJson.dependencies || {};
      analysis.scripts = packageJson.scripts || {};
      
      // Check for PoppoBuilder-related dependencies
      if (packageJson.dependencies?.poppobuilder || 
          packageJson.devDependencies?.poppobuilder) {
        analysis.isPoppoBuilderProject = true;
      }
    }
    
    // Check for config files
    const configFiles = [
      'config/config.json',
      'config.json',
      'poppobuilder.config.js',
      '.env',
      '.env.local'
    ];
    
    for (const file of configFiles) {
      if (await fileExists(path.join(projectPath, file))) {
        analysis.configFiles.push(file);
      }
    }
    
    // Check for data files
    const dataPatterns = [
      'state/',
      'data/',
      'logs/',
      'cache/',
      'processed-*.json',
      'running-tasks.json',
      'issue-status.json'
    ];
    
    for (const pattern of dataPatterns) {
      const matches = await findFiles(projectPath, pattern);
      analysis.dataFiles.push(...matches);
    }
    
    // Check for log files
    const logPatterns = [
      '*.log',
      'logs/*.log',
      'poppo-*.log'
    ];
    
    for (const pattern of logPatterns) {
      const matches = await findFiles(projectPath, pattern);
      analysis.logFiles.push(...matches);
    }
    
    // Analyze for potential issues
    await analyzeIssues(analysis);
    
    // Generate recommendations
    await generateRecommendations(analysis);
    
  } catch (error) {
    analysis.issues.push(`Error analyzing project: ${error.message}`);
  }
  
  return analysis;
}

/**
 * Display project analysis
 */
async function displayAnalysis(analysis) {
  console.log(chalk.blue('📊 Project Analysis:'));
  console.log();
  
  // Basic info
  console.log(chalk.white(`${chalk.bold('Project Type:')} ${analysis.isPoppoBuilderProject ? chalk.green('PoppoBuilder Project ✓') : chalk.red('Not a PoppoBuilder Project ✗')}`));
  console.log();
  
  // Configuration files
  if (analysis.configFiles.length > 0) {
    console.log(chalk.white('📄 Configuration Files:'));
    for (const file of analysis.configFiles) {
      console.log(chalk.gray(`  • ${file}`));
    }
    console.log();
  }
  
  // Data files
  if (analysis.dataFiles.length > 0) {
    console.log(chalk.white('💾 Data Files:'));
    const displayFiles = analysis.dataFiles.slice(0, 10);
    for (const file of displayFiles) {
      console.log(chalk.gray(`  • ${file}`));
    }
    if (analysis.dataFiles.length > 10) {
      console.log(chalk.gray(`  ... and ${analysis.dataFiles.length - 10} more files`));
    }
    console.log();
  }
  
  // Scripts
  if (Object.keys(analysis.scripts).length > 0) {
    console.log(chalk.white('🔧 NPM Scripts:'));
    for (const [name, script] of Object.entries(analysis.scripts)) {
      if (name.includes('poppo') || name.includes('start') || name.includes('build')) {
        console.log(chalk.gray(`  • ${name}: ${script}`));
      }
    }
    console.log();
  }
  
  // Issues
  if (analysis.issues.length > 0) {
    console.log(chalk.yellow('⚠️  Issues Found:'));
    for (const issue of analysis.issues) {
      console.log(chalk.yellow(`  • ${issue}`));
    }
    console.log();
  }
  
  // Recommendations
  if (analysis.recommendations.length > 0) {
    console.log(chalk.blue('💡 Recommendations:'));
    for (const rec of analysis.recommendations) {
      console.log(chalk.blue(`  • ${rec}`));
    }
    console.log();
  }
}

/**
 * Show migration plan
 */
async function showMigrationPlan(analysis) {
  console.log(chalk.blue('🗂️  Migration Plan:'));
  console.log();
  
  console.log(chalk.white('1. Register project with global daemon'));
  console.log(chalk.white('2. Migrate configuration files to ~/.poppobuilder/'));
  console.log(chalk.white('3. Archive data files to global data directory'));
  console.log(chalk.white('4. Update package.json scripts (if needed)'));
  console.log(chalk.white('5. Create compatibility wrapper (optional)'));
  console.log();
  
  // Show what will be moved
  console.log(chalk.blue('📁 Files to be migrated:'));
  
  const configFiles = analysis.configFiles.filter(f => 
    f.includes('config') || f.includes('.poppo') || f.includes('.env')
  );
  
  if (configFiles.length > 0) {
    console.log(chalk.white('  Configuration:'));
    for (const file of configFiles) {
      console.log(chalk.gray(`    ${file} → ~/.poppobuilder/projects/[project-id]/`));
    }
  }
  
  const importantData = analysis.dataFiles.filter(f =>
    f.includes('processed') || f.includes('status') || f.includes('state')
  );
  
  if (importantData.length > 0) {
    console.log(chalk.white('  Important Data:'));
    for (const file of importantData) {
      console.log(chalk.gray(`    ${file} → ~/.poppobuilder/data/[project-id]/`));
    }
  }
}

/**
 * Create backup of current state
 */
async function createBackup(projectPath, analysis) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(projectPath, `poppo-backup-${timestamp}`);
  
  await fs.mkdir(backupDir, { recursive: true });
  
  // Backup configuration files
  for (const file of analysis.configFiles) {
    const srcPath = path.join(projectPath, file);
    const destPath = path.join(backupDir, file);
    
    try {
      if (await isDirectory(srcPath)) {
        await copyDirectory(srcPath, destPath);
      } else {
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(srcPath, destPath);
      }
    } catch (error) {
      console.log(chalk.yellow(`    Warning: Could not backup ${file}: ${error.message}`));
    }
  }
  
  // Backup data files
  for (const file of analysis.dataFiles.slice(0, 50)) { // Limit backup size
    const srcPath = path.join(projectPath, file);
    const destPath = path.join(backupDir, 'data', file);
    
    try {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
    } catch (error) {
      // Ignore errors for data files
    }
  }
  
  console.log(chalk.gray(`  Backup created: ${backupDir}`));
}

/**
 * Perform the actual migration
 */
async function performMigration(projectPath, analysis, options) {
  console.log(chalk.blue('🔄 Performing migration...'));
  
  // Step 1: Initialize global configuration if needed
  const globalConfig = getGlobalConfig();
  const registry = getProjectRegistry();
  
  try {
    await globalConfig.initialize();
    await registry.initialize();
  } catch (error) {
    console.log(chalk.yellow('  Global configuration not found. Run `poppobuilder init` first.'));
    throw new Error('Global configuration required');
  }
  
  // Step 2: Register project
  console.log(chalk.blue('  📝 Registering project...'));
  const projectInfo = await createProjectInfo(projectPath, analysis);
  await registry.registerProject(projectInfo.id, projectInfo);
  
  // Step 3: Migrate configuration
  console.log(chalk.blue('  ⚙️  Migrating configuration...'));
  await migrateConfiguration(projectPath, projectInfo, analysis);
  
  // Step 4: Migrate data
  console.log(chalk.blue('  💾 Migrating data...'));
  await migrateData(projectPath, projectInfo, analysis);
  
  // Step 5: Update project files
  if (!options.keepLocal) {
    console.log(chalk.blue('  🔧 Updating project files...'));
    await updateProjectFiles(projectPath, projectInfo, analysis, options);
  }
  
  console.log(chalk.gray(`  Project '${projectInfo.name}' registered with ID: ${projectInfo.id}`));
}

/**
 * Create project info from analysis
 */
async function createProjectInfo(projectPath, analysis) {
  // Try to get name from package.json
  let name = path.basename(projectPath);
  let version = '1.0.0';
  
  try {
    const packageFile = path.join(projectPath, 'package.json');
    const packageContent = await fs.readFile(packageFile, 'utf8');
    const packageJson = JSON.parse(packageContent);
    
    name = packageJson.name || name;
    version = packageJson.version || version;
  } catch (error) {
    // Use defaults
  }
  
  const id = name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  
  return {
    id,
    name,
    version,
    path: projectPath,
    config: {
      priority: 50,
      weight: 1.0,
      pollingInterval: 300000,
      enabled: true,
      migrated: true,
      migratedAt: new Date().toISOString()
    }
  };
}

/**
 * Migrate configuration files
 */
async function migrateConfiguration(projectPath, projectInfo, analysis) {
  const globalConfigDir = path.join(require('os').homedir(), '.poppobuilder');
  const projectConfigDir = path.join(globalConfigDir, 'projects', projectInfo.id);
  
  await fs.mkdir(projectConfigDir, { recursive: true });
  
  // Copy .poppo directory if it exists
  const poppoDir = path.join(projectPath, '.poppo');
  if (await fileExists(poppoDir)) {
    await copyDirectory(poppoDir, path.join(projectConfigDir, '.poppo'));
  }
  
  // Copy config files
  const configFiles = ['config.json', 'config/config.json', '.env'];
  for (const file of configFiles) {
    const srcPath = path.join(projectPath, file);
    if (await fileExists(srcPath)) {
      const destPath = path.join(projectConfigDir, path.basename(file));
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Migrate data files
 */
async function migrateData(projectPath, projectInfo, analysis) {
  const globalDataDir = path.join(require('os').homedir(), '.poppobuilder', 'data', projectInfo.id);
  
  await fs.mkdir(globalDataDir, { recursive: true });
  
  // Migrate important state files
  const stateFiles = analysis.dataFiles.filter(f =>
    f.includes('processed') || 
    f.includes('status') || 
    f.includes('state') ||
    f.includes('running-tasks')
  );
  
  for (const file of stateFiles) {
    const srcPath = path.join(projectPath, file);
    if (await fileExists(srcPath)) {
      const destPath = path.join(globalDataDir, path.basename(file));
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Update project files for daemon compatibility
 */
async function updateProjectFiles(projectPath, projectInfo, analysis, options) {
  // Update package.json scripts
  const packageFile = path.join(projectPath, 'package.json');
  if (await fileExists(packageFile)) {
    const packageContent = await fs.readFile(packageFile, 'utf8');
    const packageJson = JSON.parse(packageContent);
    
    // Update scripts to use global daemon
    if (packageJson.scripts) {
      if (packageJson.scripts.start && packageJson.scripts.start.includes('minimal-poppo')) {
        packageJson.scripts['start:local'] = packageJson.scripts.start;
        packageJson.scripts.start = `poppobuilder start`;
      }
      
      packageJson.scripts['poppo:status'] = 'poppobuilder status';
      packageJson.scripts['poppo:stop'] = 'poppobuilder stop';
    }
    
    // Add migration marker
    packageJson.poppobuilder = {
      ...packageJson.poppobuilder,
      migrated: true,
      migratedAt: new Date().toISOString(),
      projectId: projectInfo.id
    };
    
    await fs.writeFile(packageFile, JSON.stringify(packageJson, null, 2));
  }
  
  // Create compatibility wrapper
  const wrapperContent = `#!/usr/bin/env node
/**
 * PoppoBuilder Compatibility Wrapper
 * 
 * This project has been migrated to use the global PoppoBuilder daemon.
 * Use 'poppobuilder' commands instead of running this script directly.
 */

console.log('⚠️  This project has been migrated to use the global PoppoBuilder daemon.');
console.log('Use these commands instead:');
console.log('  poppobuilder start    # Start the daemon');
console.log('  poppobuilder status   # Check status');
console.log('  poppobuilder stop     # Stop the daemon');
console.log('');
console.log('Project ID: ${projectInfo.id}');
console.log('');
console.log('To run locally (not recommended):');
console.log('  npm run start:local');
`;

  const wrapperFile = path.join(projectPath, 'minimal-poppo-wrapper.js');
  await fs.writeFile(wrapperFile, wrapperContent);
  await fs.chmod(wrapperFile, 0o755);
}

// Utility functions

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(filePath) {
  try {
    const stats = await fs.stat(filePath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

async function scanDirectory(dirPath) {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

async function findFiles(basePath, pattern) {
  // Simple pattern matching - in production would use glob
  const files = [];
  
  try {
    if (pattern.endsWith('/')) {
      // Directory pattern
      const dirPath = path.join(basePath, pattern);
      if (await fileExists(dirPath)) {
        files.push(pattern);
      }
    } else if (pattern.includes('*')) {
      // Wildcard pattern - simplified implementation
      const dir = path.dirname(pattern) === '.' ? basePath : path.join(basePath, path.dirname(pattern));
      const filename = path.basename(pattern);
      
      if (await fileExists(dir)) {
        const dirContents = await fs.readdir(dir);
        for (const file of dirContents) {
          if (filename.replace('*', '').length === 0 || file.includes(filename.replace('*', ''))) {
            files.push(path.relative(basePath, path.join(dir, file)));
          }
        }
      }
    } else {
      // Exact file pattern
      const filePath = path.join(basePath, pattern);
      if (await fileExists(filePath)) {
        files.push(pattern);
      }
    }
  } catch (error) {
    // Ignore errors
  }
  
  return files;
}

async function copyDirectory(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const items = await fs.readdir(src);
  
  for (const item of items) {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    const stats = await fs.stat(srcPath);
    
    if (stats.isDirectory()) {
      await copyDirectory(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function analyzeIssues(analysis) {
  // Check for common issues
  if (!analysis.configFiles.some(f => f.includes('config'))) {
    analysis.issues.push('No configuration file found');
  }
  
  if (Object.keys(analysis.scripts).length === 0) {
    analysis.issues.push('No npm scripts found');
  }
  
  if (!analysis.dependencies.poppobuilder && !analysis.configFiles.some(f => f.includes('minimal-poppo'))) {
    analysis.issues.push('PoppoBuilder dependency not found');
  }
}

async function generateRecommendations(analysis) {
  if (analysis.dataFiles.length > 50) {
    analysis.recommendations.push('Large number of data files detected - consider cleanup');
  }
  
  if (analysis.logFiles.length > 10) {
    analysis.recommendations.push('Multiple log files found - consider log rotation');
  }
  
  if (!analysis.configFiles.some(f => f.includes('.poppo'))) {
    analysis.recommendations.push('Create .poppo directory for project-specific configuration');
  }
}

module.exports = { handleMigrate };