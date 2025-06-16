# PoppoBuilder Suite Setup Guide

This guide explains detailed setup methods and configuration options for PoppoBuilder. For basic installation steps, see the [Installation Guide](INSTALL_en.md).

## Initial Setup

### 1. Verify Prerequisites
- Node.js 18 or higher
- `gh` CLI (GitHub CLI) installed and authenticated
- `claude` CLI installed and authenticated
- Git

### 2. Clone the Repository
```bash
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Configure Environment Variables
```bash
cp .env.example .env
```

Edit the `.env` file with your GitHub settings:
```
GITHUB_OWNER=your-github-username
GITHUB_REPO=your-repo-name
```

### 5. Setup GitHub Labels
```bash
node scripts/setup-labels.js
```

This command will:

#### Create Required Labels
Automatically creates labels necessary for PoppoBuilder operation:
- `task:misc` - Regular tasks
- `task:dogfooding` - PoppoBuilder self-improvement tasks
- `processing` - Indicates processing in progress
- `awaiting-response` - Indicates waiting for comments
- `completed` - Indicates completion

### 6. Language Configuration (Optional)
You can configure PoppoBuilder's response language. Default is Japanese.

Create `.poppo/config.json`:
```json
{
  "language": "en"  // "ja" or "en"
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
    "enabled": true,           // Enable/disable comment thread feature
    "completionKeywords": [    // Completion keywords
      "thank you", "thanks", "done", "complete", "completed",
      "OK", "ok", "understood", "got it"
    ],
    "maxCommentCount": 10,     // Maximum comment replies per issue
    "timeoutHours": 24         // Comment waiting timeout (hours)
  }
}
```

### Using with Existing Projects
When using PoppoBuilder with existing GitHub projects:

1. Specify the target repository in environment variables
2. Ensure required labels exist
3. Start PoppoBuilder to begin processing issues

## Advanced Configuration

### Utilizing Dogfooding Feature
PoppoBuilder has self-improvement capabilities (Dogfooding). For issues with `task:dogfooding` label:

1. **Automatic CLAUDE.md Reference**: Understands current implementation status
2. **Automatic Update After Implementation**: Records changes to CLAUDE.md
3. **Auto-restart**: Reflects new features 30 seconds after completion

### Comment Thread Feature Configuration
You can fine-tune behavior in the `commentHandling` section:

- **enabled**: Enable/disable comment thread feature
- **completionKeywords**: Keywords to determine completion
- **maxCommentCount**: Maximum comment responses per issue
- **timeoutHours**: Comment waiting timeout duration

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
- The label might not exist in the GitHub repository
- Re-run `node scripts/setup-labels.js`

### Language Response Unexpected
- Check language setting in `.poppo/config.json`
- Restart PoppoBuilder to apply settings

For detailed troubleshooting, see the [Installation Guide](INSTALL_en.md#troubleshooting).