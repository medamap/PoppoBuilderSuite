const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');

describe('CCSP Session Monitor Unit Tests', () => {
  let helpers;
  let SessionMonitor;
  let sandbox;
  let sessionMonitor;
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
    SessionMonitor = require('../../../agents/ccsp/session-monitor');
    
    // Create instance
    sessionMonitor = new SessionMonitor({
      redis: mockRedis,
      checkInterval: 300000, // 5 minutes
      githubToken: 'mock-token'
    });
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
  });

  describe('Session Timeout Detection', () => {
    it('should detect session timeout from error message', () => {
      const timeoutMessages = [
        'Error: Invalid API key. Please run /login to authenticate.',
        'API Login Failure',
        'Please run /login',
        'Authentication required',
        'Session expired'
      ];

      timeoutMessages.forEach(msg => {
        expect(sessionMonitor.isSessionTimeout(msg)).to.be.true;
      });
    });

    it('should not false positive on other errors', () => {
      const otherErrors = [
        'Error: Rate limit exceeded',
        'Network timeout',
        'Internal server error',
        'Invalid request'
      ];

      otherErrors.forEach(msg => {
        expect(sessionMonitor.isSessionTimeout(msg)).to.be.false;
      });
    });
  });

  describe('Session State Management', () => {
    it('should track session state', async () => {
      await sessionMonitor.setSessionValid(true);
      expect(await sessionMonitor.isSessionValid()).to.be.true;

      await sessionMonitor.setSessionValid(false);
      expect(await sessionMonitor.isSessionValid()).to.be.false;
    });

    it('should handle session timeout event', async () => {
      const handlerSpy = helpers.createSpy();
      sessionMonitor.onSessionTimeout(handlerSpy);

      await sessionMonitor.handleSessionTimeout();

      expect(handlerSpy.callCount()).to.equal(1);
      expect(await sessionMonitor.isSessionValid()).to.be.false;
    });

    it('should track last valid session time', async () => {
      const now = Date.now();
      await sessionMonitor.updateLastValidSession();

      const lastValid = await sessionMonitor.getLastValidSessionTime();
      expect(lastValid).to.be.closeTo(now, 1000);
    });
  });

  describe('GitHub Issue Creation', () => {
    let githubMock;

    beforeEach(() => {
      githubMock = {
        createIssue: helpers.createSpy(),
        updateIssue: helpers.createSpy(),
        findIssues: helpers.createSpy(),
        addComment: helpers.createSpy()
      };
      githubMock.createIssue.returnValue = { number: 123 };
      githubMock.findIssues.returnValue = [];
      
      sessionMonitor.setGitHubClient(githubMock);
    });

    it('should create GitHub issue on session timeout', async () => {
      await sessionMonitor.createSessionTimeoutIssue();

      expect(githubMock.createIssue.callCount()).to.equal(1);
      const call = githubMock.createIssue.calls[0];
      expect(call.args[0]).to.include({
        title: '🚨 CCSP Session Timeout - Manual Login Required'
      });
      expect(call.args[1]).to.include('urgent');
      expect(call.args[1]).to.include('session-timeout');
    });

    it('should reuse existing session timeout issue', async () => {
      // Mock existing issue
      githubMock.findIssues.returnValue = [{
        number: 100,
        state: 'open',
        labels: ['session-timeout']
      }];

      await sessionMonitor.createSessionTimeoutIssue();

      expect(githubMock.createIssue.callCount()).to.equal(0);
      expect(githubMock.addComment.callCount()).to.equal(1);
      expect(githubMock.addComment.calls[0].args[0]).to.equal(100);
    });

    it('should include blocked request count in issue', async () => {
      // Add some blocked requests
      await sessionMonitor.addBlockedRequest('req-1');
      await sessionMonitor.addBlockedRequest('req-2');
      await sessionMonitor.addBlockedRequest('req-3');

      await sessionMonitor.createSessionTimeoutIssue();

      const issueBody = githubMock.createIssue.calls[0].args[0].body;
      expect(issueBody).to.include('3 requests are currently blocked');
    });
  });

  describe('Blocked Request Management', () => {
    it('should track blocked requests', async () => {
      await sessionMonitor.addBlockedRequest('req-1');
      await sessionMonitor.addBlockedRequest('req-2');

      const blocked = await sessionMonitor.getBlockedRequests();
      expect(blocked).to.have.lengthOf(2);
      expect(blocked).to.include('req-1');
      expect(blocked).to.include('req-2');
    });

    it('should clear blocked requests on session recovery', async () => {
      await sessionMonitor.addBlockedRequest('req-1');
      await sessionMonitor.addBlockedRequest('req-2');

      await sessionMonitor.handleSessionRecovery();

      const blocked = await sessionMonitor.getBlockedRequests();
      expect(blocked).to.have.lengthOf(0);
    });

    it('should emit recovery event with blocked requests', async () => {
      const handlerSpy = helpers.createSpy();
      sessionMonitor.onSessionRecovery(handlerSpy);

      await sessionMonitor.addBlockedRequest('req-1');
      await sessionMonitor.addBlockedRequest('req-2');

      await sessionMonitor.handleSessionRecovery();

      expect(handlerSpy.callCount()).to.equal(1);
      expect(handlerSpy.calls[0].args[0]).to.deep.equal(['req-1', 'req-2']);
    });
  });

  describe('Automatic Monitoring', () => {
    let githubMock;

    beforeEach(() => {
      githubMock = {
        getIssue: helpers.createSpy(),
        findIssues: helpers.createSpy()
      };
      sessionMonitor.setGitHubClient(githubMock);
    });

    it('should start periodic monitoring', async () => {
      githubMock.findIssues.returnValue = [{
        number: 100,
        state: 'open'
      }];
      githubMock.getIssue.returnValue = {
        number: 100,
        state: 'open'
      };

      await sessionMonitor.startMonitoring();

      // Initial check
      expect(githubMock.findIssues.callCount()).to.equal(1);

      // Advance time for next check
      clock.tick(300000);
      
      // Should check issue status
      expect(githubMock.getIssue.callCount()).to.be.at.least(1);
    });

    it('should detect issue closure and verify session', async () => {
      const execMock = helpers.createSpy();
      execMock.returnValue = { stdout: 'Claude CLI v1.0.0' };
      sessionMonitor.setExecFunction(execMock);

      githubMock.findIssues.returnValue = [{
        number: 100,
        state: 'open'
      }];

      await sessionMonitor.startMonitoring();

      // Simulate issue being closed
      githubMock.getIssue.returnValue = {
        number: 100,
        state: 'closed'
      };

      clock.tick(300000);
      await helpers.waitFor(() => execMock.callCount() > 0);

      // Should verify session with claude --version
      expect(execMock.calledWith('claude --version')).to.be.true;
    });

    it('should handle session verification failure', async () => {
      const execMock = helpers.createSpy();
      execMock.returnValue = { 
        stderr: 'Error: Invalid API key',
        error: new Error('Command failed')
      };
      sessionMonitor.setExecFunction(execMock);

      githubMock.findIssues.returnValue = [{
        number: 100,
        state: 'closed'
      }];

      await sessionMonitor.checkSessionStatus();

      // Should not mark session as valid
      expect(await sessionMonitor.isSessionValid()).to.be.false;
    });
  });

  describe('Statistics and Reporting', () => {
    it('should track session timeout occurrences', async () => {
      await sessionMonitor.handleSessionTimeout();
      clock.tick(3600000); // 1 hour
      await sessionMonitor.handleSessionTimeout();

      const stats = await sessionMonitor.getStats();
      expect(stats.timeoutCount).to.equal(2);
    });

    it('should calculate average session duration', async () => {
      // Session valid for 2 hours
      await sessionMonitor.setSessionValid(true);
      clock.tick(7200000); // 2 hours
      await sessionMonitor.handleSessionTimeout();

      // Session valid for 3 hours
      await sessionMonitor.handleSessionRecovery();
      clock.tick(10800000); // 3 hours
      await sessionMonitor.handleSessionTimeout();

      const stats = await sessionMonitor.getStats();
      expect(stats.averageSessionDuration).to.be.closeTo(9000000, 1000000); // ~2.5 hours
    });

    it('should track blocked request statistics', async () => {
      await sessionMonitor.handleSessionTimeout();
      
      // Add blocked requests over time
      await sessionMonitor.addBlockedRequest('req-1');
      clock.tick(60000);
      await sessionMonitor.addBlockedRequest('req-2');
      clock.tick(60000);
      await sessionMonitor.addBlockedRequest('req-3');

      const stats = await sessionMonitor.getStats();
      expect(stats.totalBlockedRequests).to.equal(3);
      expect(stats.currentBlockedRequests).to.equal(3);
    });
  });

  describe('Integration with Queue Manager', () => {
    it('should pause queues on session timeout', async () => {
      const queueManagerMock = {
        pauseAllQueues: helpers.createSpy(),
        resumeAllQueues: helpers.createSpy(),
        getBlockedTasks: helpers.createSpy()
      };
      queueManagerMock.getBlockedTasks.returnValue = [];

      sessionMonitor.setQueueManager(queueManagerMock);
      await sessionMonitor.handleSessionTimeout();

      expect(queueManagerMock.pauseAllQueues.callCount()).to.equal(1);
    });

    it('should resume queues on session recovery', async () => {
      const queueManagerMock = {
        pauseAllQueues: helpers.createSpy(),
        resumeAllQueues: helpers.createSpy(),
        requeueTasks: helpers.createSpy()
      };

      sessionMonitor.setQueueManager(queueManagerMock);
      
      await sessionMonitor.addBlockedRequest('req-1');
      await sessionMonitor.handleSessionRecovery();

      expect(queueManagerMock.resumeAllQueues.callCount()).to.equal(1);
      expect(queueManagerMock.requeueTasks.callCount()).to.equal(1);
    });
  });
});