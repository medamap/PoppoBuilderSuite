/**
 * Configuration Migration
 * Migrates project configurations to global configuration
 */

const fs = require('fs').promises;
const path = require('path');
const { GlobalConfigManager, getInstance } = require('./global-config-manager');
const chalk = require('chalk');

class ConfigMigration {
  constructor() {
    this.globalConfigManager = getInstance();
    this.migratedSettings = [];
    this.warnings = [];
  }

  /**
   * Migrate configuration from project to global
   * @param {string} projectPath - Path to project directory
   * @param {Object} options - Migration options
   * @returns {Promise<Object>} Migration results
   */
  async migrateProject(projectPath, options = {}) {
    const results = {
      success: false,
      projectPath,
      migratedSettings: [],
      warnings: [],
      errors: []
    };

    try {
      // Ensure global config is initialized
      await this.globalConfigManager.initialize();

      // Find project config file
      const configPaths = [
        path.join(projectPath, '.poppo', 'config.json'),
        path.join(projectPath, 'config', 'config.json'),
        path.join(projectPath, 'poppobuilder.config.json')
      ];

      let projectConfig = null;
      let configPath = null;

      for (const testPath of configPaths) {
        try {
          const content = await fs.readFile(testPath, 'utf-8');
          projectConfig = JSON.parse(content);
          configPath = testPath;
          break;
        } catch {}
      }

      if (!projectConfig) {
        throw new Error('No project configuration found');
      }

      console.log(chalk.blue('Found project config:'), chalk.gray(configPath));

      // Analyze and migrate settings
      const migration = this.analyzeConfig(projectConfig);
      
      // Apply global settings
      if (migration.globalSettings && Object.keys(migration.globalSettings).length > 0) {
        console.log(chalk.yellow('\nMigrating global settings:'));
        
        for (const [key, value] of Object.entries(migration.globalSettings)) {
          try {
            await this.globalConfigManager.set(key, value);
            console.log(chalk.green('  ✓'), `${key} = ${JSON.stringify(value)}`);
            results.migratedSettings.push({ key, value });
          } catch (error) {
            console.error(chalk.red('  ✗'), `${key}: ${error.message}`);
            results.errors.push({ key, error: error.message });
          }
        }
      }

      // Create cleaned project config
      if (!options.dryRun) {
        const cleanedConfig = migration.projectSettings;
        
        // Backup original config
        const backupPath = configPath + '.pre-migration';
        await fs.writeFile(backupPath, JSON.stringify(projectConfig, null, 2));
        console.log(chalk.gray('\nOriginal config backed up to:'), backupPath);
        
        // Write cleaned config
        await fs.writeFile(configPath, JSON.stringify(cleanedConfig, null, 2));
        console.log(chalk.green('✓'), 'Project config updated with local settings only');
      }

      // Add warnings
      results.warnings = migration.warnings;
      if (migration.warnings.length > 0) {
        console.log(chalk.yellow('\nWarnings:'));
        migration.warnings.forEach(warning => {
          console.log(chalk.yellow('  ⚠'), warning);
        });
      }

      results.success = true;
      return results;

    } catch (error) {
      results.errors.push({ general: error.message });
      throw error;
    }
  }

  /**
   * Analyze configuration and separate global from project settings
   * @param {Object} config - Project configuration
   * @returns {Object} Analysis results
   */
  analyzeConfig(config) {
    const globalSettings = {};
    const projectSettings = {};
    const warnings = [];

    // Define what belongs in global config
    const globalKeys = {
      // Daemon settings
      'maxConcurrentProcesses': 'daemon.maxProcesses',
      'maxProcesses': 'daemon.maxProcesses',
      'schedulingStrategy': 'daemon.schedulingStrategy',
      'daemonPort': 'daemon.port',
      
      // Resource limits
      'maxMemory': 'resources.maxMemoryMB',
      'maxCpu': 'resources.maxCpuPercent',
      
      // Default timeouts and intervals
      'pollingInterval': 'defaults.pollingInterval',
      'checkInterval': 'defaults.pollingInterval',
      'timeout': 'defaults.timeout',
      'defaultTimeout': 'defaults.timeout',
      'retryAttempts': 'defaults.retryAttempts',
      'retryDelay': 'defaults.retryDelay',
      
      // Logging
      'logLevel': 'logging.level',
      'logging.level': 'logging.level',
      'logDirectory': 'logging.directory',
      
      // Updates
      'checkForUpdates': 'updates.checkForUpdates',
      'autoUpdate': 'updates.autoUpdate'
    };

    // Process each config key
    for (const [key, value] of Object.entries(config)) {
      if (key === 'version') {
        // Skip version
        continue;
      }

      // Check if this is a global setting
      let isGlobal = false;
      let globalKey = null;

      // Direct mapping
      if (globalKeys[key]) {
        isGlobal = true;
        globalKey = globalKeys[key];
      }

      // Nested object handling
      if (typeof value === 'object' && !Array.isArray(value)) {
        if (key === 'claude') {
          // Claude settings - some are global
          if (value.maxConcurrent !== undefined) {
            globalSettings['daemon.maxProcesses'] = value.maxConcurrent;
          }
          if (value.timeout !== undefined) {
            globalSettings['defaults.timeout'] = value.timeout;
          }
          if (value.maxRetries !== undefined) {
            globalSettings['defaults.retryAttempts'] = value.maxRetries;
          }
          if (value.retryDelay !== undefined) {
            globalSettings['defaults.retryDelay'] = value.retryDelay;
          }
          
          // Keep command in project config
          const projectClaude = {};
          if (value.command) projectClaude.command = value.command;
          if (Object.keys(projectClaude).length > 0) {
            projectSettings.claude = projectClaude;
          }
          continue;
        }

        if (key === 'dashboard') {
          // Dashboard settings are mostly project-specific
          projectSettings[key] = value;
          continue;
        }

        if (key === 'github') {
          // GitHub settings are project-specific
          projectSettings[key] = value;
          continue;
        }

        if (key === 'language') {
          // Language can be both
          if (value.primary && !projectSettings.language) {
            projectSettings.language = { primary: value.primary };
          }
          if (value.fallback) {
            projectSettings.language = projectSettings.language || {};
            projectSettings.language.fallback = value.fallback;
          }
          continue;
        }
      }

      if (isGlobal && globalKey) {
        globalSettings[globalKey] = value;
        warnings.push(`Moving '${key}' to global config as '${globalKey}'`);
      } else {
        // Keep in project config
        projectSettings[key] = value;
      }
    }

    // Ensure project has required fields
    if (!projectSettings.github) {
      warnings.push('Project configuration missing required GitHub settings');
    }

    return {
      globalSettings,
      projectSettings,
      warnings
    };
  }

  /**
   * Scan directory for projects to migrate
   * @param {string} scanPath - Directory to scan
   * @param {Object} options - Scan options
   * @returns {Promise<Array>} Found projects
   */
  async scanForProjects(scanPath, options = {}) {
    const projects = [];
    
    try {
      const entries = await fs.readdir(scanPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.')) continue;
        
        const projectPath = path.join(scanPath, entry.name);
        
        // Check for PoppoBuilder config
        const configPaths = [
          path.join(projectPath, '.poppo', 'config.json'),
          path.join(projectPath, 'config', 'config.json'),
          path.join(projectPath, 'poppobuilder.config.json')
        ];
        
        for (const configPath of configPaths) {
          try {
            await fs.access(configPath);
            projects.push({
              name: entry.name,
              path: projectPath,
              configPath
            });
            break;
          } catch {}
        }
        
        // Recursive scan if requested
        if (options.recursive && projects.length < (options.maxProjects || 100)) {
          const subProjects = await this.scanForProjects(projectPath, {
            ...options,
            depth: (options.depth || 0) + 1
          });
          projects.push(...subProjects);
        }
      }
    } catch (error) {
      console.error(chalk.red('Error scanning directory:'), error.message);
    }
    
    return projects;
  }

  /**
   * Create migration report
   * @param {Array} results - Migration results
   * @returns {string} Report text
   */
  createReport(results) {
    let report = chalk.blue.bold('Configuration Migration Report\n');
    report += chalk.gray('='.repeat(50)) + '\n\n';
    
    let successCount = 0;
    let errorCount = 0;
    let totalMigrated = 0;
    
    for (const result of results) {
      if (result.success) {
        successCount++;
        totalMigrated += result.migratedSettings.length;
      } else {
        errorCount++;
      }
      
      report += chalk.yellow(`Project: ${result.projectPath}\n`);
      
      if (result.success) {
        report += chalk.green(`  ✓ Success - Migrated ${result.migratedSettings.length} settings\n`);
        
        if (result.warnings.length > 0) {
          report += chalk.yellow(`  Warnings:\n`);
          result.warnings.forEach(warning => {
            report += `    - ${warning}\n`;
          });
        }
      } else {
        report += chalk.red(`  ✗ Failed\n`);
        result.errors.forEach(error => {
          report += chalk.red(`    - ${JSON.stringify(error)}\n`);
        });
      }
      
      report += '\n';
    }
    
    report += chalk.gray('='.repeat(50)) + '\n';
    report += chalk.green(`Successfully migrated: ${successCount} projects\n`);
    report += chalk.cyan(`Total settings migrated: ${totalMigrated}\n`);
    
    if (errorCount > 0) {
      report += chalk.red(`Failed: ${errorCount} projects\n`);
    }
    
    return report;
  }
}

module.exports = ConfigMigration;