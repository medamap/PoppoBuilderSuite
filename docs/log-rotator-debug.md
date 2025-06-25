# LogRotator Debug Output Control

## Overview
LogRotator debug messages can now be controlled via the `POPPO_DEBUG_LOG_ROTATION` environment variable.

## Environment Variable

### `POPPO_DEBUG_LOG_ROTATION`
Controls whether LogRotator outputs debug messages to the console.

- **Values**: `true` or `false`
- **Default**: `false` (silent mode)

### Usage Examples

```bash
# Enable debug output
export POPPO_DEBUG_LOG_ROTATION=true
poppo-builder start

# Disable debug output (default)
export POPPO_DEBUG_LOG_ROTATION=false
poppo-builder start

# Or run with inline environment variable
POPPO_DEBUG_LOG_ROTATION=true poppo-builder start
```

## Backward Compatibility

The following configuration options are still supported but are **deprecated**:

### Config Option: `silent`
```javascript
new LogRotator({
  silent: false  // DEPRECATED: Use POPPO_DEBUG_LOG_ROTATION=true instead
});
```

### Static Method: `setGlobalSilent()`
```javascript
LogRotator.setGlobalSilent(false);  // DEPRECATED: Use POPPO_DEBUG_LOG_ROTATION=true instead
```

## Migration Guide

### Before (Old Way)
```javascript
// In your code
LogRotator.setGlobalSilent(false);

// Or in config
{
  "logRotation": {
    "silent": false
  }
}
```

### After (New Way)
```bash
# Set environment variable
export POPPO_DEBUG_LOG_ROTATION=true

# Or run with inline variable
POPPO_DEBUG_LOG_ROTATION=true npm start
```

## Debug Output Examples

When `POPPO_DEBUG_LOG_ROTATION=true`, you'll see messages like:
```
[LogRotator] ローテーション開始: /path/to/log.log (理由: size)
[LogRotator] ローテーション完了: /path/to/log.log
[LogRotator] 古いファイルを削除: old-log.log.gz
```

When `POPPO_DEBUG_LOG_ROTATION=false` (default), no LogRotator messages will appear in the console.

## Troubleshooting

If you're still seeing LogRotator messages:

1. Check if `POPPO_DEBUG_LOG_ROTATION` is set:
   ```bash
   echo $POPPO_DEBUG_LOG_ROTATION
   ```

2. Ensure you're not using deprecated methods:
   - Remove any `LogRotator.setGlobalSilent()` calls
   - Remove `silent: false` from LogRotator configuration

3. Restart your application after changing the environment variable

## Implementation Details

The LogRotator class now includes:
- `isDebugEnabled()` - Check if debug output is enabled
- `debugLog()` - Conditional console.log wrapper
- `debugError()` - Conditional console.error wrapper

All console outputs in LogRotator are now wrapped with these methods, respecting the environment variable setting.