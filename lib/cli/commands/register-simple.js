/**
 * Simplified Project Registration
 * Maximum 2 questions for better UX
 */

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');
const inquirer = require('inquirer');
const { execSync } = require('child_process');
const { getInstance: getProjectRegistry } = require('../../core/project-registry');
const { getInstance: getGlobalConfig } = require('../../core/global-config-manager');
const { validateDirectory, validateGitHubInfo } = require('../utils/validation');
const { createGitHubLabels } = require('../utils/github-labels');

/**
 * Auto-detect GitHub repository information
 */
async function detectGitHubInfo(projectPath) {
  try {
    // Check if it's a git repository
    await fs.access(path.join(projectPath, '.git'));
    
    // Get remote origin URL
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: projectPath,
      encoding: 'utf8'
    }).trim();
    
    // Parse GitHub info from URL - support various formats
    const patterns = [
      /github\.com[:/]([^/]+)\/([^.]+?)(\.git)?$/,  // Standard GitHub
      /git@github\.com:([^/]+)\/([^.]+?)(\.git)?$/,  // SSH format
      /https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/)?$/, // HTTPS with optional .git
    ];
    
    for (const pattern of patterns) {
      const match = remoteUrl.match(pattern);
      if (match) {
        return {
          owner: match[1],
          repo: match[2].replace(/\.git$/, ''), // Remove trailing .git if exists
          detected: true,
          url: remoteUrl
        };
      }
    }
  } catch (error) {
    // Not a git repo or no remote
    if (error.message && !error.message.includes('not a git repository')) {
      // Log unexpected errors for debugging
      console.error(chalk.gray(`Git detection error: ${error.message}`));
    }
  }
  
  return { detected: false };
}

/**
 * Get project name from package.json or directory name
 */
async function detectProjectName(projectPath) {
  try {
    // Try package.json first
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8'));
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch {
    // No package.json or no name field
  }
  
  // Use directory name as fallback
  return path.basename(projectPath);
}

/**
 * Simplified project registration
 */
async function handleSimpleRegister(projectPath, options) {
  try {
    console.log('Debug START - options.yes:', options.yes, typeof options.yes);
    
    // Skip banner if non-interactive mode
    if (!options.yes) {
      console.clear();
      console.log(chalk.cyan('╔════════════════════════════════════════╗'));
      console.log(chalk.cyan('║     PoppoBuilder プロジェクト登録      ║'));
      console.log(chalk.cyan('╚════════════════════════════════════════╝'));
      console.log();
    }
    

    const registry = getProjectRegistry();
    await registry.initialize();
    
    // Determine project path
    const targetPath = projectPath ? path.resolve(projectPath) : process.cwd();
    console.log(chalk.gray(`📁 プロジェクト: ${targetPath}\n`));
    
    // Validate project directory
    const dirValidation = await validateDirectory(targetPath, true);
    if (!dirValidation.valid) {
      console.error(chalk.red('❌ プロジェクトディレクトリの検証に失敗しました:'));
      dirValidation.errors.forEach(error => {
        console.error(chalk.red(`  • ${error.message}`));
        if (error.hint) {
          console.error(chalk.yellow(`    💡 ${error.hint}`));
        }
      });
      process.exit(1);
    }
    
    // Check if already registered
    const allProjects = registry.getAllProjects();
    console.log('Debug - options.yes:', options.yes, typeof options.yes);
    console.log('Debug - options.force:', options.force);
    console.log('Debug - full options:', JSON.stringify(options));
    const existingProject = Object.entries(allProjects).find(([id, project]) => project.path === targetPath);
    
    if (existingProject && !options.force) {
      const [projectId, project] = existingProject;
      
      // Skip confirmation if -y flag is provided
      console.log('Debug - Inside existingProject block, options.yes:', options.yes);
      if (!options.yes) {
        console.log(chalk.yellow('⚠️  このプロジェクトは既に登録されています。'));
        console.log(chalk.gray(`ID: ${projectId}`));
        console.log(chalk.gray(`名前: ${project.config?.name || 'N/A'}\n`));
        
        const { reregister } = await inquirer.prompt([{
          type: 'confirm',
          name: 'reregister',
          message: '設定を更新しますか？',
          default: false
        }]);
        
        if (!reregister) {
          console.log(chalk.yellow('\n登録をキャンセルしました。'));
          process.exit(0);
        }
      } else {
        console.log(chalk.yellow('⚠️  既存のプロジェクトを更新します。'));
        console.log(chalk.gray(`ID: ${projectId}`));
        // Continue with update - no prompt needed
      }
    }
    
    // Auto-detect project information with progress indicators
    console.log(chalk.blue('🔍 プロジェクト情報を検出中...'));
    
    // Detect project name
    process.stdout.write(chalk.gray('  📦 プロジェクト名を検出... '));
    const projectName = options.name || await detectProjectName(targetPath);
    console.log(chalk.green(`✓ ${projectName}`));
    
    // Detect GitHub info
    process.stdout.write(chalk.gray('  🔗 GitHubリポジトリを検出... '));
    let githubInfo;
    if (options.owner && options.repo) {
      // Use CLI options
      githubInfo = {
        owner: options.owner,
        repo: options.repo,
        detected: true
      };
      console.log(chalk.green(`✓ ${githubInfo.owner}/${githubInfo.repo} (CLI指定)`));
    } else {
      githubInfo = await detectGitHubInfo(targetPath);
      if (githubInfo.detected) {
        console.log(chalk.green(`✓ ${githubInfo.owner}/${githubInfo.repo}`));
      } else {
        console.log(chalk.yellow('✗ 未検出'));
      }
    }
    
    // Get global config for defaults
    process.stdout.write(chalk.gray('  ⚙️  グローバル設定を読み込み... '));
    const globalConfig = getGlobalConfig();
    await globalConfig.initialize();
    const defaultLanguage = globalConfig.get('defaults.language') || 'ja';
    const defaultPriority = globalConfig.get('defaults.priority') || 50;
    const defaultPollingInterval = globalConfig.get('defaults.pollingInterval') || 300000;
    console.log(chalk.green('✓'));
    
    // Stop watching to prevent hanging
    globalConfig.stopWatching();
    
    console.log(); // Empty line for clarity
    
    // Skip all questions if -y flag is provided
    if (options.yes) {
      // Check if we have required GitHub info
      if (!githubInfo.detected && (!options.owner || !options.repo)) {
        console.error(chalk.red('\n❌ GitHubリポジトリ情報が必要です'));
        console.error(chalk.yellow('💡 ヒント: -o と -r オプションで指定してください'));
        console.error(chalk.gray('   例: poppo-builder register -y -o medamap -r PoppoBuilderSuite'));
        process.exit(1);
      }
      
      // Use all detected/provided values
      const answers = {
        confirmGitHub: true,
        language: options.language || defaultLanguage
      };
      
      // Build project configuration directly
      const projectConfig = {
        name: projectName,
        github: {
          owner: githubInfo.owner,
          repo: githubInfo.repo
        },
        priority: parseInt(options.priority) || defaultPriority,
        tags: ['poppobuilder'],
        weight: parseFloat(options.weight) || 1.0
      };
      
      await finalizeRegistration(targetPath, projectConfig, answers.language, registry, existingProject, options);
      return; // finalizeRegistration内でprocess.exit()が呼ばれる
    }
    
    // Prepare questions for interactive mode
    const questions = [];
    
    // GitHub repository confirmation
    if (githubInfo.detected) {
      questions.push({
        type: 'confirm',
        name: 'confirmGitHub',
        message: `GitHubリポジトリ: ${chalk.cyan(`${githubInfo.owner}/${githubInfo.repo}`)} で正しいですか？`,
        default: true
      });
    } else {
      console.log(chalk.yellow('⚠️  GitHubリポジトリが検出されませんでした。'));
      questions.push({
        type: 'input',
        name: 'githubOwner',
        message: 'GitHubユーザー名/Organization名:',
        validate: (input) => {
          if (!input.trim()) return '入力してください';
          const validation = validateGitHubInfo(input.trim(), 'dummy');
          const ownerErrors = validation.errors.filter(e => e.type.includes('owner'));
          if (ownerErrors.length > 0) {
            return ownerErrors[0].hint ? 
              `${ownerErrors[0].message} (${ownerErrors[0].hint})` : 
              ownerErrors[0].message;
          }
          return true;
        }
      });
      questions.push({
        type: 'input',
        name: 'githubRepo',
        message: 'リポジトリ名:',
        validate: (input) => {
          if (!input.trim()) return '入力してください';
          const validation = validateGitHubInfo('dummy', input.trim());
          const repoErrors = validation.errors.filter(e => e.type.includes('repo'));
          if (repoErrors.length > 0) {
            return repoErrors[0].hint ? 
              `${repoErrors[0].message} (${repoErrors[0].hint})` : 
              repoErrors[0].message;
          }
          return true;
        }
      });
    }
    
    // Language preference (with inherited default)
    questions.push({
      type: 'list',
      name: 'language',
      message: '表示言語:',
      choices: [
        { name: '日本語', value: 'ja' },
        { name: 'English', value: 'en' }
      ],
      default: defaultLanguage
    });
    
    // Collect answers
    const answers = await inquirer.prompt(questions);
    
    // Build project configuration (schema-compliant)
    const projectConfig = {
      name: projectName,
      github: {
        owner: githubInfo.detected && answers.confirmGitHub !== false ? 
          githubInfo.owner : answers.githubOwner,
        repo: githubInfo.detected && answers.confirmGitHub !== false ? 
          githubInfo.repo : answers.githubRepo
      },
      priority: defaultPriority, // Use global default
      tags: ['poppobuilder'],
      weight: 1.0 // Default weight
    };
    
    // Additional data for project registry
    const projectLanguage = answers.language;
    const projectEnabled = true;
    
    // Create .poppo directory and config if needed
    const poppoDir = path.join(targetPath, '.poppo');
    const configPath = path.join(poppoDir, 'config.json');
    
    await fs.mkdir(poppoDir, { recursive: true });
    await fs.writeFile(configPath, JSON.stringify({
      version: '1.0.0',
      project: projectConfig.name,
      github: projectConfig.github,
      language: { primary: projectLanguage }
    }, null, 2));
    
    // Update .gitignore if needed
    try {
      const gitignorePath = path.join(targetPath, '.gitignore');
      let gitignoreContent = '';
      
      try {
        gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
      } catch {
        // .gitignore doesn't exist
      }
      
      const poppoIgnorePatterns = [
        '.poppo/state/',
        '.poppo/logs/',
        '.poppo/*.log',
        '.poppo/.cache/'
      ];
      
      const patternsToAdd = poppoIgnorePatterns.filter(pattern => 
        !gitignoreContent.includes(pattern)
      );
      
      if (patternsToAdd.length > 0) {
        if (gitignoreContent && !gitignoreContent.endsWith('\n')) {
          gitignoreContent += '\n';
        }
        
        gitignoreContent += '\n# PoppoBuilder\n';
        gitignoreContent += patternsToAdd.join('\n') + '\n';
        
        await fs.writeFile(gitignorePath, gitignoreContent);
        console.log(chalk.gray('  📝 .gitignore を更新しました'));
      }
    } catch {
      // Ignore .gitignore update errors
    }
    
    // Register with the global registry
    console.log(chalk.blue('\n📝 プロジェクトを登録中...'));
    
    const projectId = `${projectConfig.github.owner}-${projectConfig.github.repo}`.toLowerCase();
    
    // Force registration if option is set or user chose to re-register
    if (options.force || existingProject) {
      await registry.update(targetPath, projectConfig);
    } else {
      await registry.register(targetPath, projectConfig);
    }
    
    // Success message
    console.log(chalk.green('\n✅ プロジェクトの登録が完了しました！'));
    console.log();
    console.log(chalk.white('プロジェクト情報:'));
    console.log(chalk.gray(`  ID: ${projectId}`));
    console.log(chalk.gray(`  名前: ${projectConfig.name}`));
    console.log(chalk.gray(`  GitHub: ${projectConfig.github.owner}/${projectConfig.github.repo}`));
    console.log(chalk.gray(`  言語: ${projectLanguage === 'ja' ? '日本語' : 'English'}`));
    console.log();
    
    // GitHubラベルの作成
    await createGitHubLabels(projectConfig.github.owner, projectConfig.github.repo, projectLanguage);
    
    // Next steps
    console.log(chalk.yellow('次のステップ:'));
    console.log(chalk.white('1. デーモンを起動: ') + chalk.cyan('poppo-builder start'));
    console.log(chalk.white('2. 状態を確認: ') + chalk.cyan('poppo-builder status'));
    console.log();
    
    console.log(chalk.gray('プロジェクト設定の変更: poppo-builder project config ' + projectId));
    
    // Exit successfully
    process.exit(0);
    
  } catch (error) {
    console.error(chalk.red('\n❌ エラーが発生しました:'));
    console.error(chalk.red(error.message));
    
    // Provide helpful hints based on error type
    if (error.message.includes('already registered')) {
      console.error(chalk.yellow('\n💡 ヒント: 既存の登録を更新するには --force オプションを使用してください。'));
      console.error(chalk.gray('   例: poppo-builder register --force'));
    } else if (error.message.includes('git')) {
      console.error(chalk.yellow('\n💡 ヒント: GitHubリポジトリの検出に失敗しました。'));
      console.error(chalk.gray('   - プロジェクトがGitリポジトリであることを確認してください'));
      console.error(chalk.gray('   - git remote add origin <URL> でリモートを設定してください'));
    } else if (error.message.includes('permission') || error.message.includes('access')) {
      console.error(chalk.yellow('\n💡 ヒント: ファイルアクセス権限の問題です。'));
      console.error(chalk.gray('   - プロジェクトディレクトリへの書き込み権限を確認してください'));
    }
    
    process.exit(1);
  }
}

/**
 * Finalize project registration
 */
async function finalizeRegistration(targetPath, projectConfig, language, registry, existingProject, options) {
  // Additional data for project registry
  const projectLanguage = language;
  const projectEnabled = true;
  
  // Create .poppo directory and config if needed
  const poppoDir = path.join(targetPath, '.poppo');
  const configPath = path.join(poppoDir, 'config.json');
  
  await fs.mkdir(poppoDir, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({
    version: '1.0.0',
    project: projectConfig.name,
    github: projectConfig.github,
    language: { primary: projectLanguage }
  }, null, 2));
  
  // Update .gitignore if needed
  try {
    const gitignorePath = path.join(targetPath, '.gitignore');
    let gitignoreContent = '';
    
    try {
      gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
    } catch {
      // .gitignore doesn't exist
    }
    
    const poppoIgnorePatterns = [
      '.poppo/state/',
      '.poppo/logs/',
      '.poppo/*.log',
      '.poppo/.cache/'
    ];
    
    const patternsToAdd = poppoIgnorePatterns.filter(pattern => 
      !gitignoreContent.includes(pattern)
    );
    
    if (patternsToAdd.length > 0) {
      if (gitignoreContent && !gitignoreContent.endsWith('\n')) {
        gitignoreContent += '\n';
      }
      
      gitignoreContent += '\n# PoppoBuilder\n';
      gitignoreContent += patternsToAdd.join('\n') + '\n';
      
      await fs.writeFile(gitignorePath, gitignoreContent);
      console.log(chalk.gray('  📝 .gitignore を更新しました'));
    }
  } catch {
    // Ignore .gitignore update errors
  }
  
  // Register with the global registry
  console.log(chalk.blue('\n📝 プロジェクトを登録中...'));
  
  const projectId = `${projectConfig.github.owner}-${projectConfig.github.repo}`.toLowerCase();
  
  // Force registration if option is set or user chose to re-register
  if (options.force || existingProject) {
    await registry.update(targetPath, projectConfig);
  } else {
    await registry.register(targetPath, projectConfig);
  }
  
  // Success message
  console.log(chalk.green('\n✅ プロジェクトの登録が完了しました！'));
  console.log();
  console.log(chalk.white('プロジェクト情報:'));
  console.log(chalk.gray(`  ID: ${projectId}`));
  console.log(chalk.gray(`  名前: ${projectConfig.name}`));
  console.log(chalk.gray(`  GitHub: ${projectConfig.github.owner}/${projectConfig.github.repo}`));
  console.log(chalk.gray(`  言語: ${projectLanguage === 'ja' ? '日本語' : 'English'}`));
  console.log();
  
  // GitHubラベルの作成
  await createGitHubLabels(projectConfig.github.owner, projectConfig.github.repo, language);
  
  // Next steps
  console.log(chalk.yellow('次のステップ:'));
  console.log(chalk.white('1. デーモンを起動: ') + chalk.cyan('poppo-builder start'));
  console.log(chalk.white('2. 状態を確認: ') + chalk.cyan('poppo-builder status'));
  console.log();
  
  console.log(chalk.gray('プロジェクト設定の変更: poppo-builder project config ' + projectId));
  
  // Exit successfully
  process.exit(0);
}

module.exports = {
  handleSimpleRegister
};