const { expect } = require('chai');
const sinon = require('sinon');
const TestHelpers = require('../helpers/test-helpers');

describe('CCSP Queue Manager Unit Tests', () => {
  let helpers;
  let QueueManager;
  let queueManager;
  let mockRedis;

  before(() => {
    helpers = new TestHelpers();
  });

  beforeEach(() => {
    // Create mock Redis
    mockRedis = helpers.createMockRedis();
    
    // Mock the module
    QueueManager = require('../../../agents/ccsp/queue-manager');
    
    // Create instance with mock Redis
    queueManager = new QueueManager({
      redis: mockRedis,
      maxConcurrent: 3,
      priorityLevels: 10
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('Queue Initialization', () => {
    it('should initialize queues correctly', async () => {
      await queueManager.initialize();
      
      expect(queueManager.queues).to.have.property('high');
      expect(queueManager.queues).to.have.property('normal');
      expect(queueManager.queues).to.have.property('low');
    });

    it('should set correct concurrency limits', async () => {
      await queueManager.initialize();
      
      expect(queueManager.queues.high.concurrency).to.equal(2);
      expect(queueManager.queues.normal.concurrency).to.equal(1);
      expect(queueManager.queues.low.concurrency).to.equal(1);
    });
  });

  describe('Task Addition', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should add task to correct queue based on priority', async () => {
      const highPriorityTask = helpers.createMockRequest('task', { priority: 9 });
      const normalPriorityTask = helpers.createMockRequest('task', { priority: 5 });
      const lowPriorityTask = helpers.createMockRequest('task', { priority: 2 });

      await queueManager.addTask(highPriorityTask);
      await queueManager.addTask(normalPriorityTask);
      await queueManager.addTask(lowPriorityTask);

      const highQueueSize = await mockRedis.llen('bull:ccsp:queue:high:wait');
      const normalQueueSize = await mockRedis.llen('bull:ccsp:queue:normal:wait');
      const lowQueueSize = await mockRedis.llen('bull:ccsp:queue:low:wait');

      expect(highQueueSize).to.equal(1);
      expect(normalQueueSize).to.equal(1);
      expect(lowQueueSize).to.equal(1);
    });

    it('should handle emergency tasks', async () => {
      const emergencyTask = helpers.createMockRequest('task', { 
        priority: 10,
        emergency: true 
      });

      const jobId = await queueManager.addTask(emergencyTask);
      expect(jobId).to.be.a('string');
      
      // Emergency tasks should go to high priority queue
      const highQueueSize = await mockRedis.llen('bull:ccsp:queue:high:wait');
      expect(highQueueSize).to.equal(1);
    });

    it('should reject invalid tasks', async () => {
      const invalidTask = { invalid: true };
      
      try {
        await queueManager.addTask(invalidTask);
        expect.fail('Should have thrown error');
      } catch (error) {
        expect(error.message).to.include('Invalid task');
      }
    });
  });

  describe('Queue Processing', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should process tasks in priority order', async () => {
      const processedTasks = [];
      
      // Mock processor
      queueManager.setProcessor(async (job) => {
        processedTasks.push(job.data.priority);
        return { success: true };
      });

      // Add tasks in mixed order
      await queueManager.addTask(helpers.createMockRequest('task', { priority: 5 }));
      await queueManager.addTask(helpers.createMockRequest('task', { priority: 9 }));
      await queueManager.addTask(helpers.createMockRequest('task', { priority: 2 }));

      // Start processing
      await queueManager.startProcessing();
      
      // Wait for processing
      await helpers.waitFor(() => processedTasks.length === 3);

      // Should process in priority order: 9, 5, 2
      expect(processedTasks[0]).to.equal(9);
      expect(processedTasks[1]).to.equal(5);
      expect(processedTasks[2]).to.equal(2);
    });

    it('should respect concurrency limits', async () => {
      let activeCount = 0;
      let maxActive = 0;
      
      // Mock processor with delay
      queueManager.setProcessor(async (job) => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        await new Promise(resolve => setTimeout(resolve, 100));
        activeCount--;
        return { success: true };
      });

      // Add multiple tasks
      for (let i = 0; i < 10; i++) {
        await queueManager.addTask(helpers.createMockRequest('task', { priority: 5 }));
      }

      // Start processing
      await queueManager.startProcessing();
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 200));

      // Should not exceed max concurrent
      expect(maxActive).to.be.at.most(3);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should retry failed tasks', async () => {
      let attemptCount = 0;
      
      // Mock processor that fails first time
      queueManager.setProcessor(async (job) => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('Temporary failure');
        }
        return { success: true };
      });

      await queueManager.addTask(helpers.createMockRequest('task'));
      await queueManager.startProcessing();
      
      // Wait for retry
      await helpers.waitFor(() => attemptCount >= 2);

      expect(attemptCount).to.equal(2);
    });

    it('should move permanently failed tasks to dead letter queue', async () => {
      // Mock processor that always fails
      queueManager.setProcessor(async (job) => {
        throw new Error('Permanent failure');
      });

      await queueManager.addTask(helpers.createMockRequest('task'));
      await queueManager.startProcessing();
      
      // Wait for retries to exhaust
      await new Promise(resolve => setTimeout(resolve, 500));

      const failedCount = await mockRedis.zcard('bull:ccsp:queue:normal:failed');
      expect(failedCount).to.be.greaterThan(0);
    });
  });

  describe('Queue Management', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should pause and resume queues', async () => {
      await queueManager.pauseQueue('normal');
      expect(queueManager.isPaused('normal')).to.be.true;

      await queueManager.resumeQueue('normal');
      expect(queueManager.isPaused('normal')).to.be.false;
    });

    it('should clear queue', async () => {
      // Add tasks
      for (let i = 0; i < 5; i++) {
        await queueManager.addTask(helpers.createMockRequest('task'));
      }

      const beforeSize = await mockRedis.llen('bull:ccsp:queue:normal:wait');
      expect(beforeSize).to.equal(5);

      // Clear queue
      await queueManager.clearQueue('normal');

      const afterSize = await mockRedis.llen('bull:ccsp:queue:normal:wait');
      expect(afterSize).to.equal(0);
    });

    it('should get queue statistics', async () => {
      // Add various tasks
      await queueManager.addTask(helpers.createMockRequest('task', { priority: 9 }));
      await queueManager.addTask(helpers.createMockRequest('task', { priority: 5 }));
      await queueManager.addTask(helpers.createMockRequest('task', { priority: 2 }));

      const stats = await queueManager.getQueueStats();
      
      expect(stats).to.have.property('high');
      expect(stats).to.have.property('normal');
      expect(stats).to.have.property('low');
      expect(stats.high.waiting).to.equal(1);
      expect(stats.normal.waiting).to.equal(1);
      expect(stats.low.waiting).to.equal(1);
    });
  });

  describe('Priority Management', () => {
    beforeEach(async () => {
      await queueManager.initialize();
    });

    it('should update task priority', async () => {
      const jobId = await queueManager.addTask(
        helpers.createMockRequest('task', { priority: 5 })
      );

      await queueManager.updatePriority(jobId, 9);

      // Task should move to high priority queue
      const normalSize = await mockRedis.llen('bull:ccsp:queue:normal:wait');
      const highSize = await mockRedis.llen('bull:ccsp:queue:high:wait');
      
      expect(normalSize).to.equal(0);
      expect(highSize).to.equal(1);
    });

    it('should handle priority boundaries correctly', () => {
      expect(queueManager.getQueueForPriority(10)).to.equal('high');
      expect(queueManager.getQueueForPriority(8)).to.equal('high');
      expect(queueManager.getQueueForPriority(7)).to.equal('normal');
      expect(queueManager.getQueueForPriority(4)).to.equal('normal');
      expect(queueManager.getQueueForPriority(3)).to.equal('low');
      expect(queueManager.getQueueForPriority(0)).to.equal('low');
    });
  });
});