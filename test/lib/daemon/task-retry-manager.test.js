/**
 * Task Retry Manager Test
 * Tests for the intelligent retry system
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const TaskRetryManager = require('../../../lib/daemon/task-retry-manager');

// Test configuration
const testConfig = {
  maxRetries: {
    default: 2,
    'rate-limit': 3,
    'network': 3,
    'timeout': 2,
    'validation': 0
  },
  backoff: {
    initial: 100,
    max: 5000,
    multiplier: 2,
    jitter: 0.1
  },
  deadLetterQueue: {
    enabled: true,
    path: path.join(os.tmpdir(), 'test-dead-letters'),
    retentionDays: 1
  },
  circuitBreaker: {
    enabled: true,
    threshold: 3,
    timeout: 1000,
    halfOpenRequests: 1
  },
  statePersistence: {
    enabled: true,
    path: path.join(os.tmpdir(), 'test-retry-state.json'),
    saveInterval: 1000
  }
};

// Helper to create test task
function createTestTask(overrides = {}) {
  return {
    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'test-task',
    projectId: 'test-project',
    priority: 50,
    ...overrides
  };
}

// Helper to create test errors
const testErrors = {
  rateLimit: new Error('Rate limit exceeded'),
  network: new Error('ECONNREFUSED: Connection refused'),
  timeout: new Error('Request timeout after 30000ms'),
  api: new Error('Internal Server Error (500)'),
  validation: new Error('Invalid input: missing required field'),
  auth: new Error('Unauthorized: Invalid API key')
};

describe('TaskRetryManager', () => {
  let retryManager;
  
  beforeEach(async () => {
    // Clean up test directories
    await fs.rm(testConfig.deadLetterQueue.path, { recursive: true, force: true });
    await fs.rm(testConfig.statePersistence.path, { force: true });
    
    // Create new instance
    retryManager = new TaskRetryManager(testConfig);
    await retryManager.initialize();
  });
  
  afterEach(async () => {
    await retryManager.shutdown();
  });
  
  describe('Error Classification', () => {
    it('should correctly classify rate limit errors', () => {
      assert.equal(retryManager.classifyError(testErrors.rateLimit), 'rate-limit');
      assert.equal(retryManager.classifyError(new Error('429 Too Many Requests')), 'rate-limit');
    });
    
    it('should correctly classify network errors', () => {
      assert.equal(retryManager.classifyError(testErrors.network), 'network');
      assert.equal(retryManager.classifyError(new Error('ETIMEDOUT')), 'network');
    });
    
    it('should correctly classify timeout errors', () => {
      assert.equal(retryManager.classifyError(testErrors.timeout), 'timeout');
    });
    
    it('should correctly classify API errors', () => {
      assert.equal(retryManager.classifyError(testErrors.api), 'api-error');
      assert.equal(retryManager.classifyError(new Error('503 Service Unavailable')), 'api-error');
    });
    
    it('should correctly classify validation errors', () => {
      assert.equal(retryManager.classifyError(testErrors.validation), 'validation');
    });
    
    it('should support custom error classifiers', () => {
      retryManager.registerErrorClassifier('custom-error', (error) => {
        return error.message.includes('CUSTOM');
      });
      
      assert.equal(retryManager.classifyError(new Error('CUSTOM: Special error')), 'custom-error');
    });
  });
  
  describe('Retry Decision Making', () => {
    it('should retry network errors', async () => {
      const task = createTestTask();
      const result = await retryManager.processFailure(task, testErrors.network);
      
      assert.equal(result.retry, true);
      assert.equal(result.attempt, 1);
      assert(result.delay > 0);
    });
    
    it('should not retry validation errors', async () => {
      const task = createTestTask();
      const result = await retryManager.processFailure(task, testErrors.validation);
      
      assert.equal(result.retry, false);
      assert.equal(result.reason, 'non-retryable-error');
    });
    
    it('should respect max retry limits', async () => {
      const task = createTestTask();
      
      // First two attempts should retry
      let result = await retryManager.processFailure(task, testErrors.timeout);
      assert.equal(result.retry, true);
      
      result = await retryManager.processFailure(task, testErrors.timeout);
      assert.equal(result.retry, true);
      
      // Third attempt should fail (max retries = 2 for timeout)
      result = await retryManager.processFailure(task, testErrors.timeout);
      assert.equal(result.retry, false);
      assert.equal(result.reason, 'max-retries-exceeded');
    });
    
    it('should respect task-specific retry limits', async () => {
      const task = createTestTask({ maxRetries: 1 });
      
      // First attempt should retry
      let result = await retryManager.processFailure(task, testErrors.network);
      assert.equal(result.retry, true);
      
      // Second attempt should fail (task limit = 1)
      result = await retryManager.processFailure(task, testErrors.network);
      assert.equal(result.retry, false);
      assert.equal(result.reason, 'task-retry-limit');
    });
    
    it('should respect task deadlines', async () => {
      const deadline = new Date(Date.now() + 1000); // 1 second from now
      const task = createTestTask({ deadline: deadline.toISOString() });
      
      // Set a large initial backoff
      retryManager.options.backoff.initial = 2000;
      
      const result = await retryManager.processFailure(task, testErrors.network);
      assert.equal(result.retry, false);
      assert.equal(result.reason, 'deadline-exceeded');
    });
  });
  
  describe('Backoff Strategies', () => {
    it('should use exponential backoff by default', async () => {
      const task = createTestTask();
      
      // First retry
      let result = await retryManager.processFailure(task, testErrors.network);
      const firstDelay = result.delay;
      assert(firstDelay >= 90 && firstDelay <= 110); // 100ms +/- jitter
      
      // Second retry
      result = await retryManager.processFailure(task, testErrors.network);
      const secondDelay = result.delay;
      assert(secondDelay >= 180 && secondDelay <= 220); // 200ms +/- jitter
    });
    
    it('should use fixed delay for rate limits', async () => {
      const task = createTestTask();
      
      // Multiple retries should have similar delays
      let result = await retryManager.processFailure(task, testErrors.rateLimit);
      const firstDelay = result.delay;
      
      result = await retryManager.processFailure(task, testErrors.rateLimit);
      const secondDelay = result.delay;
      
      // Both should be around initial delay
      assert(Math.abs(firstDelay - secondDelay) < 50);
    });
    
    it('should respect retry-after headers', async () => {
      const error = new Error('Rate limit exceeded');
      error.headers = { 'retry-after': '5' }; // 5 seconds
      
      const task = createTestTask();
      const result = await retryManager.processFailure(task, error);
      
      assert(result.delay >= 5000);
    });
    
    it('should apply maximum delay cap', async () => {
      const task = createTestTask();
      
      // Force many retries
      for (let i = 0; i < 10; i++) {
        const result = await retryManager.processFailure(task, testErrors.network);
        assert(result.delay <= testConfig.backoff.max);
      }
    });
  });
  
  describe('Circuit Breaker', () => {
    it('should open circuit after threshold failures', async () => {
      const taskType = 'circuit-test';
      
      // Create failures up to threshold
      for (let i = 0; i < testConfig.circuitBreaker.threshold; i++) {
        const task = createTestTask({ type: taskType });
        await retryManager.processFailure(task, testErrors.api);
        retryManager.updateCircuitBreaker(taskType, false);
      }
      
      // Next task should be blocked
      const task = createTestTask({ type: taskType });
      const result = await retryManager.processFailure(task, testErrors.api);
      
      assert.equal(result.retry, false);
      assert.equal(result.reason, 'circuit-breaker-open');
    });
    
    it('should move to half-open after timeout', async () => {
      const taskType = 'circuit-timeout-test';
      
      // Open the circuit
      for (let i = 0; i < testConfig.circuitBreaker.threshold; i++) {
        retryManager.updateCircuitBreaker(taskType, false);
      }
      
      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, testConfig.circuitBreaker.timeout + 100));
      
      // Should allow one request through
      const task = createTestTask({ type: taskType });
      const result = await retryManager.processFailure(task, testErrors.api);
      assert(result.retry !== false || result.reason !== 'circuit-breaker-open');
    });
    
    it('should close circuit on success in half-open state', async () => {
      const taskType = 'circuit-recovery-test';
      const breaker = {
        state: 'half-open',
        failures: 0,
        halfOpenAttempts: 0
      };
      retryManager.circuitBreakers.set(taskType, breaker);
      
      // Success should close the circuit
      retryManager.updateCircuitBreaker(taskType, true);
      
      assert.equal(retryManager.circuitBreakers.get(taskType).state, 'closed');
    });
  });
  
  describe('Dead Letter Queue', () => {
    it('should send non-retryable tasks to dead letter queue', async () => {
      const task = createTestTask();
      
      await retryManager.processFailure(task, testErrors.validation);
      
      assert.equal(retryManager.deadLetterQueue.length, 1);
      assert.equal(retryManager.deadLetterQueue[0].reason, 'non-retryable-error');
    });
    
    it('should persist dead letters to disk', async () => {
      const task = createTestTask();
      
      await retryManager.processFailure(task, testErrors.validation);
      
      const files = await fs.readdir(testConfig.deadLetterQueue.path);
      assert.equal(files.length, 1);
      assert(files[0].endsWith('.json'));
    });
    
    it('should allow manual retry of dead letter tasks', async () => {
      const task = createTestTask();
      
      // Send to dead letter
      await retryManager.processFailure(task, testErrors.validation);
      const deadLetterId = retryManager.deadLetterQueue[0].id;
      
      // Manually retry
      const retriedTask = await retryManager.retryDeadLetter(deadLetterId);
      
      assert.equal(retriedTask.id, task.id);
      assert.equal(retryManager.deadLetterQueue.length, 0);
    });
  });
  
  describe('State Persistence', () => {
    it('should save and restore retry state', async () => {
      const task = createTestTask();
      
      // Create some retry state
      await retryManager.processFailure(task, testErrors.network);
      
      // Save state
      await retryManager.saveRetryState();
      
      // Create new instance and load state
      const newRetryManager = new TaskRetryManager(testConfig);
      await newRetryManager.initialize();
      
      // Should have restored the retry state
      const state = newRetryManager.getRetryState(task.id);
      assert(state);
      assert.equal(state.attempts, 1);
      
      await newRetryManager.shutdown();
    });
  });
  
  describe('Metrics and Monitoring', () => {
    it('should track retry statistics', async () => {
      const task1 = createTestTask({ type: 'metrics-test' });
      const task2 = createTestTask({ type: 'metrics-test' });
      
      // Create some failures
      await retryManager.processFailure(task1, testErrors.network);
      await retryManager.processFailure(task2, testErrors.rateLimit);
      
      const stats = retryManager.getStatistics();
      
      assert.equal(stats.overview.activeRetries, 2);
      assert(stats.byTaskType['metrics-test']);
      assert.equal(stats.byTaskType['metrics-test'].totalFailures, 2);
      assert.equal(stats.byTaskType['metrics-test'].retries, 2);
    });
    
    it('should generate retry reports', async () => {
      // Create some test data
      const tasks = [
        createTestTask({ type: 'report-test-1' }),
        createTestTask({ type: 'report-test-2' })
      ];
      
      for (const task of tasks) {
        await retryManager.processFailure(task, testErrors.network);
      }
      
      const report = await retryManager.generateReport();
      
      assert(report.overview);
      assert(report.performance);
      assert(report.recommendations);
      assert.equal(report.overview.activeRetries, 2);
    });
    
    it('should emit alerts for excessive failures', (done) => {
      retryManager.once('retry-alert', (alert) => {
        assert.equal(alert.type, 'retry-storm');
        done();
      });
      
      // Create many failures quickly
      const promises = [];
      for (let i = 0; i < 25; i++) {
        const task = createTestTask({ type: 'storm-test' });
        promises.push(retryManager.processFailure(task, testErrors.network));
      }
      
      Promise.all(promises).catch(done);
    });
  });
  
  describe('Integration', () => {
    it('should handle successful task completion', async () => {
      const task = createTestTask();
      
      // Create retry state
      await retryManager.processFailure(task, testErrors.network);
      assert(retryManager.getRetryState(task.id));
      
      // Process success
      await retryManager.processSuccess(task);
      
      // Retry state should be cleared
      assert(!retryManager.getRetryState(task.id));
    });
    
    it('should emit appropriate events', (done) => {
      const task = createTestTask();
      let eventCount = 0;
      
      retryManager.on('task-retry-scheduled', (event) => {
        assert.equal(event.taskId, task.id);
        assert(event.delay > 0);
        eventCount++;
      });
      
      retryManager.on('dead-letter-created', (event) => {
        assert.equal(event.taskId, task.id);
        eventCount++;
        
        if (eventCount === 2) done();
      });
      
      // Trigger retry
      retryManager.processFailure(task, testErrors.network)
        .then(() => {
          // Trigger dead letter
          return retryManager.processFailure(task, testErrors.validation);
        })
        .catch(done);
    });
  });
});

// Run tests if this file is executed directly
if (require.main === module) {
  const { spawn } = require('child_process');
  const mocha = spawn('mocha', [__filename, '--timeout', '10000'], {
    stdio: 'inherit'
  });
  
  mocha.on('exit', (code) => {
    process.exit(code);
  });
}