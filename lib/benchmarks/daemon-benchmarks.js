/**
 * Daemon-Specific Benchmarks
 * 
 * Performance benchmarks for PoppoBuilder daemon components
 */

const BenchmarkRunner = require('./benchmark-runner');
const PoppoDaemon = require('../daemon/poppo-daemon');
const { IPCClient } = require('../daemon/ipc');
const { getInstance: getGlobalConfig } = require('../core/global-config-manager');
const path = require('path');
const os = require('os');
const fs = require('fs').promises;

class DaemonBenchmarks {
  constructor(options = {}) {
    this.options = {
      testConfigDir: path.join(os.tmpdir(), `poppo-bench-${Date.now()}`),
      daemonPort: 3303,
      iterations: 100,
      ...options
    };
    
    this.daemon = null;
    this.runner = new BenchmarkRunner({
      iterations: this.options.iterations,
      outputDir: './benchmark-results/daemon',
      ...options
    });
  }

  /**
   * Set up test environment
   */
  async setup() {
    // Create test configuration directory
    await fs.mkdir(this.options.testConfigDir, { recursive: true });
    process.env.POPPO_CONFIG_DIR = this.options.testConfigDir;

    // Initialize test configuration
    const globalConfig = getGlobalConfig();
    await globalConfig.initialize();
    
    const testConfig = {
      version: '3.0.0',
      daemon: {
        enabled: true,
        port: this.options.daemonPort,
        host: '127.0.0.1',
        maxProcesses: 8,
        schedulingStrategy: 'weighted-round-robin'
      },
      taskQueue: {
        maxQueueSize: 10000,
        priorityManagement: {
          enabled: true,
          preemption: { enabled: true }
        }
      },
      workerPool: {
        minWorkers: 2,
        maxWorkers: 16
      }
    };

    await globalConfig.updateConfig(testConfig);

    // Start daemon
    this.daemon = new PoppoDaemon({
      port: this.options.daemonPort,
      maxProcesses: 8
    });

    await this.daemon.start();
    await new Promise(resolve => this.daemon.on('started', resolve));

    console.log(`✅ Test daemon started on port ${this.options.daemonPort}`);
  }

  /**
   * Clean up test environment
   */
  async cleanup() {
    if (this.daemon) {
      await this.daemon.shutdown(0);
    }

    try {
      await fs.rmdir(this.options.testConfigDir, { recursive: true });
    } catch (error) {
      // Ignore cleanup errors
    }

    delete process.env.POPPO_CONFIG_DIR;
  }

  /**
   * Register all daemon benchmarks
   */
  registerBenchmarks() {
    // IPC Connection benchmarks
    this.runner.registerBenchmark(
      'ipc-connection-establishment',
      this.benchmarkIPCConnection.bind(this),
      { iterations: 50, timeout: 5000 }
    );

    this.runner.registerBenchmark(
      'ipc-ping-pong',
      this.benchmarkIPCPingPong.bind(this),
      { iterations: 1000, timeout: 10000 }
    );

    this.runner.registerBenchmark(
      'ipc-concurrent-connections',
      this.benchmarkIPCConcurrentConnections.bind(this),
      { iterations: 20, timeout: 15000 }
    );

    // Task Queue benchmarks
    this.runner.registerBenchmark(
      'task-queue-single',
      this.benchmarkTaskQueueSingle.bind(this),
      { iterations: 500, timeout: 10000 }
    );

    this.runner.registerBenchmark(
      'task-queue-batch',
      this.benchmarkTaskQueueBatch.bind(this),
      { iterations: 50, timeout: 15000 }
    );

    this.runner.registerBenchmark(
      'task-priority-queue',
      this.benchmarkTaskPriorityQueue.bind(this),
      { iterations: 100, timeout: 10000 }
    );

    // Worker Pool benchmarks
    this.runner.registerBenchmark(
      'worker-scaling',
      this.benchmarkWorkerScaling.bind(this),
      { iterations: 20, timeout: 10000 }
    );

    this.runner.registerBenchmark(
      'task-processing',
      this.benchmarkTaskProcessing.bind(this),
      { iterations: 50, timeout: 20000 }
    );

    // Status and monitoring benchmarks
    this.runner.registerBenchmark(
      'status-queries',
      this.benchmarkStatusQueries.bind(this),
      { iterations: 200, timeout: 5000 }
    );

    this.runner.registerBenchmark(
      'project-management',
      this.benchmarkProjectManagement.bind(this),
      { iterations: 50, timeout: 10000 }
    );

    // High-load benchmarks
    this.runner.registerBenchmark(
      'sustained-load',
      this.benchmarkSustainedLoad.bind(this),
      { iterations: 10, timeout: 30000 }
    );

    this.runner.registerBenchmark(
      'memory-stress',
      this.benchmarkMemoryStress.bind(this),
      { iterations: 20, timeout: 20000 }
    );
  }

  /**
   * IPC Connection establishment benchmark
   */
  async benchmarkIPCConnection() {
    const client = new IPCClient();
    await client.connect();
    await client.disconnect();
    
    return { operation: 'ipc-connection' };
  }

  /**
   * IPC Ping-pong benchmark
   */
  async benchmarkIPCPingPong() {
    const client = new IPCClient();
    await client.connect();
    
    const response = await client.sendCommand('ping');
    await client.disconnect();
    
    return { operation: 'ping-pong', response };
  }

  /**
   * IPC Concurrent connections benchmark
   */
  async benchmarkIPCConcurrentConnections() {
    const connectionCount = 10;
    const clients = [];
    
    // Create connections
    for (let i = 0; i < connectionCount; i++) {
      const client = new IPCClient();
      await client.connect();
      clients.push(client);
    }
    
    // Send concurrent commands
    const promises = clients.map(client => client.sendCommand('ping'));
    const responses = await Promise.all(promises);
    
    // Cleanup
    await Promise.all(clients.map(client => client.disconnect()));
    
    return { 
      operation: 'concurrent-connections', 
      connections: connectionCount,
      responses: responses.length 
    };
  }

  /**
   * Single task queue benchmark
   */
  async benchmarkTaskQueueSingle() {
    const client = new IPCClient();
    await client.connect();
    
    const task = {
      id: `bench-${Date.now()}-${Math.random()}`,
      type: 'benchmark-task',
      priority: Math.floor(Math.random() * 100),
      data: { test: true }
    };
    
    const response = await client.sendCommand('queue-task', task);
    await client.disconnect();
    
    return { operation: 'queue-single-task', taskId: response.taskId };
  }

  /**
   * Batch task queue benchmark
   */
  async benchmarkTaskQueueBatch() {
    const client = new IPCClient();
    await client.connect();
    
    const batchSize = 50;
    const promises = [];
    
    for (let i = 0; i < batchSize; i++) {
      const task = {
        id: `batch-${Date.now()}-${i}`,
        type: 'benchmark-batch-task',
        priority: Math.floor(Math.random() * 100),
        data: { batch: true, index: i }
      };
      
      promises.push(client.sendCommand('queue-task', task));
    }
    
    const responses = await Promise.all(promises);
    await client.disconnect();
    
    return { 
      operation: 'queue-batch-tasks', 
      batchSize,
      queued: responses.length 
    };
  }

  /**
   * Task priority queue benchmark
   */
  async benchmarkTaskPriorityQueue() {
    const client = new IPCClient();
    await client.connect();
    
    const priorities = [10, 50, 90, 25, 75];
    const tasks = priorities.map((priority, index) => ({
      id: `priority-${Date.now()}-${index}`,
      type: 'priority-test',
      priority,
      data: { priority, index }
    }));
    
    // Queue all tasks
    const queuePromises = tasks.map(task => 
      client.sendCommand('queue-task', task)
    );
    await Promise.all(queuePromises);
    
    // Get tasks in priority order
    const retrievedTasks = [];
    for (let i = 0; i < tasks.length; i++) {
      const response = await client.sendCommand('get-next-task');
      if (response.task) {
        retrievedTasks.push(response.task);
      }
    }
    
    await client.disconnect();
    
    return { 
      operation: 'priority-queue-test', 
      queued: tasks.length,
      retrieved: retrievedTasks.length,
      priorityOrder: retrievedTasks.map(t => t.priority)
    };
  }

  /**
   * Worker scaling benchmark
   */
  async benchmarkWorkerScaling() {
    const client = new IPCClient();
    await client.connect();
    
    const targetWorkers = [2, 4, 8, 4, 2];
    const scalingResults = [];
    
    for (const target of targetWorkers) {
      const scaleStart = Date.now();
      await client.sendCommand('scale-workers', { targetWorkers: target });
      const scaleTime = Date.now() - scaleStart;
      
      const status = await client.sendCommand('status');
      scalingResults.push({
        target,
        actual: status.workers.totalWorkers,
        scaleTime
      });
    }
    
    await client.disconnect();
    
    return { 
      operation: 'worker-scaling', 
      results: scalingResults 
    };
  }

  /**
   * Task processing benchmark
   */
  async benchmarkTaskProcessing() {
    const client = new IPCClient();
    await client.connect();
    
    const taskCount = 20;
    const tasks = [];
    
    // Queue tasks
    for (let i = 0; i < taskCount; i++) {
      const task = {
        id: `process-${Date.now()}-${i}`,
        type: 'processing-test',
        data: { 
          workload: 'light', 
          duration: 100 + Math.random() * 200,
          index: i 
        }
      };
      
      await client.sendCommand('queue-task', task);
      tasks.push(task);
    }
    
    // Wait for processing
    let processed = 0;
    const startWait = Date.now();
    
    while (processed < taskCount && Date.now() - startWait < 15000) {
      const status = await client.sendCommand('get-queue-status');
      processed = status.completedTasks || 0;
      
      if (processed < taskCount) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    const processingTime = Date.now() - startWait;
    await client.disconnect();
    
    return { 
      operation: 'task-processing', 
      tasksQueued: taskCount,
      tasksProcessed: processed,
      processingTime,
      throughput: processed / (processingTime / 1000)
    };
  }

  /**
   * Status queries benchmark
   */
  async benchmarkStatusQueries() {
    const client = new IPCClient();
    await client.connect();
    
    const queryTypes = ['status', 'get-queue-status', 'get-worker-status'];
    const queryType = queryTypes[Math.floor(Math.random() * queryTypes.length)];
    
    const response = await client.sendCommand(queryType);
    await client.disconnect();
    
    return { 
      operation: 'status-query', 
      queryType,
      hasResponse: !!response 
    };
  }

  /**
   * Project management benchmark
   */
  async benchmarkProjectManagement() {
    const client = new IPCClient();
    await client.connect();
    
    const projectId = `bench-project-${Date.now()}`;
    const project = {
      id: projectId,
      name: `Benchmark Project ${projectId}`,
      path: '/tmp/benchmark-project',
      config: {
        priority: 50,
        weight: 1.0,
        enabled: true
      }
    };
    
    // Register project
    await client.sendCommand('register-project', project);
    
    // Get project info
    await client.sendCommand('get-project-info', { projectId });
    
    // Update project
    await client.sendCommand('update-project', { 
      projectId, 
      config: { priority: 75 } 
    });
    
    // Unregister project
    await client.sendCommand('unregister-project', { projectId });
    
    await client.disconnect();
    
    return { operation: 'project-management', projectId };
  }

  /**
   * Sustained load benchmark
   */
  async benchmarkSustainedLoad() {
    const client = new IPCClient();
    await client.connect();
    
    const duration = 5000; // 5 seconds
    const startTime = Date.now();
    let operations = 0;
    
    while (Date.now() - startTime < duration) {
      // Mix of operations
      const operation = Math.random();
      
      if (operation < 0.6) {
        // Queue task (60%)
        const task = {
          id: `sustained-${operations}`,
          type: 'sustained-load-test',
          data: { timestamp: Date.now() }
        };
        await client.sendCommand('queue-task', task);
      } else if (operation < 0.9) {
        // Status query (30%)
        await client.sendCommand('status');
      } else {
        // Queue status (10%)
        await client.sendCommand('get-queue-status');
      }
      
      operations++;
    }
    
    const actualDuration = Date.now() - startTime;
    await client.disconnect();
    
    return { 
      operation: 'sustained-load', 
      operations,
      duration: actualDuration,
      opsPerSecond: operations / (actualDuration / 1000)
    };
  }

  /**
   * Memory stress benchmark
   */
  async benchmarkMemoryStress() {
    const client = new IPCClient();
    await client.connect();
    
    const largePayloadSize = 100000; // 100KB
    const taskCount = 50;
    
    for (let i = 0; i < taskCount; i++) {
      const task = {
        id: `memory-stress-${i}`,
        type: 'memory-stress-test',
        data: {
          payload: 'x'.repeat(largePayloadSize),
          index: i
        }
      };
      
      await client.sendCommand('queue-task', task);
    }
    
    await client.disconnect();
    
    return { 
      operation: 'memory-stress', 
      tasksQueued: taskCount,
      payloadSize: largePayloadSize 
    };
  }

  /**
   * Run all benchmarks
   */
  async run() {
    try {
      await this.setup();
      this.registerBenchmarks();
      
      console.log('🔥 Starting PoppoBuilder Daemon Benchmarks');
      console.log(`   Test Config Dir: ${this.options.testConfigDir}`);
      console.log(`   Daemon Port: ${this.options.daemonPort}`);
      console.log(`   Iterations: ${this.options.iterations}\n`);
      
      const results = await this.runner.runAll();
      
      console.log('\n🎉 Benchmark suite completed successfully!');
      return results;
      
    } finally {
      await this.cleanup();
    }
  }
}

module.exports = DaemonBenchmarks;

// CLI runner
if (require.main === module) {
  const benchmarks = new DaemonBenchmarks({
    iterations: process.argv.includes('--quick') ? 10 : 100
  });
  
  benchmarks.run().catch(error => {
    console.error('Benchmark failed:', error);
    process.exit(1);
  });
}