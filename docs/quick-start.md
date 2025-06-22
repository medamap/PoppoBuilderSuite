# PoppoBuilder Suite Quick Start Guide

Get started with PoppoBuilder in 5 minutes. This guide will help you quickly begin automated task processing using GitHub Issues.

## 🔧 Prerequisites

### Required Software
- **Node.js** 18 or higher ([Installation Guide](https://nodejs.org/))
- **Claude CLI** installed and configured ([Setup Guide](https://claude.ai/docs))
- **GitHub CLI** (`gh`) installed and authenticated ([Installation Guide](https://cli.github.com/))
- **Git** ([Installation Guide](https://git-scm.com/))

### Verification
```bash
# Check Node.js version
node --version  # Should be v18.0.0 or higher

# Check Claude CLI
claude --version

# Check GitHub CLI
gh --version
gh auth status  # Should show authenticated status

# Check Git
git --version
```

## 🚀 30-Second Setup

### 1. Installation

```bash
# Clone the repository
git clone https://github.com/medamap/PoppoBuilderSuite.git
cd PoppoBuilderSuite

# Install dependencies
npm install

# Configure environment variables
cp .env.example .env
# Edit .env file with your GitHub settings

# Initialize GitHub labels
node scripts/setup-labels.js

# Start PoppoBuilder
npm start
```

### 2. Setup Wizard (Recommended)

For a guided setup experience:

```bash
# Run the interactive setup wizard
npm run setup:wizard

# Or run directly
node lib/commands/setup-wizard.js

# Check dependencies only
npm run deps:check
```

### 3. Startup Verification

When started successfully, you'll see logs like:
```
[2025-01-20 12:00:00] [INFO] PoppoBuilder-Main Starting PoppoBuilder...
[2025-01-20 12:00:01] [INFO] PoppoBuilder-Main Loaded configuration from: config/config.json
[2025-01-20 12:00:02] [INFO] PoppoBuilder-Main Starting issue polling (interval: 30000ms)
```

## 📝 Basic Usage

### 1. Running Regular Tasks

Create a GitHub Issue to execute a task:
```bash
gh issue create \
  --title "Task title" \
  --body "Description of what you want to do" \
  --label "task:misc" \
  --repo owner/repo
```

Example:
```bash
gh issue create \
  --title "Explain database connection setup" \
  --body "Please explain how to connect to PostgreSQL" \
  --label "task:misc" \
  --repo medamap/my-project
```

### 2. Checking Status

```bash
# Check issues being processed
gh issue list --label "processing" --repo owner/repo

# Check issues awaiting response
gh issue list --label "awaiting-response" --repo owner/repo

# Check logs
tail -f logs/poppo-$(date +%Y-%m-%d).log
```

### 3. Dialogue via Comments

After PoppoBuilder's initial processing, you can continue asking questions via comments:
```bash
# Additional questions
gh issue comment <issue-number> \
  --body "Your additional question here" \
  --repo owner/repo

# Indicate completion
gh issue comment <issue-number> \
  --body "Thank you" \
  --repo owner/repo
```

## 🔄 Dogfooding (Self-Improvement) Tasks

Tasks that improve PoppoBuilder itself:

### 1. Create Feature Addition Issue

```bash
gh issue create \
  --title "PoppoBuilder Feature: XXX feature" \
  --body "Detailed description of the feature..." \
  --label "task:dogfooding" \
  --repo medamap/PoppoBuilderSuite
```

### 2. Special Dogfooding Behavior

Issues with `task:dogfooding` label:
- Automatically reference CLAUDE.md
- Update CLAUDE.md after implementation
- Schedule automatic restart 30 seconds after completion

### 3. Verify Automatic Restart

```bash
# Check restart logs
tail -f logs/restart-$(date +%Y-%m-%d).log

# Monitor PoppoBuilder process
watch -n 1 'ps aux | grep PoppoBuilder-Main | grep -v grep'
```

## 🌐 Language Configuration

To change PoppoBuilder's response language:

### 1. Edit Configuration File

Create or edit `.poppo/config.json`:
```json
{
  "language": "en",           // "ja" or "en"
  "fallbackLanguage": "en",   // Fallback language
  "autoDetect": false         // Auto-detect system locale
}
```

### 2. Restart PoppoBuilder

```bash
# Stop current process
ps aux | grep PoppoBuilder-Main
kill <PID>

# Restart
npm start
```

## ⚠️ Troubleshooting

### If Issues Are Not Detected

1. Verify correct labels are applied
2. Confirm PoppoBuilder is running
3. Check logs: `tail -f logs/poppo-$(date +%Y-%m-%d).log`

### If Claude CLI Hangs

1. Ensure Claude CLI is the latest version
2. Verify API key is correctly configured
3. Check process logs: `tail -f logs/processes-$(date +%Y-%m-%d).log`

### If Comments Get No Response

1. Confirm `awaiting-response` label is attached
2. Verify comment is from the issue creator
3. Check comment monitoring logs

## 🎯 Advanced Usage

### Customize System Configuration

Edit `config/config.json` to adjust behavior:

```json
{
  "github": {
    "owner": "your-username",
    "repo": "your-repo"
  },
  "polling": {
    "interval": 60000  // Check every minute
  },
  "claude": {
    "maxConcurrent": 2,
    "timeout": 43200000  // Reduce to 12 hours
  },
  "commentHandling": {
    "enabled": true,
    "maxCommentCount": 20,  // Increase max comments
    "completionKeywords": [
      "thank you", "thanks", "done", "finished", "closed"
    ]
  }
}
```

### Managing Multiple Projects

Set up PoppoBuilder for another project:

```bash
# Clone to a different directory
cd ~/Projects/AnotherProject
git clone https://github.com/medamap/PoppoBuilderSuite.git poppo-for-project
cd poppo-for-project

# Configure environment variables
cp .env.example .env
# Set GITHUB_OWNER and GITHUB_REPO to target project

# Start
npm start
```

### Batch Processing

Create multiple related issues at once:

```bash
# Batch creation with script
for task in "Add tests" "Update documentation" "Refactoring"; do
  gh issue create \
    --title "$task" \
    --body "Details for $task" \
    --label "task:misc" \
    --repo owner/repo
done
```

## 💡 Best Practices

1. **Be specific in issue descriptions**: Clearly describe what you want done
2. **Use appropriate labels**: `task:misc` or `task:dogfooding`
3. **Check logs regularly**: Monitor long-running tasks
4. **Dialogue via comments**: Provide additional info or questions in comments
5. **Use completion keywords**: End tasks with "thank you" etc.

## 🎉 Congratulations!

You've mastered the basics of PoppoBuilder.

### Next Steps

1. **Learn More**
   - [Installation Guide](INSTALL_en.md) - Detailed configuration methods
   - [Memory Management Guide](features/memory-management-guide.md) - Performance optimization
   - [Error Handling Guide](features/error-handling-guide.md) - Troubleshooting methods

2. **Use Advanced Features**
   - [Dashboard Operation Guide](features/dashboard-guide.md) - Web interface
   - [Testing Framework Guide](features/testing-guide.md) - Automated testing
   - [CLI Command Reference](api/cli-reference.md) - Complete command list

3. **Improve PoppoBuilder**
   ```bash
   gh issue create \
     --title "PoppoBuilder Improvement: [Your Idea]" \
     --body "Detailed description..." \
     --label "task:dogfooding" \
     --repo medamap/PoppoBuilderSuite
   ```

### Support

If problems persist:
- Check the [Troubleshooting Guide](troubleshooting.md)
- Ask questions on [GitHub Issues](https://github.com/medamap/PoppoBuilderSuite/issues)
- Refer to [Best Practices](best-practices.md)

### Language Support

- **[English Documentation](README_en.md)** - Complete English documentation
- **[日本語ドキュメント](ja/quick-start.md)** - 日本語版クイックスタート