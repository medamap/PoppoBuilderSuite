# Global Configuration Management

PoppoBuilder provides a global configuration system for managing settings across multiple projects. This configuration is stored in `~/.poppobuilder/config.json` and serves as the foundation for multi-project support.

## Overview

The global configuration system allows you to:
- Set system-wide defaults for all PoppoBuilder projects
- Configure daemon settings for managing multiple projects
- Define resource limits and scheduling strategies
- Manage logging, telemetry, and update settings

## Configuration Structure

```json
{
  "version": "1.0.0",
  "daemon": {
    "enabled": true,
    "maxProcesses": 2,
    "schedulingStrategy": "round-robin",
    "port": 45678
  },
  "defaults": {
    "checkInterval": 30000,
    "timeout": 300000,
    "retryAttempts": 3,
    "language": "en"
  },
  "registry": {
    "maxProjects": 20,
    "autoDiscovery": false,
    "discoveryPaths": []
  },
  "logging": {
    "level": "info",
    "directory": "~/.poppobuilder/logs",
    "maxFiles": 30,
    "maxSize": "10M"
  },
  "telemetry": {
    "enabled": false
  },
  "updates": {
    "checkForUpdates": true,
    "autoUpdate": false,
    "channel": "stable"
  }
}
```

## CLI Commands

### Initialize Global Configuration

```bash
poppobuilder global-config init
```

Creates the default global configuration file at `~/.poppobuilder/config.json`.

### Show Configuration

```bash
# Show all configuration
poppobuilder global-config show

# Show specific configuration path
poppobuilder global-config show daemon
poppobuilder global-config show daemon.maxProcesses
```

### Set Configuration Values

```bash
# Set a single value
poppobuilder global-config set daemon.maxProcesses 4

# Set boolean values
poppobuilder global-config set daemon.enabled false

# Set array values (JSON format)
poppobuilder global-config set registry.discoveryPaths '["~/projects", "~/work"]'
```

### Reset Configuration

```bash
# Reset to defaults (with confirmation)
poppobuilder global-config reset

# Reset without confirmation
poppobuilder global-config reset -y
```

### Export/Import Configuration

```bash
# Export to file
poppobuilder global-config export myconfig.json

# Export to stdout
poppobuilder global-config export

# Import from file
poppobuilder global-config import myconfig.json
```

### Validate Configuration

```bash
# Validate current configuration
poppobuilder global-config validate

# Validate a specific file
poppobuilder global-config validate myconfig.json
```

### Show Configuration Paths

```bash
poppobuilder global-config path
```

This shows:
- Config directory: `~/.poppobuilder`
- Config file: `~/.poppobuilder/config.json`
- Logs directory: `~/.poppobuilder/logs`
- Projects directory: `~/.poppobuilder/projects`

## Configuration Options

### Daemon Settings

- **enabled**: Enable/disable daemon mode for managing multiple projects
- **maxProcesses**: Maximum number of concurrent Claude processes (1-10)
- **schedulingStrategy**: Task scheduling strategy
  - `round-robin`: Distribute tasks evenly across projects
  - `priority`: Process high-priority projects first
  - `weighted`: Use project weights for scheduling
- **port**: Port for daemon API server (1024-65535)
- **socketPath**: Unix socket path for IPC (optional, overrides port)

### Default Settings

- **checkInterval**: Default interval for checking new issues (milliseconds)
- **timeout**: Default timeout for Claude operations (milliseconds)
- **retryAttempts**: Default number of retry attempts (0-5)
- **language**: Default language for new projects (`en` or `ja`)

### Registry Settings

- **maxProjects**: Maximum number of registered projects (1-100)
- **autoDiscovery**: Automatically discover PoppoBuilder projects
- **discoveryPaths**: Paths to search for PoppoBuilder projects

### Logging Settings

- **level**: Global logging level (`debug`, `info`, `warn`, `error`)
- **directory**: Directory for global logs
- **maxFiles**: Maximum number of log files to keep
- **maxSize**: Maximum size per log file (e.g., `10M`, `100K`)

### Telemetry Settings

- **enabled**: Enable anonymous usage telemetry
- **endpoint**: Telemetry collection endpoint (URI format)

### Update Settings

- **checkForUpdates**: Check for PoppoBuilder updates
- **autoUpdate**: Automatically install updates
- **channel**: Update channel (`stable`, `beta`, `dev`)

## API Usage

The global configuration can also be accessed programmatically:

```javascript
const { GlobalConfigManager, getInstance } = require('poppobuilder/lib/core/global-config-manager');

// Get singleton instance
const configManager = getInstance();

// Initialize
await configManager.initialize();

// Get configuration
const maxProcesses = configManager.get('daemon.maxProcesses');

// Set configuration
await configManager.set('daemon.maxProcesses', 4);

// Update multiple values
await configManager.update({
  daemon: {
    port: 12345,
    schedulingStrategy: 'priority'
  }
});

// Listen to events
configManager.on('changed', ({ path, oldValue, newValue }) => {
  console.log(`Config changed: ${path} from ${oldValue} to ${newValue}`);
});
```

## Configuration Hierarchy

PoppoBuilder uses a hierarchical configuration system with the following priority (highest to lowest):

1. Environment variables (`POPPO_*`)
2. Project configuration (`.poppo/config.json`)
3. Global configuration (`~/.poppobuilder/config.json`)
4. System defaults

This allows you to:
- Set global defaults that apply to all projects
- Override settings for specific projects
- Use environment variables for temporary overrides

## Best Practices

1. **Resource Limits**: Set appropriate `maxProcesses` based on your system resources
2. **Logging**: Configure log rotation to prevent disk space issues
3. **Security**: Keep telemetry disabled unless you trust the endpoint
4. **Updates**: Use the `stable` channel for production environments
5. **Backups**: Export your configuration before making major changes

## Troubleshooting

### Configuration Not Loading

If your global configuration is not being loaded:

1. Check file permissions: `ls -la ~/.poppobuilder/config.json`
2. Validate the configuration: `poppobuilder global-config validate`
3. Check for syntax errors in the JSON file

### Permission Errors

If you get permission errors when saving configuration:

```bash
# Fix permissions
chmod 644 ~/.poppobuilder/config.json
chmod 755 ~/.poppobuilder
```

### Reset to Defaults

If your configuration becomes corrupted:

```bash
# Backup current config
poppobuilder global-config export backup.json

# Reset to defaults
poppobuilder global-config reset -y
```