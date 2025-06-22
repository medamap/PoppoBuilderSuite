# PoppoBuilder Suite Setup Guide

This guide explains the detailed setup procedures and configuration options for PoppoBuilder. For basic installation instructions, see the [Installation Guide](INSTALL.md).

## Initial Setup

### 1. Prerequisites Verification
- Node.js 18 or higher
- `gh` CLI (GitHub CLI) installed and authenticated
- `claude` CLI installed and authenticated
- Git

### 2. Clone Repository
```bash
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Environment Variables Configuration
```bash
cp .env.example .env
```

Edit the `.env` file with your GitHub settings:
```
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name
```

### 5. GitHub Labels Setup
```bash
node scripts/setup-labels.js
```

This command performs the following actions:

#### Required Labels Creation
Automatically creates labels required for PoppoBuilder operation:
- `task:misc` - Regular tasks
- `task:dogfooding` - PoppoBuilder self-improvement tasks
- `processing` - Indicates processing in progress
- `awaiting-response` - Indicates waiting for comments
- `completed` - Indicates task completion

### 6. Language Configuration (Optional)
You can configure PoppoBuilder's response language. Default is Japanese.

Create `.poppo/config.json`:
```json
{
  "language": "en",           // "ja" or "en"
  "fallbackLanguage": "en",   // Fallback language
  "autoDetect": false         // Auto-detect system locale
}
```

### 7. Start PoppoBuilder
```bash
npm start
```

When started successfully, you'll see logs like:
```
[2025-06-16 10:00:00] [INFO] PoppoBuilder started
[2025-06-16 10:00:00] [INFO] Monitoring GitHub issues...
```

## Customization

### System Configuration Customization
Edit `config/config.json` to customize behavior:

```json
{
  "github": {
    "owner": "GitHub username",
    "repo": "Repository name"
  },
  "claude": {
    "maxConcurrent": 2,        // Maximum concurrent executions
    "timeout": 86400000        // Timeout (24 hours)
  },
  "polling": {
    "interval": 30000          // Issue check interval (milliseconds)
  },
  "commentHandling": {
    "enabled": true,           // Enable/disable comment threading
    "completionKeywords": [    // Completion keywords
      "thank you", "thanks", "done", "complete", "completed",
      "OK", "ok", "understood", "got it"
    ],
    "maxCommentCount": 10,     // Maximum comment responses per issue
    "timeoutHours": 24         // Comment waiting timeout (hours)
  }
}
```

### Using with Existing Projects
To use PoppoBuilder with existing GitHub projects:

1. Specify target repository via environment variables
2. Ensure required labels exist
3. Start PoppoBuilder to begin issue processing

## Advanced Configuration

### Leveraging Dogfooding Functionality
PoppoBuilder has self-improvement capabilities (Dogfooding). For issues with `task:dogfooding` label:

1. **Automatic CLAUDE.md Reference**: Understands current implementation status
2. **Automatic Update After Implementation**: Records changes in CLAUDE.md
3. **Automatic Restart**: Reflects new features 30 seconds after completion

### Comment Threading Configuration
Fine-tune behavior using the `commentHandling` section:

- **enabled**: Enable/disable comment threading functionality
- **completionKeywords**: Keywords that indicate task completion
- **maxCommentCount**: Maximum comment responses per issue
- **timeoutHours**: Comment waiting timeout duration

## Internationalization Features

### Language Configuration
PoppoBuilder features comprehensive internationalization support:

```json
{
  "language": "en",           // Primary language (en/ja)
  "fallbackLanguage": "en",   // Fallback when translation missing
  "autoDetect": false         // Auto-detect from system locale
}
```

### Supported Features
- **Automatic Language Detection**: Based on system locale or configuration
- **Dynamic Message Translation**: Real-time translation of all system messages
- **Error Message Localization**: Comprehensive error messages in both languages
- **Log Message Translation**: Multilingual logging with structured error codes
- **CLI Internationalization**: Command-line interface in multiple languages

## CLI Commands

PoppoBuilder provides various CLI commands for management:

```bash
# Project initialization
poppobuilder init

# Service startup
poppobuilder start
poppobuilder start --daemon  # Start in daemon mode

# Status check
poppobuilder status

# Configuration management
poppobuilder config --list   # List configuration
npm run config:show          # Show current configuration
npm run config:validate      # Validate configuration

# Testing
npm run test:i18n            # Internationalization tests
npm run test:errors          # Error system tests
npm run deps:check           # Dependency check
```

## Troubleshooting

### Label Creation Errors
- Verify `gh` command is authenticated: `gh auth status`
- Ensure you have write permissions to the repository

### Claude CLI Hangs
- **Resolved**: Current version sends prompts via stdin
- Ensure Claude CLI is the latest version

### Issues Not Detected
- Verify correct labels are applied
- Check GitHub settings in `.env` file
- Also check settings in `config/config.json`

### awaiting-response Label Not Applied
- Labels may not exist in GitHub repository
- Re-run `node scripts/setup-labels.js`

### Unexpected Language in Responses
- Check language setting in `.poppo/config.json`
- Restart PoppoBuilder to apply settings

### Testing Configuration
```bash
# Test i18n functionality
npm run test:i18n

# Test error system
npm run test:errors

# Check all dependencies
npm run deps:check

# Validate configuration
npm run config:validate
```

For detailed troubleshooting, see the [Installation Guide](INSTALL.md#troubleshooting).

## Next Steps

After setup is complete:
- Try the [Quick Start Guide](quick-start.md) for basic usage
- Explore [Advanced Features](features/) for enhanced functionality
- Read [Best Practices](best-practices.md) for optimal usage
- Check [API Reference](api/) for detailed command information

## Additional Resources

For more information:
- [Quick Start Guide](guides/quick-start.md) - Basic usage guide
- [Installation Guide](INSTALL.md) - Complete installation instructions
- [Contributing Guide](../CONTRIBUTING.md) - How to contribute to the project
- [Feature Documentation](features/) - Detailed feature guides