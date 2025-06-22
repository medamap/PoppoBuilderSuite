# Internationalized Logging (i18n) Feature

## Overview

This document describes the internationalized logging feature implemented in PoppoBuilder Suite. This feature provides automated translation of log messages into multiple languages while maintaining backward compatibility with existing logging code.

## Architecture

### Components

1. **I18nLogger**: Wrapper class that adds i18n capabilities to existing loggers
2. **LoggerFactory**: Factory class for creating loggers with optional i18n support
3. **Translation Integration**: Uses the existing i18n system for message translation

### Key Features

- **Seamless Integration**: Wraps existing Logger instances without modification
- **Translation Key Support**: Supports both translation keys and raw messages
- **Language Detection**: Automatically detects translation keys vs. raw strings
- **Backward Compatibility**: Works with existing logging code without changes
- **Performance Optimized**: Only translates when necessary

## Usage

### Creating an i18n-enabled Logger

```javascript
const LoggerFactory = require('./lib/utils/logger-factory');

// Create logger with i18n support (default)
const logger = LoggerFactory.create('ModuleName');

// Explicitly create i18n logger
const i18nLogger = LoggerFactory.createI18n('ModuleName');

// Create plain logger (no i18n)
const plainLogger = LoggerFactory.createPlain('ModuleName');
```

### Wrapping Existing Loggers

```javascript
const I18nLogger = require('./lib/utils/i18n-logger');
const Logger = require('./src/logger');

const baseLogger = new Logger('ModuleName');
const i18nLogger = I18nLogger.wrap(baseLogger);
```

### Logging with Translation Keys

```javascript
// System events
await logger.logSystem('starting');
await logger.logSystem('queue_enqueued', { taskId: 'task-001', priority: 'high' });

// Issue events
await logger.logIssue(123, 'processing', { number: 123, title: 'Bug Fix' });
await logger.logIssue(123, 'completed', { number: 123 });

// Task events
await logger.logTask('task-001', 'started', { id: 'task-001' });
await logger.logTask('task-001', 'failed', { id: 'task-001', error: 'timeout' });

// Agent events
await logger.logAgent('CCLA', 'started', { name: 'CCLA' });
await logger.logAgent('CCLA', 'healthy', { name: 'CCLA' });

// Process events
await logger.logProcess(12345, 'started', { pid: 12345 });
await logger.logProcess(12345, 'stopped', { pid: 12345 });
```

### Standard Log Levels

```javascript
// These also support translation keys
await logger.info('messages:startup.ready');
await logger.warn('messages:system.memoryUsage', { percent: 85 });
await logger.error('messages:task.failed', { id: 'task-001', error: 'Network timeout' });
await logger.debug('messages:agent.taskAssigned', { name: 'CCLA', taskId: 'task-001' });
```

### Raw Messages (Fallback)

```javascript
// Raw messages work unchanged
await logger.info('This is a raw log message');
await logger.error('Error occurred', { details: errorInfo });
```

## Translation Key Patterns

### Format
Translation keys follow the pattern: `messages:category.event`

### Categories

- **startup**: Application startup/shutdown events
- **system**: System-level events (memory, CPU, etc.)
- **issue**: GitHub issue processing events
- **pr**: Pull request processing events
- **task**: Task queue and execution events
- **agent**: Agent lifecycle and health events
- **process**: OS process management events
- **github**: GitHub API interactions
- **claude**: Claude API interactions
- **backup**: Backup and restore operations
- **notification**: User notifications

### Examples

```javascript
// System events
'messages:system.starting'          // "Starting PoppoBuilder..."
'messages:system.queue_enqueued'    // "Task {{taskId}} enqueued with priority {{priority}}"
'messages:system.rate_limit_status' // "Rate limit: {{remaining}}/{{limit}} (resets at {{reset}})"

// Issue events
'messages:issue.processing'         // "Processing issue #{{number}}: {{title}}"
'messages:issue.completed'          // "Successfully processed issue #{{number}}"
'messages:issue.failed'             // "Failed to process issue #{{number}}: {{error}}"

// Task events
'messages:task.created'             // "Created task: {{id}}"
'messages:task.started'             // "Started task: {{id}}"
'messages:task.completed'           // "Completed task: {{id}}"
'messages:task.failed'              // "Task {{id}} failed: {{error}}"
```

## Configuration

### Environment Variables

```bash
# Disable i18n globally
export POPPOBUILDER_I18N=false

# Set default locale
export POPPOBUILDER_LOCALE=ja
```

### Logger Factory Options

```javascript
// Create logger with specific options
const logger = LoggerFactory.create('ModuleName', {
  i18n: true,              // Enable/disable i18n
  logDir: './custom/logs', // Custom log directory
  level: 'debug'           // Log level
});
```

## Language Support

The i18n logging system supports all languages configured in the main i18n system:

- **English (en)**: Default language
- **Japanese (ja)**: Full translation support
- **Extensible**: Easy to add new languages by adding translation files

## Performance Considerations

### Efficiency Features

1. **Translation Key Detection**: Only attempts translation for strings containing `:` or `.`
2. **Caching**: Translations are cached by the underlying i18n system
3. **Lazy Loading**: Only loads translations when needed
4. **Async Support**: All logging methods are async to prevent blocking

### Memory Usage

- Minimal overhead: Wrapper pattern preserves original logger functionality
- Translation cache managed by i18n system
- No duplicate storage of log messages

## Testing

### Test Suite

Run the i18n logging test suite:

```bash
npm run test:i18n
```

### Manual Testing

```javascript
const { testI18nLogging } = require('./test/test-i18n-logging');
await testI18nLogging();
```

## Integration with Existing Code

### Minimal Changes Required

The i18n logging feature is designed for seamless integration:

```javascript
// Before (existing code)
const logger = new Logger('ModuleName');
logger.info('Processing started');

// After (with i18n - no code changes needed)
const logger = LoggerFactory.create('ModuleName');
logger.info('messages:task.started'); // or keep raw message
```

### Migration Strategy

1. **Phase 1**: Replace Logger instantiation with LoggerFactory
2. **Phase 2**: Gradually replace raw messages with translation keys
3. **Phase 3**: Add new translations for missing keys

## Best Practices

### Translation Key Naming

- Use descriptive, hierarchical names
- Follow category.event pattern
- Include interpolation variables in translation text
- Use snake_case for consistency

### Data Interpolation

```javascript
// Good: Provide context data
await logger.logIssue(123, 'processing', { 
  number: 123, 
  title: issue.title,
  labels: issue.labels 
});

// Avoid: Missing context
await logger.logIssue(123, 'processing');
```

### Error Handling

```javascript
try {
  await logger.logSystem('starting');
} catch (error) {
  // Fallback to console.log if logger fails
  console.log('System starting...');
}
```

## Troubleshooting

### Common Issues

1. **Missing Translations**: Falls back to translation key as message
2. **i18n Not Initialized**: Falls back to raw message logging
3. **Invalid Translation Keys**: Treated as raw messages

### Debugging

Enable debug logging to see translation resolution:

```bash
DEBUG=i18n* npm start
```

## Future Enhancements

### Planned Features

- **Log Level Translation**: Translate log level names
- **Context-Aware Translation**: Intelligent translation based on context
- **Performance Metrics**: Built-in performance monitoring
- **Custom Formatters**: Language-specific log formatting

### Extension Points

- Add new log categories in translation files
- Implement custom translation resolvers
- Add language-specific formatters
- Integrate with external translation services