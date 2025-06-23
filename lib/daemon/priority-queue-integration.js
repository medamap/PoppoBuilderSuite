/**
 * Priority Queue Integration
 * 
 * Example of integrating TaskPriorityManager with the existing PoppoBuilder queue system
 */

const TaskPriorityManager = require('./task-priority-manager');
const EventEmitter = require('events');

class PriorityQueueIntegration extends EventEmitter {
  constructor(queueManager, config = {}) {
    super();
    
    this.queueManager = queueManager;
    this.priorityManager = new TaskPriorityManager(config.priority || {});
    this.runningTasks = new Map(); // taskId -> processInfo
    this.maxConcurrent = config.maxConcurrent || 5;
    
    this._setupEventHandlers();
    this._setupPeriodicScheduling();
  }
  
  /**
   * Set up event handlers for priority manager
   */
  _setupEventHandlers() {
    // Listen for priority updates
    this.priorityManager.on('priority-updated', ({ taskId, newPriority }) => {
      this.emit('priority-changed', { taskId, priority: newPriority });
    });
    
    // Listen for preemptions
    this.priorityManager.on('task-preempted', ({ taskId }) => {
      this._handlePreemption(taskId);
    });
    
    // Listen for analytics updates
    this.priorityManager.on('analytics-updated', (analytics) => {
      this.emit('analytics', analytics);
    });
  }
  
  /**
   * Set up periodic scheduling checks
   */
  _setupPeriodicScheduling() {
    // Check for new tasks to schedule every second
    this.schedulingInterval = setInterval(() => {
      this._scheduleNextTasks();
    }, 1000);
  }
  
  /**
   * Add a new task to the priority queue
   */
  async addTask(issue) {
    // Extract task details from issue
    const taskDetails = {
      title: issue.title,
      labels: issue.labels?.map(l => l.name) || [],
      createdAt: issue.created_at,
      assignees: issue.assignees?.map(a => a.login) || [],
      mentions: this._extractMentions(issue.body || ''),
      repository: issue.repository?.full_name,
      slaLevel: this._determineSLALevel(issue),
      history: [] // Could be populated from previous attempts
    };
    
    // Add to priority manager
    const task = this.priorityManager.addTask(`issue-${issue.number}`, taskDetails);
    
    // Store in queue manager if needed
    if (this.queueManager) {
      await this.queueManager.enqueue({
        ...issue,
        _priority: task.priority,
        _lane: task.lane
      });
    }
    
    this.emit('task-queued', {
      issueNumber: issue.number,
      priority: task.priority,
      lane: task.lane
    });
    
    // Immediately try to schedule if we have capacity
    this._scheduleNextTasks();
    
    return task;
  }
  
  /**
   * Schedule next tasks based on priority
   */
  async _scheduleNextTasks() {
    // Check if we have capacity
    if (this.runningTasks.size >= this.maxConcurrent) {
      return;
    }
    
    const availableSlots = this.maxConcurrent - this.runningTasks.size;
    
    for (let i = 0; i < availableSlots; i++) {
      const nextTask = this.priorityManager.getNextTask({
        allowPreemption: true
      });
      
      if (!nextTask) break;
      
      // Check for preemption opportunity
      if (this.runningTasks.size >= this.maxConcurrent) {
        const runningTaskIds = Array.from(this.runningTasks.keys());
        if (this.priorityManager.canPreempt(nextTask, runningTaskIds)) {
          // Find task to preempt
          const taskToPreempt = this._selectTaskToPreempt(runningTaskIds);
          if (taskToPreempt) {
            await this._handlePreemption(taskToPreempt);
          } else {
            break; // Can't preempt, stop scheduling
          }
        } else {
          break; // Can't schedule more tasks
        }
      }
      
      // Start the task
      await this._startTask(nextTask);
    }
  }
  
  /**
   * Start processing a task
   */
  async _startTask(task) {
    const issueNumber = parseInt(task.id.replace('issue-', ''));
    
    this.runningTasks.set(task.id, {
      startTime: Date.now(),
      priority: task.priority,
      attempts: task.attempts
    });
    
    this.emit('task-started', {
      taskId: task.id,
      issueNumber,
      priority: task.priority,
      waitTime: task.waitTime
    });
    
    // Here you would integrate with the actual task processor
    // For example:
    // await this.taskProcessor.process(issueNumber);
  }
  
  /**
   * Complete a task
   */
  async completeTask(taskId, result) {
    const runningInfo = this.runningTasks.get(taskId);
    if (!runningInfo) return;
    
    const duration = Date.now() - runningInfo.startTime;
    this.runningTasks.delete(taskId);
    
    // Remove from priority manager
    this.priorityManager.removeTask(taskId);
    
    this.emit('task-completed', {
      taskId,
      duration,
      result
    });
    
    // Schedule next tasks
    this._scheduleNextTasks();
  }
  
  /**
   * Handle task failure
   */
  async failTask(taskId, error) {
    const runningInfo = this.runningTasks.get(taskId);
    if (!runningInfo) return;
    
    this.runningTasks.delete(taskId);
    
    // Update task history and boost priority
    const task = this.priorityManager.tasks.get(taskId);
    if (task) {
      task.history.push({
        status: 'failed',
        timestamp: Date.now(),
        error: error.message
      });
      
      // Boost priority for retry
      this.priorityManager.updatePriority(taskId, 25);
    }
    
    this.emit('task-failed', {
      taskId,
      error,
      attempts: runningInfo.attempts
    });
    
    // Schedule next tasks
    this._scheduleNextTasks();
  }
  
  /**
   * Handle task preemption
   */
  async _handlePreemption(taskId) {
    const runningInfo = this.runningTasks.get(taskId);
    if (!runningInfo) return;
    
    // Save task state (in real implementation)
    const state = {
      progress: 'unknown',
      startTime: runningInfo.startTime,
      preemptedAt: Date.now()
    };
    
    // Preempt the task
    this.priorityManager.preemptTask(taskId, state);
    this.runningTasks.delete(taskId);
    
    this.emit('task-preempted', { taskId });
    
    // Here you would actually stop the running process
    // For example:
    // await this.taskProcessor.stop(taskId);
  }
  
  /**
   * Resume a preempted task
   */
  async resumeTask(taskId) {
    const resumeData = this.priorityManager.resumePreemptedTask(taskId);
    if (!resumeData) return null;
    
    // Re-add to running tasks
    await this._startTask(resumeData.task);
    
    this.emit('task-resumed', {
      taskId,
      preemptionDuration: resumeData.preemptionDuration,
      state: resumeData.state
    });
    
    return resumeData;
  }
  
  /**
   * Select which task to preempt
   */
  _selectTaskToPreempt(runningTaskIds) {
    // Select the lowest priority task
    let lowestPriority = Infinity;
    let taskToPreempt = null;
    
    for (const taskId of runningTaskIds) {
      const task = this.priorityManager.tasks.get(taskId);
      if (task && task.priority < lowestPriority) {
        lowestPriority = task.priority;
        taskToPreempt = taskId;
      }
    }
    
    return taskToPreempt;
  }
  
  /**
   * Extract mentions from text
   */
  _extractMentions(text) {
    const mentionRegex = /@(\w+)/g;
    const mentions = [];
    let match;
    
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[0]);
    }
    
    return mentions;
  }
  
  /**
   * Determine SLA level based on issue labels and other factors
   */
  _determineSLALevel(issue) {
    const labels = issue.labels?.map(l => l.name) || [];
    
    if (labels.includes('critical') || labels.includes('urgent')) {
      return 'critical';
    } else if (labels.includes('priority:high')) {
      return 'high';
    } else if (labels.includes('priority:low')) {
      return 'low';
    }
    
    return 'normal';
  }
  
  /**
   * Get current status
   */
  getStatus() {
    return {
      running: this.runningTasks.size,
      maxConcurrent: this.maxConcurrent,
      queueState: this.priorityManager.getQueueState(),
      runningTasks: Array.from(this.runningTasks.entries()).map(([id, info]) => ({
        id,
        duration: Date.now() - info.startTime,
        priority: info.priority
      }))
    };
  }
  
  /**
   * Generate comprehensive report
   */
  generateReport() {
    const priorityReport = this.priorityManager.generateReport();
    
    return {
      ...priorityReport,
      integration: {
        runningTasks: this.runningTasks.size,
        maxConcurrent: this.maxConcurrent,
        utilizationRate: (this.runningTasks.size / this.maxConcurrent) * 100
      }
    };
  }
  
  /**
   * Update configuration
   */
  updateConfig(newConfig) {
    if (newConfig.maxConcurrent !== undefined) {
      this.maxConcurrent = newConfig.maxConcurrent;
    }
    
    if (newConfig.priority) {
      // Update priority manager config
      Object.assign(this.priorityManager.config, newConfig.priority);
    }
    
    this.emit('config-updated', newConfig);
  }
  
  /**
   * Clean up resources
   */
  destroy() {
    clearInterval(this.schedulingInterval);
    this.priorityManager.destroy();
    this.removeAllListeners();
  }
}

module.exports = PriorityQueueIntegration;