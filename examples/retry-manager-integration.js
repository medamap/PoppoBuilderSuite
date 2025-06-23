/**
 * Task Retry Manager Integration Example
 * Shows how to integrate the retry manager with queue manager and result handler
 */

const QueueManager = require('../lib/daemon/queue-manager');
const TaskResultHandler = require('../lib/daemon/task-result-handler');
const TaskRetryManager = require('../lib/daemon/task-retry-manager');
const WorkerPool = require('../lib/daemon/worker-pool');

// Configuration
const config = {
  retry: {
    maxRetries: {
      default: 3,
      'rate-limit': 5,
      'network': 5,
      'timeout': 3,
      'api-error': 2,
      'validation': 0,
      'auth': 0
    },
    backoff: {
      initial: 1000,
      max: 300000,
      multiplier: 2,
      jitter: 0.1,
      strategy: 'exponential'
    },
    deadLetterQueue: {
      enabled: true,
      retentionDays: 30
    },
    circuitBreaker: {
      enabled: true,
      threshold: 5,
      timeout: 60000,
      halfOpenRequests: 2
    }
  }
};

class IntegratedTaskSystem {
  constructor(options = {}) {
    this.options = options;
    
    // Initialize components
    this.queueManager = new QueueManager(options.queue);
    this.retryManager = new TaskRetryManager(options.retry);
    this.resultHandler = new TaskResultHandler(options.result);
    this.workerPool = new WorkerPool(options.worker);
    
    // Set up integrations
    this.setupIntegrations();
  }
  
  async initialize() {
    // Initialize all components
    await this.retryManager.initialize();
    await this.queueManager.start();
    await this.workerPool.initialize();
    
    console.log('Integrated task system initialized');
  }
  
  setupIntegrations() {
    // Queue Manager → Worker Pool
    this.queueManager.on('task-ready', async (task) => {
      // Check if circuit breaker is open
      if (this.retryManager.isCircuitOpen(task.type)) {
        console.log(`Circuit breaker open for ${task.type}, sending to dead letter`);
        await this.retryManager.sendToDeadLetter(task, 'circuit-breaker-open', {});
        return;
      }
      
      // Assign to worker
      try {
        await this.workerPool.assignTask(task);
      } catch (error) {
        console.error('Failed to assign task to worker:', error);
        await this.handleTaskFailure(task, error);
      }
    });
    
    // Worker Pool → Result Handler
    this.workerPool.on('task-completed', async (taskResult) => {
      try {
        await this.resultHandler.processResult(taskResult);
        
        // Clear retry state on success
        if (taskResult.success) {
          await this.retryManager.processSuccess(taskResult.task);
        }
      } catch (error) {
        console.error('Failed to process result:', error);
      }
    });
    
    // Worker Pool → Retry Manager (on failure)
    this.workerPool.on('task-failed', async (taskResult) => {
      await this.handleTaskFailure(taskResult.task, taskResult.error, taskResult);
    });
    
    // Result Handler → Retry Manager (on result processing failure)
    this.resultHandler.on('result-error', async (event) => {
      const task = await this.getTaskById(event.taskId);
      if (task) {
        await this.handleTaskFailure(task, new Error(event.error));
      }
    });
    
    // Retry Manager → Queue Manager (schedule retry)
    this.retryManager.on('task-retry-scheduled', async (event) => {
      const { taskId, delay } = event;
      
      // Get the original task
      const task = await this.getTaskById(taskId);
      if (!task) return;
      
      // Schedule retry
      if (delay > 0) {
        setTimeout(async () => {
          // Re-add to queue with updated retry count
          task.retryAttempt = event.attempt;
          await this.queueManager.addTask(task);
        }, delay);
      } else {
        // Immediate retry
        task.retryAttempt = event.attempt;
        await this.queueManager.addTask(task);
      }
    });
    
    // Retry Manager alerts
    this.retryManager.on('retry-alert', (alert) => {
      console.error('RETRY ALERT:', alert);
      // Could send to monitoring system, create issue, etc.
    });
    
    // Circuit breaker events
    this.retryManager.on('circuit-breaker-opened', (event) => {
      console.warn(`Circuit breaker opened for task type: ${event.taskType}`);
      // Could notify administrators
    });
    
    this.retryManager.on('circuit-breaker-closed', (event) => {
      console.info(`Circuit breaker closed for task type: ${event.taskType}`);
    });
    
    // Dead letter events
    this.retryManager.on('dead-letter-created', async (event) => {
      console.warn(`Task sent to dead letter queue: ${event.taskId} (${event.reason})`);
      
      // Could create GitHub issue for manual review
      if (this.options.createDeadLetterIssues) {
        await this.createDeadLetterIssue(event);
      }
    });
    
    // Result handler follow-up tasks
    this.resultHandler.on('create-follow-up-task', async (event) => {
      const { parentTaskId, taskData } = event;
      
      // Add parent reference
      taskData.parentTaskId = parentTaskId;
      
      // Add to queue
      await this.queueManager.addTask(taskData);
    });
  }
  
  async handleTaskFailure(task, error, result = {}) {
    try {
      // Let retry manager decide what to do
      const retryDecision = await this.retryManager.processFailure(task, error, result);
      
      if (retryDecision.retry) {
        console.log(`Task ${task.id} will be retried (attempt ${retryDecision.attempt}) after ${retryDecision.delay}ms`);
      } else {
        console.log(`Task ${task.id} will not be retried (${retryDecision.reason})`);
        
        // Process the failure result
        await this.resultHandler.processResult({
          task,
          success: false,
          error,
          ...result
        });
      }
      
      // Update circuit breaker
      this.retryManager.updateCircuitBreaker(task.type, false);
      
    } catch (retryError) {
      console.error('Failed to handle task failure:', retryError);
    }
  }
  
  async getTaskById(taskId) {
    // This would typically query a database or cache
    // For this example, return a mock task
    return {
      id: taskId,
      type: 'unknown',
      // ... other task properties
    };
  }
  
  async createDeadLetterIssue(event) {
    // Example of creating a GitHub issue for dead letter tasks
    const issueBody = `
## Dead Letter Task

A task has failed permanently and requires manual intervention.

**Task ID:** ${event.taskId}
**Task Type:** ${event.taskType}
**Reason:** ${event.reason}
**Attempts:** ${event.attempts}

Please review the task in the dead letter queue and take appropriate action.

### Actions:
- [ ] Review error logs
- [ ] Fix underlying issue
- [ ] Retry task manually if appropriate
- [ ] Update retry configuration if needed
`;
    
    console.log('Would create GitHub issue:', issueBody);
    // Actual implementation would use GitHub API
  }
  
  // Public API methods
  
  async addTask(taskData) {
    return await this.queueManager.addTask(taskData);
  }
  
  async retryDeadLetter(deadLetterId) {
    const task = await this.retryManager.retryDeadLetter(deadLetterId);
    return await this.queueManager.addTask(task);
  }
  
  async getRetryStatistics() {
    return this.retryManager.getStatistics();
  }
  
  async generateRetryReport(period = 'daily') {
    return await this.retryManager.generateReport(period);
  }
  
  async shutdown() {
    console.log('Shutting down integrated task system');
    
    await this.queueManager.stop();
    await this.workerPool.shutdown();
    await this.resultHandler.shutdown();
    await this.retryManager.shutdown();
  }
}

// Example usage
async function main() {
  const system = new IntegratedTaskSystem({
    queue: {
      schedulingStrategy: 'weighted-round-robin',
      persistQueue: true
    },
    retry: config.retry,
    result: {
      notificationEnabled: true,
      githubRetryAttempts: 3
    },
    worker: {
      maxWorkers: 4,
      taskTimeout: 300000
    },
    createDeadLetterIssues: true
  });
  
  await system.initialize();
  
  // Add some example tasks
  const tasks = [
    {
      type: 'process-issue',
      projectId: 'test-project',
      issueNumber: 123,
      priority: 75
    },
    {
      type: 'claude-cli',
      projectId: 'test-project',
      command: 'test command',
      priority: 50
    }
  ];
  
  for (const task of tasks) {
    const taskId = await system.addTask(task);
    console.log(`Added task ${taskId}`);
  }
  
  // Monitor retry statistics
  setInterval(async () => {
    const stats = await system.getRetryStatistics();
    console.log('\nRetry Statistics:');
    console.log(`Active retries: ${stats.overview.activeRetries}`);
    console.log(`Dead letters: ${stats.overview.deadLetters}`);
    console.log('Circuit breakers:', stats.overview.circuitBreakers);
  }, 10000);
  
  // Generate daily report
  setTimeout(async () => {
    const report = await system.generateRetryReport('daily');
    console.log('\nDaily Retry Report:');
    console.log(JSON.stringify(report, null, 2));
  }, 60000);
  
  // Graceful shutdown on SIGINT
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down gracefully...');
    await system.shutdown();
    process.exit(0);
  });
}

// Run if executed directly
if (require.main === module) {
  main().catch(console.error);
}

module.exports = IntegratedTaskSystem;