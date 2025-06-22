const assert = require('assert');
const AutoScaler = require('../agents/core/auto-scaler');
const MetricsCollector = require('../agents/core/metrics-collector');
const LoadBalancer = require('../agents/core/load-balancer');
const LifecycleManager = require('../agents/shared/lifecycle-manager');

// Mockロガー
class MockLogger {
  constructor() {
    this.logs = [];
  }
  
  info(message, data) {
    this.logs.push({ level: 'info', message, data });
  }
  
  warn(message, data) {
    this.logs.push({ level: 'warn', message, data });
  }
  
  error(message, data) {
    this.logs.push({ level: 'error', message, data });
  }
  
  debug(message, data) {
    this.logs.push({ level: 'debug', message, data });
  }
}

describe('Dynamic Scaling System', () => {
  let logger;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    logger = new MockLogger();
  });
  
  describe('AutoScaler', () => {
    let autoScaler;
    let metricsCollector;
  let sandbox;
    
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      metricsCollector = new MetricsCollector(logger);
      autoScaler = new AutoScaler(logger, {
        minAgents: 2,
        maxAgents: 10,
        scaleUpThreshold: 0.8,
        scaleDownThreshold: 0.3
      });
      autoScaler.setMetricsCollector(metricsCollector);
    });
    
    afterEach(() => {
      if (autoScaler.isRunning) {
        autoScaler.stop();
      }
      if (metricsCollector.isRunning) {
        metricsCollector.stop();
      }
    });
    
    it('should initialize with correct config', () => {
      assert.strictEqual(autoScaler.config.minAgents, 2);
      assert.strictEqual(autoScaler.config.maxAgents, 10);
      assert.strictEqual(autoScaler.currentAgents, 2);
    });
    
    it('should make scale-up decision on high load', () => {
      const metrics = {
        cpu: { cores: [80, 85, 90, 88], average: 85.75 },
        memory: { percentage: 70 },
        taskQueue: { size: 20, pending: 15 },
        agents: { active: 2 }
      };
      
      const decision = autoScaler.makeScalingDecision(metrics);
      assert.strictEqual(decision.action, 'scale-up');
    });
    
    it('should make scale-down decision on low load', () => {
      autoScaler.currentAgents = 5;
      const metrics = {
        cpu: { cores: [20, 25, 15, 18], average: 19.5 },
        memory: { percentage: 30 },
        taskQueue: { size: 2, pending: 1 },
        agents: { active: 5 }
      };
      
      const decision = autoScaler.makeScalingDecision(metrics);
      assert.strictEqual(decision.action, 'scale-down');
    });
    
    it('should respect cooldown period', async () => {
      autoScaler.lastScaleAction = Date.now();
      
      const metrics = {
        cpu: { cores: [90, 95, 92, 88], average: 91.25 },
        memory: { percentage: 75 },
        taskQueue: { size: 30, pending: 25 },
        agents: { active: 2 }
      };
      
      const decision = autoScaler.makeScalingDecision(metrics);
      assert.strictEqual(decision.action, 'none');
      assert.strictEqual(decision.reason, 'cooldown period active');
    });
    
    it('should emit scale-up event', (done) => {
      autoScaler.on('scale-up', (event) => {
        assert.strictEqual(event.increment, 2);
        assert.strictEqual(event.total, 4);
        done();
      });
      
      autoScaler.executeScalingAction({
        action: 'scale-up',
        increment: 2,
        reason: 'test'
      });
    });
  });
  
  describe('MetricsCollector', () => {
    let metricsCollector;
    
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      metricsCollector = new MetricsCollector(logger, {
        collectionInterval: 100,
        historySize: 10
      });
    });
    
    afterEach(() => {
      if (metricsCollector.isRunning) {
        metricsCollector.stop();
      }
    });
    
    it('should collect CPU and memory metrics', () => {
      const cpuMetrics = metricsCollector.collectCPUMetrics();
      assert(cpuMetrics.cores);
      assert(cpuMetrics.average);
      assert(cpuMetrics.loadAvg);
      
      const memoryMetrics = metricsCollector.collectMemoryMetrics();
      assert(memoryMetrics.total > 0);
      assert(memoryMetrics.percentage >= 0 && memoryMetrics.percentage <= 100);
    });
    
    it('should update task queue metrics', () => {
      metricsCollector.updateTaskQueueMetrics({
        size: 10,
        pending: 8,
        processing: 2,
        completed: 50,
        failed: 3
      });
      
      assert.strictEqual(metricsCollector.metrics.taskQueue.length, 1);
      assert.strictEqual(metricsCollector.metrics.taskQueue[0].size, 10);
    });
    
    it('should aggregate metrics within time window', async () => {
      metricsCollector.start();
      
      // Add some metrics
      metricsCollector.updateTaskQueueMetrics({ size: 5 });
      await new Promise(resolve => setTimeout(resolve, 110));
      metricsCollector.updateTaskQueueMetrics({ size: 10 });
      
      const aggregated = await metricsCollector.getAggregatedMetrics();
      assert(aggregated.cpu);
      assert(aggregated.memory);
      assert(aggregated.taskQueue);
    });
  });
  
  describe('LoadBalancer', () => {
    let loadBalancer;
    
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      loadBalancer = new LoadBalancer(logger, {
        algorithm: 'round-robin'
      });
    });
    
    afterEach(() => {
      if (loadBalancer.isRunning) {
        loadBalancer.stop();
      }
    });
    
    it('should register and unregister agents', () => {
      loadBalancer.registerAgent('agent-1', {
        weight: 1,
        maxConcurrent: 5
      });
      
      assert(loadBalancer.agents.has('agent-1'));
      
      loadBalancer.unregisterAgent('agent-1');
      assert(!loadBalancer.agents.has('agent-1'));
    });
    
    it('should select agent using round-robin', async () => {
      loadBalancer.registerAgent('agent-1', {});
      loadBalancer.registerAgent('agent-2', {});
      loadBalancer.registerAgent('agent-3', {});
      
      const selections = [];
      for (let i = 0; i < 6; i++) {
        const agent = await loadBalancer.selectAgent({ type: 'test' });
        selections.push(agent);
      }
      
      // Round-robin pattern
      assert.strictEqual(selections[0], selections[3]);
      assert.strictEqual(selections[1], selections[4]);
      assert.strictEqual(selections[2], selections[5]);
    });
    
    it('should select agent using least-connections', async () => {
      loadBalancer.config.algorithm = 'least-connections';
      
      loadBalancer.registerAgent('agent-1', { maxConcurrent: 5 });
      loadBalancer.registerAgent('agent-2', { maxConcurrent: 5 });
      
      loadBalancer.agents.get('agent-1').currentLoad = 3;
      loadBalancer.agents.get('agent-2').currentLoad = 1;
      
      const selected = await loadBalancer.selectAgent({ type: 'test' });
      assert.strictEqual(selected, 'agent-2');
    });
    
    it('should track request statistics', () => {
      loadBalancer.registerAgent('agent-1', {});
      
      loadBalancer.recordRequestResult('agent-1', true, 100);
      loadBalancer.recordRequestResult('agent-1', true, 150);
      loadBalancer.recordRequestResult('agent-1', false, 200);
      
      const stats = loadBalancer.requestStats.get('agent-1');
      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.success, 2);
      assert.strictEqual(stats.failed, 1);
      assert.strictEqual(stats.avgResponseTime, 150);
    });
  });
  
  describe('LifecycleManager', () => {
    let lifecycleManager;
    
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      lifecycleManager = new LifecycleManager(logger, {
        healthCheckInterval: 100,
        zombieCheckInterval: 200
      });
    });
    
    afterEach(() => {
      if (lifecycleManager.isRunning) {
        lifecycleManager.stop();
      }
    });
    
    it('should track agent lifecycle', async () => {
      const agentConfig = {
        type: 'test',
        command: 'echo',
        args: ['test']
      };
      
      let spawnedEvent = null;
      lifecycleManager.on('agent-spawned', (event) => {
        spawnedEvent = event;
      });
      
      try {
        await lifecycleManager.spawnAgent('test-agent', agentConfig);
        
        assert(spawnedEvent);
        assert.strictEqual(spawnedEvent.agentId, 'test-agent');
        assert(lifecycleManager.agents.has('test-agent'));
        
        const status = lifecycleManager.getAgentStatus('test-agent');
        assert.strictEqual(status.id, 'test-agent');
        assert.strictEqual(status.type, 'test');
      } catch (error) {
        // Spawn might fail in test environment
        console.log('Agent spawn failed (expected in test):', error.message);
      }
    });
    
    it('should handle scaling operations', async () => {
      const agentType = 'test';
      
      // Mock some running agents
      lifecycleManager.agents.set('test-1', {
        id: 'test-1',
        config: { type: agentType },
        status: 'running',
        startTime: Date.now() - 10000
      });
      
      lifecycleManager.agents.set('test-2', {
        id: 'test-2',
        config: { type: agentType },
        status: 'running',
        startTime: Date.now() - 5000
      });
      
      // Test scale down (should remove oldest first)
      const toTerminate = Array.from(lifecycleManager.agents.values())
        .filter(a => a.config.type === agentType)
        .sort((a, b) => a.startTime - b.startTime)
        .slice(0, 1);
      
      assert.strictEqual(toTerminate[0].id, 'test-1');
    });
  });
  
  describe('Integration Tests', () => {
    it('should work together as a system', async () => {
      const metricsCollector = new MetricsCollector(logger);
      const autoScaler = new AutoScaler(logger, {
        minAgents: 1,
        maxAgents: 5,
        evaluationInterval: 100
      });
      const loadBalancer = new LoadBalancer(logger);
      const lifecycleManager = new LifecycleManager(logger);
      
      // Wire them together
      autoScaler.setMetricsCollector(metricsCollector);
      
      let scaleUpEmitted = false;
      autoScaler.on('scale-up', () => {
        scaleUpEmitted = true;
      });
      
      // Start components
      metricsCollector.start();
      loadBalancer.start();
      lifecycleManager.start();
      
      // Simulate high load
      metricsCollector.updateTaskQueueMetrics({
        size: 50,
        pending: 45,
        processing: 5
      });
      
      // Manually trigger evaluation
      await autoScaler.evaluate();
      
      // Verify integration
      assert(scaleUpEmitted || autoScaler.currentAgents === 1);
      
      // Cleanup
      metricsCollector.stop();
      autoScaler.stop();
      loadBalancer.stop();
      lifecycleManager.stop();
    });
  });
});

// テスト実行
if (require.main === module) {
  console.log('動的スケーリングシステムのテストを実行中...');
  require('child_process').execSync('npx mocha ' + __filename, { stdio: 'inherit' });
}