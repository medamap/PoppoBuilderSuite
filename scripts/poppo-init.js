#!/usr/bin/env node

const chalk = require('chalk');

async function main() {
  console.clear();
  console.log(chalk.cyan('╔════════════════════════════════════════╗'));
  console.log(chalk.cyan('║  PoppoBuilder Suite 初期設定           ║'));
  console.log(chalk.cyan('╚════════════════════════════════════════╝'));
  console.log();

  // Claude CLIが利用可能かチェック
  let claudeAvailable = false;
  try {
    require('child_process').execSync('claude --version', { stdio: 'ignore' });
    claudeAvailable = true;
    console.log(chalk.green('✨ Claude CLIが検出されました！'));
  } catch {
    console.log(chalk.yellow('ℹ️  Claude CLIは検出されませんでした'));
  }

  if (claudeAvailable) {
    // Claude CLIを使ったセットアップウィザード
    console.log(chalk.cyan('\n🤖 Claude CLIによる対話型セットアップを開始します'));
    console.log(chalk.gray('Claude があなたの設定を手助けします\n'));
    
    const SetupWizard = require('../lib/commands/setup-wizard');
    const wizard = new SetupWizard();
    const success = await wizard.runSetup();
    
    if (success) {
      console.log(chalk.green('\n✅ セットアップが完了しました！'));
      console.log(chalk.yellow('\n次のステップ:'));
      console.log('1. プロジェクトディレクトリで実行: poppo-builder'));
    } else {
      console.log(chalk.red('\nセットアップがキャンセルされました'));
    }
  } else {
    // inquirerを使ったTUIセットアップ
    console.log(chalk.cyan('\n🔧 対話型設定ツールを起動します'));
    console.log(chalk.gray('いくつかの質問に答えて設定を完了してください\n'));
    
    const InitWizard = require('../src/init-wizard');
    const wizard = new InitWizard();
    const success = await wizard.run();
    
    if (!success) {
      console.log(chalk.red('\nセットアップがキャンセルされました'));
    }
  }
}

// エラーハンドリング
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('\n❌ エラーが発生しました:'), error.message);
  process.exit(1);
});

// メイン実行
main().catch((error) => {
  console.error(chalk.red('\n❌ エラーが発生しました:'), error.message);
  process.exit(1);
});