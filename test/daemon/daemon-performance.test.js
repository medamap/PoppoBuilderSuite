/**
 * Daemon Performance Tests
 * 
 * Performance and load testing for the PoppoBuilder daemon
 */

const { expect } = require('chai');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const PoppoDaemon = require('../../lib/daemon/poppo-daemon');
const { IPCClient } = require('../../lib/daemon/ipc');
const { getInstance: getGlobalConfig } = require('../../lib/core/global-config-manager');

describe('Daemon Performance Tests', function() {
  this.timeout(60000); // 1 minute for performance tests
  
  let testConfigDir;
  let daemon;
  let ipcClient;
  
  before(async function() {
    testConfigDir = path.join(os.tmpdir(), `poppo-perf-test-${Date.now()}`);
    await fs.mkdir(testConfigDir, { recursive: true });
    process.env.POPPO_CONFIG_DIR = testConfigDir;
    
    // Initialize test configuration with performance settings
    const globalConfig = getGlobalConfig();
    await globalConfig.initialize();
    
    const testConfig = {
      version: '3.0.0',
      daemon: {
        enabled: true,
        port: 3203,
        host: '127.0.0.1',
        maxProcesses: 8,
        schedulingStrategy: 'weighted-round-robin'
      },
      taskQueue: {
        maxQueueSize: 10000,
        priorityManagement: {
          enabled: true,
          preemption: {
            enabled: true
          }
        }
      },
      workerPool: {
        minWorkers: 2,
        maxWorkers: 16,
        strategy: 'load-balanced'
      }
    };
    
    await globalConfig.updateConfig(testConfig);
    
    // Start daemon
    daemon = new PoppoDaemon({
      port: 3203,
      maxProcesses: 8
    });
    
    await daemon.start();
    await new Promise(resolve => daemon.on('started', resolve));
    
    ipcClient = new IPCClient();
    await ipcClient.connect();
  });
  
  after(async function() {
    if (ipcClient) {
      await ipcClient.disconnect();
    }
    
    if (daemon) {
      await daemon.shutdown(0);
    }
    
    try {
      await fs.rmdir(testConfigDir, { recursive: true });
    } catch (error) {
      // Ignore
    }
    
    delete process.env.POPPO_CONFIG_DIR;
  });
  
  describe('Connection Performance', function() {
    it('should handle rapid connection establishment', async function() {
      const connectionCount = 100;
      const connections = [];
      const startTime = Date.now();
      
      // Create connections rapidly
      for (let i = 0; i < connectionCount; i++) {
        const client = new IPCClient();
        connections.push(client.connect());
      }
      
      await Promise.all(connections);
      const connectTime = Date.now() - startTime;
      
      console.log(`    Connected ${connectionCount} clients in ${connectTime}ms`);
      console.log(`    Average: ${(connectTime / connectionCount).toFixed(2)}ms per connection`);
      
      expect(connectTime).to.be.below(5000); // Under 5 seconds
      expect(connectTime / connectionCount).to.be.below(50); // Under 50ms per connection
      
      // Cleanup connections
      const clients = await Promise.all(connections);
      await Promise.all(clients.map(client => client.disconnect()));
    });
    
    it('should maintain connection pool efficiently', async function() {
      const poolSize = 50;
      const operationsPerClient = 10;
      const clients = [];
      
      // Create connection pool
      for (let i = 0; i < poolSize; i++) {
        const client = new IPCClient();
        await client.connect();
        clients.push(client);
      }
      
      const startTime = Date.now();
      
      // Perform operations concurrently
      const operations = clients.map(async (client, index) => {
        const results = [];
        for (let i = 0; i < operationsPerClient; i++) {
          const result = await client.sendCommand('ping');
          results.push(result);
        }
        return results;
      });
      
      const allResults = await Promise.all(operations);
      const totalTime = Date.now() - startTime;
      const totalOperations = poolSize * operationsPerClient;
      
      console.log(`    Performed ${totalOperations} operations in ${totalTime}ms`);
      console.log(`    Throughput: ${(totalOperations / totalTime * 1000).toFixed(2)} ops/sec`);
      
      // Verify all operations succeeded
      allResults.forEach(results => {
        results.forEach(result => {
          expect(result).to.deep.equal({ success: true, message: 'pong' });
        });
      });
      
      expect(totalOperations / totalTime * 1000).to.be.above(500); // At least 500 ops/sec
      
      // Cleanup
      await Promise.all(clients.map(client => client.disconnect()));
    });
  });
  
  describe('Task Queue Performance', function() {
    it('should handle high-volume task queuing', async function() {
      const taskCount = 1000;
      const batchSize = 100;
      const startTime = Date.now();
      
      // Queue tasks in batches
      for (let batch = 0; batch < taskCount / batchSize; batch++) {
        const batchPromises = [];
        
        for (let i = 0; i < batchSize; i++) {
          const taskId = batch * batchSize + i;
          const task = {
            id: `perf-task-${taskId}`,
            type: 'performance-test',
            projectId: 'perf-project',
            priority: Math.floor(Math.random() * 100),
            data: { index: taskId }
          };
          
          batchPromises.push(
            ipcClient.sendCommand('queue-task', task)
          );
        }
        
        await Promise.all(batchPromises);
      }
      
      const queueTime = Date.now() - startTime;
      
      console.log(`    Queued ${taskCount} tasks in ${queueTime}ms`);
      console.log(`    Queue rate: ${(taskCount / queueTime * 1000).toFixed(2)} tasks/sec`);
      
      // Verify queue state
      const status = await ipcClient.sendCommand('get-queue-status');
      expect(status.totalTasks).to.be.at.least(taskCount);
      
      expect(taskCount / queueTime * 1000).to.be.above(100); // At least 100 tasks/sec
    });
    
    it('should maintain priority queue performance', async function() {
      const taskCount = 500;
      const priorities = [10, 25, 50, 75, 90];
      const startTime = Date.now();
      
      // Queue tasks with different priorities
      const queuePromises = [];
      for (let i = 0; i < taskCount; i++) {
        const priority = priorities[i % priorities.length];
        const task = {
          id: `priority-task-${i}`,
          type: 'priority-test',
          priority,
          data: { index: i, priority }
        };
        
        queuePromises.push(
          ipcClient.sendCommand('queue-task', task)
        );
      }
      
      await Promise.all(queuePromises);
      const queueTime = Date.now() - startTime;
      
      console.log(`    Queued ${taskCount} priority tasks in ${queueTime}ms`);
      
      // Get next tasks and verify priority ordering
      const nextTasks = [];
      for (let i = 0; i < 10; i++) {
        const response = await ipcClient.sendCommand('get-next-task');
        if (response.task) {
          nextTasks.push(response.task);
        }
      }
      
      // Verify tasks are ordered by priority (highest first)
      for (let i = 1; i < nextTasks.length; i++) {
        expect(nextTasks[i].priority).to.be.at.most(nextTasks[i - 1].priority);
      }
      
      expect(queueTime).to.be.below(3000); // Under 3 seconds
    });
  });
  
  describe('Worker Pool Performance', function() {
    it('should scale workers efficiently', async function() {
      const targetWorkers = [2, 4, 8, 16, 8, 4, 2];
      const scaleResults = [];
      
      for (const target of targetWorkers) {
        const startTime = Date.now();
        
        const response = await ipcClient.sendCommand('scale-workers', {
          targetWorkers: target
        });
        
        const scaleTime = Date.now() - startTime;
        scaleResults.push({ target, time: scaleTime, success: response.success });
        
        // Verify scaling
        const status = await ipcClient.sendCommand('status');
        expect(status.workers.totalWorkers).to.equal(target);
        
        console.log(`    Scaled to ${target} workers in ${scaleTime}ms`);
        
        // Brief pause between scaling operations
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Verify all scaling operations were fast
      scaleResults.forEach(result => {
        expect(result.success).to.be.true;
        expect(result.time).to.be.below(2000); // Under 2 seconds
      });
      
      const avgScaleTime = scaleResults.reduce((sum, r) => sum + r.time, 0) / scaleResults.length;
      console.log(`    Average scaling time: ${avgScaleTime.toFixed(2)}ms`);
    });
    
    it('should handle concurrent task processing', async function() {
      // Scale up for concurrent processing
      await ipcClient.sendCommand('scale-workers', { targetWorkers: 8 });
      
      const taskCount = 200;
      const startTime = Date.now();
      
      // Queue tasks that simulate work
      const queuePromises = [];
      for (let i = 0; i < taskCount; i++) {
        const task = {
          id: `concurrent-task-${i}`,
          type: 'simulated-work',
          data: { 
            workDuration: 100 + Math.random() * 200, // 100-300ms
            index: i 
          }
        };
        
        queuePromises.push(
          ipcClient.sendCommand('queue-task', task)
        );
      }
      
      await Promise.all(queuePromises);
      const queueCompleteTime = Date.now();
      
      // Wait for tasks to be processed
      let processedCount = 0;
      while (processedCount < taskCount) {
        const status = await ipcClient.sendCommand('get-queue-status');
        processedCount = status.completedTasks || 0;
        
        if (processedCount < taskCount) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Timeout check
        if (Date.now() - startTime > 30000) {
          throw new Error('Task processing timeout');
        }
      }
      
      const totalTime = Date.now() - startTime;
      const queueTime = queueCompleteTime - startTime;
      const processTime = totalTime - queueTime;
      
      console.log(`    Queued ${taskCount} tasks in ${queueTime}ms`);
      console.log(`    Processed ${taskCount} tasks in ${processTime}ms`);
      console.log(`    Processing rate: ${(taskCount / processTime * 1000).toFixed(2)} tasks/sec`);
      
      expect(processTime).to.be.below(15000); // Under 15 seconds
      expect(taskCount / processTime * 1000).to.be.above(10); // At least 10 tasks/sec
    });
  });
  
  describe('Memory and Resource Performance', function() {
    it('should maintain stable memory usage', async function() {
      const initialMemory = process.memoryUsage();
      const measurements = [initialMemory];
      
      // Perform memory-intensive operations
      for (let round = 0; round < 10; round++) {
        // Queue and process many tasks
        const tasks = [];
        for (let i = 0; i < 100; i++) {
          const task = {
            id: `memory-test-${round}-${i}`,
            type: 'memory-test',
            data: { 
              payload: 'x'.repeat(1000), // 1KB payload
              round,
              index: i 
            }
          };
          
          tasks.push(ipcClient.sendCommand('queue-task', task));
        }
        
        await Promise.all(tasks);
        
        // Force garbage collection if available
        if (global.gc) {
          global.gc();
        }
        
        const currentMemory = process.memoryUsage();
        measurements.push(currentMemory);
        
        console.log(`    Round ${round}: Heap used ${Math.round(currentMemory.heapUsed / 1024 / 1024)}MB`);
        
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Analyze memory growth
      const finalMemory = measurements[measurements.length - 1];
      const memoryGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const memoryGrowthMB = memoryGrowth / 1024 / 1024;
      
      console.log(`    Memory growth: ${memoryGrowthMB.toFixed(2)}MB`);
      
      // Should not grow by more than 50MB
      expect(memoryGrowthMB).to.be.below(50);
    });
    
    it('should handle file descriptor limits', async function() {
      const connectionLimit = 100;
      const connections = [];
      
      try {
        // Create many connections to test file descriptor usage
        for (let i = 0; i < connectionLimit; i++) {
          const client = new IPCClient();
          await client.connect();
          connections.push(client);
        }
        
        // Verify all connections work
        const pingPromises = connections.map(client => client.sendCommand('ping'));
        const responses = await Promise.all(pingPromises);
        
        responses.forEach(response => {
          expect(response).to.deep.equal({ success: true, message: 'pong' });
        });
        
        console.log(`    Successfully handled ${connectionLimit} concurrent connections`);
        
      } finally {
        // Cleanup all connections
        await Promise.all(connections.map(client => client.disconnect()));
      }
    });
  });
  
  describe('Stress Testing', function() {
    it('should survive sustained high load', async function() {
      const duration = 10000; // 10 seconds
      const startTime = Date.now();
      const operations = [];
      let operationCount = 0;
      
      // Generate continuous load
      const loadGenerator = setInterval(async () => {
        if (Date.now() - startTime >= duration) {
          clearInterval(loadGenerator);
          return;
        }
        
        // Queue multiple tasks
        for (let i = 0; i < 10; i++) {
          const task = {
            id: `stress-${operationCount++}`,
            type: 'stress-test',
            priority: Math.floor(Math.random() * 100),
            data: { timestamp: Date.now() }
          };
          
          operations.push(
            ipcClient.sendCommand('queue-task', task).catch(error => {
              console.error('Queue error:', error.message);
            })
          );
        }
        
        // Send status requests
        operations.push(
          ipcClient.sendCommand('status').catch(error => {
            console.error('Status error:', error.message);
          })
        );
      }, 50); // Every 50ms
      
      // Wait for test duration
      await new Promise(resolve => setTimeout(resolve, duration + 1000));
      
      // Wait for remaining operations
      await Promise.all(operations);
      
      // Verify daemon is still responsive
      const finalStatus = await ipcClient.sendCommand('status');
      expect(finalStatus.daemon.status).to.equal('running');
      
      console.log(`    Completed ${operationCount} operations under sustained load`);
      console.log(`    Average rate: ${(operationCount / (duration / 1000)).toFixed(2)} ops/sec`);
      
      expect(operationCount).to.be.above(1000); // Should handle substantial load
    });
  });
});

// Performance utilities
function measureTime(fn) {
  return async function(...args) {
    const start = Date.now();
    const result = await fn.apply(this, args);
    const duration = Date.now() - start;
    return { result, duration };
  };
}

function createPerformanceMonitor() {
  const metrics = {
    operations: 0,
    totalTime: 0,
    minTime: Infinity,
    maxTime: 0,
    errors: 0
  };
  
  return {
    record(duration, error = null) {
      metrics.operations++;
      if (error) {
        metrics.errors++;
      } else {
        metrics.totalTime += duration;
        metrics.minTime = Math.min(metrics.minTime, duration);
        metrics.maxTime = Math.max(metrics.maxTime, duration);
      }
    },
    
    getStats() {
      return {
        ...metrics,
        avgTime: metrics.operations > 0 ? metrics.totalTime / (metrics.operations - metrics.errors) : 0,
        successRate: metrics.operations > 0 ? (metrics.operations - metrics.errors) / metrics.operations : 0
      };
    },
    
    reset() {
      Object.assign(metrics, {
        operations: 0,
        totalTime: 0,
        minTime: Infinity,
        maxTime: 0,
        errors: 0
      });
    }
  };
}