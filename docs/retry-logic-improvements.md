# Retry Logic Improvements (Issue #274)

## Overview

This document describes the improvements made to the retry logic to prevent infinite task queue growth and resource exhaustion.

## Problems Solved

1. **Infinite Queue Growth**: Failed tasks were re-queued without limits
2. **No Backoff Strategy**: Immediate retries caused rapid failure loops
3. **Duplicate Tasks**: Same task could exist multiple times in queue
4. **No Error Type Handling**: All errors treated the same way

## Implementation Details

### 1. RetryManager Class

A new `RetryManager` class handles all retry logic:

```javascript
const retryManager = new RetryManager({
  maxRetries: 3,          // Default max retry attempts
  baseDelay: 1000,        // 1 second base delay
  maxDelay: 300000,       // 5 minute max delay
  backoffFactor: 2        // Exponential backoff factor
});
```

### 2. Error Type Policies

Different error types have different retry strategies:

- **RATE_LIMIT**: Max 5 retries, 1 minute base delay, 1.5x backoff
- **LOCK_ERROR**: No retries (0 max retries)
- **NETWORK_ERROR**: Max 3 retries, 5 second base delay, 2x backoff
- **AUTH_ERROR**: Max 1 retry, 1 second delay
- **DEFAULT**: Uses configured defaults

### 3. Exponential Backoff

Retry delays increase exponentially with jitter:

```
delay = min(baseDelay * backoffFactor^attempts, maxDelay) + jitter
```

### 4. Duplicate Prevention

Enhanced duplicate checking in TaskQueue:

- `hasDuplicateTask()`: Checks both queued and running tasks
- Checks by issue number for issue tasks
- Checks by comment ID for comment tasks
- Prevents re-queuing of tasks already being processed

### 5. Retry Information Tracking

Each task's retry history is tracked:
- Number of attempts
- Timestamps of attempts
- Error types encountered
- Automatic cleanup of old retry info

## Configuration

Add to your config.json:

```json
{
  "retry": {
    "maxRetries": 3,
    "baseDelay": 1000,
    "maxDelay": 300000,
    "backoffFactor": 2
  }
}
```

## Benefits

1. **Resource Protection**: Prevents queue from growing infinitely
2. **Smart Retries**: Different strategies for different error types
3. **Prevents Duplicates**: No multiple copies of same task
4. **Better Observability**: Retry statistics and logging
5. **Automatic Cleanup**: Old retry information is cleaned up

## Monitoring

The system logs retry statistics every 10 minutes:

```
リトライ統計: アクティブ=2, 総試行回数=5
```

## Testing

To test the retry logic:

1. Trigger a rate limit error
2. Observe exponential backoff in logs
3. Verify task is not duplicated in queue
4. Check that max retries are respected

## Future Improvements

- Persistent retry state across restarts
- Configurable error type policies
- Retry metrics dashboard integration
- Dead letter queue for permanently failed tasks