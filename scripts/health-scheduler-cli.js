#!/usr/bin/env node

/**
 * Health Scheduler CLI - Issue #128
 * システムヘルスチェックの自動化 - CLIコマンド
 */

const { Command } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const HealthScheduler = require('../lib/monitoring/health-scheduler');
const { MonitoringManager } = require('../lib/monitoring/monitoring-manager');
const path = require('path');
const fs = require('fs').promises;

const program = new Command();

// HealthSchedulerインスタンス
let healthScheduler = null;

/**
 * HealthSchedulerを初期化
 */
async function initializeHealthScheduler() {
  if (!healthScheduler) {
    healthScheduler = new HealthScheduler({
      reportsDir: './reports/health',
      retentionDays: 90
    });
    await healthScheduler.initialize();
  }
  return healthScheduler;
}

/**
 * 現在のヘルス状態をチェック
 */
async function checkHealth(options) {
  try {
    const scheduler = await initializeHealthScheduler();
    const level = options.level || 'daily';
    
    console.log(chalk.blue(`🔍 ${scheduler.diagnosticLevels[level].name}を実行中...`));
    
    const results = await scheduler.runDiagnostic(level);
    
    // 結果の表示
    displayHealthResults(results);
    
    // 詳細表示オプション
    if (options.detailed) {
      displayDetailedResults(results);
    }
    
    // JSON出力オプション
    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
    }
    
    process.exit(results.overallStatus === 'passed' ? 0 : 1);
    
  } catch (error) {
    console.error(chalk.red('❌ ヘルスチェックに失敗しました:'), error.message);
    process.exit(1);
  }
}

/**
 * ヘルスチェック結果を表示
 */
function displayHealthResults(results) {
  console.log('\n' + chalk.bold('📊 ヘルスチェック結果'));
  console.log(chalk.gray('━'.repeat(50)));
  
  // 全体ステータス
  const statusIcon = getStatusIcon(results.overallStatus);
  const statusColor = getStatusColor(results.overallStatus);
  console.log(`${statusIcon} 全体ステータス: ${statusColor(results.overallStatus.toUpperCase())}`);
  
  // サマリー
  console.log(`📈 実行時間: ${results.duration}ms`);
  console.log(`✅ 成功: ${results.summary.passed}`);
  console.log(`⚠️  警告: ${results.summary.warnings}`);
  console.log(`❌ 失敗: ${results.summary.failed}`);
  
  // チェック結果のテーブル
  const table = new Table({
    head: ['チェック項目', 'ステータス', 'メトリクス', 'メッセージ'],
    colWidths: [20, 12, 15, 40]
  });
  
  Object.entries(results.checks).forEach(([checkName, result]) => {
    table.push([
      checkName,
      `${getStatusIcon(result.status)} ${result.status}`,
      result.metric ? result.metric.toString() : '-',
      result.message || result.error || '-'
    ]);
  });
  
  console.log('\n' + table.toString());
  
  // 推奨事項
  if (results.recommendations && results.recommendations.length > 0) {
    console.log('\n' + chalk.yellow('💡 推奨事項:'));
    results.recommendations.forEach((rec, index) => {
      console.log(`  ${index + 1}. ${rec}`);
    });
  }
}

/**
 * 詳細結果を表示
 */
function displayDetailedResults(results) {
  console.log('\n' + chalk.bold('🔍 詳細結果'));
  console.log(chalk.gray('━'.repeat(50)));
  
  Object.entries(results.checks).forEach(([checkName, result]) => {
    console.log(`\n${chalk.cyan(checkName)}:`);
    
    if (result.details) {
      Object.entries(result.details).forEach(([key, value]) => {
        console.log(`  ${key}: ${value}`);
      });
    }
    
    if (result.error) {
      console.log(`  ${chalk.red('エラー')}: ${result.error}`);
    }
    
    if (result.recommendations) {
      console.log(`  ${chalk.yellow('推奨事項')}:`);
      result.recommendations.forEach(rec => {
        console.log(`    - ${rec}`);
      });
    }
  });
}

/**
 * レポート一覧を表示
 */
async function listReports() {
  try {
    const reportsDir = './reports/health';
    
    try {
      const files = await fs.readdir(reportsDir);
      const reportFiles = files.filter(f => f.endsWith('.md')).sort().reverse();
      
      if (reportFiles.length === 0) {
        console.log(chalk.yellow('📄 レポートが見つかりませんでした'));
        return;
      }
      
      console.log(chalk.blue(`📄 ヘルスレポート一覧 (${reportFiles.length}件)`));
      console.log(chalk.gray('━'.repeat(50)));
      
      const table = new Table({
        head: ['ファイル名', '診断レベル', '日時', 'サイズ'],
        colWidths: [40, 15, 25, 10]
      });
      
      for (const file of reportFiles.slice(0, 20)) { // 最新20件まで表示
        const stat = await fs.stat(path.join(reportsDir, file));
        const parts = file.replace('.md', '').split('-');
        const level = parts[2] || 'unknown';
        
        table.push([
          file,
          level,
          stat.mtime.toLocaleString('ja-JP'),
          `${Math.round(stat.size / 1024)}KB`
        ]);
      }
      
      console.log(table.toString());
      
      if (reportFiles.length > 20) {
        console.log(chalk.gray(`... 他${reportFiles.length - 20}件`));
      }
      
    } catch (error) {
      console.log(chalk.yellow('📄 レポートディレクトリが見つかりませんでした'));
    }
    
  } catch (error) {
    console.error(chalk.red('❌ レポート一覧の取得に失敗しました:'), error.message);
    process.exit(1);
  }
}

/**
 * スケジュール管理
 */
async function manageSchedule(action, options) {
  try {
    const scheduler = await initializeHealthScheduler();
    
    switch (action) {
      case 'start':
        await scheduler.start();
        console.log(chalk.green('✅ ヘルススケジューラーを開始しました'));
        displayScheduleInfo(scheduler);
        break;
        
      case 'stop':
        scheduler.stop();
        console.log(chalk.yellow('⏹️  ヘルススケジューラーを停止しました'));
        break;
        
      case 'status':
        displayScheduleInfo(scheduler);
        break;
        
      case 'info':
        const info = scheduler.getScheduleInfo();
        console.log(JSON.stringify(info, null, 2));
        break;
        
      default:
        console.error(chalk.red('❌ 不正なアクション:'), action);
        process.exit(1);
    }
    
  } catch (error) {
    console.error(chalk.red('❌ スケジュール管理に失敗しました:'), error.message);
    process.exit(1);
  }
}

/**
 * スケジュール情報を表示
 */
function displayScheduleInfo(scheduler) {
  const info = scheduler.getScheduleInfo();
  
  console.log('\n' + chalk.bold('📅 スケジュール情報'));
  console.log(chalk.gray('━'.repeat(50)));
  console.log(`ステータス: ${info.isRunning ? chalk.green('実行中') : chalk.red('停止中')}`);
  
  if (info.tasks && info.tasks.length > 0) {
    console.log('\n📋 登録されたタスク:');
    
    const table = new Table({
      head: ['診断レベル', 'スケジュール', '説明'],
      colWidths: [15, 20, 40]
    });
    
    info.tasks.forEach(task => {
      table.push([
        task.name,
        task.schedule,
        task.description
      ]);
    });
    
    console.log(table.toString());
  }
  
  if (info.lastDiagnostics && info.lastDiagnostics.length > 0) {
    console.log('\n📊 最近の診断履歴:');
    
    const historyTable = new Table({
      head: ['日時', 'レベル', 'ステータス', '実行時間'],
      colWidths: [25, 15, 15, 15]
    });
    
    info.lastDiagnostics.slice(-5).forEach(diag => {
      historyTable.push([
        new Date(diag.startTime).toLocaleString('ja-JP'),
        diag.level,
        getStatusIcon(diag.overallStatus) + ' ' + diag.overallStatus,
        `${diag.duration}ms`
      ]);
    });
    
    console.log(historyTable.toString());
  }
}

/**
 * ステータスアイコンを取得
 */
function getStatusIcon(status) {
  switch (status) {
    case 'passed':
    case 'healthy':
      return '✅';
    case 'warning':
      return '⚠️';
    case 'failed':
    case 'unhealthy':
      return '❌';
    case 'error':
      return '🔥';
    default:
      return '❓';
  }
}

/**
 * ステータス色を取得
 */
function getStatusColor(status) {
  switch (status) {
    case 'passed':
    case 'healthy':
      return chalk.green;
    case 'warning':
      return chalk.yellow;
    case 'failed':
    case 'unhealthy':
      return chalk.red;
    case 'error':
      return chalk.red.bold;
    default:
      return chalk.gray;
  }
}

// CLI設定
program
  .name('health-scheduler-cli')
  .description('PoppoBuilder Health Scheduler CLI')
  .version('1.0.0');

program
  .command('check')
  .description('ヘルスチェックを実行')
  .option('-l, --level <level>', '診断レベル (daily/weekly/monthly)', 'daily')
  .option('-d, --detailed', '詳細な結果を表示')
  .option('-j, --json', 'JSON形式で出力')
  .action(checkHealth);

program
  .command('reports')
  .description('ヘルスレポート一覧を表示')
  .action(listReports);

program
  .command('schedule <action>')
  .description('スケジュール管理 (start/stop/status/info)')
  .action(manageSchedule);

// エラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('❌ 未処理の Promise リジェクション:'), reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('❌ 未処理の例外:'), error);
  process.exit(1);
});

// CLI実行
if (require.main === module) {
  program.parse(process.argv);
}

module.exports = program;