/**
 * Queue Persistence Tests
 * Tests for the enhanced queue manager persistence features
 */

const assert = require('assert');
const QueueManager = require('../lib/daemon/queue-manager');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

describe('Queue Persistence', function() {
  this.timeout(10000);
  
  let queue;
  const testDir = path.join(os.tmpdir(), 'poppobuilder-test-' + Date.now());
  
  beforeEach(async () => {
    // Create test directory
    await fs.mkdir(testDir, { recursive: true });
  });
  
  afterEach(async () => {
    // Stop queue if running
    if (queue && queue.isRunning) {
      await queue.stop();
    }
    
    // Clean up test directory
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });
  
  describe('JSON Storage', () => {
    it('should save and load queue state', async () => {
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath: path.join(testDir, 'queue.json'),
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      await queue.start();
      
      // Add tasks
      const taskId1 = await queue.addTask({
        projectId: 'project-1',
        type: 'test',
        priority: 5
      });
      
      const taskId2 = await queue.addTask({
        projectId: 'project-2',
        type: 'test',
        priority: 3
      });
      
      // Save manually
      await queue.saveQueue();
      
      // Create new queue instance
      const queue2 = new QueueManager({
        persistence: {
          type: 'json',
          filePath: path.join(testDir, 'queue.json'),
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      await queue2.start();
      
      // Verify loaded tasks
      const loadedQueue = queue2.getQueue();
      assert.strictEqual(loadedQueue.length, 2);
      assert.strictEqual(loadedQueue[0].projectId, 'project-1');
      assert.strictEqual(loadedQueue[1].projectId, 'project-2');
      
      await queue2.stop();
    });
    
    it('should handle corrupted files gracefully', async () => {
      // Write corrupted file
      const filePath = path.join(testDir, 'corrupted.json');
      await fs.writeFile(filePath, '{ invalid json');
      
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath,
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      // Should start without throwing
      await queue.start();
      
      // Should have empty queue
      assert.strictEqual(queue.getQueue().length, 0);
    });
    
    it('should create and restore snapshots', async () => {
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath: path.join(testDir, 'queue.json'),
          snapshotDir: path.join(testDir, 'snapshots'),
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      await queue.start();
      
      // Add initial tasks
      await queue.addTask({ projectId: 'project-1', priority: 5 });
      await queue.addTask({ projectId: 'project-1', priority: 3 });
      
      // Create snapshot
      await queue.createSnapshot('test-snapshot');
      
      // Add more tasks
      await queue.addTask({ projectId: 'project-2', priority: 1 });
      
      assert.strictEqual(queue.getQueue().length, 3);
      
      // Restore snapshot
      await queue.restoreSnapshot('test-snapshot');
      
      // Should have original 2 tasks
      assert.strictEqual(queue.getQueue().length, 2);
      
      // List snapshots
      const snapshots = await queue.listSnapshots();
      assert.strictEqual(snapshots.length, 1);
      assert.strictEqual(snapshots[0].id, 'test-snapshot');
    });
  });
  
  describe('Auto-save', () => {
    it('should auto-save at intervals', async () => {
      const filePath = path.join(testDir, 'autosave.json');
      
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath,
          autoSave: true,
          autoSaveInterval: 100, // 100ms for testing
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      await queue.start();
      
      // Add task
      await queue.addTask({ projectId: 'project-1' });
      
      // Wait for auto-save
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Check file exists
      const stats = await fs.stat(filePath);
      assert(stats.isFile());
      
      // Load and verify
      const content = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(content);
      assert.strictEqual(data.queue.length, 1);
    });
    
    it('should save on change when configured', async () => {
      const filePath = path.join(testDir, 'savechange.json');
      
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath,
          autoSave: false,
          saveOnChange: true,
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      await queue.start();
      
      // Add task - should trigger save
      await queue.addTask({ projectId: 'project-1' });
      
      // Check file exists immediately
      const stats = await fs.stat(filePath);
      assert(stats.isFile());
    });
  });
  
  describe('Monitoring', () => {
    it('should track persistence operations', async () => {
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath: path.join(testDir, 'monitored.json'),
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: true
        }
      });
      
      await queue.start();
      
      // Perform operations
      await queue.addTask({ projectId: 'project-1' });
      await queue.saveQueue();
      
      // Get stats
      const stats = await queue.getPersistenceStats();
      assert(stats.monitor);
      assert(stats.monitor.operations.save.count >= 1);
      
      // Get report
      const report = await queue.getPersistenceReport();
      assert(report.operations);
      assert(report.operations.save);
    });
    
    it('should emit alerts on slow operations', async () => {
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath: path.join(testDir, 'slow.json'),
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: true,
          alertThresholds: {
            saveTime: 1 // 1ms threshold for testing
          }
        }
      });
      
      let alertReceived = false;
      queue.on('persistence-alert', (alert) => {
        if (alert.type === 'slow-operation') {
          alertReceived = true;
        }
      });
      
      await queue.start();
      
      // Add many tasks to slow down save
      for (let i = 0; i < 100; i++) {
        await queue.addTask({ projectId: `project-${i}`, data: { large: 'x'.repeat(1000) } });
      }
      
      await queue.saveQueue();
      
      assert(alertReceived, 'Should have received slow operation alert');
    });
  });
  
  describe('Import/Export', () => {
    it('should export and import queue data', async () => {
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath: path.join(testDir, 'export.json'),
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      await queue.start();
      
      // Add tasks
      await queue.addTask({ projectId: 'project-1', priority: 5 });
      await queue.addTask({ projectId: 'project-2', priority: 3 });
      
      // Export
      const exported = await queue.exportQueue('json');
      const data = JSON.parse(exported);
      assert.strictEqual(data.queue.length, 2);
      
      // Clear queue
      queue.queue = [];
      assert.strictEqual(queue.getQueue().length, 0);
      
      // Import
      await queue.importQueue(exported, 'json');
      assert.strictEqual(queue.getQueue().length, 2);
    });
    
    it('should export to CSV format', async () => {
      queue = new QueueManager({
        persistence: {
          type: 'json',
          filePath: path.join(testDir, 'csv.json'),
          autoSave: false,
          enableSnapshots: false,
          enableMonitoring: false
        }
      });
      
      await queue.start();
      
      // Add tasks
      await queue.addTask({ projectId: 'project-1', type: 'build' });
      await queue.addTask({ projectId: 'project-2', type: 'test' });
      
      // Export as CSV
      const csv = await queue.exportQueue('csv');
      const lines = csv.split('\n');
      
      assert(lines[0].includes('id,'));
      assert(lines.length >= 3); // Header + 2 tasks
    });
  });
});

// Run tests if called directly
if (require.main === module) {
  const { spawn } = require('child_process');
  const mocha = spawn('npx', ['mocha', __filename], {
    stdio: 'inherit'
  });
  
  mocha.on('exit', (code) => {
    process.exit(code);
  });
}