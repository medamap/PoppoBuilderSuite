#!/usr/bin/env node

const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const chalk = require('chalk');

/**
 * PoppoBuilder初期設定ウィザード
 */
class InitWizard {
  constructor() {
    this.configDir = path.join(process.cwd(), '.poppo');
    this.configPath = path.join(this.configDir, 'config.json');
  }

  async run() {
    // Ctrl+Cのハンドリング
    process.on('SIGINT', () => {
      console.log(chalk.red('\n\n❌ セットアップがキャンセルされました'));
      process.exit(0);
    });
    
    console.clear();
    console.log(chalk.cyan('╔════════════════════════════════════════╗'));
    console.log(chalk.cyan('║  PoppoBuilder Suite 初期設定ウィザード  ║'));
    console.log(chalk.cyan('╚════════════════════════════════════════╝'));
    console.log();
    
    // 設定の説明
    console.log(chalk.yellow('📝 PoppoBuilderの設定を行います'));
    console.log(chalk.gray('PoppoBuilderは、GitHubのIssueを自動的に処理するAIアシスタントです。'));
    console.log(chalk.gray('以下の情報を設定してください：\n'));
    console.log(chalk.gray('• GitHubリポジトリ情報（どのリポジトリのIssueを処理するか）'));
    console.log(chalk.gray('• 表示言語（日本語 or 英語）'));
    console.log(chalk.gray('• ダッシュボード設定（オプション）\n'));

    // 既存の設定をチェック
    if (fs.existsSync(this.configPath)) {
      const { overwrite } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'overwrite',
          message: '既存の設定ファイルが見つかりました。上書きしますか？',
          default: false
        }
      ]);

      if (!overwrite) {
        console.log(chalk.yellow('\n設定ウィザードをキャンセルしました。'));
        return false;
      }
    }

    try {
      // 基本設定の質問
      const answers = await this.askQuestions();
      
      // 設定ファイルの作成
      await this.createConfig(answers);
      
      // 成功メッセージ
      this.showSuccess();
      
      return true;
    } catch (error) {
      console.error(chalk.red('\nエラーが発生しました:'), error.message);
      return false;
    }
  }

  async askQuestions() {
    const questions = [
      {
        type: 'input',
        name: 'githubOwner',
        message: 'GitHubのユーザー名またはOrganization名を入力してください:',
        default: () => {
          // Gitリモートから推測を試みる
          try {
            const remoteUrl = require('child_process')
              .execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' })
              .trim();
            const match = remoteUrl.match(/github\.com[:/]([^/]+)\//);
            return match ? match[1] : '';
          } catch {
            return '';
          }
        },
        validate: (input) => {
          if (!input.trim()) {
            return 'GitHub ownerは必須です';
          }
          if (!/^[a-zA-Z0-9]([a-zA-Z0-9-])*$/.test(input)) {
            return '有効なGitHubユーザー名を入力してください';
          }
          return true;
        }
      },
      {
        type: 'input',
        name: 'githubRepo',
        message: 'GitHubリポジトリ名を入力してください（このプロジェクトのリポジトリ名）:',
        default: () => {
          // 現在のディレクトリ名またはGitリモートから推測
          try {
            const remoteUrl = require('child_process')
              .execSync('git remote get-url origin 2>/dev/null', { encoding: 'utf8' })
              .trim();
            const match = remoteUrl.match(/\/([^/]+?)(\.git)?$/);
            if (match) return match[1];
          } catch {}
          
          // フォルダ名から推測
          return path.basename(process.cwd());
        },
        validate: (input) => {
          if (!input.trim()) {
            return 'リポジトリ名は必須です';
          }
          if (!/^[a-zA-Z0-9._-]+$/.test(input)) {
            return '有効なリポジトリ名を入力してください';
          }
          return true;
        }
      },
      {
        type: 'list',
        name: 'language',
        message: 'PoppoBuilderの表示言語を選択してください:',
        choices: [
          { name: '日本語 (Japanese)', value: 'ja' },
          { name: 'English', value: 'en' }
        ],
        default: 'ja'
      },
      {
        type: 'confirm',
        name: 'enableDashboard',
        message: 'ダッシュボード機能を有効にしますか？',
        default: true
      }
    ];

    // ダッシュボードが有効な場合の追加質問
    const answers = await inquirer.prompt(questions);

    if (answers.enableDashboard) {
      const dashboardQuestions = [
        {
          type: 'input',
          name: 'dashboardPort',
          message: 'ダッシュボードのポート番号を入力してください:',
          default: '3001',
          validate: (input) => {
            const port = parseInt(input);
            if (isNaN(port) || port < 1 || port > 65535) {
              return '有効なポート番号を入力してください (1-65535)';
            }
            return true;
          }
        },
        {
          type: 'confirm',
          name: 'dashboardAuth',
          message: 'ダッシュボードに認証を設定しますか？',
          default: true
        }
      ];

      const dashboardAnswers = await inquirer.prompt(dashboardQuestions);
      Object.assign(answers, dashboardAnswers);

      if (dashboardAnswers.dashboardAuth) {
        const authQuestions = [
          {
            type: 'input',
            name: 'dashboardUsername',
            message: 'ダッシュボードのユーザー名を入力してください:',
            default: 'admin',
            validate: (input) => input.trim() ? true : 'ユーザー名は必須です'
          },
          {
            type: 'password',
            name: 'dashboardPassword',
            message: 'ダッシュボードのパスワードを入力してください:',
            mask: '*',
            validate: (input) => {
              if (!input.trim()) {
                return 'パスワードは必須です';
              }
              if (input.length < 8) {
                return 'パスワードは8文字以上にしてください';
              }
              return true;
            }
          }
        ];

        const authAnswers = await inquirer.prompt(authQuestions);
        Object.assign(answers, authAnswers);
      }
    }

    // 詳細設定
    const { advancedSetup } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'advancedSetup',
        message: '詳細設定を行いますか？',
        default: false
      }
    ]);

    if (advancedSetup) {
      const advancedQuestions = [
        {
          type: 'input',
          name: 'maxConcurrent',
          message: '同時実行可能なタスク数を入力してください:',
          default: '2',
          validate: (input) => {
            const num = parseInt(input);
            if (isNaN(num) || num < 1 || num > 10) {
              return '1-10の範囲で入力してください';
            }
            return true;
          }
        },
        {
          type: 'input',
          name: 'pollingInterval',
          message: 'GitHubポーリング間隔（秒）を入力してください:',
          default: '300',
          validate: (input) => {
            const num = parseInt(input);
            if (isNaN(num) || num < 60) {
              return '60秒以上を指定してください（GitHub APIレート制限のため）';
            }
            return true;
          }
        }
      ];

      const advancedAnswers = await inquirer.prompt(advancedQuestions);
      Object.assign(answers, advancedAnswers);
    }

    return answers;
  }

  async createConfig(answers) {
    // 設定オブジェクトの構築
    const config = {
      github: {
        owner: answers.githubOwner,
        repo: answers.githubRepo,
        pollingInterval: (parseInt(answers.pollingInterval) || 300) * 1000
      },
      language: {
        primary: answers.language,
        fallback: 'en'
      },
      claude: {
        maxConcurrent: parseInt(answers.maxConcurrent) || 2
      }
    };

    // ダッシュボード設定
    if (answers.enableDashboard) {
      config.dashboard = {
        enabled: true,
        port: parseInt(answers.dashboardPort) || 3001
      };

      if (answers.dashboardAuth) {
        config.dashboard.authentication = {
          enabled: true,
          username: answers.dashboardUsername,
          password: answers.dashboardPassword
        };
      }
    }

    // ディレクトリの作成
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }

    // 設定ファイルの書き込み
    fs.writeFileSync(
      this.configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    // .gitignore に .poppo を追加
    await this.updateGitignore();
  }

  async updateGitignore() {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    
    if (fs.existsSync(gitignorePath)) {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      if (!content.includes('.poppo/')) {
        fs.appendFileSync(gitignorePath, '\n# PoppoBuilder configuration\n.poppo/\n');
      }
    } else {
      fs.writeFileSync(gitignorePath, '# PoppoBuilder configuration\n.poppo/\n');
    }
  }

  showSuccess() {
    console.log();
    console.log(chalk.green('✓ 設定ファイルが正常に作成されました！'));
    console.log();
    console.log(chalk.cyan('設定ファイルの場所:'), this.configPath);
    console.log();
    console.log(chalk.yellow('次のステップ:'));
    console.log('1. 環境変数 GITHUB_TOKEN を設定してください:');
    console.log(chalk.gray('   export GITHUB_TOKEN=your_github_personal_access_token'));
    console.log();
    console.log('2. PoppoBuilderを起動してください:');
    console.log(chalk.gray('   poppo-builder'));
    console.log();
    console.log(chalk.blue('詳細なドキュメント:'));
    console.log('https://github.com/medamap/PoppoBuilderSuite');
  }
}

// メイン実行
if (require.main === module) {
  const wizard = new InitWizard();
  wizard.run().then((success) => {
    process.exit(success ? 0 : 1);
  });
}

module.exports = InitWizard;