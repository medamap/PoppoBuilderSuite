# Changelog for PoppoBuilder Suite v0.1.28

## Summary
This version completes the environment variable control implementation for LogRotator debug output, ensuring better user experience during interactive prompts.

## Changes

### LogRotator Environment Variable Implementation (#285-#287)
- Added `POPPO_DEBUG_LOG_ROTATION` environment variable to control debug output
- Default behavior is now silent (debug output disabled)
- Removed dependency on deprecated silent config options
- Improved user experience during `poppo-builder init --force` interactive prompts

### Technical Details
- LogRotator now checks `process.env.POPPO_DEBUG_LOG_ROTATION === 'true'` for debug output
- Added `isDebugEnabled()`, `debugLog()`, and `debugError()` methods for conditional logging
- Maintained backward compatibility with deprecation warnings for old silent options
- Fixed issue where LogRotator messages were interrupting user input prompts

## Usage
To enable LogRotator debug output:
```bash
POPPO_DEBUG_LOG_ROTATION=true poppo-builder start
```

## Migration Guide
- Remove any `silent: false` configurations from LogRotator initialization
- Use `POPPO_DEBUG_LOG_ROTATION=true` environment variable when debug output is needed
- The deprecated `setGlobalSilent()` method now shows a deprecation warning

## Related Issues
- #285: Add environment variable control to LogRotator debug output
- #286: Refactor LogRotator usage and remove deprecated silent controls
- #287: Version update after LogRotator environment variable implementation