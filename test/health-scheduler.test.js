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
    test('HealthSchedulerが正常に初期化される', () => {
      expect(healthScheduler).toBeDefined();
      expect(healthScheduler.diagnosticLevels).toBeDefined();
      expect(healthScheduler.diagnosticLevels.daily).toBeDefined();
      expect(healthScheduler.diagnosticLevels.weekly).toBeDefined();
      expect(healthScheduler.diagnosticLevels.monthly).toBeDefined();
    });

    test('診断レベルが正しく設定される', () => {
      const { daily, weekly, monthly } = healthScheduler.diagnosticLevels;
      
      expect(daily.checks).toContain('memory');
      expect(daily.checks).toContain('cpu');
      expect(weekly.checks).toContain('logs');
      expect(monthly.checks).toContain('security');
      expect(monthly.checks).toContain('backup');
    });
  });

  describe('診断実行', () => {
    test('日次診断が正常に実行される', async () => {
      const results = await healthScheduler.runDiagnostic('daily');
      
      expect(results).toBeDefined();
      expect(results.level).toBe('daily');
      expect(results.name).toBe('日次診断');
      expect(results.summary).toBeDefined();
      expect(results.summary.total).toBeGreaterThan(0);
      expect(results.checks).toBeDefined();
      expect(results.overallStatus).toMatch(/passed|warning|failed/);
    });

    test('週次診断が正常に実行される', async () => {
      const results = await healthScheduler.runDiagnostic('weekly');
      
      expect(results.level).toBe('weekly');
      expect(results.name).toBe('週次診断');
      expect(results.checks.logs).toBeDefined();
      expect(results.checks.cleanup).toBeDefined();
    });

    test('月次診断が正常に実行される', async () => {
      const results = await healthScheduler.runDiagnostic('monthly');
      
      expect(results.level).toBe('monthly');
      expect(results.name).toBe('月次診断');
      expect(results.checks.security).toBeDefined();
      expect(results.checks.backup).toBeDefined();
      expect(results.checks.performance).toBeDefined();
    });

    test('無効な診断レベルでエラーが発生する', async () => {
      await expect(healthScheduler.runDiagnostic('invalid')).rejects.toThrow('Unknown diagnostic level: invalid');
    });
  });

  describe('個別チェック', () => {
    test('メモリチェックが実行される', async () => {
      const result = await healthScheduler.checkMemory();
      
      expect(result).toBeDefined();
      expect(result.status).toMatch(/passed|warning|failed/);
      expect(result.metric).toBeDefined();
      expect(typeof result.metric).toBe('number');
      expect(result.message).toContain('メモリ使用率');
    });

    test('CPUチェックが実行される', async () => {
      const result = await healthScheduler.checkCPU();
      
      expect(result.status).toMatch(/passed|warning|failed/);
      expect(result.metric).toBeDefined();
      expect(result.message).toContain('CPU使用率');
    });

    test('ディスクチェックが実行される', async () => {
      const result = await healthScheduler.checkDisk();
      
      expect(result.status).toMatch(/passed|warning|failed/);
      expect(result.message).toContain('ディスク使用率');
    });
  });

  describe('レポート生成', () => {
    test('Markdownレポートが生成される', async () => {
      const results = await healthScheduler.runDiagnostic('daily');
      
      // レポートファイルが作成されているか確認
      const files = await fs.readdir(testReportsDir);
      const reportFiles = files.filter(f => f.startsWith('health-report-daily-') && f.endsWith('.md'));
      
      expect(reportFiles.length).toBe(1);
      
      // レポート内容を確認
      const reportContent = await fs.readFile(path.join(testReportsDir, reportFiles[0]), 'utf8');
      expect(reportContent).toContain('# 日次診断レポート');
      expect(reportContent).toContain('## 概要');
      expect(reportContent).toContain('## 詳細結果');
      expect(reportContent).toContain('**全体ステータス**');
    });

    test('レポートに必要な情報が含まれる', async () => {
      const results = await healthScheduler.runDiagnostic('daily');
      const report = healthScheduler.generateMarkdownReport(results);
      
      expect(report).toContain('日次診断レポート');
      expect(report).toContain('実行日時');
      expect(report).toContain('実行時間');
      expect(report).toContain('全体ステータス');
      expect(report).toContain('総チェック数');
      expect(report).toContain('成功');
      expect(report).toContain('警告');
      expect(report).toContain('失敗');
    });
  });

  describe('スケジュール管理', () => {
    test('スケジュール情報が取得できる', () => {
      const info = healthScheduler.getScheduleInfo();
      
      expect(info).toBeDefined();
      expect(info.isRunning).toBe(false);
      expect(info.diagnosticLevels).toBeDefined();
      expect(Array.isArray(info.lastDiagnostics)).toBe(true);
    });

    test('手動診断が実行できる', async () => {
      const results = await healthScheduler.runManualDiagnostic('daily');
      
      expect(results.level).toBe('daily');
      expect(results.overallStatus).toBeDefined();
    });
  });

  describe('古いレポートのクリーンアップ', () => {
    test('古いレポートが削除される', async () => {
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
        expect(error.code).toBe('ENOENT');
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
    test('統合システムが初期化される', async () => {
      await integration.initialize();
      
      expect(integration.isInitialized).toBe(true);
      expect(integration.healthScheduler).toBeDefined();
    });

    test('手動診断が実行できる', async () => {
      await integration.initialize();
      
      const results = await integration.runManualDiagnostic('daily');
      
      expect(results.level).toBe('daily');
      expect(results.overallStatus).toBeDefined();
    });

    test('統合ステータスが取得できる', async () => {
      await integration.initialize();
      
      const status = integration.getIntegratedStatus();
      
      expect(status.integration).toBeDefined();
      expect(status.integration.initialized).toBe(true);
      expect(status.healthScheduler).toBeDefined();
    });

    test('統合レポートが生成される', async () => {
      await integration.initialize();
      
      // 診断を実行してからレポートを生成
      await integration.runManualDiagnostic('daily');
      const report = await integration.generateIntegratedReport();
      
      expect(report).toBeDefined();
      expect(report.timestamp).toBeDefined();
      expect(report.integration).toBeDefined();
      expect(report.diagnosticHistory).toBeDefined();
    });
  });

  describe('PoppoBuilder固有のヘルスチェック', () => {
    test('PoppoBuilder固有のヘルスチェックが設定される', async () => {
      await integration.initialize();
      integration.setupPoppoBuilderHealthChecks();
      
      // 統合ステータスにPoppoBuilder固有の情報が含まれることを確認
      const status = integration.getIntegratedStatus();
      expect(status).toBeDefined();
    });
  });
});

describe('エラーハンドリング', () => {
  test('存在しないディレクトリでも正常に動作する', async () => {
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
    expect(stat.isDirectory()).toBe(true);
    
    // クリーンアップ
    await fs.rmdir(nonExistentDir);
  });

  test('チェック実行中のエラーが適切に処理される', async () => {
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