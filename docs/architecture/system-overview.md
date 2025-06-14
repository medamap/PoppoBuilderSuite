# PoppoBuilder Suite System Architecture

## Core Concept

PoppoBuilder Suite is designed to maximize Claude Code's capabilities while minimizing context window usage through a distributed, asynchronous architecture.

## System Components

### 1. User Interface Layer

#### MCP Interface
- Receives commands from Claude Code main session
- Manages asynchronous job submission
- Returns job IDs for status tracking
- Non-blocking operation

#### CCGM (Claude Code General Manager)
- Project configuration management
- Status reporting
- User interaction handling
- Poppo repository management

### 2. State Management Layer

#### Poppo Repository
Central state storage containing:
- Project configurations
- Task queues
- Job status
- Agent coordination data
- Build artifacts

Structure:
```
poppo-repo/
├── config/
│   ├── system.json        # System-wide configuration
│   ├── projects/          # Per-project configurations
│   └── agents/            # Agent-specific settings
├── status/
│   ├── jobs.json          # Active job tracking
│   ├── queue.json         # Pending tasks
│   └── history/           # Completed job logs
└── projects/
    └── {project-id}/
        ├── tasks/         # Task definitions
        ├── issues/        # GitHub issue mirrors
        └── artifacts/     # Build outputs
```

### 3. Automation Layer

#### Resident CICD
- Runs as a background process
- Monitors Poppo repository for new tasks
- Spawns Claude Code subprocesses for agents
- Manages process lifecycle
- Handles job queuing and scheduling

Key Features:
- Non-blocking subprocess execution
- Process health monitoring
- Resource management
- Crash recovery

#### Agent Orchestra

**CCPM (Project Manager)**
- Reads project state from Poppo repository
- Generates task breakdown
- Creates instruction documents
- Updates task queue

**CCAG (Implementation Agent)**
- Executes implementation tasks
- Creates feature branches
- Generates pull requests
- Updates task status

**CCRA (Review Agent)**
- Reviews pull requests
- Checks code quality
- Provides improvement suggestions
- Updates PR status

**CCTA (Test Agent)**
- Runs test suites
- Validates implementations
- Reports test results
- Updates quality metrics

**CCMA (Merge Agent)**
- Evaluates merge readiness
- Handles PR merging
- Manages branch cleanup
- Updates project state

## Process Flow

### 1. Task Submission
```
User → Claude Code → MCP → CCGM → Poppo Repository
                              ↓
                         Task Queue
```

### 2. Task Execution
```
CICD Monitor → Detects new task → Spawns appropriate agent
                                          ↓
                                   Claude subprocess
                                          ↓
                                   Updates Poppo repo
```

### 3. Status Checking
```
User → "Check status" → MCP → Read Poppo repo → Format report
                                      ↓
                               Return to user
```

## Key Design Decisions

### 1. Asynchronous Execution
- MCP returns immediately after job submission
- No blocking on long-running tasks
- Status checking is a separate operation

### 2. Subprocess Isolation
- Each agent runs in its own Claude Code process
- Clean context for each task
- No context pollution between tasks

### 3. File-Based State Management
- Simple JSON files for state storage
- Easy debugging and manual intervention
- No database dependencies

### 4. Self-Hosting Capability
- PoppoBuilder can work on its own codebase
- Same workflow for all projects
- Dogfooding from early stages

## Communication Patterns

### 1. Agent to Repository
- Agents read tasks from designated directories
- Write results to status files
- Use file locks for coordination

### 2. CICD to Agents
```javascript
// Spawn pattern
const agent = spawn('claude', [
  '--dangerously-skip-permissions',
  '--print',
  JSON.stringify(instruction)
], {
  cwd: projectPath,
  detached: true
});
```

### 3. User to System
- Natural language commands via Claude Code
- Structured responses for clarity
- Progress tracking via job IDs

## Scalability Considerations

### 1. Parallel Execution
- Multiple agents can run simultaneously
- Job dependencies tracked in Poppo repository
- Resource limits configurable

### 2. Queue Management
- Priority-based task scheduling
- Dependency resolution
- Retry mechanisms

### 3. Performance Optimization
- Minimal context per agent session
- Efficient state updates
- Lazy loading of project data