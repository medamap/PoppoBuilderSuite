# Agent Separation Architecture

## Overview

A distributed architecture that separates PoppoBuilder processing into functional agents, with each agent responsible for specialized processing.

## Agent Configuration

### 1. PoppoBuilder Core (Coordinator)
- Overall orchestration and coordination
- Issue distribution
- Inter-agent coordination control
- Final result aggregation

### 2. CCPM (Code Change Process Manager)
- Code review
- Modification suggestions
- Code quality checks
- Refactoring proposals

### 3. CCAG (Code Change Assistant Generator)
- Documentation generation
- Comment creation
- README/design document updates
- Multi-language support

### 4. CCQA (Code Change Quality Assurance) *To be implemented in Phase 2
- Test execution
- Quality checks
- Security inspection
- Performance analysis

## Inter-Agent Communication

### Phase 1: Inter-Process Communication (IPC)
- Using shared filesystem
- Message exchange via JSON files
- Polling-based monitoring

### Phase 2: Message Queue
- Redis Pub/Sub or RabbitMQ
- Asynchronous messaging
- Event-driven architecture

## Message Format

```json
{
  "id": "unique-message-id",
  "timestamp": "2025-06-16T10:00:00Z",
  "from": "agent-name",
  "to": "agent-name",
  "type": "request|response|notification",
  "taskId": "issue-27",
  "action": "code-review|generate-docs|etc",
  "payload": {
    // Task-specific data
  },
  "status": "pending|processing|completed|failed",
  "result": {
    // Processing results
  }
}
```

## Directory Structure

```
agents/
├── core/           # PoppoBuilder Core
├── ccpm/           # Code Change Process Manager
├── ccag/           # Code Change Assistant Generator
└── shared/         # Shared libraries and utilities
    ├── messaging/  # Messaging functionality
    └── config/     # Common configuration

messages/           # For message exchange in Phase 1
├── inbox/         # Inbox for each agent
└── outbox/        # Outbox for each agent
```

## Implementation Phases

### Phase 1: Basic Implementation (Current)
1. Agent base class creation
2. CCPM and CCAG agent implementation
3. File-based messaging
4. Basic task distribution

### Phase 2: Message Queue Introduction
1. Redis/RabbitMQ integration
2. Asynchronous messaging
3. Event-driven implementation

### Phase 3: Scaling Features
1. Dynamic agent startup
2. Load balancing
3. Health checks

### Phase 4: Containerization
1. Docker support
2. Kubernetes integration
3. Auto-scaling

## Benefits

1. **Specialization**: Each agent specializes in specific functions
2. **Scalability**: Agents can be scaled up or down as needed
3. **Fault Tolerance**: System continues even if some agents fail
4. **Maintainability**: Individual updates and restarts possible
5. **Performance**: Improved speed through parallel processing

## Security Considerations

1. Inter-agent authentication
2. Message encryption (Phase 2 onwards)
3. Access control
4. Audit logging

## Monitoring

1. Agent status monitoring
2. Message flow visualization
3. Performance metrics
4. Error tracking