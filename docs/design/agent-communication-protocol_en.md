# Agent Communication Protocol Design

## Overview

A protocol specification that standardizes communication between PoppoBuilder agents.

## Protocol Version

- Current: v1.0 (Phase 1 - File-based)
- Future: v2.0 (Phase 2 - Message Queue)

## Message Types

### 1. Task Assignment (TASK_ASSIGNMENT)
```json
{
  "type": "TASK_ASSIGNMENT",
  "taskId": "issue-27",
  "issueNumber": 27,
  "assignedTo": "CCPM",
  "priority": "high",
  "taskType": "code-review",
  "deadline": "2025-06-16T12:00:00Z",
  "context": {
    "issueTitle": "Agent Separation Architecture Implementation",
    "issueBody": "...",
    "labels": ["task:dogfooding"]
  }
}
```

### 2. Task Accepted (TASK_ACCEPTED)
```json
{
  "type": "TASK_ACCEPTED",
  "taskId": "issue-27",
  "acceptedBy": "CCPM",
  "estimatedDuration": 3600000,
  "startTime": "2025-06-16T10:00:00Z"
}
```

### 3. Progress Update (PROGRESS_UPDATE)
```json
{
  "type": "PROGRESS_UPDATE",
  "taskId": "issue-27",
  "agent": "CCPM",
  "progress": 50,
  "status": "processing",
  "message": "Performing code review",
  "details": {
    "filesAnalyzed": 10,
    "issuesFound": 3
  }
}
```

### 4. Task Completed (TASK_COMPLETED)
```json
{
  "type": "TASK_COMPLETED",
  "taskId": "issue-27",
  "agent": "CCPM",
  "completionTime": "2025-06-16T11:00:00Z",
  "result": {
    "success": true,
    "output": "Review results",
    "metrics": {
      "codeQuality": 85,
      "suggestions": 5
    }
  }
}
```

### 5. Error Notification (ERROR_NOTIFICATION)
```json
{
  "type": "ERROR_NOTIFICATION",
  "taskId": "issue-27",
  "agent": "CCPM",
  "errorCode": "TIMEOUT",
  "errorMessage": "Processing timed out",
  "retryable": true,
  "timestamp": "2025-06-16T11:00:00Z"
}
```

### 6. Heartbeat (HEARTBEAT)
```json
{
  "type": "HEARTBEAT",
  "agent": "CCPM",
  "status": "healthy",
  "timestamp": "2025-06-16T10:00:00Z",
  "metrics": {
    "cpuUsage": 45,
    "memoryUsage": 60,
    "activeTasks": 2
  }
}
```

## Communication Flow

### Basic Task Processing Flow

1. **Core → Agent**: TASK_ASSIGNMENT
2. **Agent → Core**: TASK_ACCEPTED
3. **Agent → Core**: PROGRESS_UPDATE (multiple times)
4. **Agent → Core**: TASK_COMPLETED

### Error Handling Flow

1. **Core → Agent**: TASK_ASSIGNMENT
2. **Agent → Core**: TASK_ACCEPTED
3. **Agent → Core**: ERROR_NOTIFICATION
4. **Core → Agent**: TASK_ASSIGNMENT (retry)

## Phase 1 Implementation Details (File-based)

### Directory Structure
```
messages/
├── core/
│   ├── inbox/
│   └── outbox/
├── ccpm/
│   ├── inbox/
│   └── outbox/
└── ccag/
    ├── inbox/
    └── outbox/
```

### Message File Naming Convention
```
{timestamp}_{messageId}_{type}.json

Example: 20250616100000_abc123_TASK_ASSIGNMENT.json
```

### Polling Intervals
- Normal: 5 seconds
- High load: 1 second
- Idle: 10 seconds

## Error Handling

### Error Codes
- `TIMEOUT`: Timeout
- `INVALID_MESSAGE`: Invalid message format
- `AGENT_UNAVAILABLE`: Agent not responding
- `RESOURCE_LIMIT`: Resource limitation
- `INTERNAL_ERROR`: Internal error

### Retry Policy
- Maximum retry count: 3
- Retry interval: Exponential backoff (1s, 2s, 4s)
- Retryable errors: TIMEOUT, AGENT_UNAVAILABLE

## Security

### Phase 1
- Control through filesystem access permissions
- Dedicated directory for each agent

### Phase 2 and Beyond
- Message signatures
- Encrypted communication
- Authentication tokens

## Performance Optimization

### Batch Processing
- Combine multiple small messages into one
- Maximum batch size: 10 messages
- Batch timeout: 1 second

### Message Compression
- Auto-compress payloads larger than 1KB
- Compression algorithm: gzip

## Monitoring

### Metrics
- Messages sent per second
- Message processing time
- Error rate
- Queue size (Phase 2)

### Logging
- Log all message send/receive operations
- Detailed error logs
- Performance logs