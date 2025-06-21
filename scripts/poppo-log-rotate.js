#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const Logger = require('../src/logger');
const chalk = require('chalk');

// 設定を読み込み
const configPath = path.join(__dirname, '../config/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// コマンドライン引数を解析
const args = process.argv.slice(2);
const command = args[0] || 'help';

// ヘルプを表示
function showHelp() {
  console.log(`
${chalk.cyan('PoppoBuilder ログローテーション管理ツール')}

使用方法:
  ${chalk.yellow('poppo-log-rotate [command] [options]')}

コマンド:
  ${chalk.green('rotate')}       手動でログローテーションを実行
  ${chalk.green('stats')}        アーカイブの統計情報を表示
  ${chalk.green('clean')}        古いアーカイブを削除
  ${chalk.green('help')}         このヘルプを表示

例:
  ${chalk.gray('# ログをローテーション')}
  poppo-log-rotate rotate
  
  ${chalk.gray('# アーカイブ統計を表示')}
  poppo-log-rotate stats
  
  ${chalk.gray('# 30日以上前のアーカイブを削除')}
  poppo-log-rotate clean
`);
}

// 統計情報を見やすく表示
function formatStats(stats) {
  if (!stats) {
    console.log(chalk.red('統計情報を取得できませんでした'));
    return;
  }
  
  console.log('\n' + chalk.cyan('=== ログアーカイブ統計 ==='));
  console.log(chalk.white('総ファイル数:'), chalk.yellow(stats.totalFiles));
  console.log(chalk.white('圧縮ファイル数:'), chalk.yellow(stats.compressedFiles));
  console.log(chalk.white('総サイズ:'), chalk.yellow(`${stats.totalSizeMB} MB`));
  
  if (stats.averageCompressionRatio > 0) {
    console.log(chalk.white('平均圧縮率:'), chalk.green(`${stats.averageCompressionRatio}%`));
  }
  
  if (stats.oldestFile) {
    console.log(chalk.white('最古のファイル:'), chalk.gray(stats.oldestFile));
  }
  
  if (stats.newestFile) {
    console.log(chalk.white('最新のファイル:'), chalk.gray(stats.newestFile));
  }
  console.log('');
}

// メイン処理
async function main() {
  const logger = new Logger(
    path.join(__dirname, '../logs'),
    config.logRotation || {}
  );
  
  try {
    switch (command) {
      case 'rotate':
        console.log(chalk.cyan('ログローテーションを開始します...'));
        await logger.rotate();
        console.log(chalk.green('✓ ログローテーションが完了しました'));
        
        // 統計情報も表示
        const statsAfterRotate = await logger.getArchiveStats();
        formatStats(statsAfterRotate);
        break;
        
      case 'stats':
        const stats = await logger.getArchiveStats();
        formatStats(stats);
        break;
        
      case 'clean':
        console.log(chalk.cyan('古いアーカイブのクリーンアップを開始します...'));
        
        // LogRotatorに直接アクセスしてクリーンアップ
        if (logger.rotator) {
          await logger.rotator.cleanupOldArchives();
          console.log(chalk.green('✓ クリーンアップが完了しました'));
          
          // 統計情報を表示
          const statsAfterClean = await logger.getArchiveStats();
          formatStats(statsAfterClean);
        } else {
          console.log(chalk.red('ログローテーターが初期化されていません'));
        }
        break;
        
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error(chalk.red('エラーが発生しました:'), error.message);
    process.exit(1);
  } finally {
    // ログローテーターを停止
    logger.close();
  }
}

// 実行
main().catch(error => {
  console.error(chalk.red('予期しないエラー:'), error);
  process.exit(1);
});