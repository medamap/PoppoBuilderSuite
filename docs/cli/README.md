# PoppoBuilder CLI Documentation

PoppoBuilder 3.0 introduces a global daemon architecture that centralizes the management of multiple PoppoBuilder projects. This document covers the new CLI commands and usage patterns.

## Overview

The PoppoBuilder CLI (`poppobuilder`) provides a unified interface for:
- Managing the global PoppoBuilder daemon
- Registering and configuring projects
- Monitoring project status and logs
- Migrating existing projects to the new architecture

## Global Commands

### Daemon Management

#### `poppobuilder start`
Start the global PoppoBuilder daemon.

```bash
# Start daemon in background (detached mode)
poppobuilder start

# Start daemon in foreground
poppobuilder start --no-detach

# Start on custom port
poppobuilder start --port 3004

# Start on custom host
poppobuilder start --host 0.0.0.0
```

**Options:**
- `-d, --detach` - Run daemon in background (default)
- `-p, --port <port>` - Daemon port (default: 3003)
- `-h, --host <host>` - Daemon host (default: 127.0.0.1)

#### `poppobuilder stop`
Stop the global PoppoBuilder daemon.

```bash
# Graceful shutdown
poppobuilder stop

# Force shutdown
poppobuilder stop --force
```

**Options:**
- `-f, --force` - Force stop without waiting for tasks

#### `poppobuilder restart`
Restart the global PoppoBuilder daemon.

```bash
poppobuilder restart

# Force restart
poppobuilder restart --force
```

#### `poppobuilder status`
Show daemon and project status.

```bash
# Show current status
poppobuilder status

# Show status in JSON format
poppobuilder status --json

# Watch status continuously
poppobuilder status --watch
```

**Options:**
- `-j, --json` - Output as JSON
- `-w, --watch` - Watch for changes

#### `poppobuilder reload`
Reload configuration without restarting.

```bash
poppobuilder reload
```

### Setup and Initialization

#### `poppobuilder init`
Initialize global PoppoBuilder configuration.

```bash
# Interactive setup
poppobuilder init

# Force overwrite existing configuration
poppobuilder init --force

# Skip daemon setup
poppobuilder init --skip-daemon

# Skip project discovery
poppobuilder init --skip-projects
```

**Options:**
- `-f, --force` - Overwrite existing configuration
- `--skip-daemon` - Skip daemon setup
- `--skip-projects` - Skip project discovery

This command:
1. Creates `~/.poppobuilder/` directory structure
2. Generates default configuration
3. Sets up daemon service files (optional)
4. Discovers existing PoppoBuilder projects

### Project Management

#### `poppobuilder register`
Register a PoppoBuilder project with the global daemon.

```bash
# Register current directory
poppobuilder register

# Register specific path
poppobuilder register /path/to/project

# Register with custom options
poppobuilder register --name "My Project" --priority 80

# Register with template
poppobuilder register --template high-priority
```

**Options:**
- `-n, --name <name>` - Project name
- `-i, --id <id>` - Project identifier
- `-t, --template <template>` - Configuration template (basic, high-priority, low-priority, development)
- `-p, --priority <priority>` - Project priority (1-100, default: 50)
- `-w, --weight <weight>` - Project weight (0.1-10.0, default: 1.0)
- `--polling-interval <ms>` - Polling interval in milliseconds (default: 300000)
- `--enable/--disable` - Enable/disable project immediately

#### `poppobuilder unregister`
Unregister a project from the global daemon.

```bash
# Unregister with confirmation
poppobuilder unregister my-project

# Force unregister without confirmation
poppobuilder unregister my-project --force
```

#### `poppobuilder list`
List registered projects.

```bash
# List all projects
poppobuilder list

# List in JSON format
poppobuilder list --json

# List only enabled projects
poppobuilder list --enabled-only

# List only disabled projects
poppobuilder list --disabled-only
```

### Migration

#### `poppobuilder migrate`
Migrate a local PoppoBuilder project to the global daemon.

```bash
# Migrate current directory
poppobuilder migrate

# Migrate specific path
poppobuilder migrate /path/to/project

# Dry run (show what would be migrated)
poppobuilder migrate --dry-run

# Force migration without confirmation
poppobuilder migrate --force

# Skip backup creation
poppobuilder migrate --no-backup

# Keep local configuration after migration
poppobuilder migrate --keep-local
```

**Options:**
- `-f, --force` - Force migration without confirmation
- `--backup/--no-backup` - Create/skip backup (default: create)
- `--keep-local` - Keep local configuration after migration
- `--dry-run` - Show migration plan without executing

## Project-Specific Commands

### `poppobuilder project`
Manage individual projects.

#### `poppobuilder project enable <id>`
Enable a project.

```bash
poppobuilder project enable my-project
```

#### `poppobuilder project disable <id>`
Disable a project.

```bash
poppobuilder project disable my-project
```

#### `poppobuilder project info <id>`
Show project information.

```bash
# Show project info
poppobuilder project info my-project

# Show in JSON format
poppobuilder project info my-project --json
```

#### `poppobuilder project config <id>`
Configure a project.

```bash
# Interactive configuration
poppobuilder project config my-project

# Set specific options
poppobuilder project config my-project --priority 80 --weight 2.0
```

**Options:**
- `-p, --priority <priority>` - Set priority (1-100)
- `-w, --weight <weight>` - Set weight (0.1-10.0)
- `--polling-interval <ms>` - Set polling interval

#### `poppobuilder project logs <id>`
Show project logs.

```bash
# Show last 50 lines
poppobuilder project logs my-project

# Show last 100 lines
poppobuilder project logs my-project --lines 100

# Follow logs in real-time
poppobuilder project logs my-project --follow

# Filter by log level
poppobuilder project logs my-project --level error
```

**Options:**
- `-f, --follow` - Follow log output
- `-n, --lines <count>` - Number of lines to show (default: 50)
- `--level <level>` - Filter by log level

#### `poppobuilder project restart <id>`
Restart project tasks.

```bash
# Graceful restart
poppobuilder project restart my-project

# Force restart
poppobuilder project restart my-project --force
```

#### `poppobuilder project validate <id>`
Validate project configuration.

```bash
poppobuilder project validate my-project
```

## Configuration

### Global Configuration
Located at `~/.poppobuilder/config.json`:

```json
{
  "version": "3.0.0",
  "daemon": {
    "enabled": true,
    "port": 3003,
    "host": "127.0.0.1",
    "maxProcesses": 4,
    "schedulingStrategy": "weighted-round-robin"
  },
  "taskQueue": {
    "priorityManagement": {
      "enabled": true,
      "priorityLevels": {
        "urgent": 1000,
        "critical": 800,
        "dogfooding": 100,
        "bug": 75,
        "feature": 50
      }
    }
  }
}
```

### Project Registry
Located at `~/.poppobuilder/projects.json`:

```json
{
  "version": "1.0.0",
  "projects": {
    "my-project": {
      "id": "my-project",
      "name": "My Project",
      "path": "/path/to/project",
      "version": "1.0.0",
      "config": {
        "priority": 50,
        "weight": 1.0,
        "pollingInterval": 300000,
        "enabled": true
      }
    }
  }
}
```

## Directory Structure

After initialization, the global PoppoBuilder directory structure:

```
~/.poppobuilder/
├── config.json              # Global configuration
├── projects.json             # Project registry
├── logs/                     # Global logs
│   ├── daemon.log           # Daemon logs
│   ├── daemon.error.log     # Daemon errors
│   └── <project-id>.log     # Project-specific logs
├── data/                     # Global data
│   └── <project-id>/        # Project-specific data
├── projects/                 # Project configurations
│   └── <project-id>/        # Project-specific configs
├── plugins/                  # Global plugins
└── cache/                    # Cache files
```

## Migration Guide

### From Local to Global

1. **Initialize global configuration:**
   ```bash
   poppobuilder init
   ```

2. **Migrate existing project:**
   ```bash
   cd /path/to/existing/project
   poppobuilder migrate
   ```

3. **Start the daemon:**
   ```bash
   poppobuilder start
   ```

4. **Verify migration:**
   ```bash
   poppobuilder status
   poppobuilder list
   ```

### Backwards Compatibility

For projects not yet migrated, PoppoBuilder provides automatic backwards compatibility:

- Local execution continues to work
- Automatic detection of global daemon
- Migration suggestions
- Compatibility wrapper generation

## Examples

### Basic Workflow

```bash
# 1. Initialize global setup
poppobuilder init

# 2. Register a project
cd /path/to/project
poppobuilder register --name "My Project" --priority 75

# 3. Start daemon
poppobuilder start

# 4. Monitor status
poppobuilder status --watch

# 5. View project logs
poppobuilder project logs my-project --follow
```

### Managing Multiple Projects

```bash
# Register multiple projects
poppobuilder register /path/to/project1 --template high-priority
poppobuilder register /path/to/project2 --template basic
poppobuilder register /path/to/project3 --template low-priority

# List all projects
poppobuilder list

# Configure specific project
poppobuilder project config project1 --priority 90

# Enable/disable projects
poppobuilder project disable project3
poppobuilder project enable project3
```

### Troubleshooting

```bash
# Check daemon status
poppobuilder status

# Restart daemon
poppobuilder restart

# Validate project setup
poppobuilder project validate my-project

# Check project logs for errors
poppobuilder project logs my-project --level error

# Force restart specific project
poppobuilder project restart my-project --force
```

## Environment Variables

- `POPPO_CONFIG_DIR` - Global configuration directory (default: `~/.poppobuilder`)
- `POPPO_DAEMON_PORT` - Daemon port (default: 3003)
- `POPPO_DAEMON_HOST` - Daemon host (default: 127.0.0.1)
- `POPPO_LOG_LEVEL` - Log level (default: info)

## Exit Codes

- `0` - Success
- `1` - General error
- `2` - Configuration error
- `3` - Network/connection error
- `4` - Permission error

## See Also

- [Configuration Guide](../configuration.md)
- [Migration Guide](../migration.md)
- [Troubleshooting](../troubleshooting.md)
- [API Documentation](../api.md)