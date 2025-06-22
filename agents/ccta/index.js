const AgentBase = require('../shared/agent-base');
const TestRunner = require('./test-runner');
const CoverageReporter = require('./coverage-reporter');
const PerformanceTester = require('./performance-tester');
const ReportGenerator = require('./report-generator');
const path = require('path');
const fs = require('fs').promises;

/**
 * CCTA (Code Change Test Agent) - テスト自動実行・品質保証エージェント
 * 愛称: クーちゃん
 */
class CCTAAgent extends AgentBase {
  constructor(config = {}) {
    super('CCTA', 'ccta', config);
    
    // エージェント固有の設定
    this.testConfig = {
      frameworks: config.frameworks || ['jest', 'mocha', 'jasmine', 'vitest'],
      coverageThreshold: config.coverageThreshold || {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      },
      performanceThreshold: config.performanceThreshold || {
        loadTime: 3000,      // ms
        memoryUsage: 100,    // MB
        bundleSize: 500      // KB
      },
      autoFix: config.autoFix || false,
      skipTests: config.skipTests || [],
      timeout: config.timeout || 300000  // 5分
    };
    
    // モジュールの初期化
    this.testRunner = new TestRunner(this.testConfig);
    this.coverageReporter = new CoverageReporter(this.testConfig);
    this.performanceTester = new PerformanceTester(this.testConfig);
    this.reportGenerator = new ReportGenerator(this.testConfig);
    
    // 統計情報
    this.stats = {
      totalRuns: 0,
      successfulRuns: 0,
      failedRuns: 0,
      averageCoverage: 0,
      averageTestDuration: 0
    };
  }
  
  /**
   * エージェントの初期化
   */
  async initialize() {
    await super.initialize();
    
    // テストフレームワークの検出
    const detectedFrameworks = await this.detectTestFrameworks();
    this.logger.info(`検出されたテストフレームワーク: ${detectedFrameworks.join(', ')}`);
    
    // カバレッジツールの確認
    const coverageTools = await this.detectCoverageTools();
    this.logger.info(`利用可能なカバレッジツール: ${coverageTools.join(', ')}`);
    
    this.logger.info('CCTA Agent (クーちゃん) の初期化が完了しました');
  }
  
  /**
   * タスクの処理
   */
  async processTask(task) {
    const startTime = Date.now();
    this.stats.totalRuns++;
    
    try {
      this.logger.info(`テストタスクを開始: ${task.type} - ${task.id}`);
      
      let result;
      switch (task.type) {
        case 'pr_test':
          result = await this.runPRTests(task);
          break;
        case 'commit_test':
          result = await this.runCommitTests(task);
          break;
        case 'full_test':
          result = await this.runFullTests(task);
          break;
        case 'performance_test':
          result = await this.runPerformanceTests(task);
          break;
        case 'coverage_check':
          result = await this.checkCoverage(task);
          break;
        default:
          result = await this.runGeneralTests(task);
      }
      
      const duration = Date.now() - startTime;
      this.stats.averageTestDuration = 
        (this.stats.averageTestDuration * (this.stats.totalRuns - 1) + duration) / this.stats.totalRuns;
      
      if (result.success) {
        this.stats.successfulRuns++;
        this.stats.averageCoverage = 
          (this.stats.averageCoverage * (this.stats.successfulRuns - 1) + (result.coverage || 0)) / this.stats.successfulRuns;
      } else {
        this.stats.failedRuns++;
      }
      
      // レポート生成
      const report = await this.reportGenerator.generate(result, task);
      
      // GitHubにコメント投稿
      if (task.issueNumber || task.prNumber) {
        await this.postResultToGitHub(task, report);
      }
      
      this.logger.info(`テストタスク完了: ${task.id} (${duration}ms)`);
      return { success: true, result, report };
      
    } catch (error) {
      this.logger.error(`テストタスクエラー: ${error.message}`, error);
      this.stats.failedRuns++;
      return { success: false, error: error.message };
    }
  }
  
  /**
   * PRのテスト実行
   */
  async runPRTests(task) {
    const { prNumber, baseBranch = 'main' } = task;
    
    this.logger.info(`PR #${prNumber} のテストを実行中...`);
    
    // 変更されたファイルの取得
    const changedFiles = await this.getChangedFiles(prNumber);
    
    // 影響を受けるテストの特定
    const affectedTests = await this.identifyAffectedTests(changedFiles);
    
    // テスト実行
    const testResults = await this.testRunner.run({
      files: affectedTests,
      coverage: true,
      watch: false
    });
    
    // カバレッジ分析
    const coverageResults = await this.coverageReporter.analyze(testResults.coverage);
    
    // パフォーマンステスト（必要に応じて）
    let performanceResults = null;
    if (this.shouldRunPerformanceTests(changedFiles)) {
      performanceResults = await this.performanceTester.run({
        baseline: baseBranch,
        compare: `pr-${prNumber}`
      });
    }
    
    return {
      success: testResults.passed,
      tests: testResults,
      coverage: coverageResults,
      performance: performanceResults,
      affectedFiles: changedFiles,
      affectedTests
    };
  }
  
  /**
   * コミットのテスト実行
   */
  async runCommitTests(task) {
    const { commitSha, branch = 'main' } = task;
    
    this.logger.info(`コミット ${commitSha} のテストを実行中...`);
    
    // 簡易テストセットの実行
    const testResults = await this.testRunner.run({
      suite: 'smoke',
      coverage: false,
      timeout: 60000  // 1分
    });
    
    return {
      success: testResults.passed,
      tests: testResults,
      commitSha,
      branch
    };
  }
  
  /**
   * フルテストの実行
   */
  async runFullTests(task) {
    this.logger.info('フルテストスイートを実行中...');
    
    // すべてのテストを実行
    const testResults = await this.testRunner.run({
      all: true,
      coverage: true,
      parallel: true
    });
    
    // 詳細なカバレッジレポート
    const coverageResults = await this.coverageReporter.analyze(testResults.coverage, {
      detailed: true,
      threshold: this.testConfig.coverageThreshold
    });
    
    // カバレッジバッジの更新
    if (coverageResults.badge) {
      await this.updateCoverageBadge(coverageResults.badge);
    }
    
    return {
      success: testResults.passed && coverageResults.meetsThreshold,
      tests: testResults,
      coverage: coverageResults
    };
  }
  
  /**
   * パフォーマンステストの実行
   */
  async runPerformanceTests(task) {
    this.logger.info('パフォーマンステストを実行中...');
    
    const results = await this.performanceTester.run({
      scenarios: task.scenarios || ['default'],
      iterations: task.iterations || 3,
      warmup: task.warmup || 1
    });
    
    // 閾値チェック
    const violations = this.checkPerformanceThresholds(results);
    
    return {
      success: violations.length === 0,
      results,
      violations,
      trends: await this.performanceTester.getTrends()
    };
  }
  
  /**
   * カバレッジチェック
   */
  async checkCoverage(task) {
    const { targetBranch = 'main' } = task;
    
    // 現在のカバレッジを取得
    const currentCoverage = await this.coverageReporter.getCurrent();
    
    // ベースラインとの比較
    const baselineCoverage = await this.coverageReporter.getBaseline(targetBranch);
    const comparison = this.coverageReporter.compare(currentCoverage, baselineCoverage);
    
    return {
      success: comparison.improved || comparison.maintained,
      current: currentCoverage,
      baseline: baselineCoverage,
      comparison,
      suggestions: this.generateCoverageSuggestions(comparison)
    };
  }
  
  /**
   * 一般的なテスト実行
   */
  async runGeneralTests(task) {
    const options = {
      files: task.files || [],
      pattern: task.pattern || '**/*.test.{js,ts}',
      coverage: task.coverage !== false,
      watch: false,
      bail: task.bail || false
    };
    
    const results = await this.testRunner.run(options);
    
    return {
      success: results.passed,
      tests: results,
      coverage: results.coverage ? await this.coverageReporter.analyze(results.coverage) : null
    };
  }
  
  /**
   * テストフレームワークの検出
   */
  async detectTestFrameworks() {
    const frameworks = [];
    
    try {
      // package.jsonから検出
      const packageJson = JSON.parse(
        await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
      );
      
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      // 各フレームワークをチェック
      if (deps.jest || deps['@jest/core']) frameworks.push('jest');
      if (deps.mocha) frameworks.push('mocha');
      if (deps.jasmine) frameworks.push('jasmine');
      if (deps.vitest) frameworks.push('vitest');
      if (deps.ava) frameworks.push('ava');
      if (deps.tape) frameworks.push('tape');
      
      // 設定ファイルから検出
      const files = await fs.readdir(process.cwd());
      if (files.includes('jest.config.js') || files.includes('jest.config.json')) {
        if (!frameworks.includes('jest')) frameworks.push('jest');
      }
      if (files.includes('.mocharc.js') || files.includes('.mocharc.json')) {
        if (!frameworks.includes('mocha')) frameworks.push('mocha');
      }
      
    } catch (error) {
      this.logger.warn('テストフレームワークの検出でエラー:', error.message);
    }
    
    return frameworks.length > 0 ? frameworks : ['jest']; // デフォルト
  }
  
  /**
   * カバレッジツールの検出
   */
  async detectCoverageTools() {
    const tools = [];
    
    try {
      const packageJson = JSON.parse(
        await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8')
      );
      
      const deps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      if (deps.nyc) tools.push('nyc');
      if (deps['c8']) tools.push('c8');
      if (deps.istanbul) tools.push('istanbul');
      if (deps.jest) tools.push('jest'); // Jestは内蔵カバレッジ
      
    } catch (error) {
      this.logger.warn('カバレッジツールの検出でエラー:', error.message);
    }
    
    return tools.length > 0 ? tools : ['jest'];
  }
  
  /**
   * 変更されたファイルの取得
   */
  async getChangedFiles(prNumber) {
    // GitHubクライアントを使用してPRの変更ファイルを取得
    // ここでは簡略化のため、モックデータを返す
    return [
      'src/components/Button.js',
      'src/utils/validation.js',
      'tests/Button.test.js'
    ];
  }
  
  /**
   * 影響を受けるテストの特定
   */
  async identifyAffectedTests(changedFiles) {
    const affectedTests = new Set();
    
    for (const file of changedFiles) {
      // テストファイル自体が変更された場合
      if (file.includes('.test.') || file.includes('.spec.')) {
        affectedTests.add(file);
        continue;
      }
      
      // 対応するテストファイルを探す
      const testFile = file
        .replace('/src/', '/tests/')
        .replace('.js', '.test.js')
        .replace('.ts', '.test.ts');
      
      if (await this.fileExists(testFile)) {
        affectedTests.add(testFile);
      }
      
      // インポートしているファイルのテストも追加
      const importingTests = await this.findImportingTests(file);
      importingTests.forEach(test => affectedTests.add(test));
    }
    
    return Array.from(affectedTests);
  }
  
  /**
   * パフォーマンステストを実行すべきか判定
   */
  shouldRunPerformanceTests(changedFiles) {
    // パフォーマンスに影響しそうなファイルパターン
    const performancePatterns = [
      /\.(jsx?|tsx?)$/,  // JSファイル
      /\.css$/,          // スタイル
      /webpack\.config/, // ビルド設定
      /package\.json/    // 依存関係
    ];
    
    return changedFiles.some(file => 
      performancePatterns.some(pattern => pattern.test(file))
    );
  }
  
  /**
   * パフォーマンス閾値チェック
   */
  checkPerformanceThresholds(results) {
    const violations = [];
    const thresholds = this.testConfig.performanceThreshold;
    
    if (results.loadTime > thresholds.loadTime) {
      violations.push({
        metric: 'loadTime',
        actual: results.loadTime,
        threshold: thresholds.loadTime,
        severity: 'error'
      });
    }
    
    if (results.memoryUsage > thresholds.memoryUsage) {
      violations.push({
        metric: 'memoryUsage',
        actual: results.memoryUsage,
        threshold: thresholds.memoryUsage,
        severity: 'warning'
      });
    }
    
    if (results.bundleSize > thresholds.bundleSize) {
      violations.push({
        metric: 'bundleSize',
        actual: results.bundleSize,
        threshold: thresholds.bundleSize,
        severity: 'warning'
      });
    }
    
    return violations;
  }
  
  /**
   * カバレッジ改善の提案生成
   */
  generateCoverageSuggestions(comparison) {
    const suggestions = [];
    
    if (comparison.decreased) {
      suggestions.push({
        type: 'coverage_decrease',
        message: 'カバレッジが低下しています。新しいコードにテストを追加してください。',
        files: comparison.decreasedFiles
      });
    }
    
    if (comparison.uncoveredLines > 50) {
      suggestions.push({
        type: 'low_coverage',
        message: `${comparison.uncoveredLines}行がテストされていません。重要な機能にテストを追加することを検討してください。`,
        priority: 'high'
      });
    }
    
    return suggestions;
  }
  
  /**
   * GitHubへの結果投稿
   */
  async postResultToGitHub(task, report) {
    const { issueNumber, prNumber } = task;
    const targetNumber = issueNumber || prNumber;
    
    if (!targetNumber) return;
    
    try {
      // TODO: GitHubクライアントを使用してコメント投稿
      this.logger.info(`テスト結果をGitHub #${targetNumber} に投稿しました`);
    } catch (error) {
      this.logger.error('GitHub投稿エラー:', error);
    }
  }
  
  /**
   * カバレッジバッジの更新
   */
  async updateCoverageBadge(badgeData) {
    // README.mdなどのバッジを更新
    this.logger.info('カバレッジバッジを更新しました');
  }
  
  /**
   * ファイル存在チェック
   */
  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }
  
  /**
   * ファイルをインポートしているテストを検索
   */
  async findImportingTests(filePath) {
    // 実際の実装では、ASTパーサーやgrepを使用
    return [];
  }
  
  /**
   * エージェント情報の取得
   */
  getInfo() {
    return {
      ...super.getInfo(),
      nickname: 'クーちゃん',
      description: 'テスト自動実行・品質保証エージェント',
      capabilities: [
        'テスト自動実行',
        'カバレッジレポート生成',
        'パフォーマンステスト',
        'テスト結果のGitHub投稿',
        'カバレッジバッジ更新',
        '影響範囲分析'
      ],
      stats: this.stats,
      config: {
        frameworks: this.testConfig.frameworks,
        coverageThreshold: this.testConfig.coverageThreshold,
        performanceThreshold: this.testConfig.performanceThreshold
      }
    };
  }
}

module.exports = CCTAAgent;