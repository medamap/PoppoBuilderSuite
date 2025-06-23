/**
 * Legacy Compatibility Wrapper
 * 
 * Provides backwards compatibility for projects not yet migrated to global daemon
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const { spawn } = require('child_process');
const { IPCClient } = require('../daemon/ipc');
const DaemonState = require('../daemon/daemon-state');

class LegacyWrapper {
  constructor(options = {}) {
    this.projectPath = options.projectPath || process.cwd();
    this.legacyScript = options.legacyScript || this.findLegacyScript();
    this.autoMigrate = options.autoMigrate !== false;
    this.fallbackToLocal = options.fallbackToLocal !== false;
  }

  /**
   * Run PoppoBuilder with compatibility layer
   */
  async run(args = []) {
    try {
      console.log(chalk.blue('🔄 PoppoBuilder Compatibility Layer'));
      
      // Check if project is already migrated
      const isMigrated = await this.checkMigrationStatus();
      
      if (isMigrated) {
        console.log(chalk.green('✅ Project is migrated to global daemon'));
        return await this.runWithDaemon(args);
      }
      
      // Check if global daemon is available
      const daemonAvailable = await this.checkDaemonAvailability();
      
      if (daemonAvailable && this.autoMigrate) {
        console.log(chalk.yellow('🔄 Global daemon detected. Consider migrating this project.'));
        console.log(chalk.white('Run `poppobuilder migrate` to migrate this project.'));
        console.log(chalk.white('Falling back to local execution...\\n'));
      }
      
      // Run locally
      return await this.runLocally(args);
      
    } catch (error) {
      console.error(chalk.red('❌ Compatibility wrapper failed:'), error.message);
      
      if (this.fallbackToLocal && await this.legacyScriptExists()) {
        console.log(chalk.yellow('🔄 Falling back to local execution...'));
        return await this.runLocally(args);
      }
      
      throw error;
    }
  }

  /**
   * Check if project has been migrated
   */
  async checkMigrationStatus() {
    try {
      // Check package.json for migration marker
      const packageFile = path.join(this.projectPath, 'package.json');
      if (await this.fileExists(packageFile)) {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageJson = JSON.parse(packageContent);
        
        if (packageJson.poppobuilder?.migrated) {
          return true;
        }
      }
      
      // Check for migration wrapper file
      const wrapperFile = path.join(this.projectPath, 'minimal-poppo-wrapper.js');
      if (await this.fileExists(wrapperFile)) {
        return true;
      }
      
      return false;
      
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if global daemon is available
   */
  async checkDaemonAvailability() {
    try {
      const state = await DaemonState.checkExisting();
      if (!state) return false;
      
      // Try to connect
      const ipcClient = new IPCClient();
      await ipcClient.connect();
      await ipcClient.sendCommand('ping');
      await ipcClient.disconnect();
      
      return true;
      
    } catch (error) {
      return false;
    }
  }

  /**
   * Run using global daemon
   */
  async runWithDaemon(args) {
    try {
      // Get project ID from package.json
      const projectId = await this.getProjectId();
      
      if (!projectId) {
        throw new Error('Project ID not found. Re-run migration or register project manually.');
      }
      
      console.log(chalk.blue(`🚀 Running project '${projectId}' via global daemon`));
      
      // Check if project is registered
      const ipcClient = new IPCClient();
      await ipcClient.connect();
      
      const projectInfo = await ipcClient.sendCommand('get-project-info', { projectId });
      
      if (!projectInfo.project) {
        throw new Error(`Project '${projectId}' not registered with daemon. Run 'poppobuilder register' first.`);
      }
      
      // Handle different command types
      if (args.includes('--status') || args.includes('status')) {
        const status = await ipcClient.sendCommand('get-project-status', { projectId });
        console.log(JSON.stringify(status, null, 2));
        
      } else if (args.includes('--stop') || args.includes('stop')) {
        await ipcClient.sendCommand('stop-project', { projectId });
        console.log(chalk.green('✅ Project stopped'));
        
      } else if (args.includes('--restart') || args.includes('restart')) {
        await ipcClient.sendCommand('restart-project', { projectId });
        console.log(chalk.green('✅ Project restarted'));
        
      } else {
        // Default: start/run project
        const result = await ipcClient.sendCommand('start-project', { projectId });
        if (result.success) {
          console.log(chalk.green('✅ Project started via global daemon'));
        } else {
          throw new Error(result.error || 'Failed to start project');
        }
      }
      
      await ipcClient.disconnect();
      
    } catch (error) {
      throw new Error(`Daemon execution failed: ${error.message}`);
    }
  }

  /**
   * Run using local script
   */
  async runLocally(args) {
    if (!await this.legacyScriptExists()) {
      throw new Error(`Legacy script not found: ${this.legacyScript}`);
    }
    
    console.log(chalk.yellow('🏠 Running locally (legacy mode)'));
    console.log(chalk.gray(`Script: ${this.legacyScript}`));
    
    // Show migration suggestion
    if (await this.checkDaemonAvailability()) {
      console.log(chalk.blue('💡 Tip: Migrate to global daemon for better performance:'));
      console.log(chalk.white('   poppobuilder migrate'));
      console.log();
    }
    
    // Run legacy script
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [this.legacyScript, ...args], {
        stdio: 'inherit',
        cwd: this.projectPath,
        env: {
          ...process.env,
          POPPO_LEGACY_MODE: 'true'
        }
      });
      
      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Legacy script exited with code ${code}`));
        }
      });
      
      child.on('error', reject);
    });
  }

  /**
   * Find legacy PoppoBuilder script
   */
  findLegacyScript() {
    const possibleScripts = [
      'src/minimal-poppo.js',
      'lib/minimal-poppo.js',
      'minimal-poppo.js',
      'poppo.js',
      'index.js'
    ];
    
    for (const script of possibleScripts) {
      const fullPath = path.join(this.projectPath, script);
      if (fs.existsSync && fs.existsSync(fullPath)) {
        return fullPath;
      }
    }
    
    return null;
  }

  /**
   * Check if legacy script exists
   */
  async legacyScriptExists() {
    return this.legacyScript && await this.fileExists(this.legacyScript);
  }

  /**
   * Get project ID from package.json or migration marker
   */
  async getProjectId() {
    try {
      const packageFile = path.join(this.projectPath, 'package.json');
      if (await this.fileExists(packageFile)) {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageJson = JSON.parse(packageContent);
        
        if (packageJson.poppobuilder?.projectId) {
          return packageJson.poppobuilder.projectId;
        }
        
        // Fallback to sanitized name
        if (packageJson.name) {
          return packageJson.name.toLowerCase().replace(/[^a-z0-9-]/g, '-');
        }
      }
      
      // Fallback to directory name
      return path.basename(this.projectPath).toLowerCase().replace(/[^a-z0-9-]/g, '-');
      
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if file exists
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create wrapper script content
 */
function generateWrapperScript(options = {}) {
  const template = `#!/usr/bin/env node

/**
 * PoppoBuilder Compatibility Wrapper
 * 
 * This script provides backwards compatibility for projects not yet migrated
 * to the global PoppoBuilder daemon architecture.
 */

const path = require('path');
const { LegacyWrapper } = require('${options.wrapperPath || 'poppobuilder/lib/compatibility/legacy-wrapper'}');

async function main() {
  const wrapper = new LegacyWrapper({
    projectPath: __dirname,
    autoMigrate: ${options.autoMigrate !== false},
    fallbackToLocal: ${options.fallbackToLocal !== false}
  });
  
  try {
    await wrapper.run(process.argv.slice(2));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

// Show deprecation notice
console.log('⚠️  DEPRECATION NOTICE:');
console.log('This project is using legacy PoppoBuilder execution mode.');
console.log('Consider migrating to the global daemon for better performance:');
console.log('  npx poppobuilder migrate');
console.log('');

main().catch(console.error);
`;

  return template;
}

/**
 * Install compatibility wrapper in project
 */
async function installCompatibilityWrapper(projectPath, options = {}) {
  const wrapperScript = generateWrapperScript(options);
  const wrapperFile = path.join(projectPath, 'poppo-compat.js');
  
  await fs.writeFile(wrapperFile, wrapperScript);
  await fs.chmod(wrapperFile, 0o755);
  
  // Update package.json scripts
  const packageFile = path.join(projectPath, 'package.json');
  if (await fs.access(packageFile).then(() => true).catch(() => false)) {
    const packageContent = await fs.readFile(packageFile, 'utf8');
    const packageJson = JSON.parse(packageContent);
    
    // Backup original script
    if (packageJson.scripts && packageJson.scripts.start && !packageJson.scripts['start:original']) {
      packageJson.scripts['start:original'] = packageJson.scripts.start;
    }
    
    // Update start script to use wrapper
    if (!packageJson.scripts) packageJson.scripts = {};
    packageJson.scripts.start = 'node poppo-compat.js';
    packageJson.scripts['poppo:compat'] = 'node poppo-compat.js';
    
    await fs.writeFile(packageFile, JSON.stringify(packageJson, null, 2));
  }
  
  return wrapperFile;
}

module.exports = { 
  LegacyWrapper, 
  generateWrapperScript, 
  installCompatibilityWrapper 
};