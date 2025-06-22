# State Synchronization Architecture

## Overview

The State Synchronization system provides a robust mechanism for managing and synchronizing state between global (system-wide) and local (project-specific) contexts in PoppoBuilder Suite. It ensures data consistency across multiple projects while preventing race conditions and handling conflicts gracefully.

## Key Features

### 1. Hierarchical State Management
- **Global State**: System-wide configuration and shared data stored in `~/.poppobuilder/state/`
- **Local State**: Project-specific data stored in `project/.poppobuilder/state/`
- **Automatic Synchronization**: Bi-directional sync between global and local states
- **Namespace Isolation**: Project states are isolated using prefixed keys

### 2. Lock Management
- **File-based Locking**: Atomic lock acquisition using exclusive file creation
- **Timeout Protection**: Automatic lock release after timeout
- **Stale Lock Detection**: Identifies and removes abandoned locks
- **Wait Queue**: Fair ordering for concurrent lock requests
- **Deadlock Prevention**: Timeout-based deadlock resolution

### 3. Conflict Resolution
- **Version Tracking**: Each state entry has a version number
- **Multiple Strategies**:
  - `last-write-wins`: Most recent update wins (default)
  - `version-wins`: Higher version number wins
  - `merge`: Deep merge for object values
  - `callback`: Custom resolution function
- **Atomic Updates**: All state changes are atomic

### 4. Transaction Support
- **ACID Properties**: Ensures consistency during complex operations
- **Timeout Handling**: Automatic rollback on timeout
- **Error Recovery**: Graceful handling of failures

## Architecture

### Component Hierarchy

```
┌─────────────────────────────────────────────────────────────┐
│                    State Synchronizer                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌────────────┐ │
│  │  Lock Manager   │  │ Transaction Mgr │  │  Event Bus │ │
│  └─────────────────┘  └─────────────────┘  └────────────┘ │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────┐  ┌─────────────────────────┐  │
│  │    Global State Store    │  │   Local State Stores    │  │
│  │  ┌─────────┐ ┌────────┐ │  │  ┌──────┐  ┌──────┐   │  │
│  │  │processes│ │ queue  │ │  │  │proj1 │  │proj2 │...│  │
│  │  └─────────┘ └────────┘ │  │  └──────┘  └──────┘   │  │
│  └─────────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### State File Structure

```
~/.poppobuilder/
├── state/                    # Global state directory
│   ├── processes.json       # Process-related state
│   ├── queue.json          # Queue-related state
│   └── .locks/             # Lock files
│       ├── global_config.lock
│       └── ...
└── ...

project/.poppobuilder/
└── state/                   # Local state directory
    ├── tasks.json          # Project tasks
    ├── history.json        # Project history
    └── config.json         # Project config
```

## Core Classes

### StateSynchronizer

Main class that orchestrates state synchronization.

```javascript
class StateSynchronizer extends EventEmitter {
  constructor(options = {}) {
    this.options = {
      globalStateDir: '~/.poppobuilder/state',
      syncInterval: 5000,
      conflictResolution: 'last-write-wins',
      enableAutoSync: true,
      transactionTimeout: 30000
    };
    
    this.lockManager = new LockManager();
    this.globalState = new Map();
    this.localStates = new Map();
  }
}
```

### LockManager

Provides file-based locking mechanism.

```javascript
class LockManager extends EventEmitter {
  constructor(options = {}) {
    this.options = {
      lockTimeout: 30000,
      retryInterval: 100,
      maxRetries: 50,
      lockDir: '~/.poppobuilder/locks'
    };
    
    this.activeLocks = new Map();
    this.lockWaitQueues = new Map();
  }
}
```

## Usage Examples

### Basic State Management

```javascript
const { StateSynchronizer } = require('./lib/core/state-synchronizer');

// Initialize synchronizer
const sync = new StateSynchronizer({
  enableAutoSync: true,
  syncInterval: 5000
});

await sync.initialize();

// Register a project
await sync.registerProject('my-project', '/path/to/project');

// Set global state
await sync.setGlobalState('shared-config', {
  apiUrl: 'https://api.example.com',
  timeout: 5000
});

// Set local state
await sync.setLocalState('my-project', 'tasks', [
  { id: 1, name: 'Task 1' }
]);

// Manual sync
await sync.syncProject('my-project');
```

### Custom Conflict Resolution

```javascript
const sync = new StateSynchronizer({
  conflictResolution: 'callback',
  conflictResolver: async (state1, state2) => {
    // Custom logic to resolve conflicts
    if (state1.priority > state2.priority) {
      return state1;
    }
    return state2;
  }
});
```

### Using Locks

```javascript
const { LockManager } = require('./lib/utils/lock-manager');

const lockManager = new LockManager();
await lockManager.initialize();

// Acquire lock with automatic release
await lockManager.withLock('critical-resource', async () => {
  // Critical section code
  await performCriticalOperation();
});

// Manual lock management
const lockId = await lockManager.acquire('resource');
try {
  // Protected code
} finally {
  await lockManager.release('resource', lockId);
}
```

## Events

### StateSynchronizer Events

- `initialized`: Synchronizer is ready
- `project-registered`: New project registered
- `project-unregistered`: Project removed
- `state-changed`: State was modified
- `project-synced`: Project synchronization completed
- `all-synced`: All projects synchronized
- `transaction-timeout`: Transaction timed out

### LockManager Events

- `lock-acquired`: Lock successfully acquired
- `lock-released`: Lock released
- `lock-timeout`: Lock timed out
- `lock-force-released`: Lock forcefully released
- `stale-lock-cleaned`: Stale lock removed

## Best Practices

1. **Always Use Locks**: For concurrent access to shared resources
2. **Handle Conflicts**: Choose appropriate conflict resolution strategy
3. **Monitor Events**: Subscribe to events for debugging and monitoring
4. **Clean Shutdown**: Always call `cleanup()` on shutdown
5. **Version Your Data**: Include version numbers for better conflict resolution

## Performance Considerations

1. **Lock Contention**: Use fine-grained locks to reduce contention
2. **Sync Frequency**: Balance between consistency and performance
3. **State Size**: Keep individual state entries small
4. **File I/O**: Consider using memory cache for frequently accessed data

## Security

1. **File Permissions**: Lock and state files are created with restricted permissions
2. **Data Validation**: All state data is validated before storage
3. **Atomic Operations**: Prevents partial writes and data corruption