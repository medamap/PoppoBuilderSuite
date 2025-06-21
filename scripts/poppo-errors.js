#!/usr/bin/env node

/**
 * PoppoBuilder エラーハンドリング CLI ツール
 * エラーの管理、統計表示、レポート生成、リカバリー操作
 */

const { program } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const fs = require('fs').promises;
const path = require('path');

// ErrorHandlerとRecoveryManagerを読み込み
const { ErrorHandler, ErrorCodes } = require('../src/error-handler');
const { ErrorRecoveryManager } = require('../src/error-recovery');
const ErrorReporter = require('../src/error-reporter');
const Logger = require('../src/logger');

/**
 * エラー統計を表示
 */
async function showStats() {
  try {
    const logger = new Logger('logs');
    const errorHandler = new ErrorHandler(logger);
    await errorHandler.loadErrors();
    
    const stats = errorHandler.getStats();
    
    console.log(chalk.blue.bold('\n📊 Error Statistics\n'));
    
    // 全体統計
    console.log(chalk.white.bold('Overall Statistics:'));
    console.log(`Total Errors: ${chalk.yellow(stats.total)}`);
    
    // 重要度別統計
    if (Object.keys(stats.bySeverity).length > 0) {
      console.log('\nErrors by Severity:');
      const severityTable = new Table({
        head: ['Severity', 'Count', 'Percentage']
      });
      
      for (const [severity, count] of Object.entries(stats.bySeverity)) {
        const percentage = stats.total > 0 ? ((count / stats.total) * 100).toFixed(1) : '0.0';
        const coloredSeverity = severity === 'critical' ? chalk.red(severity) :
                              severity === 'high' ? chalk.red(severity) :
                              severity === 'medium' ? chalk.yellow(severity) :
                              chalk.green(severity);
        severityTable.push([coloredSeverity, count, `${percentage}%`]);
      }
      console.log(severityTable.toString());
    }
    
    // エラーコード別統計（トップ10）
    if (Object.keys(stats.byCode).length > 0) {
      console.log('\nTop Error Codes:');
      const codeTable = new Table({
        head: ['Error Code', 'Count', 'First Seen', 'Last Seen']
      });
      
      const sortedCodes = Object.entries(stats.byCode)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 10);
      
      for (const [code, codeStats] of sortedCodes) {
        codeTable.push([
          code,
          codeStats.count,
          codeStats.firstOccurrence ? new Date(codeStats.firstOccurrence).toISOString().split('T')[0] : 'N/A',
          codeStats.lastOccurrence ? new Date(codeStats.lastOccurrence).toISOString().split('T')[0] : 'N/A'
        ]);
      }
      console.log(codeTable.toString());
    }
    
    // 最近のエラー
    if (stats.recent.length > 0) {
      console.log('\nRecent Errors:');
      const recentTable = new Table({
        head: ['Time', 'Code', 'Severity', 'Message']
      });
      
      for (const error of stats.recent.slice(0, 5)) {
        const time = new Date(error.timestamp).toLocaleString();
        const coloredSeverity = error.severity === 'critical' ? chalk.red(error.severity) :
                              error.severity === 'high' ? chalk.red(error.severity) :
                              error.severity === 'medium' ? chalk.yellow(error.severity) :
                              chalk.green(error.severity);
        recentTable.push([
          time,
          error.code,
          coloredSeverity,
          error.message.substring(0, 50) + (error.message.length > 50 ? '...' : '')
        ]);
      }
      console.log(recentTable.toString());
    }
    
  } catch (error) {
    console.error(chalk.red('Error loading statistics:'), error.message);
    process.exit(1);
  }
}

/**
 * エラーレポートを生成
 */
async function generateReport(format, options) {
  try {
    const logger = new Logger('logs');
    const errorHandler = new ErrorHandler(logger);
    const recoveryManager = new ErrorRecoveryManager(logger);
    const reporter = new ErrorReporter(errorHandler, recoveryManager);
    
    await errorHandler.loadErrors();
    
    console.log(chalk.blue('Generating error report...'));
    
    const reportOptions = {
      format: format || 'json',
      period: options.period || 'daily',
      includeDetails: !options.summary,
      includeRecommendations: !options.noRecommendations
    };
    
    if (options.start && options.end) {
      reportOptions.startDate = options.start;
      reportOptions.endDate = options.end;
    }
    
    const result = await reporter.generateReport(reportOptions);
    
    console.log(chalk.green(`Report generated: ${result.path}`));
    
    // サマリー表示
    if (options.show) {
      const reportData = JSON.parse(await fs.readFile(result.path, 'utf-8'));
      console.log('\nReport Summary:');
      console.log(`Total Errors: ${reportData.summary.totalErrors}`);
      console.log(`Error Rate: ${reportData.summary.errorRate}`);
      console.log(`Recovery Rate: ${reportData.summary.recoveryRate}`);
      
      if (reportData.recommendations && reportData.recommendations.length > 0) {
        console.log('\nTop Recommendations:');
        for (const rec of reportData.recommendations.slice(0, 3)) {
          const priority = rec.priority === 'critical' ? chalk.red(rec.priority) :
                          rec.priority === 'high' ? chalk.red(rec.priority) :
                          rec.priority === 'medium' ? chalk.yellow(rec.priority) :
                          chalk.green(rec.priority);
          console.log(`- [${priority}] ${rec.title}`);
        }
      }
    }
    
  } catch (error) {
    console.error(chalk.red('Error generating report:'), error.message);
    process.exit(1);
  }
}

/**
 * リカバリー統計を表示
 */
async function showRecoveryStats() {
  try {
    const logger = new Logger('logs');
    const recoveryManager = new ErrorRecoveryManager(logger);
    
    const stats = recoveryManager.getStats();
    
    console.log(chalk.blue.bold('\n🔧 Recovery Statistics\n'));
    
    console.log(chalk.white.bold('Overall Recovery Performance:'));
    console.log(`Total Recovery Attempts: ${chalk.yellow(stats.total)}`);
    console.log(`Successful Recoveries: ${chalk.green(stats.successful)}`);
    console.log(`Failed Recoveries: ${chalk.red(stats.failed)}`);
    
    if (stats.total > 0) {
      const successRate = (stats.successful / stats.total * 100).toFixed(1);
      console.log(`Success Rate: ${chalk.cyan(successRate + '%')}`);
      console.log(`Average Duration: ${chalk.cyan((stats.averageDuration / 1000).toFixed(2) + 's')}`);
    }
    
    // エラーコード別リカバリー統計
    if (Object.keys(stats.byErrorCode).length > 0) {
      console.log('\nRecovery by Error Code:');
      const recoveryTable = new Table({
        head: ['Error Code', 'Total', 'Successful', 'Failed', 'Success Rate']
      });
      
      for (const [code, codeStats] of Object.entries(stats.byErrorCode)) {
        const successRate = codeStats.total > 0 ?
          (codeStats.successful / codeStats.total * 100).toFixed(1) : '0.0';
        const rateColor = parseFloat(successRate) >= 80 ? chalk.green :
                         parseFloat(successRate) >= 60 ? chalk.yellow :
                         chalk.red;
        
        recoveryTable.push([
          code,
          codeStats.total,
          chalk.green(codeStats.successful),
          chalk.red(codeStats.failed),
          rateColor(`${successRate}%`)
        ]);
      }
      console.log(recoveryTable.toString());
    }
    
    // アクション別使用統計
    if (Object.keys(stats.byAction).length > 0) {
      console.log('\nRecovery Actions Usage:');
      const actionTable = new Table({
        head: ['Action', 'Count', 'Percentage']
      });
      
      const totalActions = Object.values(stats.byAction).reduce((a, b) => a + b, 0);
      const sortedActions = Object.entries(stats.byAction)
        .sort((a, b) => b[1] - a[1]);
      
      for (const [action, count] of sortedActions) {
        const percentage = totalActions > 0 ? (count / totalActions * 100).toFixed(1) : '0.0';
        actionTable.push([action, count, `${percentage}%`]);
      }
      console.log(actionTable.toString());
    }
    
    // 最近のリカバリー
    if (stats.recentRecoveries.length > 0) {
      console.log('\nRecent Recovery Attempts:');
      const recentTable = new Table({
        head: ['Time', 'Error Code', 'Result', 'Duration']
      });
      
      for (const recovery of stats.recentRecoveries.slice(0, 5)) {
        const time = new Date(recovery.timestamp).toLocaleString();
        const result = recovery.success ? chalk.green('Success') : chalk.red('Failed');
        const duration = `${(recovery.duration / 1000).toFixed(2)}s`;
        
        recentTable.push([
          time,
          recovery.error.code,
          result,
          duration
        ]);
      }
      console.log(recentTable.toString());
    }
    
  } catch (error) {
    console.error(chalk.red('Error loading recovery statistics:'), error.message);
    process.exit(1);
  }
}

/**
 * エラー履歴をクリア
 */
async function clearHistory(type) {
  try {
    const logger = new Logger('logs');
    
    if (type === 'errors' || type === 'all') {
      const errorHandler = new ErrorHandler(logger);
      await errorHandler.loadErrors();
      errorHandler.clearHistory();
      await errorHandler.saveErrors();
      console.log(chalk.green('Error history cleared'));
    }
    
    if (type === 'recovery' || type === 'all') {
      // リカバリー履歴は通常ファイルに保存されていないため、
      // ここでは新しいインスタンスを作成することで履歴をクリア
      console.log(chalk.green('Recovery history will be cleared on next restart'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error clearing history:'), error.message);
    process.exit(1);
  }
}

/**
 * エラーコード一覧を表示
 */
function listErrorCodes() {
  console.log(chalk.blue.bold('\n📋 Error Codes Reference\n'));
  
  const categories = {
    'Network Errors': [
      'E_NETWORK_TIMEOUT', 'E_NETWORK_CONNECTION', 'E_API_RATE_LIMIT',
      'E_API_UNAUTHORIZED', 'E_API_NOT_FOUND'
    ],
    'System Errors': [
      'E_SYSTEM_RESOURCE', 'E_SYSTEM_PERMISSION', 'E_SYSTEM_FILE_NOT_FOUND',
      'E_SYSTEM_DISK_FULL'
    ],
    'Process Errors': [
      'E_PROCESS_TIMEOUT', 'E_PROCESS_CRASHED', 'E_PROCESS_KILLED'
    ],
    'Configuration Errors': [
      'E_CONFIG_INVALID', 'E_CONFIG_MISSING'
    ],
    'Data Errors': [
      'E_DATA_CORRUPTION', 'E_DATA_VALIDATION'
    ],
    'Business Logic Errors': [
      'E_BUSINESS_LOGIC', 'E_INVALID_STATE'
    ]
  };
  
  for (const [category, codes] of Object.entries(categories)) {
    console.log(chalk.yellow.bold(category + ':'));
    for (const code of codes) {
      console.log(`  ${chalk.cyan(code)}`);
    }
    console.log();
  }
}

/**
 * 設定を表示
 */
async function showConfig() {
  try {
    const configPath = path.join(__dirname, '../config/config.json');
    const config = JSON.parse(await fs.readFile(configPath, 'utf-8'));
    
    console.log(chalk.blue.bold('\n⚙️ Error Handling Configuration\n'));
    
    if (config.errorHandling) {
      console.log(chalk.yellow('Error Handling:'));
      console.log(JSON.stringify(config.errorHandling, null, 2));
    } else {
      console.log(chalk.yellow('No error handling configuration found in config.json'));
      console.log(chalk.gray('Default settings will be used'));
    }
    
  } catch (error) {
    console.error(chalk.red('Error loading configuration:'), error.message);
    process.exit(1);
  }
}

// CLI設定
program
  .name('poppo-errors')
  .description('PoppoBuilder Error Handling CLI Tool')
  .version('1.0.0');

// 統計表示コマンド
program
  .command('stats')
  .description('Show error statistics')
  .action(showStats);

// レポート生成コマンド
program
  .command('report')
  .description('Generate error report')
  .option('-f, --format <format>', 'Report format (json, markdown, html)', 'json')
  .option('-p, --period <period>', 'Time period (hourly, daily, weekly, monthly)', 'daily')
  .option('-s, --start <date>', 'Start date (YYYY-MM-DD)')
  .option('-e, --end <date>', 'End date (YYYY-MM-DD)')
  .option('--summary', 'Generate summary only (exclude details)')
  .option('--no-recommendations', 'Exclude recommendations')
  .option('--show', 'Show report summary after generation')
  .action((options) => {
    generateReport(options.format, options);
  });

// リカバリー統計コマンド
program
  .command('recovery')
  .description('Show recovery statistics')
  .action(showRecoveryStats);

// 履歴クリアコマンド
program
  .command('clear')
  .description('Clear error/recovery history')
  .argument('<type>', 'History type to clear (errors, recovery, all)')
  .action(clearHistory);

// エラーコード一覧コマンド
program
  .command('codes')
  .description('List all error codes')
  .action(listErrorCodes);

// 設定表示コマンド
program
  .command('config')
  .description('Show error handling configuration')
  .action(showConfig);

// ヘルプコマンド
program
  .command('help')
  .description('Show detailed help')
  .action(() => {
    console.log(chalk.blue.bold('\n🛠️ PoppoBuilder Error Handling CLI\n'));
    
    console.log(chalk.yellow('Available Commands:'));
    console.log('  stats      - Show error statistics and recent errors');
    console.log('  report     - Generate comprehensive error reports');
    console.log('  recovery   - Show recovery performance statistics');
    console.log('  clear      - Clear error or recovery history');
    console.log('  codes      - List all available error codes');
    console.log('  config     - Show current error handling configuration');
    
    console.log(chalk.yellow('\nExamples:'));
    console.log('  poppo-errors stats');
    console.log('  poppo-errors report -f markdown -p weekly --show');
    console.log('  poppo-errors recovery');
    console.log('  poppo-errors clear errors');
    
    console.log(chalk.yellow('\nReport Formats:'));
    console.log('  json       - Machine-readable JSON format');
    console.log('  markdown   - Human-readable Markdown format');
    console.log('  html       - Web-viewable HTML format');
    
    console.log(chalk.yellow('\nTime Periods:'));
    console.log('  hourly     - Last 1 hour');
    console.log('  daily      - Last 24 hours (default)');
    console.log('  weekly     - Last 7 days');
    console.log('  monthly    - Last 30 days');
  });

// メイン実行
if (require.main === module) {
  program.parse();
}

module.exports = {
  showStats,
  generateReport,
  showRecoveryStats,
  clearHistory,
  listErrorCodes,
  showConfig
};