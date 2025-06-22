const { expect } = require('chai');
const sinon = require('sinon');
/**
 * Health Scheduler Tests - Issue #128
 * システムヘルスチェックの自動化のテスト
 */

const HealthScheduler = require('../lib/monitoring/health-scheduler');
const HealthSchedulerIntegration = require('../lib/monitoring/health-scheduler-integration');
const { MonitoringManager } = require('../lib/monitoring/monitoring-manager');
const fs = require('fs').promises;
const path = require('path');

describe('Health Scheduler', () => {
  let healthScheduler;
  let testReportsDir;
  let sandbox;

  beforeEach(async () => {
    // テスト用のレポートディレクトリを作成
    testReportsDir = './test-reports-' + Date.now();
    await fs.mkdir(testReportsDir, { recursive: true });
    
    healthScheduler = new HealthScheduler({
      reportsDir: testReportsDir,
      retentionDays: 1,
      // テスト用に短い間隔に設定
      dailyCheck: null,    // cronを無効化
      weeklyCheck: null,
      monthlyCheck: null
    });
    
    await healthScheduler.initialize();
  });

  afterEach(async () => {
    if (healthScheduler && healthScheduler.isRunning) {
      healthScheduler.stop();
    }
    
    // テスト用ディレクトリをクリーンアップ
    try {
      const files = await fs.readdir(testReportsDir);
      for (const file of files) {
        await fs.unlink(path.join(testReportsDir, file));
      }
      await fs.rmdir(testReportsDir);
    } catch (error) {
      // ディレクトリが存在しない場合は無視
    }
  });

  describe('初期化', () => {
    it('HealthSchedulerが正常に初期化される', () => {
      expect(healthScheduler).to.exist;
      expect(healthScheduler.diagnosticLevels).to.exist;
      expect(healthScheduler.diagnosticLevels.daily).to.exist;
      expect(healthScheduler.diagnosticLevels.weekly).to.exist;
      expect(healthScheduler.diagnosticLevels.monthly).to.exist;
    });

    it('診断レベルが正しく設定される', () => {
      const { daily, weekly, monthly } = healthScheduler.diagnosticLevels;
      
      expect(daily.checks).to.include('memory');
      expect(daily.checks).to.include('cpu');
      expect(weekly.checks).to.include('logs');
      expect(monthly.checks).to.include('security');
      expect(monthly.checks).to.include('backup');
    });
  });

  describe('診断実行', () => {
    it('日次診断が正常に実行される', async () => {
      const results = await healthScheduler.runDiagnostic('daily');
      
      expect(results).to.exist;
      expect(results.level).to.equal('daily');
      expect(results.name).to.equal('日次診断');
      expect(results.summary).to.exist;
      expect(results.summary.total).to.be.greaterThan(0);
      expect(results.checks).to.exist;
      expect(results.overallStatus).to.match(/passed|warning|failed/);
    });

    it('週次診断が正常に実行される', async () => {
      const results = await healthScheduler.runDiagnostic('weekly');
      
      expect(results.level).to.equal('weekly');
      expect(results.name).to.equal('週次診断');
      expect(results.checks.logs).to.exist;
      expect(results.checks.cleanup).to.exist;
    });

    it('月次診断が正常に実行される', async () => {
      const results = await healthScheduler.runDiagnostic('monthly');
      
      expect(results.level).to.equal('monthly');
      expect(results.name).to.equal('月次診断');
      expect(results.checks.security).to.exist;
      expect(results.checks.backup).to.exist;
      expect(results.checks.performance).to.exist;
    });

    it('無効な診断レベルでエラーが発生する', async () => {
      await expect(healthScheduler.runDiagnostic('invalid')).rejects.toThrow('Unknown diagnostic level: invalid');
    });
  });

  describe('個別チェック', () => {
    it('メモリチェックが実行される', async () => {
      const result = await healthScheduler.checkMemory();
      
      expect(result).to.exist;
      expect(result.status).to.match(/passed|warning|failed/);
      expect(result.metric).to.exist;
      expect(typeof result.metric).to.equal('number');
      expect(result.message).to.include('メモリ使用率');
    });

    it('CPUチェックが実行される', async () => {
      const result = await healthScheduler.checkCPU();
      
      expect(result.status).to.match(/passed|warning|failed/);
      expect(result.metric).to.exist;
      expect(result.message).to.include('CPU使用率');
    });

    it('ディスクチェックが実行される', async () => {
      const result = await healthScheduler.checkDisk();
      
      expect(result.status).to.match(/passed|warning|failed/);
      expect(result.message).to.include('ディスク使用率');
    });
  });

  describe('レポート生成', () => {
    it('Markdownレポートが生成される', async () => {
      const results = await healthScheduler.runDiagnostic('daily');
      
      // レポートファイルが作成されているか確認
      const files = await fs.readdir(testReportsDir);
      const reportFiles = files.filter(f => f.startsWith('health-report-daily-') && f.endsWith('.md'));
      
      expect(reportFiles.length).to.equal(1);
      
      // レポート内容を確認
      const reportContent = await fs.readFile(path.join(testReportsDir, reportFiles[0]), 'utf8');
      expect(reportContent).to.include('# 日次診断レポート');
      expect(reportContent).to.include('## 概要');
      expect(reportContent).to.include('## 詳細結果');
      expect(reportContent).to.include('**全体ステータス**');
    });

    it('レポートに必要な情報が含まれる', async () => {
      const results = await healthScheduler.runDiagnostic('daily');
      const report = healthScheduler.generateMarkdownReport(results);
      
      expect(report).to.include('日次診断レポート');
      expect(report).to.include('実行日時');
      expect(report).to.include('実行時間');
      expect(report).to.include('全体ステータス');
      expect(report).to.include('総チェック数');
      expect(report).to.include('成功');
      expect(report).to.include('警告');
      expect(report).to.include('失敗');
    });
  });

  describe('スケジュール管理', () => {
    it('スケジュール情報が取得できる', () => {
      const info = healthScheduler.getScheduleInfo();
      
      expect(info).to.exist;
      expect(info.isRunning).to.equal(false);
      expect(info.diagnosticLevels).to.exist;
      expect(Array.isArray(info.lastDiagnostics)).to.equal(true);
    });

    it('手動診断が実行できる', async () => {
      const results = await healthScheduler.runManualDiagnostic('daily');
      
      expect(results.level).to.equal('daily');
      expect(results.overallStatus).to.exist;
    });
  });

  describe('古いレポートのクリーンアップ', () => {
    it('古いレポートが削除される', async () => {
      // 古い日付のテストファイルを作成
      const oldFile = path.join(testReportsDir, 'old-report.md');
      await fs.writeFile(oldFile, 'test content');
      
      // ファイルの更新日時を古い日付に変更
      const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000); // 3日前
      await fs.utimes(oldFile, oldDate, oldDate);
      
      // クリーンアップを実行
      await healthScheduler.cleanupOldReports();
      
      // ファイルが削除されているか確認
      try {
        await fs.access(oldFile);
        fail('Old file should have been deleted');
      } catch (error) {
        expect(error.code).to.equal('ENOENT');
      }
    });
  });
});

describe('Health Scheduler Integration', () => {
  let integration;
  let testReportsDir;

  beforeEach(async () => {
    testReportsDir = './test-integration-reports-' + Date.now();
    await fs.mkdir(testReportsDir, { recursive: true });
    
    integration = new HealthSchedulerIntegration({
      enableHealthScheduler: true,
      enableMonitoringManager: false, // テストではMonitoringManagerを無効化
      healthScheduler: {
        reportsDir: testReportsDir,
        retentionDays: 1,
        dailyCheck: null,
        weeklyCheck: null,
        monthlyCheck: null
      }
    });
  });

  afterEach(async () => {
    if (integration && integration.isRunning) {
      await integration.stop();
    }
    
    // テスト用ディレクトリをクリーンアップ
    try {
      const files = await fs.readdir(testReportsDir);
      for (const file of files) {
        await fs.unlink(path.join(testReportsDir, file));
      }
      await fs.rmdir(testReportsDir);
    } catch (error) {
      // ディレクトリが存在しない場合は無視
    }
  });

  describe('統合システム', () => {
    it('統合システムが初期化される', async () => {
      await integration.initialize();
      
      expect(integration.isInitialized).to.equal(true);
      expect(integration.healthScheduler).to.exist;
    });

    it('手動診断が実行できる', async () => {
      await integration.initialize();
      
      const results = await integration.runManualDiagnostic('daily');
      
      expect(results.level).to.equal('daily');
      expect(results.overallStatus).to.exist;
    });

    it('統合ステータスが取得できる', async () => {
      await integration.initialize();
      
      const status = integration.getIntegratedStatus();
      
      expect(status.integration).to.exist;
      expect(status.integration.initialized).to.equal(true);
      expect(status.healthScheduler).to.exist;
    });

    it('統合レポートが生成される', async () => {
      await integration.initialize();
      
      // 診断を実行してからレポートを生成
      await integration.runManualDiagnostic('daily');
      const report = await integration.generateIntegratedReport();
      
      expect(report).to.exist;
      expect(report.timestamp).to.exist;
      expect(report.integration).to.exist;
      expect(report.diagnosticHistory).to.exist;
    });
  });

  describe('PoppoBuilder固有のヘルスチェック', () => {
    it('PoppoBuilder固有のヘルスチェックが設定される', async () => {
      await integration.initialize();
      integration.setupPoppoBuilderHealthChecks();
      
      // 統合ステータスにPoppoBuilder固有の情報が含まれることを確認
      const status = integration.getIntegratedStatus();
      expect(status).to.exist;
    });
  });
});

describe('エラーハンドリング', () => {
  it('存在しないディレクトリでも正常に動作する', async () => {
    const nonExistentDir = './non-existent-dir-' + Date.now();
    
    const scheduler = new HealthScheduler({
      reportsDir: nonExistentDir,
      dailyCheck: null,
      weeklyCheck: null,
      monthlyCheck: null
    });
    
    await scheduler.initialize();
    
    // レポートディレクトリが作成されることを確認
    const stat = await fs.stat(nonExistentDir);
    expect(stat.isDirectory()).to.equal(true);
    
    // クリーンアップ
    await fs.rmdir(nonExistentDir);
  });

  it('チェック実行中のエラーが適切に処理される', async () => {
    const scheduler = new HealthScheduler({
      reportsDir: './test-error-reports-' + Date.now(),
      dailyCheck: null,
      weeklyCheck: null,
      monthlyCheck: null
    });
    
    await scheduler.initialize();
    
    // 存在しないチェック名でエラーが発生することを確認
    await expect(scheduler.executeCheck('nonexistent')).rejects.toThrow('Unknown check: nonexistent');
  });
});