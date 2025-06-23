/**
 * Task Priority Manager
 * 
 * Comprehensive priority management system for PoppoBuilder Suite
 * Handles dynamic priority calculation, queue reordering, and priority-based scheduling
 */

const EventEmitter = require('events');
const path = require('path');

class TaskPriorityManager extends EventEmitter {
  constructor(config = {}) {
    super();
    
    // Priority configuration
    this.config = {
      // Base priority levels from config
      priorityLevels: config.priorityLevels || {
        urgent: 1000,
        dogfooding: 100,
        high: 75,
        normal: 50,
        low: 25,
        deferred: 10
      },
      
      // Age-based priority increase
      ageEscalation: {
        enabled: config.ageEscalation?.enabled !== false,
        hourlyIncrease: config.ageEscalation?.hourlyIncrease || 1,
        maxIncrease: config.ageEscalation?.maxIncrease || 50,
        thresholdHours: config.ageEscalation?.thresholdHours || 24
      },
      
      // SLA configuration
      sla: {
        enabled: config.sla?.enabled !== false,
        levels: config.sla?.levels || {
          critical: { hours: 4, priorityBoost: 100 },
          high: { hours: 24, priorityBoost: 50 },
          normal: { hours: 72, priorityBoost: 25 },
          low: { hours: 168, priorityBoost: 10 } // 1 week
        }
      },
      
      // Priority lanes configuration
      lanes: {
        urgent: { min: 900, max: Infinity },
        high: { min: 70, max: 899 },
        normal: { min: 30, max: 69 },
        low: { min: 0, max: 29 }
      },
      
      // Starvation prevention
      starvationPrevention: {
        enabled: config.starvationPrevention?.enabled !== false,
        maxWaitTime: config.starvationPrevention?.maxWaitTime || 86400000, // 24 hours
        priorityBoost: config.starvationPrevention?.priorityBoost || 50
      },
      
      // Preemption configuration
      preemption: {
        enabled: config.preemption?.enabled || false,
        minPriorityDifference: config.preemption?.minPriorityDifference || 200,
        allowedTaskTypes: config.preemption?.allowedTaskTypes || ['urgent', 'critical'],
        saveState: config.preemption?.saveState !== false
      },
      
      // Dynamic adjustment rules
      dynamicAdjustment: {
        enabled: config.dynamicAdjustment?.enabled !== false,
        failureIncrease: config.dynamicAdjustment?.failureIncrease || 10,
        successDecrease: config.dynamicAdjustment?.successDecrease || 5,
        maxAdjustment: config.dynamicAdjustment?.maxAdjustment || 100
      }
    };
    
    // Internal state
    this.tasks = new Map(); // taskId -> task details
    this.priorityQueues = new Map(); // priority -> Set of taskIds
    this.rules = new Map(); // rule name -> rule function
    this.preemptedTasks = new Map(); // taskId -> saved state
    this.analytics = {
      totalTasks: 0,
      priorityDistribution: {},
      averageWaitTime: {},
      preemptions: 0,
      escalations: 0,
      starvationPreventions: 0
    };
    
    // Initialize priority queues
    this._initializePriorityQueues();
    
    // Start periodic checks
    this._startPeriodicChecks();
  }
  
  /**
   * Initialize priority queues
   */
  _initializePriorityQueues() {
    Object.keys(this.config.lanes).forEach(lane => {
      this.priorityQueues.set(lane, new Set());
    });
  }
  
  /**
   * Start periodic checks for priority adjustments
   */
  _startPeriodicChecks() {
    // Check for age escalation every minute
    this.ageCheckInterval = setInterval(() => {
      this._checkAgeEscalation();
    }, 60000);
    
    // Check for starvation prevention every 5 minutes
    this.starvationCheckInterval = setInterval(() => {
      this._checkStarvationPrevention();
    }, 300000);
    
    // Update analytics every 10 minutes
    this.analyticsInterval = setInterval(() => {
      this._updateAnalytics();
    }, 600000);
  }
  
  /**
   * Calculate priority for a task
   */
  calculatePriority(task) {
    let priority = 0;
    
    // 1. Base priority from configuration
    const taskType = task.labels?.find(l => l.startsWith('task:'))?.replace('task:', '') || 'normal';
    priority += this.config.priorityLevels[taskType] || this.config.priorityLevels.normal;
    
    // 2. Label-based modifiers
    if (task.labels) {
      if (task.labels.includes('urgent')) priority += 500;
      if (task.labels.includes('critical')) priority += 300;
      if (task.labels.includes('priority:high')) priority += 100;
      if (task.labels.includes('priority:low')) priority -= 25;
      if (task.labels.includes('blocked')) priority -= 50;
    }
    
    // 3. Age-based escalation
    if (this.config.ageEscalation.enabled && task.createdAt) {
      const ageHours = (Date.now() - new Date(task.createdAt).getTime()) / 3600000;
      if (ageHours >= this.config.ageEscalation.thresholdHours) {
        const ageIncrease = Math.min(
          ageHours * this.config.ageEscalation.hourlyIncrease,
          this.config.ageEscalation.maxIncrease
        );
        priority += ageIncrease;
      }
    }
    
    // 4. SLA-based priority
    if (this.config.sla.enabled && task.slaLevel) {
      const slaConfig = this.config.sla.levels[task.slaLevel];
      if (slaConfig) {
        const timeElapsed = Date.now() - new Date(task.createdAt).getTime();
        const slaDeadline = slaConfig.hours * 3600000;
        if (timeElapsed > slaDeadline * 0.8) { // 80% of SLA
          priority += slaConfig.priorityBoost;
        }
      }
    }
    
    // 5. User-specified priority override
    if (task.priorityOverride !== undefined) {
      priority = task.priorityOverride;
    }
    
    // 6. Apply custom rules
    for (const [ruleName, ruleFunc] of this.rules) {
      try {
        const adjustment = ruleFunc(task, priority);
        if (typeof adjustment === 'number') {
          priority += adjustment;
        }
      } catch (error) {
        console.error(`Error in priority rule ${ruleName}:`, error);
      }
    }
    
    // 7. Dynamic adjustments based on history
    if (this.config.dynamicAdjustment.enabled && task.history) {
      const failures = task.history.filter(h => h.status === 'failed').length;
      const successes = task.history.filter(h => h.status === 'success').length;
      
      const adjustment = Math.min(
        (failures * this.config.dynamicAdjustment.failureIncrease) -
        (successes * this.config.dynamicAdjustment.successDecrease),
        this.config.dynamicAdjustment.maxAdjustment
      );
      
      priority += adjustment;
    }
    
    // Ensure priority is non-negative
    return Math.max(0, Math.floor(priority));
  }
  
  /**
   * Add a task to the priority system
   */
  addTask(taskId, taskDetails) {
    const priority = this.calculatePriority(taskDetails);
    const lane = this._determineLane(priority);
    
    const enrichedTask = {
      ...taskDetails,
      id: taskId,
      priority,
      lane,
      addedAt: Date.now(),
      waitTime: 0,
      attempts: 0
    };
    
    this.tasks.set(taskId, enrichedTask);
    this.priorityQueues.get(lane).add(taskId);
    
    this.analytics.totalTasks++;
    this.emit('task-added', { taskId, priority, lane });
    
    return enrichedTask;
  }
  
  /**
   * Update task priority
   */
  updatePriority(taskId, adjustment) {
    const task = this.tasks.get(taskId);
    if (!task) return null;
    
    const oldPriority = task.priority;
    const oldLane = task.lane;
    
    // Recalculate priority with adjustment
    task.priorityOverride = (task.priorityOverride || task.priority) + adjustment;
    task.priority = this.calculatePriority(task);
    task.lane = this._determineLane(task.priority);
    
    // Move to new queue if lane changed
    if (oldLane !== task.lane) {
      this.priorityQueues.get(oldLane).delete(taskId);
      this.priorityQueues.get(task.lane).add(taskId);
    }
    
    this.emit('priority-updated', {
      taskId,
      oldPriority,
      newPriority: task.priority,
      oldLane,
      newLane: task.lane
    });
    
    return task;
  }
  
  /**
   * Get next task to process
   */
  getNextTask(options = {}) {
    const { allowPreemption = true, taskType = null } = options;
    
    // Check lanes in priority order
    const lanes = ['urgent', 'high', 'normal', 'low'];
    
    for (const lane of lanes) {
      const queue = this.priorityQueues.get(lane);
      if (queue.size === 0) continue;
      
      // Get tasks from this lane sorted by priority
      const laneTasks = Array.from(queue)
        .map(id => this.tasks.get(id))
        .filter(task => {
          if (!task) return false;
          if (taskType && !task.labels?.includes(`task:${taskType}`)) return false;
          return true;
        })
        .sort((a, b) => b.priority - a.priority);
      
      if (laneTasks.length > 0) {
        const task = laneTasks[0];
        
        // Update wait time
        task.waitTime = Date.now() - task.addedAt;
        task.attempts++;
        
        return task;
      }
    }
    
    return null;
  }
  
  /**
   * Check if a task can preempt currently running tasks
   */
  canPreempt(newTask, runningTasks) {
    if (!this.config.preemption.enabled) return false;
    
    // Check if task type allows preemption
    const taskType = newTask.labels?.find(l => l.startsWith('task:'))?.replace('task:', '');
    if (!this.config.preemption.allowedTaskTypes.includes(taskType)) return false;
    
    // Find lowest priority running task
    const lowestPriorityTask = runningTasks
      .map(id => this.tasks.get(id))
      .filter(Boolean)
      .sort((a, b) => a.priority - b.priority)[0];
    
    if (!lowestPriorityTask) return false;
    
    // Check priority difference
    const priorityDiff = newTask.priority - lowestPriorityTask.priority;
    return priorityDiff >= this.config.preemption.minPriorityDifference;
  }
  
  /**
   * Preempt a running task
   */
  preemptTask(taskId, state = {}) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    
    if (this.config.preemption.saveState) {
      this.preemptedTasks.set(taskId, {
        task,
        state,
        preemptedAt: Date.now()
      });
    }
    
    // Boost priority for when it resumes
    this.updatePriority(taskId, 50);
    
    this.analytics.preemptions++;
    this.emit('task-preempted', { taskId, priority: task.priority });
    
    return true;
  }
  
  /**
   * Resume a preempted task
   */
  resumePreemptedTask(taskId) {
    const preemptedData = this.preemptedTasks.get(taskId);
    if (!preemptedData) return null;
    
    this.preemptedTasks.delete(taskId);
    
    return {
      task: preemptedData.task,
      state: preemptedData.state,
      preemptionDuration: Date.now() - preemptedData.preemptedAt
    };
  }
  
  /**
   * Remove completed task
   */
  removeTask(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return false;
    
    this.priorityQueues.get(task.lane).delete(taskId);
    this.tasks.delete(taskId);
    this.preemptedTasks.delete(taskId);
    
    // Update analytics
    if (!this.analytics.averageWaitTime[task.lane]) {
      this.analytics.averageWaitTime[task.lane] = task.waitTime;
    } else {
      // Running average
      this.analytics.averageWaitTime[task.lane] = 
        (this.analytics.averageWaitTime[task.lane] + task.waitTime) / 2;
    }
    
    this.emit('task-removed', { taskId, priority: task.priority, lane: task.lane });
    
    return true;
  }
  
  /**
   * Add custom priority rule
   */
  addRule(name, ruleFunction) {
    if (typeof ruleFunction !== 'function') {
      throw new Error('Rule must be a function');
    }
    
    this.rules.set(name, ruleFunction);
    this.emit('rule-added', { name });
  }
  
  /**
   * Remove custom priority rule
   */
  removeRule(name) {
    const deleted = this.rules.delete(name);
    if (deleted) {
      this.emit('rule-removed', { name });
    }
    return deleted;
  }
  
  /**
   * Check for age-based escalation
   */
  _checkAgeEscalation() {
    if (!this.config.ageEscalation.enabled) return;
    
    let escalated = 0;
    
    for (const [taskId, task] of this.tasks) {
      const ageHours = (Date.now() - new Date(task.createdAt).getTime()) / 3600000;
      
      if (ageHours >= this.config.ageEscalation.thresholdHours) {
        const oldPriority = task.priority;
        const newPriority = this.calculatePriority(task);
        
        if (newPriority > oldPriority) {
          this.updatePriority(taskId, 0); // Recalculate without additional adjustment
          escalated++;
        }
      }
    }
    
    if (escalated > 0) {
      this.analytics.escalations += escalated;
      this.emit('age-escalation', { count: escalated });
    }
  }
  
  /**
   * Check for starvation prevention
   */
  _checkStarvationPrevention() {
    if (!this.config.starvationPrevention.enabled) return;
    
    const maxWait = this.config.starvationPrevention.maxWaitTime;
    const boost = this.config.starvationPrevention.priorityBoost;
    let prevented = 0;
    
    for (const [taskId, task] of this.tasks) {
      const waitTime = Date.now() - task.addedAt;
      
      if (waitTime >= maxWait && task.lane === 'low') {
        this.updatePriority(taskId, boost);
        prevented++;
      }
    }
    
    if (prevented > 0) {
      this.analytics.starvationPreventions += prevented;
      this.emit('starvation-prevented', { count: prevented });
    }
  }
  
  /**
   * Determine which lane a priority falls into
   */
  _determineLane(priority) {
    for (const [lane, range] of Object.entries(this.config.lanes)) {
      if (priority >= range.min && priority <= range.max) {
        return lane;
      }
    }
    return 'normal'; // Default
  }
  
  /**
   * Update analytics
   */
  _updateAnalytics() {
    // Priority distribution
    this.analytics.priorityDistribution = {};
    
    for (const [lane, queue] of this.priorityQueues) {
      this.analytics.priorityDistribution[lane] = queue.size;
    }
    
    // Calculate priority inflation rate
    const avgPriority = Array.from(this.tasks.values())
      .reduce((sum, task) => sum + task.priority, 0) / this.tasks.size || 0;
    
    this.analytics.averagePriority = avgPriority;
    
    this.emit('analytics-updated', this.analytics);
  }
  
  /**
   * Get current queue state
   */
  getQueueState() {
    const state = {
      totalTasks: this.tasks.size,
      queues: {},
      preemptedTasks: this.preemptedTasks.size,
      oldestTask: null,
      highestPriorityTask: null
    };
    
    // Queue sizes
    for (const [lane, queue] of this.priorityQueues) {
      state.queues[lane] = {
        size: queue.size,
        tasks: Array.from(queue).map(id => {
          const task = this.tasks.get(id);
          return {
            id,
            priority: task?.priority,
            waitTime: task ? Date.now() - task.addedAt : 0
          };
        }).sort((a, b) => b.priority - a.priority).slice(0, 5) // Top 5
      };
    }
    
    // Find oldest and highest priority tasks
    let oldestTime = Infinity;
    let highestPriority = -1;
    
    for (const task of this.tasks.values()) {
      if (task.addedAt < oldestTime) {
        oldestTime = task.addedAt;
        state.oldestTask = {
          id: task.id,
          age: Date.now() - task.addedAt,
          priority: task.priority
        };
      }
      
      if (task.priority > highestPriority) {
        highestPriority = task.priority;
        state.highestPriorityTask = {
          id: task.id,
          priority: task.priority,
          lane: task.lane
        };
      }
    }
    
    return state;
  }
  
  /**
   * Generate priority report
   */
  generateReport() {
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTasks: this.tasks.size,
        preemptedTasks: this.preemptedTasks.size,
        totalPreemptions: this.analytics.preemptions,
        totalEscalations: this.analytics.escalations,
        starvationPreventions: this.analytics.starvationPreventions
      },
      distribution: this.analytics.priorityDistribution,
      averageWaitTime: this.analytics.averageWaitTime,
      averagePriority: this.analytics.averagePriority,
      rules: Array.from(this.rules.keys()),
      recommendations: []
    };
    
    // Generate recommendations
    if (report.averagePriority > 100) {
      report.recommendations.push({
        type: 'priority-inflation',
        message: 'Average priority is high. Consider reviewing priority assignment rules.',
        severity: 'warning'
      });
    }
    
    if (this.analytics.starvationPreventions > 10) {
      report.recommendations.push({
        type: 'starvation',
        message: 'Many tasks are experiencing starvation. Consider adjusting queue sizes or priority ranges.',
        severity: 'warning'
      });
    }
    
    if (this.priorityQueues.get('urgent').size > 10) {
      report.recommendations.push({
        type: 'urgent-overuse',
        message: 'Too many urgent tasks. Review urgent task criteria.',
        severity: 'critical'
      });
    }
    
    return report;
  }
  
  /**
   * Clean up resources
   */
  destroy() {
    clearInterval(this.ageCheckInterval);
    clearInterval(this.starvationCheckInterval);
    clearInterval(this.analyticsInterval);
    
    this.tasks.clear();
    this.priorityQueues.clear();
    this.rules.clear();
    this.preemptedTasks.clear();
    
    this.removeAllListeners();
  }
}

module.exports = TaskPriorityManager;