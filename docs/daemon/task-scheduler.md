# Task Scheduler

The Task Scheduler is responsible for polling registered GitHub projects and discovering tasks that need to be processed by PoppoBuilder Suite.

## Overview

The scheduler provides:
- Automated polling of GitHub repositories for new issues and comments
- Configurable polling intervals per project
- Task discovery based on labels and content
- Priority calculation for tasks
- Rate limit aware polling
- Error handling with exponential backoff
- Integration with the queue manager

## Features

### 1. Project Polling
- Polls registered projects at configurable intervals
- Supports immediate polling on demand
- Respects GitHub API rate limits
- Implements backoff strategy on errors

### 2. Task Discovery
- Discovers new issues with appropriate labels
- Detects comments requiring action
- Optional pull request processing
- Filters based on project configuration

### 3. Task Creation
- Creates standardized task objects
- Calculates priority based on labels and age
- Extracts deadlines from issue content
- Includes project metadata

### 4. Scheduling Logic
- Efficient batch processing
- Staggered polling to avoid rate limit bursts
- Priority-based task ordering
- Support for weighted projects

## Usage

### Basic Setup

```javascript
const TaskScheduler = require('./lib/daemon/task-scheduler');
const QueueManager = require('./lib/daemon/queue-manager');

// Create instances
const queueManager = new QueueManager();
const scheduler = new TaskScheduler({
  defaultPollingInterval: 5 * 60 * 1000, // 5 minutes
  minPollingInterval: 60 * 1000 // 1 minute
});

// Link scheduler to queue
scheduler.setQueueManager(queueManager);

// Start both
await queueManager.start();
await scheduler.start();
```

### Registering Projects

```javascript
scheduler.registerProject({
  id: 'my-project',
  owner: 'github-owner',
  repo: 'repository-name',
  pollingInterval: 5 * 60 * 1000, // 5 minutes
  labels: [], // Empty = process all task labels
  excludeLabels: ['wontfix', 'duplicate'],
  processComments: true,
  processPullRequests: false,
  priority: 75,
  weight: 1.0,
  enabled: true
});
```

### Event Handling

```javascript
scheduler.on('polling-started', (projectId) => {
  console.log(`Polling ${projectId}`);
});

scheduler.on('polling-completed', (projectId, stats) => {
  console.log(`Found ${stats.discovered} tasks`);
});

scheduler.on('polling-error', (projectId, error, attemptCount) => {
  console.error(`Error polling ${projectId}:`, error);
});
```

## Configuration

### Scheduler Options

```javascript
{
  defaultPollingInterval: 5 * 60 * 1000,  // Default: 5 minutes
  minPollingInterval: 60 * 1000,          // Minimum: 1 minute
  maxPollingInterval: 30 * 60 * 1000,     // Maximum: 30 minutes
  batchSize: 10,                          // Tasks per batch
  retryBackoff: 1.5,                      // Exponential backoff multiplier
  maxBackoff: 10 * 60 * 1000,            // Max backoff: 10 minutes
  rateLimitBuffer: 0.1                    // Keep 10% rate limit buffer
}
```

### Project Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `id` | string | required | Unique project identifier |
| `owner` | string | required | GitHub repository owner |
| `repo` | string | required | GitHub repository name |
| `pollingInterval` | number | scheduler default | Polling interval in ms |
| `labels` | string[] | [] | Labels to include (empty = all) |
| `excludeLabels` | string[] | [] | Labels to exclude |
| `processComments` | boolean | true | Process issue comments |
| `processPullRequests` | boolean | false | Process PRs |
| `priority` | number | 50 | Base priority (0-100) |
| `weight` | number | 1.0 | Queue weight for fair scheduling |
| `enabled` | boolean | true | Enable/disable polling |

## Task Types

The scheduler recognizes these task types:

### Issue Processing
Labels that trigger issue processing:
- `task:misc`
- `task:dogfooding`
- `task:quality`
- `task:docs`
- `task:feature`
- `task:bug`

### Comment Processing
Comments are processed when they contain action keywords:
- "please"
- "can you"
- "could you"
- "implement"
- "fix"
- "update"
- "@poppobuilder"

### Pull Request Processing
PRs are processed when:
- Not in draft state
- Updated within last 3 days
- `processPullRequests` is enabled

## Priority Calculation

Priority is calculated based on:

1. **Label Priority**:
   - `priority:urgent`: 100
   - `priority:high`: 75
   - `priority:medium`: 50
   - `priority:low`: 25
   - `task:dogfooding`: 90
   - `task:bug`: 80
   - `task:feature`: 70

2. **Age Boost**: Issues older than 7 days get +10 priority

3. **Comment Priority**: Comments with urgent keywords get priority 80

4. **PR Priority**: Small PRs (<50 changes) get +10 priority

## API Reference

### Methods

#### `registerProject(config)`
Register a new project for polling.

#### `unregisterProject(projectId)`
Remove a project from polling.

#### `setProjectEnabled(projectId, enabled)`
Enable or disable polling for a project.

#### `pollProjectNow(projectId)`
Trigger immediate polling for a project.

#### `updateProject(projectId, updates)`
Update project configuration.

#### `pauseAll()`
Pause polling for all projects.

#### `resumeAll()`
Resume polling for all projects.

#### `getStats()`
Get scheduler statistics.

### Events

- `started`: Scheduler started
- `stopped`: Scheduler stopped
- `project-registered`: New project registered
- `project-unregistered`: Project removed
- `project-updated`: Project config updated
- `polling-started`: Polling began for project
- `polling-completed`: Polling finished
- `polling-error`: Error during polling
- `discovery-error`: Error discovering tasks
- `comment-discovery-error`: Error getting comments
- `pr-discovery-error`: Error getting PRs
- `all-paused`: All projects paused
- `all-resumed`: All projects resumed

## Error Handling

The scheduler implements robust error handling:

1. **Exponential Backoff**: Failed polls retry with increasing delays
2. **Error Counting**: Tracks consecutive errors per project
3. **Max Backoff**: Prevents excessive delays (default: 10 minutes)
4. **Isolated Failures**: Errors in one project don't affect others

## Best Practices

1. **Polling Intervals**: Set based on project activity
   - Active projects: 5 minutes
   - Normal projects: 10-15 minutes
   - Low activity: 30 minutes

2. **Labels**: Use specific labels to reduce API calls
   - Include only needed labels
   - Exclude known non-actionable labels

3. **Rate Limits**: Monitor GitHub API usage
   - Keep buffer for manual operations
   - Adjust intervals if hitting limits

4. **Error Monitoring**: Watch for patterns
   - Frequent errors may indicate configuration issues
   - Check GitHub API status for outages

## Example: Multi-Project Setup

```javascript
// High-priority main project
scheduler.registerProject({
  id: 'main-app',
  owner: 'company',
  repo: 'main-application',
  pollingInterval: 5 * 60 * 1000,
  priority: 90,
  weight: 3.0, // 3x weight in queue
  processComments: true,
  processPullRequests: true
});

// Documentation project
scheduler.registerProject({
  id: 'docs',
  owner: 'company',
  repo: 'documentation',
  pollingInterval: 15 * 60 * 1000,
  labels: ['documentation', 'help wanted'],
  priority: 60,
  weight: 1.0,
  processComments: true
});

// Low-priority archive
scheduler.registerProject({
  id: 'archive',
  owner: 'company',
  repo: 'old-project',
  pollingInterval: 30 * 60 * 1000,
  priority: 30,
  weight: 0.5,
  enabled: false // Disabled by default
});
```