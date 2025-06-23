# PoppoBuilder Daemon CLI Commands

This directory contains the modular implementation of daemon management commands for PoppoBuilder.

## Structure

```
daemon/
├── index.js      # Main daemon command group
├── start.js      # Start daemon command
├── stop.js       # Stop daemon command
├── status.js     # Show daemon status
├── restart.js    # Restart daemon
└── reload.js     # Reload configuration
```

## Commands

### `poppo daemon start`

Start the PoppoBuilder daemon process.

**Options:**
- `-f, --foreground` - Run daemon in foreground (do not detach)
- `-d, --debug` - Enable debug mode logging
- `--log-level <level>` - Set log level (error, warn, info, debug)
- `--config <path>` - Use custom configuration file
- `--port <port>` - API server port
- `--no-api` - Disable HTTP API server
- `--json` - Output in JSON format

**Example:**
```bash
poppo daemon start
poppo daemon start --debug --log-level debug
poppo daemon start --foreground --config ./custom-config.json
```

### `poppo daemon stop`

Stop the PoppoBuilder daemon gracefully.

**Options:**
- `-f, --force` - Force stop (kill) the daemon
- `--timeout <seconds>` - Timeout for graceful shutdown (default: 30)
- `--no-wait` - Do not wait for daemon to stop
- `--json` - Output in JSON format

**Example:**
```bash
poppo daemon stop
poppo daemon stop --force
poppo daemon stop --timeout 60
```

### `poppo daemon status`

Display detailed status information about the daemon.

**Options:**
- `-v, --verbose` - Show detailed information
- `-w, --workers` - Show worker details
- `-q, --queues` - Show queue statistics
- `-p, --projects` - Show project status
- `-h, --health` - Show component health status
- `--continuous` - Continuously update status
- `--interval <seconds>` - Update interval for continuous mode
- `--json` - Output in JSON format

**Example:**
```bash
poppo daemon status
poppo daemon status --verbose --workers
poppo daemon status --continuous --interval 5
```

### `poppo daemon restart`

Restart the daemon with optional state preservation.

**Options:**
- `-g, --graceful` - Perform graceful restart (wait for tasks)
- `-f, --force` - Force restart without waiting
- `--timeout <seconds>` - Timeout for graceful restart
- `--preserve-queue` - Preserve task queue during restart
- `--debug` - Enable debug mode after restart
- `--log-level <level>` - Set log level after restart
- `--config <path>` - Use custom configuration after restart
- `--json` - Output in JSON format

**Example:**
```bash
poppo daemon restart
poppo daemon restart --graceful --preserve-queue
poppo daemon restart --force --debug
```

### `poppo daemon reload`

Reload configuration without stopping the daemon.

**Options:**
- `--config <path>` - Use a different configuration file
- `--validate-only` - Only validate configuration
- `--show-diff` - Show configuration differences
- `--force` - Force reload despite warnings
- `--components <list>` - Reload specific components only
- `--json` - Output in JSON format

**Example:**
```bash
poppo daemon reload
poppo daemon reload --config ./new-config.json --show-diff
poppo daemon reload --validate-only
```

## Integration

To integrate these commands into your CLI application:

```javascript
const { Command } = require('commander');
const DaemonCommand = require('./lib/cli/commands/daemon');

const program = new Command();
program.addCommand(DaemonCommand.create());
program.parse(process.argv);
```

## IPC Communication

All daemon commands use the IPC client to communicate with the daemon process through a Unix socket (or named pipe on Windows). This provides:

- Fast, secure local communication
- Authentication support
- Automatic reconnection
- Event streaming
- Structured command/response protocol

## Error Handling

Each command includes comprehensive error handling:
- Connection failures
- Daemon not running
- Permission errors
- Timeout handling
- Graceful degradation

## JSON Output

All commands support `--json` flag for programmatic use:

```bash
poppo daemon status --json | jq '.health'
poppo daemon start --json | jq '.pid'
```

## Testing

Run the test suite:

```bash
npm test test/cli/daemon-commands.test.js
```