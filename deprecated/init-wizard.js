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
      }
    ];

    const answers = await inquirer.prompt(questions);


    return answers;
  }

  async createConfig(answers) {
    // プロジェクト固有の設定のみを保存
    const config = {
      github: {
        owner: answers.githubOwner,
        repo: answers.githubRepo
      },
      language: {
        primary: answers.language,
        fallback: 'en'
      }
    };


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
    console.log(chalk.green('✓ プロジェクト設定ファイルが作成されました！'));
    console.log();
    console.log(chalk.cyan('設定ファイルの場所:'), this.configPath);
    console.log();
    console.log(chalk.yellow('次のステップ:'));
    console.log();
    console.log('1. グローバルPoppoBuilderにこのプロジェクトを登録:');
    console.log(chalk.gray('   poppo-builder register'));
    console.log();
    console.log('2. グローバル設定を確認・編集（必要に応じて）:');
    console.log(chalk.gray('   ~/.poppobuilder/config.json'));
    console.log();
    console.log('3. 環境変数 GITHUB_TOKEN を設定:');
    console.log(chalk.gray('   export GITHUB_TOKEN=your_github_personal_access_token'));
    console.log();
    console.log('4. PoppoBuilderを起動:');
    console.log(chalk.gray('   poppo-builder start  # すべてのプロジェクトを処理'));
    console.log(chalk.gray('   poppo-builder start --project MedamaCode  # 特定プロジェクトのみ'));
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