/**
 * Task Result Handler for PoppoBuilder Daemon
 * Processes and manages task execution results from workers
 */

const path = require('path');
const fs = require('fs').promises;
const EventEmitter = require('events');

// PoppoBuilder components
const GitHubClient = require('../../src/github-client');
const DatabaseManager = require('../../src/database-manager');
const NotificationManager = require('../../src/notification-manager');
const Logger = require('../../src/logger');
const { I18nManager } = require('../i18n');
const { PoppoError, ErrorCodes } = require('../errors');

class TaskResultHandler extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      resultStoragePath: options.resultStoragePath || path.join(process.cwd(), 'data', 'results'),
      maxResultSize: options.maxResultSize || 10 * 1024 * 1024, // 10MB default
      retainResultsDays: options.retainResultsDays || 30,
      githubRetryAttempts: options.githubRetryAttempts || 3,
      githubRetryDelay: options.githubRetryDelay || 1000,
      notificationEnabled: options.notificationEnabled !== false,
      webhookUrls: options.webhookUrls || [],
      ...options
    };
    
    // Initialize components
    this.logger = new Logger('TaskResultHandler', options.loggerOptions);
    this.db = new DatabaseManager(options.databasePath);
    this.github = null; // Initialized when needed with project context
    this.notificationManager = null;
    this.i18n = new I18nManager(options.i18nOptions);
    
    // Result processing queue
    this.processingQueue = [];
    this.isProcessing = false;
    
    // Analytics tracking
    this.analytics = {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      avgProcessingTime: 0,
      lastHourMetrics: []
    };
    
    // Initialize storage
    this.initializeStorage();
  }
  
  /**
   * Initialize result storage directories
   */
  async initializeStorage() {
    try {
      await fs.mkdir(this.options.resultStoragePath, { recursive: true });
      await fs.mkdir(path.join(this.options.resultStoragePath, 'success'), { recursive: true });
      await fs.mkdir(path.join(this.options.resultStoragePath, 'error'), { recursive: true });
      await fs.mkdir(path.join(this.options.resultStoragePath, 'archive'), { recursive: true });
    } catch (error) {
      this.logger.error('Failed to initialize storage directories:', error);
    }
  }
  
  /**
   * Initialize notification manager
   */
  async initializeNotifications(config) {
    if (this.options.notificationEnabled && config.notifications?.enabled) {
      this.notificationManager = new NotificationManager(config, this.logger);
      await this.notificationManager.initialize();
    }
  }
  
  /**
   * Process task result from worker
   */
  async processResult(taskResult) {
    const startTime = Date.now();
    
    try {
      // Validate result format
      this.validateResult(taskResult);
      
      // Add to processing queue
      this.processingQueue.push(taskResult);
      
      // Process queue if not already processing
      if (!this.isProcessing) {
        await this.processQueue();
      }
      
      // Update analytics
      this.updateAnalytics(taskResult, Date.now() - startTime);
      
      return {
        success: true,
        resultId: taskResult.resultId,
        processedAt: new Date().toISOString()
      };
      
    } catch (error) {
      this.logger.error('Failed to process task result:', error);
      throw new PoppoError(
        ErrorCodes.TASK_RESULT_PROCESSING_FAILED,
        'Failed to process task result',
        { taskId: taskResult.taskId, error: error.message }
      );
    }
  }
  
  /**
   * Process queued results
   */
  async processQueue() {
    if (this.isProcessing || this.processingQueue.length === 0) {
      return;
    }
    
    this.isProcessing = true;
    
    try {
      while (this.processingQueue.length > 0) {
        const result = this.processingQueue.shift();
        await this.handleResult(result);
      }
    } finally {
      this.isProcessing = false;
    }
  }
  
  /**
   * Handle individual result processing
   */
  async handleResult(result) {
    const { task, success, error, output, duration, metrics } = result;
    
    try {
      // 1. Store result
      const storedResult = await this.storeResult(result);
      
      // 2. Update database
      await this.updateDatabase(result);
      
      // 3. Handle GitHub integration
      if (task.githubIntegration) {
        await this.handleGitHubIntegration(task, result);
      }
      
      // 4. Send notifications
      if (this.notificationManager) {
        await this.sendNotifications(task, result);
      }
      
      // 5. Execute webhooks
      if (this.options.webhookUrls.length > 0) {
        await this.executeWebhooks(task, result);
      }
      
      // 6. Process follow-up actions
      await this.processFollowUpActions(task, result);
      
      // Emit result processed event
      this.emit('result-processed', {
        taskId: task.id,
        success,
        duration,
        storedAt: storedResult.path
      });
      
    } catch (error) {
      this.logger.error(`Failed to handle result for task ${task.id}:`, error);
      
      // Store error result
      await this.storeErrorResult(task, error, result);
      
      // Emit error event
      this.emit('result-error', {
        taskId: task.id,
        error: error.message
      });
    }
  }
  
  /**
   * Validate result format
   */
  validateResult(result) {
    if (!result.task || !result.task.id) {
      throw new Error('Result must contain task with id');
    }
    
    if (typeof result.success !== 'boolean') {
      throw new Error('Result must contain success boolean');
    }
    
    if (!result.success && !result.error) {
      throw new Error('Failed result must contain error information');
    }
    
    if (result.output && Buffer.byteLength(JSON.stringify(result.output)) > this.options.maxResultSize) {
      throw new Error(`Result output exceeds maximum size of ${this.options.maxResultSize} bytes`);
    }
  }
  
  /**
   * Store result to file system
   */
  async storeResult(result) {
    const { task, success } = result;
    const resultId = `${task.id}-${Date.now()}`;
    const directory = success ? 'success' : 'error';
    const filePath = path.join(this.options.resultStoragePath, directory, `${resultId}.json`);
    
    // Prepare result data
    const resultData = {
      resultId,
      taskId: task.id,
      taskType: task.type,
      projectId: task.projectId,
      success,
      error: result.error ? {
        message: result.error.message,
        stack: result.error.stack,
        code: result.error.code
      } : null,
      output: result.output,
      duration: result.duration,
      metrics: result.metrics,
      processedAt: new Date().toISOString(),
      task: {
        ...task,
        // Remove sensitive data
        credentials: undefined,
        githubToken: undefined
      }
    };
    
    // Handle large outputs
    if (result.output && Buffer.byteLength(JSON.stringify(result.output)) > 1024 * 1024) {
      // Store large output separately
      const outputPath = path.join(this.options.resultStoragePath, directory, `${resultId}-output.json`);
      await fs.writeFile(outputPath, JSON.stringify(result.output, null, 2));
      resultData.output = { largeOutput: true, path: outputPath };
    }
    
    // Write result file
    await fs.writeFile(filePath, JSON.stringify(resultData, null, 2));
    
    return {
      resultId,
      path: filePath,
      size: Buffer.byteLength(JSON.stringify(resultData))
    };
  }
  
  /**
   * Store error result
   */
  async storeErrorResult(task, error, originalResult) {
    const errorResult = {
      task,
      success: false,
      error: {
        message: error.message,
        stack: error.stack,
        originalError: originalResult?.error
      },
      duration: originalResult?.duration || 0,
      timestamp: new Date().toISOString()
    };
    
    await this.storeResult(errorResult);
  }
  
  /**
   * Update database with result
   */
  async updateDatabase(result) {
    const { task, success, error, duration, metrics } = result;
    
    try {
      // Record process end
      await this.db.recordProcessEnd(task.processId || task.id, {
        status: success ? 'success' : 'error',
        exitCode: success ? 0 : 1,
        error: error,
        cpuUsage: metrics?.cpu || 0,
        memoryUsage: metrics?.memory || 0
      });
      
      // Record additional metrics
      if (metrics) {
        for (const [key, value] of Object.entries(metrics)) {
          await this.db.recordMetric(task.processId || task.id, key, value);
        }
      }
      
    } catch (dbError) {
      this.logger.error('Failed to update database:', dbError);
      // Don't throw - database update failure shouldn't stop result processing
    }
  }
  
  /**
   * Handle GitHub integration
   */
  async handleGitHubIntegration(task, result) {
    const { success, output, error } = result;
    
    // Initialize GitHub client with project context
    if (!this.github || this.github.projectId !== task.projectId) {
      this.github = new GitHubClient({
        token: task.githubToken || process.env[`GITHUB_TOKEN_${task.projectId.toUpperCase()}`] || process.env.GITHUB_TOKEN,
        owner: task.githubOwner,
        repo: task.githubRepo
      });
      this.github.projectId = task.projectId;
    }
    
    let attempts = 0;
    while (attempts < this.options.githubRetryAttempts) {
      try {
        switch (task.type) {
          case 'process-issue':
          case 'issue':
            await this.postIssueComment(task, result);
            break;
            
          case 'process-comment':
          case 'comment':
            await this.postCommentReply(task, result);
            break;
            
          case 'process-pr':
          case 'pr-review':
            await this.postPullRequestReview(task, result);
            break;
            
          case 'create-issue':
            if (success && output?.issueNumber) {
              await this.updateOriginalIssue(task, output.issueNumber);
            }
            break;
            
          case 'update-labels':
            if (success) {
              await this.updateIssueLabels(task, result);
            }
            break;
        }
        
        break; // Success, exit retry loop
        
      } catch (githubError) {
        attempts++;
        this.logger.warn(`GitHub operation failed (attempt ${attempts}/${this.options.githubRetryAttempts}):`, githubError);
        
        if (attempts < this.options.githubRetryAttempts) {
          await new Promise(resolve => setTimeout(resolve, this.options.githubRetryDelay * attempts));
        } else {
          throw githubError;
        }
      }
    }
  }
  
  /**
   * Post issue comment with result
   */
  async postIssueComment(task, result) {
    const { success, output, error } = result;
    const issueNumber = task.issueNumber || task.metadata?.issueNumber;
    
    if (!issueNumber) {
      throw new Error('Issue number not found in task');
    }
    
    let comment;
    if (success) {
      comment = this.formatSuccessComment(task, output);
    } else {
      comment = this.formatErrorComment(task, error);
    }
    
    await this.github.createComment(issueNumber, comment);
    
    // Update issue labels if needed
    if (success && task.updateLabels) {
      const labelsToAdd = task.successLabels || ['processed'];
      const labelsToRemove = task.processingLabels || ['processing'];
      
      await this.github.updateIssueLabels(issueNumber, {
        add: labelsToAdd,
        remove: labelsToRemove
      });
    }
  }
  
  /**
   * Post comment reply
   */
  async postCommentReply(task, result) {
    const { success, output, error } = result;
    const issueNumber = task.issueNumber || task.metadata?.issueNumber;
    const commentAuthor = task.commentAuthor || task.metadata?.commentAuthor;
    
    if (!issueNumber) {
      throw new Error('Issue number not found in task');
    }
    
    let reply;
    if (success) {
      reply = `@${commentAuthor}\n\n${output?.response || output}`;
    } else {
      reply = `@${commentAuthor}\n\nSorry, an error occurred while processing your request:\n\`\`\`\n${error.message}\n\`\`\``;
    }
    
    await this.github.createComment(issueNumber, reply);
  }
  
  /**
   * Post pull request review
   */
  async postPullRequestReview(task, result) {
    const { success, output, error } = result;
    const prNumber = task.prNumber || task.metadata?.prNumber;
    
    if (!prNumber) {
      throw new Error('PR number not found in task');
    }
    
    const review = {
      body: success ? output?.review || output : this.formatErrorComment(task, error),
      event: success && output?.approve ? 'APPROVE' : 'COMMENT'
    };
    
    await this.github.createPullRequestReview(prNumber, review);
  }
  
  /**
   * Update original issue when new issue is created
   */
  async updateOriginalIssue(task, newIssueNumber) {
    const originalIssueNumber = task.originalIssueNumber || task.metadata?.originalIssueNumber;
    
    if (originalIssueNumber) {
      const comment = `✅ Created new issue #${newIssueNumber} as requested.`;
      await this.github.createComment(originalIssueNumber, comment);
    }
  }
  
  /**
   * Update issue labels
   */
  async updateIssueLabels(task, result) {
    const issueNumber = task.issueNumber || task.metadata?.issueNumber;
    const { output } = result;
    
    if (issueNumber && output?.labels) {
      await this.github.updateIssueLabels(issueNumber, output.labels);
    }
  }
  
  /**
   * Format success comment
   */
  formatSuccessComment(task, output) {
    const header = '✅ **Task completed successfully**\n\n';
    
    if (typeof output === 'string') {
      return header + output;
    }
    
    if (output?.response) {
      return header + output.response;
    }
    
    if (output?.summary) {
      let comment = header + output.summary + '\n\n';
      
      if (output.details) {
        comment += '<details>\n<summary>Details</summary>\n\n';
        comment += '```\n' + JSON.stringify(output.details, null, 2) + '\n```\n';
        comment += '</details>';
      }
      
      return comment;
    }
    
    return header + '```json\n' + JSON.stringify(output, null, 2) + '\n```';
  }
  
  /**
   * Format error comment
   */
  formatErrorComment(task, error) {
    let comment = '❌ **Task failed**\n\n';
    comment += `**Error:** ${error.message}\n\n`;
    
    if (error.code) {
      comment += `**Error Code:** \`${error.code}\`\n\n`;
    }
    
    if (process.env.NODE_ENV === 'development' && error.stack) {
      comment += '<details>\n<summary>Stack Trace</summary>\n\n';
      comment += '```\n' + error.stack + '\n```\n';
      comment += '</details>';
    }
    
    return comment;
  }
  
  /**
   * Send notifications
   */
  async sendNotifications(task, result) {
    const { success, error } = result;
    const eventType = success ? 'task-success' : 'task-error';
    
    const notificationData = {
      taskId: task.id,
      taskType: task.type,
      projectId: task.projectId,
      issueNumber: task.issueNumber || task.metadata?.issueNumber,
      title: task.title || task.metadata?.issueTitle,
      success,
      error: error?.message,
      duration: result.duration,
      timestamp: new Date().toISOString()
    };
    
    try {
      await this.notificationManager.notify(eventType, notificationData);
    } catch (notifyError) {
      this.logger.error('Failed to send notification:', notifyError);
      // Don't throw - notification failure shouldn't stop result processing
    }
  }
  
  /**
   * Execute webhooks
   */
  async executeWebhooks(task, result) {
    const webhookData = {
      event: 'task-result',
      taskId: task.id,
      taskType: task.type,
      projectId: task.projectId,
      success: result.success,
      error: result.error?.message,
      output: result.output,
      duration: result.duration,
      timestamp: new Date().toISOString()
    };
    
    const promises = this.options.webhookUrls.map(async (url) => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PoppoBuilder-Event': 'task-result'
          },
          body: JSON.stringify(webhookData)
        });
        
        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }
        
      } catch (webhookError) {
        this.logger.error(`Failed to execute webhook ${url}:`, webhookError);
      }
    });
    
    await Promise.allSettled(promises);
  }
  
  /**
   * Process follow-up actions
   */
  async processFollowUpActions(task, result) {
    if (!result.success || !result.output?.followUpActions) {
      return;
    }
    
    const followUpActions = result.output.followUpActions;
    
    for (const action of followUpActions) {
      try {
        switch (action.type) {
          case 'create-task':
            this.emit('create-follow-up-task', {
              parentTaskId: task.id,
              taskData: action.data
            });
            break;
            
          case 'update-issue':
            if (this.github && action.issueNumber) {
              await this.github.updateIssue(action.issueNumber, action.updates);
            }
            break;
            
          case 'notify':
            if (this.notificationManager) {
              await this.notificationManager.notify(action.eventType, action.data);
            }
            break;
            
          default:
            this.logger.warn(`Unknown follow-up action type: ${action.type}`);
        }
      } catch (actionError) {
        this.logger.error(`Failed to execute follow-up action:`, actionError);
      }
    }
  }
  
  /**
   * Query stored results
   */
  async queryResults(options = {}) {
    const {
      taskId,
      projectId,
      taskType,
      success,
      startDate,
      endDate,
      limit = 100,
      offset = 0
    } = options;
    
    const results = [];
    const directories = success === undefined ? ['success', 'error'] : [success ? 'success' : 'error'];
    
    for (const dir of directories) {
      const dirPath = path.join(this.options.resultStoragePath, dir);
      
      try {
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          if (!file.endsWith('.json') || file.includes('-output.json')) {
            continue;
          }
          
          const filePath = path.join(dirPath, file);
          const content = await fs.readFile(filePath, 'utf8');
          const result = JSON.parse(content);
          
          // Apply filters
          if (taskId && result.taskId !== taskId) continue;
          if (projectId && result.projectId !== projectId) continue;
          if (taskType && result.taskType !== taskType) continue;
          if (startDate && new Date(result.processedAt) < new Date(startDate)) continue;
          if (endDate && new Date(result.processedAt) > new Date(endDate)) continue;
          
          results.push(result);
        }
      } catch (error) {
        this.logger.error(`Failed to read results from ${dir}:`, error);
      }
    }
    
    // Sort by processed date (newest first)
    results.sort((a, b) => new Date(b.processedAt) - new Date(a.processedAt));
    
    // Apply pagination
    return {
      results: results.slice(offset, offset + limit),
      total: results.length,
      hasMore: offset + limit < results.length
    };
  }
  
  /**
   * Get analytics data
   */
  getAnalytics() {
    const hourlyMetrics = this.getHourlyMetrics();
    
    return {
      overall: {
        totalProcessed: this.analytics.totalProcessed,
        successCount: this.analytics.successCount,
        failureCount: this.analytics.failureCount,
        successRate: this.analytics.totalProcessed > 0 
          ? (this.analytics.successCount / this.analytics.totalProcessed) * 100 
          : 0,
        avgProcessingTime: this.analytics.avgProcessingTime
      },
      hourly: hourlyMetrics,
      taskTypes: this.getTaskTypeAnalytics(),
      projects: this.getProjectAnalytics()
    };
  }
  
  /**
   * Get hourly metrics
   */
  getHourlyMetrics() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    
    // Filter metrics from last hour
    this.analytics.lastHourMetrics = this.analytics.lastHourMetrics.filter(
      m => m.timestamp > oneHourAgo
    );
    
    return {
      processed: this.analytics.lastHourMetrics.length,
      succeeded: this.analytics.lastHourMetrics.filter(m => m.success).length,
      failed: this.analytics.lastHourMetrics.filter(m => !m.success).length,
      avgTime: this.analytics.lastHourMetrics.length > 0
        ? this.analytics.lastHourMetrics.reduce((sum, m) => sum + m.processingTime, 0) / this.analytics.lastHourMetrics.length
        : 0
    };
  }
  
  /**
   * Get task type analytics
   */
  async getTaskTypeAnalytics() {
    const analytics = {};
    
    try {
      const taskTypes = ['process-issue', 'process-comment', 'process-pr', 'claude-cli', 'custom-command'];
      
      for (const taskType of taskTypes) {
        const stats = await this.db.getTaskTypeStatistics(taskType);
        analytics[taskType] = {
          total: stats.total_count,
          success: stats.success_count,
          failure: stats.failure_count,
          successRate: stats.total_count > 0 ? (stats.success_count / stats.total_count) * 100 : 0,
          avgDuration: stats.avg_duration || 0
        };
      }
    } catch (error) {
      this.logger.error('Failed to get task type analytics:', error);
    }
    
    return analytics;
  }
  
  /**
   * Get project analytics
   */
  async getProjectAnalytics() {
    const analytics = {};
    
    try {
      // Query database for project-specific metrics
      const projects = await this.db.getProjectMetrics();
      
      for (const project of projects) {
        analytics[project.projectId] = {
          total: project.total_count,
          success: project.success_count,
          failure: project.failure_count,
          successRate: project.total_count > 0 ? (project.success_count / project.total_count) * 100 : 0,
          avgDuration: project.avg_duration || 0
        };
      }
    } catch (error) {
      this.logger.error('Failed to get project analytics:', error);
    }
    
    return analytics;
  }
  
  /**
   * Update analytics with new result
   */
  updateAnalytics(result, processingTime) {
    this.analytics.totalProcessed++;
    
    if (result.success) {
      this.analytics.successCount++;
    } else {
      this.analytics.failureCount++;
    }
    
    // Update average processing time
    this.analytics.avgProcessingTime = 
      (this.analytics.avgProcessingTime * (this.analytics.totalProcessed - 1) + processingTime) / 
      this.analytics.totalProcessed;
    
    // Add to hourly metrics
    this.analytics.lastHourMetrics.push({
      timestamp: Date.now(),
      success: result.success,
      processingTime,
      taskType: result.task.type,
      projectId: result.task.projectId
    });
  }
  
  /**
   * Generate performance report
   */
  async generatePerformanceReport(period = 'daily') {
    const report = {
      period,
      generatedAt: new Date().toISOString(),
      summary: this.getAnalytics(),
      trends: await this.db.getPerformanceTrends('all', 'duration_ms', period === 'daily' ? 7 : 30),
      recommendations: []
    };
    
    // Add recommendations based on data
    if (report.summary.overall.successRate < 90) {
      report.recommendations.push({
        type: 'warning',
        message: 'Success rate is below 90%. Review error logs for common issues.'
      });
    }
    
    if (report.summary.overall.avgProcessingTime > 30000) {
      report.recommendations.push({
        type: 'performance',
        message: 'Average processing time exceeds 30 seconds. Consider optimizing task execution.'
      });
    }
    
    return report;
  }
  
  /**
   * Clean up old results
   */
  async cleanupOldResults() {
    const cutoffDate = Date.now() - (this.options.retainResultsDays * 24 * 60 * 60 * 1000);
    let cleaned = 0;
    
    const directories = ['success', 'error'];
    
    for (const dir of directories) {
      const dirPath = path.join(this.options.resultStoragePath, dir);
      
      try {
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
          const filePath = path.join(dirPath, file);
          const stats = await fs.stat(filePath);
          
          if (stats.mtime.getTime() < cutoffDate) {
            // Move to archive instead of deleting
            const archivePath = path.join(this.options.resultStoragePath, 'archive', file);
            await fs.rename(filePath, archivePath);
            cleaned++;
          }
        }
      } catch (error) {
        this.logger.error(`Failed to cleanup results in ${dir}:`, error);
      }
    }
    
    this.logger.info(`Cleaned up ${cleaned} old result files`);
    return cleaned;
  }
  
  /**
   * Shutdown handler
   */
  async shutdown() {
    this.logger.info('Shutting down TaskResultHandler');
    
    // Process remaining queue
    if (this.processingQueue.length > 0) {
      this.logger.info(`Processing ${this.processingQueue.length} remaining results`);
      await this.processQueue();
    }
    
    // Close database connection
    if (this.db) {
      this.db.close();
    }
    
    // Shutdown notification manager
    if (this.notificationManager) {
      await this.notificationManager.shutdown();
    }
    
    this.emit('shutdown');
  }
}

module.exports = TaskResultHandler;