# LogRotator Silent Mode Deprecation Migration Guide

## Overview
The `silent` configuration option and `setGlobalSilent()` method for LogRotator are now deprecated in favor of the `POPPO_DEBUG_LOG_ROTATION` environment variable.

## Migration Steps

### 1. Remove setGlobalSilent() Calls

**Before:**
```javascript
const LogRotator = require('./src/log-rotator');
LogRotator.setGlobalSilent(true);
```

**After:**
```javascript
// Remove these lines - no longer needed
// Control via POPPO_DEBUG_LOG_ROTATION environment variable instead
```

### 2. Update Configuration Files

**Before:**
```json
{
  "logRotation": {
    "enabled": true,
    "silent": false,
    "maxSize": 104857600
  }
}
```

**After:**
```json
{
  "logRotation": {
    "enabled": true,
    "maxSize": 104857600
    // "silent" is deprecated - use POPPO_DEBUG_LOG_ROTATION env var
  }
}
```

### 3. Update Shell Scripts

**Before:**
```bash
# In your startup scripts
node app.js --log-silent=false
```

**After:**
```bash
# Enable debug output
POPPO_DEBUG_LOG_ROTATION=true node app.js

# Or export for all commands
export POPPO_DEBUG_LOG_ROTATION=true
node app.js
```

### 4. Update Docker/CI Configuration

**Before (docker-compose.yml):**
```yaml
services:
  app:
    environment:
      - LOG_SILENT=false
```

**After:**
```yaml
services:
  app:
    environment:
      - POPPO_DEBUG_LOG_ROTATION=true
```

## Deprecation Timeline

- **v0.1.27**: Deprecation warnings added
- **v0.2.0**: `silent` config still works but shows warnings
- **v0.3.0**: `setGlobalSilent()` and `silent` config will be removed

## Frequently Asked Questions

### Q: Will my existing configuration break?
A: No, the deprecated options will continue to work with warnings until v0.3.0.

### Q: What if I set both the environment variable and the old config?
A: The environment variable takes precedence when explicitly set.

### Q: How do I check if debug output is enabled?
A: Check the environment variable:
```bash
echo $POPPO_DEBUG_LOG_ROTATION
```

### Q: Can I still use silent mode programmatically?
A: Yes, but it's not recommended. Use environment variables for better consistency:
```javascript
// Not recommended but still works (with deprecation warning)
new LogRotator({ silent: false });

// Recommended approach
process.env.POPPO_DEBUG_LOG_ROTATION = 'true';
new LogRotator();
```

## Benefits of the New Approach

1. **Consistency**: All CLI commands respect the same environment variable
2. **No Code Changes**: Control logging without modifying source code
3. **Deployment Friendly**: Easy to configure in different environments
4. **Clear Intent**: Environment variable name clearly indicates its purpose

## Support

If you encounter any issues during migration, please:
1. Check the [troubleshooting guide](../log-rotator-debug.md#troubleshooting)
2. Open an issue on GitHub
3. Include your configuration and any error messages