#!/usr/bin/env node

/**
 * Queue Persistence Demo
 * Demonstrates the enhanced persistence capabilities of the queue manager
 */

const QueueManager = require('../lib/daemon/queue-manager');
const path = require('path');
const os = require('os');

async function demo() {
  console.log('=== PoppoBuilder Queue Persistence Demo ===\n');

  // Create queue manager with enhanced persistence
  const queue = new QueueManager({
    persistence: {
      type: 'json',  // Change to 'sqlite' or 'redis' to test other backends
      filePath: path.join(os.tmpdir(), 'poppobuilder-demo-queue.json'),
      autoSave: true,
      autoSaveInterval: 5000,  // 5 seconds for demo
      saveOnChange: true,
      enableSnapshots: true,
      snapshotInterval: 10000,  // 10 seconds for demo
      maxSnapshots: 5,
      enableMonitoring: true,
      alertThresholds: {
        saveTime: 1000,
        loadTime: 500,
        errorRate: 0.1,
        storageSize: 10 * 1024 * 1024  // 10MB
      }
    }
  });

  // Listen to persistence events
  queue.on('queue-loaded', (info) => {
    console.log(`✓ Queue loaded: ${info.queueLength} tasks`);
  });

  queue.on('queue-saved', (info) => {
    console.log(`✓ Queue saved: ${info.queueLength} tasks`);
  });

  queue.on('snapshot-created', (info) => {
    console.log(`📸 Snapshot created: ${info.snapshotId}`);
  });

  queue.on('persistence-alert', (alert) => {
    console.warn(`⚠️  Alert: ${alert.type}`, alert.details);
  });

  queue.on('persistence-error', (error) => {
    console.error(`❌ Persistence error:`, error);
  });

  try {
    // Start queue manager
    console.log('Starting queue manager...');
    await queue.start();

    // Add some tasks
    console.log('\nAdding tasks...');
    for (let i = 1; i <= 5; i++) {
      const taskId = await queue.addTask({
        projectId: `project-${i % 2 + 1}`,
        type: 'build',
        priority: Math.floor(Math.random() * 10),
        data: { 
          command: `echo "Task ${i}"`,
          timestamp: Date.now()
        }
      });
      console.log(`  Added task: ${taskId}`);
    }

    // Wait for auto-save
    console.log('\nWaiting for auto-save...');
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Create manual snapshot
    console.log('\nCreating manual snapshot...');
    await queue.createSnapshot('demo-snapshot');

    // Get persistence stats
    console.log('\nPersistence Statistics:');
    const stats = await queue.getPersistenceStats();
    console.log(JSON.stringify(stats, null, 2));

    // List snapshots
    console.log('\nAvailable Snapshots:');
    const snapshots = await queue.listSnapshots();
    snapshots.forEach(s => {
      console.log(`  - ${s.id} (created: ${s.createdAt})`);
    });

    // Export queue
    console.log('\nExporting queue...');
    const exported = await queue.exportQueue('json');
    console.log(`  Exported ${exported.length} bytes`);

    // Simulate processing some tasks
    console.log('\nProcessing tasks...');
    let processed = 0;
    queue.on('task-ready', async (task) => {
      console.log(`  Processing: ${task.id}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      await queue.completeTask(task.id, { success: true });
      processed++;
    });

    // Wait for some processing
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Get performance report
    console.log('\nPerformance Report:');
    const report = await queue.getPersistenceReport();
    console.log(JSON.stringify(report, null, 2));

    // Test snapshot restore
    console.log('\nTesting snapshot restore...');
    const beforeRestore = queue.getQueue().length;
    await queue.restoreSnapshot('demo-snapshot');
    const afterRestore = queue.getQueue().length;
    console.log(`  Queue size: ${beforeRestore} → ${afterRestore}`);

    // Clean up and stop
    console.log('\nStopping queue manager...');
    await queue.stop();

    console.log('\n✅ Demo completed successfully!');

  } catch (error) {
    console.error('Demo failed:', error);
    process.exit(1);
  }
}

// Run demo
demo().catch(console.error);