const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');
const fs = require('fs').promises;
const path = require('path');

describe('CCSP Emergency Stop Unit Tests', () => {
  let helpers;
  let EmergencyStop;
  let sandbox;
  let emergencyStop;
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
    EmergencyStop = require('../../../agents/ccsp/emergency-stop');
    
    // Create instance
    emergencyStop = new EmergencyStop({
      redis: mockRedis,
      stopFilePath: '/tmp/test-ccsp-stop',
      checkInterval: 5000
    });
  });

  afterEach(async () => {
    clock.restore();
    sinon.restore();
    // Clean up stop file
    try {
      await fs.unlink('/tmp/test-ccsp-stop');
    } catch (e) {
      // Ignore if doesn't exist
    }
  });

  describe('Emergency Stop Trigger', () => {
    it('should trigger emergency stop via file', async () => {
      const handlerSpy = helpers.createSpy();
      emergencyStop.onEmergencyStop(handlerSpy);

      // Create stop file
      await fs.writeFile('/tmp/test-ccsp-stop', 'STOP');

      // Check for stop
      const shouldStop = await emergencyStop.checkStopSignal();
      
      expect(shouldStop).to.be.true;
      expect(handlerSpy.callCount()).to.equal(1);
    });

    it('should trigger emergency stop via Redis', async () => {
      const handlerSpy = helpers.createSpy();
      emergencyStop.onEmergencyStop(handlerSpy);

      // Set stop signal in Redis
      await mockRedis.set('ccsp:emergency:stop', '1');

      // Check for stop
      const shouldStop = await emergencyStop.checkStopSignal();
      
      expect(shouldStop).to.be.true;
      expect(handlerSpy.callCount()).to.equal(1);
    });

    it('should include stop reason', async () => {
      const handlerSpy = helpers.createSpy();
      emergencyStop.onEmergencyStop(handlerSpy);

      // Create stop file with reason
      await fs.writeFile('/tmp/test-ccsp-stop', 'STOP: Rate limit critical');

      await emergencyStop.checkStopSignal();
      
      expect(handlerSpy.calls[0].args[0]).to.equal('Rate limit critical');
    });
  });

  describe('Stop State Management', () => {
    it('should maintain stop state', async () => {
      await emergencyStop.activate('Test reason');
      
      expect(await emergencyStop.isActive()).to.be.true;
      expect(await emergencyStop.getStopReason()).to.equal('Test reason');
    });

    it('should clear stop state', async () => {
      await emergencyStop.activate('Test reason');
      await emergencyStop.deactivate();
      
      expect(await emergencyStop.isActive()).to.be.false;
      expect(await emergencyStop.getStopReason()).to.be.null;
    });

    it('should track stop duration', async () => {
      await emergencyStop.activate('Test reason');
      
      clock.tick(60000); // 1 minute
      
      const duration = await emergencyStop.getStopDuration();
      expect(duration).to.be.closeTo(60000, 1000);
    });
  });

  describe('Queue Integration', () => {
    let queueManagerMock;

    beforeEach(() => {
    sandbox = sinon.createSandbox();
      queueManagerMock = {
        pauseAllQueues: helpers.createSpy(),
        clearAllQueues: helpers.createSpy(),
        getQueueStats: helpers.createSpy()
      };
      queueManagerMock.getQueueStats.returnValue = {
        total: { waiting: 10, active: 2 }
      };
      
      emergencyStop.setQueueManager(queueManagerMock);
    });

    it('should pause all queues on activation', async () => {
      await emergencyStop.activate('Test');
      
      expect(queueManagerMock.pauseAllQueues.callCount()).to.equal(1);
    });

    it('should optionally clear queues', async () => {
      await emergencyStop.activate('Test', { clearQueues: true });
      
      expect(queueManagerMock.clearAllQueues.callCount()).to.equal(1);
    });

    it('should save queue state before clearing', async () => {
      await emergencyStop.activate('Test', { clearQueues: true });
      
      const savedState = await emergencyStop.getSavedQueueState();
      expect(savedState.stats.total.waiting).to.equal(10);
      expect(savedState.stats.total.active).to.equal(2);
    });
  });

  describe('Automatic Monitoring', () => {
    it('should start periodic monitoring', async () => {
      const checkSpy = sinon.spy(emergencyStop, 'checkStopSignal');
      
      await emergencyStop.startMonitoring();
      
      // Initial check
      expect(checkSpy.callCount).to.equal(1);
      
      // Advance time for next checks
      clock.tick(5000);
      expect(checkSpy.callCount).to.equal(2);
      
      clock.tick(5000);
      expect(checkSpy.callCount).to.equal(3);
    });

    it('should stop monitoring when activated', async () => {
      const checkSpy = sinon.spy(emergencyStop, 'checkStopSignal');
      
      await emergencyStop.startMonitoring();
      
      // Create stop file
      await fs.writeFile('/tmp/test-ccsp-stop', 'STOP');
      
      // Next check should activate stop
      clock.tick(5000);
      
      // Further time advances should not trigger more checks
      clock.tick(10000);
      
      // Should only have 2 checks (initial + one that found stop)
      expect(checkSpy.callCount).to.equal(2);
    });
  });

  describe('Recovery Process', () => {
    let queueManagerMock;

    beforeEach(() => {
    sandbox = sinon.createSandbox();
      queueManagerMock = {
        pauseAllQueues: helpers.createSpy(),
        resumeAllQueues: helpers.createSpy(),
        clearAllQueues: helpers.createSpy()
      };
      emergencyStop.setQueueManager(queueManagerMock);
    });

    it('should resume normal operations', async () => {
      await emergencyStop.activate('Test');
      await emergencyStop.resume();
      
      expect(await emergencyStop.isActive()).to.be.false;
      expect(queueManagerMock.resumeAllQueues.callCount()).to.equal(1);
    });

    it('should clean up stop signals', async () => {
      // Create stop file
      await fs.writeFile('/tmp/test-ccsp-stop', 'STOP');
      await mockRedis.set('ccsp:emergency:stop', '1');
      
      await emergencyStop.activate('Test');
      await emergencyStop.resume();
      
      // Check file removed
      await expect(fs.access('/tmp/test-ccsp-stop')).to.be.rejected;
      
      // Check Redis cleared
      const redisValue = await mockRedis.get('ccsp:emergency:stop');
      expect(redisValue).to.be.null;
    });

    it('should emit recovery event', async () => {
      const handlerSpy = helpers.createSpy();
      emergencyStop.onRecovery(handlerSpy);
      
      await emergencyStop.activate('Test');
      const stopDuration = 120000; // 2 minutes
      clock.tick(stopDuration);
      
      await emergencyStop.resume();
      
      expect(handlerSpy.callCount()).to.equal(1);
      expect(handlerSpy.calls[0].args[0]).to.have.property('duration');
      expect(handlerSpy.calls[0].args[0].duration).to.be.closeTo(stopDuration, 1000);
    });
  });

  describe('Statistics and Reporting', () => {
    it('should track emergency stop history', async () => {
      // First stop
      await emergencyStop.activate('Rate limit');
      clock.tick(60000);
      await emergencyStop.resume();
      
      // Second stop
      clock.tick(3600000); // 1 hour later
      await emergencyStop.activate('Manual intervention');
      clock.tick(120000);
      await emergencyStop.resume();
      
      const stats = await emergencyStop.getStats();
      expect(stats.totalStops).to.equal(2);
      expect(stats.averageStopDuration).to.be.closeTo(90000, 1000); // 1.5 minutes
    });

    it('should track stop reasons', async () => {
      await emergencyStop.activate('Rate limit');
      await emergencyStop.resume();
      
      await emergencyStop.activate('Rate limit');
      await emergencyStop.resume();
      
      await emergencyStop.activate('Session timeout');
      await emergencyStop.resume();
      
      const stats = await emergencyStop.getStats();
      expect(stats.stopReasons['Rate limit']).to.equal(2);
      expect(stats.stopReasons['Session timeout']).to.equal(1);
    });

    it('should generate stop report', async () => {
      await emergencyStop.activate('Test reason');
      clock.tick(30000);
      
      const report = await emergencyStop.generateStopReport();
      
      expect(report).to.have.property('reason', 'Test reason');
      expect(report).to.have.property('startTime');
      expect(report).to.have.property('duration');
      expect(report).to.have.property('queueState');
    });
  });

  describe('Safety Features', () => {
    it('should prevent duplicate activation', async () => {
      await emergencyStop.activate('First');
      
      // Try to activate again
      const result = await emergencyStop.activate('Second');
      
      expect(result).to.be.false;
      expect(await emergencyStop.getStopReason()).to.equal('First');
    });

    it('should handle concurrent stop signals gracefully', async () => {
      const promises = [];
      
      // Simulate multiple concurrent stop signals
      for (let i = 0; i < 5; i++) {
        promises.push(emergencyStop.activate(`Reason ${i}`));
      }
      
      const results = await Promise.all(promises);
      
      // Only first should succeed
      expect(results.filter(r => r === true)).to.have.lengthOf(1);
      expect(await emergencyStop.getStopReason()).to.match(/Reason \d/);
    });

    it('should validate stop file content', async () => {
      // Write invalid content
      await fs.writeFile('/tmp/test-ccsp-stop', 'invalid');
      
      const shouldStop = await emergencyStop.checkStopSignal();
      expect(shouldStop).to.be.false;
      
      // Write valid content
      await fs.writeFile('/tmp/test-ccsp-stop', 'STOP');
      
      const shouldStopNow = await emergencyStop.checkStopSignal();
      expect(shouldStopNow).to.be.true;
    });
  });
});