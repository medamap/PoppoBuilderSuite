# Worker Assignment Strategies

This directory contains various worker assignment strategies for the PoppoBuilder daemon's worker pool. These strategies determine how tasks are assigned to available workers based on different criteria and algorithms.

## Available Strategies

### 1. Load Balancing Strategy (`load-balancing`)
Assigns tasks to the least loaded worker based on CPU, memory, and current task count.

**Features:**
- Monitors worker CPU and memory usage
- Tracks load history for trend analysis
- Configurable weight factors for different metrics
- Skips workers exceeding resource thresholds

**Options:**
```javascript
{
  cpuWeight: 0.4,           // Weight for CPU load (0-1)
  memoryWeight: 0.3,        // Weight for memory load (0-1)
  taskCountWeight: 0.3,     // Weight for task count (0-1)
  maxCpuThreshold: 80,      // Skip workers above this CPU %
  maxMemoryThreshold: 0.8   // Skip workers above this memory ratio
}
```

### 2. Round Robin Strategy (`round-robin`)
Simple circular assignment of tasks to workers.

**Features:**
- Maintains consistent order of workers
- Skips busy workers (configurable)
- Tracks rotation count and fairness
- Handles worker addition/removal gracefully

**Options:**
```javascript
{
  skipBusyWorkers: true,     // Skip workers with active tasks
  maxSkipAttempts: 10,       // Max attempts before giving up
  resetOnWorkerChange: true  // Reset rotation when workers change
}
```

### 3. Priority-Based Strategy (`priority-based`)
Assigns tasks based on priority levels and worker capabilities.

**Features:**
- Worker tier classification (premium/standard/basic)
- Priority-based assignment rules
- Performance tracking per worker
- Reserves high-performance workers for priority tasks

**Options:**
```javascript
{
  tiers: {
    premium: { minCpu: 4, minMemory: 8 * 1024 * 1024 * 1024 },
    standard: { minCpu: 2, minMemory: 4 * 1024 * 1024 * 1024 },
    basic: { minCpu: 1, minMemory: 2 * 1024 * 1024 * 1024 }
  },
  priorityLevels: {
    urgent: 10,
    high: 7,
    normal: 5,
    low: 3,
    background: 1
  },
  tierAssignment: {
    urgent: ['premium', 'standard'],
    high: ['premium', 'standard'],
    normal: ['standard', 'basic'],
    low: ['basic'],
    background: ['basic']
  }
}
```

### 4. Affinity Strategy (`affinity`)
Maintains task-worker affinity to improve cache utilization.

**Features:**
- Groups tasks by project/repository/type
- Sticky session support
- Configurable affinity duration
- Cache warmup consideration

**Options:**
```javascript
{
  affinityTypes: ['projectId', 'repository', 'type'],
  affinityDuration: 3600000,     // 1 hour
  maxWorkersPerGroup: 3,         // Max workers per affinity group
  loadThreshold: 80,             // Break affinity if worker load exceeds
  enableStickySessions: true,
  cacheWarmupBonus: 20          // Score bonus for warm cache
}
```

### 5. Resource-Aware Strategy (`resource-aware`)
Matches task resource requirements with worker capabilities.

**Features:**
- Task resource requirement estimation
- Resource usage prediction
- Overcommit support with limits
- Learning from historical usage

**Options:**
```javascript
{
  defaultRequirements: {
    cpu: 20,        // 20% CPU
    memory: 512,    // 512 MB
    timeout: 300000 // 5 minutes
  },
  taskProfiles: {
    'compile': { cpu: 80, memory: 2048, timeout: 600000 },
    'test': { cpu: 50, memory: 1024, timeout: 300000 },
    'build': { cpu: 90, memory: 4096, timeout: 900000 }
  },
  cpuSafetyMargin: 10,
  memorySafetyMargin: 0.1,
  allowOvercommit: true,
  maxOvercommit: 1.2,
  enablePrediction: true
}
```

## Strategy Manager

The `StrategyManager` class provides a unified interface for managing strategies:

```javascript
const StrategyManager = require('./lib/daemon/strategies');

const manager = new StrategyManager({
  defaultStrategy: 'round-robin',
  enableDynamicSwitching: true,
  switchingThreshold: 0.7,
  evaluationWindow: 300000
});

// Initialize with worker pool
manager.initialize(workerPool);

// Switch strategies at runtime
manager.setStrategy('load-balancing');

// Use composite strategy
manager.setStrategy('composite', {
  strategies: {
    'load-balancing': { cpuWeight: 0.5 },
    'affinity': { affinityTypes: ['projectId'] }
  },
  weights: {
    'load-balancing': 0.6,
    'affinity': 0.4
  }
});

// Select worker for task
const workerId = await manager.selectWorker(task, availableWorkers, workerInfoMap);

// Get metrics
const metrics = manager.getAllMetrics();
```

## Integration with Worker Pool

To integrate strategies with the worker pool, override the `getAvailableWorker` method:

```javascript
class StrategyAwareWorkerPool extends WorkerPool {
  constructor(options) {
    super(options);
    this.strategyManager = new StrategyManager(options.strategyOptions);
  }
  
  async getAvailableWorker(task) {
    const availableWorkers = this.availableWorkers.filter(id => {
      const worker = this.workers.get(id);
      return worker && worker.state === 'available';
    });
    
    return await this.strategyManager.selectWorker(
      task,
      availableWorkers,
      this.workers
    );
  }
}
```

## Creating Custom Strategies

To create a custom strategy, extend the `BaseStrategy` class:

```javascript
const BaseStrategy = require('./base-strategy');

class CustomStrategy extends BaseStrategy {
  constructor(options) {
    super({
      name: 'custom',
      description: 'My custom strategy',
      ...options
    });
  }
  
  async doSelectWorker(task, availableWorkers, workerInfoMap) {
    // Your selection logic here
    return selectedWorkerId;
  }
  
  onTaskCompleted(workerId, task, result) {
    // Update strategy state based on task completion
  }
}

// Register the strategy
StrategyManager.registerStrategy('custom', CustomStrategy);
```

## Metrics and Monitoring

All strategies provide metrics through the `getMetrics()` method:

```javascript
{
  totalAssignments: 100,
  successfulAssignments: 95,
  failedAssignments: 5,
  avgAssignmentTime: 2.5,
  successRate: 0.95,
  strategySpecificMetrics: {
    // Strategy-specific metrics
  }
}
```

## Best Practices

1. **Choose the right strategy:**
   - Use `round-robin` for simple, fair distribution
   - Use `load-balancing` for resource-intensive tasks
   - Use `priority-based` when task priorities vary significantly
   - Use `affinity` for projects with shared dependencies
   - Use `resource-aware` when tasks have specific resource needs

2. **Monitor performance:**
   - Track assignment success rates
   - Monitor worker utilization
   - Watch for strategy-specific metrics

3. **Dynamic switching:**
   - Enable dynamic switching for adaptive behavior
   - Set appropriate switching thresholds
   - Monitor switching frequency

4. **Composite strategies:**
   - Combine strategies for complex scenarios
   - Adjust weights based on workload characteristics
   - Test thoroughly before production use