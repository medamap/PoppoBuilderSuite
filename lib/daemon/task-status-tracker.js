/**
 * Task Status Tracker - Comprehensive task lifecycle tracking
 * Provides real-time status updates, progress monitoring, and history management
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

/**
 * Comprehensive task status states
 */
const TaskStatus = {
  QUEUED: 'queued',
  ASSIGNED: 'assigned',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  RETRYING: 'retrying',
  CANCELLED: 'cancelled',
  PAUSED: 'paused',
  STALLED: 'stalled',
  CUSTOM: 'custom'
};

/**
 * Task status transition rules
 */
const StatusTransitions = {
  [TaskStatus.QUEUED]: [TaskStatus.ASSIGNED, TaskStatus.CANCELLED],
  [TaskStatus.ASSIGNED]: [TaskStatus.RUNNING, TaskStatus.QUEUED, TaskStatus.CANCELLED],
  [TaskStatus.RUNNING]: [TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.PAUSED, TaskStatus.CANCELLED, TaskStatus.STALLED],
  [TaskStatus.PAUSED]: [TaskStatus.RUNNING, TaskStatus.CANCELLED],
  [TaskStatus.FAILED]: [TaskStatus.RETRYING, TaskStatus.CANCELLED],
  [TaskStatus.RETRYING]: [TaskStatus.RUNNING, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.STALLED]: [TaskStatus.RUNNING, TaskStatus.FAILED, TaskStatus.CANCELLED],
  [TaskStatus.COMPLETED]: [],
  [TaskStatus.CANCELLED]: []
};

class TaskStatusTracker extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      historyRetentionDays: 30,
      archivePath: path.join(process.cwd(), 'data', 'task-archives'),
      maxInMemoryTasks: 10000,
      enablePersistence: true,
      persistencePath: path.join(process.cwd(), 'data', 'task-status.json'),
      progressUpdateInterval: 1000, // ms
      stallTimeout: 300000, // 5 minutes
      ...options
    };
    
    // In-memory storage
    this.tasks = new Map();
    this.tasksByStatus = new Map();
    this.tasksByProject = new Map();
    this.taskHistory = new Map();
    this.progressTimers = new Map();
    this.customStates = new Set();
    
    // Initialize status maps
    Object.values(TaskStatus).forEach(status => {
      this.tasksByStatus.set(status, new Set());
    });
    
    // Stall detection
    this.stallCheckInterval = null;
    
    // Persistence
    this.saveTimer = null;
    this.isDirty = false;
  }
  
  /**
   * Initialize tracker
   */
  async initialize() {
    // Load persisted data
    if (this.options.enablePersistence) {
      await this.loadPersistedData();
    }
    
    // Create archive directory
    await fs.mkdir(this.options.archivePath, { recursive: true });
    
    // Start stall detection
    this.startStallDetection();
    
    // Set up auto-save
    if (this.options.enablePersistence) {
      this.saveTimer = setInterval(() => {
        if (this.isDirty) {
          this.savePersistedData().catch(err => {
            this.emit('error', { type: 'persistence', error: err });
          });
        }
      }, 10000); // Save every 10 seconds if dirty
    }
    
    this.emit('initialized');
  }
  
  /**
   * Create a new task entry
   */
  createTask(taskId, taskData = {}) {
    const now = new Date();
    
    const task = {
      id: taskId,
      status: TaskStatus.QUEUED,
      project: taskData.project || 'default',
      type: taskData.type || 'unknown',
      priority: taskData.priority || 0,
      metadata: taskData.metadata || {},
      
      // Timing
      createdAt: now,
      updatedAt: now,
      assignedAt: null,
      startedAt: null,
      completedAt: null,
      
      // Progress
      progress: 0,
      progressDetails: {},
      subTasks: [],
      
      // Assignment
      workerId: null,
      workerHost: null,
      
      // History
      stateHistory: [{
        state: TaskStatus.QUEUED,
        timestamp: now,
        reason: 'Task created'
      }],
      
      // Metrics
      executionTime: 0,
      retryCount: 0,
      resourceUsage: {
        cpu: 0,
        memory: 0,
        diskIO: 0
      },
      
      // Results
      result: null,
      error: null,
      logs: []
    };
    
    this.tasks.set(taskId, task);
    this.tasksByStatus.get(TaskStatus.QUEUED).add(taskId);
    
    // Add to project index
    if (!this.tasksByProject.has(task.project)) {
      this.tasksByProject.set(task.project, new Set());
    }
    this.tasksByProject.get(task.project).add(taskId);
    
    this.isDirty = true;
    
    this.emit('task:created', { taskId, task });
    
    return task;
  }
  
  /**
   * Update task status with validation
   */
  updateStatus(taskId, newStatus, reason = '') {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const currentStatus = task.status;
    
    // Validate transition
    if (!this.isValidTransition(currentStatus, newStatus)) {
      throw new Error(`Invalid status transition from ${currentStatus} to ${newStatus}`);
    }
    
    // Remove from current status set
    this.tasksByStatus.get(currentStatus).delete(taskId);
    
    // Update status
    task.status = newStatus;
    task.updatedAt = new Date();
    
    // Add to new status set
    if (!this.tasksByStatus.has(newStatus)) {
      this.tasksByStatus.set(newStatus, new Set());
    }
    this.tasksByStatus.get(newStatus).add(taskId);
    
    // Update timestamps
    switch (newStatus) {
      case TaskStatus.ASSIGNED:
        task.assignedAt = task.updatedAt;
        break;
      case TaskStatus.RUNNING:
        if (!task.startedAt) {
          task.startedAt = task.updatedAt;
        }
        break;
      case TaskStatus.COMPLETED:
      case TaskStatus.FAILED:
      case TaskStatus.CANCELLED:
        task.completedAt = task.updatedAt;
        if (task.startedAt) {
          task.executionTime = task.completedAt - task.startedAt;
        }
        break;
      case TaskStatus.RETRYING:
        task.retryCount++;
        break;
    }
    
    // Add to history
    task.stateHistory.push({
      state: newStatus,
      previousState: currentStatus,
      timestamp: task.updatedAt,
      reason
    });
    
    this.isDirty = true;
    
    this.emit('task:status-changed', {
      taskId,
      previousStatus: currentStatus,
      newStatus,
      task
    });
    
    // Clean up completed tasks if needed
    if ([TaskStatus.COMPLETED, TaskStatus.FAILED, TaskStatus.CANCELLED].includes(newStatus)) {
      this.considerArchiving(taskId);
    }
    
    return task;
  }
  
  /**
   * Validate status transition
   */
  isValidTransition(from, to) {
    // Custom states can transition to/from anywhere
    if (this.customStates.has(from) || this.customStates.has(to)) {
      return true;
    }
    
    const allowedTransitions = StatusTransitions[from];
    return allowedTransitions && allowedTransitions.includes(to);
  }
  
  /**
   * Register custom status state
   */
  registerCustomState(stateName, allowedTransitions = []) {
    this.customStates.add(stateName);
    StatusTransitions[stateName] = allowedTransitions;
    this.tasksByStatus.set(stateName, new Set());
    
    this.emit('custom-state:registered', { stateName, allowedTransitions });
  }
  
  /**
   * Assign task to worker
   */
  assignToWorker(taskId, workerId, workerHost = null) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    task.workerId = workerId;
    task.workerHost = workerHost;
    
    if (task.status === TaskStatus.QUEUED) {
      this.updateStatus(taskId, TaskStatus.ASSIGNED, `Assigned to worker ${workerId}`);
    }
    
    this.emit('task:assigned', { taskId, workerId, workerHost, task });
    
    return task;
  }
  
  /**
   * Update task progress
   */
  updateProgress(taskId, progress, details = {}) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    task.progress = Math.min(100, Math.max(0, progress));
    task.progressDetails = { ...task.progressDetails, ...details };
    task.updatedAt = new Date();
    
    this.isDirty = true;
    
    this.emit('task:progress', {
      taskId,
      progress: task.progress,
      details: task.progressDetails,
      task
    });
    
    // Update estimated time remaining
    if (task.startedAt && task.progress > 0 && task.progress < 100) {
      const elapsed = Date.now() - task.startedAt.getTime();
      const estimatedTotal = elapsed / (task.progress / 100);
      task.estimatedTimeRemaining = estimatedTotal - elapsed;
    }
    
    return task;
  }
  
  /**
   * Add sub-task
   */
  addSubTask(parentTaskId, subTaskData) {
    const parentTask = this.tasks.get(parentTaskId);
    if (!parentTask) {
      throw new Error(`Parent task ${parentTaskId} not found`);
    }
    
    const subTask = {
      id: `${parentTaskId}:${parentTask.subTasks.length}`,
      name: subTaskData.name,
      status: TaskStatus.QUEUED,
      progress: 0,
      createdAt: new Date(),
      ...subTaskData
    };
    
    parentTask.subTasks.push(subTask);
    this.isDirty = true;
    
    this.emit('task:subtask-added', {
      parentTaskId,
      subTask,
      parentTask
    });
    
    return subTask;
  }
  
  /**
   * Update sub-task
   */
  updateSubTask(parentTaskId, subTaskIndex, updates) {
    const parentTask = this.tasks.get(parentTaskId);
    if (!parentTask) {
      throw new Error(`Parent task ${parentTaskId} not found`);
    }
    
    const subTask = parentTask.subTasks[subTaskIndex];
    if (!subTask) {
      throw new Error(`Sub-task ${subTaskIndex} not found`);
    }
    
    Object.assign(subTask, updates, { updatedAt: new Date() });
    
    // Update parent progress based on sub-tasks
    const totalProgress = parentTask.subTasks.reduce((sum, st) => sum + (st.progress || 0), 0);
    const avgProgress = totalProgress / parentTask.subTasks.length;
    this.updateProgress(parentTaskId, avgProgress, { subTasksCompleted: parentTask.subTasks.filter(st => st.status === TaskStatus.COMPLETED).length });
    
    return subTask;
  }
  
  /**
   * Update resource usage
   */
  updateResourceUsage(taskId, usage) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    task.resourceUsage = {
      ...task.resourceUsage,
      ...usage,
      lastUpdated: new Date()
    };
    
    this.isDirty = true;
    
    this.emit('task:resources-updated', {
      taskId,
      usage: task.resourceUsage,
      task
    });
    
    return task;
  }
  
  /**
   * Complete task with result
   */
  completeTask(taskId, result = null) {
    const task = this.updateStatus(taskId, TaskStatus.COMPLETED, 'Task completed successfully');
    task.result = result;
    
    this.emit('task:completed', { taskId, result, task });
    
    return task;
  }
  
  /**
   * Fail task with error
   */
  failTask(taskId, error) {
    const task = this.updateStatus(taskId, TaskStatus.FAILED, `Task failed: ${error.message || error}`);
    task.error = {
      message: error.message || error,
      stack: error.stack,
      code: error.code,
      timestamp: new Date()
    };
    
    this.emit('task:failed', { taskId, error: task.error, task });
    
    return task;
  }
  
  /**
   * Cancel task
   */
  cancelTask(taskId, reason = '') {
    const task = this.updateStatus(taskId, TaskStatus.CANCELLED, reason || 'Task cancelled');
    
    this.emit('task:cancelled', { taskId, reason, task });
    
    return task;
  }
  
  /**
   * Get task by ID
   */
  getTask(taskId) {
    return this.tasks.get(taskId) || this.taskHistory.get(taskId);
  }
  
  /**
   * Get tasks by status
   */
  getTasksByStatus(status) {
    const taskIds = this.tasksByStatus.get(status) || new Set();
    return Array.from(taskIds).map(id => this.tasks.get(id)).filter(Boolean);
  }
  
  /**
   * Get tasks by project
   */
  getTasksByProject(project) {
    const taskIds = this.tasksByProject.get(project) || new Set();
    return Array.from(taskIds).map(id => this.tasks.get(id)).filter(Boolean);
  }
  
  /**
   * Query tasks with filters
   */
  queryTasks(filters = {}) {
    let tasks = Array.from(this.tasks.values());
    
    // Status filter
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      tasks = tasks.filter(t => statuses.includes(t.status));
    }
    
    // Project filter
    if (filters.project) {
      tasks = tasks.filter(t => t.project === filters.project);
    }
    
    // Type filter
    if (filters.type) {
      tasks = tasks.filter(t => t.type === filters.type);
    }
    
    // Time range filter
    if (filters.createdAfter) {
      const after = new Date(filters.createdAfter);
      tasks = tasks.filter(t => t.createdAt >= after);
    }
    
    if (filters.createdBefore) {
      const before = new Date(filters.createdBefore);
      tasks = tasks.filter(t => t.createdAt <= before);
    }
    
    // Worker filter
    if (filters.workerId) {
      tasks = tasks.filter(t => t.workerId === filters.workerId);
    }
    
    // Sort
    if (filters.sortBy) {
      tasks.sort((a, b) => {
        const aVal = a[filters.sortBy];
        const bVal = b[filters.sortBy];
        
        if (aVal < bVal) return filters.sortOrder === 'desc' ? 1 : -1;
        if (aVal > bVal) return filters.sortOrder === 'desc' ? -1 : 1;
        return 0;
      });
    }
    
    // Limit
    if (filters.limit) {
      tasks = tasks.slice(0, filters.limit);
    }
    
    return tasks;
  }
  
  /**
   * Get task statistics
   */
  getStatistics(filters = {}) {
    const tasks = this.queryTasks(filters);
    
    const stats = {
      total: tasks.length,
      byStatus: {},
      byProject: {},
      byType: {},
      avgExecutionTime: 0,
      avgProgress: 0,
      failureRate: 0,
      throughput: {
        lastHour: 0,
        last24Hours: 0,
        last7Days: 0
      }
    };
    
    // Count by status
    Object.values(TaskStatus).forEach(status => {
      stats.byStatus[status] = 0;
    });
    
    let totalExecutionTime = 0;
    let completedCount = 0;
    let totalProgress = 0;
    
    const now = Date.now();
    const hourAgo = now - 3600000;
    const dayAgo = now - 86400000;
    const weekAgo = now - 604800000;
    
    tasks.forEach(task => {
      // Status counts
      stats.byStatus[task.status]++;
      
      // Project counts
      stats.byProject[task.project] = (stats.byProject[task.project] || 0) + 1;
      
      // Type counts
      stats.byType[task.type] = (stats.byType[task.type] || 0) + 1;
      
      // Progress
      totalProgress += task.progress;
      
      // Execution time
      if (task.executionTime > 0) {
        totalExecutionTime += task.executionTime;
        completedCount++;
      }
      
      // Throughput
      if (task.completedAt) {
        const completedTime = task.completedAt.getTime();
        if (completedTime >= hourAgo) stats.throughput.lastHour++;
        if (completedTime >= dayAgo) stats.throughput.last24Hours++;
        if (completedTime >= weekAgo) stats.throughput.last7Days++;
      }
    });
    
    // Calculate averages
    if (completedCount > 0) {
      stats.avgExecutionTime = totalExecutionTime / completedCount;
    }
    
    if (tasks.length > 0) {
      stats.avgProgress = totalProgress / tasks.length;
      stats.failureRate = (stats.byStatus[TaskStatus.FAILED] / tasks.length) * 100;
    }
    
    return stats;
  }
  
  /**
   * Get task timeline
   */
  getTimeline(taskId) {
    const task = this.getTask(taskId);
    if (!task) {
      return null;
    }
    
    const timeline = [];
    
    // Add state transitions
    task.stateHistory.forEach(entry => {
      timeline.push({
        type: 'state-change',
        timestamp: entry.timestamp,
        data: entry
      });
    });
    
    // Add progress updates
    if (task.progressHistory) {
      task.progressHistory.forEach(entry => {
        timeline.push({
          type: 'progress-update',
          timestamp: entry.timestamp,
          data: entry
        });
      });
    }
    
    // Add logs
    task.logs.forEach(log => {
      timeline.push({
        type: 'log',
        timestamp: log.timestamp,
        data: log
      });
    });
    
    // Sort by timestamp
    timeline.sort((a, b) => a.timestamp - b.timestamp);
    
    return timeline;
  }
  
  /**
   * Add log entry to task
   */
  addLog(taskId, level, message, data = {}) {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }
    
    const logEntry = {
      timestamp: new Date(),
      level,
      message,
      data
    };
    
    task.logs.push(logEntry);
    
    // Keep only last 1000 logs
    if (task.logs.length > 1000) {
      task.logs = task.logs.slice(-1000);
    }
    
    this.isDirty = true;
    
    this.emit('task:log', { taskId, log: logEntry, task });
    
    return logEntry;
  }
  
  /**
   * Start stall detection
   */
  startStallDetection() {
    this.stallCheckInterval = setInterval(() => {
      const now = Date.now();
      const runningTasks = this.getTasksByStatus(TaskStatus.RUNNING);
      
      runningTasks.forEach(task => {
        const lastUpdate = task.updatedAt.getTime();
        
        if (now - lastUpdate > this.options.stallTimeout) {
          this.updateStatus(task.id, TaskStatus.STALLED, 'Task stalled - no updates');
        }
      });
    }, 60000); // Check every minute
  }
  
  /**
   * Consider archiving completed task
   */
  async considerArchiving(taskId) {
    // Keep recent tasks in memory
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    const age = Date.now() - task.completedAt.getTime();
    
    if (age < 3600000) { // Keep tasks completed within last hour
      return;
    }
    
    // Check memory limit
    if (this.tasks.size > this.options.maxInMemoryTasks) {
      await this.archiveTask(taskId);
    }
  }
  
  /**
   * Archive task to disk
   */
  async archiveTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return;
    
    // Create date-based directory
    const date = task.createdAt.toISOString().split('T')[0];
    const archiveDir = path.join(this.options.archivePath, date);
    await fs.mkdir(archiveDir, { recursive: true });
    
    // Save task to file
    const filePath = path.join(archiveDir, `${taskId}.json`);
    await fs.writeFile(filePath, JSON.stringify(task, null, 2));
    
    // Move to history
    this.taskHistory.set(taskId, task);
    
    // Remove from active storage
    this.tasks.delete(taskId);
    this.tasksByStatus.get(task.status).delete(taskId);
    this.tasksByProject.get(task.project).delete(taskId);
    
    this.emit('task:archived', { taskId, filePath });
  }
  
  /**
   * Load archived task
   */
  async loadArchivedTask(taskId) {
    // Check history first
    if (this.taskHistory.has(taskId)) {
      return this.taskHistory.get(taskId);
    }
    
    // Search archive files
    const dirs = await fs.readdir(this.options.archivePath);
    
    for (const dir of dirs) {
      const filePath = path.join(this.options.archivePath, dir, `${taskId}.json`);
      
      try {
        const data = await fs.readFile(filePath, 'utf8');
        const task = JSON.parse(data);
        
        // Parse dates
        ['createdAt', 'updatedAt', 'assignedAt', 'startedAt', 'completedAt'].forEach(field => {
          if (task[field]) {
            task[field] = new Date(task[field]);
          }
        });
        
        task.stateHistory.forEach(entry => {
          entry.timestamp = new Date(entry.timestamp);
        });
        
        return task;
      } catch (err) {
        // File doesn't exist, continue
      }
    }
    
    return null;
  }
  
  /**
   * Export tasks
   */
  async exportTasks(filters = {}, format = 'json') {
    const tasks = this.queryTasks(filters);
    
    switch (format) {
      case 'json':
        return JSON.stringify(tasks, null, 2);
        
      case 'csv':
        if (tasks.length === 0) return '';
        
        const headers = [
          'id', 'status', 'project', 'type', 'priority',
          'createdAt', 'startedAt', 'completedAt', 'executionTime',
          'progress', 'workerId', 'error'
        ];
        
        const rows = tasks.map(task => {
          return headers.map(header => {
            const value = task[header];
            if (value instanceof Date) {
              return value.toISOString();
            }
            if (typeof value === 'object') {
              return JSON.stringify(value);
            }
            return value || '';
          }).join(',');
        });
        
        return [headers.join(','), ...rows].join('\n');
        
      default:
        throw new Error(`Unknown export format: ${format}`);
    }
  }
  
  /**
   * Clean up old archives
   */
  async cleanupArchives() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.options.historyRetentionDays);
    
    const dirs = await fs.readdir(this.options.archivePath);
    
    for (const dir of dirs) {
      const dirDate = new Date(dir);
      
      if (dirDate < cutoffDate) {
        const dirPath = path.join(this.options.archivePath, dir);
        await fs.rm(dirPath, { recursive: true });
        
        this.emit('archives:cleaned', { directory: dir, date: dirDate });
      }
    }
  }
  
  /**
   * Generate real-time status feed
   */
  getStatusFeed(since = null) {
    const feed = {
      timestamp: new Date(),
      tasks: {
        active: this.getTasksByStatus(TaskStatus.RUNNING),
        queued: this.getTasksByStatus(TaskStatus.QUEUED),
        recent: []
      },
      stats: this.getStatistics(),
      events: []
    };
    
    // Get recently updated tasks
    const recentCutoff = since || new Date(Date.now() - 300000); // Last 5 minutes
    
    feed.tasks.recent = Array.from(this.tasks.values())
      .filter(task => task.updatedAt >= recentCutoff)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 20);
    
    return feed;
  }
  
  /**
   * Generate visual timeline data
   */
  generateTimelineData(filters = {}) {
    const tasks = this.queryTasks(filters);
    
    const timeline = {
      tasks: [],
      milestones: [],
      statistics: {}
    };
    
    tasks.forEach(task => {
      const taskData = {
        id: task.id,
        name: `${task.type} - ${task.id}`,
        start: task.createdAt,
        end: task.completedAt || new Date(),
        status: task.status,
        progress: task.progress,
        worker: task.workerId
      };
      
      timeline.tasks.push(taskData);
    });
    
    // Sort by start time
    timeline.tasks.sort((a, b) => a.start - b.start);
    
    // Generate statistics
    timeline.statistics = this.getStatistics(filters);
    
    return timeline;
  }
  
  /**
   * Load persisted data
   */
  async loadPersistedData() {
    try {
      const data = await fs.readFile(this.options.persistencePath, 'utf8');
      const parsed = JSON.parse(data);
      
      // Restore tasks
      parsed.tasks.forEach(taskData => {
        // Parse dates
        ['createdAt', 'updatedAt', 'assignedAt', 'startedAt', 'completedAt'].forEach(field => {
          if (taskData[field]) {
            taskData[field] = new Date(taskData[field]);
          }
        });
        
        taskData.stateHistory.forEach(entry => {
          entry.timestamp = new Date(entry.timestamp);
        });
        
        this.tasks.set(taskData.id, taskData);
        
        // Rebuild indexes
        this.tasksByStatus.get(taskData.status).add(taskData.id);
        
        if (!this.tasksByProject.has(taskData.project)) {
          this.tasksByProject.set(taskData.project, new Set());
        }
        this.tasksByProject.get(taskData.project).add(taskData.id);
      });
      
      // Restore custom states
      if (parsed.customStates) {
        parsed.customStates.forEach(state => {
          this.registerCustomState(state.name, state.transitions);
        });
      }
      
      this.emit('data:loaded', { taskCount: this.tasks.size });
    } catch (err) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
  }
  
  /**
   * Save persisted data
   */
  async savePersistedData() {
    const data = {
      version: 1,
      timestamp: new Date(),
      tasks: Array.from(this.tasks.values()),
      customStates: Array.from(this.customStates).map(name => ({
        name,
        transitions: StatusTransitions[name] || []
      }))
    };
    
    const tempPath = `${this.options.persistencePath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(data, null, 2));
    await fs.rename(tempPath, this.options.persistencePath);
    
    this.isDirty = false;
    
    this.emit('data:saved', { taskCount: this.tasks.size });
  }
  
  /**
   * Shutdown tracker
   */
  async shutdown() {
    // Stop intervals
    if (this.stallCheckInterval) {
      clearInterval(this.stallCheckInterval);
    }
    
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
    }
    
    // Save final state
    if (this.options.enablePersistence && this.isDirty) {
      await this.savePersistedData();
    }
    
    // Clear progress timers
    for (const timer of this.progressTimers.values()) {
      clearInterval(timer);
    }
    
    this.emit('shutdown');
  }
}

module.exports = TaskStatusTracker;