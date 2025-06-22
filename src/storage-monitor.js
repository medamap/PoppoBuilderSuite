const fs = require('fs').promises;
const path = require('path');
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);
const EventEmitter = require('events');

/**
 * Storage Monitor
 * Monitors disk usage and alerts when thresholds are exceeded
 */
class StorageMonitor extends EventEmitter {
  constructor(logger) {
    super();
    this.logger = logger;
    this.config = {
      checkInterval: 5 * 60 * 1000, // 5 minutes
      thresholds: {
        warning: 0.8,  // 80% usage
        critical: 0.9  // 90% usage
      },
      paths: []
    };
    
    this.intervalId = null;
    this.lastCheck = {};
    this.isRunning = false;
  }

  /**
   * Initialize with configuration
   */
  initialize(config = {}) {
    this.config = {
      ...this.config,
      ...config
    };
    
    // Add default paths if none specified
    if (this.config.paths.length === 0) {
      this.config.paths = [
        process.cwd(),  // Project directory
        require('os').homedir(),  // Home directory
        '/tmp'  // Temp directory
      ];
    }
  }

  /**
   * Start monitoring
   */
  start() {
    if (this.isRunning) {
      this.logger?.warn('Storage monitor is already running');
      return;
    }

    this.isRunning = true;
    this.logger?.info('Starting storage monitor', {
      interval: this.config.checkInterval,
      paths: this.config.paths
    });

    // Initial check
    this.checkStorage();

    // Set up interval
    this.intervalId = setInterval(() => {
      this.checkStorage();
    }, this.config.checkInterval);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    this.logger?.info('Storage monitor stopped');
  }

  /**
   * Check storage for all configured paths
   */
  async checkStorage() {
    const results = [];

    for (const monitorPath of this.config.paths) {
      try {
        const usage = await this.getDiskUsage(monitorPath);
        results.push(usage);

        // Check thresholds
        this.checkThresholds(usage);

        // Store last check
        this.lastCheck[monitorPath] = {
          ...usage,
          timestamp: new Date()
        };

      } catch (error) {
        this.logger?.error('Failed to check storage', {
          path: monitorPath,
          error: error.message
        });
      }
    }

    // Emit overall status
    this.emit('storage-check', {
      timestamp: new Date(),
      results
    });

    return results;
  }

  /**
   * Get disk usage for a specific path
   */
  async getDiskUsage(targetPath) {
    const platform = process.platform;
    
    try {
      let usage;
      
      if (platform === 'darwin' || platform === 'linux') {
        // Use df command for Unix-like systems
        const { stdout } = await exec(`df -k "${targetPath}"`);
        const lines = stdout.trim().split('\n');
        
        if (lines.length < 2) {
          throw new Error('Unexpected df output');
        }
        
        // Parse the second line (first line is header)
        const parts = lines[1].split(/\s+/);
        const total = parseInt(parts[1]) * 1024;  // Convert from KB to bytes
        const used = parseInt(parts[2]) * 1024;
        const available = parseInt(parts[3]) * 1024;
        const percentUsed = parseInt(parts[4]);
        
        usage = {
          path: targetPath,
          total,
          used,
          available,
          percentUsed: percentUsed / 100,
          mount: parts[parts.length - 1]
        };
        
      } else if (platform === 'win32') {
        // Use wmic for Windows
        const drive = path.parse(targetPath).root.replace('\\', '');
        const { stdout } = await exec(
          `wmic logicaldisk where "DeviceID='${drive}'" get Size,FreeSpace /format:value`
        );
        
        const lines = stdout.trim().split('\n').filter(line => line);
        const freeSpace = parseInt(lines.find(l => l.startsWith('FreeSpace=')).split('=')[1]);
        const size = parseInt(lines.find(l => l.startsWith('Size=')).split('=')[1]);
        
        usage = {
          path: targetPath,
          total: size,
          used: size - freeSpace,
          available: freeSpace,
          percentUsed: (size - freeSpace) / size,
          mount: drive
        };
        
      } else {
        throw new Error(`Unsupported platform: ${platform}`);
      }
      
      // Add human-readable sizes
      usage.totalHuman = this.formatBytes(usage.total);
      usage.usedHuman = this.formatBytes(usage.used);
      usage.availableHuman = this.formatBytes(usage.available);
      usage.percentUsedHuman = `${Math.round(usage.percentUsed * 100)}%`;
      
      return usage;
      
    } catch (error) {
      throw new Error(`Failed to get disk usage for ${targetPath}: ${error.message}`);
    }
  }

  /**
   * Check if usage exceeds thresholds
   */
  checkThresholds(usage) {
    const { percentUsed, path: monitorPath } = usage;
    const previousCheck = this.lastCheck[monitorPath];
    
    // Critical threshold
    if (percentUsed >= this.config.thresholds.critical) {
      const wasPreviouslyCritical = previousCheck && 
        previousCheck.percentUsed >= this.config.thresholds.critical;
      
      if (!wasPreviouslyCritical) {
        this.emit('threshold-exceeded', {
          level: 'critical',
          usage,
          message: `Critical storage threshold exceeded for ${monitorPath}: ${usage.percentUsedHuman} used`
        });
        
        this.logger?.error('Critical storage threshold exceeded', {
          path: monitorPath,
          percentUsed: usage.percentUsedHuman,
          available: usage.availableHuman
        });
      }
    }
    // Warning threshold
    else if (percentUsed >= this.config.thresholds.warning) {
      const wasPreviouslyWarning = previousCheck && 
        previousCheck.percentUsed >= this.config.thresholds.warning;
      
      if (!wasPreviouslyWarning) {
        this.emit('threshold-exceeded', {
          level: 'warning',
          usage,
          message: `Warning storage threshold exceeded for ${monitorPath}: ${usage.percentUsedHuman} used`
        });
        
        this.logger?.warn('Warning storage threshold exceeded', {
          path: monitorPath,
          percentUsed: usage.percentUsedHuman,
          available: usage.availableHuman
        });
      }
    }
    // Recovered
    else if (previousCheck) {
      const wasAboveWarning = previousCheck.percentUsed >= this.config.thresholds.warning;
      
      if (wasAboveWarning) {
        this.emit('threshold-recovered', {
          usage,
          message: `Storage usage recovered for ${monitorPath}: ${usage.percentUsedHuman} used`
        });
        
        this.logger?.info('Storage usage recovered', {
          path: monitorPath,
          percentUsed: usage.percentUsedHuman,
          available: usage.availableHuman
        });
      }
    }
  }

  /**
   * Get current status
   */
  getStatus() {
    const status = {
      isRunning: this.isRunning,
      lastCheck: this.lastCheck,
      config: this.config,
      summary: {
        totalPaths: this.config.paths.length,
        warningCount: 0,
        criticalCount: 0
      }
    };

    // Count threshold violations
    for (const [path, check] of Object.entries(this.lastCheck)) {
      if (check.percentUsed >= this.config.thresholds.critical) {
        status.summary.criticalCount++;
      } else if (check.percentUsed >= this.config.thresholds.warning) {
        status.summary.warningCount++;
      }
    }

    return status;
  }

  /**
   * Get storage recommendations
   */
  async getRecommendations() {
    const recommendations = [];
    const usage = await this.checkStorage();

    for (const pathUsage of usage) {
      if (pathUsage.percentUsed >= this.config.thresholds.warning) {
        const recs = await this.getPathRecommendations(pathUsage);
        recommendations.push({
          path: pathUsage.path,
          usage: pathUsage,
          recommendations: recs
        });
      }
    }

    return recommendations;
  }

  /**
   * Get recommendations for a specific path
   */
  async getPathRecommendations(usage) {
    const recommendations = [];
    const projectRoot = process.cwd();

    // General recommendations
    if (usage.percentUsed >= this.config.thresholds.critical) {
      recommendations.push({
        priority: 'high',
        action: 'immediate',
        message: 'Critical storage situation. Immediate action required.'
      });
    }

    // Check specific directories
    try {
      // Logs directory
      const logsPath = path.join(projectRoot, 'logs');
      if (await this.exists(logsPath)) {
        const logsSize = await this.getDirectorySize(logsPath);
        if (logsSize > 1024 * 1024 * 1024) { // > 1GB
          recommendations.push({
            priority: 'medium',
            action: 'clean-logs',
            message: `Logs directory is ${this.formatBytes(logsSize)}. Consider running log cleanup.`,
            command: 'npm run cleanup'
          });
        }
      }

      // Temp directory
      const tempPath = path.join(projectRoot, 'temp');
      if (await this.exists(tempPath)) {
        const tempSize = await this.getDirectorySize(tempPath);
        if (tempSize > 500 * 1024 * 1024) { // > 500MB
          recommendations.push({
            priority: 'medium',
            action: 'clean-temp',
            message: `Temp directory is ${this.formatBytes(tempSize)}. Safe to clean.`,
            command: 'rm -rf temp/*'
          });
        }
      }

      // Node modules (if in project directory)
      if (usage.path.includes(projectRoot)) {
        const nodeModulesPath = path.join(projectRoot, 'node_modules');
        if (await this.exists(nodeModulesPath)) {
          const nodeModulesSize = await this.getDirectorySize(nodeModulesPath);
          recommendations.push({
            priority: 'low',
            action: 'info',
            message: `Node modules: ${this.formatBytes(nodeModulesSize)}`
          });
        }
      }

    } catch (error) {
      this.logger?.error('Error getting recommendations', error);
    }

    // Migration recommendation
    if (usage.percentUsed >= this.config.thresholds.warning) {
      recommendations.push({
        priority: 'medium',
        action: 'migrate',
        message: 'Consider migrating logs and data to external storage',
        command: 'npm run migrate:logs'
      });
    }

    return recommendations;
  }

  /**
   * Get directory size
   */
  async getDirectorySize(dirPath) {
    try {
      const { stdout } = await exec(`du -sb "${dirPath}" | cut -f1`);
      return parseInt(stdout.trim());
    } catch (error) {
      return 0;
    }
  }

  /**
   * Check if path exists
   */
  async exists(path) {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format bytes to human readable
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Clean up old files
   */
  async cleanupOldFiles(directory, daysOld = 30) {
    const results = {
      filesDeleted: 0,
      spaceFreed: 0,
      errors: []
    };

    try {
      const files = await fs.readdir(directory);
      const now = Date.now();
      const cutoffTime = now - (daysOld * 24 * 60 * 60 * 1000);

      for (const file of files) {
        const filePath = path.join(directory, file);
        
        try {
          const stat = await fs.stat(filePath);
          
          if (stat.isFile() && stat.mtime.getTime() < cutoffTime) {
            results.spaceFreed += stat.size;
            await fs.unlink(filePath);
            results.filesDeleted++;
          }
        } catch (error) {
          results.errors.push({
            file: filePath,
            error: error.message
          });
        }
      }

      this.logger?.info('Cleanup completed', {
        directory,
        filesDeleted: results.filesDeleted,
        spaceFreed: this.formatBytes(results.spaceFreed)
      });

    } catch (error) {
      this.logger?.error('Cleanup failed', {
        directory,
        error: error.message
      });
    }

    return results;
  }
}

module.exports = StorageMonitor;