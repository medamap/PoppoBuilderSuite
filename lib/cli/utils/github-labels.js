/**
 * GitHub Label Creation Utility
 * Automatically creates required labels for PoppoBuilder
 */

const { execSync } = require('child_process');
const chalk = require('chalk');
const inquirer = require('inquirer');
const fs = require('fs').promises;
const path = require('path');

/**
 * Default labels for PoppoBuilder
 */
const DEFAULT_LABELS = [
  // Task types
  { name: 'task:feature', description: 'New feature implementation', color: '0e8a16' },
  { name: 'task:bug', description: 'Bug fix', color: 'd73a4a' },
  { name: 'task:refactor', description: 'Code refactoring', color: 'cfd3d7' },
  { name: 'task:test', description: 'Test addition or modification', color: 'fff200' },
  { name: 'task:docs', description: 'Documentation update', color: '0075ca' },
  { name: 'task:dogfooding', description: 'PoppoBuilder self-improvement', color: '7057ff' },
  
  // Priority levels
  { name: 'priority:high', description: 'High priority', color: 'b60205' },
  { name: 'priority:medium', description: 'Medium priority', color: 'fbca04' },
  { name: 'priority:low', description: 'Low priority', color: '0e8a16' },
  
  // Special labels
  { name: 'skip:poppobuilder', description: 'Skip PoppoBuilder processing', color: 'cccccc' }
];

/**
 * Check if gh command is available
 */
async function checkGitHubCLI() {
  try {
    execSync('gh --version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if gh is authenticated
 */
async function checkGitHubAuth() {
  try {
    execSync('gh auth status', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run GitHub CLI setup wizard
 */
async function runGitHubSetupWizard() {
  console.log(chalk.yellow('\n🧙 GitHub CLIのセットアップが必要です'));
  
  const { runSetup } = await inquirer.prompt([{
    type: 'confirm',
    name: 'runSetup',
    message: 'GitHubラベルを作成するにはGitHub CLIが必要です。セットアップしますか？',
    default: true
  }]);
  
  if (!runSetup) {
    console.log(chalk.gray('GitHubラベルの作成をスキップしました'));
    return false;
  }
  
  // Check if Claude CLI is available for wizard
  try {
    execSync('claude --version', { stdio: 'ignore' });
    
    // Create wizard prompt
    const wizardPrompt = `You are a GitHub CLI setup wizard. Your task is to guide the user through:

1. Installing the GitHub CLI (gh) if not already installed
2. Authenticating with GitHub using 'gh auth login'
3. Verifying the authentication was successful

Please be interactive and guide them step by step. When complete, ask them to type 'exit' to finish.

Environment: ${process.platform}
Language: Japanese`;

    // Save prompt to temp file
    const tempFile = path.join('/tmp', `gh-wizard-${Date.now()}.txt`);
    await fs.writeFile(tempFile, wizardPrompt);
    
    console.log(chalk.blue('\n🚀 Claude CLIウィザードを起動します...'));
    
    try {
      execSync(`claude < ${tempFile}`, { stdio: 'inherit' });
    } catch (error) {
      // Claude may exit with non-zero code
    }
    
    // Clean up
    await fs.unlink(tempFile).catch(() => {});
    
  } catch {
    // Claude CLI not available, show manual instructions
    console.log(chalk.yellow('\n📋 手動セットアップ手順:'));
    console.log();
    console.log(chalk.white('1. GitHub CLIのインストール:'));
    
    if (process.platform === 'darwin') {
      console.log(chalk.gray('   brew install gh'));
    } else if (process.platform === 'linux') {
      console.log(chalk.gray('   # Debian/Ubuntu:'));
      console.log(chalk.gray('   curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo gpg --dearmor -o /usr/share/keyrings/githubcli-archive-keyring.gpg'));
      console.log(chalk.gray('   echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null'));
      console.log(chalk.gray('   sudo apt update && sudo apt install gh'));
    } else {
      console.log(chalk.gray('   https://cli.github.com/ からダウンロード'));
    }
    
    console.log();
    console.log(chalk.white('2. 認証:'));
    console.log(chalk.gray('   gh auth login'));
    console.log();
    
    const { completed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'completed',
      message: 'セットアップが完了したら続行してください',
      default: true
    }]);
    
    if (!completed) {
      return false;
    }
  }
  
  // Verify setup
  const hasGH = await checkGitHubCLI();
  const hasAuth = hasGH && await checkGitHubAuth();
  
  if (!hasGH) {
    console.log(chalk.red('❌ GitHub CLIがインストールされていません'));
    return false;
  }
  
  if (!hasAuth) {
    console.log(chalk.red('❌ GitHub CLIが認証されていません'));
    console.log(chalk.yellow('💡 ヒント: gh auth login を実行してください'));
    return false;
  }
  
  console.log(chalk.green('✅ GitHub CLIのセットアップが完了しました！'));
  return true;
}

/**
 * Create a single label
 */
async function createLabel(owner, repo, label) {
  try {
    execSync(
      `gh label create "${label.name}" -d "${label.description}" -c "${label.color}" -R "${owner}/${repo}"`,
      { stdio: 'ignore' }
    );
    return { success: true };
  } catch (error) {
    // Label might already exist
    return { success: false, exists: true };
  }
}

/**
 * Create GitHub labels for a project
 */
async function createGitHubLabels(owner, repo, language = 'ja') {
  try {
    console.log(chalk.blue('\n🏷️  GitHubラベルをチェック中...'));
    
    // Check if gh is available and authenticated
    const hasGH = await checkGitHubCLI();
    if (!hasGH) {
      const setupSuccess = await runGitHubSetupWizard();
      if (!setupSuccess) {
        return;
      }
    } else {
      const hasAuth = await checkGitHubAuth();
      if (!hasAuth) {
        const setupSuccess = await runGitHubSetupWizard();
        if (!setupSuccess) {
          return;
        }
      }
    }
    
    // Check existing labels
    let existingLabels = [];
    try {
      const output = execSync(`gh label list -R "${owner}/${repo}" --json name`, { encoding: 'utf8' });
      existingLabels = JSON.parse(output).map(l => l.name);
    } catch (error) {
      console.log(chalk.yellow('⚠️  ラベルの取得に失敗しました'));
      const { skipLabels } = await inquirer.prompt([{
        type: 'confirm',
        name: 'skipLabels',
        message: 'GitHubラベルの作成をスキップしますか？',
        default: false
      }]);
      
      if (skipLabels) {
        return;
      }
    }
    
    // Find missing labels
    const missingLabels = DEFAULT_LABELS.filter(label => 
      !existingLabels.includes(label.name)
    );
    
    if (missingLabels.length === 0) {
      console.log(chalk.green('✅ 必要なラベルは既に作成されています'));
      return;
    }
    
    console.log(chalk.yellow(`📝 ${missingLabels.length}個のラベルを作成します...`));
    
    // Create missing labels
    let created = 0;
    let failed = 0;
    
    for (const label of missingLabels) {
      process.stdout.write(chalk.gray(`  ${label.name}... `));
      const result = await createLabel(owner, repo, label);
      
      if (result.success) {
        process.stdout.write(chalk.green('✓\n'));
        created++;
      } else if (result.exists) {
        process.stdout.write(chalk.gray('既存\n'));
      } else {
        process.stdout.write(chalk.red('✗\n'));
        failed++;
      }
    }
    
    if (created > 0) {
      console.log(chalk.green(`\n✅ ${created}個のラベルを作成しました`));
    }
    
    if (failed > 0) {
      console.log(chalk.yellow(`⚠️  ${failed}個のラベルの作成に失敗しました`));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ ラベル作成中にエラーが発生しました:'), error.message);
  }
}

module.exports = {
  createGitHubLabels,
  checkGitHubCLI,
  checkGitHubAuth,
  runGitHubSetupWizard
};