# PoppoBuilder IPC System

The Inter-Process Communication (IPC) system provides fast and secure local communication between the PoppoBuilder CLI and daemon process.

## Overview

The IPC system uses Unix domain sockets (Linux/macOS) or named pipes (Windows) for efficient local communication. It implements a request-response pattern with event support, authentication, and automatic reconnection.

## Components

### IPCServer (`ipc-server.js`)
- Unix domain socket/named pipe server
- Client authentication and management
- Event broadcasting
- Command execution

### IPCClient (`ipc-client.js`)
- Connects to daemon via local socket
- Automatic reconnection with exponential backoff
- Promise-based command API
- Event subscription

### Protocol (`protocol.js`)
- Binary message format with JSON payload
- Message types: command, response, error, event
- Version compatibility checking
- Standard message definitions

### Commands (`commands.js`)
- Command handlers for all IPC operations
- Daemon control (status, stop, reload)
- Project management (list, add, remove, start, stop)
- Queue operations (status, pause, resume, clear)
- Worker management (status, scale, restart)
- Task operations (list, status, cancel, retry)
- Monitoring (metrics, logs, health)

## Usage

### Server (Daemon) Side

```javascript
const { IPCServer } = require('./lib/daemon/ipc');

const server = new IPCServer({
  socketPath: '/tmp/poppo-daemon.sock',
  authToken: 'your-secure-token',
  logger: yourLogger
});

// Set daemon reference for command handlers
server.daemon = daemonInstance;

// Start server
await server.start();

// Broadcast event to all clients
server.broadcast({
  type: 'event',
  event: 'project.status-changed',
  data: { projectId: '123', status: 'running' }
});

// Send to specific client
server.sendToClient(clientId, message);

// Stop server
await server.stop();
```

### Client (CLI) Side

```javascript
const { IPCClient } = require('./lib/daemon/ipc');

const client = new IPCClient({
  socketPath: '/tmp/poppo-daemon.sock',
  authToken: 'your-secure-token',
  autoReconnect: true
});

// Connect to daemon
await client.connect();

// Send commands
const status = await client.getDaemonStatus();
const projects = await client.listProjects();
await client.startProject('project-123');

// Or use generic command method
const result = await client.sendCommand('custom.command', {
  arg1: 'value1'
});

// Listen for events
client.on('daemon-event', (event, data) => {
  console.log(`Event: ${event}`, data);
});

// Disconnect
await client.disconnect();
```

## Message Format

Messages use a binary protocol with the following format:
```
[MAGIC_BYTES(5)][LENGTH(4)][JSON_DATA(N)]
```

- **MAGIC_BYTES**: "POPPO" (5 bytes) - identifies valid messages
- **LENGTH**: 32-bit big-endian integer - JSON data length
- **JSON_DATA**: UTF-8 encoded JSON payload

## Authentication

1. Server sends welcome message requiring authentication
2. Client sends auth message with token
3. Server validates token and sends auth-success
4. Client can now send commands

## Command Reference

### Daemon Management
- `daemon.status` - Get daemon status and system info
- `daemon.stop` - Gracefully stop daemon
- `daemon.reload` - Reload configuration
- `daemon.metrics` - Get daemon metrics

### Project Management
- `project.list` - List all projects
- `project.add` - Add new project
- `project.remove` - Remove project
- `project.status` - Get project status
- `project.start` - Start project
- `project.stop` - Stop project
- `project.restart` - Restart project
- `project.update` - Update project config

### Queue Management
- `queue.status` - Get queue status
- `queue.pause` - Pause queue processing
- `queue.resume` - Resume queue processing
- `queue.clear` - Clear queue jobs
- `queue.stats` - Get queue statistics

### Worker Management
- `worker.status` - Get worker pool status
- `worker.scale` - Scale worker count
- `worker.restart` - Restart workers

### Task Management
- `task.list` - List tasks
- `task.status` - Get task status
- `task.cancel` - Cancel task
- `task.retry` - Retry failed task

### Monitoring
- `metrics.get` - Get metrics
- `logs.tail` - Tail logs (limited support)
- `health.check` - Health check

## Events

The server can broadcast events to connected clients:

- `daemon.started` - Daemon started
- `daemon.stopping` - Daemon shutting down
- `project.added` - Project added
- `project.removed` - Project removed
- `project.status-changed` - Project status changed
- `queue.status-changed` - Queue status changed
- `worker.added` - Worker added
- `worker.removed` - Worker removed
- `task.started` - Task started
- `task.completed` - Task completed
- `task.failed` - Task failed

## Security

- Authentication required for all non-auth commands
- Unix socket permissions set to 0600 (owner only)
- Local-only communication (no network exposure)
- Auth tokens should be generated securely

## Error Handling

- Automatic reconnection with exponential backoff
- Request timeouts (default 30s, configurable)
- Graceful degradation on connection loss
- Detailed error messages with codes

## Demo

Run the IPC demo to see it in action:
```bash
node examples/ipc-demo.js
```

This demonstrates:
- Server setup and client connection
- Authentication flow
- Command execution
- Event broadcasting
- Error handling
- Cleanup