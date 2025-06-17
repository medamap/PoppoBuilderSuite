# PoppoBuilder Multi-Project Management Guide

## Overview

PoppoBuilder's multi-project feature allows you to centrally manage multiple GitHub projects and control task priorities across projects.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    PoppoBuilder Daemon                       │
│  ┌─────────────────┐  ┌──────────────────┐  ┌──────────┐  │
│  │  Global Queue   │  │     Project      │  │   API    │  │
│  │    Manager      │  │     Manager      │  │  Server  │  │
│  └─────────────────┘  └──────────────────┘  └──────────┘  │
└─────────────────────────────────────────────────────────────┘
                               ↓
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Worker 1  │  │   Worker 2  │  │   Worker 3  │
│  Project A  │  │  Project B  │  │  Project C  │
└─────────────┘  └─────────────┘  └─────────────┘
```

## Installation

1. Install dependencies:
```bash
npm install
```

2. Global CLI installation (optional):
```bash
npm link
```

## Usage

### 1. Starting the Daemon

```bash
# Start daemon
npm run poppo daemon --start

# Or
poppo daemon --start

# Check daemon status
poppo daemon --status

# Stop daemon
poppo daemon --stop
```

### 2. Registering Projects

```bash
# Register current directory as a project
poppo project -r .

# Register another directory
poppo project -r /path/to/project

# List all projects
poppo project -l
```

### 3. Project Configuration

When a project is registered, a `.poppo/project.json` file is created:

```json
{
  "id": "owner/repo",
  "name": "My Project",
  "priority": 50,
  "labels": {
    "misc": "task:misc",
    "dogfooding": "task:dogfooding",
    "bug": "task:bug",
    "feature": "task:feature"
  },
  "maxConcurrentTasks": 2,
  "pollingInterval": 30000
}
```

### 4. Priority Management

Set project priority (0-100):

```bash
poppo project -p my-project 80
```

Priority guidelines:
- 100: Highest priority (dogfooding tasks, etc.)
- 75-99: High priority
- 50-74: Normal priority
- 25-49: Low priority
- 0-24: Lowest priority

### 5. Task Scanning and Queue Management

```bash
# Scan project tasks
poppo project -s my-project

# Check global queue status
poppo queue -s

# Check worker status
poppo worker -l
```

### 6. Dashboard

Visualize multi-project status with the integrated dashboard:

```bash
# Open dashboard
poppo dashboard

# Or direct access
http://localhost:3001/multi-project.html
```

## Configuration

### Daemon Configuration (`config/daemon-config.json`)

```json
{
  "port": 3003,
  "host": "localhost",
  "dataDir": "~/.poppo-builder",
  "maxWorkers": 10,
  "maxQueueSize": 1000,
  "workerTimeout": 3600000,
  "pollInterval": 5000
}
```

### Main System Configuration (`config/config.json`)

Enable multi-project mode:

```json
{
  "multiProject": {
    "enabled": true,
    "daemonUrl": "http://localhost:3003"
  }
}
```

## Advanced Features

### Resource Optimization

The daemon automatically optimizes resource allocation between projects every minute, considering:
- Project priority
- Number of queued tasks
- Historical execution statistics

### Project Health

Project health is automatically calculated based on success rate:
- 🟢 Excellent: 90%+ success rate
- 🔵 Good: 70-89% success rate
- 🟡 Fair: 50-69% success rate
- 🔴 Poor: <50% success rate

### Automatic Task Scanning

Enable periodic task scanning with `autoScan` configuration:

```json
{
  "autoScan": {
    "enabled": true,
    "interval": 300000
  }
}
```

## Troubleshooting

### Daemon Won't Start

1. Check if port 3003 is in use:
```bash
lsof -i :3003
```

2. Remove PID file:
```bash
rm ~/.poppo-builder/poppo-daemon.pid
```

### Workers Won't Start

1. Verify project registration:
```bash
poppo project -l
```

2. Check if `.poppo/project.json` exists in project directory

### Tasks Not Being Processed

1. Check queue status:
```bash
poppo queue -s
```

2. Verify target issues have correct labels

## API Reference

### Daemon API

- `GET /api/health` - Health check
- `POST /api/projects/register` - Register project
- `GET /api/projects` - List projects
- `GET /api/queue/status` - Queue status
- `POST /api/queue/enqueue` - Enqueue task
- `GET /api/workers` - List workers

## Best Practices

1. **Setting Project Priorities**
   - Set high priority for important production projects
   - Set low priority for development/test projects

2. **Adjusting Worker Count**
   - Adjust `maxWorkers` based on CPU/memory resources
   - Set appropriate `maxConcurrentTasks` for each project

3. **Regular Maintenance**
   - Rotate log files periodically
   - Clean up completed tasks

4. **Monitoring and Alerts**
   - Check dashboard regularly
   - Monitor error rates for critical projects