const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const i18n = require('../i18n');

class SetupWizard {
  constructor() {
    this.steps = [
      {
        name: 'git-check',
        prompt: this.getGitCheckPrompt(),
        validator: this.validateGitSetup
      },
      {
        name: 'gh-setup',
        prompt: this.getGhSetupPrompt(),
        validator: this.validateGhSetup
      },
      {
        name: 'branch-setup',
        prompt: this.getBranchSetupPrompt(),
        validator: this.validateBranchSetup
      }
    ];
  }

  async runSetup(options = {}) {
    console.log(chalk.blue('\n🚀 PoppoBuilder Initial Setup Wizard\n'));

    for (const step of this.steps) {
      console.log(chalk.cyan(`\n📋 Step: ${step.name}`));
      
      // Check if step is already completed
      const isValid = await step.validator();
      if (isValid) {
        console.log(chalk.green(`✓ ${step.name} is already configured`));
        continue;
      }

      // Run Claude CLI for this step
      const success = await this.runClaudeGuide(step.prompt);
      
      if (!success) {
        console.log(chalk.red(`✗ ${step.name} setup failed`));
        
        const retry = await this.askRetry();
        if (retry) {
          // Retry this step
          await this.runClaudeGuide(step.prompt);
        } else {
          console.log(chalk.yellow('Setup cancelled'));
          return false;
        }
      }

      // Validate again
      const isValidAfter = await step.validator();
      if (!isValidAfter) {
        console.log(chalk.red(`✗ ${step.name} validation failed after setup`));
        return false;
      }
    }

    console.log(chalk.green('\n✨ Setup completed successfully!\n'));
    return true;
  }

  getGitCheckPrompt() {
    return `Please perform the following tasks:

1. Check if the current directory is a Git repository
   - Run: git status
   - If not a Git repository, guide the user to either:
     a) Initialize a new repository: git init
     b) Exit and navigate to a proper Git repository

2. If it's a Git repository, check the remote:
   - Run: git remote -v
   - Ensure a GitHub remote is configured
   - If not, guide to add one: git remote add origin <url>

3. Once confirmed, exit the prompt.

Please use the appropriate language based on the user's system language.`;
  }

  getGhSetupPrompt() {
    return `Please perform the following GitHub CLI setup tasks:

1. Check if 'gh' command is installed:
   - Run: gh --version
   - If not installed, guide the user to install it:
     - macOS: brew install gh
     - Linux: See https://github.com/cli/cli#installation
     - Windows: winget install --id GitHub.cli

2. Check authentication status:
   - Run: gh auth status
   - If not authenticated, guide through:
     - Run: gh auth login
     - Follow the interactive prompts

3. Verify the current repository:
   - Run: gh repo view
   - Ensure it shows the correct repository

4. Once everything is configured, exit the prompt.

Please use the appropriate language based on the user's system language.`;
  }

  getBranchSetupPrompt() {
    return `Please set up the work branch for PoppoBuilder:

1. Check the current branch:
   - Run: git branch --show-current

2. Explain that PoppoBuilder needs a dedicated work branch:
   - Branch name should be: work/poppo-builder
   - This keeps PoppoBuilder changes separate from main development

3. Create and switch to the work branch:
   - If main branch exists: git checkout -b work/poppo-builder main
   - Otherwise: git checkout -b work/poppo-builder

4. Push the branch to remote:
   - Run: git push -u origin work/poppo-builder

5. Confirm the branch is set up correctly:
   - Run: git branch -vv

6. Exit the prompt once completed.

Please use the appropriate language based on the user's system language.`;
  }

  async runClaudeGuide(prompt) {
    return new Promise((resolve) => {
      console.log(chalk.yellow('\nStarting Claude CLI guide...'));
      
      const claude = spawn('claude', [], {
        stdio: 'inherit',
        shell: true
      });

      // Send the prompt after a short delay
      setTimeout(() => {
        if (claude.stdin && !claude.stdin.destroyed) {
          claude.stdin.write(prompt);
          claude.stdin.end();
        }
      }, 1000);

      claude.on('exit', (code) => {
        resolve(code === 0);
      });

      claude.on('error', (error) => {
        console.error(chalk.red('Failed to start Claude CLI:'), error.message);
        resolve(false);
      });
    });
  }

  async validateGitSetup() {
    try {
      // Check if .git directory exists
      await fs.access('.git');
      
      // Check if remote is configured
      const { execSync } = require('child_process');
      const remotes = execSync('git remote', { encoding: 'utf8' }).trim();
      
      return remotes.length > 0;
    } catch {
      return false;
    }
  }

  async validateGhSetup() {
    try {
      const { execSync } = require('child_process');
      
      // Check if gh is installed
      execSync('gh --version', { stdio: 'ignore' });
      
      // Check if authenticated
      execSync('gh auth status', { stdio: 'ignore' });
      
      return true;
    } catch {
      return false;
    }
  }

  async validateBranchSetup() {
    try {
      const { execSync } = require('child_process');
      
      // Check current branch
      const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
      
      // Check if work/poppo-builder exists
      const branches = execSync('git branch -a', { encoding: 'utf8' });
      
      return currentBranch === 'work/poppo-builder' || branches.includes('work/poppo-builder');
    } catch {
      return false;
    }
  }

  async askRetry() {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(chalk.yellow('\nRetry this step? (y/n): '), (answer) => {
        rl.close();
        resolve(answer.toLowerCase() === 'y');
      });
    });
  }
}

module.exports = SetupWizard;