# Process Pool Manager Architecture

## Overview

The Process Pool Manager is a core component of PoppoBuilder Suite that provides efficient task execution through a pool of worker processes. It implements resource sharing, project-based limits, and automatic scaling to optimize performance across multiple projects.

## Key Features

### 1. Worker Process Management
- **Worker Threads**: Uses Node.js `worker_threads` for isolated process execution
- **Lifecycle Management**: Automatic creation, monitoring, recycling, and termination
- **Health Monitoring**: Heartbeat checks and automatic recovery from failures
- **Resource Recycling**: Workers are recycled after processing a configurable number of tasks

### 2. Task Queue System
- **Priority-based Scheduling**: Tasks are queued and processed based on priority (0-10)
- **Project Limits**: Per-project process limits to prevent resource monopolization
- **Retry Logic**: Automatic retry with exponential backoff for failed tasks
- **Timeout Handling**: Configurable task timeouts with automatic cancellation

### 3. Auto-scaling
- **Dynamic Scaling**: Automatically scales workers based on load
- **Configurable Thresholds**: Scale up at 80% load, scale down at 20% load
- **Resource Optimization**: Maintains optimal worker count for current workload
- **Smooth Scaling**: Gradual scaling to avoid resource spikes

### 4. Task Types
The Process Pool supports multiple task types:
- `execute-code`: Direct JavaScript code execution
- `execute-function`: Function execution with arguments
- `execute-module`: Module loading and execution
- `http-request`: HTTP/HTTPS requests
- `shell-command`: Shell command execution

## Architecture

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                      Daemon Manager                          │
├─────────────────────────────────────────────────────────────┤
│                      Daemon Worker                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Process Pool Manager                     │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │   │
│  │  │ Task Queue  │  │   Metrics   │  │  Project   │  │   │
│  │  │ (Priority)  │  │  Collector  │  │   Limits   │  │   │
│  │  └─────────────┘  └─────────────┘  └────────────┘  │   │
│  │                                                      │   │
│  │  ┌─────────────────────────────────────────────┐   │   │
│  │  │           Worker Thread Pool                 │   │   │
│  │  │  ┌────────┐  ┌────────┐  ┌────────┐        │   │   │
│  │  │  │Worker 1│  │Worker 2│  │Worker N│  ...   │   │   │
│  │  │  └────────┘  └────────┘  └────────┘        │   │   │
│  │  └─────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### Class Structure

#### ProcessPoolManager
Main class that manages the worker pool.

```javascript
class ProcessPoolManager extends EventEmitter {
  constructor(options = {}) {
    // Configuration options
    this.options = {
      minWorkers: 1,
      maxWorkers: os.cpus().length,
      maxTasksPerWorker: 100,
      workerIdleTimeout: 60000,
      autoScale: true,
      scaleUpThreshold: 0.8,
      scaleDownThreshold: 0.2
    };
    
    // Internal state
    this.workers = new Map();        // workerId -> workerInfo
    this.taskQueue = [];             // Priority queue
    this.projectLimits = new Map();  // projectId -> limit
    this.projectUsage = new Map();   // projectId -> current usage
  }
}
```

#### WorkerProcess
Individual worker thread implementation.

```javascript
class WorkerProcess {
  constructor() {
    this.taskHandlers = new Map();
    this.isReady = false;
    this.currentTask = null;
  }
  
  // Register handlers for different task types
  registerTaskHandler(type, handler) { ... }
  
  // Execute tasks based on type
  async executeTask(task) { ... }
}
```

## Integration with Daemon

The Process Pool Manager integrates with the daemon architecture:

1. **Daemon Worker** creates and manages a ProcessPoolManager instance
2. **Master Process** communicates with workers via IPC
3. **API Server** exposes endpoints for pool management
4. **CLI** displays pool status and statistics

### API Endpoints

- `GET /api/process-pool/stats` - Get pool statistics
- `POST /api/process-pool/project-limit` - Set project process limit
- `GET /api/process-pool/project-usage` - Get project usage

## Configuration

Process pool configuration in global config:

```json
{
  "daemon": {
    "worker": {
      "minProcesses": 1,
      "maxProcesses": 4,
      "autoScale": true,
      "scaleUpThreshold": 0.8,
      "scaleDownThreshold": 0.2,
      "maxTasksPerWorker": 100,
      "workerIdleTimeout": 60000
    }
  }
}
```

## Usage Example

```javascript
// Create process pool
const pool = new ProcessPoolManager({
  minWorkers: 2,
  maxWorkers: 4,
  autoScale: true
});

// Initialize
await pool.initialize();

// Set project limit
pool.setProjectLimit('my-project', 5);

// Submit task
const result = await pool.submitTask({
  type: 'execute-code',
  code: 'return "Hello from worker";'
}, {
  projectId: 'my-project',
  priority: 5,
  timeout: 30000
});

// Get statistics
const stats = pool.getStats();
console.log(`Workers: ${stats.workers.total}`);
console.log(`Load: ${stats.load * 100}%`);

// Shutdown
await pool.shutdown();
```

## Events

The ProcessPoolManager emits various events:

- `worker-started`: Worker process started
- `worker-terminated`: Worker process terminated
- `task-complete`: Task completed successfully
- `task-error`: Task failed with error
- `scaled-up`: Pool scaled up
- `scaled-down`: Pool scaled down
- `queue-full`: Task queue is full
- `worker-error`: Worker process error

## Performance Considerations

1. **Worker Recycling**: Workers are recycled after N tasks to prevent memory leaks
2. **Task Timeouts**: All tasks have configurable timeouts
3. **Resource Limits**: Project-based limits prevent resource exhaustion
4. **Load Balancing**: Tasks are distributed evenly across available workers
5. **Queue Management**: Priority queue ensures important tasks are processed first

## Security

1. **Process Isolation**: Each worker runs in isolated context
2. **Resource Limits**: CPU and memory limits per worker
3. **Code Sandboxing**: Code execution tasks run in VM context
4. **Command Validation**: Shell commands are validated before execution

## Future Enhancements

1. **Distributed Workers**: Support for workers on multiple machines
2. **GPU Support**: GPU-accelerated task execution
3. **Custom Task Types**: Plugin system for custom task handlers
4. **Advanced Metrics**: Detailed performance analytics
5. **Resource Quotas**: CPU/Memory quotas per project