/**
 * Global Queue Manager
 * Manages task queue across all projects with various scheduling strategies
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { StorageFactory, PersistenceMonitor } = require('./persistence');

class QueueManager extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      schedulingStrategy: 'weighted-round-robin',
      persistQueue: true,
      queueFile: path.join(os.homedir(), '.poppobuilder', 'queue.json'),
      maxRetries: 3,
      // New persistence options
      persistence: {
        type: 'json',
        autoSave: true,
        autoSaveInterval: 30000, // 30 seconds
        saveOnChange: false,
        enableSnapshots: true,
        snapshotInterval: 3600000, // 1 hour
        maxSnapshots: 24,
        enableMonitoring: true,
        // Storage-specific options
        ...options.persistence
      },
      ...options
    };
    
    // Merge persistence options
    if (options.persistence) {
      this.options.persistence = {
        ...this.options.persistence,
        ...options.persistence
      };
    }
    
    this.strategy = this.options.schedulingStrategy;
    this.queue = [];
    this.processing = new Map();
    this.projectStats = new Map();
    this.isRunning = false;
    this.processTimer = null;
    
    // Scheduling state
    this.roundRobinIndex = 0;
    this.fairShareTokens = new Map();
    
    // Persistence components
    this.storage = null;
    this.monitor = null;
    this.autoSaveTimer = null;
    this.snapshotTimer = null;
    this.lastSaveTime = null;
    this.pendingSave = false;
  }

  /**
   * Start the queue manager
   */
  async start() {
    this.isRunning = true;
    
    // Initialize persistence
    if (this.options.persistQueue) {
      await this.initializePersistence();
      await this.loadQueue();
      
      // Start auto-save if enabled
      if (this.options.persistence.autoSave) {
        this.startAutoSave();
      }
      
      // Start snapshots if enabled
      if (this.options.persistence.enableSnapshots) {
        this.startSnapshots();
      }
    }
    
    // Start processing
    this.startProcessing();
    
    this.emit('started');
  }

  /**
   * Stop the queue manager
   */
  async stop() {
    this.isRunning = false;
    
    if (this.processTimer) {
      clearTimeout(this.processTimer);
    }
    
    // Stop auto-save
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
    
    // Stop snapshots
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
    
    // Save final state
    if (this.options.persistQueue) {
      await this.saveQueue();
    }
    
    // Stop monitoring
    if (this.monitor) {
      this.monitor.stop();
    }
    
    // Close storage
    if (this.storage) {
      await this.storage.close();
    }
    
    this.emit('stopped');
  }

  /**
   * Add a task to the queue
   */
  async addTask(task) {
    const queueTask = {
      id: this.generateTaskId(),
      ...task,
      addedAt: new Date().toISOString(),
      retries: 0,
      status: 'queued'
    };
    
    // Initialize project stats if needed
    if (!this.projectStats.has(task.projectId)) {
      this.projectStats.set(task.projectId, {
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0
      });
    }
    
    // Initialize fair share tokens
    if (!this.fairShareTokens.has(task.projectId)) {
      this.fairShareTokens.set(task.projectId, task.weight || 1.0);
    }
    
    this.queue.push(queueTask);
    this.projectStats.get(task.projectId).queued++;
    
    this.emit('task-added', queueTask);
    
    // Save if configured
    if (this.options.persistence.saveOnChange) {
      await this.saveQueue();
    }
    
    // Trigger processing
    this.scheduleProcessing();
    
    return queueTask.id;
  }

  /**
   * Get next task based on scheduling strategy
   */
  getNextTask() {
    if (this.queue.length === 0) {
      return null;
    }
    
    let selectedTask = null;
    let selectedIndex = -1;
    
    switch (this.strategy) {
      case 'fifo':
        // First in, first out
        selectedTask = this.queue[0];
        selectedIndex = 0;
        break;
        
      case 'priority':
        // Highest priority first
        selectedIndex = 0;
        let highestPriority = -1;
        for (let i = 0; i < this.queue.length; i++) {
          if (this.queue[i].priority > highestPriority) {
            highestPriority = this.queue[i].priority;
            selectedIndex = i;
          }
        }
        selectedTask = this.queue[selectedIndex];
        break;
        
      case 'round-robin':
        // Round robin between projects
        selectedTask = this.selectRoundRobin();
        break;
        
      case 'weighted-round-robin':
        // Weighted round robin
        selectedTask = this.selectWeightedRoundRobin();
        break;
        
      case 'deadline-aware':
        // Consider deadlines if available
        selectedTask = this.selectDeadlineAware();
        break;
        
      default:
        // Default to FIFO
        selectedTask = this.queue[0];
        selectedIndex = 0;
    }
    
    if (selectedTask) {
      // Remove from queue
      if (selectedIndex === -1) {
        selectedIndex = this.queue.indexOf(selectedTask);
      }
      this.queue.splice(selectedIndex, 1);
      
      // Update to processing
      selectedTask.status = 'processing';
      selectedTask.startedAt = new Date().toISOString();
      this.processing.set(selectedTask.id, selectedTask);
      
      // Update stats
      const stats = this.projectStats.get(selectedTask.projectId);
      stats.queued--;
      stats.processing++;
    }
    
    return selectedTask;
  }

  /**
   * Round robin selection
   */
  selectRoundRobin() {
    const projects = new Set(this.queue.map(t => t.projectId));
    const projectArray = Array.from(projects);
    
    if (projectArray.length === 0) return null;
    
    // Find next project in rotation
    let attempts = 0;
    while (attempts < projectArray.length) {
      const currentProject = projectArray[this.roundRobinIndex % projectArray.length];
      this.roundRobinIndex++;
      
      // Find task from this project
      const task = this.queue.find(t => t.projectId === currentProject);
      if (task) {
        return task;
      }
      
      attempts++;
    }
    
    // Fallback to first available
    return this.queue[0];
  }

  /**
   * Weighted round robin selection
   */
  selectWeightedRoundRobin() {
    let selectedTask = null;
    let maxTokens = -1;
    
    // Find project with most tokens
    for (const task of this.queue) {
      const tokens = this.fairShareTokens.get(task.projectId) || 0;
      if (tokens > maxTokens) {
        maxTokens = tokens;
        selectedTask = task;
      }
    }
    
    if (selectedTask) {
      // Consume tokens
      const currentTokens = this.fairShareTokens.get(selectedTask.projectId);
      this.fairShareTokens.set(selectedTask.projectId, currentTokens - 1);
      
      // Replenish tokens if all are depleted
      const allDepleted = Array.from(this.fairShareTokens.values()).every(t => t <= 0);
      if (allDepleted) {
        for (const [projectId, _] of this.fairShareTokens) {
          const project = this.queue.find(t => t.projectId === projectId);
          const weight = project ? (project.weight || 1.0) : 1.0;
          this.fairShareTokens.set(projectId, weight);
        }
      }
    }
    
    return selectedTask;
  }

  /**
   * Deadline aware selection
   */
  selectDeadlineAware() {
    let urgentTask = null;
    let earliestDeadline = null;
    
    // First check for tasks with deadlines
    for (const task of this.queue) {
      if (task.deadline) {
        const deadline = new Date(task.deadline);
        if (!earliestDeadline || deadline < earliestDeadline) {
          earliestDeadline = deadline;
          urgentTask = task;
        }
      }
    }
    
    // If found urgent task, return it
    if (urgentTask) {
      const hoursUntilDeadline = (earliestDeadline - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilDeadline < 24) { // Less than 24 hours
        return urgentTask;
      }
    }
    
    // Otherwise fall back to priority
    return this.queue.reduce((highest, task) => 
      (task.priority > highest.priority) ? task : highest
    );
  }

  /**
   * Start processing tasks
   */
  startProcessing() {
    const process = () => {
      if (!this.isRunning) return;
      
      // Check if there are available tasks and emit them
      const task = this.getNextTask();
      if (task) {
        this.emit('task-ready', task);
      }
      
      // Schedule next check
      this.scheduleProcessing();
    };
    
    process();
  }

  /**
   * Schedule next processing
   */
  scheduleProcessing() {
    if (this.processTimer) {
      clearTimeout(this.processTimer);
    }
    
    if (this.isRunning && this.queue.length > 0) {
      this.processTimer = setTimeout(() => {
        this.startProcessing();
      }, 100); // Small delay to batch operations
    }
  }

  /**
   * Complete a task
   */
  async completeTask(taskId, result) {
    const task = this.processing.get(taskId);
    if (!task) return;
    
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = result;
    
    this.processing.delete(taskId);
    
    // Update stats
    const stats = this.projectStats.get(task.projectId);
    stats.processing--;
    stats.completed++;
    
    this.emit('task-completed', task);
    
    // Save if configured
    if (this.options.persistence.saveOnChange) {
      await this.saveQueue();
    }
  }

  /**
   * Fail a task
   */
  async failTask(taskId, error) {
    const task = this.processing.get(taskId);
    if (!task) return;
    
    task.retries++;
    task.lastError = error;
    
    this.processing.delete(taskId);
    
    // Update stats
    const stats = this.projectStats.get(task.projectId);
    stats.processing--;
    
    if (task.retries < this.options.maxRetries) {
      // Retry
      task.status = 'queued';
      this.queue.push(task);
      stats.queued++;
      this.emit('task-retry', task);
      this.scheduleProcessing();
    } else {
      // Final failure
      task.status = 'failed';
      task.failedAt = new Date().toISOString();
      stats.failed++;
      this.emit('task-failed', task);
    }
  }

  /**
   * Get queue statistics
   */
  async getStats() {
    const projectStatsArray = [];
    for (const [projectId, stats] of this.projectStats) {
      projectStatsArray.push({
        projectId,
        ...stats
      });
    }
    
    return {
      totalQueued: this.queue.length,
      totalProcessing: this.processing.size,
      strategy: this.strategy,
      projectStats: projectStatsArray
    };
  }

  /**
   * Set scheduling strategy
   */
  setStrategy(strategy) {
    this.strategy = strategy;
    this.emit('strategy-changed', strategy);
  }

  /**
   * Initialize persistence
   */
  async initializePersistence() {
    // Create storage adapter
    this.storage = StorageFactory.createFromConfig({
      type: this.options.persistence.type,
      filePath: this.options.queueFile,
      ...this.options.persistence
    });
    
    await this.storage.initialize();
    
    // Create monitor if enabled
    if (this.options.persistence.enableMonitoring) {
      this.monitor = new PersistenceMonitor({
        alertThresholds: this.options.persistence.alertThresholds
      });
      
      this.monitor.on('alert', (alert) => {
        this.emit('persistence-alert', alert);
      });
      
      this.monitor.start();
    }
  }

  /**
   * Load queue from storage
   */
  async loadQueue() {
    if (!this.storage) return;
    
    try {
      const data = await this.trackPersistenceOperation('load', async () => {
        return await this.storage.load();
      });
      
      this.queue = data.queue || [];
      
      // Restore processing map
      if (data.processing) {
        this.processing = new Map(Object.entries(data.processing));
      }
      
      // Restore project stats
      if (data.projectStats) {
        this.projectStats = new Map(Object.entries(data.projectStats));
      } else {
        // Rebuild project stats
        for (const task of this.queue) {
          if (!this.projectStats.has(task.projectId)) {
            this.projectStats.set(task.projectId, {
              queued: 0,
              processing: 0,
              completed: 0,
              failed: 0
            });
          }
          this.projectStats.get(task.projectId).queued++;
        }
      }
      
      this.emit('queue-loaded', { queueLength: this.queue.length });
      
    } catch (error) {
      console.error('Failed to load queue:', error);
      this.emit('persistence-error', { operation: 'load', error });
    }
  }

  /**
   * Save queue to storage
   */
  async saveQueue() {
    if (!this.storage) return;
    
    // Debounce rapid saves
    if (this.pendingSave) return;
    
    this.pendingSave = true;
    
    try {
      await this.trackPersistenceOperation('save', async () => {
        const data = {
          queue: this.queue,
          processing: Object.fromEntries(this.processing),
          projectStats: Object.fromEntries(this.projectStats),
          savedAt: new Date().toISOString()
        };
        
        await this.storage.save(data);
      });
      
      this.lastSaveTime = Date.now();
      this.emit('queue-saved', { queueLength: this.queue.length });
      
    } catch (error) {
      console.error('Failed to save queue:', error);
      this.emit('persistence-error', { operation: 'save', error });
    } finally {
      this.pendingSave = false;
    }
    
    // Update storage size for monitoring
    if (this.monitor) {
      const stats = await this.storage.getStats();
      this.monitor.updateStorageSize(stats.totalSize || 0);
    }
  }

  /**
   * Generate unique task ID
   */
  generateTaskId() {
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get queue contents
   */
  getQueue() {
    return [...this.queue];
  }

  /**
   * Get processing tasks
   */
  getProcessing() {
    return Array.from(this.processing.values());
  }

  /**
   * Remove a task from queue
   */
  removeTask(taskId) {
    const index = this.queue.findIndex(t => t.id === taskId);
    if (index !== -1) {
      const task = this.queue[index];
      this.queue.splice(index, 1);
      
      // Update stats
      const stats = this.projectStats.get(task.projectId);
      stats.queued--;
      
      this.emit('task-removed', task);
      return true;
    }
    return false;
  }

  /**
   * Clear all tasks for a project
   */
  clearProject(projectId) {
    // Remove from queue
    const removed = this.queue.filter(t => t.projectId === projectId);
    this.queue = this.queue.filter(t => t.projectId !== projectId);
    
    // Update stats
    const stats = this.projectStats.get(projectId);
    if (stats) {
      stats.queued = 0;
    }
    
    this.emit('project-cleared', projectId, removed.length);
    return removed.length;
  }

  /**
   * Track persistence operation with monitoring
   */
  async trackPersistenceOperation(operation, fn) {
    if (this.monitor) {
      return await this.monitor.trackOperation(operation, fn);
    } else {
      return await fn();
    }
  }

  /**
   * Start auto-save timer
   */
  startAutoSave() {
    this.autoSaveTimer = setInterval(async () => {
      if (this.lastSaveTime && (Date.now() - this.lastSaveTime) < this.options.persistence.autoSaveInterval / 2) {
        // Skip if recently saved
        return;
      }
      
      await this.saveQueue();
    }, this.options.persistence.autoSaveInterval);
  }

  /**
   * Start snapshot timer
   */
  startSnapshots() {
    this.snapshotTimer = setInterval(async () => {
      await this.createSnapshot();
    }, this.options.persistence.snapshotInterval);
    
    // Create initial snapshot
    this.createSnapshot();
  }

  /**
   * Create a snapshot
   */
  async createSnapshot(name = null) {
    if (!this.storage) return;
    
    try {
      const snapshotId = name || `auto-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      
      await this.trackPersistenceOperation('snapshot', async () => {
        const data = {
          queue: this.queue,
          processing: Object.fromEntries(this.processing),
          projectStats: Object.fromEntries(this.projectStats),
          savedAt: new Date().toISOString()
        };
        
        await this.storage.createSnapshot(snapshotId, data);
      });
      
      // Clean up old snapshots
      await this.cleanupSnapshots();
      
      this.emit('snapshot-created', { snapshotId });
      
    } catch (error) {
      console.error('Failed to create snapshot:', error);
      this.emit('persistence-error', { operation: 'snapshot', error });
    }
  }

  /**
   * Restore from snapshot
   */
  async restoreSnapshot(snapshotId) {
    if (!this.storage) return;
    
    try {
      const data = await this.trackPersistenceOperation('restore', async () => {
        return await this.storage.restoreSnapshot(snapshotId);
      });
      
      this.queue = data.queue || [];
      
      // Restore processing map
      if (data.processing) {
        this.processing = new Map(Object.entries(data.processing));
      }
      
      // Restore project stats
      if (data.projectStats) {
        this.projectStats = new Map(Object.entries(data.projectStats));
      }
      
      this.emit('snapshot-restored', { snapshotId });
      
    } catch (error) {
      console.error('Failed to restore snapshot:', error);
      this.emit('persistence-error', { operation: 'restore', error });
      throw error;
    }
  }

  /**
   * List available snapshots
   */
  async listSnapshots() {
    if (!this.storage) return [];
    
    try {
      return await this.storage.listSnapshots();
    } catch (error) {
      console.error('Failed to list snapshots:', error);
      return [];
    }
  }

  /**
   * Clean up old snapshots
   */
  async cleanupSnapshots() {
    if (!this.storage || !this.options.persistence.maxSnapshots) return;
    
    try {
      const snapshots = await this.storage.listSnapshots();
      
      // Keep only auto snapshots for cleanup
      const autoSnapshots = snapshots.filter(s => s.id.startsWith('auto-'));
      
      if (autoSnapshots.length > this.options.persistence.maxSnapshots) {
        // Sort by creation date, oldest first
        autoSnapshots.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        
        // Delete oldest snapshots
        const toDelete = autoSnapshots.length - this.options.persistence.maxSnapshots;
        for (let i = 0; i < toDelete; i++) {
          await this.storage.deleteSnapshot(autoSnapshots[i].id);
        }
      }
    } catch (error) {
      console.error('Failed to cleanup snapshots:', error);
    }
  }

  /**
   * Export queue data
   */
  async exportQueue(format = 'json') {
    const data = {
      queue: this.queue,
      processing: Object.fromEntries(this.processing),
      projectStats: Object.fromEntries(this.projectStats),
      exportedAt: new Date().toISOString()
    };
    
    switch (format) {
      case 'json':
        return JSON.stringify(data, null, 2);
        
      case 'csv':
        // Convert to CSV format
        const tasks = [...this.queue, ...Array.from(this.processing.values())];
        if (tasks.length === 0) return 'id,projectId,type,priority,status,addedAt\n';
        
        const headers = Object.keys(tasks[0]).join(',');
        const rows = tasks.map(task => 
          Object.values(task).map(v => 
            typeof v === 'string' && v.includes(',') ? `"${v}"` : v
          ).join(',')
        );
        
        return [headers, ...rows].join('\n');
        
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Import queue data
   */
  async importQueue(data, format = 'json', merge = false) {
    let imported;
    
    switch (format) {
      case 'json':
        imported = typeof data === 'string' ? JSON.parse(data) : data;
        break;
        
      default:
        throw new Error(`Unsupported import format: ${format}`);
    }
    
    if (!merge) {
      // Clear existing data
      this.queue = [];
      this.processing.clear();
      this.projectStats.clear();
    }
    
    // Import queue
    if (imported.queue) {
      for (const task of imported.queue) {
        await this.addTask(task);
      }
    }
    
    // Import processing tasks
    if (imported.processing) {
      for (const [taskId, task] of Object.entries(imported.processing)) {
        this.processing.set(taskId, task);
      }
    }
    
    // Import project stats
    if (imported.projectStats) {
      for (const [projectId, stats] of Object.entries(imported.projectStats)) {
        if (merge && this.projectStats.has(projectId)) {
          // Merge stats
          const existing = this.projectStats.get(projectId);
          this.projectStats.set(projectId, {
            queued: existing.queued + (stats.queued || 0),
            processing: existing.processing + (stats.processing || 0),
            completed: existing.completed + (stats.completed || 0),
            failed: existing.failed + (stats.failed || 0)
          });
        } else {
          this.projectStats.set(projectId, stats);
        }
      }
    }
    
    this.emit('queue-imported', { 
      tasksImported: imported.queue ? imported.queue.length : 0 
    });
  }

  /**
   * Get persistence statistics
   */
  async getPersistenceStats() {
    const stats = {
      storage: null,
      monitor: null
    };
    
    if (this.storage) {
      stats.storage = await this.storage.getStats();
    }
    
    if (this.monitor) {
      stats.monitor = this.monitor.getMetrics();
    }
    
    return stats;
  }

  /**
   * Get persistence performance report
   */
  async getPersistenceReport() {
    if (!this.monitor) {
      return { message: 'Persistence monitoring is disabled' };
    }
    
    return this.monitor.getPerformanceReport();
  }
}

module.exports = QueueManager;