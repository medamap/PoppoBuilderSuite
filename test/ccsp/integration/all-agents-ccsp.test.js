const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');

describe('All Agents to CCSP Integration Tests', () => {
  let helpers;
  let mockRedis;
  let sandbox;
  let ccspAgent;
  let config;
  let agents = {};

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
        maxConcurrent: 5,
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
      agents: {
        ccla: { enabled: true },
        ccag: { enabled: true },
        ccpm: { enabled: true },
        ccqa: { enabled: true },
        ccra: { enabled: true }
      }
    };

    // Set up mock Claude CLI
    process.env.CLAUDE_CLI_PATH = helpers.mockClaudePath;

    // Start CCSP agent
    const CCSPAgent = require('../../../agents/ccsp/index');
    ccspAgent = new CCSPAgent(config);
    await ccspAgent.initialize();
    await ccspAgent.start();
  });

  afterEach(async () => {
    // Stop all agents
    for (const agent of Object.values(agents)) {
      if (agent && agent.stop) {
        await agent.stop();
      }
    }
    agents = {};

    if (ccspAgent) {
      await ccspAgent.stop();
    }

    await helpers.teardown();
    sinon.restore();
  });

  describe('CCLA (Error Log Analysis) Agent', () => {
    it('should analyze error logs through CCSP', async function() {
      this.timeout(10000);

      helpers.setMockScenario('error_analysis');

      // Mock CCLA agent behavior
      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Analyze this error: TypeError: Cannot read property "x" of undefined',
        context: {
          agent: 'ccla',
          errorType: 'TypeError',
          stackTrace: 'at Object.<anonymous> (test.js:10:5)'
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
      expect(result.result).to.include('missing dependency');
    });

    it('should create issues for critical errors', async function() {
      this.timeout(10000);

      helpers.setMockScenario('error_analysis');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const githubMock = {
        createIssue: sinon.stub().resolves({ number: 200 })
      };

      // Simulate CCLA detecting critical error
      const response = await client.sendRequest({
        prompt: 'Critical error detected: Database connection failed',
        context: {
          agent: 'ccla',
          severity: 'critical',
          action: 'create_issue'
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
    });
  });

  describe('CCAG (Documentation Generation) Agent', () => {
    it('should generate documentation through CCSP', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Generate API documentation for function getUserById(id)',
        context: {
          agent: 'ccag',
          type: 'api_docs',
          function: 'getUserById'
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
      expect(result.result).to.include('function');
    });

    it('should support multi-language documentation', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const languages = ['en', 'ja', 'es'];
      const responses = await Promise.all(
        languages.map(lang => 
          client.sendRequest({
            prompt: `Generate README in ${lang}`,
            context: {
              agent: 'ccag',
              type: 'readme',
              language: lang
            }
          })
        )
      );

      const results = await Promise.all(
        responses.map(id => client.waitForResponse(id))
      );

      results.forEach(result => {
        expect(result.success).to.be.true;
      });
    });
  });

  describe('CCPM (Code Review) Agent', () => {
    it('should perform code review through CCSP', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Review this code for potential improvements:\n```js\nfunction add(a,b) { return a+b }\n```',
        context: {
          agent: 'ccpm',
          type: 'code_review',
          file: 'math.js'
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
      expect(result.result).to.be.a('string');
    });

    it('should suggest refactoring', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Suggest refactoring for complex function with high cyclomatic complexity',
        context: {
          agent: 'ccpm',
          type: 'refactoring',
          complexity: 15
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
    });
  });

  describe('CCQA (Quality Assurance) Agent', () => {
    it('should run quality checks through CCSP', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Generate unit tests for the add function',
        context: {
          agent: 'ccqa',
          type: 'test_generation',
          function: 'add'
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
      expect(result.result).to.include('test');
    });

    it('should analyze test coverage', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Analyze test coverage and suggest improvements',
        context: {
          agent: 'ccqa',
          type: 'coverage_analysis',
          currentCoverage: 75
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
    });
  });

  describe('CCRA (Review Automation) Agent', () => {
    it('should review PRs through CCSP', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Review PR #456 with changes to authentication module',
        context: {
          agent: 'ccra',
          type: 'pr_review',
          prNumber: 456,
          files: ['auth.js', 'auth.test.js']
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
    });

    it('should provide security feedback', async function() {
      this.timeout(10000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'Check for security vulnerabilities in authentication code',
        context: {
          agent: 'ccra',
          type: 'security_review',
          critical: true
        }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.true;
    });
  });

  describe('Multi-Agent Collaboration', () => {
    it('should handle sequential agent tasks', async function() {
      this.timeout(20000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      // 1. CCPM reviews code
      const reviewResponse = await client.sendRequest({
        prompt: 'Review this function',
        context: { agent: 'ccpm', type: 'review' }
      });
      const reviewResult = await client.waitForResponse(reviewResponse);

      // 2. CCQA generates tests based on review
      const testResponse = await client.sendRequest({
        prompt: 'Generate tests based on review feedback',
        context: { 
          agent: 'ccqa', 
          type: 'test_generation',
          reviewFeedback: reviewResult.result
        }
      });
      const testResult = await client.waitForResponse(testResponse);

      // 3. CCAG documents the changes
      const docResponse = await client.sendRequest({
        prompt: 'Document the improvements',
        context: { 
          agent: 'ccag', 
          type: 'documentation',
          changes: [reviewResult.result, testResult.result]
        }
      });
      const docResult = await client.waitForResponse(docResponse);

      expect(reviewResult.success).to.be.true;
      expect(testResult.success).to.be.true;
      expect(docResult.success).to.be.true;
    });

    it('should handle parallel agent tasks', async function() {
      this.timeout(15000);

      helpers.setMockScenario('code_generation');

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      // Send multiple agent requests in parallel
      const requests = [
        client.sendRequest({
          prompt: 'Analyze error patterns',
          context: { agent: 'ccla', priority: 5 }
        }),
        client.sendRequest({
          prompt: 'Generate API docs',
          context: { agent: 'ccag', priority: 5 }
        }),
        client.sendRequest({
          prompt: 'Review code quality',
          context: { agent: 'ccpm', priority: 5 }
        }),
        client.sendRequest({
          prompt: 'Check test coverage',
          context: { agent: 'ccqa', priority: 5 }
        }),
        client.sendRequest({
          prompt: 'Review security',
          context: { agent: 'ccra', priority: 5 }
        })
      ];

      const requestIds = await Promise.all(requests);
      const results = await Promise.all(
        requestIds.map(id => client.waitForResponse(id))
      );

      // All should succeed
      results.forEach(result => {
        expect(result.success).to.be.true;
      });

      // Check concurrency was respected
      const stats = await helpers.getQueueStats('ccsp:queue:normal');
      expect(stats.completed).to.equal(5);
    });
  });

  describe('Error Scenarios', () => {
    it('should handle agent-specific errors', async function() {
      this.timeout(10000);

      helpers.enableError();

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      const response = await client.sendRequest({
        prompt: 'This will fail',
        context: { agent: 'ccla', forceError: true }
      });

      const result = await client.waitForResponse(response);

      expect(result.success).to.be.false;
      expect(result.error).to.exist;

      helpers.disableError();
    });

    it('should isolate agent failures', async function() {
      this.timeout(15000);

      const ccspClient = require('../../../src/ccsp-client-advanced');
      const client = new ccspClient(config.ccsp);

      // One agent fails, others should continue
      helpers.setMockScenario('code_generation');
      
      const requests = [
        client.sendRequest({
          prompt: 'This will succeed',
          context: { agent: 'ccag' }
        }),
        client.sendRequest({
          prompt: 'This will fail',
          context: { agent: 'ccla', forceError: true }
        }),
        client.sendRequest({
          prompt: 'This will also succeed',
          context: { agent: 'ccpm' }
        })
      ];

      // Temporarily enable error for one request
      setTimeout(() => {
        helpers.enableError();
        setTimeout(() => helpers.disableError(), 100);
      }, 50);

      const requestIds = await Promise.all(requests);
      const results = await Promise.all(
        requestIds.map(id => client.waitForResponse(id))
      );

      expect(results[0].success).to.be.true;
      expect(results[1].success).to.be.false;
      expect(results[2].success).to.be.true;
    });
  });
});