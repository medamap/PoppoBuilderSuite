const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');
const path = require('path');

describe('PoppoBuilder to CCSP Integration Tests', () => {
  let helpers;
  let mockRedis;
  let poppoBuilder;
  let ccspAgent;
  let config;

  before(() => {
    helpers = new TestHelpers();
  });

  beforeEach(async () => {
    await helpers.setup();
    mockRedis = helpers.redis;
    
    // Mock configuration
    config = {
      claude: {
        apiKey: 'test-key',
        maxConcurrent: 3,
        timeout: 30000
      },
      ccsp: {
        enabled: true,
        redis: {
          host: 'localhost',
          port: 6379,
          db: 15
        }
      },
      github: {
        token: 'test-token',
        owner: 'test-owner',
        repo: 'test-repo'
      }
    };

    // Set up mock Claude CLI
    process.env.CLAUDE_CLI_PATH = helpers.mockClaudePath;
  });

  afterEach(async () => {
    await helpers.teardown();
    sinon.restore();
  });

  describe('Issue Processing Flow', () => {
    it('should process issue through CCSP', async function() {
      this.timeout(10000);

      // Mock GitHub API
      const githubMock = {
        getIssue: sinon.stub().resolves({
          number: 123,
          title: 'Test Issue',
          body: 'Please implement a hello world function',
          labels: ['task:misc']
        }),
        addComment: sinon.stub().resolves(),
        addLabels: sinon.stub().resolves(),
        removeLabels: sinon.stub().resolves()
      };

      // Set up test scenario
      helpers.setMockScenario('code_generation');

      // Create PoppoBuilder instance with mocked dependencies
      const PoppoBuilder = require('../../../src/minimal-poppo');
      
      // Mock the GitHub client
      const originalGitHub = require('../../../src/github-client');
      sinon.stub(originalGitHub.prototype, 'getIssue').callsFake(githubMock.getIssue);
      sinon.stub(originalGitHub.prototype, 'addComment').callsFake(githubMock.addComment);
      sinon.stub(originalGitHub.prototype, 'addLabels').callsFake(githubMock.addLabels);
      sinon.stub(originalGitHub.prototype, 'removeLabels').callsFake(githubMock.removeLabels);

      // Start CCSP agent
      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      // Process issue through PoppoBuilder
      const processIssue = async () => {
        // Simulate PoppoBuilder detecting and processing an issue
        const ccspClient = require('../../../src/ccsp-client-advanced');
        const client = new ccspClient(config.ccsp);
        
        const request = {
          prompt: 'Please implement a hello world function',
          context: {
            issueNumber: 123,
            repository: 'test-owner/test-repo'
          }
        };

        const requestId = await client.sendRequest(request);
        const response = await client.waitForResponse(requestId);
        
        return response;
      };

      const response = await processIssue();

      // Verify the flow
      expect(response.success).to.be.true;
      expect(response.result).to.include('function hello()');
      
      // Verify GitHub interactions
      expect(githubMock.getIssue.calledWith(123)).to.be.true;
      
      // Wait a bit for async operations
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should handle multiple concurrent issues', async function() {
      this.timeout(10000);

      helpers.setMockScenario('issue_processing');

      // Start CCSP agent
      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      // Send multiple requests
      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const requests = [];
      for (let i = 1; i <= 5; i++) {
        requests.push(client.sendRequest({
          prompt: `Process issue ${i}`,
          context: { issueNumber: i }
        }));
      }

      const requestIds = await Promise.all(requests);
      
      // Wait for all responses
      const responses = await Promise.all(
        requestIds.map(id => client.waitForResponse(id))
      );

      // All should succeed
      responses.forEach((response, index) => {
        expect(response.success).to.be.true;
        expect(response.result).to.include(`Issue #${index + 1}`);
      });
    });

    it('should respect priority ordering', async function() {
      this.timeout(10000);

      helpers.setMockScenario('issue_processing');

      // Start CCSP agent
      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      // Track processing order
      const processingOrder = [];
      ccspAgent.on('task-processed', (task) => {
        processingOrder.push(task.data.context.issueNumber);
      });

      // Send requests with different priorities
      await client.sendRequest({
        prompt: 'Low priority task',
        priority: 2,
        context: { issueNumber: 1 }
      });

      await client.sendRequest({
        prompt: 'High priority task',
        priority: 9,
        context: { issueNumber: 2 }
      });

      await client.sendRequest({
        prompt: 'Normal priority task',
        priority: 5,
        context: { issueNumber: 3 }
      });

      // Wait for processing
      await helpers.waitFor(() => processingOrder.length === 3);

      // Should process in priority order: 2 (high), 3 (normal), 1 (low)
      expect(processingOrder).to.deep.equal([2, 3, 1]);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();
    });

    it('should handle rate limit errors gracefully', async function() {
      this.timeout(10000);

      helpers.enableRateLimit();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Test task',
        context: { issueNumber: 123 }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.false;
      expect(result.rateLimited).to.be.true;
      expect(result.error).to.include('Rate limit');

      helpers.disableRateLimit();
    });

    it('should handle session timeout errors', async function() {
      this.timeout(10000);

      helpers.enableSessionTimeout();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Test task',
        context: { issueNumber: 123 }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.false;
      expect(result.sessionTimeout).to.be.true;
      expect(result.error).to.include('Invalid API key');

      helpers.disableSessionTimeout();
    });

    it('should retry on temporary failures', async function() {
      this.timeout(10000);

      let attemptCount = 0;
      
      // Override mock to fail first time
      const originalExec = require('child_process').exec;
      sinon.stub(require('child_process'), 'exec').callsFake((cmd, callback) => {
        attemptCount++;
        if (attemptCount === 1) {
          callback(new Error('Temporary failure'));
        } else {
          originalExec(cmd, callback);
        }
      });

      helpers.setMockScenario('issue_processing');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Test task',
        context: { issueNumber: 123 }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
      expect(attemptCount).to.be.at.least(2);
    });
  });

  describe('Comment Processing', () => {
    beforeEach(async () => {
      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();
    });

    it('should process issue comments', async function() {
      this.timeout(10000);

      helpers.setMockScenario('issue_processing');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Please add error handling to the function',
        context: {
          issueNumber: 123,
          commentId: 456,
          isComment: true
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
      expect(result.result).to.include('processed');
    });

    it('should handle command comments', async function() {
      this.timeout(10000);

      helpers.setMockScenario('issue_processing');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: '/retry',
        context: {
          issueNumber: 123,
          commentId: 789,
          isCommand: true
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
    });
  });

  describe('Performance and Load', () => {
    beforeEach(async () => {
      const CCSPAgent = require('../../../agents/ccsp/index');
      ccspAgent = new CCSPAgent(config);
      await ccspAgent.initialize();
      await ccspAgent.start();
    });

    it('should handle burst of requests', async function() {
      this.timeout(30000);

      helpers.setMockScenario('issue_processing');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const startTime = Date.now();
      const requests = [];

      // Send 20 requests rapidly
      for (let i = 0; i < 20; i++) {
        requests.push(client.sendRequest({
          prompt: `Task ${i}`,
          context: { issueNumber: i }
        }));
      }

      const requestIds = await Promise.all(requests);
      const responses = await Promise.all(
        requestIds.map(id => client.waitForResponse(id))
      );

      const endTime = Date.now();
      const duration = endTime - startTime;

      // All should complete
      expect(responses.filter(r => r.success).length).to.equal(20);
      
      // Should complete in reasonable time
      expect(duration).to.be.lessThan(10000);
    });

    it('should maintain queue statistics', async function() {
      this.timeout(10000);

      helpers.setMockScenario('issue_processing');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      // Send some requests
      for (let i = 0; i < 5; i++) {
        await client.sendRequest({
          prompt: `Task ${i}`,
          context: { issueNumber: i }
        });
      }

      // Get queue stats
      const stats = await helpers.getQueueStats('ccsp:queue:normal');
      
      expect(stats.waiting + stats.active + stats.completed).to.be.at.least(5);
    });
  });
});