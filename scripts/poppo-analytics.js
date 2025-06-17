#!/usr/bin/env node

const DatabaseManager = require('../src/database-manager');
const fs = require('fs');
const path = require('path');

/**
 * PoppoBuilder アナリティクスCLI
 * プロセス実行履歴の分析・レポート生成
 */
class PoppoAnalyticsCLI {
  constructor() {
    this.db = new DatabaseManager();
    this.args = process.argv.slice(2);
    this.command = this.args[0];
  }
  
  run() {
    switch (this.command) {
      case 'report':
        this.generateReport();
        break;
      case 'summary':
        this.generateSummary();
        break;
      case 'archive':
        this.archiveData();
        break;
      case 'stats':
        this.showStatistics();
        break;
      case 'trends':
        this.showTrends();
        break;
      case 'help':
      default:
        this.showHelp();
    }
  }
  
  showHelp() {
    console.log(`
🔍 PoppoBuilder Analytics CLI

使用方法:
  poppo-analytics <command> [options]

コマンド:
  report [period]     レポートを生成 (daily/weekly/monthly)
  summary            パフォーマンスサマリーを表示
  stats [taskType]   タスクタイプ別の統計を表示
  trends [taskType]  パフォーマンストレンドを表示
  archive [days]     古いデータをアーカイブ (デフォルト: 30日)
  help               このヘルプを表示

例:
  poppo-analytics report daily
  poppo-analytics stats claude-cli
  poppo-analytics archive 60
`);
  }
  
  async generateReport() {
    const periodType = this.args[1] || 'daily';
    console.log(`📊 ${periodType}レポートを生成中...`);
    
    try {
      // サマリーを生成
      const summaries = this.db.generatePerformanceSummary(periodType);
      
      // レポートファイル名
      const reportName = `report-${periodType}-${new Date().toISOString().split('T')[0]}.json`;
      const reportPath = path.join(process.cwd(), 'reports', reportName);
      
      // reportsディレクトリを作成
      const reportsDir = path.dirname(reportPath);
      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }
      
      // レポートデータを作成
      const report = {
        generatedAt: new Date().toISOString(),
        periodType,
        summaries,
        systemStats: this.getSystemStats()
      };
      
      // ファイルに保存
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
      
      console.log(`✅ レポートを生成しました: ${reportPath}`);
      
      // コンソールにサマリーを表示
      this.displaySummaries(summaries);
      
    } catch (error) {
      console.error('❌ レポート生成エラー:', error.message);
      process.exit(1);
    }
  }
  
  async generateSummary() {
    console.log('📈 パフォーマンスサマリー\n');
    
    try {
      const taskTypes = ['claude-cli', 'issue-process', 'comment-process'];
      
      for (const taskType of taskTypes) {
        const stats = this.db.getTaskTypeStatistics(taskType);
        
        if (stats.total_count > 0) {
          console.log(`\n【${taskType}】`);
          console.log(`  総実行数: ${stats.total_count}`);
          console.log(`  成功率: ${(stats.success_count / stats.total_count * 100).toFixed(1)}%`);
          console.log(`  平均実行時間: ${this.formatDuration(stats.avg_duration)}`);
          console.log(`  最短/最長: ${this.formatDuration(stats.min_duration)} / ${this.formatDuration(stats.max_duration)}`);
          console.log(`  平均メモリ: ${Math.round(stats.avg_memory || 0)} MB`);
        }
      }
    } catch (error) {
      console.error('❌ サマリー生成エラー:', error.message);
      process.exit(1);
    }
  }
  
  async showStatistics() {
    const taskType = this.args[1];
    
    if (!taskType) {
      console.error('❌ タスクタイプを指定してください');
      this.showHelp();
      process.exit(1);
    }
    
    try {
      const stats = this.db.getTaskTypeStatistics(taskType);
      
      if (stats.total_count === 0) {
        console.log(`⚠️  ${taskType} の実行履歴がありません`);
        return;
      }
      
      console.log(`\n📊 ${taskType} の統計情報\n`);
      console.log(`総実行数: ${stats.total_count}`);
      console.log(`成功数: ${stats.success_count} (${(stats.success_count / stats.total_count * 100).toFixed(1)}%)`);
      console.log(`失敗数: ${stats.failure_count} (${(stats.failure_count / stats.total_count * 100).toFixed(1)}%)`);
      console.log(`\n実行時間:`);
      console.log(`  平均: ${this.formatDuration(stats.avg_duration)}`);
      console.log(`  最短: ${this.formatDuration(stats.min_duration)}`);
      console.log(`  最長: ${this.formatDuration(stats.max_duration)}`);
      console.log(`\nリソース使用量:`);
      console.log(`  平均CPU: ${(stats.avg_cpu || 0).toFixed(1)}%`);
      console.log(`  平均メモリ: ${Math.round(stats.avg_memory || 0)} MB`);
      
    } catch (error) {
      console.error('❌ 統計取得エラー:', error.message);
      process.exit(1);
    }
  }
  
  async showTrends() {
    const taskType = this.args[1] || 'claude-cli';
    const days = parseInt(this.args[2]) || 7;
    
    console.log(`\n📈 ${taskType} のトレンド (過去${days}日間)\n`);
    
    try {
      const trends = this.db.getPerformanceTrends(taskType, 'duration_ms', days);
      
      if (trends.length === 0) {
        console.log('⚠️  データがありません');
        return;
      }
      
      console.log('日付         | 実行数 | 平均時間    | 最短〜最長');
      console.log('-------------|--------|-------------|-------------');
      
      trends.forEach(trend => {
        console.log(
          `${trend.date} | ${String(trend.count).padStart(6)} | ` +
          `${this.formatDuration(trend.avg_value).padEnd(11)} | ` +
          `${this.formatDuration(trend.min_value)} 〜 ${this.formatDuration(trend.max_value)}`
        );
      });
      
    } catch (error) {
      console.error('❌ トレンド取得エラー:', error.message);
      process.exit(1);
    }
  }
  
  async archiveData() {
    const daysToKeep = parseInt(this.args[1]) || 30;
    
    console.log(`🗄️  ${daysToKeep}日より古いデータをアーカイブ中...`);
    
    try {
      const result = this.db.archiveOldData(daysToKeep);
      
      if (result.archived === 0) {
        console.log('✅ アーカイブ対象のデータはありませんでした');
      } else {
        console.log(`✅ ${result.archived}件のデータをアーカイブしました`);
        console.log(`📁 アーカイブファイル: ${result.file}`);
      }
      
    } catch (error) {
      console.error('❌ アーカイブエラー:', error.message);
      process.exit(1);
    }
  }
  
  displaySummaries(summaries) {
    console.log('\n📊 パフォーマンスサマリー:');
    
    summaries.forEach(summary => {
      console.log(`\n【${summary.task_type}】`);
      console.log(`  実行数: ${summary.total_count}`);
      console.log(`  成功率: ${(summary.success_count / summary.total_count * 100).toFixed(1)}%`);
      console.log(`  平均実行時間: ${this.formatDuration(summary.avg_duration)}`);
    });
  }
  
  getSystemStats() {
    const allTaskTypes = ['claude-cli', 'issue-process', 'comment-process'];
    const stats = {};
    
    allTaskTypes.forEach(taskType => {
      stats[taskType] = this.db.getTaskTypeStatistics(taskType);
    });
    
    return stats;
  }
  
  formatDuration(ms) {
    if (!ms) return '-';
    
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) {
      return `${seconds}秒`;
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    if (minutes < 60) {
      return `${minutes}分${remainingSeconds}秒`;
    }
    
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return `${hours}時間${remainingMinutes}分`;
  }
  
  cleanup() {
    if (this.db) {
      this.db.close();
    }
  }
}

// 実行
const cli = new PoppoAnalyticsCLI();
cli.run();

// 終了時のクリーンアップ
process.on('exit', () => {
  cli.cleanup();
});

process.on('SIGINT', () => {
  cli.cleanup();
  process.exit(0);
});