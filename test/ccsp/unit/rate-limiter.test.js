const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');

describe('CCSP Rate Limiter Unit Tests', () => {
  let helpers;
  let RateLimiter;
  let sandbox;
  let rateLimiter;
  let mockRedis;
  let clock;

  before(() => {
    helpers = new TestHelpers();
  });

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    // Use fake timers
    clock = sinon.useFakeTimers();
    
    // Create mock Redis
    mockRedis = helpers.createMockRedis();
    
    // Mock the module
    RateLimiter = require('../../../agents/ccsp/rate-limiter');
    
    // Create instance
    rateLimiter = new RateLimiter({
      redis: mockRedis,
      maxRequests: 10,
      windowMs: 60000, // 1 minute
      blockDuration: 300000 // 5 minutes
    });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe('Rate Limit Detection', () => {
    it('should detect rate limit from error message', () => {
      const errorMessages = [
        'Error: Rate limit exceeded. Please wait before making another request.',
        'Rate limit reached',
        'Too many requests',
        '429 Too Many Requests'
      ];

      errorMessages.forEach(msg => {
        expect(rateLimiter.isRateLimitError(msg)).to.be.true;
      });
    });

    it('should not false positive on other errors', () => {
      const errorMessages = [
        'Error: Network timeout',
        'Invalid API key',
        'Internal server error',
        'Connection refused'
      ];

      errorMessages.forEach(msg => {
        expect(rateLimiter.isRateLimitError(msg)).to.be.false;
      });
    });
  });

  describe('Request Tracking', () => {
    it('should track requests within window', async () => {
      // Make requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.recordRequest();
      }

      const count = await rateLimiter.getRequestCount();
      expect(count).to.equal(5);
    });

    it('should reset count after window expires', async () => {
      // Make requests
      for (let i = 0; i < 5; i++) {
        await rateLimiter.recordRequest();
      }

      // Advance time past window
      clock.tick(61000);

      // Make another request
      await rateLimiter.recordRequest();

      const count = await rateLimiter.getRequestCount();
      expect(count).to.equal(1);
    });

    it('should calculate remaining requests correctly', async () => {
      // Make some requests
      for (let i = 0; i < 7; i++) {
        await rateLimiter.recordRequest();
      }

      const remaining = await rateLimiter.getRemainingRequests();
      expect(remaining).to.equal(3);
    });
  });

  describe('Rate Limit Enforcement', () => {
    it('should allow requests under limit', async () => {
      for (let i = 0; i < 9; i++) {
        await rateLimiter.recordRequest();
      }

      const canProceed = await rateLimiter.checkLimit();
      expect(canProceed).to.be.true;
    });

    it('should block requests at limit', async () => {
      // Max out requests
      for (let i = 0; i < 10; i++) {
        await rateLimiter.recordRequest();
      }

      const canProceed = await rateLimiter.checkLimit();
      expect(canProceed).to.be.false;
    });

    it('should trigger rate limit handler', async () => {
      const handlerSpy = helpers.createSpy();
      rateLimiter.onRateLimit(handlerSpy);

      // Trigger rate limit
      await rateLimiter.handleRateLimit();

      expect(handlerSpy.callCount()).to.equal(1);
      expect(handlerSpy.calls[0].args[0]).to.have.property('blockedUntil');
      expect(handlerSpy.calls[0].args[0]).to.have.property('retryAfter');
    });
  });

  describe('Blocking and Recovery', () => {
    it('should block requests when rate limited', async () => {
      await rateLimiter.handleRateLimit();

      const isBlocked = await rateLimiter.isBlocked();
      expect(isBlocked).to.be.true;
    });

    it('should calculate correct retry time', async () => {
      await rateLimiter.handleRateLimit();

      const retryAfter = await rateLimiter.getRetryAfter();
      expect(retryAfter).to.be.closeTo(300000, 1000); // ~5 minutes
    });

    it('should unblock after duration expires', async () => {
      await rateLimiter.handleRateLimit();

      // Advance time past block duration
      clock.tick(301000);

      const isBlocked = await rateLimiter.isBlocked();
      expect(isBlocked).to.be.false;
    });

    it('should reset state on recovery', async () => {
      // Max out and block
      for (let i = 0; i < 10; i++) {
        await rateLimiter.recordRequest();
      }
      await rateLimiter.handleRateLimit();

      // Advance time past block
      clock.tick(301000);

      // Should be able to make requests again
      const canProceed = await rateLimiter.checkLimit();
      expect(canProceed).to.be.true;

      const count = await rateLimiter.getRequestCount();
      expect(count).to.equal(0);
    });
  });

  describe('Statistics and Monitoring', () => {
    it('should track rate limit occurrences', async () => {
      // Trigger rate limits
      await rateLimiter.handleRateLimit();
      clock.tick(301000);
      await rateLimiter.handleRateLimit();

      const stats = await rateLimiter.getStats();
      expect(stats.rateLimitCount).to.equal(2);
    });

    it('should track request patterns', async () => {
      // Make requests at different times
      await rateLimiter.recordRequest();
      clock.tick(10000);
      await rateLimiter.recordRequest();
      clock.tick(10000);
      await rateLimiter.recordRequest();

      const stats = await rateLimiter.getStats();
      expect(stats.totalRequests).to.equal(3);
      expect(stats.averageRequestInterval).to.be.closeTo(10000, 1000);
    });

    it('should provide rate limit predictions', async () => {
      // Make requests at steady rate
      for (let i = 0; i < 8; i++) {
        await rateLimiter.recordRequest();
        clock.tick(5000);
      }

      const prediction = await rateLimiter.predictRateLimit();
      expect(prediction.willHitLimit).to.be.true;
      expect(prediction.timeToLimit).to.be.lessThan(15000);
    });
  });

  describe('Adaptive Rate Limiting', () => {
    it('should adjust limits based on patterns', async () => {
      // Enable adaptive mode
      rateLimiter.enableAdaptiveMode();

      // Simulate hitting rate limits frequently
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 10; j++) {
          await rateLimiter.recordRequest();
        }
        await rateLimiter.handleRateLimit();
        clock.tick(301000);
      }

      // Should reduce effective limit
      const effectiveLimit = await rateLimiter.getEffectiveLimit();
      expect(effectiveLimit).to.be.lessThan(10);
    });

    it('should increase limits after stable period', async () => {
      rateLimiter.enableAdaptiveMode();

      // Make requests well under limit
      for (let i = 0; i < 20; i++) {
        await rateLimiter.recordRequest();
        clock.tick(10000); // Spread out requests
      }

      const effectiveLimit = await rateLimiter.getEffectiveLimit();
      expect(effectiveLimit).to.equal(10); // Should maintain original limit
    });
  });

  describe('Integration with Queue Manager', () => {
    it('should pause queue on rate limit', async () => {
      const queueManagerMock = {
        pauseAllQueues: helpers.createSpy(),
        resumeAllQueues: helpers.createSpy()
      };

      rateLimiter.setQueueManager(queueManagerMock);
      await rateLimiter.handleRateLimit();

      expect(queueManagerMock.pauseAllQueues.callCount()).to.equal(1);
    });

    it('should resume queue after recovery', async () => {
      const queueManagerMock = {
        pauseAllQueues: helpers.createSpy(),
        resumeAllQueues: helpers.createSpy()
      };

      rateLimiter.setQueueManager(queueManagerMock);
      await rateLimiter.handleRateLimit();

      // Advance time past block
      clock.tick(301000);
      await rateLimiter.checkLimit(); // This should trigger resume

      expect(queueManagerMock.resumeAllQueues.callCount()).to.equal(1);
    });
  });
});