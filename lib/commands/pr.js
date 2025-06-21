const chalk = require('chalk');
const { execSync, spawn } = require('child_process');
const readline = require('readline');
const fs = require('fs').promises;
const path = require('path');
const i18n = require('../i18n');

class PRCommand {
  constructor() {
    this.currentBranch = null;
    this.baseBranch = null;
    this.hasUncommittedChanges = false;
    this.hasUnpushedCommits = false;
    this.claudeAvailable = false;
    this.rl = null;
  }

  // Helper function to prompt user
  async prompt(question) {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
    }
    
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => {
        resolve(answer);
      });
    });
  }

  // Helper function to select from list
  async select(message, choices, defaultIndex = 0) {
    console.log(chalk.yellow(message));
    choices.forEach((choice, index) => {
      const marker = index === defaultIndex ? '>' : ' ';
      console.log(`${marker} ${index + 1}. ${choice.name || choice}`);
    });
    
    const answer = await this.prompt(`\nSelect an option (1-${choices.length}) [${defaultIndex + 1}]: `);
    const index = parseInt(answer) - 1;
    
    if (isNaN(index) || index < 0 || index >= choices.length) {
      return choices[defaultIndex];
    }
    
    return choices[index];
  }

  // Helper function for yes/no confirmation
  async confirm(message, defaultValue = true) {
    const defaultText = defaultValue ? 'Y/n' : 'y/N';
    const answer = await this.prompt(`${message} (${defaultText}): `);
    
    if (!answer) return defaultValue;
    return answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
  }

  // Clean up readline interface
  cleanup() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  async execute(options = {}) {
    try {
      console.log(chalk.blue('\n🔀 PoppoBuilder PR Creation Guide\n'));
      
      // Check prerequisites
      await this.checkPrerequisites();
      
      // Guide through PR creation process
      await this.guidePRCreation(options);
      
    } catch (error) {
      console.error(chalk.red('Error:'), error.message);
      throw error;
    } finally {
      this.cleanup();
    }
  }

  async checkPrerequisites() {
    console.log(chalk.yellow('📋 Checking prerequisites...\n'));
    
    // Check if in a git repository
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
    } catch (error) {
      throw new Error('Not in a git repository. Please run this command from within a git repository.');
    }
    
    // Check if gh CLI is available
    try {
      execSync('gh --version', { stdio: 'ignore' });
    } catch (error) {
      throw new Error('GitHub CLI (gh) is not installed. Please install it first: https://cli.github.com/');
    }
    
    // Check if gh is authenticated
    try {
      execSync('gh auth status', { stdio: 'ignore' });
    } catch (error) {
      throw new Error('GitHub CLI is not authenticated. Please run: gh auth login');
    }
    
    // Check if Claude CLI is available
    try {
      execSync('claude --version', { stdio: 'ignore' });
      this.claudeAvailable = true;
    } catch (error) {
      console.log(chalk.yellow('⚠️  Claude CLI not found. Proceeding without Claude assistance.'));
      this.claudeAvailable = false;
    }
    
    // Get current branch
    this.currentBranch = execSync('git branch --show-current', { encoding: 'utf-8' }).trim();
    
    // Check for uncommitted changes
    const gitStatus = execSync('git status --porcelain', { encoding: 'utf-8' });
    this.hasUncommittedChanges = gitStatus.trim().length > 0;
    
    // Check for unpushed commits
    try {
      const unpushed = execSync(`git log origin/${this.currentBranch}..HEAD --oneline`, { encoding: 'utf-8' });
      this.hasUnpushedCommits = unpushed.trim().length > 0;
    } catch (error) {
      // Branch might not exist on remote yet
      this.hasUnpushedCommits = true;
    }
    
    console.log(chalk.green('✅ All prerequisites met!\n'));
  }

  async guidePRCreation(options) {
    // Step 1: Handle uncommitted changes
    if (this.hasUncommittedChanges) {
      console.log(chalk.yellow('⚠️  You have uncommitted changes.\n'));
      
      const choices = [
        { name: 'Commit all changes', value: 'commit' },
        { name: 'Stash changes temporarily', value: 'stash' },
        { name: 'Continue without committing', value: 'continue' },
        { name: 'Exit', value: 'exit' }
      ];
      
      const action = await this.select('What would you like to do?', choices);
      
      if (action.value === 'exit') {
        console.log(chalk.gray('PR creation cancelled.'));
        return;
      }
      
      if (action.value === 'commit') {
        await this.commitChanges();
      } else if (action.value === 'stash') {
        execSync('git stash push -m "PR creation stash"', { stdio: 'inherit' });
        console.log(chalk.green('✅ Changes stashed successfully.'));
      }
    }
    
    // Step 2: Select base branch
    const branches = execSync('git branch -r', { encoding: 'utf-8' })
      .split('\n')
      .map(b => b.trim())
      .filter(b => b && !b.includes('->'))
      .map(b => b.replace('origin/', ''));
    
    const mainBranches = branches.filter(b => ['main', 'master', 'develop'].includes(b));
    const otherBranches = branches.filter(b => !mainBranches.includes(b));
    
    // Override with command line option if provided
    if (options.base && branches.includes(options.base)) {
      this.baseBranch = options.base;
      console.log(chalk.gray(`Using base branch: ${this.baseBranch}`));
    } else {
      const allBranches = [
        ...mainBranches.map(b => ({ name: b, value: b })),
        ...otherBranches.map(b => ({ name: b, value: b }))
      ];
      
      const defaultIndex = mainBranches.includes('develop') ? 
        allBranches.findIndex(b => b.value === 'develop') : 
        allBranches.findIndex(b => b.value === 'main');
      
      const selected = await this.select(
        'Select the base branch for your PR:',
        allBranches,
        defaultIndex >= 0 ? defaultIndex : 0
      );
      
      this.baseBranch = selected.value;
    }
    
    // Step 3: Push changes if needed
    if (this.hasUnpushedCommits) {
      console.log(chalk.yellow('\n📤 Pushing commits to remote...\n'));
      
      try {
        execSync(`git push -u origin ${this.currentBranch}`, { stdio: 'inherit' });
        console.log(chalk.green('✅ Changes pushed successfully!\n'));
      } catch (error) {
        throw new Error('Failed to push changes. Please resolve any conflicts and try again.');
      }
    }
    
    // Step 4: Create PR
    console.log(chalk.blue('\n📝 Creating Pull Request...\n'));
    
    const prOptions = await this.getPROptions();
    
    if (this.claudeAvailable && prOptions.useClaudeHelp) {
      await this.createPRWithClaude(prOptions);
    } else {
      await this.createPRManually(prOptions);
    }
  }

  async commitChanges() {
    let commitMessage = '';
    while (!commitMessage.trim()) {
      commitMessage = await this.prompt('Enter commit message: ');
      if (!commitMessage.trim()) {
        console.log(chalk.red('Commit message cannot be empty'));
      }
    }
    
    // Show what will be committed
    console.log(chalk.gray('\nFiles to be committed:'));
    execSync('git status --short', { stdio: 'inherit' });
    
    const confirm = await this.confirm('Proceed with commit?', true);
    
    if (confirm) {
      execSync('git add -A', { stdio: 'inherit' });
      
      // Add Claude signature if using Claude
      const fullMessage = this.claudeAvailable ? 
        `${commitMessage}\n\n🤖 Generated with [Claude Code](https://claude.ai/code)\n\nCo-Authored-By: Claude <noreply@anthropic.com>` :
        commitMessage;
      
      execSync(`git commit -m "${fullMessage}"`, { stdio: 'inherit' });
      console.log(chalk.green('✅ Changes committed successfully!'));
      this.hasUnpushedCommits = true;
    }
  }

  async getPROptions() {
    const options = {};
    
    // Get PR title
    let defaultTitle = '';
    try {
      defaultTitle = execSync('git log -1 --pretty=%B', { encoding: 'utf-8' }).trim().split('\n')[0];
    } catch {
      // Ignore error
    }
    
    options.title = await this.prompt(`PR Title${defaultTitle ? ` [${defaultTitle}]` : ''}: `);
    if (!options.title.trim()) {
      options.title = defaultTitle;
    }
    
    while (!options.title.trim()) {
      console.log(chalk.red('PR title cannot be empty'));
      options.title = await this.prompt('PR Title: ');
    }
    
    // Get PR description
    console.log(chalk.yellow('\nPR Description (press Enter to use default template):'));
    const useTemplate = await this.confirm('Use default PR template?', true);
    
    if (useTemplate) {
      options.body = `## Summary
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
`;
    } else {
      console.log('Enter PR description (type "END" on a new line when done):');
      const lines = [];
      let line = '';
      while ((line = await this.prompt('')) !== 'END') {
        lines.push(line);
      }
      options.body = lines.join('\n');
    }
    
    // Check if draft
    options.draft = options.draft || await this.confirm('Create as draft PR?', false);
    
    // Check Claude help
    if (this.claudeAvailable && !options.noClaude) {
      options.useClaudeHelp = await this.confirm('Would you like Claude to help improve your PR description?', true);
    }
    
    return options;
  }

  async createPRWithClaude(options) {
    console.log(chalk.blue('🤖 Getting help from Claude...\n'));
    
    // Get git diff for context
    const diff = execSync(`git diff ${this.baseBranch}...HEAD`, { encoding: 'utf-8', maxBuffer: 1024 * 1024 * 10 });
    
    // Create a temporary file with the prompt
    const tempDir = path.join(process.cwd(), '.poppo-temp');
    await fs.mkdir(tempDir, { recursive: true });
    const promptFile = path.join(tempDir, 'pr-prompt.md');
    
    const prompt = `Please help me create a pull request description. Here's the information:

Title: ${options.title}

Current Description:
${options.body}

Git Diff:
\`\`\`diff
${diff.substring(0, 10000)}${diff.length > 10000 ? '\n... (truncated)' : ''}
\`\`\`

Please provide an improved PR description that:
1. Clearly explains what changes were made and why
2. Highlights any breaking changes or important notes
3. Includes relevant testing information
4. Follows the existing template structure
5. Is concise but comprehensive

Format your response as markdown that can be directly used as the PR body.`;
    
    await fs.writeFile(promptFile, prompt);
    
    try {
      // Call Claude via CLI
      const claudeProcess = spawn('claude', ['<', promptFile], { shell: true });
      
      let claudeOutput = '';
      claudeProcess.stdout.on('data', (data) => {
        claudeOutput += data.toString();
      });
      
      await new Promise((resolve, reject) => {
        claudeProcess.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error('Claude process failed'));
        });
      });
      
      // Parse Claude's response
      const improvedBody = this.parseClaudeResponse(claudeOutput);
      
      console.log(chalk.green('✅ Claude has improved your PR description!\n'));
      
      // Show the improved description
      console.log(chalk.gray('Improved PR Description:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(improvedBody);
      console.log(chalk.gray('─'.repeat(50)));
      
      const useImproved = await this.confirm('Use Claude\'s improved description?', true);
      
      if (useImproved) {
        options.body = improvedBody;
      }
      
    } catch (error) {
      console.log(chalk.yellow('⚠️  Failed to get help from Claude. Proceeding with original description.'));
    } finally {
      // Cleanup
      try {
        await fs.unlink(promptFile);
        await fs.rmdir(tempDir);
      } catch {}
    }
    
    await this.createPRManually(options);
  }

  parseClaudeResponse(response) {
    // Extract the markdown content from Claude's response
    // Claude might wrap the response in various ways, so we need to be flexible
    
    // Remove any system messages or prompts
    let cleaned = response.trim();
    
    // If the response contains code blocks, extract the content
    const codeBlockMatch = cleaned.match(/```(?:markdown|md)?\n([\s\S]*?)\n```/);
    if (codeBlockMatch) {
      cleaned = codeBlockMatch[1];
    }
    
    // Remove any leading/trailing artifacts
    cleaned = cleaned.replace(/^.*?(?=##)/s, '');
    
    return cleaned.trim();
  }

  async createPRManually(options) {
    // Create the PR using gh CLI
    const args = [
      'pr', 'create',
      '--base', this.baseBranch,
      '--head', this.currentBranch,
      '--title', options.title,
      '--body', options.body
    ];
    
    if (options.draft) {
      args.push('--draft');
    }
    
    try {
      const result = execSync(`gh ${args.join(' ')}`, { encoding: 'utf-8' });
      const prUrl = result.trim();
      
      console.log(chalk.green('\n✅ Pull Request created successfully!'));
      console.log(chalk.blue('PR URL:'), prUrl);
      
      const openInBrowser = await this.confirm('Open PR in browser?', true);
      
      if (openInBrowser) {
        // Use platform-specific command to open URL
        const openCommand = process.platform === 'darwin' ? 'open' : 
                          process.platform === 'win32' ? 'start' : 'xdg-open';
        execSync(`${openCommand} "${prUrl}"`);
      }
      
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(chalk.yellow('\n⚠️  A PR already exists for this branch.'));
        
        const viewExisting = await this.confirm('View existing PR?', true);
        
        if (viewExisting) {
          execSync('gh pr view --web', { stdio: 'inherit' });
        }
      } else {
        throw error;
      }
    }
  }

  static getCommandDefinition() {
    return {
      command: 'pr',
      description: 'Create a pull request with guided assistance',
      options: [
        ['--no-claude', 'Skip Claude assistance even if available'],
        ['--draft', 'Create as draft PR'],
        ['--base <branch>', 'Specify base branch']
      ],
      action: async (options) => {
        try {
          const prCommand = new PRCommand();
          await prCommand.execute(options);
        } catch (error) {
          console.error(chalk.red('Error:'), error.message);
          process.exit(1);
        }
      }
    };
  }
}

module.exports = PRCommand;