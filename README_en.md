# PoppoBuilder Suite

Automated task processing system integrating GitHub Issues with Claude CLI

## 🎯 Overview

PoppoBuilder Suite is an automated task processing system that integrates GitHub Issues with Claude CLI:
- **GitHub Issue Driven**: Automatically reads and executes Issue content
- **Claude CLI Integration**: AI handles advanced task processing
- **Multi-language Support**: Configurable Japanese/English support
- **Continuous Dialogue**: Interactive task processing through comment threads
- **Self-improvement**: Capable of extending its own features through Dogfooding

## 🚀 Current Features

✅ **Automatic Issue Processing** - Monitors and processes labeled Issues every 30 seconds  
✅ **Comment Thread Support** - Continuous dialogue possible with `awaiting-response` label  
✅ **Dogfooding Feature** - Self-improvement tasks with `task:dogfooding`  
✅ **Auto-restart** - Automatic restart 30 seconds after Dogfooding task completion  
✅ **Multi-language Support** - Switch between Japanese/English via config file  
✅ **Detailed Logging** - Task-specific and process-specific execution logs  
✅ **Completion Keyword Recognition** - Automatically applies `completed` label with configurable keywords

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
              │   (30s poll) │ │   Monitor    │
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
- **Issue Monitoring**: Detects Issues with target labels every 30 seconds using GitHub API
- **Claude CLI Integration**: Sends prompts via stdin (hangup issue resolved)
- **Comment Processing**: Posts comments via file to handle special characters
- **State Management**: Manages Issue state through labels (`processing`→`awaiting-response`→`completed`)
- **Auto-restart**: One-shot restart after dogfooding task completion

## 📁 Project Structure

```
PoppoBuilderSuite/
├── src/                # Source code
│   ├── minimal-poppo.js    # Main processing
│   ├── process-manager.js  # Claude CLI execution management
│   ├── github-client.js    # GitHub API operations
│   ├── logger.js          # Logging features
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
- Node.js 18+
- Claude CLI (installed)
- GitHub CLI (`gh` command, authenticated)
- Git

### Installation
For detailed installation instructions, see [Installation Guide](docs/INSTALL_en.md).

```bash
# Clone repository
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Install dependencies
npm install

# Set environment variables
cp .env.example .env
# Edit .env file with GitHub settings

# Initialize GitHub labels
node scripts/setup-labels.js

# Start PoppoBuilder
npm start
```

### Basic Usage

1. **Execute Normal Task**
```bash
gh issue create \
  --title "Task Title" \
  --body "Description of what to execute" \
  --label "task:misc" \
  --repo owner/repo
```

2. **Dogfooding Task (Self-improvement)**
```bash
gh issue create \
  --title "Add PoppoBuilder Feature" \
  --body "New feature description" \
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
1. **Issue Detection**: Checks for Issues with target labels every 30 seconds
2. **Start Processing**: Adds `processing` label and executes Claude CLI
3. **Post Results**: Posts execution results as GitHub comment
4. **Update Status**: Changes to `awaiting-response` label (continuous dialogue possible)
5. **Monitor Comments**: Detects new comments from Issue creator for additional processing
6. **Completion Detection**: Applies `completed` label when completion keywords are detected

### Dogfooding Feature
For Issues with `task:dogfooding` label:
- Automatically references CLAUDE.md to understand current implementation status
- Updates CLAUDE.md after implementation for next session records
- Schedules automatic restart 30 seconds after completion (to reflect new features)

## 🔧 Configuration

### System Configuration (`config/config.json`)
```json
{
  "github": {
    "owner": "GitHub username",
    "repo": "repository name",
    "checkInterval": 30000
  },
  "claude": {
    "command": "claude",
    "timeout": 86400000  // 24 hours
  },
  "commentHandling": {
    "enabled": true,
    "completionKeywords": ["thank you", "thanks", "done", "complete"],
    "maxCommentCount": 10,
    "timeoutHours": 24
  }
}
```

### Language Settings (`.poppo/config.json`)
```json
{
  "language": "en"  // "ja" or "en"
}
```

## 📈 Roadmap

### ✅ Phase 1: Basic Features (Completed)
- ✅ Automatic Issue processing
- ✅ Claude CLI integration
- ✅ GitHub comment posting
- ✅ Detailed logging

### ✅ Phase 2: Extended Features (Completed)
- ✅ Comment thread support
- ✅ Dogfooding feature
- ✅ Auto-restart functionality
- ✅ Multi-language support

### 🚧 Phase 3: Advanced Features (Planned)
- [ ] Multi-project support
- [ ] Process management dashboard
- [ ] Traceability features
- [ ] Agent separation (CCPM, CCAG, etc.)

## 📚 Documentation

- [Installation Guide](docs/INSTALL_en.md)
- [Quick Start Guide](docs/guides/quick-start.md)
- [Setup Guide](docs/setup-guide_en.md)
- [Minimal Implementation Guide](docs/minimal-implementation-guide.md)
- [Requirements](docs/requirements/)
- [Design Documents](docs/design/)
- [Architecture](docs/architecture/)

## 🔍 Troubleshooting

### Common Issues and Solutions

#### Claude CLI Hangup
- **Issue**: Claude CLI hangs waiting for prompt
- **Solution**: Send prompt via stdin (implemented)

#### Special Character Errors
- **Issue**: Special character errors when posting GitHub comments
- **Solution**: Post via file using `--body-file` option (implemented)

#### Unexpected Language Response
- **Issue**: Responds in wrong language
- **Solution**: Check `language` setting in `.poppo/config.json`

#### restart-flag.json Error
- **Issue**: `restart-flag.json` not found during restart
- **Solution**: Use one-shot restart method (implemented)

#### awaiting-response Label Not Applied
- **Issue**: Cannot respond to comments after Issue processing
- **Solution**: Labels must be created in GitHub beforehand (run `scripts/setup-labels.js`)

For details, see [Installation Guide](docs/INSTALL_en.md#troubleshooting).

## 🤝 Contributing

This project is self-improving! Create Issues for feature enhancements and let PoppoBuilder implement them.

```bash
# Example Dogfooding task creation
gh issue create \
  --title "New Feature: XXX functionality" \
  --body "Detailed feature description..." \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

## 📄 License

MIT License - see LICENSE file for details