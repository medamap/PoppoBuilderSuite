/**
 * Migration Helper
 * 
 * Utilities to help with migrating from local to global PoppoBuilder
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

class MigrationHelper {
  /**
   * Detect if a directory contains a PoppoBuilder project
   */
  static async detectPoppoBuilderProject(projectPath) {
    const indicators = [
      'src/minimal-poppo.js',
      'lib/minimal-poppo.js',
      'minimal-poppo.js',
      '.poppo/',
      'poppo.config.js'
    ];
    
    const found = [];
    
    for (const indicator of indicators) {
      const fullPath = path.join(projectPath, indicator);
      if (await this.fileExists(fullPath)) {
        found.push(indicator);
      }
    }
    
    // Check package.json for PoppoBuilder dependency
    const packageFile = path.join(projectPath, 'package.json');
    if (await this.fileExists(packageFile)) {
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageJson = JSON.parse(packageContent);
        
        if (packageJson.dependencies?.poppobuilder || 
            packageJson.devDependencies?.poppobuilder) {
          found.push('package.json (dependency)');
        }
        
        if (packageJson.scripts) {
          for (const [name, script] of Object.entries(packageJson.scripts)) {
            if (script.includes('minimal-poppo') || script.includes('poppo')) {
              found.push(`package.json (script: ${name})`);
              break;
            }
          }
        }
      } catch (error) {
        // Ignore invalid package.json
      }
    }
    
    return {
      isPoppoBuilderProject: found.length > 0,
      indicators: found,
      confidence: this.calculateConfidence(found)
    };
  }

  /**
   * Calculate confidence level for detection
   */
  static calculateConfidence(indicators) {
    const weights = {
      'src/minimal-poppo.js': 0.4,
      'lib/minimal-poppo.js': 0.4,
      'minimal-poppo.js': 0.5,
      '.poppo/': 0.3,
      'poppo.config.js': 0.2,
      'package.json (dependency)': 0.3,
      'package.json (script: start)': 0.2
    };
    
    let totalWeight = 0;
    for (const indicator of indicators) {
      const weight = weights[indicator] || weights[indicator.split(' ')[0]] || 0.1;
      totalWeight += weight;
    }
    
    return Math.min(1, totalWeight);
  }

  /**
   * Check if project has been migrated
   */
  static async checkMigrationStatus(projectPath) {
    const status = {
      migrated: false,
      partial: false,
      markers: []
    };
    
    // Check package.json migration marker
    const packageFile = path.join(projectPath, 'package.json');
    if (await this.fileExists(packageFile)) {
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageJson = JSON.parse(packageContent);
        
        if (packageJson.poppobuilder?.migrated) {
          status.migrated = true;
          status.markers.push('package.json marker');
        }
        
        if (packageJson.poppobuilder?.projectId) {
          status.partial = true;
          status.markers.push('project ID in package.json');
        }
      } catch (error) {
        // Ignore
      }
    }
    
    // Check for wrapper files
    const wrapperFiles = [
      'minimal-poppo-wrapper.js',
      'poppo-compat.js'
    ];
    
    for (const file of wrapperFiles) {
      if (await this.fileExists(path.join(projectPath, file))) {
        status.partial = true;
        status.markers.push(file);
      }
    }
    
    // Check for global project registration
    try {
      const { getInstance: getProjectRegistry } = require('../core/project-registry');
      const registry = getProjectRegistry();
      await registry.initialize();
      
      const projectId = await this.guessProjectId(projectPath);
      if (projectId && registry.getProject(projectId)) {
        status.migrated = true;
        status.markers.push('registered with daemon');
      }
    } catch (error) {
      // Global registry not available
    }
    
    return status;
  }

  /**
   * Guess project ID from path and package.json
   */
  static async guessProjectId(projectPath) {
    // Try package.json first
    const packageFile = path.join(projectPath, 'package.json');
    if (await this.fileExists(packageFile)) {
      try {
        const packageContent = await fs.readFile(packageFile, 'utf8');
        const packageJson = JSON.parse(packageContent);
        
        if (packageJson.poppobuilder?.projectId) {
          return packageJson.poppobuilder.projectId;
        }
        
        if (packageJson.name) {
          return this.sanitizeProjectId(packageJson.name);
        }
      } catch (error) {
        // Ignore
      }
    }
    
    // Fallback to directory name
    return this.sanitizeProjectId(path.basename(projectPath));
  }

  /**
   * Sanitize project ID
   */
  static sanitizeProjectId(input) {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  /**
   * Generate migration plan
   */
  static async generateMigrationPlan(projectPath) {
    const detection = await this.detectPoppoBuilderProject(projectPath);
    const migrationStatus = await this.checkMigrationStatus(projectPath);
    
    const plan = {
      projectPath,
      detection,
      migrationStatus,
      steps: [],
      estimatedTime: 0,
      requirements: []
    };
    
    if (migrationStatus.migrated) {
      plan.steps.push({
        type: 'info',
        title: 'Project already migrated',
        description: 'No migration needed',
        duration: 0
      });
      return plan;
    }
    
    if (!detection.isPoppoBuilderProject) {
      plan.steps.push({
        type: 'error',
        title: 'Not a PoppoBuilder project',
        description: 'Cannot migrate non-PoppoBuilder project',
        duration: 0
      });
      return plan;
    }
    
    // Step 1: Initialize global configuration
    plan.steps.push({
      type: 'setup',
      title: 'Initialize global configuration',
      description: 'Set up ~/.poppobuilder directory and configuration',
      duration: 30,
      command: 'poppobuilder init'
    });
    plan.requirements.push('Global PoppoBuilder installation');
    
    // Step 2: Analyze project
    plan.steps.push({
      type: 'analysis',
      title: 'Analyze project structure',
      description: 'Scan configuration files, data, and dependencies',
      duration: 10
    });
    
    // Step 3: Create backup
    plan.steps.push({
      type: 'backup',
      title: 'Create project backup',
      description: 'Backup existing configuration and data files',
      duration: 15
    });
    
    // Step 4: Register project
    plan.steps.push({
      type: 'register',
      title: 'Register with global daemon',
      description: 'Add project to global project registry',
      duration: 5,
      command: 'poppobuilder register'
    });
    
    // Step 5: Migrate configuration
    plan.steps.push({
      type: 'config',
      title: 'Migrate configuration',
      description: 'Move configuration files to global location',
      duration: 10
    });
    
    // Step 6: Migrate data
    plan.steps.push({
      type: 'data',
      title: 'Migrate data files',
      description: 'Move state and log files to global location',
      duration: 20
    });
    
    // Step 7: Update project files
    plan.steps.push({
      type: 'update',
      title: 'Update project files',
      description: 'Update package.json and create compatibility wrapper',
      duration: 10
    });
    
    // Step 8: Test migration
    plan.steps.push({
      type: 'test',
      title: 'Test migration',
      description: 'Verify project works with global daemon',
      duration: 30,
      command: 'poppobuilder start && poppobuilder status'
    });
    
    plan.estimatedTime = plan.steps.reduce((total, step) => total + step.duration, 0);
    
    return plan;
  }

  /**
   * Display migration plan
   */
  static displayMigrationPlan(plan) {
    console.log(chalk.blue('📋 Migration Plan'));
    console.log();
    
    // Project info
    console.log(chalk.white(`${chalk.bold('Project:')} ${plan.projectPath}`));
    console.log(chalk.white(`${chalk.bold('Confidence:')} ${Math.round(plan.detection.confidence * 100)}%`));
    console.log(chalk.white(`${chalk.bold('Estimated Time:')} ${plan.estimatedTime} seconds`));
    console.log();
    
    // Requirements
    if (plan.requirements.length > 0) {
      console.log(chalk.blue('📋 Requirements:'));
      for (const req of plan.requirements) {
        console.log(chalk.gray(`  • ${req}`));
      }
      console.log();
    }
    
    // Steps
    console.log(chalk.blue('🔄 Migration Steps:'));
    for (let i = 0; i < plan.steps.length; i++) {
      const step = plan.steps[i];
      const stepNum = i + 1;
      
      let icon = '•';
      let color = 'white';
      
      switch (step.type) {
        case 'setup': icon = '🔧'; break;
        case 'analysis': icon = '🔍'; break;
        case 'backup': icon = '📦'; break;
        case 'register': icon = '📝'; break;
        case 'config': icon = '⚙️'; break;
        case 'data': icon = '💾'; break;
        case 'update': icon = '🔄'; break;
        case 'test': icon = '🧪'; break;
        case 'error': icon = '❌'; color = 'red'; break;
        case 'info': icon = 'ℹ️'; color = 'blue'; break;
      }
      
      console.log(chalk[color](`  ${stepNum}. ${icon} ${step.title}`));
      console.log(chalk.gray(`     ${step.description}`));
      
      if (step.command) {
        console.log(chalk.gray(`     Command: ${step.command}`));
      }
      
      if (step.duration > 0) {
        console.log(chalk.gray(`     Duration: ~${step.duration}s`));
      }
      
      console.log();
    }
  }

  /**
   * Check file exists
   */
  static async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = { MigrationHelper };