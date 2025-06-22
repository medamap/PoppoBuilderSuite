# PoppoBuilder Suite

An automated task processing system that integrates GitHub Issues with Claude CLI

## 🎭 System Family

PoppoBuilder Suite consists of multiple collaborative systems:

- **PoppoBuilder (Poppo-chan)** 🚂 - Main automated task processing system
- **MedamaRepair (Medama-san)** 👁️ - PoppoBuilder monitoring and auto-recovery system
- **MeraCleaner (Mera-san)** 🔥 - Error comment analysis and organization system
- **MirinOrphanManager (Mirin-chan)** 🎋 - Orphan issue detection and management system
- **CCLA Agent (Clara-chan)** 🤖 - Error log collection and auto-repair agent
- **CCAG Agent (Kagura-chan)** 📝 - Documentation generation and multi-language support agent
- **CCPM Agent (Doremi-chan)** 🔍 - Code review and refactoring suggestion agent
- **CCQA Agent (Q-chan)** 🔍 - Code quality assurance and test execution agent
- **CCRA Agent (Ran-chan)** 📋 - Code review automation agent
- **CCTA Agent (Ku-chan)** 🧪 - Test automation and quality assurance agent (in development)
- **CCSP Agent (Pie-chan)** 🥧 - Dedicated Claude Code invocation agent (planned)

## 🎯 Overview

PoppoBuilder Suite is an automated task processing system that integrates GitHub Issues with Claude CLI:
- **GitHub Issue-driven**: Automatically reads and executes issue content
- **Claude CLI Integration**: AI handles advanced task processing
- **Multi-language Support**: Japanese/English support (configurable)
- **Continuous Dialogue**: Interactive task processing through comment additions
- **Self-improvement**: Extends its own functionality through dogfooding

## 🚀 Current Features

✅ **Automated Issue Processing** - Monitors and processes labeled issues every 30 seconds  
✅ **Duplicate Processing Prevention** - Prevents duplicate processing of the same issue (multi-layered defense system)  
✅ **Comment Follow-up** - Enables continuous dialogue with `awaiting-response` label  
✅ **Dogfooding Feature** - Executes self-improvement tasks with `task:dogfooding`  
✅ **Auto-restart** - Automatic restart 30 seconds after dogfooding task completion  
✅ **Multi-language Support** - Switchable between Japanese/English via configuration  
✅ **Detailed Logging** - Records execution logs per task and process  
✅ **Completion Keyword Recognition** - Automatically adds `completed` label upon detecting configurable completion keywords

### Duplicate Processing Prevention
PoppoBuilder ensures reliable prevention of duplicate processing through a 4-layer mechanism:

1. **GitHub Label Management** - Visual state management using `processing` label
2. **File-based Locking** - Exclusive control via IssueLockManager (with TTL)
3. **State Persistence** - Recording processed issues via FileStateManager
4. **In-memory Management** - Tracking running tasks via TaskQueue

Automatic recovery is possible even after process abnormal termination, with orphan issues being periodically detected and repaired. See [Duplicate Processing Prevention Documentation](docs/duplicate-processing-prevention.md) for details.

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
- **Claude CLI Integration**: Sends prompts via stdin (hang-up issue resolved)
- **Comment Processing**: Posts comments containing special characters via file
- **State Management**: Manages issue states using labels (`processing`→`awaiting-response`→`completed`)
- **Auto-restart**: One-shot restart after dogfooding task completion

## 📁 Project Structure

```
PoppoBuilderSuite/
├── src/                # Source code
│   ├── minimal-poppo.js    # Main processing
│   ├── process-manager.js  # Claude CLI execution management
│   ├── github-client.js    # GitHub API operations
│   ├── logger.js          # Logging functionality
│   └── config-loader.js   # Configuration loading
├── scripts/            # Utility scripts
│   ├── setup-labels.js     # GitHub label creation
│   └── restart-scheduler.js   # Auto-restart scheduler
├── config/             # Configuration files
│   └── config.json         # System configuration
├── .poppo/             # Local settings
│   └── config.json        # Language settings etc.
├── logs/               # Log files
├── temp/               # Temporary files
└── docs/              # Documentation
```

## 🚀 Quick Start

### Prerequisites
- Node.js 18 or later
- Claude CLI (installed)
- GitHub CLI (`gh` command, authenticated)
- Git

### Installation

#### Method 1: Global Installation (Recommended)
```bash
# Install globally from npm
npm install -g poppo-builder-suite

# Run initial setup wizard
poppo-init

# Start PoppoBuilder in your project directory
cd your-project
poppo-builder
```

#### Method 2: Local Installation
```bash
# Clone repository
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Install dependencies
npm install

# Run setup wizard
npm run poppo:init
# Or use the interactive setup on first run
npm start
```

#### Method 3: Quick Setup
```bash
# Create configuration directory
mkdir -p .poppo

# Create configuration file
cat > .poppo/config.json << EOF
{
  "github": {
    "owner": "YOUR_GITHUB_USERNAME",
    "repo": "YOUR_REPO_NAME"
  },
  "language": {
    "primary": "ja"
  }
}
EOF

# Set GitHub token
export GITHUB_TOKEN=your_github_personal_access_token

# Start PoppoBuilder
npx poppo-builder-suite
```

For detailed installation instructions, see the [Installation Guide](docs/INSTALL.md) ([English](docs/INSTALL_en.md)).

### Basic Usage

1. **Execute Regular Tasks**
```bash
gh issue create \
  --title "Task title" \
  --body "Description of what to execute" \
  --label "task:misc" \
  --repo owner/repo
```

2. **Dogfooding Tasks (Self-improvement)**
```bash
gh issue create \
  --title "PoppoBuilder Feature Addition" \
  --body "Description of new feature" \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

3. **Change Language Settings**
Edit `.poppo/config.json`:
```json
{
  "language": "en"  // "ja" or "en"
}
```

## 📋 How It Works

### Issue Processing Flow
1. **Issue Detection**: Checks for labeled issues every 30 seconds
2. **Processing Start**: Adds `processing` label and executes Claude CLI
3. **Result Posting**: Posts execution results as GitHub comments
4. **State Update**: Changes to `awaiting-response` label (enables continuous dialogue)
5. **Comment Monitoring**: Detects new comments from issue creator for additional processing
6. **Completion Detection**: Adds `completed` label when completion keywords are detected

### Dogfooding Feature
For issues with `task:dogfooding` label:
- Automatically references CLAUDE.md to understand current implementation status
- Updates CLAUDE.md after implementation for next session reference
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
    "timeout": 86400000  // 24 hours
  },
  "commentHandling": {
    "enabled": true,
    "completionKeywords": ["ありがとう", "完了", "thanks", "done"]
  }
}
```

### Language Settings (`.poppo/config.json`)
```json
{
  "language": "ja"  // "ja" or "en"
}
```

## 📈 Roadmap

### ✅ Phase 1: Basic Features (Completed)
- ✅ Automated issue processing
- ✅ Claude CLI integration
- ✅ GitHub comment posting
- ✅ Detailed logging

### ✅ Phase 2: Extended Features (Completed)
- ✅ Comment follow-up support
- ✅ Dogfooding feature
- ✅ Auto-restart functionality
- ✅ Multi-language support

### 🚧 Phase 3: Advanced Features (Planned)
- [ ] Multi-project support
- [ ] Process management dashboard
- [ ] Traceability features
- [ ] Agent separation (CCPM, CCAG, etc.)

## 📚 Documentation

- [Installation Guide](docs/INSTALL.md) ([English](docs/INSTALL_en.md))
- [Quick Start Guide](docs/guides/quick-start.md)
- [Setup Guide](docs/setup-guide.md)
- [Minimal Implementation Guide](docs/minimal-implementation-guide.md)
- [Requirements](docs/requirements/)
- [Design Documents](docs/design/)
- [Architecture](docs/architecture/)

## 🔍 Troubleshooting

### Common Issues and Solutions

#### Claude CLI Hang-up
- **Issue**: Claude CLI hangs waiting for prompt
- **Solution**: Send prompts via stdin (implemented)

#### Special Character Errors
- **Issue**: Special character errors when posting GitHub comments
- **Solution**: Post via file using `--body-file` option (implemented)

#### Unexpected Language Response
- **Issue**: Responses in English instead of expected language
- **Solution**: Check `language` setting in `.poppo/config.json`

#### restart-flag.json Error
- **Issue**: `restart-flag.json` not found during restart
- **Solution**: Use one-shot restart method (implemented)

#### awaiting-response Label Not Applied
- **Issue**: Cannot respond to comments after issue processing
- **Solution**: Labels must be created in GitHub beforehand (run `scripts/setup-labels.js`)

For details, see the [Installation Guide](docs/INSTALL.md#troubleshooting).

## 🤝 Contributing

This project is self-improving! Create feature enhancement issues and let PoppoBuilder implement them.

```bash
# Example of creating a dogfooding task
gh issue create \
  --title "New Feature: Add XXX functionality" \
  --body "Detailed description of the feature..." \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

## 📄 License

MIT License - See LICENSE file for details