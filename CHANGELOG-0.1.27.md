# Changelog for v0.1.27

## New Features

### Environment Variable Control for LogRotator Debug Output
- Added `POPPO_DEBUG_LOG_ROTATION` environment variable to control LogRotator debug messages
- Default behavior is now silent (no debug output) for better CLI user experience
- Debug output can be enabled by setting `POPPO_DEBUG_LOG_ROTATION=true`

## Improvements

### LogRotator Debug Control
- Implemented `isDebugEnabled()`, `debugLog()`, and `debugError()` methods in LogRotator
- All console output in LogRotator now respects the environment variable setting
- Fixed singleton instance debug state updates

### Code Cleanup
- Removed all `LogRotator.setGlobalSilent()` calls from entry points
- Removed unused LogRotator imports
- Cleaned up redundant code for better maintainability

## Deprecations

### LogRotator Silent Mode
- **DEPRECATED**: `silent` configuration option - use `POPPO_DEBUG_LOG_ROTATION` environment variable instead
- **DEPRECATED**: `LogRotator.setGlobalSilent()` method - use `POPPO_DEBUG_LOG_ROTATION` environment variable instead
- Both deprecated features will continue to work with warnings until v0.3.0

## Documentation

- Added comprehensive documentation for LogRotator debug control
- Created migration guide for deprecated silent mode features
- Updated configuration documentation with new environment variable

## Migration Guide

To migrate from the old silent mode to the new environment variable:

1. Remove any `LogRotator.setGlobalSilent()` calls from your code
2. Remove `silent: false` from LogRotator configuration
3. Set `POPPO_DEBUG_LOG_ROTATION=true` when you need debug output

See [Migration Guide](docs/migration/log-rotator-silent-deprecation.md) for detailed instructions.

## Breaking Changes

None. All changes are backward compatible with deprecation warnings.