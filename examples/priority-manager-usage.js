/**
 * Priority Manager Usage Example
 * 
 * Shows how to integrate the TaskPriorityManager with PoppoBuilder
 */

const TaskPriorityManager = require('../lib/daemon/task-priority-manager');
const PriorityQueueIntegration = require('../lib/daemon/priority-queue-integration');

// Example configuration that could be added to config.json
const priorityConfig = {
  priority: {
    // Base priority levels
    priorityLevels: {
      urgent: 1000,
      critical: 800,
      dogfooding: 100,
      bug: 75,
      feature: 50,
      documentation: 40,
      misc: 25,
      low: 10
    },
    
    // Age-based escalation
    ageEscalation: {
      enabled: true,
      hourlyIncrease: 1.5,
      maxIncrease: 100,
      thresholdHours: 24 // Start escalating after 24 hours
    },
    
    // SLA configuration
    sla: {
      enabled: true,
      levels: {
        critical: { hours: 4, priorityBoost: 300 },
        high: { hours: 24, priorityBoost: 150 },
        normal: { hours: 72, priorityBoost: 75 },
        low: { hours: 168, priorityBoost: 25 }
      }
    },
    
    // Priority lanes
    lanes: {
      urgent: { min: 800, max: Infinity },
      high: { min: 100, max: 799 },
      normal: { min: 30, max: 99 },
      low: { min: 0, max: 29 }
    },
    
    // Starvation prevention
    starvationPrevention: {
      enabled: true,
      maxWaitTime: 172800000, // 48 hours
      priorityBoost: 100
    },
    
    // Preemption settings
    preemption: {
      enabled: true,
      minPriorityDifference: 300,
      allowedTaskTypes: ['urgent', 'critical'],
      saveState: true
    },
    
    // Dynamic adjustments
    dynamicAdjustment: {
      enabled: true,
      failureIncrease: 15,
      successDecrease: 5,
      maxAdjustment: 150
    }
  },
  
  maxConcurrent: 5
};

// Example integration with minimal-poppo.js
class PoppoBuilderWithPriority {
  constructor(config) {
    this.config = config;
    
    // Initialize priority queue integration
    this.priorityQueue = new PriorityQueueIntegration(null, priorityConfig);
    
    // Set up custom priority rules
    this._setupPriorityRules();
    
    // Set up event handlers
    this._setupEventHandlers();
  }
  
  /**
   * Set up custom priority rules
   */
  _setupPriorityRules() {
    // Rule 1: Boost priority for issues with many reactions
    this.priorityQueue.priorityManager.addRule('reaction-boost', (task, currentPriority) => {
      if (task.reactions && task.reactions['+1'] > 5) {
        return 50 + (task.reactions['+1'] * 5);
      }
      return 0;
    });
    
    // Rule 2: Boost priority for security-related issues
    this.priorityQueue.priorityManager.addRule('security-boost', (task, currentPriority) => {
      if (task.labels?.includes('security') || 
          task.title?.toLowerCase().includes('security') ||
          task.title?.toLowerCase().includes('vulnerability')) {
        return 200;
      }
      return 0;
    });
    
    // Rule 3: Deprioritize draft PRs
    this.priorityQueue.priorityManager.addRule('draft-deprioritize', (task, currentPriority) => {
      if (task.labels?.includes('draft') || task.isDraft) {
        return -50;
      }
      return 0;
    });
    
    // Rule 4: Time-based priority (business hours)
    this.priorityQueue.priorityManager.addRule('business-hours', (task, currentPriority) => {
      const hour = new Date().getHours();
      const isBusinessHours = hour >= 9 && hour < 17;
      const isWeekday = new Date().getDay() >= 1 && new Date().getDay() <= 5;
      
      if (isBusinessHours && isWeekday && !task.labels?.includes('urgent')) {
        return 25; // Boost during business hours
      }
      return 0;
    });
    
    // Rule 5: Repository-based priority
    this.priorityQueue.priorityManager.addRule('repo-priority', (task, currentPriority) => {
      const repoPriorities = {
        'medamap/PoppoBuilderSuite': 50,
        'medamap/critical-app': 100,
        'medamap/experimental': -25
      };
      
      return repoPriorities[task.repository] || 0;
    });
  }
  
  /**
   * Set up event handlers
   */
  _setupEventHandlers() {
    // Task lifecycle events
    this.priorityQueue.on('task-queued', ({ issueNumber, priority, lane }) => {
      console.log(`📥 Issue #${issueNumber} queued with priority ${priority} in ${lane} lane`);
    });
    
    this.priorityQueue.on('task-started', ({ issueNumber, priority, waitTime }) => {
      const waitMinutes = Math.round(waitTime / 60000);
      console.log(`🚀 Starting Issue #${issueNumber} (priority: ${priority}, waited: ${waitMinutes}m)`);
    });
    
    this.priorityQueue.on('task-completed', ({ taskId, duration }) => {
      const durationMinutes = Math.round(duration / 60000);
      console.log(`✅ Completed ${taskId} in ${durationMinutes} minutes`);
    });
    
    this.priorityQueue.on('task-preempted', ({ taskId }) => {
      console.log(`⚡ Preempted ${taskId} for higher priority task`);
    });
    
    // Analytics events
    this.priorityQueue.on('analytics', (analytics) => {
      if (analytics.escalations > 0) {
        console.log(`⏰ ${analytics.escalations} tasks escalated due to age`);
      }
      if (analytics.starvationPreventions > 0) {
        console.log(`🍽️ ${analytics.starvationPreventions} tasks rescued from starvation`);
      }
    });
    
    // Priority changes
    this.priorityQueue.on('priority-changed', ({ taskId, priority }) => {
      console.log(`📊 ${taskId} priority changed to ${priority}`);
    });
  }
  
  /**
   * Process an issue with priority management
   */
  async processIssue(issue) {
    // Add issue to priority queue
    const task = await this.priorityQueue.addTask(issue);
    
    console.log(`\n📋 Processing Issue #${issue.number}: ${issue.title}`);
    console.log(`   Priority: ${task.priority} (${task.lane} lane)`);
    console.log(`   Labels: ${task.labels.join(', ')}`);
    
    // The priority queue will handle scheduling
    // In a real implementation, this would integrate with IndependentProcessManager
  }
  
  /**
   * Handle task completion
   */
  async completeTask(issueNumber, result) {
    await this.priorityQueue.completeTask(`issue-${issueNumber}`, result);
  }
  
  /**
   * Handle task failure
   */
  async failTask(issueNumber, error) {
    await this.priorityQueue.failTask(`issue-${issueNumber}`, error);
  }
  
  /**
   * Get current status
   */
  getStatus() {
    const status = this.priorityQueue.getStatus();
    const report = this.priorityQueue.generateReport();
    
    return {
      queue: status,
      report: report,
      recommendations: report.recommendations
    };
  }
  
  /**
   * Update priority configuration
   */
  updatePriorityConfig(newConfig) {
    this.priorityQueue.updateConfig(newConfig);
  }
}

// Example usage
async function demonstratePrioritySystem() {
  console.log('🚀 PoppoBuilder Priority Management Demo\n');
  
  const poppoBuilder = new PoppoBuilderWithPriority(priorityConfig);
  
  // Simulate some issues
  const issues = [
    {
      number: 101,
      title: 'Critical security vulnerability',
      labels: [{ name: 'security' }, { name: 'urgent' }],
      created_at: new Date(Date.now() - 2 * 3600000).toISOString(),
      reactions: { '+1': 15 }
    },
    {
      number: 102,
      title: 'Add new feature',
      labels: [{ name: 'task:feature' }],
      created_at: new Date(Date.now() - 48 * 3600000).toISOString() // 2 days old
    },
    {
      number: 103,
      title: 'Update documentation',
      labels: [{ name: 'task:documentation' }, { name: 'draft' }],
      created_at: new Date().toISOString()
    },
    {
      number: 104,
      title: 'Dogfooding improvements',
      labels: [{ name: 'task:dogfooding' }],
      created_at: new Date(Date.now() - 12 * 3600000).toISOString()
    },
    {
      number: 105,
      title: 'Fix minor bug',
      labels: [{ name: 'task:bug' }, { name: 'priority:low' }],
      created_at: new Date(Date.now() - 72 * 3600000).toISOString() // 3 days old
    }
  ];
  
  // Process issues
  for (const issue of issues) {
    await poppoBuilder.processIssue(issue);
  }
  
  // Show status
  console.log('\n📊 Current Status:');
  const status = poppoBuilder.getStatus();
  console.log(`Queue state:`, JSON.stringify(status.queue.queueState, null, 2));
  
  // Simulate some completions
  setTimeout(() => {
    poppoBuilder.completeTask(101, { status: 'success' });
    poppoBuilder.failTask(102, new Error('API timeout'));
  }, 2000);
  
  // Show recommendations
  setTimeout(() => {
    console.log('\n💡 Recommendations:');
    status.report.recommendations.forEach(rec => {
      console.log(`- [${rec.severity}] ${rec.type}: ${rec.message}`);
    });
  }, 3000);
}

// Configuration snippet for config.json
const configSnippet = {
  "taskQueue": {
    "maxQueueSize": 100,
    "priorityManagement": {
      "enabled": true,
      "priorityLevels": {
        "urgent": 1000,
        "critical": 800,
        "dogfooding": 100,
        "bug": 75,
        "feature": 50,
        "documentation": 40,
        "misc": 25,
        "low": 10
      },
      "ageEscalation": {
        "enabled": true,
        "hourlyIncrease": 1.5,
        "maxIncrease": 100,
        "thresholdHours": 24
      },
      "sla": {
        "enabled": true,
        "levels": {
          "critical": { "hours": 4, "priorityBoost": 300 },
          "high": { "hours": 24, "priorityBoost": 150 },
          "normal": { "hours": 72, "priorityBoost": 75 },
          "low": { "hours": 168, "priorityBoost": 25 }
        }
      },
      "preemption": {
        "enabled": true,
        "minPriorityDifference": 300,
        "allowedTaskTypes": ["urgent", "critical"]
      },
      "starvationPrevention": {
        "enabled": true,
        "maxWaitTime": 172800000,
        "priorityBoost": 100
      }
    }
  }
};

console.log('\n📝 Add this configuration to config.json:');
console.log(JSON.stringify(configSnippet, null, 2));

// Run the demo
if (require.main === module) {
  demonstratePrioritySystem().catch(console.error);
}

module.exports = { PoppoBuilderWithPriority, priorityConfig };