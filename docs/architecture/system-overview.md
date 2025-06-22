# PoppoBuilder Suite System Architecture

## Core Concepts

PoppoBuilder Suite is a fully automated task processing system family that integrates GitHub Issues with Claude CLI. It's designed with independent process management, allowing tasks to continue executing even after the main process restarts.

## System Components

### 1. Main System (PoppoBuilder)

#### Core Features
- GitHub Issue monitoring (5-minute intervals)
- Label-based task detection (`task:misc`, `task:dogfooding`)
- Claude CLI integration and execution
- Continuous dialogue through comment additions
- Independent process management

#### Process Management
- Independent Process Manager (tasks continue after PoppoBuilder restart)
- Task queue management (with priorities)
- Rate limit handling
- Dynamic timeout control

### 2. System Family

#### PoppoBuilder (Poppo-chan) 🚂
- Main automated task processing system
- Issue monitoring and Claude CLI execution
- Independent process management

#### MedamaRepair (Medama-san) 👁️
- PoppoBuilder monitoring and auto-recovery (every minute)
- Process health check
- Automatic restart on anomalies

#### MeraCleaner (Mera-san) 🔥
- Error comment analysis and cleanup (every 30 minutes)
- Duplicate error consolidation
- Error pattern analysis

#### CCLA Agent (Clara-chan) 🤖
- Error log collection and auto-repair (every 5 minutes)
- Phase 1-3 implementation (detection → analysis → repair)
- Learning-based error pattern recognition

#### CCAG Agent (Kagura-chan) 📝
- Documentation generation and multilingual support
- API documentation generation
- README updates

#### CCPM Agent (Doremi-chan) 🔍
- Code review and refactoring suggestions
- Security audits
- Pattern-based issue detection

#### MirinOrphanManager (Mirin-chan) 🎋
- Orphan issue detection and management (at :03 and :33 every hour)
- Abandoned issue cleanup
- Status verification

### 3. Data Structure

```
PoppoBuilderSuite/
├── config/
│   ├── config.json         # System configuration
│   └── daemon-config.json  # Daemon configuration
├── .poppo/
│   ├── config.json         # Language settings (ja/en)
│   ├── traceability.yaml   # Traceability data
│   ├── processed-errors.json # Processed error records
│   └── learning-data.json  # Learning data
├── logs/
│   ├── poppo-*.log         # General logs
│   ├── issue-*.log         # Issue-specific logs
│   ├── processes-*.log     # Process logs
│   ├── running-tasks.json  # Running task states
│   └── process-state.json  # Process states
├── temp/
│   ├── instruction-*.txt   # Claude instruction files
│   ├── task-*.pid         # Process IDs
│   ├── task-*.status      # Task statuses
│   └── task-*.result      # Execution results
└── messages/              # Inter-agent communication
    ├── core/inbox/
    ├── ccpm/inbox/
    └── ccag/inbox/
```

## Process Flow

### 1. Issue Processing Flow
```
GitHub Issue (with labels)
        ↓
PoppoBuilder (polling every 5 minutes)
        ↓
Task Queue (with priorities)
        ↓
Independent Process Manager
        ↓
Claude CLI (independent process)
        ↓
GitHub Comment Post
```

### 2. Comment Dialogue Flow
```
Issue Processing Complete → awaiting-response label
        ↓
User adds comment
        ↓
PoppoBuilder detects
        ↓
Execute Claude with context
        ↓
Post response comment
```

### 3. Error Processing Flow
```
Error occurs → Log output
        ↓
CCLA Agent detects (every 5 minutes)
        ↓
Error pattern analysis
        ↓
Auto-repair attempt or Issue creation
        ↓
Learning data update
```

## Key Design Decisions

### 1. Independent Process Management
- Tasks run as independent processes
- Continue execution after PoppoBuilder restart
- Process tracking via PID files
- Asynchronous result retrieval via result files

### 2. Priority Task Queue
- Dogfooding tasks have highest priority (100)
- Regular tasks have priority 50
- FIFO + priority-based scheduling

### 3. Rate Limit Handling
- Automatic GitHub/Claude API rate limit management
- Exponential backoff implementation
- Pre-check to prevent unnecessary launches

### 4. Dynamic Timeout
- Automatic adjustment based on task complexity
- Learning feature based on execution history
- Sufficient time allocation for dogfooding

### 5. Agent Separation
- Functionally specialized agents
- File-based messaging
- Horizontal scaling ready design

## Current Implementation Status

### ✅ Implemented Features
1. **Basic Features**
   - Automatic Issue processing
   - Independent process management
   - Comment addition support
   - Dogfooding auto-restart
   - Multilingual support (ja/en)

2. **Advanced Features**
   - Process management dashboard
   - Enhanced rate limit handling
   - Dynamic timeout control
   - Error log collection (Phase 1-3)
   - Traceability features (Phase 1-3)
   - Notification features (Discord/Pushover/Telegram)
   - Agent separation architecture

3. **Operational Features**
   - Multi-project support
   - Global queue management
   - Dashboard with authentication
   - Consistency audit features

### 🚧 Future Extensions
- Kubernetes support
- Real-time sync via Webhooks
- Machine learning optimization

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        GitHub Issues                         │
│  ┌────────────┐ ┌────────────────┐ ┌──────────────────┐   │
│  │task:misc   │ │task:dogfooding │ │awaiting-response│   │
│  └────────────┘ └────────────────┘ └──────────────────┘   │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    ┌──────▼──────┐
                    │ PoppoBuilder│
                    │   (Main)    │
                    └──────┬──────┘
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
    ┌────▼────┐      ┌────▼────┐      ┌────▼────┐
    │TaskQueue│      │Process  │      │Dashboard│
    │Manager  │      │Manager  │      │Server   │
    └─────────┘      └────┬────┘      └─────────┘
                          │
                ┌─────────┴─────────┐
                │                   │
          ┌─────▼─────┐      ┌─────▼─────┐
          │Independent│      │  Claude   │
          │ Process   │      │    CLI    │
          └───────────┘      └───────────┘
```