# PoppoBuilder Suite Documentation

Comprehensive documentation for PoppoBuilder Suite. Please refer to the appropriate documentation for your needs.

## 📚 Table of Contents

### 🚀 Getting Started
- [Quick Start Guide](guides/quick-start.md) - Get started with PoppoBuilder in 5 minutes
- [Installation Guide](INSTALL.md) - Detailed setup instructions
- [Setup Guide](setup-guide.md) - Environment configuration details

### 🎯 Feature Guides
- [Memory Management Guide](features/memory-management-guide.md) - Memory usage monitoring and optimization
- [Error Handling Guide](features/error-handling-guide.md) - Error processing and recovery
- [Testing Framework Guide](features/testing-guide.md) - Test execution and development
- [Dashboard Operation Guide](features/dashboard-guide.md) - Web dashboard usage
- [Dynamic Timeout](features/dynamic-timeout_en.md) ([Japanese](features/dynamic-timeout.md))
- [Rate Limiting](features/rate-limiting.md) - API limit handling
- [Internationalization System](features/i18n-system.md) - Multilingual support
- [Error System](features/error-system.md) - Comprehensive error handling

### 📖 API Reference
- [CLI Command Reference](api/cli-reference.md) - Complete command details
- [Configuration Options](config-management.md) - Complete configuration file guide
- [Events and Hooks](api/events-and-hooks.md) - Customization points
- [Plugin Development Guide](api/plugin-development.md) - Extension development

### 🛠️ Troubleshooting
- [Troubleshooting Guide](troubleshooting.md) - Common problems and solutions
- [Error Handling](error-handling.md) - Error details and fixes
- [Session Timeout Handling](session-timeout-handling.md) - Long-running execution issues
- [Known Issues](troubleshoot/) - Specific error handling

### 💡 Best Practices
- [Best Practices](best-practices.md) - Recommended usage patterns
- [Security Guidelines](security/agent-authentication.md) - Secure operations
- [Performance Tuning](performance-tuning.md) - Optimization tips
- [Multi-Project Operations](guides/multi-project-guide_en.md) ([Japanese](guides/multi-project-guide.md))

### 🏗️ Architecture
- [System Overview](architecture/system-overview.md) ([Japanese](ja/system-overview.md))
- [Agent Separation Architecture](architecture/agent-separation_en.md) ([Japanese](architecture/agent-separation.md))
- [Agent Communication Protocol](design/agent-communication-protocol_en.md) ([Japanese](design/agent-communication-protocol.md))
- [State Management System](unified-state-management.md) - JSON-based state management

### 🤖 Agents
- [CCQA Agent](agents/ccqa-agent.md) - Code quality assurance
- [CCRA Agent](agents/ccra-agent.md) - Code review automation
- [CCTA Agent](agents/ccta-agent.md) - Automated test execution
- [Dynamic Scaling](agents/dynamic-scaling.md) - Automatic agent scaling

### 🧪 Testing
- [E2E Testing](testing/e2e-testing.md) - End-to-end testing
- [Integration Testing](testing/integration-testing.md) - Component interaction testing
- [Performance Testing](testing/performance-testing.md) - Performance measurement

### 📋 Requirements & Design
- [Requirements](requirements/) - Feature requirements
- [Design Documents](design/) - Detailed design documentation
- [Implementation History](implementation-history/) - Past implementation records

### 🔧 Advanced Features
- [Backup & Restore](backup-restore.md) - Data protection
- [Log Rotation](log-rotation.md) - Log management
- [Notification Features](guides/notification-guide.md) - Slack/Email notifications
- [Traceability](guides/traceability-guide_en.md) ([Japanese](guides/traceability-guide.md))
- [GitHub Projects Integration](github-projects-integration.md) - Project management

### 🌐 Other Features
- [Messaging Migration Guide](messaging-migration-guide.md) - Migration to Redis queues
- [Redis State Management](redis-state-management.md) - Redis-based state management
- [WebSocket Real-time Updates](websocket-realtime-updates.md) - Real-time communication

## 🔍 How to Find Documentation

### By Purpose
- **Want to start immediately** → [Quick Start Guide](guides/quick-start.md)
- **Want detailed installation** → [Installation Guide](INSTALL.md)
- **Getting errors** → [Troubleshooting](troubleshooting.md)
- **Want to change configuration** → [Configuration Options](config-management.md)
- **Want to know commands** → [CLI Command Reference](api/cli-reference.md)
- **Want to extend functionality** → [Plugin Development Guide](api/plugin-development.md)

### By Experience Level
- **Beginner** → Quick Start, Installation Guide
- **Intermediate** → Feature Guides, API Reference
- **Advanced** → Architecture, Design Documents, Plugin Development

## 📝 Contributing to Documentation

We welcome documentation improvement suggestions!
- Fix typos and grammatical errors
- Improve explanations for better clarity
- Add new usage examples
- Add diagrams and illustrations

Please submit improvement suggestions via GitHub Issues.

## 🌍 Multilingual Documentation

PoppoBuilder Suite documentation is available in multiple languages:
- **English** - Complete documentation with examples and guides
- **日本語 (Japanese)** - Native Japanese documentation with technical terminology

The system features comprehensive internationalization support:
- **Automatic Language Detection** - Based on system locale or configuration
- **Dynamic Message Translation** - Real-time translation of all system messages
- **Error Message Localization** - Comprehensive error messages in both languages
- **Log Message Translation** - Multilingual logging with structured error codes
- **CLI Internationalization** - Command-line interface in multiple languages

For more information about internationalization features, see the [Internationalization System Guide](features/i18n-system.md).