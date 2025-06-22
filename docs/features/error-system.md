# Error Code and Message Catalog System

## Overview

This document describes the comprehensive error handling system implemented in PoppoBuilder Suite. The system provides structured error management with multilingual support, automatic recovery, and intelligent retry mechanisms.

## Architecture

### Core Components

1. **Error Codes** (`lib/errors/error-codes.js`): Centralized error code definitions
2. **PoppoError** (`lib/errors/poppo-error.js`): Enhanced error class with i18n support
3. **ErrorHandler** (`lib/errors/error-handler.js`): Centralized error processing with recovery
4. **Message Catalog**: Multilingual error message translations

### Key Features

- **Structured Error Codes**: 108 standardized error codes across 9 categories
- **Multilingual Support**: Automatic error message translation (English/Japanese)
- **Metadata-Driven**: Rich error metadata for intelligent handling
- **Recovery System**: Automatic error recovery with custom callbacks
- **Retry Logic**: Intelligent retry with exponential backoff
- **Statistics**: Error tracking and analytics
- **Integration**: Seamless integration with existing i18n logging system

## Error Code System

### Code Structure

Error codes follow the pattern `EXXXX` where the first digit indicates category:

- **1XXX**: System/Configuration errors (E1001-E1012)
- **2XXX**: GitHub API errors (E2001-E2012)
- **3XXX**: Claude API errors (E3001-E3012)
- **4XXX**: Task/Queue errors (E4001-E4012)
- **5XXX**: Agent errors (E5001-E5012)
- **6XXX**: File/IO errors (E6001-E6012)
- **7XXX**: Process errors (E7001-E7012)
- **8XXX**: Database/State errors (E8001-E8012)
- **9XXX**: Network/Communication errors (E9001-E9012)

### Error Metadata

Each error code includes metadata:

```javascript
{
  category: 'system',        // Error category
  severity: 'critical',      // critical, high, medium, low, info
  recoverable: false,        // Can this error be recovered from?
  retryable: false          // Should this error be retried?
}
```

### Example Error Codes

```javascript
// System errors
ERROR_CODES.CONFIG_FILE_NOT_FOUND = 'E1002'
ERROR_CODES.MEMORY_LIMIT_EXCEEDED = 'E1011'

// GitHub errors  
ERROR_CODES.GITHUB_RATE_LIMIT_EXCEEDED = 'E2004'
ERROR_CODES.GITHUB_TOKEN_EXPIRED = 'E2003'

// Claude errors
ERROR_CODES.CLAUDE_SESSION_EXPIRED = 'E3003'
ERROR_CODES.CLAUDE_CONTEXT_LIMIT_EXCEEDED = 'E3007'

// Task errors
ERROR_CODES.TASK_TIMEOUT = 'E4003'
ERROR_CODES.QUEUE_FULL = 'E4006'
```

## PoppoError Class

### Basic Usage

```javascript
const { PoppoError, ERROR_CODES } = require('./lib/errors');

// Create a new error
const error = new PoppoError(
  ERROR_CODES.CONFIG_FILE_NOT_FOUND,
  { path: '/config.json' }
);

console.log(error.message);  // "Configuration file not found: /config.json"
console.log(error.code);     // "E1002"
console.log(error.category); // "system"
console.log(error.severity); // "high"
```

### Factory Methods

```javascript
const { systemError, githubError, claudeError } = require('./lib/errors');

// System error
const sysErr = systemError(ERROR_CODES.MEMORY_LIMIT_EXCEEDED, {
  usage: 512,
  limit: 256
});

// GitHub error
const ghErr = githubError(ERROR_CODES.GITHUB_RATE_LIMIT_EXCEEDED, {
  remaining: 0,
  limit: 5000,
  resetTime: '2025-06-22T01:00:00Z'
});

// Claude error
const claudeErr = claudeError(ERROR_CODES.CLAUDE_SESSION_EXPIRED, {
  expiredAt: new Date().toISOString()
});
```

### Error Wrapping

```javascript
const { wrapError } = require('./lib/errors');

try {
  fs.readFileSync('/nonexistent.txt');
} catch (originalError) {
  // Wrap with PoppoError
  const wrapped = wrapError(
    originalError,
    ERROR_CODES.FILE_READ_FAILED,
    { path: '/nonexistent.txt' }
  );
  
  // Original error is preserved in 'cause' property
  console.log(wrapped.cause.message); // Original error message
}
```

### Multilingual Support

```javascript
// Get message in specific language
const error = new PoppoError(ERROR_CODES.TASK_TIMEOUT, {
  taskId: 'task-123',
  timeout: 30000
});

const englishMsg = error.getLocalizedMessage('en');
const japaneseMsg = error.getLocalizedMessage('ja');

console.log(englishMsg); // "Task timeout: task-123 exceeded 30000ms"
console.log(japaneseMsg); // "タスクタイムアウト: task-123が30000msを超過"
```

### Serialization

```javascript
// Convert to JSON for logging/API responses
const errorJson = error.toJSON();
console.log(JSON.stringify(errorJson, null, 2));
```

## ErrorHandler Class

### Basic Setup

```javascript
const { createErrorHandler } = require('./lib/errors');

const errorHandler = createErrorHandler({
  enableRetry: true,
  enableRecovery: true,
  maxRetries: 3,
  retryDelay: 1000
});
```

### Error Handling

```javascript
async function handleOperation() {
  try {
    // Some operation that might fail
    await riskyOperation();
  } catch (error) {
    // Handle with comprehensive error processing
    const result = await errorHandler.handleError(error, {
      operation: 'data_processing',
      userId: 'user-123'
    });
    
    if (result.success) {
      console.log('Error recovered successfully');
    } else {
      console.log(`Error handling failed: ${result.strategy}`);
    }
  }
}
```

### Retry with Exponential Backoff

```javascript
const result = await errorHandler.executeWithRetry(async (attempt) => {
  console.log(`Attempt ${attempt + 1}`);
  
  // Operation that might fail
  const response = await api.call();
  return response;
}, {
  operation: 'api_call',
  maxRetries: 5
});
```

### Custom Recovery

```javascript
// Register custom recovery for specific errors
errorHandler.registerRecovery(
  ERROR_CODES.FILE_NOT_FOUND,
  async (error, context) => {
    // Create missing file
    const path = context.path;
    await fs.writeFile(path, '', 'utf8');
    return { recovered: true, action: 'created_file' };
  }
);

// Register recovery for multiple error codes
errorHandler.registerRecovery(
  [ERROR_CODES.NETWORK_TIMEOUT, ERROR_CODES.NETWORK_CONNECTION_FAILED],
  async (error, context) => {
    // Wait and retry network operation
    await sleep(5000);
    return { recovered: true, action: 'waited_for_network' };
  }
);
```

### Error Statistics

```javascript
// Get error statistics
const stats = errorHandler.getStats();
console.log('Error Statistics:', stats);

// Output:
// {
//   "E2004": { count: 5, category: "github", severity: "medium" },
//   "E3003": { count: 2, category: "claude", severity: "high" }
// }

// Reset statistics
errorHandler.resetStats();
```

### Error Response Formatting

```javascript
// Create standardized API error response
const errorResponse = errorHandler.formatErrorResponse(error, {
  requestId: 'req-12345',
  userId: 'user-789'
});

console.log(errorResponse);
// {
//   success: false,
//   error: {
//     code: "E1002",
//     message: "Configuration file not found: /config.json",
//     category: "system",
//     severity: "high",
//     recoverable: true,
//     retryable: false,
//     timestamp: "2025-06-22T00:00:00.000Z",
//     context: { requestId: "req-12345", userId: "user-789" }
//   }
// }
```

## Message Translations

### Translation Structure

Error messages support variable interpolation using `{{variable}}` syntax:

**English** (`locales/en/errors.json`):
```json
{
  "e1002": "Configuration file not found: {{path}}",
  "e2004": "GitHub API rate limit exceeded: {{remaining}}/{{limit}} (resets {{resetTime}})",
  "e4003": "Task timeout: {{taskId}} exceeded {{timeout}}ms"
}
```

**Japanese** (`locales/ja/errors.json`):
```json
{
  "e1002": "設定ファイルが見つかりません: {{path}}",
  "e2004": "GitHub APIレート制限を超過しました: {{remaining}}/{{limit}} ({{resetTime}}にリセット)",
  "e4003": "タスクタイムアウト: {{taskId}}が{{timeout}}msを超過"
}
```

### Adding New Error Messages

1. Add error code to `ERROR_CODES`
2. Add metadata to `ERROR_METADATA`
3. Add English translation to `locales/en/errors.json`
4. Add Japanese translation to `locales/ja/errors.json`

```javascript
// 1. Add to error-codes.js
const ERROR_CODES = {
  // ... existing codes
  NEW_ERROR_TYPE: 'E1013'
};

const ERROR_METADATA = {
  // ... existing metadata
  [ERROR_CODES.NEW_ERROR_TYPE]: {
    category: ERROR_CATEGORIES.SYSTEM,
    severity: ERROR_SEVERITY.MEDIUM,
    recoverable: true,
    retryable: false
  }
};
```

```json
// 2. Add to locales/en/errors.json
{
  "e1013": "New error occurred: {{details}}"
}

// 3. Add to locales/ja/errors.json  
{
  "e1013": "新しいエラーが発生しました: {{details}}"
}
```

## Integration Examples

### With Existing Logger

```javascript
const LoggerFactory = require('./lib/utils/logger-factory');
const { createErrorHandler, systemError, ERROR_CODES } = require('./lib/errors');

const logger = LoggerFactory.createI18n('MyModule');
const errorHandler = createErrorHandler({ logger });

async function processTask(taskId) {
  try {
    // Process task
    await performTaskOperation(taskId);
  } catch (error) {
    // Create structured error
    const taskError = systemError(ERROR_CODES.TASK_EXECUTION_FAILED, {
      taskId,
      error: error.message
    }, error);
    
    // Handle with logging
    await errorHandler.handleError(taskError, { taskId });
    
    // Log using i18n logger
    await logger.logTask(taskId, 'failed', { 
      error: taskError.code,
      message: taskError.message 
    });
  }
}
```

### With Express.js Middleware

```javascript
const express = require('express');
const { createErrorHandler, wrapError, ERROR_CODES } = require('./lib/errors');

const app = express();
const errorHandler = createErrorHandler();

// Error handling middleware
app.use(async (err, req, res, next) => {
  // Wrap generic errors with PoppoError
  const poppoError = err.code ? err : wrapError(
    err,
    ERROR_CODES.SYSTEM_INITIALIZATION_FAILED,
    { endpoint: req.path, method: req.method }
  );
  
  // Handle error
  const result = await errorHandler.handleError(poppoError, {
    requestId: req.id,
    userId: req.user?.id,
    endpoint: req.path
  });
  
  // Format response
  const response = errorHandler.formatErrorResponse(poppoError, {
    requestId: req.id
  });
  
  res.status(500).json(response);
});
```

### With Agent Systems

```javascript
const { agentError, ERROR_CODES, createErrorHandler } = require('./lib/errors');

class BaseAgent {
  constructor(name) {
    this.name = name;
    this.errorHandler = createErrorHandler({
      enableRecovery: true,
      maxRetries: 3
    });
    
    // Register agent-specific recovery
    this.errorHandler.registerRecovery(
      ERROR_CODES.AGENT_HEALTH_CHECK_FAILED,
      this.recoverFromHealthFailure.bind(this)
    );
  }
  
  async executeTask(task) {
    try {
      return await this.performTask(task);
    } catch (error) {
      const agentErr = agentError(ERROR_CODES.AGENT_TASK_ASSIGNMENT_FAILED, {
        agent: this.name,
        taskId: task.id
      }, error);
      
      const result = await this.errorHandler.handleError(agentErr, {
        agent: this.name,
        task: task.id
      });
      
      if (!result.success) {
        throw agentErr;
      }
      
      return result.result;
    }
  }
  
  async recoverFromHealthFailure(error, context) {
    // Custom recovery logic for health check failures
    console.log(`Recovering agent ${this.name} from health failure...`);
    await this.restart();
    return { recovered: true, action: 'agent_restart' };
  }
}
```

## Testing

### Running Tests

```bash
# Test the complete error system
npm run test:errors

# Output shows comprehensive testing:
# - Error code enumeration
# - PoppoError creation and metadata
# - Error wrapping and localization  
# - ErrorHandler functionality
# - Retry logic and recovery
# - Statistics and formatting
```

### Manual Testing

```javascript
const { testErrorSystem } = require('./test/test-error-system');

// Run comprehensive test suite
await testErrorSystem();
```

### Custom Test Cases

```javascript
const { createError, ERROR_CODES, createErrorHandler } = require('./lib/errors');

// Test error creation
const error = createError(ERROR_CODES.GITHUB_RATE_LIMIT_EXCEEDED, {
  remaining: 0,
  limit: 5000
});

console.log('Error Code:', error.code);
console.log('Is Retryable:', error.isRetryable());
console.log('Category:', error.getCategory());

// Test error handling
const handler = createErrorHandler();
const result = await handler.handleError(error);
console.log('Handling Result:', result);
```

## Best Practices

### Error Code Usage

1. **Use Appropriate Categories**: Choose the most specific category for new errors
2. **Descriptive Messages**: Include relevant context data in error messages
3. **Consistent Severity**: Use severity levels consistently across similar operations
4. **Proper Metadata**: Set retryable/recoverable flags based on actual error nature

### Error Handling

1. **Wrap Generic Errors**: Convert generic JavaScript errors to PoppoErrors
2. **Provide Context**: Include relevant operation context when handling errors
3. **Log Appropriately**: Use severity-appropriate logging levels
4. **Handle Gracefully**: Implement proper recovery strategies where possible

### Translation Guidelines

1. **Natural Language**: Write error messages that sound natural in each language
2. **Technical Accuracy**: Maintain technical accuracy while being user-friendly
3. **Consistent Terminology**: Use consistent technical terms across all messages
4. **Variable Formatting**: Format interpolated variables appropriately for each language

### Performance Considerations

1. **Minimal Overhead**: Error creation has minimal performance impact
2. **Translation Caching**: Error message translations are cached automatically
3. **Recovery Timeouts**: Set appropriate timeouts for recovery operations
4. **Statistics Cleanup**: Periodically reset error statistics to prevent memory growth

## Future Enhancements

### Planned Features

- **Custom Severities**: User-defined severity levels for specific domains
- **Error Chaining**: Support for complex error cause chains
- **External Notifications**: Integration with external alerting systems
- **ML-Based Recovery**: Machine learning-powered recovery suggestions
- **Performance Metrics**: Built-in performance tracking for error handling

### Extension Points

- Add new error categories by extending `ERROR_CATEGORIES`
- Implement custom recovery strategies via `registerRecovery()`
- Add new languages by creating translation files
- Integrate with external monitoring systems via custom handlers
- Extend metadata with domain-specific properties

## Troubleshooting

### Common Issues

1. **Missing Translations**: Falls back to error code if translation not found
2. **I18n Not Initialized**: Raw error codes used if i18n system unavailable
3. **Recovery Failures**: Errors in recovery callbacks are caught and logged
4. **Memory Usage**: Error statistics grow unbounded without periodic cleanup

### Debugging

Enable debug logging to trace error handling:

```bash
DEBUG=error* npm start
```

Check error statistics periodically:

```javascript
const stats = errorHandler.getStats();
console.log('Error Statistics:', stats);
```

Verify error message translations:

```javascript
const error = createError(ERROR_CODES.TASK_TIMEOUT, { taskId: 'test' });
console.log('EN:', error.getLocalizedMessage('en'));
console.log('JA:', error.getLocalizedMessage('ja'));
```

---

This error system provides a robust foundation for handling all types of errors in PoppoBuilder Suite while maintaining excellent user experience through multilingual support and intelligent recovery mechanisms.