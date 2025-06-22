const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');

describe('CCSP Communication Layer Unit Tests', () => {
  let helpers;
  let CCSPClient;
  let ccspClient;
  let mockRedis;
  let clock;

  before(() => {
    helpers = new TestHelpers();
  });

  beforeEach(() => {
    // Use fake timers
    clock = sinon.useFakeTimers();
    
    // Create mock Redis
    mockRedis = helpers.createMockRedis();
    
    // Mock the module
    CCSPClient = require('../../../src/ccsp-client-advanced');
    
    // Create instance
    ccspClient = new CCSPClient({
      redis: mockRedis,
      timeout: 30000,
      retryAttempts: 3
    });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe('Request Handling', () => {
    it('should send request to CCSP queue', async () => {
      const request = {
        prompt: 'Test prompt',
        context: { issueNumber: 123 }
      };

      const requestId = await ccspClient.sendRequest(request);
      
      expect(requestId).to.be.a('string');
      expect(requestId).to.match(/^req-/);
      
      // Check request was queued
      const queuedData = await mockRedis.rpop('ccsp:requests:pending');
      const parsed = JSON.parse(queuedData);
      expect(parsed.data.prompt).to.equal('Test prompt');
    });

    it('should handle priority requests', async () => {
      const highPriorityRequest = {
        prompt: 'Urgent task',
        priority: 9
      };

      const requestId = await ccspClient.sendRequest(highPriorityRequest);
      
      // Check it went to high priority queue
      const queuedData = await mockRedis.rpop('ccsp:requests:high');
      expect(queuedData).to.not.be.null;
    });

    it('should validate request format', async () => {
      const invalidRequest = {
        // Missing prompt
        context: {}
      };

      await expect(ccspClient.sendRequest(invalidRequest))
        .to.be.rejectedWith('Invalid request');
    });
  });

  describe('Response Handling', () => {
    it('should wait for response', async () => {
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);

      // Simulate CCSP processing and response
      setTimeout(async () => {
        await mockRedis.set(`ccsp:response:${requestId}`, JSON.stringify({
          success: true,
          result: 'Test completed'
        }));
      }, 100);

      const response = await ccspClient.waitForResponse(requestId);
      
      expect(response.success).to.be.true;
      expect(response.result).to.equal('Test completed');
    });

    it('should handle timeout', async () => {
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);

      // Don't send response, let it timeout
      const timeoutClient = new CCSPClient({
        redis: mockRedis,
        timeout: 1000 // 1 second timeout
      });

      await expect(timeoutClient.waitForResponse(requestId))
        .to.be.rejectedWith('timeout');
    });

    it('should handle error responses', async () => {
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);

      // Simulate error response
      await mockRedis.set(`ccsp:response:${requestId}`, JSON.stringify({
        success: false,
        error: 'Processing failed'
      }));

      const response = await ccspClient.waitForResponse(requestId);
      
      expect(response.success).to.be.false;
      expect(response.error).to.equal('Processing failed');
    });
  });

  describe('Retry Mechanism', () => {
    it('should retry on failure', async () => {
      let attemptCount = 0;
      
      // Mock send that fails first 2 times
      ccspClient._sendToQueue = async () => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Network error');
        }
        return 'req-123';
      };

      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);
      
      expect(requestId).to.equal('req-123');
      expect(attemptCount).to.equal(3);
    });

    it('should use exponential backoff', async () => {
      const delays = [];
      let lastTime = Date.now();
      
      ccspClient._sendToQueue = async () => {
        const now = Date.now();
        delays.push(now - lastTime);
        lastTime = now;
        throw new Error('Network error');
      };

      const request = { prompt: 'Test' };
      
      try {
        await ccspClient.sendRequest(request);
      } catch (e) {
        // Expected to fail after retries
      }

      // Check delays are increasing
      expect(delays[1]).to.be.greaterThan(delays[0]);
      expect(delays[2]).to.be.greaterThan(delays[1]);
    });

    it('should respect max retry attempts', async () => {
      let attemptCount = 0;
      
      ccspClient._sendToQueue = async () => {
        attemptCount++;
        throw new Error('Permanent failure');
      };

      const request = { prompt: 'Test' };
      
      await expect(ccspClient.sendRequest(request))
        .to.be.rejectedWith('Permanent failure');
      
      expect(attemptCount).to.equal(4); // Initial + 3 retries
    });
  });

  describe('Connection Management', () => {
    it('should check Redis connection', async () => {
      const isConnected = await ccspClient.isConnected();
      expect(isConnected).to.be.true;
    });

    it('should handle connection loss', async () => {
      // Simulate connection loss
      mockRedis.get = async () => {
        throw new Error('Connection refused');
      };

      const isConnected = await ccspClient.isConnected();
      expect(isConnected).to.be.false;
    });

    it('should reconnect automatically', async () => {
      let connectionAttempts = 0;
      
      // Fail first 2 attempts
      const originalGet = mockRedis.get;
      mockRedis.get = async (key) => {
        connectionAttempts++;
        if (connectionAttempts < 3) {
          throw new Error('Connection refused');
        }
        return originalGet.call(mockRedis, key);
      };

      // Should reconnect and succeed
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);
      
      expect(requestId).to.be.a('string');
      expect(connectionAttempts).to.be.at.least(3);
    });
  });

  describe('Batch Operations', () => {
    it('should support batch requests', async () => {
      const requests = [
        { prompt: 'Task 1' },
        { prompt: 'Task 2' },
        { prompt: 'Task 3' }
      ];

      const requestIds = await ccspClient.sendBatch(requests);
      
      expect(requestIds).to.have.lengthOf(3);
      requestIds.forEach(id => {
        expect(id).to.match(/^req-/);
      });
    });

    it('should wait for all batch responses', async () => {
      const requests = [
        { prompt: 'Task 1' },
        { prompt: 'Task 2' }
      ];

      const requestIds = await ccspClient.sendBatch(requests);

      // Simulate responses
      setTimeout(async () => {
        await mockRedis.set(`ccsp:response:${requestIds[0]}`, JSON.stringify({
          success: true,
          result: 'Result 1'
        }));
        await mockRedis.set(`ccsp:response:${requestIds[1]}`, JSON.stringify({
          success: true,
          result: 'Result 2'
        }));
      }, 100);

      const responses = await ccspClient.waitForBatchResponses(requestIds);
      
      expect(responses).to.have.lengthOf(2);
      expect(responses[0].result).to.equal('Result 1');
      expect(responses[1].result).to.equal('Result 2');
    });
  });

  describe('Error Recovery', () => {
    it('should handle rate limit errors', async () => {
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);

      // Simulate rate limit response
      await mockRedis.set(`ccsp:response:${requestId}`, JSON.stringify({
        success: false,
        error: 'Rate limit exceeded',
        rateLimited: true,
        retryAfter: 300000
      }));

      const response = await ccspClient.waitForResponse(requestId);
      
      expect(response.rateLimited).to.be.true;
      expect(response.retryAfter).to.equal(300000);
    });

    it('should handle session timeout errors', async () => {
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);

      // Simulate session timeout response
      await mockRedis.set(`ccsp:response:${requestId}`, JSON.stringify({
        success: false,
        error: 'Invalid API key',
        sessionTimeout: true
      }));

      const response = await ccspClient.waitForResponse(requestId);
      
      expect(response.sessionTimeout).to.be.true;
    });

    it('should clean up on timeout', async () => {
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);

      const timeoutClient = new CCSPClient({
        redis: mockRedis,
        timeout: 100
      });

      try {
        await timeoutClient.waitForResponse(requestId);
      } catch (e) {
        // Expected timeout
      }

      // Check request was cleaned up
      const pendingRequest = await mockRedis.get(`ccsp:request:${requestId}`);
      expect(pendingRequest).to.be.null;
    });
  });

  describe('Metrics and Monitoring', () => {
    it('should track request metrics', async () => {
      const request = { prompt: 'Test' };
      const requestId = await ccspClient.sendRequest(request);

      // Simulate response
      await mockRedis.set(`ccsp:response:${requestId}`, JSON.stringify({
        success: true,
        result: 'Done',
        processingTime: 1500
      }));

      await ccspClient.waitForResponse(requestId);
      
      const metrics = await ccspClient.getMetrics();
      
      expect(metrics.totalRequests).to.equal(1);
      expect(metrics.successfulRequests).to.equal(1);
      expect(metrics.averageProcessingTime).to.equal(1500);
    });

    it('should track error rates', async () => {
      // Send multiple requests with mixed results
      for (let i = 0; i < 10; i++) {
        const request = { prompt: `Test ${i}` };
        const requestId = await ccspClient.sendRequest(request);
        
        // 30% failure rate
        const success = i < 7;
        await mockRedis.set(`ccsp:response:${requestId}`, JSON.stringify({
          success,
          result: success ? 'Done' : undefined,
          error: success ? undefined : 'Failed'
        }));
        
        await ccspClient.waitForResponse(requestId);
      }

      const metrics = await ccspClient.getMetrics();
      
      expect(metrics.totalRequests).to.equal(10);
      expect(metrics.successfulRequests).to.equal(7);
      expect(metrics.failedRequests).to.equal(3);
      expect(metrics.errorRate).to.be.closeTo(0.3, 0.01);
    });
  });
});