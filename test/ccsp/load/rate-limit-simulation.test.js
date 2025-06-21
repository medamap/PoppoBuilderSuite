const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');

describe('CCSP Rate Limit Simulation Tests', () => {
  let helpers;
  let mockRedis;
  let ccspAgent;
  let config;

  before(() => {
    helpers = new TestHelpers();
  });

  beforeEach(async () => {
    await helpers.setup();
    mockRedis = helpers.redis;
    
    config = {
      claude: {
        apiKey: 'test-key',
        maxConcurrent: 5,
        timeout: 30000
      },
      ccsp: {
        enabled: true,
        redis: {
          host: 'localhost',
          port: 6379,
          db: 15
        },
        rateLimiter: {
          maxRequests: 10,
          windowMs: 60000,
          blockDuration: 300000
        }
      }
    };

    process.env.CLAUDE_CLI_PATH = helpers.mockClaudePath;
  });

  afterEach(async () => {
    if (ccspAgent) {
      await ccspAgent.stop();
    }
    await helpers.teardown();
    sinon.restore();
  });

  describe('Rate Limit Detection', () => {
    it('should detect rate limit approaching', async function() {
      this.timeout(15000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      helpers.setMockScenario('issue_processing');

      // Track rate limit warnings
      const warnings = [];
      ccspAgent.on('rate-limit-warning', (data) => {
        warnings.push(data);
      });

      // Send requests close to limit
      const requests = [];
      for (let i = 0; i < 8; i++) {
        requests.push(client.sendRequest({
          prompt: `Task ${i}`,
          context: { issueNumber: i }
        }));
      }

      await Promise.all(requests);

      // Should have warnings about approaching limit
      expect(warnings.length).to.be.greaterThan(0);
      expect(warnings[0]).to.have.property('remaining');
      expect(warnings[0].remaining).to.be.lessThan(3);
    });

    it('should stop before hitting rate limit', async function() {
      this.timeout(20000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      helpers.setMockScenario('issue_processing');

      // Track when CCSP stops accepting requests
      let rateLimitReached = false;
      ccspAgent.on('rate-limit-reached', () => {
        rateLimitReached = true;
      });

      // Try to send more than limit
      const requests = [];
      for (let i = 0; i < 12; i++) {
        requests.push(
          client.sendRequest({
            prompt: `Task ${i}`,
            context: { issueNumber: i }
          }).catch(err => ({ error: err.message }))
        );
      }

      const results = await Promise.all(requests);

      // Should have stopped before actual API rate limit
      expect(rateLimitReached).to.be.true;
      
      // Some requests should be rejected
      const rejected = results.filter(r => r.error);
      expect(rejected.length).to.be.greaterThan(0);
    });

    it('should handle rate limit gracefully', async function() {
      this.timeout(15000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      // Simulate rate limit hit
      helpers.enableRateLimit();

      const response = await client.sendRequest({
        prompt: 'This will hit rate limit',
        context: { issueNumber: 999 }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.false;
      expect(result.rateLimited).to.be.true;
      expect(result.retryAfter).to.be.greaterThan(0);

      // Verify queues are paused
      const queueStats = await helpers.getQueueStats('ccsp:queue:normal');
      expect(ccspAgent.rateLimiter.isBlocked()).to.be.true;

      helpers.disableRateLimit();
    });
  });

  describe('Adaptive Rate Limiting', () => {
    it('should adjust request rate based on patterns', async function() {
      this.timeout(30000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent({
        ...config,
        ccsp: {
          ...config.ccsp,
          rateLimiter: {
            ...config.ccsp.rateLimiter,
            adaptive: true
          }
        }
      });
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      helpers.setMockScenario('issue_processing');

      // Track request timing
      const requestTimes = [];
      ccspAgent.on('request-processed', () => {
        requestTimes.push(Date.now());
      });

      // Send requests at steady rate
      for (let i = 0; i < 15; i++) {
        await client.sendRequest({
          prompt: `Task ${i}`,
          context: { issueNumber: i }
        });
        
        // Wait between requests
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // Calculate average interval
      const intervals = [];
      for (let i = 1; i < requestTimes.length; i++) {
        intervals.push(requestTimes[i] - requestTimes[i-1]);
      }

      const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;

      // Should maintain safe interval
      expect(avgInterval).to.be.greaterThan(1500);
    });

    it('should back off after rate limit warning', async function() {
      this.timeout(20000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      helpers.setMockScenario('issue_processing');

      // Send requests rapidly to trigger warning
      const rapidRequests = [];
      for (let i = 0; i < 7; i++) {
        rapidRequests.push(client.sendRequest({
          prompt: `Rapid task ${i}`,
          context: { issueNumber: i }
        }));
      }

      await Promise.all(rapidRequests);

      // Track subsequent request timing
      const afterWarningTimes = [];
      ccspAgent.on('request-processed', () => {
        afterWarningTimes.push(Date.now());
      });

      // Send more requests
      for (let i = 7; i < 10; i++) {
        await client.sendRequest({
          prompt: `Task ${i}`,
          context: { issueNumber: i }
        });
      }

      // Should have increased delay between requests
      if (afterWarningTimes.length >= 2) {
        const interval = afterWarningTimes[1] - afterWarningTimes[0];
        expect(interval).to.be.greaterThan(3000);
      }
    });
  });

  describe('Recovery from Rate Limit', () => {
    it('should resume after rate limit expires', async function() {
      this.timeout(30000);

      const clock = sinon.useFakeTimers();

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent({
        ...config,
        ccsp: {
          ...config.ccsp,
          rateLimiter: {
            ...config.ccsp.rateLimiter,
            blockDuration: 5000 // 5 seconds for testing
          }
        }
      });
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      // Hit rate limit
      helpers.enableRateLimit();
      await client.sendRequest({
        prompt: 'Hit rate limit',
        context: { issueNumber: 1 }
      });

      // Verify blocked
      expect(ccspAgent.rateLimiter.isBlocked()).to.be.true;

      // Advance time past block duration
      clock.tick(6000);
      helpers.disableRateLimit();

      // Should be able to send requests again
      helpers.setMockScenario('issue_processing');
      const response = await client.sendRequest({
        prompt: 'After recovery',
        context: { issueNumber: 2 }
      });

      const result = await client.waitForResponse(response);
      expect(result.success).to.be.true;

      clock.restore();
    });

    it('should process queued requests after recovery', async function() {
      this.timeout(20000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      helpers.setMockScenario('issue_processing');

      // Queue some requests
      const queuedRequests = [];
      for (let i = 0; i < 3; i++) {
        queuedRequests.push(client.sendRequest({
          prompt: `Queued task ${i}`,
          context: { issueNumber: i }
        }));
      }

      // Hit rate limit
      helpers.enableRateLimit();
      await client.sendRequest({
        prompt: 'Trigger rate limit',
        context: { issueNumber: 999 }
      });

      // Disable rate limit to simulate recovery
      setTimeout(() => {
        helpers.disableRateLimit();
        ccspAgent.rateLimiter.handleRecovery();
      }, 2000);

      // Wait for queued requests to complete
      const results = await Promise.all(
        queuedRequests.map(id => client.waitForResponse(id))
      );

      // All queued requests should eventually succeed
      results.forEach(result => {
        expect(result.success).to.be.true;
      });
    });
  });

  describe('Rate Limit Monitoring', () => {
    it('should track rate limit statistics', async function() {
      this.timeout(20000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      helpers.setMockScenario('issue_processing');

      // Send some requests
      for (let i = 0; i < 5; i++) {
        await client.sendRequest({
          prompt: `Task ${i}`,
          context: { issueNumber: i }
        });
      }

      // Get rate limit stats
      const stats = await ccspAgent.rateLimiter.getStats();

      expect(stats).to.have.property('totalRequests');
      expect(stats).to.have.property('windowRequests');
      expect(stats).to.have.property('remainingRequests');
      expect(stats.totalRequests).to.be.at.least(5);
      expect(stats.remainingRequests).to.be.lessThan(10);
    });

    it('should predict rate limit risk', async function() {
      this.timeout(15000);

      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      helpers.setMockScenario('issue_processing');

      // Send requests at increasing rate
      for (let i = 0; i < 6; i++) {
        await client.sendRequest({
          prompt: `Task ${i}`,
          context: { issueNumber: i }
        });
        
        // Decrease wait time
        await new Promise(resolve => setTimeout(resolve, 1000 - (i * 150)));
      }

      // Check prediction
      const prediction = await ccspAgent.rateLimiter.predictRateLimit();

      expect(prediction).to.have.property('willHitLimit');
      expect(prediction).to.have.property('timeToLimit');
      expect(prediction).to.have.property('recommendedDelay');
      
      if (prediction.willHitLimit) {
        expect(prediction.recommendedDelay).to.be.greaterThan(0);
      }
    });
  });
});