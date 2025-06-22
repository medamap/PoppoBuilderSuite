# Config Command - Global Configuration Management

The `config` command provides a unified interface for managing PoppoBuilder's global configuration settings. It allows you to view, modify, and apply configuration changes without manually editing configuration files.

## Overview

The config command supports:
- Viewing all configuration settings
- Getting specific configuration values
- Setting configuration values
- Quick options for common settings
- Live configuration updates (daemon restart not required for most settings)

## Usage

```bash
poppobuilder config [action] [options]
```

### Actions

#### List Configuration
Display all current configuration settings:
```bash
poppobuilder config --list
poppobuilder config list
poppobuilder config  # Default action
```

#### Get Configuration Value
Retrieve a specific configuration value:
```bash
poppobuilder config get <key>
poppobuilder config get daemon.maxProcesses
poppobuilder config get logging.level
```

#### Set Configuration Value
Update a configuration value:
```bash
poppobuilder config set <key> <value>
poppobuilder config set daemon.maxProcesses 4
poppobuilder config set logging.level debug
poppobuilder config set daemon.schedulingStrategy weighted
```

#### Reset Configuration
Reset all configuration to defaults (with confirmation):
```bash
poppobuilder config reset
```

### Quick Options

For common configuration changes, use these convenient flags:

#### Set Maximum Processes
```bash
poppobuilder config --max-processes 3
```

#### Set Scheduling Strategy
```bash
poppobuilder config --strategy weighted
# Options: round-robin, priority, weighted
```

## Configuration Keys

### Daemon Settings
- `daemon.enabled` - Enable/disable daemon mode
- `daemon.maxProcesses` - Maximum concurrent Claude processes (1-10)
- `daemon.schedulingStrategy` - Task scheduling strategy
- `daemon.port` - API server port (requires restart)

### Default Settings
- `defaults.checkInterval` - Issue check interval (ms)
- `defaults.timeout` - Operation timeout (ms)
- `defaults.retryAttempts` - Number of retry attempts
- `defaults.language` - Default language (en/ja)

### Logging Settings
- `logging.level` - Log level (debug/info/warn/error)
- `logging.directory` - Log directory (requires restart)
- `logging.maxFiles` - Maximum log files to keep
- `logging.maxSize` - Maximum log file size

### Registry Settings
- `registry.maxProjects` - Maximum registered projects
- `registry.autoDiscovery` - Enable project auto-discovery
- `registry.discoveryPaths` - Paths to search for projects

## Live Configuration Updates

Many configuration changes can be applied without restarting the daemon:

### Settings Applied Immediately
- Maximum processes (workers adjusted dynamically)
- Scheduling strategy
- Log level
- Check intervals and timeouts
- Retry attempts

### Settings Requiring Restart
- Daemon port
- Socket path
- Log directory
- Some structural changes

When using the config command while the daemon is running, you'll receive feedback about which changes were applied immediately and which require a restart.

## Examples

### Basic Usage
```bash
# View current configuration
poppobuilder config --list

# Set max processes to 3
poppobuilder config --max-processes 3

# Change scheduling to weighted strategy
poppobuilder config --strategy weighted

# Set logging to debug level
poppobuilder config set logging.level debug

# Get current max processes setting
poppobuilder config get daemon.maxProcesses
```

### Advanced Usage
```bash
# Set multiple values
poppobuilder config set daemon.maxProcesses 4
poppobuilder config set defaults.timeout 600000
poppobuilder config set logging.level info

# Complex value with JSON
poppobuilder config set registry.discoveryPaths '["~/projects", "/workspace"]'

# Reset to defaults (with confirmation)
poppobuilder config reset
```

## Configuration File Location

The global configuration is stored at:
```
~/.poppobuilder/config.json
```

You can also edit this file directly, but using the config command ensures:
- Proper validation
- Live updates when possible
- Consistent formatting
- Change notifications to running daemons

## Integration with Daemon

When the daemon is running, the config command will:
1. Update the configuration file
2. Notify the daemon of changes via API
3. Apply changes that don't require restart
4. Report which changes need restart

This allows for seamless configuration management without service interruption for most settings.

## Error Handling

The config command includes robust error handling:
- Validates configuration values before applying
- Prevents invalid settings
- Provides clear error messages
- Maintains configuration integrity

## See Also

- [Global Configuration Schema](../schemas/global-config-schema.md)
- [Daemon Management](daemon-management.md)
- [Project Configuration](project-config.md)