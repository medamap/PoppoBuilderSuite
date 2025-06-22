# PoppoBuilder Suite - Session Continuity Guide

## 🎭 System Family

PoppoBuilder Suite consists of the following collaborative systems:

- **PoppoBuilder (Poppo-chan)** 🚂 - Main automated task processing system
- **MedamaRepair (Medama-san)** 👁️ - PoppoBuilder monitoring and auto-repair system (monitors every 15 minutes, v3.0.0)
- **MeraCleaner (Mera-san)** 🔥 - Error comment analysis and cleanup system (runs every 30 minutes)
- **MirinOrphanManager (Mirin-chan)** 🎋 - Orphan issue detection and management system (runs at 3 and 33 minutes past each hour)
- **CCLA Agent (Clara-chan)** 🤖 - Error log collection and auto-repair agent (monitors every 5 minutes)
- **CCAG Agent (Kagura-chan)** 📝 - Documentation generation and multilingual agent
- **CCPM Agent (Doremi-chan)** 🔍 - Code review and refactoring suggestion agent
- **CCQA Agent (Cue-chan)** 🔍 - Code quality assurance and test execution agent
- **CCRA Agent (Ran-chan)** 📋 - Code review automation agent
- **CCTA Agent (Koo-chan)** 🧪 - Automated test execution and quality assurance agent (in development)
- **CCSP Agent (Pi-chan)** 🥧 - Dedicated Claude Code invocation agent (planned)

## 🚀 Current Implementation Status

### ✅ Implemented Features
- **Basic Features**: Automated issue processing, independent process management, comment handling, dogfooding, multilingual support
- **Advanced Features**: Dashboard, rate limiting, dynamic timeout, error log collection, traceability, notifications
- **Operational Features**: Multi-project support, authentication, integrity auditing

### 📁 Important Files
- `src/minimal-poppo.js` - Main processing
- `src/independent-process-manager.js` - Independent process management
- `config/config.json` - System configuration
- `.poppo/config.json` - Language settings (ja/en)

## 📚 Detailed Implementation History

For detailed implementation history, refer to the following documents:

- [Phase 1: Basic Implementation History](docs/implementation-history/phase1-basic.md)
- [Phase 2: Advanced Implementation History](docs/implementation-history/phase2-advanced.md)
- [Issue Implementation History Index](docs/implementation-history/issues/README.md)
- [Recent Issues (#63-#119)](docs/implementation-history/recent-issues.md)

## 🔍 Session Startup Checklist

### 1. Current Status Check (Required)
```bash
# Check current directory
pwd
# /Volumes/PoppoSSD2T/Projects/ClaudeCodeProjects/AIBuildSystem/PoppoBuilderSuite

# Check PoppoBuilder processes
ps aux | grep PoppoBuilder

# Check running tasks
cat logs/running-tasks.json

# Check latest logs
tail -20 logs/poppo-$(date +%Y-%m-%d).log
```

### 2. Check Latest Issue Status
```bash
gh issue list --repo medamap/PoppoBuilderSuite --state open
```

### 3. Check Error Logs
```bash
# Check for errors
grep ERROR logs/poppo-$(date +%Y-%m-%d).log | tail -10
```

## 🛠️ Frequently Used Commands

### Basic Operations
```bash
# Start PoppoBuilder
npm start

# Start in agent mode
npm run start:agents

# Check dashboard
npm run dashboard

# Process monitor (NEW!)
npm run poppo:status        # List running processes
npm run poppo:help          # Show help
poppo status --json         # Output in JSON format
poppo kill <task-id>        # Stop task
poppo logs <task-id>        # Show task logs
poppo logs <task-id> -f     # Follow logs in real-time
```

### Debugging
```bash
# Enable detailed logging
DEBUG=* npm start

# Run tests
npm test
```

### Git Operations
```bash
# Check current branch
git branch

# IMPORTANT: Always work on work/poppo-builder branch
git checkout work/poppo-builder

# Commit (with Claude Code signature)
# IMPORTANT: All commit messages should be in English
git commit -m "Your message in English

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Branch Management Policy
- **Work Branch**: Always make changes on `work/poppo-builder` branch
- **Main Branch**: Used for PR creation (target branch)
- **Never work directly on main branch**

## 🔄 PBS Development and Operation Patterns

### Three Operation Patterns
1. **Pattern 1: PBS Development Only**
   - Develop PBS itself
   - Use GitHub repository version directly
   - Run: `npm start` or `node src/minimal-poppo.js`

2. **Pattern 2: PBS Development + Other Project Processing**
   - Develop PBS while testing on other projects
   - Use `npm link` for immediate reflection of changes
   - Steps:
     ```bash
     # In PBS repository
     cd /path/to/PoppoBuilderSuite
     npm link
     
     # In target project
     cd /path/to/other-project
     npm link poppo-builder-suite
     poppo-builder
     ```

3. **Pattern 3: Other Project Processing Only**
   - Use stable PBS for production
   - Install via npm
   - Run:
     ```bash
     # Local installation
     npm install poppo-builder-suite
     node_modules/.bin/poppo-builder
     
     # Global installation
     npm install -g poppo-builder-suite
     poppo-builder
     ```

### CLAUDE.md Resolution
- **No conflict**: Each pattern naturally uses appropriate CLAUDE.md
- **PBS Development**: Uses PBS repository's CLAUDE.md
- **Other Projects**: PBS executes in project directory, reads project's CLAUDE.md if exists
- **Working directory determines context automatically**

## ⚠️ Important Notes

1. **Maximum Process Error**: When capacity is limited, skip GitHub comment posting
2. **Rate Limiting**: Automatically wait and retry
3. **Language Settings**: Switch between `ja`/`en` in `.poppo/config.json`
4. **Authentication**: Always change default dashboard password

## 🌐 Language Policy

**IMPORTANT: GitHub Outputs in English**
- All commit messages must be in English
- All Issue titles and descriptions must be in English  
- All PR titles and descriptions must be in English
- All GitHub comments and error reports must be in English

**User Interaction**
- Communication with the user (you) can be in Japanese
- This CLAUDE.md document is now in English for consistency
- The language policy is for global accessibility of the project

## ⚠️ File Creation Guidelines

### Project Root Cleanliness
- **Never create files or directories directly in the project root**
- Follow proper directory structure:
  - Documentation → `docs/`
  - Logs → `logs/`
  - State management → `state/`
  - Configuration → `config/`
  - Scripts → `scripts/`
  - Tests → `test/`
  - Temporary files → `temp/`

### Documentation Management Policy
- **CLAUDE.md contains only essential session information**
- **Detailed logs go to corresponding detailed files**
- **Split files when they become too large (>500 lines)**
- **Create appropriate index files when splitting**
- **Use relative links to maintain portability**

### Examples of Proper File Placement
```bash
# ✅ Correct
docs/implementation-history/recent-issues.md
logs/poppo-2025-06-20.log
state/processed-issues.json
scripts/poppo-health.js

# ❌ Incorrect (creates clutter in project root)
recent-issues.md
poppo.log
issues.json
health.js
```

## 🔗 Related Documentation

- [README.md](README.md) - Project overview
- [Installation Guide](docs/INSTALL.md)
- [Architecture Overview](docs/architecture/system-overview.md)
- [Troubleshooting](docs/INSTALL.md#troubleshooting)

## 📋 Recent Implementation Summary

For detailed implementation history of recent issues (#63-#119), see [Recent Issues Implementation History](docs/implementation-history/recent-issues.md).

### Key Recent Implementations:
- **#63**: Dashboard log search/filter functionality
- **#64**: Hierarchical configuration management system  
- **#65**: CLI-based process monitor (`poppo status`)
- **#66**: SQLite execution history and performance analytics
- **#77**: CPU usage monitoring integration
- **#79**: CCQA (Code Quality Assurance) agent
- **#80**: Automatic log rotation (100MB/daily)
- **#81**: Comprehensive E2E test framework
- **#82**: Performance benchmarking suite
- **#85**: JWT authentication and RBAC security
- **#87**: Advanced health check system with auto-recovery
- **#91**: WebSocket real-time dashboard updates
- **#92**: GitHub Projects v2 integration
- **#102**: Redis backend support for state management