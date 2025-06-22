#!/usr/bin/env node

/**
 * PoppoBuilder SLO CLI
 * SLO状態の確認とレポート生成
 */

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const { SLAManager } = require('../src/sla/sla-manager');
const DatabaseManager = require('../src/database-manager');

// カラー出力用
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

// 設定を読み込み
const configPath = path.join(__dirname, '../config/config.json');
const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

/**
 * SLAマネージャーを初期化
 */
async function initSLAManager() {
  const databaseManager = new DatabaseManager();
  const slaManager = new SLAManager({
    ...config.sla,
    databaseManager
  });
  
  await slaManager.initialize();
  return slaManager;
}

/**
 * SLO状態を表示
 */
async function showStatus(options) {
  const slaManager = await initSLAManager();
  
  try {
    await slaManager.start();
    
    // SLOチェックを手動実行
    await slaManager.sloMonitor.checkAllSLOs();
    
    const status = slaManager.getSLOStatus();
    
    if (options.json) {
      console.log(JSON.stringify(status, null, 2));
      return;
    }
    
    // ヘッダー
    console.log(`\n${colors.cyan}PoppoBuilder SLO Status${colors.reset}`);
    console.log(`${colors.gray}${'='.repeat(50)}${colors.reset}\n`);
    
    // サマリー
    const summary = status.summary;
    const complianceColor = summary.complianceRate >= 0.95 ? colors.green : 
                          summary.complianceRate >= 0.80 ? colors.yellow : colors.red;
    
    console.log(`${colors.blue}Overall Compliance:${colors.reset} ${complianceColor}${(summary.complianceRate * 100).toFixed(1)}%${colors.reset}`);
    console.log(`Total SLOs: ${summary.total}, Compliant: ${colors.green}${summary.compliant}${colors.reset}, Violations: ${colors.red}${summary.violations}${colors.reset}\n`);
    
    // 個別SLO
    console.log(`${colors.blue}Individual SLOs:${colors.reset}`);
    for (const [key, slo] of Object.entries(status.status)) {
      const icon = slo.compliant ? '✅' : '❌';
      const color = slo.compliant ? colors.green : colors.red;
      
      let currentValue = 'N/A';
      let targetValue = '';
      
      if (slo.current !== null) {
        if (slo.type === 'performance') {
          currentValue = `${slo.current.toFixed(0)}ms`;
          targetValue = `≤ ${slo.target}ms`;
        } else {
          currentValue = `${(slo.current * 100).toFixed(1)}%`;
          targetValue = `≥ ${(slo.target * 100).toFixed(1)}%`;
        }
      }
      
      console.log(`${icon} ${color}${key}${colors.reset}`);
      console.log(`   Current: ${currentValue}, Target: ${targetValue}`);
      if (options.verbose) {
        console.log(`   ${colors.gray}${slo.description}${colors.reset}`);
      }
    }
    
    // エラーバジェット
    if (!options.brief) {
      console.log(`\n${colors.blue}Error Budgets:${colors.reset}`);
      for (const [key, budget] of Object.entries(status.errorBudgets)) {
        const icon = budget.consumed > 0.8 ? '🚨' : budget.consumed > 0.5 ? '⚠️ ' : '✅';
        const color = budget.consumed > 0.8 ? colors.red : budget.consumed > 0.5 ? colors.yellow : colors.green;
        
        console.log(`${icon} ${key}: ${color}${budget.percentage.toFixed(1)}% consumed${colors.reset}, ${(budget.remaining * 100).toFixed(1)}% remaining`);
      }
    }
    
  } finally {
    await slaManager.stop();
  }
}

/**
 * レポートを生成
 */
async function generateReport(type, options) {
  const slaManager = await initSLAManager();
  
  try {
    await slaManager.start();
    
    console.log(`${colors.blue}Generating ${type} report...${colors.reset}`);
    
    let report;
    if (type === 'custom' && options.start && options.end) {
      report = await slaManager.generateReport('custom', 
        new Date(options.start), 
        new Date(options.end)
      );
    } else {
      report = await slaManager.generateReport(type);
    }
    
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      // レポートサマリーを表示
      console.log(`\n${colors.green}Report generated successfully!${colors.reset}`);
      console.log(`Period: ${report.period.start} - ${report.period.end}`);
      console.log(`Overall Compliance: ${(report.summary.overall_compliance * 100).toFixed(1)}%`);
      
      // ファイルパス
      const filename = `slo-report-${type}-${new Date().toISOString().split('T')[0]}.md`;
      const filepath = path.join(__dirname, '../reports/slo', filename);
      console.log(`\nReport saved to: ${colors.cyan}${filepath}${colors.reset}`);
    }
    
  } finally {
    await slaManager.stop();
  }
}

/**
 * エラーバジェットを表示
 */
async function showErrorBudget(sloKey, options) {
  const slaManager = await initSLAManager();
  
  try {
    await slaManager.start();
    await slaManager.sloMonitor.checkAllSLOs();
    
    const errorBudgets = slaManager.sloMonitor.getErrorBudgets();
    
    if (sloKey) {
      // 特定のSLOのエラーバジェット
      const budget = errorBudgets[sloKey];
      if (!budget) {
        console.error(`${colors.red}Error: SLO '${sloKey}' not found${colors.reset}`);
        process.exit(1);
      }
      
      if (options.json) {
        console.log(JSON.stringify(budget, null, 2));
      } else {
        displayErrorBudget(sloKey, budget);
      }
    } else {
      // 全エラーバジェット
      if (options.json) {
        console.log(JSON.stringify(errorBudgets, null, 2));
      } else {
        console.log(`\n${colors.cyan}Error Budget Status${colors.reset}`);
        console.log(`${colors.gray}${'='.repeat(50)}${colors.reset}\n`);
        
        for (const [key, budget] of Object.entries(errorBudgets)) {
          displayErrorBudget(key, budget);
          console.log();
        }
      }
    }
    
  } finally {
    await slaManager.stop();
  }
}

/**
 * エラーバジェットを表示
 */
function displayErrorBudget(sloKey, budget) {
  const consumed = budget.consumed * 100;
  const remaining = budget.remaining * 100;
  
  let status, color;
  if (consumed > 80) {
    status = 'CRITICAL';
    color = colors.red;
  } else if (consumed > 50) {
    status = 'WARNING';
    color = colors.yellow;
  } else {
    status = 'HEALTHY';
    color = colors.green;
  }
  
  console.log(`${colors.blue}${sloKey}${colors.reset}`);
  console.log(`Status: ${color}${status}${colors.reset}`);
  console.log(`Consumed: ${color}${consumed.toFixed(1)}%${colors.reset}`);
  console.log(`Remaining: ${remaining.toFixed(1)}%`);
  
  // ビジュアルバー
  const barLength = 30;
  const consumedBars = Math.round(consumed / 100 * barLength);
  const bar = '█'.repeat(consumedBars) + '░'.repeat(barLength - consumedBars);
  console.log(`[${color}${bar}${colors.reset}]`);
}

// CLIコマンド定義
program
  .name('poppo-slo')
  .description('PoppoBuilder SLO monitoring CLI')
  .version('1.0.0');

// statusコマンド
program
  .command('status')
  .description('Show current SLO status')
  .option('-j, --json', 'Output as JSON')
  .option('-b, --brief', 'Brief output (no error budgets)')
  .option('-v, --verbose', 'Verbose output')
  .action(showStatus);

// reportコマンド
program
  .command('report <type>')
  .description('Generate SLO report (weekly, monthly, or custom)')
  .option('-j, --json', 'Output as JSON')
  .option('-s, --start <date>', 'Start date for custom report')
  .option('-e, --end <date>', 'End date for custom report')
  .action(generateReport);

// budgetコマンド
program
  .command('budget [sloKey]')
  .description('Show error budget status')
  .option('-j, --json', 'Output as JSON')
  .action(showErrorBudget);

// ヘルプ表示の改善
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('  $ poppo-slo status');
  console.log('  $ poppo-slo status --json');
  console.log('  $ poppo-slo report weekly');
  console.log('  $ poppo-slo report custom --start 2024-01-01 --end 2024-01-31');
  console.log('  $ poppo-slo budget');
  console.log('  $ poppo-slo budget availability:poppo-builder');
});

// コマンド実行
program.parse(process.argv);

// コマンドが指定されていない場合はヘルプを表示
if (!process.argv.slice(2).length) {
  program.outputHelp();
}