/**
 * Project Health Tracker
 * Monitors project health status, tracks metrics, and provides health insights
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const EventEmitter = require('events');

class ProjectHealthTracker extends EventEmitter {
  constructor() {
    super();
    this.healthDataPath = path.join(os.homedir(), '.poppobuilder', 'health');
    this.healthMetrics = new Map();
    this.healthHistory = new Map();
    this.checkInterval = 5 * 60 * 1000; // 5 minutes
    this.maxHistoryEntries = 100;
    this.runningChecks = new Set();
  }

  /**
   * Initialize health tracker
   */
  async initialize() {
    try {
      // Ensure health data directory exists
      await fs.mkdir(this.healthDataPath, { recursive: true });
      
      // Load existing health data
      await this.loadHealthData();
      
      this.emit('initialized');
    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Track health for a project
   * @param {string} projectId - Project identifier
   * @param {string} projectPath - Path to project directory
   * @param {Object} options - Tracking options
   */
  async trackProject(projectId, projectPath, options = {}) {
    if (this.runningChecks.has(projectId)) {
      return; // Already tracking this project
    }

    this.runningChecks.add(projectId);

    try {
      const healthData = await this.performHealthCheck(projectId, projectPath, options);
      
      // Store current health data
      this.healthMetrics.set(projectId, healthData);
      
      // Add to history
      this.addToHistory(projectId, healthData);
      
      // Save to disk
      await this.saveHealthData(projectId);
      
      this.emit('health-updated', projectId, healthData);
      
      return healthData;
    } catch (error) {
      this.emit('health-check-error', projectId, error);
      throw error;
    } finally {
      this.runningChecks.delete(projectId);
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(projectId, projectPath, options = {}) {
    const healthData = {
      projectId,
      projectPath,
      timestamp: new Date().toISOString(),
      overall: {
        status: 'unknown',
        score: 0,
        grade: 'F'
      },
      metrics: {
        availability: await this.checkAvailability(projectPath),
        performance: await this.checkPerformance(projectPath),
        security: await this.checkSecurity(projectPath),
        maintenance: await this.checkMaintenance(projectPath),
        dependencies: await this.checkDependencyHealth(projectPath),
        repository: await this.checkRepositoryHealth(projectPath),
        configuration: await this.checkConfigurationHealth(projectPath)
      },
      alerts: [],
      trends: this.calculateTrends(projectId),
      recommendations: []
    };

    // Calculate overall health
    healthData.overall = this.calculateOverallHealth(healthData.metrics);
    
    // Generate alerts
    healthData.alerts = this.generateAlerts(healthData);
    
    // Generate recommendations
    healthData.recommendations = this.generateRecommendations(healthData);

    return healthData;
  }

  /**
   * Check project availability
   */
  async checkAvailability(projectPath) {
    const metrics = {
      score: 100,
      accessible: false,
      lastSeen: null,
      uptime: 0,
      errors: []
    };

    try {
      // Check if project directory is accessible
      const stat = await fs.stat(projectPath);
      metrics.accessible = stat.isDirectory();
      metrics.lastSeen = new Date().toISOString();
      
      if (metrics.accessible) {
        metrics.score = 100;
      } else {
        metrics.score = 0;
        metrics.errors.push('Project directory not accessible');
      }
    } catch (error) {
      metrics.accessible = false;
      metrics.score = 0;
      metrics.errors.push(`Access error: ${error.message}`);
    }

    return metrics;
  }

  /**
   * Check project performance metrics
   */
  async checkPerformance(projectPath) {
    const metrics = {
      score: 80,
      buildTime: null,
      bundleSize: null,
      testDuration: null,
      memoryUsage: null,
      errors: []
    };

    try {
      // Check package.json for performance indicators
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      // Estimate based on dependencies
      const depCount = Object.keys(packageJson.dependencies || {}).length;
      const devDepCount = Object.keys(packageJson.devDependencies || {}).length;
      
      // Simple scoring based on dependency count
      if (depCount + devDepCount > 100) {
        metrics.score = 60;
        metrics.errors.push('High dependency count may impact performance');
      } else if (depCount + devDepCount > 50) {
        metrics.score = 70;
      }

      // Check for performance-related packages
      const performancePackages = ['webpack', 'rollup', 'parcel', 'esbuild'];
      const hasPerformanceTools = performancePackages.some(pkg => 
        packageJson.dependencies?.[pkg] || packageJson.devDependencies?.[pkg]
      );
      
      if (hasPerformanceTools) {
        metrics.score += 10;
      }

    } catch (error) {
      metrics.errors.push(`Performance check error: ${error.message}`);
      metrics.score = 50;
    }

    return metrics;
  }

  /**
   * Check security status
   */
  async checkSecurity(projectPath) {
    const metrics = {
      score: 75,
      vulnerabilities: [],
      securityFiles: {
        hasGitignore: false,
        hasLicense: false,
        hasSecurityMd: false
      },
      lastSecurityScan: null,
      errors: []
    };

    try {
      // Check for security-related files
      const securityFiles = [
        { file: '.gitignore', key: 'hasGitignore' },
        { file: 'LICENSE', key: 'hasLicense' },
        { file: 'SECURITY.md', key: 'hasSecurityMd' }
      ];

      for (const { file, key } of securityFiles) {
        try {
          await fs.access(path.join(projectPath, file));
          metrics.securityFiles[key] = true;
          metrics.score += 5;
        } catch (error) {
          // File doesn't exist
        }
      }

      // Check package.json for security indicators
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      // Check for security-related scripts
      if (packageJson.scripts?.audit || packageJson.scripts?.security) {
        metrics.score += 10;
      }

      // TODO: Integration with npm audit for real vulnerability scanning
      // This would require spawning npm audit and parsing results

    } catch (error) {
      metrics.errors.push(`Security check error: ${error.message}`);
      metrics.score = 40;
    }

    return metrics;
  }

  /**
   * Check maintenance status
   */
  async checkMaintenance(projectPath) {
    const metrics = {
      score: 70,
      lastCommit: null,
      commitFrequency: 'unknown',
      branchCount: 0,
      issuesOpen: 0,
      staleness: 0,
      errors: []
    };

    try {
      // Check Git repository status
      const gitPath = path.join(projectPath, '.git');
      await fs.access(gitPath);

      // Read git logs (simplified)
      try {
        const gitLogPath = path.join(gitPath, 'logs', 'HEAD');
        const gitLog = await fs.readFile(gitLogPath, 'utf8');
        const logLines = gitLog.trim().split('\n');
        
        if (logLines.length > 0) {
          const lastLine = logLines[logLines.length - 1];
          const timestamp = lastLine.split(' ')[4];
          metrics.lastCommit = new Date(parseInt(timestamp) * 1000).toISOString();
          
          // Calculate staleness
          const daysSinceLastCommit = (Date.now() - parseInt(timestamp) * 1000) / (1000 * 60 * 60 * 24);
          metrics.staleness = daysSinceLastCommit;
          
          if (daysSinceLastCommit > 30) {
            metrics.score -= 20;
          } else if (daysSinceLastCommit > 7) {
            metrics.score -= 10;
          }
        }
      } catch (error) {
        metrics.errors.push('Could not read git history');
      }

    } catch (error) {
      metrics.errors.push('Not a git repository');
      metrics.score = 40;
    }

    return metrics;
  }

  /**
   * Check dependency health
   */
  async checkDependencyHealth(projectPath) {
    const metrics = {
      score: 80,
      outdated: [],
      vulnerable: [],
      totalDependencies: 0,
      devDependencies: 0,
      lastUpdate: null,
      errors: []
    };

    try {
      const packageJsonPath = path.join(projectPath, 'package.json');
      const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
      
      metrics.totalDependencies = Object.keys(packageJson.dependencies || {}).length;
      metrics.devDependencies = Object.keys(packageJson.devDependencies || {}).length;

      // Check if package-lock.json exists and is recent
      try {
        const packageLockPath = path.join(projectPath, 'package-lock.json');
        const stat = await fs.stat(packageLockPath);
        metrics.lastUpdate = stat.mtime.toISOString();
        
        const daysSinceUpdate = (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceUpdate > 30) {
          metrics.score -= 15;
        }
      } catch (error) {
        metrics.errors.push('No package-lock.json found');
        metrics.score -= 10;
      }

      // TODO: Check for outdated and vulnerable packages
      // This would require integration with npm outdated and npm audit

    } catch (error) {
      metrics.errors.push(`Dependency check error: ${error.message}`);
      metrics.score = 30;
    }

    return metrics;
  }

  /**
   * Check repository health
   */
  async checkRepositoryHealth(projectPath) {
    const metrics = {
      score: 75,
      hasRemote: false,
      defaultBranch: 'unknown',
      untracked: 0,
      uncommitted: 0,
      unpushed: 0,
      errors: []
    };

    try {
      const gitPath = path.join(projectPath, '.git');
      await fs.access(gitPath);

      // Check for remote
      try {
        const configPath = path.join(gitPath, 'config');
        const gitConfig = await fs.readFile(configPath, 'utf8');
        metrics.hasRemote = gitConfig.includes('[remote "origin"]');
        
        if (metrics.hasRemote) {
          metrics.score += 15;
        }
      } catch (error) {
        metrics.errors.push('Could not read git config');
      }

      // TODO: Check for uncommitted changes, untracked files
      // This would require running git status and parsing output

    } catch (error) {
      metrics.errors.push('Not a git repository');
      metrics.score = 30;
    }

    return metrics;
  }

  /**
   * Check configuration health
   */
  async checkConfigurationHealth(projectPath) {
    const metrics = {
      score: 70,
      hasPoppoConfig: false,
      configValid: false,
      missingSettings: [],
      errors: []
    };

    try {
      const configPath = path.join(projectPath, '.poppo', 'config.json');
      await fs.access(configPath);
      metrics.hasPoppoConfig = true;

      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      metrics.configValid = true;
      metrics.score += 20;

      // Check for important settings
      const requiredSettings = ['github', 'language'];
      for (const setting of requiredSettings) {
        if (!config[setting]) {
          metrics.missingSettings.push(setting);
          metrics.score -= 5;
        }
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        metrics.errors.push('No PoppoBuilder configuration found');
        metrics.score = 40;
      } else {
        metrics.errors.push(`Configuration error: ${error.message}`);
        metrics.score = 30;
      }
    }

    return metrics;
  }

  /**
   * Calculate overall health score
   */
  calculateOverallHealth(metrics) {
    const weights = {
      availability: 0.25,
      performance: 0.15,
      security: 0.20,
      maintenance: 0.15,
      dependencies: 0.15,
      repository: 0.10
    };

    let totalScore = 0;
    let totalWeight = 0;

    for (const [category, metric] of Object.entries(metrics)) {
      if (weights[category] && metric.score !== undefined) {
        totalScore += metric.score * weights[category];
        totalWeight += weights[category];
      }
    }

    const score = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 0;
    
    let status = 'unhealthy';
    let grade = 'F';
    
    if (score >= 90) {
      status = 'excellent';
      grade = 'A';
    } else if (score >= 80) {
      status = 'good';
      grade = 'B';
    } else if (score >= 70) {
      status = 'fair';
      grade = 'C';
    } else if (score >= 60) {
      status = 'poor';
      grade = 'D';
    }

    return { status, score, grade };
  }

  /**
   * Calculate health trends
   */
  calculateTrends(projectId) {
    const history = this.healthHistory.get(projectId) || [];
    if (history.length < 2) {
      return { trend: 'stable', change: 0 };
    }

    const recent = history.slice(-5); // Last 5 entries
    const older = history.slice(-10, -5); // Previous 5 entries

    const recentAvg = recent.reduce((sum, entry) => sum + entry.overall.score, 0) / recent.length;
    const olderAvg = older.length > 0 ? older.reduce((sum, entry) => sum + entry.overall.score, 0) / older.length : recentAvg;

    const change = recentAvg - olderAvg;
    let trend = 'stable';

    if (change > 5) {
      trend = 'improving';
    } else if (change < -5) {
      trend = 'declining';
    }

    return { trend, change: Math.round(change * 10) / 10 };
  }

  /**
   * Generate health alerts
   */
  generateAlerts(healthData) {
    const alerts = [];

    // Critical availability alert
    if (!healthData.metrics.availability.accessible) {
      alerts.push({
        level: 'critical',
        category: 'availability',
        message: 'Project directory is not accessible',
        timestamp: healthData.timestamp
      });
    }

    // Security alerts
    if (healthData.metrics.security.score < 50) {
      alerts.push({
        level: 'warning',
        category: 'security',
        message: 'Low security score detected',
        timestamp: healthData.timestamp
      });
    }

    // Maintenance alerts
    if (healthData.metrics.maintenance.staleness > 30) {
      alerts.push({
        level: 'warning',
        category: 'maintenance',
        message: 'Project has not been updated in over 30 days',
        timestamp: healthData.timestamp
      });
    }

    // Performance alerts
    if (healthData.metrics.performance.score < 60) {
      alerts.push({
        level: 'info',
        category: 'performance',
        message: 'Performance could be improved',
        timestamp: healthData.timestamp
      });
    }

    return alerts;
  }

  /**
   * Generate health recommendations
   */
  generateRecommendations(healthData) {
    const recommendations = [];

    // Security recommendations
    if (!healthData.metrics.security.securityFiles.hasGitignore) {
      recommendations.push({
        category: 'security',
        message: 'Add .gitignore file to prevent committing sensitive files',
        priority: 'medium'
      });
    }

    if (!healthData.metrics.security.securityFiles.hasLicense) {
      recommendations.push({
        category: 'security',
        message: 'Add LICENSE file to clarify project licensing',
        priority: 'low'
      });
    }

    // Maintenance recommendations
    if (healthData.metrics.maintenance.staleness > 7) {
      recommendations.push({
        category: 'maintenance',
        message: 'Consider updating the project with recent changes',
        priority: 'medium'
      });
    }

    // Configuration recommendations
    if (!healthData.metrics.configuration.hasPoppoConfig) {
      recommendations.push({
        category: 'configuration',
        message: 'Initialize PoppoBuilder configuration with: poppo-builder init',
        priority: 'high'
      });
    }

    return recommendations;
  }

  /**
   * Add health data to history
   */
  addToHistory(projectId, healthData) {
    if (!this.healthHistory.has(projectId)) {
      this.healthHistory.set(projectId, []);
    }

    const history = this.healthHistory.get(projectId);
    history.push({
      timestamp: healthData.timestamp,
      overall: healthData.overall,
      alerts: healthData.alerts.length
    });

    // Limit history size
    if (history.length > this.maxHistoryEntries) {
      history.splice(0, history.length - this.maxHistoryEntries);
    }
  }

  /**
   * Get health data for a project
   */
  getHealthData(projectId) {
    return this.healthMetrics.get(projectId);
  }

  /**
   * Get health history for a project
   */
  getHealthHistory(projectId) {
    return this.healthHistory.get(projectId) || [];
  }

  /**
   * Get all tracked projects
   */
  getAllHealthData() {
    const result = {};
    for (const [projectId, healthData] of this.healthMetrics) {
      result[projectId] = healthData;
    }
    return result;
  }

  /**
   * Load health data from disk
   */
  async loadHealthData() {
    try {
      const healthFile = path.join(this.healthDataPath, 'health-data.json');
      const data = await fs.readFile(healthFile, 'utf8');
      const parsed = JSON.parse(data);

      // Restore health metrics
      if (parsed.metrics) {
        this.healthMetrics = new Map(Object.entries(parsed.metrics));
      }

      // Restore health history
      if (parsed.history) {
        this.healthHistory = new Map(Object.entries(parsed.history));
      }

    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.emit('error', error);
      }
      // File doesn't exist, start with empty data
    }
  }

  /**
   * Save health data to disk
   */
  async saveHealthData(projectId = null) {
    try {
      // Ensure directory exists
      await fs.mkdir(this.healthDataPath, { recursive: true });
      
      const data = {
        metrics: Object.fromEntries(this.healthMetrics),
        history: Object.fromEntries(this.healthHistory),
        lastUpdated: new Date().toISOString()
      };

      const healthFile = path.join(this.healthDataPath, 'health-data.json');
      await fs.writeFile(healthFile, JSON.stringify(data, null, 2));

      // Also save individual project data
      if (projectId && this.healthMetrics.has(projectId)) {
        const projectFile = path.join(this.healthDataPath, `${projectId}.json`);
        const projectData = {
          current: this.healthMetrics.get(projectId),
          history: this.healthHistory.get(projectId) || []
        };
        await fs.writeFile(projectFile, JSON.stringify(projectData, null, 2));
      }

    } catch (error) {
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Start continuous health monitoring
   */
  startMonitoring(projects = []) {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    this.monitoringInterval = setInterval(async () => {
      for (const { projectId, projectPath } of projects) {
        try {
          await this.trackProject(projectId, projectPath);
        } catch (error) {
          this.emit('monitoring-error', projectId, error);
        }
      }
    }, this.checkInterval);

    this.emit('monitoring-started', projects.length);
  }

  /**
   * Stop continuous health monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
      this.emit('monitoring-stopped');
    }
  }

  /**
   * Cleanup health tracker
   */
  async cleanup() {
    this.stopMonitoring();
    await this.saveHealthData();
    this.removeAllListeners();
  }
}

module.exports = ProjectHealthTracker;