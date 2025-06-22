# PR Command Guide

The `poppobuilder pr` command provides a guided interface for creating pull requests with optional Claude CLI assistance.

## Overview

This command guides you through the entire PR creation process, including:
- Checking for uncommitted changes
- Committing changes if needed
- Selecting the target branch
- Pushing commits to remote
- Creating the PR with an improved description
- Optional Claude assistance for better PR descriptions

## Prerequisites

Before using this command, ensure you have:

1. **Git repository**: The command must be run from within a git repository
2. **GitHub CLI (gh)**: Install from https://cli.github.com/
3. **GitHub authentication**: Run `gh auth login` if not authenticated
4. **Claude CLI** (optional): For AI-powered PR description improvements

## Usage

### Basic Usage

```bash
poppobuilder pr
```

This will start the interactive PR creation guide.

### Options

- `--no-claude`: Skip Claude assistance even if Claude CLI is available
- `--draft`: Create the PR as a draft
- `--base <branch>`: Specify the base branch (default: will prompt you to select)

### Examples

```bash
# Create a PR with guided assistance
poppobuilder pr

# Create a draft PR
poppobuilder pr --draft

# Create a PR targeting the develop branch
poppobuilder pr --base develop

# Create a PR without Claude assistance
poppobuilder pr --no-claude
```

## Process Flow

### 1. Prerequisites Check
The command first verifies:
- You're in a git repository
- GitHub CLI is installed and authenticated
- Claude CLI availability (optional)
- Current branch and uncommitted changes

### 2. Handle Uncommitted Changes
If you have uncommitted changes, you can:
- **Commit all changes**: Add and commit all changes with a custom message
- **Stash changes**: Temporarily stash changes
- **Continue without committing**: Proceed with existing commits only
- **Exit**: Cancel the PR creation

### 3. Select Base Branch
Choose the target branch for your PR:
- Common branches (main, master, develop) are shown first
- All other remote branches are listed below

### 4. Push Changes
If you have unpushed commits, they will be automatically pushed to the remote repository.

### 5. Create Pull Request
Enter PR details:
- **Title**: Defaults to your last commit message
- **Description**: Opens in your default editor with a template
- **Draft status**: Choose whether to create as draft

### 6. Claude Assistance (Optional)
If Claude CLI is available and you choose to use it:
- Claude analyzes your changes and current description
- Provides an improved PR description
- You can choose to use the improved version or keep your original

### 7. PR Creation
The PR is created using GitHub CLI and you'll receive:
- Confirmation of successful creation
- PR URL
- Option to open in browser

## PR Description Template

The default PR description template includes:

```markdown
## Summary
<!-- Provide a brief summary of your changes -->

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Code refactoring

## Testing
<!-- Describe how you tested your changes -->

## Checklist
- [ ] I have tested my changes
- [ ] I have updated the documentation (if needed)
- [ ] My code follows the project's coding standards
```

## Claude Integration

When Claude assistance is enabled, it will:
1. Analyze your git diff
2. Review your initial PR description
3. Provide an enhanced description that:
   - Clearly explains changes and motivations
   - Highlights breaking changes
   - Includes relevant testing information
   - Maintains the template structure
   - Is concise but comprehensive

## Troubleshooting

### "Not in a git repository" error
- Ensure you're running the command from within a git repository
- Check that `.git` directory exists

### "GitHub CLI is not authenticated" error
- Run `gh auth login` to authenticate
- Follow the prompts to complete authentication

### "A PR already exists for this branch" warning
- You can view the existing PR
- Or create a new branch for a separate PR

### Claude assistance not working
- Verify Claude CLI is installed: `claude --version`
- Ensure you're logged in to Claude
- Check that the Claude CLI is in your PATH

## Best Practices

1. **Commit frequently**: Make small, logical commits before creating PR
2. **Write clear commit messages**: They become the default PR title
3. **Use the template**: Fill out all sections of the PR template
4. **Review Claude's suggestions**: But ensure they accurately represent your changes
5. **Create draft PRs**: For work in progress that needs early feedback

## See Also

- [Git Workflow Guide](../guides/git-workflow.md)
- [Commit Message Guidelines](../guides/commit-guidelines.md)
- [Code Review Best Practices](../guides/code-review.md)