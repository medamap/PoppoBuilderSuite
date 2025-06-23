const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const sinon = require('sinon');
const EventEmitter = require('events');
const LifecycleManager = require('../lib/daemon/lifecycle-manager');

describe('Daemon Lifecycle Manager', function() {
  let lifecycleManager;
  let clock;
  
  beforeEach(function() {
    lifecycleManager = new LifecycleManager();
    clock = sinon.useFakeTimers();
  });
  
  afterEach(function() {
    clock.restore();
  });
  
  describe('State Management', function() {
    it('should start in STOPPED state', function() {
      expect(lifecycleManager.getState()).to.equal(LifecycleManager.States.STOPPED);
    });
    
    it('should validate state transitions', async function() {
      // Valid transition: STOPPED -> STARTING
      const result1 = await lifecycleManager.transitionTo(LifecycleManager.States.STARTING);
      expect(result1).to.be.true;
      expect(lifecycleManager.getState()).to.equal(LifecycleManager.States.STARTING);
      
      // Invalid transition: STARTING -> STOPPED
      const result2 = await lifecycleManager.transitionTo(LifecycleManager.States.STOPPED);
      expect(result2).to.be.false;
      expect(lifecycleManager.getState()).to.equal(LifecycleManager.States.STARTING);
    });
    
    it('should emit state change events', function(done) {
      lifecycleManager.on('state-changed', (oldState, newState) => {
        expect(oldState).to.equal(LifecycleManager.States.STOPPED);
        expect(newState).to.equal(LifecycleManager.States.STARTING);
        done();
      });
      
      lifecycleManager.transitionTo(LifecycleManager.States.STARTING);
    });
    
    it('should track state history', async function() {
      await lifecycleManager.transitionTo(LifecycleManager.States.STARTING);
      await lifecycleManager.transitionTo(LifecycleManager.States.RUNNING);
      
      const stats = lifecycleManager.getStatistics();
      expect(stats.stateHistory).to.have.lengthOf(3); // Including initial STOPPED
      expect(stats.stateHistory[2].state).to.equal(LifecycleManager.States.RUNNING);
    });
  });
  
  describe('Component Management', function() {
    let mockComponent;
    
    beforeEach(function() {
      mockComponent = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        reload: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true)
      };
    });
    
    it('should register components', function() {
      lifecycleManager.registerComponent('test', mockComponent, {
        critical: true,
        startupOrder: 1
      });
      
      const components = lifecycleManager.getComponents();
      expect(components).to.have.property('test');
      expect(components.test.critical).to.be.true;
    });
    
    it('should start components in order', async function() {
      const component1 = {
        start: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true)
      };
      const component2 = {
        start: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true)
      };
      
      lifecycleManager.registerComponent('comp1', component1, { startupOrder: 2 });
      lifecycleManager.registerComponent('comp2', component2, { startupOrder: 1 });
      
      await lifecycleManager.start();
      
      expect(component2.start.calledBefore(component1.start)).to.be.true;
    });
    
    it('should stop components in reverse order', async function() {
      const component1 = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true)
      };
      const component2 = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true)
      };
      
      lifecycleManager.registerComponent('comp1', component1, { startupOrder: 1 });
      lifecycleManager.registerComponent('comp2', component2, { startupOrder: 2 });
      
      await lifecycleManager.start();
      await lifecycleManager.stop();
      
      expect(component2.stop.calledBefore(component1.stop)).to.be.true;
    });
    
    it('should handle component startup failure', async function() {
      const failingComponent = {
        start: sinon.stub().rejects(new Error('Startup failed')),
        stop: sinon.stub().resolves()
      };
      
      lifecycleManager.registerComponent('failing', failingComponent, { critical: true });
      
      try {
        await lifecycleManager.start();
        throw new Error('Should have failed');
      } catch (error) {
        expect(error.message).to.include('Failed to start component');
        expect(lifecycleManager.getState()).to.equal(LifecycleManager.States.ERROR);
      }
    });
  });
  
  describe('Health Monitoring', function() {
    let healthyComponent, unhealthyComponent;
    
    beforeEach(function() {
      healthyComponent = {
        healthCheck: sinon.stub().resolves(true)
      };
      
      unhealthyComponent = {
        healthCheck: sinon.stub().resolves(false)
      };
    });
    
    it('should perform health checks', async function() {
      lifecycleManager.registerComponent('healthy', healthyComponent);
      lifecycleManager.registerComponent('unhealthy', unhealthyComponent);
      
      lifecycleManager.state = LifecycleManager.States.RUNNING;
      lifecycleManager.startHealthMonitoring();
      
      // Advance time to trigger health check
      clock.tick(lifecycleManager.options.healthCheckInterval);
      await Promise.resolve(); // Let async operations complete
      
      expect(healthyComponent.healthCheck.called).to.be.true;
      expect(unhealthyComponent.healthCheck.called).to.be.true;
    });
    
    it('should emit health events', function(done) {
      lifecycleManager.registerComponent('unhealthy', unhealthyComponent);
      
      lifecycleManager.on('component-unhealthy', (name) => {
        expect(name).to.equal('unhealthy');
        done();
      });
      
      lifecycleManager.state = LifecycleManager.States.RUNNING;
      lifecycleManager.startHealthMonitoring();
      clock.tick(lifecycleManager.options.healthCheckInterval);
    });
    
    it('should attempt recovery for unhealthy components', async function() {
      const recoverableComponent = {
        healthCheck: sinon.stub().resolves(false),
        stop: sinon.stub().resolves(),
        start: sinon.stub().resolves()
      };
      
      lifecycleManager.registerComponent('recoverable', recoverableComponent, {
        autoRecover: true
      });
      
      lifecycleManager.state = LifecycleManager.States.RUNNING;
      
      // Trigger recovery
      await lifecycleManager.recoverComponent('recoverable');
      
      expect(recoverableComponent.stop.called).to.be.true;
      expect(recoverableComponent.start.called).to.be.true;
    });
  });
  
  describe('Graceful Operations', function() {
    it('should reload components that support it', async function() {
      const reloadableComponent = {
        start: sinon.stub().resolves(),
        reload: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true),
        supportsReload: true
      };
      
      lifecycleManager.registerComponent('reloadable', reloadableComponent);
      
      await lifecycleManager.start();
      await lifecycleManager.reload();
      
      expect(reloadableComponent.reload.called).to.be.true;
    });
    
    it('should restart components that do not support reload', async function() {
      const nonReloadableComponent = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true),
        supportsReload: false
      };
      
      lifecycleManager.registerComponent('non-reloadable', nonReloadableComponent);
      
      await lifecycleManager.start();
      await lifecycleManager.reload();
      
      expect(nonReloadableComponent.stop.called).to.be.true;
      expect(nonReloadableComponent.start.calledTwice).to.be.true;
    });
    
    it('should wait for graceful shutdown timeout', async function() {
      const slowComponent = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().callsFake(() => {
          return new Promise(resolve => setTimeout(resolve, 1000));
        }),
        healthCheck: sinon.stub().resolves(true)
      };
      
      lifecycleManager.registerComponent('slow', slowComponent, {
        shutdownTimeout: 500
      });
      
      await lifecycleManager.start();
      
      const stopPromise = lifecycleManager.stop();
      clock.tick(600); // Past the timeout
      
      await stopPromise;
      expect(lifecycleManager.getState()).to.equal(LifecycleManager.States.STOPPED);
    });
  });
  
  describe('Statistics and Reporting', function() {
    it('should track component statistics', async function() {
      const component = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves(),
        healthCheck: sinon.stub().resolves(true)
      };
      
      lifecycleManager.registerComponent('tracked', component);
      
      await lifecycleManager.start();
      await lifecycleManager.stop();
      
      const stats = lifecycleManager.getStatistics();
      expect(stats.stateTransitions).to.be.at.least(2);
      expect(stats.componentStats.tracked).to.be.an('object');
      expect(stats.componentStats.tracked.startCount).to.equal(1);
      expect(stats.componentStats.tracked.stopCount).to.equal(1);
    });
    
    it('should provide health summary', async function() {
      const component1 = { healthCheck: sinon.stub().resolves(true) };
      const component2 = { healthCheck: sinon.stub().resolves(false) };
      
      lifecycleManager.registerComponent('healthy', component1);
      lifecycleManager.registerComponent('unhealthy', component2);
      
      lifecycleManager.state = LifecycleManager.States.RUNNING;
      
      const summary = await lifecycleManager.getHealthSummary();
      expect(summary.overall).to.be.false;
      expect(summary.components.healthy).to.be.true;
      expect(summary.components.unhealthy).to.be.false;
    });
  });
  
  describe('Error Handling', function() {
    it('should transition to ERROR state on critical failure', async function() {
      lifecycleManager.on('error', () => {}); // Prevent unhandled error
      
      await lifecycleManager.transitionTo(LifecycleManager.States.ERROR, new Error('Critical failure'));
      
      expect(lifecycleManager.getState()).to.equal(LifecycleManager.States.ERROR);
      expect(lifecycleManager.lastError).to.be.an('error');
    });
    
    it('should handle emergency stop', async function() {
      const component = {
        start: sinon.stub().resolves(),
        stop: sinon.stub().resolves()
      };
      
      lifecycleManager.registerComponent('test', component);
      await lifecycleManager.start();
      
      await lifecycleManager.emergencyStop();
      
      expect(lifecycleManager.getState()).to.equal(LifecycleManager.States.STOPPED);
      expect(component.stop.called).to.be.true;
    });
  });
});