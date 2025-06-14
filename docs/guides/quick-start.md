# PoppoBuilder Suite Quick Start Guide

## Prerequisites

- Node.js 18 or higher
- Claude Code CLI installed and configured
- Git configured with GitHub access
- macOS, Linux, or WSL2 on Windows

## Initial Setup

### 1. Clone the Repository

```bash
cd ~/Projects  # or your preferred directory
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 2. Install Dependencies (once available)

```bash
npm install
```

### 3. Initialize Poppo Repository

```bash
# Create necessary directories
mkdir -p poppo-repo/{config,tasks,status,results,projects}

# Create initial configuration
cat > poppo-repo/config/system.json << EOF
{
  "version": "1.0.0",
  "cicd": {
    "pollInterval": 30000,
    "maxConcurrentJobs": 3,
    "defaultTimeout": 300000
  },
  "agents": {
    "ccpm": { "enabled": true },
    "ccag": { "enabled": true },
    "ccra": { "enabled": false },
    "ccta": { "enabled": false },
    "ccma": { "enabled": false }
  }
}
EOF
```

### 4. Start the CICD Service

```bash
# In one terminal
node cicd/scheduler.js

# You should see:
# [CICD] PoppoBuilder CICD starting...
# [CICD] Polling interval: 30 seconds
# [CICD] Waiting for tasks...
```

## Basic Usage

### 1. Submit Your First Task

In Claude Code:
```
Hey Poppo, create a new task to add a hello world endpoint to the API
```

This will:
1. MCP receives the command
2. CCGM creates a task in poppo-repo/tasks/
3. CICD picks up the task
4. CCPM generates instructions
5. CCAG implements the change

### 2. Check Status

```
Poppo, what's the current status?
```

Response will show:
- Active jobs
- Queued tasks  
- Recent completions
- Any errors

### 3. View Results

```
Poppo, show me the result of task-001
```

## Working with Projects

### 1. Initialize a New Project

```
Poppo, initialize project "my-api" with Express and TypeScript
```

### 2. Add Features

```
Poppo, add user authentication to my-api project
```

### 3. Run Tests

```
Poppo, run tests for my-api project
```

## Self-Hosting Development

### 1. Create Enhancement Issue

```
Poppo, create issue: Add JSON schema validation to task files
```

### 2. Let PoppoBuilder Implement It

```
Poppo, work on issue #1
```

### 3. Review and Merge

```
Poppo, show me PR for issue #1
```

## Troubleshooting

### CICD Not Picking Up Tasks

1. Check if CICD is running
2. Verify task file is in correct format
3. Check logs in `cicd/logs/`

### Agent Subprocess Fails

1. Check agent output in `poppo-repo/results/`
2. Verify Claude Code CLI is working
3. Check instruction format

### State Corruption

1. Stop CICD
2. Check `poppo-repo/status/state.json`
3. Fix or restore from backup
4. Restart CICD

## Advanced Usage

### Custom Agent Configuration

Edit `poppo-repo/config/agents/{agent-name}.json`:

```json
{
  "timeout": 600000,
  "retries": 3,
  "environment": {
    "CUSTOM_VAR": "value"
  }
}
```

### Priority Tasks

Add priority flag when creating tasks:

```
Poppo, urgent: fix the production bug in error handling
```

### Batch Operations

Submit multiple related tasks:

```
Poppo, batch tasks:
1. Update all dependencies
2. Run security audit
3. Fix any vulnerabilities found
```

## Best Practices

1. **Keep Tasks Focused**: One feature per task
2. **Use Clear Descriptions**: Be specific about requirements
3. **Check Status Regularly**: Monitor long-running tasks
4. **Review PRs**: Even with automation, human review is valuable
5. **Backup State**: Regular backups of poppo-repo

## Next Steps

- Read the [Architecture Overview](../architecture/system-overview.md)
- Learn about [Agent Roles](../architecture/agents.md)
- Contribute to PoppoBuilder itself!