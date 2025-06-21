const AgentBase = require('../shared/agent-base');
const TestRunner = require('./test-runner');
const QualityChecker = require('./quality-checker');
const SecurityScanner = require('./security-scanner');
const PerformanceAnalyzer = require('./performance-analyzer');
const ReportGenerator = require('./report-generator');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const path = require('path');
const fs = require('fs').promises;

/**
 * CCQA (Code Change Quality Assurance) エージェント
 * コード変更の品質保証を担当する
 */
class CCQAAgent extends AgentBase {
  constructor(config = {}) {
    super('CCQA', config);
    
    // QA設定
    this.qaConfig = {
      runTests: config.runTests !== false,
      checkQuality: config.checkQuality !== false,
      scanSecurity: config.scanSecurity !== false,
      analyzePerformance: config.analyzePerformance !== false,
      
      // 閾値設定
      thresholds: {
        coverage: config.thresholds?.coverage || 80,
        complexity: config.thresholds?.complexity || 20,
        duplicateRatio: config.thresholds?.duplicateRatio || 5,
        securityLevel: config.thresholds?.securityLevel || 'high',
        performanceRegressionThreshold: config.thresholds?.performanceRegressionThreshold || 10
      },
      
      // テスト設定
      testConfig: {
        runners: config.testConfig?.runners || ['jest', 'mocha'],
        coverageReporter: config.testConfig?.coverageReporter || 'lcov',
        timeout: config.testConfig?.timeout || 60000
      },
      
      // 品質チェック設定
      qualityConfig: {
        linters: config.qualityConfig?.linters || ['eslint'],
        formatters: config.qualityConfig?.formatters || ['prettier'],
        complexityAnalyzer: config.qualityConfig?.complexityAnalyzer || 'eslint'
      }
    };
    
    // 各モジュールの初期化
    this.testRunner = new TestRunner(this.qaConfig.testConfig);
    this.qualityChecker = new QualityChecker(this.qaConfig.qualityConfig);
    this.securityScanner = new SecurityScanner(this.qaConfig.thresholds);
    this.performanceAnalyzer = new PerformanceAnalyzer(this.qaConfig.thresholds);
    this.reportGenerator = new ReportGenerator();
    
    // 実行結果キャッシュ
    this.resultCache = new Map();
  }
  
  /**
   * エージェント初期化
   */
  async onInitialize() {
    this.logger.info('CCQA エージェントを初期化中...');
    
    // 必要なツールの確認
    await this.checkRequiredTools();
    
    // モジュールの初期化
    await this.testRunner.initialize();
    await this.qualityChecker.initialize();
    await this.securityScanner.initialize();
    await this.performanceAnalyzer.initialize();
    
    this.logger.info('CCQA エージェントの初期化完了');
  }
  
  /**
   * 必要なツールの確認
   */
  async checkRequiredTools() {
    const requiredTools = [
      { command: 'npm --version', name: 'npm' },
      { command: 'node --version', name: 'node' }
    ];
    
    // 設定に応じて追加のツールをチェック
    if (this.qaConfig.qualityConfig.linters.includes('eslint')) {
      requiredTools.push({ command: 'npx eslint --version', name: 'eslint' });
    }
    
    for (const tool of requiredTools) {
      try {
        await execAsync(tool.command);
        this.logger.debug(`${tool.name} が利用可能です`);
      } catch (error) {
        this.logger.warn(`${tool.name} が見つかりません。一部の機能が制限される可能性があります`);
      }
    }
  }
  
  /**
   * タスクの処理
   */
  async processTask(message) {
    const { taskType, repository, issue, pullRequest, changes } = message;
    
    this.logger.info(`QAタスクを開始: ${taskType} (Issue #${issue?.number || 'N/A'})`);
    
    try {
      // 変更内容に基づいてQAを実行
      const results = {
        taskId: message.taskId,
        repository,
        issue: issue?.number,
        pullRequest: pullRequest?.number,
        timestamp: new Date().toISOString(),
        results: {}
      };
      
      // プロジェクトディレクトリの取得
      const projectDir = await this.getProjectDirectory(repository);
      
      // 1. 自動テストの実行
      if (this.qaConfig.runTests) {
        await this.reportProgress(message.taskId, 20, 'テストを実行中...');
        results.results.tests = await this.testRunner.runTests(projectDir, changes);
      }
      
      // 2. コード品質チェック
      if (this.qaConfig.checkQuality) {
        await this.reportProgress(message.taskId, 40, 'コード品質をチェック中...');
        results.results.quality = await this.qualityChecker.checkQuality(projectDir, changes);
      }
      
      // 3. セキュリティ検査
      if (this.qaConfig.scanSecurity) {
        await this.reportProgress(message.taskId, 60, 'セキュリティをスキャン中...');
        results.results.security = await this.securityScanner.scanSecurity(projectDir, changes);
      }
      
      // 4. パフォーマンス分析
      if (this.qaConfig.analyzePerformance) {
        await this.reportProgress(message.taskId, 80, 'パフォーマンスを分析中...');
        results.results.performance = await this.performanceAnalyzer.analyzePerformance(projectDir, changes);
      }
      
      // 5. レポート生成
      await this.reportProgress(message.taskId, 90, 'レポートを生成中...');
      const report = await this.reportGenerator.generateReport(results);
      
      // 品質スコアの計算
      const qualityScore = this.calculateQualityScore(results);
      results.qualityScore = qualityScore;
      
      // 結果をキャッシュ
      this.resultCache.set(message.taskId, results);
      
      // GitHubにコメントを投稿
      if (issue || pullRequest) {
        await this.postGitHubComment(repository, issue || pullRequest, report);
      }
      
      await this.reportProgress(message.taskId, 100, 'QA完了');
      
      return {
        success: true,
        qualityScore,
        summary: this.generateSummary(results),
        detailedReport: report,
        recommendations: this.generateRecommendations(results)
      };
      
    } catch (error) {
      this.logger.error(`QAタスクエラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * プロジェクトディレクトリの取得
   */
  async getProjectDirectory(repository) {
    // 現在のディレクトリをプロジェクトルートとして使用
    return process.cwd();
  }
  
  /**
   * 品質スコアの計算
   */
  calculateQualityScore(results) {
    let score = 100;
    const weights = {
      tests: 0.3,
      quality: 0.3,
      security: 0.25,
      performance: 0.15
    };
    
    // テストスコア
    if (results.results.tests) {
      const testScore = results.results.tests.coverage >= this.qaConfig.thresholds.coverage ? 100 : 
        (results.results.tests.coverage / this.qaConfig.thresholds.coverage) * 100;
      const testPassRate = (results.results.tests.passed / results.results.tests.total) * 100;
      score -= (100 - Math.min(testScore, testPassRate)) * weights.tests;
    }
    
    // 品質スコア
    if (results.results.quality) {
      const qualityIssues = results.results.quality.issues || [];
      const errorCount = qualityIssues.filter(i => i.severity === 'error').length;
      const warningCount = qualityIssues.filter(i => i.severity === 'warning').length;
      const qualityScore = Math.max(0, 100 - (errorCount * 10) - (warningCount * 2));
      score -= (100 - qualityScore) * weights.quality;
    }
    
    // セキュリティスコア
    if (results.results.security) {
      const vulnerabilities = results.results.security.vulnerabilities || [];
      const criticalCount = vulnerabilities.filter(v => v.severity === 'critical').length;
      const highCount = vulnerabilities.filter(v => v.severity === 'high').length;
      const securityScore = Math.max(0, 100 - (criticalCount * 20) - (highCount * 10));
      score -= (100 - securityScore) * weights.security;
    }
    
    // パフォーマンススコア
    if (results.results.performance) {
      const regressions = results.results.performance.regressions || [];
      const performanceScore = Math.max(0, 100 - (regressions.length * 15));
      score -= (100 - performanceScore) * weights.performance;
    }
    
    return Math.round(Math.max(0, score));
  }
  
  /**
   * サマリーの生成
   */
  generateSummary(results) {
    const summary = [];
    
    if (results.results.tests) {
      summary.push(`テスト: ${results.results.tests.passed}/${results.results.tests.total} 成功 (カバレッジ: ${results.results.tests.coverage}%)`);
    }
    
    if (results.results.quality) {
      const issues = results.results.quality.issues || [];
      summary.push(`品質: ${issues.length} 件の問題`);
    }
    
    if (results.results.security) {
      const vulns = results.results.security.vulnerabilities || [];
      summary.push(`セキュリティ: ${vulns.length} 件の脆弱性`);
    }
    
    if (results.results.performance) {
      const regressions = results.results.performance.regressions || [];
      summary.push(`パフォーマンス: ${regressions.length} 件の回帰`);
    }
    
    return summary.join(' | ');
  }
  
  /**
   * 推奨事項の生成
   */
  generateRecommendations(results) {
    const recommendations = [];
    
    // テストカバレッジが低い場合
    if (results.results.tests && results.results.tests.coverage < this.qaConfig.thresholds.coverage) {
      recommendations.push({
        type: 'test_coverage',
        priority: 'high',
        message: `テストカバレッジを ${this.qaConfig.thresholds.coverage}% 以上に向上させてください`,
        action: 'テストケースを追加してください'
      });
    }
    
    // 品質問題がある場合
    if (results.results.quality) {
      const errors = (results.results.quality.issues || []).filter(i => i.severity === 'error');
      if (errors.length > 0) {
        recommendations.push({
          type: 'quality_errors',
          priority: 'critical',
          message: `${errors.length} 件のコード品質エラーを修正してください`,
          action: 'ESLintエラーを修正してください'
        });
      }
    }
    
    // セキュリティ脆弱性がある場合
    if (results.results.security) {
      const critical = (results.results.security.vulnerabilities || []).filter(v => v.severity === 'critical');
      if (critical.length > 0) {
        recommendations.push({
          type: 'security_critical',
          priority: 'critical',
          message: `${critical.length} 件のクリティカルなセキュリティ脆弱性を修正してください`,
          action: '依存関係を更新するか、脆弱性を修正してください'
        });
      }
    }
    
    return recommendations;
  }
  
  /**
   * GitHubコメントの投稿
   */
  async postGitHubComment(repository, target, report) {
    try {
      // TODO: GitHub APIを使用してコメントを投稿
      this.logger.info(`GitHubコメントを投稿: ${repository} #${target.number}`);
    } catch (error) {
      this.logger.error(`GitHubコメント投稿エラー: ${error.message}`);
    }
  }
  
  /**
   * タスク時間の見積もり
   */
  estimateTaskDuration(message) {
    const { changes = [] } = message;
    const fileCount = changes.length;
    
    // ファイル数に基づいて見積もり（1ファイルあたり30秒）
    const baseTime = 60000; // 1分
    const perFileTime = 30000; // 30秒
    
    return baseTime + (fileCount * perFileTime);
  }
}

module.exports = CCQAAgent;