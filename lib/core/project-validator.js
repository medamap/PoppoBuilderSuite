/**
 * Project Validator
 * Validates project configurations, dependencies, and environment requirements
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const EventEmitter = require('events');

class ProjectValidator extends EventEmitter {
  constructor() {
    super();
    this.validationRules = {
      // Required files
      requiredFiles: [
        'package.json'
      ],
      // Optional but recommended files
      recommendedFiles: [
        'README.md',
        '.gitignore',
        'LICENSE'
      ],
      // Validation checks
      checks: {
        packageJson: true,
        nodeVersion: true,
        dependencies: true,
        scripts: true,
        repository: true,
        poppoConfig: true
      }
    };
  }

  /**
   * Validate a project
   * @param {string} projectPath - Path to project directory
   * @param {Object} options - Validation options
   * @returns {Promise<Object>} Validation result
   */
  async validateProject(projectPath, options = {}) {
    const result = {
      valid: true,
      score: 100,
      issues: [],
      warnings: [],
      recommendations: [],
      checks: {},
      metadata: {
        projectPath,
        validatedAt: new Date().toISOString(),
        validator: 'ProjectValidator v1.0.0'
      }
    };

    try {
      // Check if directory exists
      const stat = await fs.stat(projectPath);
      if (!stat.isDirectory()) {
        result.valid = false;
        result.issues.push({
          type: 'error',
          code: 'NOT_DIRECTORY',
          message: 'Project path is not a directory',
          severity: 'critical'
        });
        return result;
      }

      // Run validation checks
      await this.checkRequiredFiles(projectPath, result);
      await this.checkPackageJson(projectPath, result);
      await this.checkNodeVersion(projectPath, result);
      await this.checkDependencies(projectPath, result);
      await this.checkPoppoConfiguration(projectPath, result);
      await this.checkRepository(projectPath, result);
      await this.checkRecommendedFiles(projectPath, result);

      // Calculate final score
      result.score = this.calculateScore(result);
      result.valid = result.score >= 60; // Minimum passing score

      this.emit('validation-complete', result);
      return result;

    } catch (error) {
      result.valid = false;
      result.score = 0;
      result.issues.push({
        type: 'error',
        code: 'VALIDATION_ERROR',
        message: `Validation failed: ${error.message}`,
        severity: 'critical'
      });
      this.emit('validation-error', error, result);
      return result;
    }
  }

  /**
   * Check for required files
   */
  async checkRequiredFiles(projectPath, result) {
    result.checks.requiredFiles = { passed: 0, total: this.validationRules.requiredFiles.length };

    for (const file of this.validationRules.requiredFiles) {
      const filePath = path.join(projectPath, file);
      try {
        await fs.access(filePath);
        result.checks.requiredFiles.passed++;
      } catch (error) {
        result.issues.push({
          type: 'error',
          code: 'MISSING_REQUIRED_FILE',
          message: `Required file missing: ${file}`,
          severity: 'critical', // Make this critical to ensure invalid result
          file
        });
      }
    }
  }

  /**
   * Check package.json validity
   */
  async checkPackageJson(projectPath, result) {
    const packageJsonPath = path.join(projectPath, 'package.json');
    
    try {
      const content = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(content);
      
      result.checks.packageJson = { valid: true, data: packageJson };

      // Check required fields
      const requiredFields = ['name', 'version'];
      for (const field of requiredFields) {
        if (!packageJson[field]) {
          result.issues.push({
            type: 'error',
            code: 'MISSING_PACKAGE_FIELD',
            message: `Missing required field in package.json: ${field}`,
            severity: 'medium',
            field
          });
        }
      }

      // Check recommended fields
      const recommendedFields = ['description', 'repository', 'author', 'license'];
      for (const field of recommendedFields) {
        if (!packageJson[field]) {
          result.recommendations.push({
            type: 'recommendation',
            code: 'MISSING_RECOMMENDED_FIELD',
            message: `Consider adding ${field} to package.json`,
            severity: 'low',
            field
          });
        }
      }

      // Check scripts
      if (packageJson.scripts) {
        const recommendedScripts = ['test', 'start'];
        for (const script of recommendedScripts) {
          if (!packageJson.scripts[script]) {
            result.recommendations.push({
              type: 'recommendation',
              code: 'MISSING_SCRIPT',
              message: `Consider adding '${script}' script to package.json`,
              severity: 'low',
              script
            });
          }
        }
      }

    } catch (error) {
      result.checks.packageJson = { valid: false, error: error.message };
      if (error.code === 'ENOENT') {
        // Already handled in required files check
      } else {
        result.issues.push({
          type: 'error',
          code: 'INVALID_PACKAGE_JSON',
          message: `Invalid package.json: ${error.message}`,
          severity: 'high'
        });
      }
    }
  }

  /**
   * Check Node.js version compatibility
   */
  async checkNodeVersion(projectPath, result) {
    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const content = await fs.readFile(packageJsonPath, 'utf8');
      const packageJson = JSON.parse(content);

      const currentVersion = process.version;
      result.checks.nodeVersion = {
        current: currentVersion,
        compatible: true
      };

      if (packageJson.engines && packageJson.engines.node) {
        const requiredVersion = packageJson.engines.node;
        result.checks.nodeVersion.required = requiredVersion;
        
        // Simple version check (could be enhanced with semver)
        if (!this.isVersionCompatible(currentVersion, requiredVersion)) {
          result.warnings.push({
            type: 'warning',
            code: 'NODE_VERSION_MISMATCH',
            message: `Node.js version mismatch. Required: ${requiredVersion}, Current: ${currentVersion}`,
            severity: 'medium'
          });
          result.checks.nodeVersion.compatible = false;
        }
      }

    } catch (error) {
      result.checks.nodeVersion = { error: error.message };
    }
  }

  /**
   * Check dependencies
   */
  async checkDependencies(projectPath, result) {
    try {
      const nodeModulesPath = path.join(projectPath, 'node_modules');
      const packageLockPath = path.join(projectPath, 'package-lock.json');
      
      result.checks.dependencies = {
        nodeModulesExists: false,
        packageLockExists: false,
        vulnerabilities: []
      };

      // Check if node_modules exists
      try {
        await fs.access(nodeModulesPath);
        result.checks.dependencies.nodeModulesExists = true;
      } catch (error) {
        result.warnings.push({
          type: 'warning',
          code: 'NO_NODE_MODULES',
          message: 'node_modules directory not found. Run npm install.',
          severity: 'medium'
        });
      }

      // Check if package-lock.json exists
      try {
        await fs.access(packageLockPath);
        result.checks.dependencies.packageLockExists = true;
      } catch (error) {
        result.recommendations.push({
          type: 'recommendation',
          code: 'NO_PACKAGE_LOCK',
          message: 'package-lock.json not found. Consider using npm ci for consistent builds.',
          severity: 'low'
        });
      }

      // TODO: Add vulnerability scanning with npm audit
      // This would require spawning npm audit and parsing results

    } catch (error) {
      result.checks.dependencies = { error: error.message };
    }
  }

  /**
   * Check PoppoBuilder configuration
   */
  async checkPoppoConfiguration(projectPath, result) {
    const poppoConfigPath = path.join(projectPath, '.poppo', 'config.json');
    
    result.checks.poppoConfig = {
      exists: false,
      valid: false,
      config: null
    };

    try {
      await fs.access(poppoConfigPath);
      result.checks.poppoConfig.exists = true;

      const content = await fs.readFile(poppoConfigPath, 'utf8');
      const config = JSON.parse(content);
      result.checks.poppoConfig.config = config;
      result.checks.poppoConfig.valid = true;

      // Validate PoppoBuilder specific configuration
      if (!config.github) {
        result.warnings.push({
          type: 'warning',
          code: 'MISSING_GITHUB_CONFIG',
          message: 'GitHub configuration missing in .poppo/config.json',
          severity: 'medium'
        });
      }

      if (!config.language || !config.language.primary) {
        result.warnings.push({
          type: 'warning',
          code: 'MISSING_LANGUAGE_CONFIG',
          message: 'Language configuration missing in .poppo/config.json',
          severity: 'low'
        });
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        result.recommendations.push({
          type: 'recommendation',
          code: 'NO_POPPO_CONFIG',
          message: 'PoppoBuilder configuration not found. Run poppo-builder init to create one.',
          severity: 'low'
        });
      } else {
        result.issues.push({
          type: 'error',
          code: 'INVALID_POPPO_CONFIG',
          message: `Invalid PoppoBuilder configuration: ${error.message}`,
          severity: 'medium'
        });
      }
    }
  }

  /**
   * Check repository configuration
   */
  async checkRepository(projectPath, result) {
    const gitPath = path.join(projectPath, '.git');
    
    result.checks.repository = {
      isGitRepo: false,
      hasRemote: false
    };

    try {
      await fs.access(gitPath);
      result.checks.repository.isGitRepo = true;

      // Check for remote (simplified check)
      try {
        const configPath = path.join(gitPath, 'config');
        const gitConfig = await fs.readFile(configPath, 'utf8');
        if (gitConfig.includes('[remote "origin"]')) {
          result.checks.repository.hasRemote = true;
        }
      } catch (error) {
        // Ignore git config read errors
      }

      if (!result.checks.repository.hasRemote) {
        result.recommendations.push({
          type: 'recommendation',
          code: 'NO_REMOTE_REPO',
          message: 'No remote repository configured. Consider adding one with git remote add.',
          severity: 'low'
        });
      }

    } catch (error) {
      result.recommendations.push({
        type: 'recommendation',
        code: 'NOT_GIT_REPO',
        message: 'Project is not a Git repository. Consider initializing with git init.',
        severity: 'low'
      });
    }
  }

  /**
   * Check for recommended files
   */
  async checkRecommendedFiles(projectPath, result) {
    result.checks.recommendedFiles = { found: 0, total: this.validationRules.recommendedFiles.length };

    for (const file of this.validationRules.recommendedFiles) {
      const filePath = path.join(projectPath, file);
      try {
        await fs.access(filePath);
        result.checks.recommendedFiles.found++;
      } catch (error) {
        result.recommendations.push({
          type: 'recommendation',
          code: 'MISSING_RECOMMENDED_FILE',
          message: `Consider adding ${file} to your project`,
          severity: 'low',
          file
        });
      }
    }
  }

  /**
   * Calculate overall project score
   */
  calculateScore(result) {
    let score = 100;

    // Deduct points for issues
    for (const issue of result.issues) {
      switch (issue.severity) {
        case 'critical':
          score -= 50; // Increase penalty for critical issues
          break;
        case 'high':
          score -= 20;
          break;
        case 'medium':
          score -= 10;
          break;
        case 'low':
          score -= 5;
          break;
      }
    }

    // Deduct points for warnings
    for (const warning of result.warnings) {
      switch (warning.severity) {
        case 'high':
          score -= 10;
          break;
        case 'medium':
          score -= 5;
          break;
        case 'low':
          score -= 2;
          break;
      }
    }

    // Bonus points for good practices
    if (result.checks.packageJson && result.checks.packageJson.valid) {
      score += 5;
    }
    if (result.checks.repository && result.checks.repository.isGitRepo) {
      score += 5;
    }
    if (result.checks.dependencies && result.checks.dependencies.packageLockExists) {
      score += 3;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Simple version compatibility check
   */
  isVersionCompatible(currentVersion, requiredVersion) {
    // Remove 'v' prefix if present
    const current = currentVersion.replace(/^v/, '');
    const required = requiredVersion.replace(/^v/, '').replace(/[^\d.]/g, '');
    
    // Simple major version check
    const currentMajor = parseInt(current.split('.')[0]);
    const requiredMajor = parseInt(required.split('.')[0]);
    
    return currentMajor >= requiredMajor;
  }

  /**
   * Get validation summary
   */
  getValidationSummary(result) {
    return {
      valid: result.valid,
      score: result.score,
      issueCount: result.issues.length,
      warningCount: result.warnings.length,
      recommendationCount: result.recommendations.length,
      grade: this.getGrade(result.score)
    };
  }

  /**
   * Get letter grade based on score
   */
  getGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  /**
   * Generate validation report
   */
  generateReport(result, format = 'text') {
    switch (format.toLowerCase()) {
      case 'json':
        return JSON.stringify(result, null, 2);
      case 'markdown':
        return this.generateMarkdownReport(result);
      default:
        return this.generateTextReport(result);
    }
  }

  /**
   * Generate text report
   */
  generateTextReport(result) {
    const lines = [];
    const summary = this.getValidationSummary(result);
    
    lines.push('Project Validation Report');
    lines.push('='.repeat(25));
    lines.push(`Project: ${result.metadata.projectPath}`);
    lines.push(`Score: ${result.score}/100 (${summary.grade})`);
    lines.push(`Status: ${result.valid ? 'VALID' : 'INVALID'}`);
    lines.push('');

    if (result.issues.length > 0) {
      lines.push('Issues:');
      for (const issue of result.issues) {
        lines.push(`  • [${issue.severity.toUpperCase()}] ${issue.message}`);
      }
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push('Warnings:');
      for (const warning of result.warnings) {
        lines.push(`  • ${warning.message}`);
      }
      lines.push('');
    }

    if (result.recommendations.length > 0) {
      lines.push('Recommendations:');
      for (const rec of result.recommendations) {
        lines.push(`  • ${rec.message}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate markdown report
   */
  generateMarkdownReport(result) {
    const lines = [];
    const summary = this.getValidationSummary(result);
    
    lines.push('# Project Validation Report');
    lines.push('');
    lines.push(`**Project:** ${result.metadata.projectPath}`);
    lines.push(`**Score:** ${result.score}/100 (${summary.grade})`);
    lines.push(`**Status:** ${result.valid ? '✅ VALID' : '❌ INVALID'}`);
    lines.push(`**Validated:** ${result.metadata.validatedAt}`);
    lines.push('');

    if (result.issues.length > 0) {
      lines.push('## Issues');
      for (const issue of result.issues) {
        const icon = issue.severity === 'critical' ? '🚨' : issue.severity === 'high' ? '⚠️' : '📍';
        lines.push(`- ${icon} **[${issue.severity.toUpperCase()}]** ${issue.message}`);
      }
      lines.push('');
    }

    if (result.warnings.length > 0) {
      lines.push('## Warnings');
      for (const warning of result.warnings) {
        lines.push(`- ⚠️ ${warning.message}`);
      }
      lines.push('');
    }

    if (result.recommendations.length > 0) {
      lines.push('## Recommendations');
      for (const rec of result.recommendations) {
        lines.push(`- 💡 ${rec.message}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }
}

module.exports = ProjectValidator;