# PoppoBuilder Suite Implementation Plan

## Overview

This document outlines the phased implementation approach for PoppoBuilder Suite, focusing on rapid MVP delivery and self-hosting capabilities.

## Phase 1: Minimal Viable Product (Week 1)

### Goals
- Basic task execution capability
- Simple state management
- Manual testing workflow

### Deliverables

#### 1.1 Basic CICD Scheduler
```
cicd/
├── scheduler.js        # Main scheduler loop
├── job-manager.js      # Job lifecycle management
└── process-spawn.js    # Claude subprocess handling
```

Key Features:
- Poll Poppo repository every 30 seconds
- Spawn Claude subprocesses for tasks
- Track process status
- Basic error handling

#### 1.2 Minimal Poppo Repository
```
poppo-repo/
├── config.json         # System configuration
├── tasks/              # Task queue
├── status/             # Job status tracking
└── results/            # Job outputs
```

#### 1.3 Simple CCPM Implementation
- Read task requests
- Generate basic instruction documents
- Update task queue

#### 1.4 Simple CCAG Implementation  
- Execute implementation tasks
- Create files
- Basic error reporting

### Success Criteria
- Can submit a task via MCP
- Task gets executed by CCAG
- Result is retrievable

## Phase 2: Self-Hosting Bootstrap (Week 2)

### Goals
- PoppoBuilder working on its own codebase
- GitHub integration
- Basic PR workflow

### Deliverables

#### 2.1 CCGM Implementation
- Project initialization
- Configuration management
- Status reporting
- Issue creation from tasks

#### 2.2 Enhanced CCAG
- Git operations (branch, commit, push)
- PR creation
- Self-modification capability

#### 2.3 Task Dependency System
- Task ordering
- Dependency resolution
- Parallel execution where possible

### Success Criteria
- PoppoBuilder can add features to itself
- PRs are created automatically
- Basic development loop established

## Phase 3: Full Automation (Week 3-4)

### Goals
- Complete agent ensemble
- Automated review and merge
- Production-ready system

### Deliverables

#### 3.1 CCRA (Review Agent)
- PR review capability
- Code quality checks
- Feedback generation

#### 3.2 CCTA (Test Agent)
- Test execution
- Coverage reporting
- Performance validation

#### 3.3 CCMA (Merge Agent)
- Merge decision logic
- Conflict detection
- Branch management

#### 3.4 Advanced CICD Features
- Resource management
- Priority queuing
- Failure recovery
- Performance monitoring

### Success Criteria
- Full automated development pipeline
- Self-improving system
- Production stability

## Implementation Guidelines

### 1. Start Simple
- Use JSON files for all data storage
- Avoid premature optimization
- Focus on working end-to-end flow

### 2. Iterative Development
- Each component should work standalone
- Test manually before automating
- Document as you go

### 3. Self-Hosting Priority
- As soon as basic CCPM/CCAG work, use them
- Create issues for remaining features
- Let the system build itself

### 4. Error Handling
- Fail gracefully
- Log everything
- Make debugging easy

## Technical Decisions

### Language Choice
- **CICD System**: Node.js (for process management)
- **Configuration**: JSON (simple and universal)
- **Agent Communication**: File-based (simple and debuggable)

### Process Management
```javascript
// Example subprocess spawn
const { spawn } = require('child_process');

function runAgent(agentType, instruction) {
  const subprocess = spawn('claude', [
    '--dangerously-skip-permissions',
    '--print',
    JSON.stringify(instruction)
  ], {
    cwd: process.cwd(),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  
  subprocess.unref(); // Allow parent to exit
  return subprocess.pid;
}
```

### State Management
```javascript
// Simple file-based state
const state = {
  jobs: {},
  queue: [],
  
  save() {
    fs.writeFileSync('poppo-repo/status/state.json', 
      JSON.stringify(this, null, 2));
  },
  
  load() {
    Object.assign(this, 
      JSON.parse(fs.readFileSync('poppo-repo/status/state.json')));
  }
};
```

## Risk Mitigation

### 1. Subprocess Management
- Track PIDs for cleanup
- Implement timeout mechanisms
- Handle zombie processes

### 2. State Corruption
- Atomic file writes
- Backup before updates
- Recovery procedures

### 3. Infinite Loops
- Task limits per day
- Circular dependency detection
- Manual override capability

## Metrics for Success

### Phase 1
- Time to execute first task: < 5 minutes
- Task success rate: > 80%
- System setup time: < 30 minutes

### Phase 2  
- Self-modification success rate: > 70%
- PR creation success: > 90%
- Autonomous operation time: > 4 hours

### Phase 3
- Full pipeline completion: < 1 hour
- Merge success rate: > 85%
- System stability: > 24 hours continuous operation