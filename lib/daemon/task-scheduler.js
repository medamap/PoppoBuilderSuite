/**
 * Task Scheduler
 * Handles project polling and task discovery for PoppoBuilder Suite
 */

const EventEmitter = require('events');
const path = require('path');
const fs = require('fs').promises;
const GitHubClient = require('../../src/github-client');

class TaskScheduler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      defaultPollingInterval: 5 * 60 * 1000, // 5 minutes
      minPollingInterval: 60 * 1000, // 1 minute
      maxPollingInterval: 30 * 60 * 1000, // 30 minutes
      batchSize: 10,
      retryBackoff: 1.5,
      maxBackoff: 10 * 60 * 1000, // 10 minutes
      rateLimitBuffer: 0.1, // Keep 10% of rate limit as buffer
      ...options
    };
    
    this.projects = new Map();
    this.pollingTimers = new Map();
    this.backoffTimers = new Map();
    this.lastPollTimes = new Map();
    this.errorCounts = new Map();
    this.isRunning = false;
    this.queueManager = null;
    this.githubClient = null;
    
    // Task type mapping
    this.taskTypeMapping = {
      'task:misc': 'issue-processing',
      'task:dogfooding': 'issue-processing',
      'task:quality': 'issue-processing',
      'task:docs': 'issue-processing',
      'task:feature': 'issue-processing',
      'task:bug': 'issue-processing',
      'comment': 'comment-processing',
      'review': 'review-processing'
    };
    
    // Priority mapping
    this.priorityMapping = {
      'priority:urgent': 100,
      'priority:high': 75,
      'priority:medium': 50,
      'priority:low': 25,
      'task:dogfooding': 90,
      'task:bug': 80,
      'task:feature': 70,
      'task:quality': 60,
      'task:docs': 50,
      'task:misc': 40
    };
  }

  /**
   * Set the queue manager
   */
  setQueueManager(queueManager) {
    this.queueManager = queueManager;
  }

  /**
   * Start the scheduler
   */
  async start() {
    if (this.isRunning) {
      throw new Error('Scheduler is already running');
    }
    
    console.log('[TaskScheduler] Starting scheduler...');
    this.isRunning = true;
    this.emit('started');
    
    // Start polling for all registered projects
    console.log(`[TaskScheduler] Starting polling for ${this.projects.size} projects`);
    for (const [projectId, project] of this.projects) {
      console.log(`[TaskScheduler] Scheduling polling for project ${projectId}`);
      this.scheduleProjectPolling(projectId);
    }
  }

  /**
   * Stop the scheduler
   */
  async stop() {
    this.isRunning = false;
    
    // Clear all timers
    for (const timer of this.pollingTimers.values()) {
      clearTimeout(timer);
    }
    for (const timer of this.backoffTimers.values()) {
      clearTimeout(timer);
    }
    
    this.pollingTimers.clear();
    this.backoffTimers.clear();
    
    this.emit('stopped');
  }

  /**
   * Register a project for polling
   */
  registerProject(projectConfig) {
    const {
      id,
      owner,
      repo,
      pollingInterval,
      labels = [],
      excludeLabels = [],
      processComments = true,
      processPullRequests = false,
      priority = 50,
      weight = 1.0,
      enabled = true
    } = projectConfig;
    
    if (!id || !owner || !repo) {
      throw new Error('Project must have id, owner, and repo');
    }
    
    const project = {
      id,
      owner,
      repo,
      pollingInterval: pollingInterval || this.options.defaultPollingInterval,
      labels,
      excludeLabels,
      processComments,
      processPullRequests,
      priority,
      weight,
      enabled,
      githubClient: new GitHubClient({ owner, repo })
    };
    
    this.projects.set(id, project);
    this.lastPollTimes.set(id, 0);
    this.errorCounts.set(id, 0);
    
    // Start polling if scheduler is running
    if (this.isRunning && enabled) {
      this.scheduleProjectPolling(id);
    }
    
    this.emit('project-registered', project);
    return id;
  }

  /**
   * Unregister a project
   */
  unregisterProject(projectId) {
    if (!this.projects.has(projectId)) {
      return false;
    }
    
    // Clear timers
    if (this.pollingTimers.has(projectId)) {
      clearTimeout(this.pollingTimers.get(projectId));
      this.pollingTimers.delete(projectId);
    }
    if (this.backoffTimers.has(projectId)) {
      clearTimeout(this.backoffTimers.get(projectId));
      this.backoffTimers.delete(projectId);
    }
    
    // Remove project
    this.projects.delete(projectId);
    this.lastPollTimes.delete(projectId);
    this.errorCounts.delete(projectId);
    
    this.emit('project-unregistered', projectId);
    return true;
  }

  /**
   * Enable/disable a project
   */
  setProjectEnabled(projectId, enabled) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    project.enabled = enabled;
    
    if (enabled && this.isRunning) {
      this.scheduleProjectPolling(projectId);
    } else if (!enabled) {
      // Clear timers
      if (this.pollingTimers.has(projectId)) {
        clearTimeout(this.pollingTimers.get(projectId));
        this.pollingTimers.delete(projectId);
      }
    }
  }

  /**
   * Schedule polling for a project
   */
  scheduleProjectPolling(projectId) {
    const project = this.projects.get(projectId);
    if (!project || !project.enabled || !this.isRunning) {
      console.log(`[TaskScheduler] Not scheduling ${projectId}: project=${!!project}, enabled=${project?.enabled}, isRunning=${this.isRunning}`);
      return;
    }
    
    // Clear existing timer
    if (this.pollingTimers.has(projectId)) {
      clearTimeout(this.pollingTimers.get(projectId));
    }
    
    // Check if in backoff
    if (this.backoffTimers.has(projectId)) {
      console.log(`[TaskScheduler] Project ${projectId} is in backoff`);
      return;
    }
    
    // Calculate next poll time
    const lastPoll = this.lastPollTimes.get(projectId) || 0;
    const timeSinceLastPoll = Date.now() - lastPoll;
    const delay = Math.max(0, project.pollingInterval - timeSinceLastPoll);
    
    console.log(`[TaskScheduler] Scheduling poll for ${projectId} in ${delay}ms (interval: ${project.pollingInterval}ms)`);
    
    const timer = setTimeout(() => {
      console.log(`[TaskScheduler] Triggering poll for ${projectId}`);
      this.pollProject(projectId);
    }, delay);
    
    this.pollingTimers.set(projectId, timer);
  }

  /**
   * Trigger immediate polling for a project
   */
  async pollProjectNow(projectId) {
    const project = this.projects.get(projectId);
    if (!project || !project.enabled) {
      throw new Error(`Project ${projectId} not found or disabled`);
    }
    
    // Clear scheduled timer
    if (this.pollingTimers.has(projectId)) {
      clearTimeout(this.pollingTimers.get(projectId));
      this.pollingTimers.delete(projectId);
    }
    
    return await this.pollProject(projectId);
  }

  /**
   * Poll a project for tasks
   */
  async pollProject(projectId) {
    const project = this.projects.get(projectId);
    if (!project || !project.enabled) {
      console.log(`[TaskScheduler] Cannot poll ${projectId}: project=${!!project}, enabled=${project?.enabled}`);
      return;
    }
    
    console.log(`[TaskScheduler] Polling project ${projectId} (${project.owner}/${project.repo})`);
    this.lastPollTimes.set(projectId, Date.now());
    
    try {
      this.emit('polling-started', projectId);
      
      // Discover tasks
      console.log(`[TaskScheduler] Discovering tasks for ${projectId}...`);
      const tasks = await this.discoverTasks(project);
      console.log(`[TaskScheduler] Discovered ${tasks.length} tasks for ${projectId}`);
      
      // Create and queue tasks
      let queued = 0;
      for (const task of tasks) {
        if (this.queueManager) {
          await this.queueManager.addTask({
            ...task,
            projectId,
            priority: task.priority || project.priority,
            weight: project.weight
          });
          queued++;
        }
      }
      
      console.log(`[TaskScheduler] Queued ${queued} tasks for ${projectId}`);
      
      // Reset error count on success
      this.errorCounts.set(projectId, 0);
      
      this.emit('polling-completed', projectId, {
        discovered: tasks.length,
        queued
      });
      
      // Schedule next poll
      this.scheduleProjectPolling(projectId);
      
    } catch (error) {
      console.error(`[TaskScheduler] Error polling ${projectId}:`, error);
      // Handle errors with backoff
      this.handlePollingError(projectId, error);
    }
  }

  /**
   * Discover tasks for a project
   */
  async discoverTasks(project) {
    const tasks = [];
    const processedIssues = new Set();
    
    try {
      // Get open issues
      const issues = await project.githubClient.listIssues({
        state: 'open',
        labels: project.labels
      });
      
      // Filter issues
      const filteredIssues = issues.filter(issue => {
        // Check exclude labels
        const issueLabels = issue.labels.map(l => l.name);
        if (project.excludeLabels.some(label => issueLabels.includes(label))) {
          return false;
        }
        
        // Check if has any task label
        const hasTaskLabel = issueLabels.some(label => 
          Object.keys(this.taskTypeMapping).includes(label)
        );
        
        return hasTaskLabel || project.labels.length === 0;
      });
      
      // Create tasks for issues
      for (const issue of filteredIssues) {
        processedIssues.add(issue.number);
        
        const taskType = this.determineTaskType(issue);
        const priority = this.calculatePriority(issue);
        const deadline = this.extractDeadline(issue);
        
        tasks.push({
          type: taskType,
          source: 'issue',
          issueNumber: issue.number,
          title: issue.title,
          body: issue.body,
          labels: issue.labels.map(l => l.name),
          author: issue.author.login,
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
          priority,
          deadline,
          metadata: {
            owner: project.owner,
            repo: project.repo
          }
        });
      }
      
      // Process comments if enabled
      if (project.processComments) {
        const commentTasks = await this.discoverCommentTasks(project, processedIssues);
        tasks.push(...commentTasks);
      }
      
      // Process pull requests if enabled
      if (project.processPullRequests) {
        const prTasks = await this.discoverPullRequestTasks(project);
        tasks.push(...prTasks);
      }
      
    } catch (error) {
      this.emit('discovery-error', project.id, error);
      throw error;
    }
    
    return tasks;
  }

  /**
   * Discover comment tasks
   */
  async discoverCommentTasks(project, processedIssues) {
    const tasks = [];
    
    // Get recent comments on processed issues
    for (const issueNumber of processedIssues) {
      try {
        const comments = await project.githubClient.listComments(issueNumber);
        
        // Filter recent comments
        const recentComments = comments.filter(comment => {
          const commentAge = Date.now() - new Date(comment.createdAt).getTime();
          return commentAge < project.pollingInterval * 2; // Within 2 polling cycles
        });
        
        for (const comment of recentComments) {
          // Check if comment requires action
          if (this.requiresAction(comment)) {
            tasks.push({
              type: 'comment-processing',
              source: 'comment',
              issueNumber,
              commentId: comment.id,
              body: comment.body,
              author: comment.author.login,
              createdAt: comment.createdAt,
              priority: this.calculateCommentPriority(comment),
              metadata: {
                owner: project.owner,
                repo: project.repo
              }
            });
          }
        }
      } catch (error) {
        // Log but don't fail entire discovery
        this.emit('comment-discovery-error', project.id, issueNumber, error);
      }
    }
    
    return tasks;
  }

  /**
   * Discover pull request tasks
   */
  async discoverPullRequestTasks(project) {
    const tasks = [];
    
    try {
      const prs = await project.githubClient.listPullRequests(
        project.owner,
        project.repo,
        'open'
      );
      
      for (const pr of prs) {
        // Check if PR needs review
        if (!pr.draft && this.needsReview(pr)) {
          tasks.push({
            type: 'review-processing',
            source: 'pull-request',
            prNumber: pr.number,
            title: pr.title,
            body: pr.body,
            author: pr.author.login,
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            priority: this.calculatePRPriority(pr),
            metadata: {
              owner: project.owner,
              repo: project.repo,
              additions: pr.additions,
              deletions: pr.deletions
            }
          });
        }
      }
    } catch (error) {
      this.emit('pr-discovery-error', project.id, error);
    }
    
    return tasks;
  }

  /**
   * Determine task type from issue
   */
  determineTaskType(issue) {
    const labels = issue.labels.map(l => l.name);
    
    for (const label of labels) {
      if (this.taskTypeMapping[label]) {
        return this.taskTypeMapping[label];
      }
    }
    
    return 'issue-processing';
  }

  /**
   * Calculate priority for an issue
   */
  calculatePriority(issue) {
    const labels = issue.labels.map(l => l.name);
    let maxPriority = 50; // Default priority
    
    for (const label of labels) {
      if (this.priorityMapping[label]) {
        maxPriority = Math.max(maxPriority, this.priorityMapping[label]);
      }
    }
    
    // Boost priority for older issues
    const ageInDays = (Date.now() - new Date(issue.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (ageInDays > 7) {
      maxPriority += 10;
    }
    
    return Math.min(100, maxPriority);
  }

  /**
   * Calculate priority for a comment
   */
  calculateCommentPriority(comment) {
    // Higher priority for certain keywords
    const urgentKeywords = ['urgent', 'critical', 'blocker', 'asap'];
    const body = comment.body.toLowerCase();
    
    if (urgentKeywords.some(keyword => body.includes(keyword))) {
      return 80;
    }
    
    return 60;
  }

  /**
   * Calculate priority for a PR
   */
  calculatePRPriority(pr) {
    const labels = pr.labels?.map(l => l.name) || [];
    let priority = 70; // Default PR priority
    
    // Check for priority labels
    for (const label of labels) {
      if (this.priorityMapping[label]) {
        priority = Math.max(priority, this.priorityMapping[label]);
      }
    }
    
    // Small PRs get higher priority
    const changes = pr.additions + pr.deletions;
    if (changes < 50) {
      priority += 10;
    }
    
    return Math.min(100, priority);
  }

  /**
   * Extract deadline from issue body
   */
  extractDeadline(issue) {
    const deadlinePattern = /deadline:\s*(\d{4}-\d{2}-\d{2})/i;
    const match = issue.body?.match(deadlinePattern);
    
    if (match) {
      const deadline = new Date(match[1]);
      if (!isNaN(deadline.getTime())) {
        return deadline.toISOString();
      }
    }
    
    return null;
  }

  /**
   * Check if comment requires action
   */
  requiresAction(comment) {
    const actionKeywords = [
      'please',
      'can you',
      'could you',
      'implement',
      'fix',
      'update',
      'change',
      'add',
      'remove',
      '@poppobuilder'
    ];
    
    const body = comment.body.toLowerCase();
    return actionKeywords.some(keyword => body.includes(keyword));
  }

  /**
   * Check if PR needs review
   */
  needsReview(pr) {
    // Check if recently updated
    const updateAge = Date.now() - new Date(pr.updatedAt).getTime();
    const daysSinceUpdate = updateAge / (1000 * 60 * 60 * 24);
    
    // Review if updated within last 3 days
    return daysSinceUpdate <= 3;
  }

  /**
   * Handle polling errors with backoff
   */
  handlePollingError(projectId, error) {
    const errorCount = this.errorCounts.get(projectId) || 0;
    this.errorCounts.set(projectId, errorCount + 1);
    
    this.emit('polling-error', projectId, error, errorCount + 1);
    
    // Calculate backoff
    const backoffTime = Math.min(
      this.options.maxBackoff,
      this.options.minPollingInterval * Math.pow(this.options.retryBackoff, errorCount)
    );
    
    // Set backoff timer
    const backoffTimer = setTimeout(() => {
      this.backoffTimers.delete(projectId);
      this.scheduleProjectPolling(projectId);
    }, backoffTime);
    
    this.backoffTimers.set(projectId, backoffTimer);
  }

  /**
   * Get scheduler statistics
   */
  getStats() {
    const stats = {
      totalProjects: this.projects.size,
      enabledProjects: 0,
      projectStats: []
    };
    
    for (const [projectId, project] of this.projects) {
      if (project.enabled) {
        stats.enabledProjects++;
      }
      
      stats.projectStats.push({
        projectId,
        enabled: project.enabled,
        lastPoll: this.lastPollTimes.get(projectId) || null,
        errorCount: this.errorCounts.get(projectId) || 0,
        inBackoff: this.backoffTimers.has(projectId)
      });
    }
    
    return stats;
  }

  /**
   * Pause all polling
   */
  pauseAll() {
    for (const projectId of this.projects.keys()) {
      this.setProjectEnabled(projectId, false);
    }
    this.emit('all-paused');
  }

  /**
   * Resume all polling
   */
  resumeAll() {
    for (const projectId of this.projects.keys()) {
      this.setProjectEnabled(projectId, true);
    }
    this.emit('all-resumed');
  }

  /**
   * Get project configuration
   */
  getProject(projectId) {
    return this.projects.get(projectId);
  }

  /**
   * Update project configuration
   */
  updateProject(projectId, updates) {
    const project = this.projects.get(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    
    // Update allowed fields
    const allowedFields = [
      'pollingInterval', 'labels', 'excludeLabels',
      'processComments', 'processPullRequests',
      'priority', 'weight'
    ];
    
    for (const field of allowedFields) {
      if (updates.hasOwnProperty(field)) {
        project[field] = updates[field];
      }
    }
    
    // Reschedule if interval changed
    if (updates.pollingInterval && project.enabled && this.isRunning) {
      this.scheduleProjectPolling(projectId);
    }
    
    this.emit('project-updated', projectId, updates);
  }
}

module.exports = TaskScheduler;