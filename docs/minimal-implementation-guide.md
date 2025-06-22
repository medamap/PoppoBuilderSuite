# Minimal Implementation Guide

## Overview
Minimal implementation of PoppoBuilder Suite. Reads GitHub Issues, processes with Claude, and returns results.

## Requirements
- Node.js 18 or higher
- `gh` CLI installed and authenticated
- `claude` CLI installed and authenticated

## Usage

### 1. Starting
```bash
npm start
# or
node src/minimal-poppo.js
```

### 2. Creating Issues
Create an issue on GitHub with:
- **Creator**: Repository owner (medamap)
- **Label**: `task:misc`
- **Title**: Overview of the task to execute
- **Body**: Detailed instructions

Example:
```
Title: Add lint script to package.json
Labels: task:misc

Body:
Please add the following to the scripts section of package.json:
"lint": "eslint src/**/*.js"
```

### 3. Processing Flow
1. PoppoBuilder detects the issue
2. Adds `processing` label
3. Executes processing with Claude (works on `work/poppo-builder` branch)
4. Reports results as issue comment
5. Adds `completed` label

### 4. Branch Strategy
All automated processing runs on the `work/poppo-builder` branch.

#### Merge Examples
```
# Example Issue 1
Title: Merge to develop
Body: Please merge the minimal implementation
→ Merges from work/poppo-builder to develop

# Example Issue 2  
Title: Create PR to main
Body: Please create a PR for release preparation
→ Creates PR from work/poppo-builder to main
```

## Configuration
Configurable in `config/config.json`:
- `claude.maxConcurrent`: Maximum concurrent executions (default: 2)
- `claude.timeout`: Timeout duration (default: 300000ms = 5 minutes)
- `polling.interval`: Polling interval (default: 30000ms = 30 seconds)

## Limitations
- Only processes issues from the author
- Requires `task:misc` label
- No phase management (immediate execution)
- No branch management
- No PR creation

## Troubleshooting

### Rate Limit Errors
When Claude's rate limit is reached, automatically waits until the limit resets.

### Process Won't Terminate
Use Ctrl+C to exit. Running Claude processes will also terminate automatically.