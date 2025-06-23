# Task Executor Documentation

The Task Executor is a core component of the PoppoBuilder Daemon that executes tasks in the context of their project with full isolation and resource management.

## Overview

The Task Executor provides:
- Project context isolation
- Multiple task type support
- Progress tracking and metrics
- Error handling and recovery
- Plugin system for custom tasks

## Architecture

```
┌─────────────────┐
│  Worker Pool    │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     Worker      │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Task Executor   │
├─────────────────┤
│ Project Context │
│ Task Handlers   │
│ Metrics         │
└─────────────────┘
```

## Task Structure

Every task must include:

```javascript
{
  id: 'unique-task-id',
  type: 'task-type',
  projectId: 'project-identifier',
  projectPath: '/absolute/path/to/project',
  
  // Optional
  projectConfig: {
    githubToken: 'custom-token',
    environment: {
      KEY: 'value'
    }
  },
  timeout: 60000,
  metadata: {}
}
```

## Built-in Task Types

### 1. Issue Processing (`process-issue`)

```javascript
{
  type: 'process-issue',
  issueNumber: 123,
  issue: {
    number: 123,
    title: 'Issue title',
    body: 'Issue description',
    labels: [{ name: 'bug' }]
  }
}
```

### 2. Comment Processing (`process-comment`)

```javascript
{
  type: 'process-comment',
  issueNumber: 123,
  comment: {
    id: 456,
    body: 'Comment text',
    user: { login: 'username' }
  }
}
```

### 3. Pull Request Processing (`process-pr`)

```javascript
{
  type: 'process-pr',
  prNumber: 789,
  action: 'opened' // opened, synchronize, closed
}
```

### 4. Claude CLI Execution (`claude-cli`)

```javascript
{
  type: 'claude-cli',
  instructions: 'Task instructions',
  taskContext: {
    // Additional context
  }
}
```

### 5. Custom Command (`custom-command`)

```javascript
{
  type: 'custom-command',
  command: 'npm',
  args: ['test'],
  options: {
    // spawn options
  }
}
```

## Project Context

Each task executes with:

1. **Working Directory**: Changed to project path
2. **Environment Variables**:
   - `POPPOBUILDER_PROJECT_ID`
   - `POPPOBUILDER_WORKER_ID`
   - Custom project environment
3. **Project Components**:
   - GitHub client with project credentials
   - Project-specific configuration
   - Isolated state management
   - Dedicated logger

## Custom Task Handlers

Register custom handlers:

```javascript
executor.registerTaskHandler('my-task', async (task, context) => {
  // Access project context
  const { projectPath, components, credentials } = context;
  
  // Perform task
  const result = await doSomething();
  
  // Return result
  return {
    success: true,
    data: result
  };
});
```

## Events

The executor emits several events:

### `task-completed`
```javascript
{
  task: { /* task object */ },
  result: { /* execution result */ },
  duration: 1234 // milliseconds
}
```

### `task-failed`
```javascript
{
  task: { /* task object */ },
  error: Error,
  duration: 1234
}
```

### `progress`
```javascript
{
  task: { /* task object */ },
  stage: 'checkout', // checkout, execute, respond
  message: 'Progress message'
}
```

### `task-cancelled`
Emitted when a task is cancelled during execution.

### `context-cleaned`
Emitted after project context is cleaned up.

## Metrics

Get execution metrics:

```javascript
const metrics = executor.getMetrics();
// {
//   overall: {
//     tasksExecuted: 10,
//     tasksSucceeded: 8,
//     tasksFailed: 2,
//     avgExecutionTime: 5432
//   },
//   projects: [{
//     projectId: 'project1',
//     tasksExecuted: 5,
//     // ...
//   }],
//   currentTask: { /* if executing */ }
// }
```

## Error Handling

The executor handles various error scenarios:

1. **Invalid Project Path**: Validates project directory exists
2. **Missing Credentials**: Falls back to environment variables
3. **Task Timeout**: Configurable timeout with automatic cancellation
4. **Component Failures**: Isolated error handling per component

## Best Practices

1. **Task Isolation**: Each task runs in complete isolation
2. **Resource Cleanup**: Automatic cleanup on completion/failure
3. **Progress Reporting**: Emit progress events for long tasks
4. **Error Context**: Include relevant context in errors
5. **Metrics Collection**: Monitor task performance

## Example Usage

```javascript
const TaskExecutor = require('./task-executor');

const executor = new TaskExecutor({
  workerId: 'worker-1',
  timeout: 300000 // 5 minutes
});

// Listen to events
executor.on('progress', ({ message }) => {
  console.log(`Progress: ${message}`);
});

// Execute task
const task = {
  id: 'issue-123',
  type: 'process-issue',
  projectId: 'my-project',
  projectPath: '/path/to/project',
  issueNumber: 123,
  issue: await github.getIssue(123)
};

try {
  const result = await executor.execute(task);
  console.log('Success:', result);
} catch (error) {
  console.error('Failed:', error);
}
```

## Integration with Worker Pool

The Task Executor is designed to work within the Worker Pool:

```javascript
// In worker.js
class PoppoBuilderWorker {
  async initialize() {
    this.taskExecutor = new TaskExecutor({
      workerId: this.workerId
    });
  }
  
  async executeTask(task) {
    return await this.taskExecutor.execute(task);
  }
}
```

## Security Considerations

1. **Credential Isolation**: Each project has separate credentials
2. **Environment Isolation**: Project environments don't leak
3. **Path Validation**: Prevents directory traversal
4. **Resource Limits**: Enforced through worker pool

## Future Enhancements

- [ ] Task dependencies and chaining
- [ ] Distributed execution across multiple machines
- [ ] Task result caching
- [ ] Advanced scheduling capabilities
- [ ] Real-time task monitoring dashboard