const { expect } = require('chai');
const RetryManager = require('../src/retry-manager');

describe('RetryManager', () => {
  let retryManager;

  beforeEach(() => {
    retryManager = new RetryManager({
      maxRetries: 3,
      baseDelay: 100,
      maxDelay: 5000,
      backoffFactor: 2
    });
  });

  describe('Error Type Detection', () => {
    it('should detect rate limit errors', () => {
      expect(retryManager.getErrorType(new Error('rate limit exceeded'))).to.equal('RATE_LIMIT');
      expect(retryManager.getErrorType(new Error('API Rate limit'))).to.equal('RATE_LIMIT');
    });

    it('should detect lock errors', () => {
      expect(retryManager.getErrorType(new Error('already being processed'))).to.equal('LOCK_ERROR');
      expect(retryManager.getErrorType(new Error('Failed to acquire lock'))).to.equal('LOCK_ERROR');
    });

    it('should detect network errors', () => {
      expect(retryManager.getErrorType(new Error('ENOTFOUND'))).to.equal('NETWORK_ERROR');
      expect(retryManager.getErrorType(new Error('ETIMEDOUT'))).to.equal('NETWORK_ERROR');
    });

    it('should detect auth errors', () => {
      expect(retryManager.getErrorType(new Error('401 Unauthorized'))).to.equal('AUTH_ERROR');
      expect(retryManager.getErrorType(new Error('authentication failed'))).to.equal('AUTH_ERROR');
    });

    it('should default to DEFAULT for unknown errors', () => {
      expect(retryManager.getErrorType(new Error('Some random error'))).to.equal('DEFAULT');
    });
  });

  describe('Retry Decision', () => {
    it('should allow retries for rate limit errors', () => {
      const error = new Error('rate limit exceeded');
      expect(retryManager.shouldRetry('task1', error)).to.be.true;
    });

    it('should not allow retries for lock errors', () => {
      const error = new Error('already being processed');
      expect(retryManager.shouldRetry('task2', error)).to.be.false;
    });

    it('should respect max retry limits', () => {
      const error = new Error('network error');
      const taskId = 'task3';
      
      // Simulate max retries
      for (let i = 0; i < 3; i++) {
        retryManager.recordAttempt(taskId, error);
      }
      
      expect(retryManager.shouldRetry(taskId, error)).to.be.false;
    });
  });

  describe('Retry Delay Calculation', () => {
    it('should calculate exponential backoff', () => {
      const error = new Error('network error');
      const taskId = 'task4';
      
      // First attempt
      const delay1 = retryManager.getRetryDelay(taskId, error);
      expect(delay1).to.be.at.least(100).and.at.most(110); // Base delay + jitter
      
      // Record attempt and get next delay
      retryManager.recordAttempt(taskId, error);
      const delay2 = retryManager.getRetryDelay(taskId, error);
      expect(delay2).to.be.at.least(200).and.at.most(220); // 100 * 2 + jitter
      
      // Third attempt
      retryManager.recordAttempt(taskId, error);
      const delay3 = retryManager.getRetryDelay(taskId, error);
      expect(delay3).to.be.at.least(400).and.at.most(440); // 100 * 4 + jitter
    });

    it('should respect max delay', () => {
      const error = new Error('network error');
      const taskId = 'task5';
      
      // Simulate many attempts
      for (let i = 0; i < 10; i++) {
        retryManager.recordAttempt(taskId, error);
      }
      
      const delay = retryManager.getRetryDelay(taskId, error);
      expect(delay).to.be.at.most(5500); // maxDelay + max jitter
    });
  });

  describe('Cleanup', () => {
    it('should clean up old retry info', () => {
      const error = new Error('test error');
      
      // Add some retry info
      retryManager.recordAttempt('old-task', error);
      retryManager.recordAttempt('new-task', error);
      
      // Manually set old timestamp for old-task
      const info = retryManager.retryInfo.get('old-task');
      info.lastAttemptAt = Date.now() - 7200000; // 2 hours ago
      
      // Run cleanup
      retryManager.cleanup(3600000); // 1 hour max age
      
      expect(retryManager.retryInfo.has('old-task')).to.be.false;
      expect(retryManager.retryInfo.has('new-task')).to.be.true;
    });
  });

  describe('Statistics', () => {
    it('should track retry statistics', () => {
      retryManager.recordAttempt('task1', new Error('rate limit'));
      retryManager.recordAttempt('task1', new Error('rate limit'));
      retryManager.recordAttempt('task2', new Error('network error'));
      
      const stats = retryManager.getStats();
      
      expect(stats.activeRetries).to.equal(2);
      expect(stats.totalAttempts).to.equal(3);
      expect(stats.byErrorType.RATE_LIMIT).to.equal(2);
      expect(stats.byErrorType.NETWORK_ERROR).to.equal(1);
    });
  });
});