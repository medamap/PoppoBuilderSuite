#!/usr/bin/env node

/**
 * Unified Benchmark Runner CLI - Issue #134
 * 統合パフォーマンスベンチマークツールのコマンドラインインターフェース
 */

const { program } = require('commander');
const chalk = require('chalk');
const UnifiedBenchmarkRunner = require('../lib/performance/unified-benchmark-runner');
const path = require('path');

// CLIのバージョン情報
program
  .name('benchmark')
  .description('PoppoBuilder Suite 統合パフォーマンスベンチマーク')
  .version('1.0.0');

// ベンチマーク実行コマンド
program
  .command('run')
  .description('ベンチマークスイートを実行')
  .option('-t, --types <types>', 'ベンチマークタイプ (performance,load,agents,redis,system)', 'performance,load,agents,system')
  .option('-s, --short', '短時間テストモード（開発用）', false)
  .option('-f, --full', '完全テストモード（CI/CD用）', false)
  .option('-o, --output <dir>', '出力ディレクトリ', './reports/benchmarks')
  .option('--format <format>', 'レポート形式 (json|html|both)', 'both')
  .option('--no-redis', 'Redisベンチマークを無効化')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('🚀 PoppoBuilder Suite ベンチマーク開始'));
      console.log(chalk.gray(`📅 ${new Date().toLocaleString('ja-JP')}`));
      
      // オプションの解析
      const benchmarkTypes = options.types.split(',').map(t => t.trim());
      
      // UnifiedBenchmarkRunnerの設定
      const benchmarkConfig = {
        benchmarkTypes,
        shortTest: options.short,
        fullTest: options.full,
        outputDir: path.resolve(options.output),
        reportFormat: options.format,
        redis: {
          enabled: options.redis !== false
        }
      };
      
      console.log(chalk.cyan(`📋 実行項目: ${benchmarkTypes.join(', ')}`));
      console.log(chalk.cyan(`⏱️  テストモード: ${options.short ? '短時間' : options.full ? '完全' : '標準'}`));
      console.log(chalk.cyan(`📁 出力先: ${benchmarkConfig.outputDir}`));
      
      // ベンチマーク実行
      const runner = new UnifiedBenchmarkRunner(benchmarkConfig);
      
      // 進捗表示
      runner.on('benchmark-completed', ({ type, result }) => {
        console.log(chalk.green(`✅ ${type} ベンチマーク完了`));
      });
      
      // エラーハンドリング
      process.on('SIGINT', async () => {
        console.log(chalk.yellow('\n⏹️  ベンチマークを中断中...'));
        await runner.stop();
        process.exit(0);
      });
      
      // 初期化と実行
      await runner.initialize();
      const results = await runner.runFullBenchmarkSuite();
      
      // 結果表示
      console.log(chalk.blue.bold('\n📊 ベンチマーク結果'));
      console.log(`総合スコア: ${getScoreColor(results.overallScore)(`${results.overallScore}/100`)}`);
      
      if (results.recommendations.length > 0) {
        console.log(chalk.yellow.bold('\n💡 推奨事項'));
        results.recommendations.forEach(rec => {
          const severityColor = rec.severity === 'high' ? chalk.red : rec.severity === 'medium' ? chalk.yellow : chalk.blue;
          console.log(`${severityColor('●')} [${rec.category}] ${rec.message}`);
        });
      }
      
      console.log(chalk.green.bold('\n🎉 ベンチマーク完了！'));
      
    } catch (error) {
      console.error(chalk.red.bold('❌ ベンチマーク実行に失敗:'), error.message);
      process.exit(1);
    }
  });

// ステータス確認コマンド
program
  .command('status')
  .description('実行中のベンチマークステータスを確認')
  .action(() => {
    console.log(chalk.blue('📊 ベンチマークステータス'));
    console.log(chalk.gray('現在実行中のベンチマークはありません'));
    // 実際の実装では、実行中のプロセス状態を確認
  });

// レポート確認コマンド
program
  .command('reports')
  .description('過去のベンチマークレポートを一覧表示')
  .option('-d, --dir <dir>', 'レポートディレクトリ', './reports/benchmarks')
  .action(async (options) => {
    try {
      const fs = require('fs').promises;
      const reportDir = path.resolve(options.dir);
      
      const files = await fs.readdir(reportDir).catch(() => []);
      const reports = files.filter(f => f.endsWith('.json') || f.endsWith('.html'));
      
      if (reports.length === 0) {
        console.log(chalk.yellow('📝 ベンチマークレポートが見つかりません'));
        return;
      }
      
      console.log(chalk.blue.bold(`📋 ベンチマークレポート (${reports.length}件)`));
      console.log(chalk.gray(`📁 ${reportDir}\n`));
      
      for (const report of reports.sort().reverse()) {
        const filePath = path.join(reportDir, report);
        const stats = await fs.stat(filePath);
        const size = Math.round(stats.size / 1024);
        
        console.log(`📄 ${chalk.cyan(report)}`);
        console.log(`   📅 ${stats.mtime.toLocaleString('ja-JP')} (${size}KB)`);
      }
      
    } catch (error) {
      console.error(chalk.red('❌ レポート一覧の取得に失敗:'), error.message);
    }
  });

// クイックテストコマンド
program
  .command('quick')
  .description('クイックベンチマーク（開発用）')
  .option('-t, --type <type>', 'ベンチマークタイプ', 'performance')
  .action(async (options) => {
    try {
      console.log(chalk.blue.bold('⚡ クイックベンチマーク開始'));
      
      const runner = new UnifiedBenchmarkRunner({
        benchmarkTypes: [options.type],
        shortTest: true,
        outputDir: './reports/benchmarks',
        reportFormat: 'json'
      });
      
      await runner.initialize();
      const results = await runner.runFullBenchmarkSuite();
      
      console.log(chalk.green(`✅ ${options.type} ベンチマーク完了`));
      console.log(`スコア: ${getScoreColor(results.overallScore)(`${results.overallScore}/100`)}`);
      
    } catch (error) {
      console.error(chalk.red.bold('❌ クイックベンチマーク失敗:'), error.message);
      process.exit(1);
    }
  });

// スコアに応じた色を返す
function getScoreColor(score) {
  if (score >= 80) return chalk.green;
  if (score >= 60) return chalk.yellow;
  if (score >= 40) return chalk.red; // orange は利用できないため red を使用
  return chalk.red;
}

// ヘルプコマンドのカスタマイズ
program.on('--help', () => {
  console.log('');
  console.log(chalk.blue.bold('使用例:'));
  console.log('  $ benchmark run --short                    # 短時間テスト');
  console.log('  $ benchmark run --types performance,load  # 特定のベンチマークのみ');
  console.log('  $ benchmark quick --type system           # システムクイックテスト');
  console.log('  $ benchmark reports                       # レポート一覧');
  console.log('');
  console.log(chalk.blue.bold('ベンチマークタイプ:'));
  console.log('  performance  - パフォーマンス監視とプロファイリング');
  console.log('  load         - 負荷テスト（同時接続、スループット）');
  console.log('  agents       - エージェント別性能テスト');
  console.log('  redis        - Redis操作パフォーマンステスト');
  console.log('  system       - システムリソーステスト（CPU、メモリ、I/O）');
  console.log('');
});

// エラーハンドリング
program.configureOutput({
  outputError: (str, write) => write(chalk.red(str))
});

// コマンドライン引数の解析
program.parse();

// 引数なしの場合はヘルプを表示
if (!process.argv.slice(2).length) {
  program.outputHelp();
}