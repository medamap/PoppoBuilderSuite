# PoppoBuilder Target Architecture Design

## Overview

This document defines the target architecture for PoppoBuilder Suite - how the system SHOULD work. All architecture-related issues should reference this document as the authoritative source of truth.

## Core Principles

1. **Global Daemon Architecture**: PoppoBuilder runs as a single global daemon managing multiple projects
2. **Resource Management**: System-wide resource limits prevent overload
3. **Fair Scheduling**: All projects get fair access to processing resources
4. **Separation of Concerns**: Clear separation between global and project-specific configurations
5. **Scalability**: Easy to add/remove projects without system restart

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         User's System                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    PoppoBuilder Daemon                       │  │
│  │                  (Single Global Process)                     │  │
│  │                                                              │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │  │
│  │  │   Global     │  │   Project    │  │     Worker     │   │  │
│  │  │   Config     │  │   Registry   │  │     Pool       │   │  │
│  │  │   Manager    │  │              │  │                │   │  │
│  │  └──────────────┘  └──────────────┘  └────────────────┘   │  │
│  │                                                              │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐   │  │
│  │  │   Global     │  │     API      │  │   Dashboard    │   │  │
│  │  │    Queue     │  │   Server     │  │    Server      │   │  │
│  │  │   Manager    │  │  (Port 3003) │  │  (Port 3001)   │   │  │
│  │  └──────────────┘  └──────────────┘  └────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                ↓                                    │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    Registered Projects                       │  │
│  │                                                              │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐           │  │
│  │  │ Project A  │  │ Project B  │  │ Project C  │  ...      │  │
│  │  │            │  │            │  │            │           │  │
│  │  │ Priority:80│  │ Priority:50│  │ Priority:90│           │  │
│  │  └────────────┘  └────────────┘  └────────────┘           │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. PoppoBuilder Daemon
- **Location**: Runs as a system service/process
- **Responsibilities**:
  - Manage all registered projects
  - Schedule tasks across projects
  - Enforce global resource limits
  - Provide API for CLI and dashboard
- **Process Management**: 
  - Single daemon process
  - Auto-restart capability
  - Graceful shutdown

#### 2. Global Configuration Manager
- **Config Location**: `~/.poppobuilder/config.json`
- **Contents**:
  ```json
  {
    "daemon": {
      "maxProcesses": 2,
      "schedulingStrategy": "weighted-round-robin",
      "port": 3003
    },
    "resources": {
      "maxMemoryMB": 4096,
      "maxCpuPercent": 80
    },
    "defaults": {
      "pollingInterval": 300000,
      "timeout": 600000,
      "retryAttempts": 3
    }
  }
  ```

#### 3. Project Registry
- **Registry Location**: `~/.poppobuilder/projects.json`
- **Structure**:
  ```json
  {
    "projects": {
      "project-id-1": {
        "path": "/path/to/project",
        "name": "Project Name",
        "github": {
          "owner": "username",
          "repo": "repository"
        },
        "priority": 50,
        "weight": 1.0,
        "enabled": true,
        "registered": "2024-01-01T00:00:00Z"
      }
    }
  }
  ```

#### 4. Global Queue Manager
- **Responsibilities**:
  - Collect tasks from all projects
  - Apply scheduling algorithm
  - Distribute tasks to workers
  - Track task status
- **Scheduling Strategies**:
  - **Round-Robin**: Equal distribution
  - **Priority-Based**: Higher priority projects first
  - **Weighted-Round-Robin**: Based on project weights
  - **Deadline-Aware**: Urgent tasks first

#### 5. Worker Pool
- **Management**:
  - Spawn workers up to `maxProcesses`
  - Each worker handles one Claude process
  - Workers are project-agnostic
  - Automatic health monitoring
- **Resource Limits**:
  - Memory limits per worker
  - CPU throttling if needed
  - Timeout enforcement

#### 6. API Server
- **Port**: 3003 (configurable)
- **Endpoints**:
  - `/api/projects` - Project management
  - `/api/queue` - Queue status
  - `/api/workers` - Worker status
  - `/api/daemon` - Daemon control
- **Authentication**: Token-based for security

## Configuration Hierarchy

### 1. System Defaults
- Built into PoppoBuilder
- Provides sensible defaults for all settings

### 2. Global Configuration
- **Location**: `~/.poppobuilder/config.json`
- **Contains**:
  - Resource limits (maxProcesses, memory, CPU)
  - Default timeouts and intervals
  - Daemon settings (port, scheduling strategy)
  - Logging configuration

### 3. Project Configuration
- **Location**: `{project}/.poppo/config.json`
- **Contains ONLY**:
  - GitHub repository information
  - Project-specific task labels
  - Language preferences
  - Custom prompts (if any)

### 4. Environment Variables
- Override any setting temporarily
- Format: `POPPO_CATEGORY_SETTING`
- Example: `POPPO_DAEMON_MAXPROCESSES=4`

## Directory Structure

```
~/.poppobuilder/                    # Global PoppoBuilder directory
├── config.json                     # Global configuration
├── projects.json                   # Registered projects
├── daemon.pid                      # Daemon process ID
├── logs/                          # Global logs
│   ├── daemon.log                 # Daemon logs
│   ├── api.log                    # API server logs
│   └── worker-*.log               # Worker logs
├── queue/                         # Queue state (if file-based)
│   ├── pending.json               # Pending tasks
│   └── active.json                # Active tasks
└── data/                          # Runtime data
    ├── statistics.json            # Performance statistics
    └── health.json                # Health metrics

{project_directory}/               # Individual project
└── .poppo/                       # Project-specific PoppoBuilder directory
    ├── config.json               # Project configuration
    └── cache/                    # Project-specific cache
```

## Command Line Interface

### Global Commands (System-Wide)

```bash
# Daemon Management
poppo-builder daemon start         # Start the daemon
poppo-builder daemon stop          # Stop the daemon
poppo-builder daemon restart       # Restart the daemon
poppo-builder daemon status        # Check daemon status

# Global Configuration
poppo-builder config init          # Initialize global config
poppo-builder config show          # Show configuration
poppo-builder config set KEY VALUE # Set configuration value
poppo-builder config reset         # Reset to defaults

# Project Management
poppo-builder project register     # Register current directory
poppo-builder project unregister   # Unregister project
poppo-builder project list         # List all projects
poppo-builder project status       # Show project status

# Queue Management
poppo-builder queue status         # Show queue status
poppo-builder queue clear          # Clear queue (with confirmation)

# Worker Management
poppo-builder worker list          # List active workers
poppo-builder worker stop ID       # Stop specific worker
```

### Project Commands (Project-Specific)

```bash
# Project Initialization (run in project directory)
poppo-builder init                 # Initialize project config

# Project Settings
poppo-builder project set-priority 80     # Set project priority
poppo-builder project set-weight 2.0      # Set project weight
poppo-builder project enable/disable      # Enable/disable project
```

## Task Processing Flow

1. **Task Discovery**:
   - Daemon polls each registered project based on global `pollingInterval`
   - Discovers new issues with appropriate labels
   - Adds tasks to global queue

2. **Task Scheduling**:
   - Global Queue Manager applies scheduling algorithm
   - Considers project priority, weight, and strategy
   - Assigns tasks to available workers

3. **Task Execution**:
   - Worker spawns Claude process
   - Executes task with project context
   - Reports results back to daemon

4. **Result Handling**:
   - Daemon updates GitHub via project credentials
   - Logs results and statistics
   - Updates queue state

## Migration from Current Architecture

### Current State (To Be Replaced)
- PoppoBuilder runs locally in each project
- Each instance has its own process limits
- No coordination between projects
- Mixed global/project configurations

### Migration Steps
1. Install new PoppoBuilder globally
2. Run migration script to:
   - Extract global settings from project configs
   - Create global configuration
   - Register existing projects
3. Stop all local PoppoBuilder instances
4. Start global daemon
5. Verify all projects are processing

## Benefits of Target Architecture

1. **Resource Efficiency**:
   - Single daemon uses less memory than multiple instances
   - Shared Claude processes across projects
   - Better CPU utilization

2. **Fair Resource Allocation**:
   - Projects can't monopolize resources
   - Configurable scheduling strategies
   - Priority-based processing

3. **Centralized Management**:
   - Single dashboard for all projects
   - Unified logging and monitoring
   - Easy to add/remove projects

4. **Scalability**:
   - Add projects without system impact
   - Adjust resources dynamically
   - Better performance under load

5. **Reliability**:
   - Daemon auto-restart
   - Persistent queue state
   - Graceful error handling

## Implementation Roadmap

For detailed implementation breakdown, see: `/docs/architecture/implementation-roadmap.md`

The implementation is divided into 7 phases with approximately 60 individual issues:

1. **Phase 1**: Global Configuration Foundation (10 issues)
2. **Phase 2**: Project Registry System (8 issues)
3. **Phase 3**: Daemon Core Implementation (12 issues)
4. **Phase 4**: Worker Pool Management (8 issues)
5. **Phase 5**: API and Integration (7 issues)
6. **Phase 6**: CLI and Migration (6 issues)
7. **Phase 7**: Testing and Documentation (7 issues)

## Success Criteria

1. **Single Global Process**: Only one PoppoBuilder daemon running
2. **Multi-Project Support**: Successfully managing 10+ projects
3. **Resource Limits**: Never exceeds configured limits
4. **Fair Scheduling**: All projects get processing time
5. **Zero Downtime**: Projects can be added/removed without restart
6. **Performance**: Better than current architecture
7. **Reliability**: 99.9% uptime for daemon

## References

- Original multi-project guide: `/docs/guides/multi-project-guide.md`
- Global configuration guide: `/docs/global-configuration.md`
- Current implementation: `/src/minimal-poppo.js`