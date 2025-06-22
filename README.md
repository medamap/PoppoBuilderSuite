# PoppoBuilder Suite

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen)](https://nodejs.org/)
[![GitHub Release](https://img.shields.io/github/release/medamap/PoppoBuilderSuite.svg)](https://github.com/medamap/PoppoBuilderSuite/releases)

Automated task processing system integrating GitHub Issues with Claude CLI

## 🎭 System Family

PoppoBuilder Suite consists of multiple collaborative systems:

- **PoppoBuilder (Poppo-chan)** 🚂 - Main automated task processing system
- **MedamaRepair (Medama-san)** 👁️ - PoppoBuilder monitoring and auto-recovery system
- **MeraCleaner (Mera-san)** 🔥 - Error comment analysis and cleanup system
- **CCLA Agent (Clara-chan)** 🤖 - Error log collection and auto-repair agent
- **CCAG Agent (Kagura-chan)** 📝 - Documentation generation and multilingual agent
- **CCPM Agent (Doremi-chan)** 🔍 - Code review and refactoring suggestion agent
- **MirinOrphanManager (Mirin-chan)** 🎋 - Orphan issue detection and management system

## 🎯 Overview

PoppoBuilder Suite is an automated task processing system that integrates GitHub Issues with Claude CLI:
- **GitHub Issue-Driven**: Automatically reads and executes issue content
- **Claude CLI Integration**: AI handles advanced task processing
- **Multilingual Support**: Supports Japanese/English (configurable)
- **Continuous Dialogue**: Interactive task processing through comment threads
- **Self-Improvement**: Dogfooding functionality enables self-enhancement

## 🚀 Current Features

✅ **Automated Issue Processing** - Monitors and processes labeled issues every 30 seconds  
✅ **Comment Thread Support** - Continuous dialogue via `awaiting-response` label  
✅ **Dogfooding Functionality** - Self-improvement tasks with `task:dogfooding`  
✅ **Automatic Restart** - Auto-restart 30 seconds after dogfooding task completion  
✅ **Multilingual Support** - Switch between Japanese/English via configuration  
✅ **Detailed Logging** - Task-specific and process-specific execution logs  
✅ **Completion Keyword Recognition** - Configurable completion keywords for automatic `completed` label assignment

## 🏗️ Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   GitHub Issue                          │
│  ┌─────────────────────────────────────────────────┐  │
│  │ Labels: task:misc / task:dogfooding             │  │
│  │ Status: processing → awaiting-response → ...    │  │
│  └─────────────────────────────────────────────────┘  │
└────────────────────┬───────────────┬───────────────────┘
                     │               │
                     ▼               ▼
              ┌──────────────┐ ┌──────────────┐
              │ PoppoBuilder │ │   Comment    │
              │ (every 30s)  │ │   Monitor    │
              └──────┬───────┘ └──────┬───────┘
                     │               │
                     ▼               │
              ┌──────────────┐       │
              │ Claude CLI   │       │
              │ (stdin input)│       │
              └──────┬───────┘       │
                     │               │
                     ▼               │
              ┌──────────────┐       │
              │GitHub Comment│ ◀─────┘
              │ (via file)   │
              └──────────────┘
```

### Key Components
- **Issue Monitoring**: Detects issues using GitHub API every 30 seconds
- **Claude CLI Integration**: Sends prompts via stdin (hangup issue resolved)
- **Comment Processing**: Posts comments via file to handle special characters
- **State Management**: Issue state management via labels (`processing`→`awaiting-response`→`completed`)
- **Auto-Restart**: One-shot restart after dogfooding task completion

## 📁 Project Structure

```
PoppoBuilderSuite/
├── src/                # Source code
│   ├── minimal-poppo.js    # Main processing
│   ├── process-manager.js  # Claude CLI execution management
│   ├── github-client.js    # GitHub API operations
│   ├── logger.js          # Logging functionality
│   └── config-loader.js   # Configuration loading
├── lib/                # Core libraries
│   ├── i18n/              # Internationalization system
│   ├── utils/             # Utility functions
│   ├── commands/          # CLI commands
│   └── errors/            # Error handling system
├── scripts/            # Utility scripts
│   ├── setup-labels.js     # GitHub label creation
│   └── restart-scheduler.js   # Auto-restart scheduler
├── config/             # Configuration files
│   └── config.json         # System configuration
├── .poppo/             # Local settings
│   └── config.json        # Language settings, etc.
├── locales/            # Translation files
│   ├── en/                # English translations
│   └── ja/                # Japanese translations
├── logs/               # Log files
├── temp/               # Temporary files
└── docs/              # Documentation
```

## 🚀 Quick Start

### Prerequisites
- Node.js 14 or higher
- npm 6.0.0 or higher
- Git 2.0.0 or higher
- Claude CLI (installed)
- GitHub CLI (`gh` command, authenticated)

### Setup Wizard

PoppoBuilder includes an interactive wizard to assist with environment setup:

```bash
# Run the setup wizard
npm run setup:wizard

# Or run directly
node lib/commands/setup-wizard.js

# Check dependencies only
npm run deps:check
```

Setup wizard features:
- ✅ Automatic checking of required dependencies (Node.js, npm, Git, Claude CLI)
- ✅ Detection of missing dependencies with installation guidance
- ✅ Git repository initialization and configuration
- ✅ GitHub CLI authentication verification
- ✅ Automatic working branch creation
- ✅ Interactive Claude CLI setup (when available)

### Installation
For detailed installation instructions, see the [Installation Guide](docs/INSTALL_en.md) ([Japanese](docs/INSTALL.md)).

```bash
# Clone the repository
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit the .env file to add your GitHub configuration

# Initialize GitHub labels
node scripts/setup-labels.js

# Start PoppoBuilder
npm start
```

### CLI Commands

PoppoBuilder provides various CLI commands:

```bash
# Project initialization
poppobuilder init

# Service startup
poppobuilder start
poppobuilder start --daemon  # Start in daemon mode

# Status check
poppobuilder status

# PR creation guide (NEW!)
poppobuilder pr              # Interactive PR creation guide
poppobuilder pr --draft      # Create draft PR
poppobuilder pr --base develop  # PR to specific branch

# Other commands
poppobuilder config --list   # List configuration
poppobuilder logs -f         # Real-time log display
poppobuilder doctor          # Environment diagnostics
```

See `poppobuilder --help` for details.

### Basic Usage

1. **Regular Task Execution**
```bash
gh issue create \
  --title "Task Title" \
  --body "Description of what to execute" \
  --label "task:misc" \
  --repo owner/repo
```

2. **Dogfooding Task (Self-Improvement)**
```bash
gh issue create \
  --title "PoppoBuilder Feature Addition" \
  --body "New feature description" \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

3. **Language Setting Change**
Edit `.poppo/config.json`:
```json
{
  "language": "en"  // "ja" or "en"
}
```

## 📋 How It Works

### Issue Processing Flow
1. **Issue Detection**: Check for issues with target labels every 30 seconds
2. **Processing Start**: Add `processing` label and execute Claude CLI
3. **Result Posting**: Post execution results as GitHub comments
4. **State Update**: Change to `awaiting-response` label (enables continuous dialogue)
5. **Comment Monitoring**: Detect new comments from issue creator for additional processing
6. **Completion Detection**: Add `completed` label when completion keywords are detected

### Dogfooding Functionality
For issues with `task:dogfooding` label:
- Automatically references CLAUDE.md to understand current implementation status
- Updates CLAUDE.md after implementation for next session records
- Schedules automatic restart 30 seconds after completion (to reflect new features)

## 🔧 Configuration

### System Configuration (`config/config.json`)
```json
{
  "github": {
    "owner": "GitHub username",
    "repo": "Repository name",
    "checkInterval": 30000
  },
  "claude": {
    "command": "claude",
    "timeout": 86400000
  },
  "commentHandling": {
    "enabled": true,
    "completionKeywords": ["thank you", "completed", "thanks", "done"]
  }
}
```

### Language Configuration (`.poppo/config.json`)
```json
{
  "language": "en"
}
```

## 🌐 Internationalization Features

PoppoBuilder Suite includes comprehensive internationalization support:

### Supported Languages
- **English (en)**: Complete interface localization
- **Japanese (ja)**: Native Japanese support with technical terminology
- **Extensible**: Easy addition of new languages

### I18n Features
- **Automatic Language Detection**: Based on system locale or configuration
- **Dynamic Message Translation**: Real-time translation of all system messages
- **Error Message Localization**: Comprehensive error messages in both languages
- **Log Message Translation**: Multilingual logging with structured error codes
- **CLI Internationalization**: Command-line interface in multiple languages

### Configuration
```json
{
  "language": "en",           // Primary language (en/ja)
  "fallbackLanguage": "en",   // Fallback when translation missing
  "autoDetect": false         // Auto-detect from system locale
}
```

## 📈 Roadmap

### ✅ Phase 1: Basic Features (Complete)
- ✅ Automated issue processing
- ✅ Claude CLI integration
- ✅ GitHub comment posting
- ✅ Detailed logging

### ✅ Phase 2: Extended Features (Complete)
- ✅ Comment thread support
- ✅ Dogfooding functionality
- ✅ Automatic restart
- ✅ Multilingual support

### ✅ Phase 3: Advanced Features (Complete)
- ✅ Internationalization (i18n) system
- ✅ Error code and message catalog
- ✅ Enhanced logging with i18n support
- ✅ Comprehensive error handling

### 🚧 Phase 4: Enterprise Features (Planned)
- [ ] Multi-project support
- [ ] Process management dashboard
- [ ] Traceability features
- [ ] Agent separation (CCPM, CCAG, etc.)

## 📚 Documentation

- [Installation Guide](docs/INSTALL_en.md) ([Japanese](docs/INSTALL.md))
- [Quick Start Guide](docs/guides/quick-start_en.md)
- [Setup Guide](docs/setup-guide_en.md)
- [Minimal Implementation Guide](docs/minimal-implementation-guide_en.md)
- [Internationalization Guide](docs/features/i18n-system.md)
- [Error Handling Guide](docs/features/error-system.md)
- [Requirements](docs/requirements/)
- [Design Documents](docs/design/)
- [Architecture](docs/architecture/)

## 🔍 Troubleshooting

### Common Issues and Solutions

#### Claude CLI Hangup
- **Issue**: Claude CLI hangs waiting for prompt
- **Solution**: Send prompts via stdin method (implemented)

#### Special Character Errors
- **Issue**: Special character errors when posting GitHub comments
- **Solution**: Post via file using `--body-file` option (implemented)

#### Unexpected Language
- **Issue**: Responses in English when expecting Japanese
- **Solution**: Check `language` setting in `.poppo/config.json`

#### restart-flag.json Error
- **Issue**: `restart-flag.json` not found during restart
- **Solution**: Use one-shot restart method (implemented)

#### awaiting-response Label Not Applied
- **Issue**: Cannot handle comments after issue processing
- **Solution**: Labels must be created in GitHub beforehand (run `scripts/setup-labels.js`)

See the [Installation Guide](docs/INSTALL_en.md#troubleshooting) for details.

## 🧪 Testing

PoppoBuilder Suite includes comprehensive testing:

```bash
# Run all tests
npm test

# Specific test suites
npm run test:i18n          # Internationalization tests
npm run test:errors        # Error system tests
npm run test:integration   # Integration tests

# Dependency check
npm run deps:check
```

## 🤝 Contributing

This project is self-improving! Create feature enhancement issues and let PoppoBuilder implement them.

```bash
# Example dogfooding task creation
gh issue create \
  --title "New Feature: Add XXX functionality" \
  --body "Detailed feature description..." \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

### Development Guidelines
- Use the internationalization system for all user-facing messages
- Follow the error code standards for consistent error handling
- Include comprehensive tests for new features
- Update documentation for any API changes

## 📊 Features Overview

| Feature | Status | Description |
|---------|--------|-------------|
| Issue Processing | ✅ Complete | Automated GitHub issue processing |
| Claude Integration | ✅ Complete | Direct integration with Claude CLI |
| Multilingual Support | ✅ Complete | English/Japanese interface |
| Error Handling | ✅ Complete | Comprehensive error management |
| Logging System | ✅ Complete | Structured multilingual logging |
| Comment Threading | ✅ Complete | Continuous dialogue support |
| Dogfooding | ✅ Complete | Self-improvement capabilities |
| CLI Interface | ✅ Complete | Rich command-line tools |
| Setup Wizard | ✅ Complete | Interactive environment setup |
| Dashboard | 🚧 In Progress | Web-based management interface |

## 🌍 Language Support

- **[English Documentation](docs/README_en.md)** - Complete English documentation
- **[日本語ドキュメント](README.ja.md)** - 完全な日本語ドキュメント

## 📄 License

MIT License - See LICENSE file for details

---

**Made with ❤️ by the PoppoBuilder community**

For support, please create an issue or check our [documentation](docs/README_en.md).