const { spawn, execSync } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const chalk = require('chalk');
const readline = require('readline');
const i18n = require('../i18n');

class SetupWizard {
  constructor() {
    this.steps = [
      {
        name: 'dependencies',
        title: 'Dependency Check',
        description: 'Checking required dependencies and tools',
        prompt: this.getDependencyCheckPrompt.bind(this),
        validator: this.validateDependencies.bind(this),
        autoFix: this.autoFixDependencies.bind(this)
      },
      {
        name: 'git-check',
        title: 'Git Repository Setup',
        description: 'Checking Git repository configuration',
        prompt: this.getGitCheckPrompt.bind(this),
        validator: this.validateGitSetup.bind(this),
        autoFix: this.autoFixGitSetup.bind(this)
      },
      {
        name: 'gh-setup',
        title: 'GitHub CLI Setup',
        description: 'Setting up GitHub CLI authentication',
        prompt: this.getGhSetupPrompt.bind(this),
        validator: this.validateGhSetup.bind(this),
        autoFix: this.autoFixGhSetup.bind(this)
      },
      {
        name: 'poppo-config',
        title: 'PoppoBuilder Configuration',
        description: 'Setting up PoppoBuilder project configuration',
        prompt: this.getPoppoConfigPrompt.bind(this),
        validator: this.validatePoppoConfig.bind(this),
        autoFix: null
      },
      {
        name: 'branch-setup',
        title: 'Work Branch Setup',
        description: 'Creating dedicated work branch for PoppoBuilder',
        prompt: this.getBranchSetupPrompt.bind(this),
        validator: this.validateBranchSetup.bind(this),
        autoFix: this.autoFixBranchSetup.bind(this)
      }
    ];
    this.claudeAvailable = null;
  }

  async runSetup(options = {}) {
    console.log(chalk.blue('\n🚀 PoppoBuilder Initial Setup Wizard\n'));
    console.log(chalk.gray('This wizard will guide you through setting up your development environment for PoppoBuilder.\n'));

    // Check system dependencies first
    const depCheck = await this.checkSystemDependencies();
    if (!depCheck.allPassed) {
      console.log(chalk.yellow('\n⚠️  Some dependencies need attention before continuing.'));
    }

    // Claude CLI check disabled - not compatible with piped input
    this.claudeAvailable = false;

    for (const step of this.steps) {
      console.log(chalk.cyan(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`));
      console.log(chalk.cyan(`📋 ${step.title}`));
      console.log(chalk.gray(`   ${step.description}`));
      console.log(chalk.cyan(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`));
      
      // Check if step is already completed
      const isValid = await step.validator();
      if (isValid) {
        console.log(chalk.green(`✓ ${step.title} is already configured`));
        continue;
      }

      // Attempt automatic fix first if available
      if (step.autoFix && !options.skipAutoFix) {
        console.log(chalk.yellow(`自動セットアップを試みています...`));
        const autoFixed = await step.autoFix();
        if (autoFixed) {
          const isValidAfterAutoFix = await step.validator();
          if (isValidAfterAutoFix) {
            console.log(chalk.green(`✓ ${step.title} 自動設定が完了しました`));
            continue;
          }
        }
      }

      // If autoFix failed, fall back to manual instructions or wizard

      // Fall back to manual instructions
      console.log(chalk.yellow(`\nPlease complete the following steps manually:\n`));
      
      // Special handling for PoppoBuilder config - use inquirer wizard
      if (step.name === 'poppo-config') {
        console.log(chalk.cyan('Starting interactive configuration wizard...\n'));
        const InitWizard = require('../../deprecated/init-wizard');
        const initWizard = new InitWizard();
        const configSuccess = await initWizard.run();
        
        if (configSuccess) {
          console.log(chalk.green(`✓ ${step.title} completed successfully`));
          continue;
        } else {
          console.log(chalk.red(`✗ ${step.title} failed`));
          return false;
        }
      }
      
      await this.showManualInstructions(step);
      
      // Wait for user to complete manual steps
      const completed = await this.waitForManualCompletion();
      if (!completed) {
        console.log(chalk.red('\nSetup cancelled by user'));
        return false;
      }

      // Final validation
      const isValidFinal = await step.validator();
      if (!isValidFinal) {
        console.log(chalk.red(`✗ ${step.title} validation failed`));
        console.log(chalk.yellow('Please ensure all steps were completed correctly.'));
        
        const retry = await this.askRetry();
        if (!retry) {
          console.log(chalk.red('Setup cancelled'));
          return false;
        }
        // Retry this step
        await this.runSetup({ ...options, retryStep: step.name });
        return true;
      }
      
      console.log(chalk.green(`✓ ${step.title} completed successfully`));
    }

    console.log(chalk.green('\n✨ Setup completed successfully!\n'));
    console.log(chalk.gray('PoppoBuilder is now ready to use. You can now run:'));
    console.log(chalk.cyan('  poppo-builder'));
    console.log(chalk.gray('\nto start PoppoBuilder.\n'));
    return true;
  }

  async checkClaudeAvailability() {
    try {
      execSync('claude --version', { stdio: 'ignore' });
      this.claudeAvailable = true;
      console.log(chalk.green('✓ Claude CLI detected (interactive mode disabled)'));
    } catch {
      this.claudeAvailable = false;
      console.log(chalk.yellow('⚠ Claude CLI not found. Will use manual setup instructions.'));
    }
  }

  async showManualInstructions(step) {
    const instructions = {
      'dependencies': [
        '1. Node.js (v14.0.0 or higher):',
        chalk.gray('   Official download: ') + chalk.cyan('https://nodejs.org/'),
        chalk.gray('   macOS:   ') + chalk.cyan('brew install node'),
        chalk.gray('   Ubuntu:  ') + chalk.cyan('curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs'),
        chalk.gray('   Windows: ') + chalk.cyan('Download from nodejs.org or use: winget install OpenJS.NodeJS'),
        '',
        '2. npm (comes with Node.js) or Yarn:',
        chalk.gray('   Yarn installation: ') + chalk.cyan('npm install -g yarn'),
        chalk.gray('   Alternative: ') + chalk.cyan('curl -o- -L https://yarnpkg.com/install.sh | bash'),
        '',
        '3. Claude CLI:',
        chalk.gray('   macOS/Linux: ') + chalk.cyan('curl -fsSL https://console.anthropic.com/install.sh | sh'),
        chalk.gray('   Windows: ') + chalk.cyan('Download from https://console.anthropic.com/download'),
        chalk.gray('   After installation, authenticate with: ') + chalk.cyan('claude login'),
        '',
        '4. Git (v2.0.0 or higher):',
        chalk.gray('   macOS:   ') + chalk.cyan('brew install git'),
        chalk.gray('   Ubuntu:  ') + chalk.cyan('sudo apt-get install git'),
        chalk.gray('   Windows: ') + chalk.cyan('winget install --id Git.Git'),
        '',
        '5. Verify all dependencies:',
        chalk.cyan('   node --version'),
        chalk.cyan('   npm --version'),
        chalk.cyan('   claude --version'),
        chalk.cyan('   git --version')
      ],
      'git-check': [
        '1. Check if this is a Git repository:',
        chalk.cyan('   git status'),
        '',
        '2. If not a Git repository, initialize it:',
        chalk.cyan('   git init'),
        '',
        '3. Add a GitHub remote (if not already configured):',
        chalk.cyan('   git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git'),
        '',
        '4. Verify the remote is set:',
        chalk.cyan('   git remote -v')
      ],
      'gh-setup': [
        '1. Install GitHub CLI if not already installed:',
        chalk.gray('   macOS:   ') + chalk.cyan('brew install gh'),
        chalk.gray('   Ubuntu:  ') + chalk.cyan('sudo apt install gh'),
        chalk.gray('   Windows: ') + chalk.cyan('winget install --id GitHub.cli'),
        '',
        '2. Authenticate with GitHub:',
        chalk.cyan('   gh auth login'),
        chalk.gray('   Follow the interactive prompts to complete authentication'),
        '',
        '3. Verify authentication:',
        chalk.cyan('   gh auth status')
      ],
      'branch-setup': [
        '1. Create the work branch for PoppoBuilder:',
        chalk.cyan('   git checkout -b work/poppo-builder'),
        '',
        '2. Push the branch to remote:',
        chalk.cyan('   git push -u origin work/poppo-builder'),
        '',
        '3. Verify the branch is tracking remote:',
        chalk.cyan('   git branch -vv')
      ]
    };

    const stepInstructions = instructions[step.name] || [];
    stepInstructions.forEach(line => console.log(line));
  }

  async waitForManualCompletion() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(chalk.yellow('\nPress Enter when you have completed the steps (or type "skip" to cancel): '), (answer) => {
        rl.close();
        resolve(answer.toLowerCase() !== 'skip');
      });
    });
  }

  getGitCheckPrompt() {
    return `I need help setting up a Git repository for PoppoBuilder. Please guide me through these steps:

1. First, check if the current directory (${process.cwd()}) is a Git repository by running "git status"

2. If it's not a Git repository:
   - Ask if I want to initialize a new repository here
   - If yes, run "git init"
   - If no, tell me I need to navigate to a Git repository first

3. Once we have a Git repository, check if there's a remote configured with "git remote -v"

4. If no remote is configured:
   - Ask for my GitHub username and repository name
   - Help me add the remote with: git remote add origin https://github.com/USERNAME/REPO.git

5. Verify everything is set up correctly

Please guide me step by step and wait for my responses at each step.`;
  }

  getGhSetupPrompt() {
    return `I need help setting up GitHub CLI (gh) for PoppoBuilder. Please guide me through:

1. First check if 'gh' is installed by running "gh --version"

2. If not installed, provide installation instructions for my operating system:
   - For macOS: brew install gh
   - For Ubuntu/Debian: sudo apt install gh  
   - For Windows: winget install --id GitHub.cli
   - For other systems, direct me to: https://github.com/cli/cli#installation

3. After installation, check authentication with "gh auth status"

4. If not authenticated, guide me through "gh auth login":
   - Help me choose the right options
   - Explain what each step does

5. Finally, verify we can access the repository with "gh repo view"

Please guide me step by step and explain what we're doing at each stage.`;
  }

  getBranchSetupPrompt() {
    return `I need to set up a dedicated work branch for PoppoBuilder. Please help me:

1. First, show me the current branch with "git branch --show-current"

2. Explain that PoppoBuilder needs a dedicated branch called "work/poppo-builder" to:
   - Keep automated changes separate from manual development
   - Allow easy review of PoppoBuilder's work
   - Prevent conflicts with main development

3. Help me create and switch to this branch:
   - If we have a main/master branch, base it on that
   - Otherwise, create it from the current branch

4. Push the branch to remote with tracking:
   - Run: git push -u origin work/poppo-builder
   - Explain what the -u flag does

5. Verify the branch is set up correctly with "git branch -vv"

Please guide me through each step and make sure I understand what we're doing.`;
  }

  async runClaudeGuide(prompt) {
    try {
      // Create a temporary file with the prompt
      const tmpFile = path.join(os.tmpdir(), `poppobuilder-setup-${Date.now()}.txt`);
      await fs.writeFile(tmpFile, prompt, 'utf8');

      return new Promise((resolve) => {
        // Use a more reliable approach - echo the prompt and pipe it to claude
        const claude = spawn('sh', ['-c', `cat "${tmpFile}" | claude`], {
          stdio: 'inherit',
          shell: false
        });

        claude.on('exit', async (code) => {
          // Clean up temp file
          try {
            await fs.unlink(tmpFile);
          } catch (err) {
            // Ignore cleanup errors
          }
          resolve(code === 0);
        });

        claude.on('error', (error) => {
          console.error(chalk.red('Failed to start Claude CLI:'), error.message);
          resolve(false);
        });
      });
    } catch (error) {
      console.error(chalk.red('Error preparing Claude guide:'), error.message);
      return false;
    }
  }

  async autoFixGitSetup() {
    try {
      // Check if .git exists
      const gitExists = await this.fileExists('.git');
      
      if (!gitExists) {
        console.log(chalk.yellow('Gitリポジトリを初期化しています...'));
        execSync('git init', { stdio: 'inherit' });
        console.log(chalk.green('✓ Gitリポジトリを初期化しました'));
      }

      // Check for remote
      try {
        const remotes = execSync('git remote', { encoding: 'utf8' }).trim();
        if (!remotes) {
          console.log(chalk.yellow('GitHubリモートが設定されていません'));
          console.log(chalk.gray('後でプロジェクト設定時に入力できます'));
          // リモートがなくても、Gitリポジトリとしては成功
          return true;
        }
        return true;
      } catch {
        // リモートチェックに失敗しても、Gitリポジトリとしては成功
        return true;
      }
    } catch (error) {
      console.log(chalk.red('自動修正に失敗しました:'), error.message);
      return false;
    }
  }

  async autoFixBranchSetup() {
    try {
      // Get current branch
      const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
      
      if (currentBranch === 'work/poppo-builder') {
        return true;
      }

      // Check if branch exists
      const branches = execSync('git branch -a', { encoding: 'utf8' });
      const branchExists = branches.includes('work/poppo-builder');

      if (branchExists) {
        console.log(chalk.yellow('Switching to work/poppo-builder branch...'));
        execSync('git checkout work/poppo-builder', { stdio: 'inherit' });
      } else {
        console.log(chalk.yellow('Creating work/poppo-builder branch...'));
        // Try to base it on main/master if they exist
        try {
          execSync('git checkout -b work/poppo-builder main', { stdio: 'inherit' });
        } catch {
          try {
            execSync('git checkout -b work/poppo-builder master', { stdio: 'inherit' });
          } catch {
            // Create from current branch
            execSync('git checkout -b work/poppo-builder', { stdio: 'inherit' });
          }
        }
        
        // Try to push (might fail if no remote)
        try {
          console.log(chalk.yellow('Pushing branch to remote...'));
          execSync('git push -u origin work/poppo-builder', { stdio: 'inherit' });
        } catch {
          console.log(chalk.yellow('Could not push branch. You may need to set up remote first.'));
        }
      }

      return true;
    } catch (error) {
      console.log(chalk.red('Auto-fix failed:'), error.message);
      return false;
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
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

  async autoFixGhSetup() {
    try {
      const { execSync } = require('child_process');
      
      // First check if gh is installed
      let ghInstalled = false;
      try {
        execSync('gh --version', { stdio: 'ignore' });
        ghInstalled = true;
      } catch {
        // gh not installed, try to install it
        console.log(chalk.yellow('GitHub CLIがインストールされていません。自動インストールを試みます...'));
        
        if (process.platform === 'darwin') {
          // macOS: Install via Homebrew
          try {
            console.log(chalk.gray('Homebrewを使用してインストール中...'));
            execSync('brew install gh', { stdio: 'inherit' });
            ghInstalled = true;
          } catch {
            console.log(chalk.red('Homebrewでのインストールに失敗しました。'));
            return false;
          }
        } else if (process.platform === 'linux') {
          // Linux: Try apt-get first
          try {
            console.log(chalk.gray('apt-getを使用してインストール中...'));
            execSync('sudo apt-get update && sudo apt-get install -y gh', { stdio: 'inherit' });
            ghInstalled = true;
          } catch {
            // Try snap
            try {
              console.log(chalk.gray('snapを使用してインストール中...'));
              execSync('sudo snap install gh', { stdio: 'inherit' });
              ghInstalled = true;
            } catch {
              console.log(chalk.red('自動インストールに失敗しました。'));
              return false;
            }
          }
        } else {
          console.log(chalk.yellow('このOSでは自動インストールはサポートされていません。'));
          return false;
        }
      }
      
      if (!ghInstalled) {
        return false;
      }
      
      // Check if already authenticated
      try {
        execSync('gh auth status', { stdio: 'ignore' });
        console.log(chalk.green('✓ GitHub CLI は既に認証済みです'));
        return true;
      } catch {
        // Not authenticated, use Claude to guide through setup
        console.log(chalk.yellow('GitHub CLI認証が必要です。'));
        
        // Check if SSH connection (remote/VPN)
        const isSSH = process.env.SSH_CONNECTION || process.env.SSH_CLIENT;
        
        console.log(chalk.cyan('GitHub CLIの認証を開始します...'));
        console.log();
        
        if (isSSH) {
          console.log(chalk.yellow('⚠️  SSH/VPN接続を検出しました'));
          console.log(chalk.gray('ブラウザが開かない場合は、表示されるURLを手動で開いてください'));
          console.log();
        }
        
        console.log(chalk.gray('以下の手順に従って認証を完了してください：'));
        console.log(chalk.gray('1. GitHub.com を選択'));
        console.log(chalk.gray('2. HTTPS を選択（推奨）'));
        console.log(chalk.gray('3. ブラウザで認証（Login with a web browser）を選択'));
        console.log(chalk.gray('4. ワンタイムコードをコピー'));
        console.log(chalk.gray('5. 表示されるURL（https://github.com/login/device）を手動で開く'));
        console.log(chalk.gray('6. コードを入力して認証'));
        console.log();
        
        try {
          // 環境変数でブラウザを無効化（デバイスフローを強制）
          const env = { ...process.env, BROWSER: 'echo' };
          
          // gh auth login を実行（ブラウザを開かない）
          execSync('gh auth login', { 
            stdio: 'inherit',
            env: isSSH ? env : process.env
          });
          
          // 認証確認
          try {
            execSync('gh auth status', { stdio: 'ignore' });
            console.log(chalk.green('✓ GitHub CLI認証が完了しました'));
            return true;
          } catch {
            console.log(chalk.red('認証が完了していません'));
            return false;
          }
        } catch {
          console.log(chalk.red('認証がキャンセルされました'));
          return false;
        }
      }
    } catch (error) {
      console.log(chalk.red('エラーが発生しました:'), error.message);
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

  async checkSystemDependencies() {
    const dependencies = [
      {
        name: 'Node.js',
        command: 'node --version',
        minVersion: '14.0.0',
        parseVersion: (output) => output.trim().replace('v', ''),
        installGuide: 'https://nodejs.org/'
      },
      {
        name: 'npm',
        command: 'npm --version',
        minVersion: '6.0.0',
        parseVersion: (output) => output.trim(),
        installGuide: 'Comes with Node.js'
      },
      {
        name: 'Git',
        command: 'git --version',
        minVersion: '2.0.0',
        parseVersion: (output) => {
          const match = output.match(/git version ([\d.]+)/);
          return match ? match[1] : '0.0.0';
        },
        installGuide: 'https://git-scm.com/downloads'
      }
    ];

    const results = [];
    let allPassed = true;

    console.log(chalk.cyan('\nChecking system dependencies...\n'));

    for (const dep of dependencies) {
      try {
        const output = execSync(dep.command, { encoding: 'utf8' });
        const version = dep.parseVersion(output);
        const isValid = this.compareVersions(version, dep.minVersion) >= 0;
        
        if (isValid) {
          console.log(chalk.green(`✓ ${dep.name}: ${version}`));
        } else {
          console.log(chalk.yellow(`⚠ ${dep.name}: ${version} (requires ${dep.minVersion} or higher)`));
          allPassed = false;
        }
        
        results.push({ ...dep, installed: true, version, isValid });
      } catch (error) {
        console.log(chalk.red(`✗ ${dep.name}: Not installed`));
        console.log(chalk.gray(`  Install from: ${dep.installGuide}`));
        allPassed = false;
        results.push({ ...dep, installed: false, version: null, isValid: false });
      }
    }

    // Check for yarn as optional
    try {
      const yarnVersion = execSync('yarn --version', { encoding: 'utf8' }).trim();
      console.log(chalk.green(`✓ Yarn (optional): ${yarnVersion}`));
    } catch {
      console.log(chalk.gray('ℹ Yarn (optional): Not installed'));
    }

    return { results, allPassed };
  }

  compareVersions(version1, version2) {
    const v1 = version1.split('.').map(Number);
    const v2 = version2.split('.').map(Number);
    
    for (let i = 0; i < Math.max(v1.length, v2.length); i++) {
      const num1 = v1[i] || 0;
      const num2 = v2[i] || 0;
      
      if (num1 > num2) return 1;
      if (num1 < num2) return -1;
    }
    
    return 0;
  }

  async validateDependencies() {
    const depCheck = await this.checkSystemDependencies();
    return depCheck.allPassed;
  }

  async autoFixDependencies() {
    // Dependencies usually require manual installation
    // We can only provide helpful commands
    console.log(chalk.yellow('\nDependencies require manual installation.'));
    console.log(chalk.gray('Please follow the installation guides shown above.'));
    return false;
  }

  getDependencyCheckPrompt() {
    return `I need help checking and installing dependencies for PoppoBuilder. Please help me:

1. First, let's check what's already installed by running:
   - node --version
   - npm --version
   - git --version
   - claude --version

2. For any missing or outdated dependencies:
   - Explain what each tool does and why it's needed
   - Provide the appropriate installation command for my operating system
   - Guide me through the installation process

3. After installation, verify everything is working:
   - Run version checks again
   - Ensure minimum version requirements are met:
     * Node.js: v14.0.0 or higher
     * npm: v6.0.0 or higher
     * Git: v2.0.0 or higher

4. If I'm having trouble with any installation:
   - Help me troubleshoot common issues
   - Suggest alternative installation methods
   - Explain any error messages I encounter

Please guide me step by step through this process.`;
  }

  getPoppoConfigPrompt() {
    return `I need to set up PoppoBuilder configuration for this project. Please help me:

1. First, let's get the repository information:
   - Run "gh repo view --json owner,name" to get current repository details
   - If that doesn't work, check the git remote with "git remote -v"

2. Ask me about my preferences:
   - What language should PoppoBuilder use? (Japanese: ja, English: en)
   - Do I want to enable the dashboard feature? (default: yes)
   - If yes, what port should it use? (default: 3001)

3. Create the configuration directory and file:
   - Create .poppo directory: mkdir -p .poppo
   - Create the config.json file with the information we gathered

4. Show me the created configuration and ask for confirmation

5. If I need to make changes, help me edit the configuration

The configuration should look like:
{
  "github": {
    "owner": "repository-owner",
    "repo": "repository-name"
  },
  "language": {
    "primary": "ja or en"
  },
  "dashboard": {
    "enabled": true,
    "port": 3001
  }
}

Please guide me through creating this configuration step by step.`;
  }

  async validatePoppoConfig() {
    try {
      const configPath = path.join(process.cwd(), '.poppo', 'config.json');
      await fs.access(configPath);
      
      // Check if the config has required fields
      const config = JSON.parse(await fs.readFile(configPath, 'utf8'));
      
      return config.github && 
             config.github.owner && 
             config.github.repo &&
             config.language &&
             config.language.primary;
    } catch {
      return false;
    }
  }
}

module.exports = SetupWizard;