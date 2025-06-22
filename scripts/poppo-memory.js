#!/usr/bin/env node
/**
 * PoppoBuilder メモリ管理CLIツール
 * メモリ使用量の監視、分析、最適化を行う
 */

const path = require('path');
const fs = require('fs').promises;
const { program } = require('commander');
const chalk = require('chalk');
const Table = require('cli-table3');
const MemoryMonitor = require('../src/memory-monitor');
const MemoryOptimizer = require('../src/memory-optimizer');
const MemoryLeakDetector = require('../src/memory-leak-detector');

// 設定読み込み
const configPath = path.join(__dirname, '../config/config.json');
let config = {};
try {
  config = require(configPath);
} catch (error) {
  console.error(chalk.red('設定ファイルの読み込みに失敗しました'));
}

// バイト数を人間が読みやすい形式に変換
function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = bytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(2)} ${units[unitIndex]}`;
}

// 時間をフォーマット
function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  if (hours > 0) {
    return `${hours}時間${minutes % 60}分`;
  } else if (minutes > 0) {
    return `${minutes}分${seconds % 60}秒`;
  } else {
    return `${seconds}秒`;
  }
}

// メモリ状態を表示
async function showStatus() {
  console.log(chalk.cyan('📊 メモリ使用状況\n'));
  
  const memUsage = process.memoryUsage();
  const v8 = require('v8');
  const heapStats = v8.getHeapStatistics();
  
  const table = new Table({
    head: ['項目', '使用量', '詳細'],
    colWidths: [30, 20, 30]
  });
  
  table.push(
    ['RSS (Resident Set Size)', formatBytes(memUsage.rss), '物理メモリ使用量'],
    ['Heap Total', formatBytes(memUsage.heapTotal), 'V8が確保したヒープサイズ'],
    ['Heap Used', formatBytes(memUsage.heapUsed), '実際に使用中のヒープ'],
    ['External', formatBytes(memUsage.external), 'V8外部のメモリ使用量'],
    ['Array Buffers', formatBytes(memUsage.arrayBuffers), 'ArrayBuffer使用量']
  );
  
  console.log(table.toString());
  
  // V8統計
  console.log(chalk.cyan('\n🔧 V8エンジン統計\n'));
  
  const v8Table = new Table({
    head: ['項目', '値'],
    colWidths: [40, 30]
  });
  
  v8Table.push(
    ['ヒープサイズ上限', formatBytes(heapStats.heap_size_limit)],
    ['使用可能サイズ', formatBytes(heapStats.total_available_size)],
    ['ネイティブコンテキスト数', heapStats.number_of_native_contexts],
    ['デタッチされたコンテキスト数', heapStats.number_of_detached_contexts]
  );
  
  console.log(v8Table.toString());
}

// メモリ監視を開始
async function startMonitor(options) {
  console.log(chalk.green('🔍 メモリ監視を開始します...\n'));
  
  const monitor = new MemoryMonitor({
    interval: options.interval ? parseInt(options.interval) * 1000 : 60000,
    thresholds: {
      heapUsed: options.heapThreshold ? parseInt(options.heapThreshold) * 1024 * 1024 : 500 * 1024 * 1024,
      rss: options.rssThreshold ? parseInt(options.rssThreshold) * 1024 * 1024 : 1500 * 1024 * 1024
    }
  });
  
  // イベントリスナー設定
  monitor.on('threshold-exceeded', ({ current, alerts }) => {
    console.log(chalk.red('\n⚠️  メモリ閾値超過を検出!\n'));
    
    const table = new Table({
      head: ['種類', '現在値', '閾値', '重要度'],
      colWidths: [20, 20, 20, 15]
    });
    
    for (const alert of alerts) {
      table.push([
        alert.type,
        formatBytes(alert.value),
        formatBytes(alert.threshold),
        alert.severity === 'critical' ? chalk.red(alert.severity) : chalk.yellow(alert.severity)
      ]);
    }
    
    console.log(table.toString());
  });
  
  monitor.on('memory-leak-detected', (leakInfo) => {
    console.log(chalk.red('\n🚨 メモリリークの可能性を検出!\n'));
    console.log(`増加率: ${leakInfo.mbPerMinute} MB/分`);
    console.log(`増加割合: ${leakInfo.increaseRate}%`);
    console.log(`推奨事項: ${leakInfo.recommendation}`);
  });
  
  monitor.on('memory-stats', ({ current, stats }) => {
    if (options.verbose) {
      console.log(chalk.dim(`[${new Date().toLocaleTimeString()}] Heap: ${formatBytes(current.heapUsed)} / RSS: ${formatBytes(current.rss)}`));
    }
  });
  
  // 監視開始
  await monitor.start();
  
  console.log(chalk.green('監視中... (Ctrl+Cで終了)\n'));
  
  // 定期的に統計を表示
  if (!options.quiet) {
    setInterval(async () => {
      const stats = monitor.getStatistics();
      if (stats) {
        console.log(chalk.cyan('\n📈 統計情報'));
        console.log(`サンプル数: ${stats.samples}`);
        console.log(`平均ヒープ使用量: ${formatBytes(stats.heapUsed.avg)}`);
        console.log(`最大ヒープ使用量: ${formatBytes(stats.heapUsed.max)}`);
      }
    }, 300000); // 5分ごと
  }
  
  // 終了処理
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\n監視を終了します...'));
    monitor.stop();
    process.exit(0);
  });
}

// メモリ最適化を実行
async function optimize(options) {
  console.log(chalk.green('🧹 メモリ最適化を実行します...\n'));
  
  const monitor = new MemoryMonitor();
  const optimizer = new MemoryOptimizer();
  
  // 最適化前の状態
  const before = monitor.getCurrentMemoryUsage();
  console.log(chalk.cyan('最適化前:'));
  console.log(`Heap Used: ${formatBytes(before.heapUsed)}`);
  console.log(`RSS: ${formatBytes(before.rss)}`);
  
  // メモリ最適化実行
  const result = await monitor.optimize();
  
  if (options.deep) {
    console.log(chalk.yellow('\n深い最適化を実行中...'));
    await optimizer.performGlobalOptimization();
  }
  
  // 結果表示
  console.log(chalk.cyan('\n最適化後:'));
  console.log(`Heap Used: ${formatBytes(result.after.heapUsed)} (${result.freedMB.heapUsed} MB削減)`);
  console.log(`RSS: ${formatBytes(result.after.rss)} (${result.freedMB.rss} MB削減)`);
  
  if (result.freed.heapUsed > 0) {
    console.log(chalk.green('\n✅ メモリ最適化が完了しました'));
  } else {
    console.log(chalk.yellow('\n⚠️  最適化による大きな改善は見られませんでした'));
  }
}

// メモリリーク検出を実行
async function detectLeaks(options) {
  console.log(chalk.green('🔎 メモリリーク検出を開始します...\n'));
  
  const detector = new MemoryLeakDetector({
    checkInterval: options.interval ? parseInt(options.interval) * 1000 : 300000,
    analysis: {
      sampleCount: options.samples || 5
    }
  });
  
  detector.on('leaks-detected', (leaks) => {
    console.log(chalk.red(`\n🚨 ${leaks.length}個の潜在的なメモリリークを検出!\n`));
    
    for (const leak of leaks) {
      console.log(chalk.yellow(`種類: ${leak.type}`));
      
      if (leak.type === 'growing-constructor') {
        console.log(`コンストラクタ: ${leak.constructor}`);
        console.log(`成長率: ${leak.growthRate}`);
        console.log(`サイズ増加: ${formatBytes(leak.sizeGrowth)}`);
      } else if (leak.type === 'long-lived-object') {
        console.log(`オブジェクト: ${leak.name}`);
        console.log(`サイズ: ${formatBytes(leak.size)}`);
        console.log(`保持時間: ${formatDuration(leak.retentionTime)}`);
      }
      
      console.log('---');
    }
  });
  
  detector.on('memory-growth', (growth) => {
    console.log(chalk.yellow('\n📈 継続的なメモリ成長を検出\n'));
    console.log(`成長率: ${growth.slopePerHour} MB/時間`);
    console.log(`相関係数: ${growth.correlation}`);
    console.log(`予測 (1時間後): ${growth.prediction.oneHour.toFixed(2)} MB`);
    console.log(`予測 (1日後): ${growth.prediction.oneDay.toFixed(2)} MB`);
  });
  
  // 検出開始
  detector.start();
  
  console.log(chalk.green('リーク検出中... (Ctrl+Cで終了)\n'));
  console.log(chalk.dim(`チェック間隔: ${options.interval || 300}秒`));
  console.log(chalk.dim(`必要サンプル数: ${options.samples || 5}`));
  
  // 終了処理
  process.on('SIGINT', () => {
    console.log(chalk.yellow('\n\nリーク検出を終了します...'));
    detector.stop();
    process.exit(0);
  });
}

// ヒープダンプを取得
async function heapDump(options) {
  console.log(chalk.green('💾 ヒープダンプを取得します...\n'));
  
  const v8 = require('v8');
  const filename = options.output || `heapdump-${Date.now()}.heapsnapshot`;
  const filepath = path.resolve(filename);
  
  try {
    v8.writeHeapSnapshot(filepath);
    const stats = await fs.stat(filepath);
    
    console.log(chalk.green('✅ ヒープダンプを保存しました'));
    console.log(`ファイル: ${filepath}`);
    console.log(`サイズ: ${formatBytes(stats.size)}`);
    
    if (!options.output) {
      console.log(chalk.dim('\nChrome DevToolsで分析するには:'));
      console.log(chalk.dim('1. Chrome DevToolsを開く'));
      console.log(chalk.dim('2. Memoryタブを選択'));
      console.log(chalk.dim('3. Load profileボタンでファイルを読み込む'));
    }
  } catch (error) {
    console.error(chalk.red('❌ ヒープダンプの取得に失敗しました:'), error.message);
  }
}

// レポートを生成
async function generateReport(options) {
  console.log(chalk.green('📄 メモリレポートを生成します...\n'));
  
  const monitor = new MemoryMonitor();
  const optimizer = new MemoryOptimizer();
  const detector = new MemoryLeakDetector();
  
  // 各コンポーネントからレポートを収集
  const monitorReport = await monitor.generateReport();
  const optimizerReport = optimizer.generateReport();
  const detectorReport = await detector.generateReport();
  
  const report = {
    generated: new Date().toISOString(),
    system: {
      platform: process.platform,
      arch: process.arch,
      nodeVersion: process.version,
      uptime: formatDuration(process.uptime() * 1000)
    },
    memory: monitorReport,
    optimization: optimizerReport,
    leakDetection: detectorReport
  };
  
  // 出力形式に応じて処理
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    // コンソール表示
    console.log(chalk.cyan('📊 メモリレポート\n'));
    console.log(`生成日時: ${report.generated}`);
    console.log(`稼働時間: ${report.system.uptime}`);
    
    if (monitorReport) {
      console.log(chalk.cyan('\n現在のメモリ使用状況:'));
      console.log(`Heap Used: ${monitorReport.current.heapUsedMB} MB`);
      console.log(`RSS: ${monitorReport.current.rssMB} MB`);
      
      if (monitorReport.recommendations.length > 0) {
        console.log(chalk.yellow('\n⚠️  推奨事項:'));
        for (const rec of monitorReport.recommendations) {
          console.log(`- ${rec.message}`);
        }
      }
    }
  }
  
  // ファイル保存
  if (options.save) {
    const filename = options.save === true ? `memory-report-${Date.now()}.json` : options.save;
    await fs.writeFile(filename, JSON.stringify(report, null, 2));
    console.log(chalk.green(`\n✅ レポートを保存しました: ${filename}`));
  }
}

// CLIコマンド定義
program
  .name('poppo-memory')
  .description('PoppoBuilder メモリ管理ツール')
  .version('1.0.0');

program
  .command('status')
  .description('現在のメモリ使用状況を表示')
  .action(showStatus);

program
  .command('monitor')
  .description('メモリ使用量を継続的に監視')
  .option('-i, --interval <seconds>', '監視間隔（秒）', '60')
  .option('-v, --verbose', '詳細ログを表示')
  .option('-q, --quiet', '統計情報を非表示')
  .option('--heap-threshold <MB>', 'ヒープ使用量の閾値（MB）')
  .option('--rss-threshold <MB>', 'RSS使用量の閾値（MB）')
  .action(startMonitor);

program
  .command('optimize')
  .description('メモリ最適化を実行')
  .option('-d, --deep', '深い最適化を実行')
  .action(optimize);

program
  .command('detect-leaks')
  .description('メモリリークを検出')
  .option('-i, --interval <seconds>', 'チェック間隔（秒）', '300')
  .option('-s, --samples <count>', '分析に必要なサンプル数', '5')
  .action(detectLeaks);

program
  .command('heap-dump')
  .description('ヒープダンプを取得')
  .option('-o, --output <file>', '出力ファイル名')
  .action(heapDump);

program
  .command('report')
  .description('メモリ分析レポートを生成')
  .option('-j, --json', 'JSON形式で出力')
  .option('-s, --save [file]', 'ファイルに保存')
  .action(generateReport);

// ヘルプテキストのカスタマイズ
program.on('--help', () => {
  console.log('');
  console.log('使用例:');
  console.log('  $ poppo-memory status                    # 現在の状態を表示');
  console.log('  $ poppo-memory monitor -v                # 詳細モードで監視');
  console.log('  $ poppo-memory optimize --deep           # 深い最適化を実行');
  console.log('  $ poppo-memory detect-leaks -i 60        # 60秒ごとにリーク検出');
  console.log('  $ poppo-memory report --save report.json # レポートを保存');
});

// コマンド実行
program.parse(process.argv);