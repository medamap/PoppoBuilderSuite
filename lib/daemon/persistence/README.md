# Queue Persistence System

The enhanced queue persistence system provides robust, production-ready storage capabilities for the PoppoBuilder queue manager. It supports multiple storage backends, automatic snapshots, monitoring, and recovery features.

## Features

### 1. **Multiple Storage Backends**
- **JSON File Storage** - Simple file-based persistence with atomic writes and backup rotation
- **SQLite Storage** - Database-backed persistence with advanced querying capabilities
- **Redis Storage** - High-performance in-memory persistence with optional disk backup

### 2. **Automatic Persistence**
- Configurable auto-save intervals
- Save-on-change option for critical operations
- Debounced saves to prevent excessive I/O
- Atomic write operations to prevent corruption

### 3. **Snapshot Management**
- Automatic periodic snapshots
- Manual snapshot creation
- Snapshot restoration
- Configurable retention policies
- Automatic cleanup of old snapshots

### 4. **Monitoring & Alerts**
- Real-time operation tracking
- Performance metrics collection
- Storage size monitoring
- Error rate tracking
- Configurable alert thresholds
- Detailed performance reports

### 5. **Recovery Features**
- Automatic recovery from corrupted files
- Backup file rotation (JSON storage)
- Multiple recovery strategies
- Data integrity validation
- Checksum verification

## Configuration

### Basic Configuration

```javascript
const QueueManager = require('./queue-manager');

const queue = new QueueManager({
  persistence: {
    type: 'json',  // 'json', 'sqlite', or 'redis'
    autoSave: true,
    autoSaveInterval: 30000,  // 30 seconds
    saveOnChange: false,
    enableSnapshots: true,
    snapshotInterval: 3600000,  // 1 hour
    maxSnapshots: 24,
    enableMonitoring: true
  }
});
```

### Storage-Specific Configuration

#### JSON Storage
```javascript
{
  persistence: {
    type: 'json',
    filePath: '/path/to/queue.json',
    backupCount: 5,
    compressBackups: false,
    snapshotDir: '/path/to/snapshots'
  }
}
```

#### SQLite Storage
```javascript
{
  persistence: {
    type: 'sqlite',
    dbPath: '/path/to/queue.db',
    busyTimeout: 5000,
    walMode: true
  }
}
```

#### Redis Storage
```javascript
{
  persistence: {
    type: 'redis',
    host: 'localhost',
    port: 6379,
    password: 'your-password',
    db: 0,
    keyPrefix: 'poppobuilder:queue:',
    ttl: null  // No expiration
  }
}
```

## API Reference

### Queue Manager Methods

#### Snapshot Management
```javascript
// Create a snapshot
await queue.createSnapshot('backup-before-update');

// List snapshots
const snapshots = await queue.listSnapshots();

// Restore from snapshot
await queue.restoreSnapshot('backup-before-update');
```

#### Import/Export
```javascript
// Export queue data
const data = await queue.exportQueue('json');
const csv = await queue.exportQueue('csv');

// Import queue data
await queue.importQueue(data, 'json', false);  // Replace
await queue.importQueue(data, 'json', true);   // Merge
```

#### Monitoring
```javascript
// Get persistence statistics
const stats = await queue.getPersistenceStats();

// Get performance report
const report = await queue.getPersistenceReport();
```

### Events

The queue manager emits the following persistence-related events:

- `queue-loaded` - Emitted when queue is loaded from storage
- `queue-saved` - Emitted when queue is saved to storage
- `snapshot-created` - Emitted when a snapshot is created
- `snapshot-restored` - Emitted when a snapshot is restored
- `queue-imported` - Emitted when queue data is imported
- `persistence-error` - Emitted when a persistence operation fails
- `persistence-alert` - Emitted when monitoring detects an issue

## Storage Adapter Development

To create a custom storage adapter:

```javascript
const BaseStorage = require('./persistence/base-storage');

class CustomStorage extends BaseStorage {
  async initialize() {
    // Initialize your storage
  }

  async save(data) {
    // Save data to your storage
  }

  async load() {
    // Load data from your storage
    return data;
  }

  async createSnapshot(snapshotId, data) {
    // Create a snapshot
  }

  async restoreSnapshot(snapshotId) {
    // Restore from snapshot
    return data;
  }

  async listSnapshots() {
    // List available snapshots
    return snapshots;
  }

  async deleteSnapshot(snapshotId) {
    // Delete a snapshot
  }

  async getStats() {
    // Return storage statistics
    return stats;
  }

  async clear() {
    // Clear all data
  }

  async close() {
    // Close connections
  }
}

// Register with factory
const queue = new QueueManager({
  persistence: {
    type: 'custom',
    customStorage: CustomStorage,
    // ... custom options
  }
});
```

## Best Practices

1. **Choose the Right Backend**
   - Use JSON for simple deployments
   - Use SQLite for better querying and reliability
   - Use Redis for high-performance scenarios

2. **Configure Monitoring**
   - Enable monitoring in production
   - Set appropriate alert thresholds
   - Review performance reports regularly

3. **Snapshot Strategy**
   - Create manual snapshots before major changes
   - Configure automatic snapshots based on activity
   - Maintain reasonable retention policies

4. **Recovery Planning**
   - Test recovery procedures regularly
   - Monitor backup file sizes
   - Validate data integrity periodically

## Troubleshooting

### Common Issues

1. **File Lock Errors (JSON Storage)**
   - Check for stale lock files
   - Ensure proper permissions
   - Verify no other processes are accessing the file

2. **Database Lock Errors (SQLite)**
   - Increase busy timeout
   - Enable WAL mode
   - Check for long-running transactions

3. **Connection Errors (Redis)**
   - Verify Redis is running
   - Check connection parameters
   - Review Redis logs

### Performance Optimization

1. **Reduce Save Frequency**
   - Increase auto-save interval
   - Disable save-on-change for high-volume scenarios
   - Use debounced saves

2. **Optimize Storage**
   - Enable compression for backups
   - Clean up old snapshots regularly
   - Monitor storage size

3. **Use Appropriate Backend**
   - Redis for sub-millisecond operations
   - SQLite for complex queries
   - JSON for simplicity

## Migration Guide

### Migrating Between Storage Backends

```javascript
// 1. Export from current backend
const queue = new QueueManager({ persistence: { type: 'json' } });
await queue.start();
const data = await queue.exportQueue('json');
await queue.stop();

// 2. Import to new backend
const newQueue = new QueueManager({ persistence: { type: 'sqlite' } });
await newQueue.start();
await newQueue.importQueue(data, 'json');
await newQueue.stop();
```

### Upgrading from Legacy Queue Manager

The new persistence system is backward compatible. Existing queue.json files will be automatically migrated on first load.

## Dependencies

- **Core**: No additional dependencies
- **SQLite Storage**: `sqlite3` package
- **Redis Storage**: `redis` package

Install optional dependencies as needed:
```bash
npm install sqlite3  # For SQLite storage
npm install redis    # For Redis storage
```