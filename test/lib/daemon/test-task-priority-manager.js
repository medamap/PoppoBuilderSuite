/**
 * Test for Task Priority Manager
 * 
 * Demonstrates the features and functionality of the priority management system
 */

const TaskPriorityManager = require('../../../lib/daemon/task-priority-manager');

// Create priority manager with custom configuration
const priorityManager = new TaskPriorityManager({
  priorityLevels: {
    urgent: 1000,
    dogfooding: 100,
    high: 75,
    normal: 50,
    low: 25
  },
  ageEscalation: {
    enabled: true,
    hourlyIncrease: 2,
    maxIncrease: 100,
    thresholdHours: 12
  },
  sla: {
    enabled: true,
    levels: {
      critical: { hours: 4, priorityBoost: 200 },
      high: { hours: 24, priorityBoost: 100 },
      normal: { hours: 72, priorityBoost: 50 }
    }
  },
  preemption: {
    enabled: true,
    minPriorityDifference: 200,
    allowedTaskTypes: ['urgent', 'critical']
  },
  starvationPrevention: {
    enabled: true,
    maxWaitTime: 3600000, // 1 hour for testing
    priorityBoost: 100
  }
});

// Set up event listeners
priorityManager.on('task-added', (data) => {
  console.log(`📥 Task added: ${data.taskId} with priority ${data.priority} in ${data.lane} lane`);
});

priorityManager.on('priority-updated', (data) => {
  console.log(`📊 Priority updated: ${data.taskId} from ${data.oldPriority} to ${data.newPriority}`);
});

priorityManager.on('task-preempted', (data) => {
  console.log(`⚡ Task preempted: ${data.taskId}`);
});

priorityManager.on('age-escalation', (data) => {
  console.log(`⏰ Age escalation applied to ${data.count} tasks`);
});

priorityManager.on('starvation-prevented', (data) => {
  console.log(`🍽️ Starvation prevention applied to ${data.count} tasks`);
});

// Add custom priority rule
priorityManager.addRule('weekend-deprioritize', (task, currentPriority) => {
  const day = new Date().getDay();
  if (day === 0 || day === 6) { // Sunday or Saturday
    return -25; // Reduce priority on weekends
  }
  return 0;
});

priorityManager.addRule('user-mentioned', (task, currentPriority) => {
  if (task.mentions && task.mentions.length > 0) {
    return 50 * task.mentions.length; // 50 points per mention
  }
  return 0;
});

console.log('\n🚀 Task Priority Manager Test\n');

// Test Case 1: Basic task addition with different priorities
console.log('📋 Test Case 1: Adding tasks with different priorities\n');

const tasks = [
  {
    id: 'task-1',
    title: 'Fix critical bug',
    labels: ['task:bug', 'urgent'],
    createdAt: new Date(Date.now() - 2 * 3600000).toISOString() // 2 hours ago
  },
  {
    id: 'task-2',
    title: 'Add new feature',
    labels: ['task:feature', 'priority:high'],
    createdAt: new Date(Date.now() - 24 * 3600000).toISOString() // 1 day ago
  },
  {
    id: 'task-3',
    title: 'Update documentation',
    labels: ['task:docs', 'priority:low'],
    createdAt: new Date().toISOString()
  },
  {
    id: 'task-4',
    title: 'Dogfooding improvements',
    labels: ['task:dogfooding'],
    createdAt: new Date(Date.now() - 12 * 3600000).toISOString() // 12 hours ago
  },
  {
    id: 'task-5',
    title: 'Security audit',
    labels: ['task:security', 'critical'],
    slaLevel: 'critical',
    createdAt: new Date(Date.now() - 5 * 3600000).toISOString(), // 5 hours ago (past SLA)
    mentions: ['@admin', '@security-team']
  }
];

// Add tasks
tasks.forEach(task => {
  priorityManager.addTask(task.id, task);
});

// Test Case 2: Get next task
console.log('\n📋 Test Case 2: Getting next tasks in priority order\n');

for (let i = 0; i < 3; i++) {
  const nextTask = priorityManager.getNextTask();
  if (nextTask) {
    console.log(`Next task: ${nextTask.id} - ${nextTask.title} (Priority: ${nextTask.priority})`);
  }
}

// Test Case 3: Dynamic priority update
console.log('\n📋 Test Case 3: Dynamic priority updates\n');

priorityManager.updatePriority('task-3', 100); // Boost documentation task

// Test Case 4: Preemption check
console.log('\n📋 Test Case 4: Preemption testing\n');

const urgentTask = {
  id: 'task-urgent',
  title: 'Server down - urgent fix',
  labels: ['task:urgent', 'critical'],
  createdAt: new Date().toISOString()
};

const urgentTaskData = priorityManager.addTask(urgentTask.id, urgentTask);
const canPreempt = priorityManager.canPreempt(urgentTaskData, ['task-2', 'task-3']);
console.log(`Can urgent task preempt running tasks? ${canPreempt}`);

if (canPreempt) {
  priorityManager.preemptTask('task-2', { progress: 50, lastStep: 'analyzing' });
}

// Test Case 5: Queue state
console.log('\n📋 Test Case 5: Current queue state\n');

const queueState = priorityManager.getQueueState();
console.log('Queue State:', JSON.stringify(queueState, null, 2));

// Test Case 6: Generate report
console.log('\n📋 Test Case 6: Priority management report\n');

const report = priorityManager.generateReport();
console.log('Priority Report:');
console.log('- Total tasks:', report.summary.totalTasks);
console.log('- Preempted tasks:', report.summary.preemptedTasks);
console.log('- Distribution:', report.distribution);
console.log('- Average wait times:', report.averageWaitTime);
console.log('- Recommendations:', report.recommendations);

// Test Case 7: Simulate aging and starvation
console.log('\n📋 Test Case 7: Simulating task aging\n');

// Add an old low-priority task
const oldTask = {
  id: 'task-old',
  title: 'Old low priority task',
  labels: ['task:misc'],
  createdAt: new Date(Date.now() - 48 * 3600000).toISOString() // 2 days old
};

priorityManager.addTask(oldTask.id, oldTask);

// Manually trigger age escalation check
priorityManager._checkAgeEscalation();

// Test Case 8: Task completion
console.log('\n📋 Test Case 8: Completing tasks\n');

priorityManager.removeTask('task-1');
priorityManager.removeTask('task-urgent');

console.log('Tasks completed and removed from queue');

// Final state
console.log('\n📊 Final Analytics:');
console.log(priorityManager.analytics);

// Cleanup
console.log('\n🧹 Cleaning up...');
priorityManager.destroy();
console.log('✅ Test completed!');