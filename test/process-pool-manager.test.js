/**
 * Process Pool Manager Tests
 */

const { expect } = require('chai');
const sinon = require('sinon');
const { ProcessPoolManager } = require('../lib/core/process-pool-manager');
const path = require('path');

describe('ProcessPoolManager', () => {
  let processPool;
  let sandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // Create test instance with minimal workers
    processPool = new ProcessPoolManager({
      minWorkers: 1,
      maxWorkers: 2,
      autoScale: false,
      workerScript: path.join(__dirname, 'test-worker.js')
    });
  });

  afterEach(async () => {
    if (processPool && processPool.isRunning) {
      await processPool.shutdown();
    }
    sandbox.restore();
  });

  describe('Initialization', () => {
    it('should initialize with default options', () => {
      const pool = new ProcessPoolManager();
      
      expect(pool.options.minWorkers).to.equal(1);
      expect(pool.options.maxWorkers).to.equal(require('os').cpus().length);
      expect(pool.options.autoScale).to.be.true;
      expect(pool.options.scaleUpThreshold).to.equal(0.8);
    });

    it('should accept custom options', () => {
      const pool = new ProcessPoolManager({
        minWorkers: 2,
        maxWorkers: 4,
        autoScale: false,
        workerIdleTimeout: 30000
      });
      
      expect(pool.options.minWorkers).to.equal(2);
      expect(pool.options.maxWorkers).to.equal(4);
      expect(pool.options.autoScale).to.be.false;
      expect(pool.options.workerIdleTimeout).to.equal(30000);
    });
  });

  describe('Worker Management', () => {
    it('should track workers correctly', () => {
      expect(processPool.workers.size).to.equal(0);
      expect(processPool.availableWorkers.length).to.equal(0);
      expect(processPool.busyWorkers.size).to.equal(0);
    });

    it('should calculate load correctly', () => {
      // Initially no workers
      expect(processPool.calculateLoad()).to.equal(0);
      
      // Simulate workers
      processPool.workers.set('worker1', { state: 'idle' });
      processPool.workers.set('worker2', { state: 'busy' });
      processPool.busyWorkers.add('worker2');
      
      // 1 busy out of 2 workers = 50% load
      expect(processPool.calculateLoad()).to.equal(0.5);
      
      // Add queued tasks
      processPool.taskQueue.push({}, {});
      
      // (1 busy + 2 queued) / 2 workers = 150% load, capped at 100%
      expect(processPool.calculateLoad()).to.equal(1);
    });
  });

  describe('Task Management', () => {
    it('should queue tasks by priority', () => {
      const lowPriorityTask = { priority: 0, id: 'low' };
      const highPriorityTask = { priority: 10, id: 'high' };
      const mediumPriorityTask = { priority: 5, id: 'medium' };
      
      processPool.queueTask(lowPriorityTask);
      processPool.queueTask(highPriorityTask);
      processPool.queueTask(mediumPriorityTask);
      
      expect(processPool.taskQueue[0].id).to.equal('high');
      expect(processPool.taskQueue[1].id).to.equal('medium');
      expect(processPool.taskQueue[2].id).to.equal('low');
    });

    it('should track project limits', () => {
      processPool.setProjectLimit('project1', 5);
      processPool.setProjectLimit('project2', 3);
      
      expect(processPool.projectLimits.get('project1')).to.equal(5);
      expect(processPool.projectLimits.get('project2')).to.equal(3);
    });

    it('should check project limits correctly', () => {
      processPool.setProjectLimit('project1', 2);
      
      // No usage yet
      expect(processPool.checkProjectLimit('project1')).to.be.true;
      
      // Simulate usage
      processPool.projectUsage.set('project1', 1);
      expect(processPool.checkProjectLimit('project1')).to.be.true;
      
      // At limit
      processPool.projectUsage.set('project1', 2);
      expect(processPool.checkProjectLimit('project1')).to.be.false;
      
      // No limit set for project2
      expect(processPool.checkProjectLimit('project2')).to.be.true;
    });
  });

  describe('Metrics', () => {
    it('should track metrics correctly', () => {
      expect(processPool.metrics.totalTasks).to.equal(0);
      expect(processPool.metrics.completedTasks).to.equal(0);
      expect(processPool.metrics.failedTasks).to.equal(0);
      expect(processPool.metrics.avgTaskTime).to.equal(0);
    });

    it('should provide accurate stats', () => {
      const stats = processPool.getStats();
      
      expect(stats).to.have.property('workers');
      expect(stats).to.have.property('tasks');
      expect(stats).to.have.property('load');
      expect(stats).to.have.property('projectUsage');
      
      expect(stats.workers.total).to.equal(0);
      expect(stats.tasks.total).to.equal(0);
      expect(stats.load).to.equal(0);
    });
  });

  describe('Auto-scaling', () => {
    it('should not start auto-scaling when disabled', async () => {
      const pool = new ProcessPoolManager({ autoScale: false });
      const startAutoScalingSpy = sandbox.spy(pool, 'startAutoScaling');
      
      await pool.initialize();
      
      expect(startAutoScalingSpy.called).to.be.false;
      
      await pool.shutdown();
    });
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const { getInstance } = require('../lib/core/process-pool-manager');
      
      const instance1 = getInstance({ test: true });
      const instance2 = getInstance();
      
      expect(instance1).to.equal(instance2);
    });
  });
});