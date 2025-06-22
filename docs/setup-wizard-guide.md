# PoppoBuilder Setup Wizard Guide

## Overview

The PoppoBuilder Setup Wizard is an interactive tool that guides users through the initial environment setup required for PoppoBuilder. It ensures that Git, GitHub CLI, and the proper branch structure are configured correctly before initializing a PoppoBuilder project.

## Features

### 1. **Multi-Mode Operation**
- **Claude CLI Integration**: When Claude CLI is available, provides interactive, conversational guidance
- **Automatic Fixes**: Attempts to automatically resolve common setup issues
- **Manual Instructions**: Falls back to clear, step-by-step manual instructions when automation isn't possible

### 2. **Three-Step Setup Process**

#### Step 1: Git Repository Setup
- Validates if the current directory is a Git repository
- Automatically initializes Git if needed
- Checks for GitHub remote configuration
- Guides through remote setup if missing

#### Step 2: GitHub CLI Setup
- Checks if `gh` command is installed
- Provides OS-specific installation instructions
- Verifies GitHub authentication status
- Guides through the authentication process

#### Step 3: Work Branch Setup
- Creates a dedicated `work/poppo-builder` branch
- Ensures proper branch tracking with remote
- Explains the purpose of the dedicated branch

### 3. **Smart Validation**
- Each step is validated before and after execution
- Automatic retry mechanism for failed steps
- Clear error messages and recovery suggestions

## Usage

### Running the Setup Wizard

The setup wizard is automatically invoked when you run:

```bash
poppobuilder init
```

You can also run it standalone:

```bash
node lib/commands/setup-wizard.js
```

### Options

- `--skip-auto-fix`: Disable automatic fixes and use only manual/Claude guidance
- `--no-interactive`: Skip the wizard entirely (not recommended for first-time setup)

### Example Session

```
🚀 PoppoBuilder Initial Setup Wizard

This wizard will guide you through setting up your development environment for PoppoBuilder.

✓ Claude CLI detected

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Git Repository Setup
   Checking Git repository configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Attempting automatic setup...
Initializing Git repository...
Initialized empty Git repository in /path/to/project/.git/
✓ Git Repository Setup configured automatically

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 GitHub CLI Setup
   Setting up GitHub CLI authentication
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ GitHub CLI Setup is already configured

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📋 Work Branch Setup
   Creating dedicated work branch for PoppoBuilder
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Attempting automatic setup...
Creating work/poppo-builder branch...
Switched to a new branch 'work/poppo-builder'
Pushing branch to remote...
Branch 'work/poppo-builder' set up to track remote branch 'work/poppo-builder' from 'origin'.
✓ Work Branch Setup configured automatically

✨ Setup completed successfully!

PoppoBuilder is now ready to use. You can run "poppobuilder init" to continue.
```

## Manual Setup Instructions

If the automatic setup fails, you'll see manual instructions like:

### Git Repository Setup
```bash
# Check if this is a Git repository
git status

# If not a Git repository, initialize it
git init

# Add a GitHub remote (if not already configured)
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git

# Verify the remote is set
git remote -v
```

### GitHub CLI Setup
```bash
# Install GitHub CLI
# macOS:
brew install gh

# Ubuntu/Debian:
sudo apt install gh

# Windows:
winget install --id GitHub.cli

# Authenticate with GitHub
gh auth login

# Verify authentication
gh auth status
```

### Work Branch Setup
```bash
# Create the work branch for PoppoBuilder
git checkout -b work/poppo-builder

# Push the branch to remote
git push -u origin work/poppo-builder

# Verify the branch is tracking remote
git branch -vv
```

## Troubleshooting

### Claude CLI Not Found
If Claude CLI is not installed, the wizard will fall back to manual instructions. You can still complete the setup successfully without Claude.

### Git Remote Issues
If you don't have a GitHub repository yet:
1. Create a repository on GitHub
2. Add it as a remote: `git remote add origin https://github.com/username/repo.git`

### GitHub CLI Authentication Failed
1. Ensure you have a GitHub account
2. Run `gh auth login` and follow the prompts
3. Choose "GitHub.com" as the account type
4. Select your preferred authentication method (browser recommended)

### Branch Push Failed
This usually means you don't have push permissions:
1. Verify your GitHub authentication: `gh auth status`
2. Check repository permissions on GitHub
3. Ensure the remote URL is correct: `git remote -v`

## Integration with PoppoBuilder Init

The setup wizard is seamlessly integrated into the `poppobuilder init` command:

1. When you run `poppobuilder init`, it first checks your environment
2. If any setup steps are missing, the wizard automatically runs
3. Only after successful setup does the project initialization continue
4. This ensures a smooth, error-free initialization process

## Best Practices

1. **Always use the dedicated branch**: The `work/poppo-builder` branch keeps automated changes separate from your manual development
2. **Keep credentials secure**: Never commit GitHub tokens or API keys
3. **Regular updates**: Keep GitHub CLI updated for the best experience
4. **Review changes**: Always review PoppoBuilder's automated changes before merging

## Advanced Usage

### Programmatic Usage

```javascript
const SetupWizard = require('./lib/commands/setup-wizard');

const wizard = new SetupWizard();
const success = await wizard.runSetup({
  skipAutoFix: false  // Allow automatic fixes
});

if (success) {
  console.log('Environment is ready!');
}
```

### Custom Validation

You can extend the wizard with custom validation steps:

```javascript
class CustomSetupWizard extends SetupWizard {
  constructor() {
    super();
    this.steps.push({
      name: 'custom-check',
      title: 'Custom Environment Check',
      description: 'Checking custom requirements',
      prompt: this.getCustomPrompt.bind(this),
      validator: this.validateCustomSetup.bind(this),
      autoFix: this.autoFixCustomSetup.bind(this)
    });
  }
  
  // Implement custom methods...
}
```

## Conclusion

The PoppoBuilder Setup Wizard ensures that your development environment is properly configured before you start using PoppoBuilder. By combining automatic fixes, Claude CLI integration, and clear manual instructions, it provides a smooth onboarding experience for users of all skill levels.