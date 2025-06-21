#!/usr/bin/env node

const axios = require('axios');
const chalk = require('chalk');
const Table = require('cli-table3');
const { Command } = require('commander');

/**
 * PoppoBuilder ヘルスチェックCLI
 */
class HealthCLI {
  constructor() {
    this.dashboardUrl = process.env.POPPO_DASHBOARD_URL || 'http://localhost:3001';
    this.program = new Command();
    this.setupCommands();
  }
  
  setupCommands() {
    this.program
      .name('poppo-health')
      .description('PoppoBuilder システムヘルスチェック管理')
      .version('1.0.0');
    
    // 現在の健全性チェック
    this.program
      .command('check')
      .description('現在のシステム健全性をチェック')
      .option('-d, --detailed', '詳細情報を表示')
      .option('-j, --json', 'JSON形式で出力')
      .action(async (options) => {
        await this.checkHealth(options);
      });
    
    // 診断レポート生成
    this.program
      .command('report')
      .description('診断レポートを生成')
      .option('-s, --save <file>', 'レポートをファイルに保存')
      .action(async (options) => {
        await this.generateReport(options);
      });
    
    // 履歴表示
    this.program
      .command('history')
      .description('ヘルスチェック履歴を表示')
      .option('-h, --hours <n>', '表示する時間数', '24')
      .option('-g, --graph', 'グラフ表示')
      .action(async (options) => {
        await this.showHistory(options);
      });
    
    // トレンド分析
    this.program
      .command('trends')
      .description('健全性トレンドを分析')
      .action(async () => {
        await this.analyzeTrends();
      });
    
    // メトリクス表示
    this.program
      .command('metrics')
      .description('Prometheus形式のメトリクスを表示')
      .action(async () => {
        await this.showMetrics();
      });
    
    // 準備状態チェック
    this.program
      .command('ready')
      .description('システムの準備状態をチェック')
      .action(async () => {
        await this.checkReadiness();
      });
  }
  
  /**
   * 現在の健全性チェック
   */
  async checkHealth(options) {
    try {
      const endpoint = options.detailed ? '/api/health/detailed' : '/api/health';
      const response = await axios.get(`${this.dashboardUrl}${endpoint}`);
      const health = response.data;
      
      if (options.json) {
        console.log(JSON.stringify(health, null, 2));
        return;
      }
      
      // 基本情報の表示
      console.log(chalk.bold('\n🏥 システム健全性チェック\n'));
      
      const statusColor = this.getStatusColor(health.status);
      console.log(`ステータス: ${chalk[statusColor](health.status.toUpperCase())}`);
      console.log(`スコア: ${this.formatScore(health.score)}`);
      console.log(`チェック時刻: ${health.timestamp}`);
      
      if (options.detailed && health.components) {
        console.log(chalk.bold('\n📊 コンポーネント別状態:\n'));
        
        const table = new Table({
          head: ['コンポーネント', 'ステータス', 'スコア', '備考'],
          colWidths: [20, 15, 10, 40]
        });
        
        for (const [name, data] of Object.entries(health.components)) {
          const status = data.status || 'unknown';
          const score = data.score || 0;
          const issues = data.details?.issues || [];
          
          table.push([
            name,
            chalk[this.getStatusColor(status)](status),
            this.formatScore(score),
            issues.length > 0 ? issues[0] : '正常'
          ]);
        }
        
        console.log(table.toString());
        
        // 問題の詳細表示
        const allIssues = Object.values(health.components)
          .flatMap(c => c.details?.issues || []);
        
        if (allIssues.length > 0) {
          console.log(chalk.bold('\n⚠️  検出された問題:\n'));
          allIssues.forEach((issue, i) => {
            console.log(`${i + 1}. ${issue}`);
          });
        }
      }
      
    } catch (error) {
      console.error(chalk.red('エラー:'), error.message);
      process.exit(1);
    }
  }
  
  /**
   * 診断レポート生成
   */
  async generateReport(options) {
    try {
      console.log(chalk.blue('診断レポートを生成中...\n'));
      
      const response = await axios.get(`${this.dashboardUrl}/api/health/diagnostic`);
      const report = response.data;
      
      // レポートの表示
      console.log(chalk.bold('📋 システム診断レポート\n'));
      console.log(`生成時刻: ${report.timestamp}`);
      console.log(`プラットフォーム: ${report.system.platform}`);
      console.log(`Node.js: ${report.system.nodeVersion}`);
      console.log(`稼働時間: ${this.formatUptime(report.system.uptime)}`);
      
      // 健全性サマリー
      console.log(chalk.bold('\n健全性サマリー:'));
      console.log(`現在のステータス: ${chalk[this.getStatusColor(report.health.status)](report.health.status)}`);
      console.log(`総合スコア: ${this.formatScore(report.health.score)}`);
      
      // トレンド情報
      if (report.trends) {
        console.log(chalk.bold('\nトレンド分析:'));
        console.log(`スコアの傾向: ${this.formatTrend(report.trends.score?.trend)}`);
        console.log(`変動性: ${report.trends.score?.volatility || 0}%`);
      }
      
      // 推奨事項
      if (report.recommendations && report.recommendations.length > 0) {
        console.log(chalk.bold('\n💡 推奨事項:'));
        report.recommendations.forEach((rec, i) => {
          console.log(`${i + 1}. ${rec}`);
        });
      }
      
      // ファイルに保存
      if (options.save) {
        const fs = require('fs').promises;
        await fs.writeFile(options.save, JSON.stringify(report, null, 2));
        console.log(chalk.green(`\n✅ レポートを ${options.save} に保存しました`));
      }
      
    } catch (error) {
      console.error(chalk.red('エラー:'), error.message);
      process.exit(1);
    }
  }
  
  /**
   * 履歴表示
   */
  async showHistory(options) {
    try {
      const hours = parseInt(options.hours);
      const response = await axios.get(`${this.dashboardUrl}/api/health/history?hours=${hours}`);
      const data = response.data;
      
      console.log(chalk.bold(`\n📈 過去${hours}時間のヘルスチェック履歴\n`));
      console.log(`データポイント数: ${data.dataPoints}`);
      
      if (data.history.length === 0) {
        console.log(chalk.yellow('履歴データがありません'));
        return;
      }
      
      if (options.graph) {
        // 簡易グラフ表示
        this.displayGraph(data.history);
      } else {
        // テーブル表示
        const table = new Table({
          head: ['時刻', 'ステータス', 'スコア', '期間'],
          colWidths: [25, 15, 10, 15]
        });
        
        // 最新10件を表示
        const recent = data.history.slice(-10);
        recent.forEach(record => {
          table.push([
            new Date(record.timestamp).toLocaleString('ja-JP'),
            chalk[this.getStatusColor(record.status)](record.status),
            this.formatScore(record.score),
            `${record.checkDuration || 0}ms`
          ]);
        });
        
        console.log(table.toString());
      }
      
      // サマリー統計
      const summary = await axios.get(`${this.dashboardUrl}/api/health/summary?hours=${hours}`);
      const stats = summary.data;
      
      console.log(chalk.bold('\n📊 統計サマリー:'));
      console.log(`最小スコア: ${stats.score?.min || 0}`);
      console.log(`最大スコア: ${stats.score?.max || 0}`);
      console.log(`平均スコア: ${stats.score?.average || 0}`);
      console.log(`可用性: ${stats.availability || 0}%`);
      
    } catch (error) {
      console.error(chalk.red('エラー:'), error.message);
      process.exit(1);
    }
  }
  
  /**
   * トレンド分析
   */
  async analyzeTrends() {
    try {
      const response = await axios.get(`${this.dashboardUrl}/api/health/trends`);
      const trends = response.data;
      
      console.log(chalk.bold('\n📊 健全性トレンド分析\n'));
      
      if (!trends.hasEnoughData) {
        console.log(chalk.yellow(trends.message));
        return;
      }
      
      // 総合スコアのトレンド
      console.log(chalk.bold('総合スコア:'));
      console.log(`現在: ${trends.score.current}`);
      console.log(`平均: ${trends.score.average}`);
      console.log(`傾向: ${this.formatTrend(trends.score.trend)}`);
      console.log(`変化率: ${trends.score.change > 0 ? '+' : ''}${trends.score.change}ポイント/10データ`);
      console.log(`変動性: ${trends.score.volatility}%`);
      
      // コンポーネント別トレンド
      if (Object.keys(trends.components).length > 0) {
        console.log(chalk.bold('\nコンポーネント別:'));
        
        const table = new Table({
          head: ['コンポーネント', '現在', '平均', '傾向'],
          colWidths: [20, 10, 10, 15]
        });
        
        for (const [name, data] of Object.entries(trends.components)) {
          table.push([
            name,
            data.current,
            data.average,
            this.formatTrend(data.trend)
          ]);
        }
        
        console.log(table.toString());
      }
      
      // アラート
      if (trends.alerts && trends.alerts.length > 0) {
        console.log(chalk.bold('\n⚠️  アラート:'));
        trends.alerts.forEach((alert, i) => {
          console.log(`${i + 1}. ${alert.message}`);
        });
      }
      
    } catch (error) {
      console.error(chalk.red('エラー:'), error.message);
      process.exit(1);
    }
  }
  
  /**
   * メトリクス表示
   */
  async showMetrics() {
    try {
      const response = await axios.get(`${this.dashboardUrl}/api/health/metrics`);
      console.log(response.data);
    } catch (error) {
      console.error(chalk.red('エラー:'), error.message);
      process.exit(1);
    }
  }
  
  /**
   * 準備状態チェック
   */
  async checkReadiness() {
    try {
      const response = await axios.get(`${this.dashboardUrl}/api/health/ready`);
      const readiness = response.data;
      
      console.log(chalk.bold('\n🚦 システム準備状態\n'));
      
      const readyStatus = readiness.ready 
        ? chalk.green('✅ 準備完了')
        : chalk.red('❌ 準備未完了');
      
      console.log(`ステータス: ${readyStatus}`);
      console.log(`チェック時刻: ${readiness.timestamp}`);
      
      if (readiness.checks) {
        console.log(chalk.bold('\nチェック項目:'));
        
        for (const [check, result] of Object.entries(readiness.checks)) {
          const status = result ? chalk.green('✓') : chalk.red('✗');
          console.log(`${status} ${check}`);
        }
      }
      
      process.exit(readiness.ready ? 0 : 1);
      
    } catch (error) {
      console.error(chalk.red('エラー:'), error.message);
      process.exit(1);
    }
  }
  
  /**
   * 簡易グラフ表示
   */
  displayGraph(history) {
    const width = 60;
    const height = 10;
    
    // スコアの正規化
    const scores = history.map(h => h.score || 0);
    const maxScore = 100;
    
    console.log(chalk.bold('スコア推移グラフ:'));
    console.log('100 ┤');
    
    // グラフの描画
    for (let i = height - 1; i >= 0; i--) {
      const threshold = (i / height) * maxScore;
      let line = String(Math.round(threshold)).padStart(3) + ' ┤';
      
      for (let j = 0; j < Math.min(scores.length, width); j++) {
        const index = Math.floor((j / width) * scores.length);
        const score = scores[index];
        
        if (score >= threshold && score >= threshold - (maxScore / height)) {
          line += '█';
        } else {
          line += ' ';
        }
      }
      
      console.log(line);
    }
    
    console.log('  0 └' + '─'.repeat(width));
    console.log('    ' + ' '.repeat(Math.floor(width / 2 - 3)) + '時間→');
  }
  
  /**
   * ステータスカラーの取得
   */
  getStatusColor(status) {
    const colors = {
      healthy: 'green',
      degraded: 'yellow',
      unhealthy: 'red',
      error: 'red',
      unknown: 'gray'
    };
    return colors[status] || 'white';
  }
  
  /**
   * スコアのフォーマット
   */
  formatScore(score) {
    if (score >= 80) {
      return chalk.green(`${score}/100`);
    } else if (score >= 60) {
      return chalk.yellow(`${score}/100`);
    } else {
      return chalk.red(`${score}/100`);
    }
  }
  
  /**
   * トレンドのフォーマット
   */
  formatTrend(trend) {
    const formats = {
      improving: chalk.green('↗ 改善中'),
      stable: chalk.blue('→ 安定'),
      declining: chalk.red('↘ 低下中')
    };
    return formats[trend] || trend;
  }
  
  /**
   * 稼働時間のフォーマット
   */
  formatUptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    const parts = [];
    if (days > 0) parts.push(`${days}日`);
    if (hours > 0) parts.push(`${hours}時間`);
    if (minutes > 0) parts.push(`${minutes}分`);
    
    return parts.join(' ') || '0分';
  }
  
  run() {
    this.program.parse(process.argv);
  }
}

// CLIの実行
const cli = new HealthCLI();
cli.run();