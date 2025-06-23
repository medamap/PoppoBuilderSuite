/**
 * Tests for Daemon Lifecycle Manager
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { LifecycleManager, LifecycleStates, ComponentTypes } = require('../lib/daemon/lifecycle-manager');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

describe('LifecycleManager', () => {
  let lifecycleManager;
  let sandbox;
  let testStateFile;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    testStateFile = path.join(os.tmpdir(), 'test-lifecycle.state');
    
    lifecycleManager = new LifecycleManager({
      stateFile: testStateFile,
      healthCheckInterval: 100, // Short interval for tests
      componentTimeout: 1000,
      maxRecoveryAttempts: 2,
      recoveryDelay: 100
    });
  });

  afterEach(async () => {
    sandbox.restore();
    if (lifecycleManager.healthCheckTimer) {
      lifecycleManager.stopHealthMonitoring();
    }
    try {
      await fs.unlink(testStateFile);
    } catch (error) {
      // Ignore if file doesn't exist
    }
  });

  describe('State Transitions', () => {
    it('should start with stopped state', () => {
      expect(lifecycleManager.getState()).to.equal(LifecycleStates.STOPPED);
    });

    it('should transition through valid states', async () => {
      // Can transition from stopped to starting
      expect(lifecycleManager.canTransitionTo(LifecycleStates.STARTING)).to.be.true;
      await lifecycleManager.transitionTo(LifecycleStates.STARTING);
      expect(lifecycleManager.getState()).to.equal(LifecycleStates.STARTING);

      // Can transition from starting to running
      expect(lifecycleManager.canTransitionTo(LifecycleStates.RUNNING)).to.be.true;
      await lifecycleManager.transitionTo(LifecycleStates.RUNNING);
      expect(lifecycleManager.getState()).to.equal(LifecycleStates.RUNNING);

      // Can transition from running to stopping
      expect(lifecycleManager.canTransitionTo(LifecycleStates.STOPPING)).to.be.true;
      await lifecycleManager.transitionTo(LifecycleStates.STOPPING);
      expect(lifecycleManager.getState()).to.equal(LifecycleStates.STOPPING);
    });

    it('should reject invalid transitions', async () => {
      // Cannot go from stopped to running directly
      expect(lifecycleManager.canTransitionTo(LifecycleStates.RUNNING)).to.be.false;
      
      try {
        await lifecycleManager.transitionTo(LifecycleStates.RUNNING);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid state transition');
      }
    });

    it('should record state history', async () => {
      await lifecycleManager.transitionTo(LifecycleStates.STARTING);
      await lifecycleManager.transitionTo(LifecycleStates.RUNNING);
      
      const stats = lifecycleManager.getStatistics();
      expect(stats.stateHistory).to.have.lengthOf(2);
      expect(stats.stateHistory[0].from).to.equal(LifecycleStates.STOPPED);
      expect(stats.stateHistory[0].to).to.equal(LifecycleStates.STARTING);
    });
  });

  describe('Component Management', () => {
    let mockComponent;

    beforeEach(() => {
      mockComponent = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        reload: sinon.stub().resolves()
      };
    });

    it('should register components', () => {
      lifecycleManager.registerComponent(ComponentTypes.CONFIG, mockComponent);
      
      const status = lifecycleManager.getComponentStatus(ComponentTypes.CONFIG);
      expect(status.instance).to.equal(mockComponent);
      expect(status.status).to.equal('registered');
    });

    it('should start components in order', async () => {
      // Register all components
      for (const type of Object.values(ComponentTypes)) {
        lifecycleManager.registerComponent(type, mockComponent);
      }

      await lifecycleManager.start();

      // All components should be started
      const allStatus = lifecycleManager.getAllComponentsStatus();
      for (const type of Object.values(ComponentTypes)) {
        expect(allStatus[type].status).to.equal('running');
        expect(allStatus[type].health).to.equal('healthy');
      }

      expect(lifecycleManager.getState()).to.equal(LifecycleStates.RUNNING);
    });

    it('should stop components in reverse order', async () => {
      // Register and start all components
      for (const type of Object.values(ComponentTypes)) {
        lifecycleManager.registerComponent(type, mockComponent);
      }
      await lifecycleManager.start();

      // Stop
      await lifecycleManager.stop();

      // All components should be stopped
      const allStatus = lifecycleManager.getAllComponentsStatus();
      for (const type of Object.values(ComponentTypes)) {
        expect(allStatus[type].status).to.equal('stopped');
      }

      expect(lifecycleManager.getState()).to.equal(LifecycleStates.STOPPED);
    });

    it('should handle component start failure', async () => {
      const failingComponent = {
        start: sinon.stub().rejects(new Error('Start failed'))
      };

      lifecycleManager.registerComponent(ComponentTypes.CONFIG, failingComponent);

      try {
        await lifecycleManager.start();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Failed to start component');
        expect(lifecycleManager.getState()).to.equal(LifecycleStates.ERROR);
      }
    });
  });

  describe('Health Monitoring', () => {
    let mockComponent;
    let healthCheck;

    beforeEach(() => {
      mockComponent = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves()
      };
      
      healthCheck = sinon.stub();
    });

    it('should perform health checks', async () => {
      healthCheck.resolves({ healthy: true });
      
      lifecycleManager.registerComponent(ComponentTypes.CONFIG, mockComponent, healthCheck);
      await lifecycleManager.start();

      // Wait for health check
      await new Promise(resolve => setTimeout(resolve, 150));

      expect(healthCheck.called).to.be.true;
      
      const status = lifecycleManager.getComponentStatus(ComponentTypes.CONFIG);
      expect(status.health).to.equal('healthy');
      expect(status.lastHealthCheck).to.be.a('number');
    });

    it('should detect unhealthy components', async () => {
      healthCheck.resolves({ healthy: false, reason: 'Test failure' });
      
      const unhealthyEvent = new Promise(resolve => {
        lifecycleManager.once('component-unhealthy', resolve);
      });

      lifecycleManager.registerComponent(ComponentTypes.CONFIG, mockComponent, healthCheck);
      await lifecycleManager.start();

      const event = await unhealthyEvent;
      expect(event.type).to.equal(ComponentTypes.CONFIG);
      expect(event.component.health).to.equal('unhealthy');
    });

    it('should attempt recovery for unhealthy components', async () => {
      healthCheck.onFirstCall().resolves({ healthy: false });
      healthCheck.onSecondCall().resolves({ healthy: true });
      
      const recoveryAttempt = new Promise(resolve => {
        lifecycleManager.once('component-recovery-attempt', resolve);
      });

      lifecycleManager.registerComponent(ComponentTypes.CONFIG, mockComponent, healthCheck);
      await lifecycleManager.start();

      await recoveryAttempt;
      
      // Component should be restarted
      expect(mockComponent.stop.called).to.be.true;
      expect(mockComponent.start.calledTwice).to.be.true;
    });

    it('should limit recovery attempts', async () => {
      healthCheck.resolves({ healthy: false });
      mockComponent.start.onCall(1).rejects(new Error('Recovery failed'));
      mockComponent.start.onCall(2).rejects(new Error('Recovery failed'));
      
      const recoveryFailed = new Promise(resolve => {
        lifecycleManager.once('component-recovery-failed', resolve);
      });

      lifecycleManager.registerComponent(ComponentTypes.CONFIG, mockComponent, healthCheck);
      await lifecycleManager.start();

      const event = await recoveryFailed;
      expect(event.type).to.equal(ComponentTypes.CONFIG);
      expect(event.attempts).to.equal(2); // maxRecoveryAttempts
    });
  });

  describe('Configuration Reload', () => {
    let configComponent;
    let workerComponent;

    beforeEach(() => {
      configComponent = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        reload: sinon.stub().resolves()
      };
      
      workerComponent = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves()
        // No reload method
      };
    });

    it('should hot reload supported components', async () => {
      lifecycleManager.registerComponent(ComponentTypes.CONFIG, configComponent);
      lifecycleManager.registerComponent(ComponentTypes.WORKERS, workerComponent);
      
      await lifecycleManager.start();
      await lifecycleManager.reload();

      // Config should be reloaded
      expect(configComponent.reload.called).to.be.true;
      
      // Workers should be restarted (no reload method)
      expect(workerComponent.stop.called).to.be.true;
      expect(workerComponent.start.calledTwice).to.be.true;
      
      expect(lifecycleManager.getState()).to.equal(LifecycleStates.RUNNING);
    });

    it('should handle reload failure', async () => {
      configComponent.reload.rejects(new Error('Reload failed'));
      
      lifecycleManager.registerComponent(ComponentTypes.CONFIG, configComponent);
      await lifecycleManager.start();

      try {
        await lifecycleManager.reload();
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Failed to reload');
        // Should return to running state
        expect(lifecycleManager.getState()).to.equal(LifecycleStates.RUNNING);
      }
    });
  });

  describe('State Persistence', () => {
    it('should save and load state', async () => {
      await lifecycleManager.initialize();
      await lifecycleManager.transitionTo(LifecycleStates.STARTING);
      await lifecycleManager.transitionTo(LifecycleStates.RUNNING);

      // Create new instance and load state
      const newManager = new LifecycleManager({ stateFile: testStateFile });
      await newManager.initialize();

      expect(newManager.getState()).to.equal(LifecycleStates.STOPPED); // Reset from transitional state
      expect(newManager.previousState).to.equal(LifecycleStates.RUNNING);
    });
  });

  describe('Emergency Stop', () => {
    it('should stop all components immediately', async () => {
      const components = {};
      
      // Register multiple components
      for (const type of Object.values(ComponentTypes)) {
        components[type] = {
          start: sinon.stub().resolves(),
          stop: sinon.stub().resolves()
        };
        lifecycleManager.registerComponent(type, components[type]);
      }

      await lifecycleManager.start();
      
      // Emergency stop
      await lifecycleManager.emergencyStop();

      // All components should be stopped
      for (const component of Object.values(components)) {
        expect(component.stop.called).to.be.true;
      }
    });

    it('should continue even if component stop fails', async () => {
      const component1 = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().rejects(new Error('Stop failed'))
      };
      
      const component2 = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves()
      };

      lifecycleManager.registerComponent(ComponentTypes.CONFIG, component1);
      lifecycleManager.registerComponent(ComponentTypes.WORKERS, component2);
      
      await lifecycleManager.start();
      
      // Should not throw
      await lifecycleManager.emergencyStop();
      
      // Both components should have stop attempted
      expect(component1.stop.called).to.be.true;
      expect(component2.stop.called).to.be.true;
    });
  });

  describe('Statistics', () => {
    it('should provide comprehensive statistics', async () => {
      const component = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves()
      };
      
      lifecycleManager.registerComponent(ComponentTypes.CONFIG, component);
      await lifecycleManager.start();

      const stats = lifecycleManager.getStatistics();
      
      expect(stats.state).to.equal(LifecycleStates.RUNNING);
      expect(stats.components[ComponentTypes.CONFIG]).to.include({
        status: 'running',
        health: 'healthy'
      });
      expect(stats.healthyComponents).to.equal(1);
      expect(stats.totalComponents).to.equal(6); // All component types
    });
  });
});