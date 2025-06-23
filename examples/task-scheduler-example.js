/**
 * Task Scheduler Example
 * Demonstrates how to use the task scheduler with queue manager
 */

const TaskScheduler = require('../lib/daemon/task-scheduler');
const QueueManager = require('../lib/daemon/queue-manager');

async function main() {
  // Create queue manager
  const queueManager = new QueueManager({
    schedulingStrategy: 'weighted-round-robin',
    persistQueue: true
  });

  // Create task scheduler
  const taskScheduler = new TaskScheduler({
    defaultPollingInterval: 5 * 60 * 1000, // 5 minutes
    minPollingInterval: 60 * 1000, // 1 minute
    batchSize: 10
  });

  // Link scheduler to queue manager
  taskScheduler.setQueueManager(queueManager);

  // Set up event listeners
  setupEventListeners(taskScheduler, queueManager);

  // Register projects
  registerProjects(taskScheduler);

  // Start both components
  await queueManager.start();
  await taskScheduler.start();

  console.log('Task scheduler started. Press Ctrl+C to stop.');

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await taskScheduler.stop();
    await queueManager.stop();
    process.exit(0);
  });
}

function setupEventListeners(scheduler, queue) {
  // Scheduler events
  scheduler.on('polling-started', (projectId) => {
    console.log(`[Scheduler] Polling started for project: ${projectId}`);
  });

  scheduler.on('polling-completed', (projectId, stats) => {
    console.log(`[Scheduler] Polling completed for ${projectId}:`, stats);
  });

  scheduler.on('polling-error', (projectId, error, count) => {
    console.error(`[Scheduler] Polling error for ${projectId} (attempt ${count}):`, error.message);
  });

  scheduler.on('discovery-error', (projectId, error) => {
    console.error(`[Scheduler] Discovery error for ${projectId}:`, error.message);
  });

  // Queue events
  queue.on('task-added', (task) => {
    console.log(`[Queue] Task added: ${task.id} (${task.type})`);
  });

  queue.on('task-ready', (task) => {
    console.log(`[Queue] Task ready for processing: ${task.id}`);
    // In a real implementation, this would trigger task processing
    simulateTaskProcessing(queue, task);
  });

  queue.on('task-completed', (task) => {
    console.log(`[Queue] Task completed: ${task.id}`);
  });

  queue.on('task-failed', (task) => {
    console.error(`[Queue] Task failed: ${task.id}`, task.lastError);
  });
}

function registerProjects(scheduler) {
  // Register main PoppoBuilder project
  scheduler.registerProject({
    id: 'poppobuilder-main',
    owner: 'medamap',
    repo: 'PoppoBuilderSuite',
    pollingInterval: 5 * 60 * 1000, // 5 minutes
    labels: [], // Process all issues with task labels
    excludeLabels: ['wontfix', 'duplicate'],
    processComments: true,
    processPullRequests: true,
    priority: 75,
    weight: 2.0, // Higher weight for main project
    enabled: true
  });

  // Register a secondary project (example)
  scheduler.registerProject({
    id: 'poppobuilder-docs',
    owner: 'medamap',
    repo: 'PoppoBuilderDocs',
    pollingInterval: 10 * 60 * 1000, // 10 minutes
    labels: ['documentation'],
    excludeLabels: ['draft'],
    processComments: true,
    processPullRequests: false,
    priority: 50,
    weight: 1.0,
    enabled: true
  });

  console.log('Projects registered successfully');
}

async function simulateTaskProcessing(queue, task) {
  // Simulate processing delay
  const processingTime = Math.random() * 5000 + 1000; // 1-6 seconds
  
  setTimeout(async () => {
    // Simulate success/failure
    const success = Math.random() > 0.1; // 90% success rate
    
    if (success) {
      await queue.completeTask(task.id, {
        processedAt: new Date().toISOString(),
        duration: processingTime
      });
    } else {
      await queue.failTask(task.id, new Error('Simulated processing error'));
    }
  }, processingTime);
}

// Display statistics periodically
function displayStats(scheduler, queue) {
  setInterval(async () => {
    console.log('\n=== Statistics ===');
    
    const schedulerStats = scheduler.getStats();
    console.log('Scheduler:', schedulerStats);
    
    const queueStats = await queue.getStats();
    console.log('Queue:', queueStats);
    
    console.log('==================\n');
  }, 30000); // Every 30 seconds
}

// Run the example
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };