# Multi-Project Executor Configuration

*日本語版は[こちら](./configuration/multi-project-executor.md)*

## Overview

The multi-project-executor.sh script manages PoppoBuilder execution across multiple projects with built-in duplicate prevention, timeout mechanisms, and health monitoring.

## Environment Variables

### Process Management

- **POPPOBUILDER_TIMEOUT**
  - Default: 300 (5 minutes)
  - Maximum time in seconds a PoppoBuilder process can run before being terminated
  - Example: `export POPPOBUILDER_TIMEOUT=600` (10 minutes)

- **POPPOBUILDER_HEALTH_CHECK_INTERVAL**
  - Default: 30 (30 seconds)
  - Interval in seconds between health checks on running processes
  - Example: `export POPPOBUILDER_HEALTH_CHECK_INTERVAL=60`


### Execution Strategy

- **POPPOBUILDER_STRATEGY**
  - Default: "round-robin"
  - Available strategies:
    - `round-robin`: Process projects in sequential order
    - `priority`: Process higher priority projects first
    - `weighted`: (Not implemented) Process based on project weights
    - `fair-share`: (Not implemented) Ensure fair resource allocation
  - Example: `export POPPOBUILDER_STRATEGY=priority`

- **POPPOBUILDER_WAIT_TIME**
  - Default: 60 (60 seconds)
  - Wait time in seconds between project iterations
  - Example: `export POPPOBUILDER_WAIT_TIME=120`

## PID File Management

The script automatically manages PID files to prevent duplicate execution:

- **PID Directory**: `/tmp/poppo-builder/pids/`
- **PID File Format**: `poppo-builder-{project-name}.pid`
- **Automatic Cleanup**: Stale PID files are removed on startup and when processes complete

## Features Implemented in #273

1. **Duplicate Prevention**
   - Checks for existing processes before starting new ones
   - Uses PID files to track running processes
   - Prevents multiple PoppoBuilder instances for the same project

2. **Timeout Mechanism**
   - Monitors process execution time
   - Gracefully terminates processes that exceed timeout
   - Force kills if graceful shutdown fails

3. **Health Monitoring**
   - Regular health checks on running processes
   - Logs progress at configurable intervals
   - Detects and cleans up stale processes

4. **Signal Handling**
   - Proper cleanup on script termination (SIGINT, SIGTERM, SIGQUIT)
   - Removes all PID files on exit
   - Terminates child processes gracefully

## Usage Examples

### Basic Usage with Custom Timeout
```bash
export POPPOBUILDER_TIMEOUT=600
export POPPOBUILDER_HEALTH_CHECK_INTERVAL=60
bash scripts/multi-project-executor.sh
```

### Priority-Based Processing
```bash
export POPPOBUILDER_STRATEGY=priority
export POPPOBUILDER_WAIT_TIME=30
bash scripts/multi-project-executor.sh
```

### Testing Configuration
```bash
# Short timeouts for testing
export POPPOBUILDER_TIMEOUT=30
export POPPOBUILDER_WAIT_TIME=10
export POPPOBUILDER_HEALTH_CHECK_INTERVAL=5
bash scripts/multi-project-executor.sh
```

## Troubleshooting

### Check for Running Processes
```bash
ls -la /tmp/poppo-builder/pids/
ps aux | grep poppo-builder
```

### Clean Up Stale PIDs
```bash
rm -f /tmp/poppo-builder/pids/*.pid
```

### View Logs
```bash
tail -f /tmp/poppo-builder/logs/multi-project-executor-*.log
```

## Related Issues

- Issue #273: Implement process duplicate execution prevention in multi-project-executor
- Issue #271: Fix double lock acquisition in task processing (completed)
- Issue #272: Implement error cleanup and lock release handling (completed)