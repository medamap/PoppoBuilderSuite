# Daemon Process Management

PoppoBuilder provides a daemon mode for running as a background service. This allows PoppoBuilder to manage multiple projects efficiently with automatic worker process management.

## Overview

The daemon process uses Node.js cluster module to fork worker processes. Each worker can handle a PoppoBuilder instance, allowing concurrent processing of multiple projects while maintaining resource limits.

## Architecture

```
┌─────────────────────┐
│   Master Process    │
│  (Daemon Manager)   │
└──────────┬──────────┘
           │
    ┌──────┴──────┬──────────┬──────────┐
    │             │          │          │
┌───▼───┐   ┌────▼───┐  ┌───▼───┐  ┌───▼───┐
│Worker 0│   │Worker 1│  │Worker 2│  │Worker N│
└────────┘   └────────┘  └────────┘  └────────┘
```

- **Master Process**: Manages worker lifecycle, handles signals, and coordinates work
- **Worker Processes**: Execute PoppoBuilder instances for individual projects

## CLI Commands

### Start Daemon

```bash
# Start daemon in background
poppobuilder daemon start

# Start daemon in foreground (for debugging)
poppobuilder daemon start --foreground
```

### Stop Daemon

```bash
poppobuilder daemon stop
```

### Restart Daemon

```bash
poppobuilder daemon restart
```

### Check Status

```bash
# Human-readable status
poppobuilder daemon status

# JSON output
poppobuilder daemon status --json
```

Output example:
```
Daemon is running (PID: 12345)
Workers:
  Worker 0: PID 12346, Uptime: 3600s, Restarts: 0
  Worker 1: PID 12347, Uptime: 3600s, Restarts: 0
```

### Reload Configuration

```bash
poppobuilder daemon reload
```

This sends a SIGHUP signal to reload configuration without stopping the daemon.

## Configuration

Configure daemon behavior in global configuration:

```javascript
// ~/.poppobuilder/config.json
{
  "daemon": {
    "enabled": true,
    "maxProcesses": 2,          // Number of worker processes
    "schedulingStrategy": "round-robin",
    "port": 45678,             // API server port
    "shutdownTimeout": 30000    // Graceful shutdown timeout (ms)
  }
}
```

### Configuration Options

- **maxProcesses**: Maximum number of worker processes (1-10)
- **schedulingStrategy**: How to distribute work among workers
  - `round-robin`: Distribute evenly
  - `priority`: High-priority projects first
  - `weighted`: Based on project weights
- **port**: Port for daemon API server
- **shutdownTimeout**: Time to wait for graceful shutdown

## Signal Handling

The daemon responds to various system signals:

| Signal | Action |
|--------|--------|
| SIGTERM | Graceful shutdown |
| SIGINT | Graceful shutdown (Ctrl+C) |
| SIGHUP | Reload configuration |
| SIGUSR1 | Dump status information |
| SIGUSR2 | Custom action (reserved) |

### Manual Signal Examples

```bash
# Graceful shutdown
kill -TERM $(cat ~/.poppobuilder/daemon.pid)

# Reload configuration
kill -HUP $(cat ~/.poppobuilder/daemon.pid)

# Dump status
kill -USR1 $(cat ~/.poppobuilder/daemon.pid)
```

## Worker Management

### Automatic Restart

Workers are automatically restarted if they crash:
- Exponential backoff: 1s, 2s, 4s, ..., max 30s
- Restart count is tracked per worker
- No restart during shutdown

### Worker Communication

Workers communicate with master via IPC:
- `ready`: Worker is ready to accept work
- `error`: Worker encountered an error
- `metrics`: Performance metrics update

Master sends commands to workers:
- `shutdown`: Graceful shutdown request
- `reload`: Configuration reload

## Files and Directories

```
~/.poppobuilder/
├── daemon.pid          # PID file for daemon process
├── config.json         # Global configuration
├── logs/              # Daemon and worker logs
└── sockets/           # Unix sockets for IPC
```

## Best Practices

1. **Resource Limits**: Set appropriate `maxProcesses` based on system resources
2. **Monitoring**: Check daemon status regularly
3. **Logs**: Monitor logs for worker crashes or errors
4. **Graceful Shutdown**: Always use `daemon stop` instead of killing processes

## Troubleshooting

### Daemon Won't Start

1. Check if already running:
   ```bash
   poppobuilder daemon status
   ```

2. Check PID file:
   ```bash
   cat ~/.poppobuilder/daemon.pid
   ps -p $(cat ~/.poppobuilder/daemon.pid)
   ```

3. Remove stale PID file if needed:
   ```bash
   rm ~/.poppobuilder/daemon.pid
   ```

### Workers Keep Crashing

1. Check logs:
   ```bash
   tail -f ~/.poppobuilder/logs/daemon.log
   ```

2. Reduce worker count:
   ```bash
   poppobuilder global-config set daemon.maxProcesses 1
   ```

3. Run in foreground for debugging:
   ```bash
   poppobuilder daemon start --foreground
   ```

### Configuration Not Reloading

1. Send reload signal manually:
   ```bash
   kill -HUP $(cat ~/.poppobuilder/daemon.pid)
   ```

2. Check configuration validity:
   ```bash
   poppobuilder global-config validate
   ```

## Integration with systemd

For production deployments, you can create a systemd service:

```ini
[Unit]
Description=PoppoBuilder Daemon
After=network.target

[Service]
Type=forking
ExecStart=/usr/local/bin/poppobuilder daemon start
ExecStop=/usr/local/bin/poppobuilder daemon stop
ExecReload=/usr/local/bin/poppobuilder daemon reload
PIDFile=/home/user/.poppobuilder/daemon.pid
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Security Considerations

1. **PID File**: Ensure proper permissions on PID file
2. **API Port**: Bind to localhost only unless needed
3. **Signals**: Only privileged users should send signals
4. **Logs**: Rotate logs to prevent disk space issues