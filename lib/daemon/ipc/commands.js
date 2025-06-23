/**
 * IPC Command Handlers for PoppoBuilder Daemon
 * Implements all IPC command operations
 */

const os = require('os');
const { v4: uuidv4 } = require('uuid');

class Commands {
  constructor() {
    this.handlers = new Map();
    this._registerHandlers();
  }
  
  /**
   * Register all command handlers
   */
  _registerHandlers() {
    // Overall status command
    this.register('status', this._overallStatus);
    
    // Daemon management
    this.register('daemon.status', this._daemonStatus);
    this.register('daemon.stop', this._daemonStop);
    this.register('daemon.reload', this._daemonReload);
    this.register('daemon.metrics', this._daemonMetrics);
    
    // Project management
    this.register('project.list', this._projectList);
    this.register('project.add', this._projectAdd);
    this.register('project.remove', this._projectRemove);
    this.register('project.status', this._projectStatus);
    this.register('project.start', this._projectStart);
    this.register('project.stop', this._projectStop);
    this.register('project.restart', this._projectRestart);
    this.register('project.update', this._projectUpdate);
    
    // Queue management
    this.register('queue.status', this._queueStatus);
    this.register('queue.pause', this._queuePause);
    this.register('queue.resume', this._queueResume);
    this.register('queue.clear', this._queueClear);
    this.register('queue.stats', this._queueStats);
    
    // Worker management
    this.register('worker.status', this._workerStatus);
    this.register('worker.scale', this._workerScale);
    this.register('worker.restart', this._workerRestart);
    
    // Task management
    this.register('task.list', this._taskList);
    this.register('task.status', this._taskStatus);
    this.register('task.cancel', this._taskCancel);
    this.register('task.retry', this._taskRetry);
    
    // Monitoring
    this.register('metrics.get', this._metricsGet);
    this.register('logs.tail', this._logsTail);
    this.register('health.check', this._healthCheck);
  }
  
  /**
   * Register a command handler
   */
  register(command, handler) {
    this.handlers.set(command, handler.bind(this));
  }
  
  /**
   * Execute a command
   */
  async execute(command, args = {}, context = {}) {
    const handler = this.handlers.get(command);
    
    if (!handler) {
      throw new Error(`Unknown command: ${command}`);
    }
    
    try {
      return await handler(args, context);
    } catch (error) {
      error.command = command;
      throw error;
    }
  }
  
  /**
   * Overall Status Commands
   */
  
  async _overallStatus(args, { daemon, projectManager, queueManager, workerPool }) {
    const daemonStatus = await this._daemonStatus(args, { daemon });
    const projects = await this._projectList(args, { projectManager });
    const workers = await this._workerStatus(args, { workerPool });
    const queue = await this._queueStatus(args, { queueManager });
    
    return {
      daemon: daemonStatus,
      projects: projects.projects || {},
      workers,
      queue
    };
  }
  
  /**
   * Daemon Management Commands
   */
  
  async _daemonStatus(args, { daemon }) {
    if (!daemon) throw new Error('Daemon not available');
    
    const status = await daemon.getStatus();
    const uptime = process.uptime();
    
    return {
      status: status.status,
      version: daemon.version,
      pid: process.pid,
      uptime,
      started: new Date(Date.now() - uptime * 1000),
      config: {
        configPath: daemon.configPath,
        logLevel: daemon.config.daemon?.logLevel || 'info',
        port: daemon.apiServer?.port || 'Not running'
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      components: {
        projectManager: !!daemon.projectManager,
        queueManager: !!daemon.queueManager,
        workerPool: !!daemon.workerPool,
        apiServer: !!daemon.apiServer,
        ipcServer: !!daemon.ipcServer
      }
    };
  }
  
  async _daemonStop(args, { daemon }) {
    if (!daemon) throw new Error('Daemon not available');
    
    // Schedule graceful shutdown
    setTimeout(() => {
      daemon.stop();
    }, 100);
    
    return {
      message: 'Daemon shutdown initiated'
    };
  }
  
  async _daemonReload(args, { daemon }) {
    if (!daemon) throw new Error('Daemon not available');
    
    await daemon.reloadConfig();
    
    return {
      message: 'Configuration reloaded',
      config: daemon.config
    };
  }
  
  async _daemonMetrics(args, { daemon }) {
    if (!daemon) throw new Error('Daemon not available');
    
    const metrics = await daemon.metricsCollector?.collect();
    
    return {
      timestamp: new Date(),
      metrics: metrics || {}
    };
  }
  
  /**
   * Project Management Commands
   */
  
  async _projectList(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const projects = await projectManager.listProjects();
    
    return {
      count: projects.length,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        path: p.path,
        status: p.status,
        enabled: p.enabled,
        lastActivity: p.lastActivity
      }))
    };
  }
  
  async _projectAdd(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const { path, name, config } = args;
    if (!path) throw new Error('Project path required');
    
    const project = await projectManager.addProject(path, {
      name,
      config
    });
    
    return {
      message: 'Project added successfully',
      project: {
        id: project.id,
        name: project.name,
        path: project.path
      }
    };
  }
  
  async _projectRemove(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await projectManager.removeProject(projectId);
    
    return {
      message: 'Project removed successfully'
    };
  }
  
  async _projectStatus(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    const status = await projectManager.getProjectStatus(projectId);
    
    return status;
  }
  
  async _projectStart(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await projectManager.startProject(projectId);
    
    return {
      message: 'Project started successfully'
    };
  }
  
  async _projectStop(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await projectManager.stopProject(projectId);
    
    return {
      message: 'Project stopped successfully'
    };
  }
  
  async _projectRestart(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await projectManager.restartProject(projectId);
    
    return {
      message: 'Project restarted successfully'
    };
  }
  
  async _projectUpdate(args, { daemon }) {
    const projectManager = daemon?.projectManager;
    if (!projectManager) throw new Error('Project manager not available');
    
    const { projectId, config } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await projectManager.updateProject(projectId, config);
    
    return {
      message: 'Project updated successfully'
    };
  }
  
  /**
   * Queue Management Commands
   */
  
  async _queueStatus(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue } = args;
    const status = await queueManager.getStatus(queue);
    
    return status;
  }
  
  async _queuePause(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue } = args;
    await queueManager.pauseQueue(queue);
    
    return {
      message: `Queue ${queue || 'all'} paused`
    };
  }
  
  async _queueResume(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue } = args;
    await queueManager.resumeQueue(queue);
    
    return {
      message: `Queue ${queue || 'all'} resumed`
    };
  }
  
  async _queueClear(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue, status } = args;
    const count = await queueManager.clearQueue(queue, { status });
    
    return {
      message: `Cleared ${count} jobs from queue ${queue || 'all'}`
    };
  }
  
  async _queueStats(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue, period = '1h' } = args;
    const stats = await queueManager.getStats(queue, period);
    
    return stats;
  }
  
  /**
   * Worker Management Commands
   */
  
  async _workerStatus(args, { daemon }) {
    const workerPool = daemon?.workerPool;
    if (!workerPool) throw new Error('Worker pool not available');
    
    const status = await workerPool.getStatus();
    
    return {
      ...status,
      workers: status.workers.map(w => ({
        id: w.id,
        status: w.status,
        currentTask: w.currentTask,
        tasksCompleted: w.tasksCompleted,
        uptime: w.uptime,
        memory: w.memory,
        cpu: w.cpu
      }))
    };
  }
  
  async _workerScale(args, { daemon }) {
    const workerPool = daemon?.workerPool;
    if (!workerPool) throw new Error('Worker pool not available');
    
    const { count } = args;
    if (typeof count !== 'number' || count < 0) {
      throw new Error('Invalid worker count');
    }
    
    await workerPool.scale(count);
    
    return {
      message: `Worker pool scaled to ${count} workers`
    };
  }
  
  async _workerRestart(args, { daemon }) {
    const workerPool = daemon?.workerPool;
    if (!workerPool) throw new Error('Worker pool not available');
    
    const { workerId } = args;
    
    if (workerId) {
      await workerPool.restartWorker(workerId);
      return {
        message: `Worker ${workerId} restarted`
      };
    } else {
      await workerPool.restartAll();
      return {
        message: 'All workers restarted'
      };
    }
  }
  
  /**
   * Task Management Commands
   */
  
  async _taskList(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { status, limit = 100, offset = 0 } = args;
    const tasks = await queueManager.listTasks({ status, limit, offset });
    
    return {
      count: tasks.length,
      tasks: tasks.map(t => ({
        id: t.id,
        type: t.type,
        status: t.status,
        projectId: t.projectId,
        createdAt: t.createdAt,
        startedAt: t.startedAt,
        completedAt: t.completedAt,
        error: t.error
      }))
    };
  }
  
  async _taskStatus(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { taskId } = args;
    if (!taskId) throw new Error('Task ID required');
    
    const task = await queueManager.getTask(taskId);
    
    return task;
  }
  
  async _taskCancel(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { taskId } = args;
    if (!taskId) throw new Error('Task ID required');
    
    await queueManager.cancelTask(taskId);
    
    return {
      message: `Task ${taskId} cancelled`
    };
  }
  
  async _taskRetry(args, { daemon }) {
    const queueManager = daemon?.queueManager;
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { taskId } = args;
    if (!taskId) throw new Error('Task ID required');
    
    const newTaskId = await queueManager.retryTask(taskId);
    
    return {
      message: `Task ${taskId} retried`,
      newTaskId
    };
  }
  
  /**
   * Monitoring Commands
   */
  
  async _metricsGet(args, { daemon }) {
    const metricsCollector = daemon?.metricsCollector;
    if (!metricsCollector) throw new Error('Metrics collector not available');
    
    const { type, period = '5m' } = args;
    const metrics = await metricsCollector.getMetrics(type, period);
    
    return metrics;
  }
  
  async _logsTail(args, { daemon }) {
    // Note: This would typically return a stream or recent log entries
    // For IPC, we'll return recent entries
    const { lines = 100, level } = args;
    
    return {
      message: 'Log tailing not yet implemented',
      lines,
      level
    };
  }
  
  async _healthCheck(args, { daemon }) {
    const health = await daemon?.checkHealth();
    
    return {
      status: health?.status || 'unknown',
      timestamp: new Date(),
      checks: health?.checks || {}
    };
  }
}

module.exports = Commands;