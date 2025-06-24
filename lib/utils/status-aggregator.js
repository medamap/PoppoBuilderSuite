/**
 * Status Aggregator
 * Aggregates status information across multiple projects
 */

const path = require('path');
const fs = require('fs').promises;
const os = require('os');

class StatusAggregator {
  constructor() {
    this.globalStateDir = path.join(os.homedir(), '.poppobuilder', 'state');
    this.daemonPidFile = path.join(os.homedir(), '.poppobuilder', 'daemon', 'daemon.pid');
    this.projectStates = new Map();
  }

  /**
   * Get global status overview
   */
  async getGlobalStatus() {
    const status = {
      daemon: await this.getDaemonStatus(),
      projects: await this.getAllProjectStatuses(),
      summary: {
        totalProjects: 0,
        activeProjects: 0,
        totalProcesses: 0,
        activeProcesses: 0,
        totalIssuesProcessed: 0,
        totalErrors: 0
      }
    };

    // Calculate summary
    for (const project of Object.values(status.projects)) {
      status.summary.totalProjects++;
      if (project.enabled) {
        status.summary.activeProjects++;
      }
      status.summary.totalProcesses += project.processes.total;
      status.summary.activeProcesses += project.processes.active;
      status.summary.totalIssuesProcessed += project.stats.issuesProcessed || 0;
      status.summary.totalErrors += project.stats.errors || 0;
    }

    return status;
  }

  /**
   * Get specific project status
   */
  async getProjectStatus(projectId) {
    const registry = await this.loadProjectRegistry();
    const project = registry.projects[projectId];
    
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    return await this.loadProjectState(projectId, project);
  }

  /**
   * Get all project statuses
   */
  async getAllProjectStatuses() {
    const registry = await this.loadProjectRegistry();
    const statuses = {};

    for (const [projectId, project] of Object.entries(registry.projects)) {
      try {
        statuses[projectId] = await this.loadProjectState(projectId, project);
      } catch (error) {
        // Project might not have state yet
        statuses[projectId] = {
          id: projectId,
          path: project.path,
          enabled: project.enabled,
          error: error.message,
          processes: { total: 0, active: 0, running: [] },
          stats: project.stats || {}
        };
      }
    }

    return statuses;
  }

  /**
   * Get daemon status
   */
  async getDaemonStatus() {
    try {
      const pidData = await fs.readFile(this.daemonPidFile, 'utf8');
      const pid = parseInt(pidData.trim(), 10);
      
      // Check if process is running
      try {
        process.kill(pid, 0);
        return {
          running: true,
          pid,
          uptime: await this.getProcessUptime(pid)
        };
      } catch {
        return {
          running: false,
          pid: null,
          message: 'Daemon PID file exists but process is not running'
        };
      }
    } catch {
      return {
        running: false,
        pid: null,
        message: 'Daemon is not running'
      };
    }
  }

  /**
   * Load project state
   */
  async loadProjectState(projectId, projectInfo) {
    const state = {
      id: projectId,
      path: projectInfo.path,
      enabled: projectInfo.enabled,
      lastActivity: null,
      processes: {
        total: 0,
        active: 0,
        running: []
      },
      stats: projectInfo.stats || {}
    };

    // Check multiple possible state locations
    const stateDirs = [
      path.join(projectInfo.path, '.poppobuilder', 'state'),
      path.join(projectInfo.path, 'state'), // For the main PoppoBuilderSuite project
      path.join(projectInfo.path, '.poppo', 'state')
    ];
    
    let stateDir = null;
    for (const dir of stateDirs) {
      try {
        await fs.access(dir);
        stateDir = dir;
        break;
      } catch {
        // Directory doesn't exist, try next
      }
    }

    if (!stateDir) {
      // No state directory found, return minimal state
      return state;
    }
    
    try {
      // Load running tasks
      const runningTasksFile = path.join(stateDir, 'running-tasks.json');
      const runningTasks = await this.loadJsonFile(runningTasksFile, []);
      
      state.processes.total = runningTasks.length;
      state.processes.active = runningTasks.filter(task => task.status === 'running').length;
      state.processes.running = runningTasks.map(task => ({
        id: task.id,
        type: task.type,
        status: task.status,
        startTime: task.startTime,
        pid: task.pid
      }));

      // Load issue status
      const issueStatusFile = path.join(stateDir, 'issue-status.json');
      const issueStatus = await this.loadJsonFile(issueStatusFile, {});
      
      const activeIssues = Object.values(issueStatus).filter(issue => 
        issue.status === 'processing' || issue.status === 'pending'
      );
      
      state.activeIssues = activeIssues.length;

      // Load processed issues for stats
      const processedIssuesFile = path.join(stateDir, 'processed-issues.json');
      const processedIssues = await this.loadJsonFile(processedIssuesFile, []);
      state.stats.issuesProcessed = processedIssues.length;

      // Get last activity
      const files = [runningTasksFile, issueStatusFile, processedIssuesFile];
      let latestTime = 0;
      
      for (const file of files) {
        try {
          const stat = await fs.stat(file);
          if (stat.mtimeMs > latestTime) {
            latestTime = stat.mtimeMs;
            state.lastActivity = stat.mtime;
          }
        } catch {
          // File might not exist
        }
      }
    } catch (error) {
      // State files might not exist yet
      state.error = `Failed to load state: ${error.message}`;
    }

    return state;
  }

  /**
   * Load project registry
   */
  async loadProjectRegistry() {
    const registryFile = path.join(os.homedir(), '.poppobuilder', 'projects.json');
    return await this.loadJsonFile(registryFile, {
      version: '1.0.0',
      projects: {},
      metadata: {}
    });
  }

  /**
   * Load JSON file with default value
   */
  async loadJsonFile(filePath, defaultValue = {}) {
    try {
      const data = await fs.readFile(filePath, 'utf8');
      return JSON.parse(data);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Get process uptime
   */
  async getProcessUptime(pid) {
    try {
      // This is a simplified version
      // In production, you might want to use ps or /proc/[pid]/stat
      const startTime = Date.now() - (Math.random() * 3600000); // Mock for now
      return Date.now() - startTime;
    } catch {
      return 0;
    }
  }

  /**
   * Format status for display
   */
  formatStatus(status, format = 'text') {
    if (format === 'json') {
      return JSON.stringify(status, null, 2);
    }

    // Text format
    const lines = [];
    
    // Daemon status
    lines.push('PoppoBuilder Status');
    lines.push('==================');
    lines.push('');
    lines.push('Daemon Status:');
    if (status.daemon.running) {
      lines.push(`  ✓ Running (PID: ${status.daemon.pid})`);
      lines.push(`  Uptime: ${this.formatDuration(status.daemon.uptime)}`);
    } else {
      lines.push(`  ✗ ${status.daemon.message}`);
    }
    lines.push('');

    // Summary
    lines.push('Summary:');
    lines.push(`  Total Projects: ${status.summary.totalProjects}`);
    lines.push(`  Active Projects: ${status.summary.activeProjects}`);
    lines.push(`  Running Processes: ${status.summary.activeProcesses}/${status.summary.totalProcesses}`);
    lines.push(`  Issues Processed: ${status.summary.totalIssuesProcessed}`);
    lines.push(`  Total Errors: ${status.summary.totalErrors}`);
    lines.push('');

    // Projects
    lines.push('Projects:');
    for (const [projectId, project] of Object.entries(status.projects)) {
      lines.push(`  ${projectId}:`);
      lines.push(`    Path: ${project.path}`);
      lines.push(`    Status: ${project.enabled ? 'Enabled' : 'Disabled'}`);
      if (project.error) {
        lines.push(`    Error: ${project.error}`);
      } else {
        lines.push(`    Processes: ${project.processes.active}/${project.processes.total} active`);
        if (project.activeIssues) {
          lines.push(`    Active Issues: ${project.activeIssues}`);
        }
        if (project.lastActivity) {
          lines.push(`    Last Activity: ${new Date(project.lastActivity).toLocaleString()}`);
        }
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Format duration
   */
  formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Format project status for display
   */
  formatProjectStatus(project, format = 'text') {
    if (format === 'json') {
      return JSON.stringify(project, null, 2);
    }

    const lines = [];
    lines.push(`Project: ${project.id}`);
    lines.push(`Path: ${project.path}`);
    lines.push(`Status: ${project.enabled ? 'Enabled' : 'Disabled'}`);
    lines.push('');

    if (project.error) {
      lines.push(`Error: ${project.error}`);
    } else {
      lines.push('Processes:');
      lines.push(`  Total: ${project.processes.total}`);
      lines.push(`  Active: ${project.processes.active}`);
      
      if (project.processes.running.length > 0) {
        lines.push('  Running:');
        for (const proc of project.processes.running) {
          lines.push(`    - ${proc.type} (${proc.status}) - PID: ${proc.pid}`);
          if (proc.startTime) {
            lines.push(`      Started: ${new Date(proc.startTime).toLocaleString()}`);
          }
        }
      }
      
      lines.push('');
      lines.push('Statistics:');
      lines.push(`  Issues Processed: ${project.stats.issuesProcessed || 0}`);
      lines.push(`  Total Errors: ${project.stats.errors || 0}`);
      
      if (project.lastActivity) {
        lines.push('');
        lines.push(`Last Activity: ${new Date(project.lastActivity).toLocaleString()}`);
      }
    }

    return lines.join('\n');
  }
}

module.exports = StatusAggregator;