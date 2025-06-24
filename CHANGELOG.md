# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.9] - 2025-06-24

### Added
- Constants file (`lib/constants/status-constants.js`) for better maintainability
- Time formatting utilities (`lib/utils/time-formatter.js`) for consistent time display
- `ensureIPCConnection()` method to eliminate duplicate connection logic

### Changed
- Refactored unified status command for better code organization
- Replaced all hard-coded values with constants
- Improved error handling with proper null/undefined checks
- Extracted time formatting logic to utility module

### Removed
- Backup files (`.original.js`) from previous status implementations
- Duplicate time formatting methods from unified status command
- Redundant IPC connection logic

### Fixed
- Issue #268: Unified three different status command implementations into one

## [0.1.8] - 2025-06-24

### Added
- Unified status command implementation (`lib/commands/status-unified.js`) that combines functionality from all three previous status implementations
- Comprehensive status display including daemon status, project status, agent sessions, workers, and queues
- Support for `--watch` mode with live updates
- Better error handling and graceful degradation when daemon is not responsive

### Changed
- `poppo-builder status` now uses the new unified implementation
- Improved status display with better formatting and i18n support
- Enhanced daemon signal handling (Ctrl+C now properly terminates the process)

### Fixed
- Memory leak in LogRotator (9-14GB/min) - implemented singleton pattern
- Daemon mode (`poppo-builder start -d`) now properly runs in background
- Ctrl+C signal handling - daemon now terminates gracefully
- StatusAggregator daemon PID file path corrected to `~/.poppobuilder/daemon/daemon.pid`
- tmux session status display - removed excessive blank lines

### Deprecated
- `lib/commands/status.js` - Original multi-project status implementation
- `lib/cli/commands/status.js` - Daemon-focused status implementation
- These implementations will be removed in a future version

## [0.1.7] - 2025-06-23

### Added
- Initial daemon implementation
- Multiple status command implementations
- Agent session management via tmux

### Known Issues
- Status command implementations need unification (resolved in 0.1.8)