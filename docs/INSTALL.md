# PoppoBuilder Suite Installation Guide

PoppoBuilder is an advanced automated task processing system that integrates GitHub Issues with Claude CLI. It features continuous dialogue through comment threads, self-improvement capabilities (Dogfooding), comprehensive internationalization support, and advanced error handling. This guide explains how to install and configure PoppoBuilder.

## Prerequisites

### Required Components
- **Node.js** (v14 or higher, v18+ recommended)
- **npm** (6.0.0 or higher) or **yarn**
- **Claude CLI** (installed and configured)
- **GitHub CLI (`gh`)** (installed and authenticated)
- **Git** (2.0.0 or higher)

### Claude CLI Setup
Ensure Claude CLI is installed and API key is configured:
```bash
claude --version
```

### GitHub CLI Setup
Ensure GitHub CLI is authenticated:
```bash
gh auth status
```

## Installation Steps

### 1. Clone the Repository
```bash
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Run Setup Wizard (Recommended)
PoppoBuilder includes an interactive setup wizard to assist with environment configuration:

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

### 4. Configure Environment Variables
Create a `.env` file and set the required environment variables:
```bash
cp .env.example .env
```

Edit the `.env` file:
```
# GitHub Configuration
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name

# Logging Configuration (optional)
LOG_LEVEL=info
```

### 5. GitHub Repository Setup

#### Create Required Labels
PoppoBuilder requires specific labels in your GitHub repository to function properly:

```bash
# Run the automatic label creation script
node scripts/setup-labels.js
```

Or manually create the following labels:
- `task:misc` - For regular tasks
- `task:dogfooding` - For PoppoBuilder self-improvement
- `processing` - Indicates processing in progress
- `awaiting-response` - Indicates waiting for comments
- `completed` - Indicates task completion

### 6. Language Configuration (Optional)
PoppoBuilder features comprehensive internationalization support. You can configure the response language and localization settings.

Create `.poppo/config.json`:
```json
{
  "language": "en",           
  "fallbackLanguage": "en",   
  "autoDetect": false         
}
```

Available languages:
- `ja` - Japanese (default)
- `en` - English

Internationalization features:
- **Automatic Language Detection**: Based on system locale or configuration
- **Dynamic Message Translation**: Real-time translation of all system messages
- **Error Message Localization**: Comprehensive error messages in both languages
- **Log Message Translation**: Multilingual logging with structured error codes
- **CLI Internationalization**: Command-line interface in multiple languages

### 7. System Configuration (Required)
Review and adjust `config/config.json` as needed:
```json
{
  "github": {
    "owner": "your-github-username",
    "repo": "your-repo-name"
  },
  "commentHandling": {
    "enabled": true,
    "completionKeywords": [
      "thank you", "thanks", "done", "complete", "completed",
      "OK", "ok", "understood", "got it"
    ]
  }
}
```

## CLI Commands

PoppoBuilder provides various CLI commands for enhanced management:

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
```

## Verification

### 1. Start PoppoBuilder
```bash
npm start
```

When started successfully, you'll see logs like:
```
[2025-06-16 10:00:00] [INFO] PoppoBuilder started
[2025-06-16 10:00:00] [INFO] Monitoring GitHub issues...
```

### 2. Create a Test Issue
In another terminal, run:
```bash
gh issue create \
  --title "Installation Test" \
  --body "What time is it now?" \
  --label "task:misc" \
  --repo $GITHUB_OWNER/$GITHUB_REPO
```

### 3. Verify Operation
- PoppoBuilder will detect the issue after about 30 seconds and start processing
- Check the GitHub issue page to see PoppoBuilder's comment
- The `processing` label will be added, then changed to `awaiting-response` after completion

### 4. Test Comment Thread Feature
After initial processing is complete, add a comment to the issue:
```bash
gh issue comment <issue-number> \
  --body "I have an additional question" \
  --repo $GITHUB_OWNER/$GITHUB_REPO
```
- PoppoBuilder will automatically detect the comment and process it
- When you post a comment with completion keywords (like "thank you"), the `completed` label will be applied

## Process Management

### Stopping PoppoBuilder
```bash
# Find the process ID
ps aux | grep PoppoBuilder-Main

# Stop the process
kill <PID>
```

### Checking Logs
```bash
# Real-time log display
tail -f logs/poppo-$(date +%Y-%m-%d).log

# Process logs
tail -f logs/processes-$(date +%Y-%m-%d).log
```

## Troubleshooting

### If Claude CLI Hangs
- **Symptom**: Claude CLI hangs waiting for prompt
- **Solution**: Current version sends prompts via stdin, so this issue is resolved
- **Check**: Ensure Claude CLI is the latest version

### If GitHub Comment Posting Fails
- **Symptom**: Errors occur with comments containing special characters
- **Solution**: Current version uses `--body-file` option to post via file, so this issue is resolved
- **Check**: 
  - Verify GitHub CLI authentication: `gh auth status`
  - Ensure you have write permissions to the repository

### If Issues Are Not Detected
- Verify correct labels are applied (`task:misc` or `task:dogfooding`)
- Check GitHub settings in `.env` file
- Also check GitHub settings in `config/config.json`

### If awaiting-response Label is Not Applied
- **Symptom**: Comment thread feature doesn't work after issue processing
- **Cause**: `awaiting-response` label doesn't exist in GitHub repository
- **Solution**: Run `node scripts/setup-labels.js` to create required labels

### restart-flag.json Error
- **Symptom**: `restart-flag.json` not found error during restart
- **Solution**: Current version uses one-shot restart method, so this issue is resolved

### If Language Response is Unexpected
- Check language setting in `.poppo/config.json`
- Restart PoppoBuilder to apply settings
- Default is Japanese (`"language": "ja"`)

### If Auto-restart Doesn't Work After Dogfooding Task
- **Symptom**: Auto-restart doesn't occur after `task:dogfooding` labeled issue completion
- **Check**: 
  - Verify `restart-scheduler.js` is properly placed
  - Check log files `logs/restart-*.log` for any errors

## Testing

PoppoBuilder Suite includes comprehensive testing capabilities:

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

## Next Steps

After installation is complete, refer to these guides:
- [Quick Start Guide](guides/quick-start.md) - Basic usage
- [Setup Guide](setup-guide.md) - Detailed configuration options
- [Internationalization Guide](features/i18n-system.md) - I18n system details
- [Error Handling Guide](features/error-system.md) - Error system documentation
- [Requirements](requirements/) - Detailed specifications
- [Architecture](architecture/) - System architecture documentation

## Support

If you encounter issues, you can get support through:
- Create an issue on [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)
- Check log files for detailed error information