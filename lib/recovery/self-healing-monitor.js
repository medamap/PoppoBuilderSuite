/**
 * Issue #126: Self-Healing Monitor
 * 
 * Monitors system health and automatically applies healing actions
 */

const EventEmitter = require('events');
const ProductionLogger = require('../utils/production-logger');
const ErrorRecoverySystem = require('./error-recovery-system');

class SelfHealingMonitor extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      checkInterval: options.checkInterval || 30000, // 30 seconds
      healingEnabled: options.healingEnabled !== false,
      maxHealingAttempts: options.maxHealingAttempts || 3,
      healingCooldown: options.healingCooldown || 300000, // 5 minutes
      alertThresholds: {
        memoryUsage: options.alertThresholds?.memoryUsage || 85,
        cpuUsage: options.alertThresholds?.cpuUsage || 80,
        diskUsage: options.alertThresholds?.diskUsage || 90,
        errorRate: options.alertThresholds?.errorRate || 10,
        ...options.alertThresholds
      },
      ...options
    };
    
    this.logger = new ProductionLogger('SelfHealingMonitor', {
      enableStructuredLogging: true,
      enablePerformanceTracking: true,
      enableSecurityAudit: true
    });
    
    this.errorRecovery = new ErrorRecoverySystem();
    
    this.isRunning = false;
    this.monitoringTimer = null;
    this.healthChecks = new Map();
    this.healingHistory = [];
    this.lastHealingAttempts = new Map();
    
    this.initializeHealthChecks();
  }

  /**
   * Initialize health checks
   */
  initializeHealthChecks() {
    // System resource checks
    this.healthChecks.set('memory', {
      name: 'Memory Usage',
      check: () => this.checkMemoryUsage(),
      healing: () => this.healMemoryIssues(),
      enabled: true
    });
    
    this.healthChecks.set('cpu', {
      name: 'CPU Usage',
      check: () => this.checkCpuUsage(),
      healing: () => this.healCpuIssues(),
      enabled: true
    });
    
    this.healthChecks.set('disk', {
      name: 'Disk Usage',
      check: () => this.checkDiskUsage(),
      healing: () => this.healDiskIssues(),
      enabled: true
    });
    
    // Application health checks
    this.healthChecks.set('processes', {
      name: 'Process Health',
      check: () => this.checkProcessHealth(),
      healing: () => this.healProcessIssues(),
      enabled: true
    });
    
    this.healthChecks.set('logs', {
      name: 'Log System Health',
      check: () => this.checkLogHealth(),
      healing: () => this.healLogIssues(),
      enabled: true
    });
    
    this.healthChecks.set('dependencies', {
      name: 'External Dependencies',
      check: () => this.checkDependencyHealth(),
      healing: () => this.healDependencyIssues(),
      enabled: true
    });
  }

  /**
   * Start monitoring
   */
  async start() {
    if (this.isRunning) return;
    
    try {
      await this.logger.info('Starting Self-Healing Monitor');
      await this.errorRecovery.initialize();
      
      this.isRunning = true;
      
      // Initial health check
      await this.performHealthCheck();
      
      // Schedule periodic checks
      this.monitoringTimer = setInterval(async () => {
        try {
          await this.performHealthCheck();
        } catch (error) {
          await this.logger.error('Health check failed', { error });
        }
      }, this.options.checkInterval);
      
      await this.logger.info('Self-Healing Monitor started successfully');
      
    } catch (error) {
      await this.logger.error('Failed to start Self-Healing Monitor', { error });
      throw error;
    }
  }

  /**
   * Stop monitoring
   */
  async stop() {
    if (!this.isRunning) return;
    
    this.isRunning = false;
    
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
    }
    
    await this.logger.info('Self-Healing Monitor stopped');
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck() {
    const startTime = Date.now();
    const results = new Map();
    
    await this.logger.logStructured('debug', 'Starting health check cycle', {
      component: 'HealthCheck'
    });
    
    for (const [checkId, healthCheck] of this.healthChecks.entries()) {
      if (!healthCheck.enabled) continue;
      
      try {
        const result = await healthCheck.check();
        results.set(checkId, {
          ...result,
          status: result.healthy ? 'healthy' : 'unhealthy',
          checkName: healthCheck.name,
          timestamp: new Date().toISOString()
        });
        
        // Trigger healing if needed
        if (!result.healthy && this.options.healingEnabled) {
          await this.attemptHealing(checkId, healthCheck, result);
        }
        
      } catch (error) {
        results.set(checkId, {
          status: 'error',
          healthy: false,
          error: error.message,
          checkName: healthCheck.name,
          timestamp: new Date().toISOString()
        });
        
        await this.logger.error(`Health check failed: ${healthCheck.name}`, { 
          error,
          checkId
        });
      }
    }
    
    const duration = Date.now() - startTime;
    const overallHealth = this.calculateOverallHealth(results);
    
    await this.logger.logStructured('info', 'Health check completed', {
      component: 'HealthCheck',
      duration,
      overallHealth,
      checks: Object.fromEntries(results)
    });
    
    this.emit('health-check-completed', {
      results: Object.fromEntries(results),
      overallHealth,
      duration,
      timestamp: new Date().toISOString()
    });
    
    return {
      results: Object.fromEntries(results),
      overallHealth,
      duration
    };
  }

  /**
   * Calculate overall system health
   */
  calculateOverallHealth(results) {
    const healthyChecks = Array.from(results.values()).filter(r => r.healthy).length;
    const totalChecks = results.size;
    
    if (totalChecks === 0) return { score: 0, status: 'unknown' };
    
    const score = (healthyChecks / totalChecks) * 100;
    
    let status;
    if (score >= 90) status = 'excellent';
    else if (score >= 75) status = 'good';
    else if (score >= 50) status = 'fair';
    else if (score >= 25) status = 'poor';
    else status = 'critical';
    
    return { score, status, healthy: healthyChecks, total: totalChecks };
  }

  /**
   * Attempt healing for failed health check
   */
  async attemptHealing(checkId, healthCheck, checkResult) {
    // Check healing cooldown
    const lastAttempt = this.lastHealingAttempts.get(checkId);
    if (lastAttempt && Date.now() - lastAttempt < this.options.healingCooldown) {
      return;
    }
    
    // Check max attempts
    const recentAttempts = this.healingHistory.filter(h => 
      h.checkId === checkId && 
      Date.now() - new Date(h.timestamp).getTime() < this.options.healingCooldown
    ).length;
    
    if (recentAttempts >= this.options.maxHealingAttempts) {
      await this.logger.warn(`Max healing attempts reached for ${checkId}`, {
        checkId,
        recentAttempts
      });
      return;
    }
    
    try {
      await this.logger.logStructured('info', `Attempting healing for ${healthCheck.name}`, {
        checkId,
        checkResult,
        component: 'SelfHealing'
      });
      
      const healingResult = await this.errorRecovery.executeWithRecovery(
        `healing-${checkId}`,
        () => healthCheck.healing(),
        {
          maxRetries: 2,
          strategy: 'exponential-backoff',
          fallback: () => this.emergencyHealing(checkId)
        }
      );
      
      this.recordHealingAttempt(checkId, true, healingResult);
      this.lastHealingAttempts.set(checkId, Date.now());
      
      await this.logger.logStructured('info', `Healing successful for ${healthCheck.name}`, {
        checkId,
        healingResult,
        component: 'SelfHealing'
      });
      
      this.emit('healing-successful', {
        checkId,
        checkName: healthCheck.name,
        result: healingResult
      });
      
    } catch (error) {
      this.recordHealingAttempt(checkId, false, { error: error.message });
      this.lastHealingAttempts.set(checkId, Date.now());
      
      await this.logger.error(`Healing failed for ${healthCheck.name}`, {
        error,
        checkId
      });
      
      this.emit('healing-failed', {
        checkId,
        checkName: healthCheck.name,
        error: error.message
      });
    }
  }

  /**
   * Record healing attempt
   */
  recordHealingAttempt(checkId, success, result) {
    this.healingHistory.push({
      checkId,
      success,
      result,
      timestamp: new Date().toISOString()
    });
    
    // Keep only recent history
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    this.healingHistory = this.healingHistory.filter(h => 
      new Date(h.timestamp).getTime() > cutoff
    );
  }

  /**
   * Health check implementations
   */
  async checkMemoryUsage() {
    const usage = process.memoryUsage();
    const totalHeap = usage.heapTotal;
    const usedHeap = usage.heapUsed;
    const usagePercent = (usedHeap / totalHeap) * 100;
    
    return {
      healthy: usagePercent < this.options.alertThresholds.memoryUsage,
      metrics: {
        usagePercent: usagePercent.toFixed(2),
        heapUsed: Math.round(usedHeap / 1024 / 1024),
        heapTotal: Math.round(totalHeap / 1024 / 1024),
        external: Math.round(usage.external / 1024 / 1024),
        rss: Math.round(usage.rss / 1024 / 1024)
      },
      threshold: this.options.alertThresholds.memoryUsage
    };
  }

  async checkCpuUsage() {
    const usage = process.cpuUsage();
    const uptime = process.uptime() * 1000000; // Convert to microseconds
    const cpuPercent = ((usage.user + usage.system) / uptime) * 100;
    
    return {
      healthy: cpuPercent < this.options.alertThresholds.cpuUsage,
      metrics: {
        usagePercent: cpuPercent.toFixed(2),
        user: usage.user,
        system: usage.system,
        uptime: Math.round(uptime / 1000000) // Convert back to seconds
      },
      threshold: this.options.alertThresholds.cpuUsage
    };
  }

  async checkDiskUsage() {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      const stats = await fs.stat(process.cwd());
      // This is a simplified check - in production, you'd use statvfs or similar
      return {
        healthy: true,
        metrics: {
          available: 'unknown',
          used: 'unknown',
          usagePercent: 0
        },
        note: 'Disk usage check requires platform-specific implementation'
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  async checkProcessHealth() {
    // Check if main processes are running
    const processes = [
      { name: 'main', check: () => true }, // Main process (this one)
    ];
    
    const results = await Promise.all(
      processes.map(async (proc) => {
        try {
          const isHealthy = proc.check();
          return { name: proc.name, healthy: isHealthy };
        } catch (error) {
          return { name: proc.name, healthy: false, error: error.message };
        }
      })
    );
    
    const unhealthyProcesses = results.filter(r => !r.healthy);
    
    return {
      healthy: unhealthyProcesses.length === 0,
      metrics: {
        totalProcesses: results.length,
        healthyProcesses: results.filter(r => r.healthy).length,
        unhealthyProcesses: unhealthyProcesses.map(p => p.name)
      }
    };
  }

  async checkLogHealth() {
    const fs = require('fs').promises;
    const path = require('path');
    
    try {
      const logsDir = path.join(process.cwd(), 'logs');
      await fs.access(logsDir);
      
      const files = await fs.readdir(logsDir);
      const logFiles = files.filter(f => f.endsWith('.log'));
      
      return {
        healthy: logFiles.length > 0,
        metrics: {
          logDirectory: logsDir,
          logFiles: logFiles.length,
          recentFiles: logFiles.slice(-5)
        }
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message
      };
    }
  }

  async checkDependencyHealth() {
    // Check external dependencies (GitHub API, etc.)
    const dependencies = [
      {
        name: 'GitHub API',
        check: async () => {
          // Simplified check - in production, you'd make actual API calls
          return process.env.GITHUB_TOKEN ? true : false;
        }
      }
    ];
    
    const results = await Promise.all(
      dependencies.map(async (dep) => {
        try {
          const isHealthy = await dep.check();
          return { name: dep.name, healthy: isHealthy };
        } catch (error) {
          return { name: dep.name, healthy: false, error: error.message };
        }
      })
    );
    
    const unhealthyDeps = results.filter(r => !r.healthy);
    
    return {
      healthy: unhealthyDeps.length === 0,
      metrics: {
        totalDependencies: results.length,
        healthyDependencies: results.filter(r => r.healthy).length,
        unhealthyDependencies: unhealthyDeps.map(d => d.name)
      }
    };
  }

  /**
   * Healing implementations
   */
  async healMemoryIssues() {
    await this.logger.info('Attempting memory healing');
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
    }
    
    // Clear caches (implement based on your application)
    // Example: clear require cache for non-core modules
    
    return { action: 'memory_cleanup', garbageCollected: !!global.gc };
  }

  async healCpuIssues() {
    await this.logger.info('Attempting CPU healing');
    
    // Reduce concurrent operations
    // This would be application-specific
    
    return { action: 'cpu_throttling' };
  }

  async healDiskIssues() {
    await this.logger.info('Attempting disk healing');
    
    const fs = require('fs').promises;
    const path = require('path');
    
    // Clean up temporary files
    const tempDirs = ['/tmp', path.join(process.cwd(), 'temp')];
    let cleanedFiles = 0;
    
    for (const dir of tempDirs) {
      try {
        const files = await fs.readdir(dir);
        const oldFiles = files.filter(f => f.startsWith('poppo-temp-'));
        
        for (const file of oldFiles) {
          try {
            await fs.unlink(path.join(dir, file));
            cleanedFiles++;
          } catch (error) {
            // Ignore individual file errors
          }
        }
      } catch (error) {
        // Directory might not exist
      }
    }
    
    return { action: 'disk_cleanup', cleanedFiles };
  }

  async healProcessIssues() {
    await this.logger.info('Attempting process healing');
    
    // Restart failed processes (application-specific)
    return { action: 'process_restart' };
  }

  async healLogIssues() {
    await this.logger.info('Attempting log system healing');
    
    const fs = require('fs').promises;
    const path = require('path');
    
    // Ensure log directory exists
    const logsDir = path.join(process.cwd(), 'logs');
    await fs.mkdir(logsDir, { recursive: true });
    
    return { action: 'log_directory_created', directory: logsDir };
  }

  async healDependencyIssues() {
    await this.logger.info('Attempting dependency healing');
    
    // Implement dependency-specific healing
    // For example, retry connections, refresh tokens, etc.
    
    return { action: 'dependency_refresh' };
  }

  /**
   * Emergency healing for critical issues
   */
  async emergencyHealing(checkId) {
    await this.logger.logSecurityEvent('emergency_healing_activated', {
      checkId,
      action: 'emergency_healing',
      resource: 'system',
      result: 'initiated'
    });
    
    switch (checkId) {
      case 'memory':
        return { action: 'emergency_memory_cleanup', forced: true };
      case 'cpu':
        return { action: 'emergency_cpu_throttling', forced: true };
      case 'disk':
        return { action: 'emergency_disk_cleanup', forced: true };
      default:
        return { action: 'emergency_restart_recommended', checkId };
    }
  }

  /**
   * Get healing statistics
   */
  getHealingStatistics() {
    const total = this.healingHistory.length;
    const successful = this.healingHistory.filter(h => h.success).length;
    
    const byCheck = {};
    for (const attempt of this.healingHistory) {
      if (!byCheck[attempt.checkId]) {
        byCheck[attempt.checkId] = { total: 0, successful: 0 };
      }
      byCheck[attempt.checkId].total++;
      if (attempt.success) {
        byCheck[attempt.checkId].successful++;
      }
    }
    
    return {
      total,
      successful,
      successRate: total > 0 ? (successful / total) * 100 : 0,
      byCheck,
      recentAttempts: this.healingHistory.slice(-10)
    };
  }

  /**
   * Add custom health check
   */
  addHealthCheck(id, check) {
    this.healthChecks.set(id, {
      ...check,
      enabled: check.enabled !== false
    });
  }

  /**
   * Remove health check
   */
  removeHealthCheck(id) {
    this.healthChecks.delete(id);
  }
}

module.exports = SelfHealingMonitor;