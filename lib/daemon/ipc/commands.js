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
    
    // Notifications
    this.register('notify-project-change', this._notifyProjectChange);
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
  
  async _overallStatus(args, context) {
    const { daemon, registry, projectManager, queueManager, workerPool } = context;
    
    const daemonStatus = await this._daemonStatus(args, { daemon });
    const projects = await this._projectList(args, { registry, projectManager });
    const workers = await this._workerStatus(args, { workerPool });
    const queue = await this._queueStatus(args, { queueManager });
    
    return {
      daemon: daemonStatus,
      projects: projects.projects || [],
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
        maxProcesses: daemon.options?.maxProcesses || 2,
        logLevel: 'info',
        port: daemon.options?.port || 'Not running'
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      components: {
        projectManager: true, // Always available via registry
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
      config: daemon.options
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
  
  async _projectList(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const projects = pm.getAllProjects ? pm.getAllProjects() : {};
    const projectArray = Object.entries(projects).map(([id, project]) => ({
      id,
      name: project.config?.name || 'Unknown',
      path: project.path,
      status: project.enabled ? 'active' : 'inactive',
      enabled: project.enabled,
      lastActivity: project.updatedAt
    }));
    
    return {
      count: projectArray.length,
      projects: projectArray
    };
  }
  
  async _projectAdd(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const { path, name, config } = args;
    if (!path) throw new Error('Project path required');
    
    const project = await pm.addProject(path, {
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
  
  async _projectRemove(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await pm.removeProject(projectId);
    
    return {
      message: 'Project removed successfully'
    };
  }
  
  async _projectStatus(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    const status = await pm.getProjectStatus(projectId);
    
    return status;
  }
  
  async _projectStart(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await pm.startProject(projectId);
    
    return {
      message: 'Project started successfully'
    };
  }
  
  async _projectStop(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await pm.stopProject(projectId);
    
    return {
      message: 'Project stopped successfully'
    };
  }
  
  async _projectRestart(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const { projectId } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await pm.restartProject(projectId);
    
    return {
      message: 'Project restarted successfully'
    };
  }
  
  async _projectUpdate(args, { registry, projectManager }) {
    const pm = projectManager || registry;
    if (!pm) throw new Error('Project manager not available');
    
    const { projectId, config } = args;
    if (!projectId) throw new Error('Project ID required');
    
    await pm.updateProject(projectId, config);
    
    return {
      message: 'Project updated successfully'
    };
  }
  
  /**
   * Queue Management Commands
   */
  
  async _queueStatus(args, { queueManager }) {
    if (!queueManager) {
      // Return empty status when queue manager not available
      return {
        total: 0,
        pending: 0,
        running: 0,
        completed: 0,
        failed: 0
      };
    }
    
    const { queue } = args;
    const status = await queueManager.getStats();
    
    return {
      total: status.totalJobs || 0,
      pending: status.pendingJobs || 0,
      running: status.runningJobs || 0,
      completed: status.completedJobs || 0,
      failed: status.failedJobs || 0
    };
  }
  
  async _queuePause(args, { queueManager }) {
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue } = args;
    await queueManager.pauseQueue(queue);
    
    return {
      message: `Queue ${queue || 'all'} paused`
    };
  }
  
  async _queueResume(args, { queueManager }) {
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue } = args;
    await queueManager.resumeQueue(queue);
    
    return {
      message: `Queue ${queue || 'all'} resumed`
    };
  }
  
  async _queueClear(args, { queueManager }) {
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue, status } = args;
    const count = await queueManager.clearQueue(queue, { status });
    
    return {
      message: `Cleared ${count} jobs from queue ${queue || 'all'}`
    };
  }
  
  async _queueStats(args, { queueManager }) {
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { queue, period = '1h' } = args;
    const stats = await queueManager.getStats(queue, period);
    
    return stats;
  }
  
  /**
   * Worker Management Commands
   */
  
  async _workerStatus(args, { workerPool }) {
    if (!workerPool) {
      // Return empty status when worker pool not available
      return {
        total: 0,
        active: 0,
        idle: 0,
        workers: []
      };
    }
    
    const status = await workerPool.getStats();
    
    return {
      total: status.pool?.workers || 0,
      active: status.pool?.busy || 0,
      idle: status.pool?.available || 0,
      workers: status.workers?.map(w => ({
        id: w.id,
        state: w.state,
        status: w.status,
        currentTask: w.currentTask,
        tasksCompleted: w.tasksCompleted,
        uptime: w.uptime,
        memory: w.memory,
        cpu: w.cpu
      })) || []
    };
  }
  
  async _workerScale(args, { workerPool }) {
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
  
  async _workerRestart(args, { workerPool }) {
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
  
  async _taskList(args, { queueManager }) {
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
  
  async _taskStatus(args, { queueManager }) {
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { taskId } = args;
    if (!taskId) throw new Error('Task ID required');
    
    const task = await queueManager.getTask(taskId);
    
    return task;
  }
  
  async _taskCancel(args, { queueManager }) {
    if (!queueManager) throw new Error('Queue manager not available');
    
    const { taskId } = args;
    if (!taskId) throw new Error('Task ID required');
    
    await queueManager.cancelTask(taskId);
    
    return {
      message: `Task ${taskId} cancelled`
    };
  }
  
  async _taskRetry(args, { queueManager }) {
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
    // Metrics collector not yet implemented
    return {
      message: 'Metrics collection not yet implemented',
      type: args.type,
      period: args.period || '5m'
    };
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
    if (!daemon) return { status: 'unknown', timestamp: new Date(), checks: {} };
    
    // Use lifecycle manager state
    const status = daemon.lifecycleManager?.currentState || 'unknown';
    
    return {
      status: status === 'running' ? 'healthy' : status,
      timestamp: new Date(),
      checks: {
        config: !!daemon.options,
        queue: !!daemon.queueManager,
        workers: !!daemon.workerPool,
        api: !!daemon.apiServer,
        ipc: !!daemon.ipcServer
      }
    };
  }
  
  /**
   * Handle project change notifications
   */
  async _notifyProjectChange(args, context) {
    const { event, data } = args;
    const { projectManager, registry } = context;
    
    // Log the notification
    console.log(`[Project Change] Event: ${event}`, data);
    
    // Handle different event types
    switch (event) {
      case 'project-registered':
      case 'project-updated':
        // Reload project if it exists
        if (projectManager && data.id) {
          try {
            await projectManager.reloadProject(data.id);
          } catch (error) {
            console.error(`Failed to reload project ${data.id}:`, error.message);
          }
        }
        break;
        
      case 'project-unregistered':
        // Stop and remove project
        if (projectManager && data.id) {
          try {
            await projectManager.stopProject(data.id);
            await projectManager.removeProject(data.id);
          } catch (error) {
            console.error(`Failed to remove project ${data.id}:`, error.message);
          }
        }
        break;
    }
    
    return { success: true, event, processed: true };
  }
}

module.exports = Commands;