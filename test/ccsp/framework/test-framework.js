/**
 * CCSP統合テストフレームワーク
 * 
 * 包括的なテストとバリデーションを提供する統合フレームワーク
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { performance } = require('perf_hooks');

class CCSPTestFramework extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      testTimeout: config.testTimeout || 30000,
      retryAttempts: config.retryAttempts || 3,
      parallelTests: config.parallelTests || 5,
      cleanupOnFailure: config.cleanupOnFailure !== false,
      generateReports: config.generateReports !== false,
      metricsCollection: config.metricsCollection !== false,
      ...config
    };
    
    this.testResults = [];
    this.metrics = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      totalDuration: 0,
      performance: {},
      coverage: {},
      reliability: {}
    };
    
    this.testEnvironment = null;
    this.mockServices = new Map();
    this.teardownCallbacks = [];
  }
  
  /**
   * テスト環境の初期化
   */
  async initialize() {
    this.emit('framework:initialize:start');
    
    try {
      // テスト環境の準備
      this.testEnvironment = await this.createTestEnvironment();
      
      // モックサービスの起動
      await this.startMockServices();
      
      // メトリクス収集の開始
      if (this.config.metricsCollection) {
        this.startMetricsCollection();
      }
      
      this.emit('framework:initialize:complete', this.testEnvironment);
      
    } catch (error) {
      this.emit('framework:initialize:error', error);
      throw error;
    }
  }
  
  /**
   * テスト環境の作成
   */
  async createTestEnvironment() {
    const tempDir = path.join(os.tmpdir(), `ccsp-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    
    const environment = {
      tempDir,
      workingDir: process.cwd(),
      testDataDir: path.join(tempDir, 'data'),
      logsDir: path.join(tempDir, 'logs'),
      reportsDir: path.join(tempDir, 'reports'),
      pid: process.pid,
      startTime: new Date().toISOString(),
      nodeVersion: process.version,
      platform: os.platform(),
      arch: os.arch()
    };
    
    // 必要なディレクトリを作成
    await Promise.all([
      fs.mkdir(environment.testDataDir, { recursive: true }),
      fs.mkdir(environment.logsDir, { recursive: true }),
      fs.mkdir(environment.reportsDir, { recursive: true })
    ]);
    
    // クリーンアップの登録
    this.registerCleanup(() => this.cleanupTestEnvironment(environment));
    
    return environment;
  }
  
  /**
   * モックサービスの起動
   */
  async startMockServices() {
    // Mock Redis
    const MockRedis = require('./mocks/mock-redis');
    const mockRedis = new MockRedis();
    await mockRedis.start();
    this.mockServices.set('redis', mockRedis);
    
    // Mock Claude CLI
    const MockClaudeCLI = require('./mocks/mock-claude-cli');
    const mockClaude = new MockClaudeCLI();
    await mockClaude.start();
    this.mockServices.set('claude', mockClaude);
    
    // Mock GitHub API
    const MockGitHubAPI = require('./mocks/mock-github-api');
    const mockGitHub = new MockGitHubAPI();
    await mockGitHub.start();
    this.mockServices.set('github', mockGitHub);
    
    this.emit('framework:mocks:started', Array.from(this.mockServices.keys()));
  }
  
  /**
   * メトリクス収集の開始
   */
  startMetricsCollection() {
    this.metricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 1000);
    
    this.registerCleanup(() => {
      if (this.metricsInterval) {
        clearInterval(this.metricsInterval);
      }
    });
  }
  
  /**
   * システムメトリクスの収集
   */
  collectSystemMetrics() {
    const usage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    this.metrics.performance = {
      memory: {
        rss: usage.rss,
        heapUsed: usage.heapUsed,
        heapTotal: usage.heapTotal,
        external: usage.external
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      timestamp: Date.now()
    };
  }
  
  /**
   * テストスイートの実行
   */
  async runTestSuite(testSuite) {
    this.emit('suite:start', testSuite.name);
    const startTime = performance.now();
    
    try {
      const results = [];
      
      // 並列実行
      if (testSuite.parallel && this.config.parallelTests > 1) {
        results.push(...await this.runParallelTests(testSuite.tests));
      } else {
        // 順次実行
        for (const test of testSuite.tests) {
          const result = await this.runSingleTest(test);
          results.push(result);
        }
      }
      
      const duration = performance.now() - startTime;
      this.metrics.totalDuration += duration;
      
      const suiteResult = {
        name: testSuite.name,
        tests: results,
        duration,
        passed: results.filter(r => r.status === 'passed').length,
        failed: results.filter(r => r.status === 'failed').length,
        skipped: results.filter(r => r.status === 'skipped').length
      };
      
      this.emit('suite:complete', suiteResult);
      return suiteResult;
      
    } catch (error) {
      this.emit('suite:error', testSuite.name, error);
      throw error;
    }
  }
  
  /**
   * 並列テストの実行
   */
  async runParallelTests(tests) {
    const chunks = this.chunkArray(tests, this.config.parallelTests);
    const results = [];
    
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(test => this.runSingleTest(test))
      );
      results.push(...chunkResults);
    }
    
    return results;
  }
  
  /**
   * 単一テストの実行
   */
  async runSingleTest(test) {
    this.emit('test:start', test.name);
    const startTime = performance.now();
    
    let attempt = 0;
    let lastError = null;
    
    while (attempt <= this.config.retryAttempts) {
      try {
        // テストのセットアップ
        if (test.setup) {
          await test.setup(this.testEnvironment);
        }
        
        // テストの実行
        const testResult = await Promise.race([
          test.execute(this.testEnvironment, this.mockServices),
          this.createTimeout(this.config.testTimeout)
        ]);
        
        // テストのクリーンアップ
        if (test.cleanup) {
          await test.cleanup(this.testEnvironment);
        }
        
        const duration = performance.now() - startTime;
        
        const result = {
          name: test.name,
          status: 'passed',
          duration,
          result: testResult,
          attempt: attempt + 1,
          timestamp: new Date().toISOString()
        };
        
        this.metrics.totalTests++;
        this.metrics.passedTests++;
        this.testResults.push(result);
        
        this.emit('test:passed', result);
        return result;
        
      } catch (error) {
        lastError = error;
        attempt++;
        
        if (attempt <= this.config.retryAttempts) {
          this.emit('test:retry', test.name, attempt, error);
          await this.sleep(1000 * attempt); // 指数バックオフ
        }
      }
    }
    
    // すべての試行が失敗
    const duration = performance.now() - startTime;
    
    const result = {
      name: test.name,
      status: 'failed',
      duration,
      error: lastError.message,
      stack: lastError.stack,
      attempts: attempt,
      timestamp: new Date().toISOString()
    };
    
    this.metrics.totalTests++;
    this.metrics.failedTests++;
    this.testResults.push(result);
    
    this.emit('test:failed', result);
    return result;
  }
  
  /**
   * レポートの生成
   */
  async generateReports() {
    if (!this.config.generateReports) return;
    
    const reportData = {
      summary: this.metrics,
      testResults: this.testResults,
      environment: this.testEnvironment,
      timestamp: new Date().toISOString()
    };
    
    // JSON レポート
    await this.generateJSONReport(reportData);
    
    // HTML レポート
    await this.generateHTMLReport(reportData);
    
    // Markdown レポート
    await this.generateMarkdownReport(reportData);
    
    this.emit('reports:generated', this.testEnvironment.reportsDir);
  }
  
  /**
   * JSONレポートの生成
   */
  async generateJSONReport(data) {
    const reportPath = path.join(this.testEnvironment.reportsDir, 'test-report.json');
    await fs.writeFile(reportPath, JSON.stringify(data, null, 2));
  }
  
  /**
   * HTMLレポートの生成
   */
  async generateHTMLReport(data) {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <title>CCSP Integration Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .summary { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .passed { color: green; }
        .failed { color: red; }
        .skipped { color: orange; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
    </style>
</head>
<body>
    <h1>CCSP Integration Test Report</h1>
    
    <div class="summary">
        <h2>Summary</h2>
        <p><strong>Total Tests:</strong> ${data.summary.totalTests}</p>
        <p><strong class="passed">Passed:</strong> ${data.summary.passedTests}</p>
        <p><strong class="failed">Failed:</strong> ${data.summary.failedTests}</p>
        <p><strong class="skipped">Skipped:</strong> ${data.summary.skippedTests}</p>
        <p><strong>Total Duration:</strong> ${(data.summary.totalDuration / 1000).toFixed(2)}s</p>
        <p><strong>Generated:</strong> ${data.timestamp}</p>
    </div>
    
    <h2>Test Results</h2>
    <table>
        <tr>
            <th>Test Name</th>
            <th>Status</th>
            <th>Duration</th>
            <th>Attempts</th>
        </tr>
        ${data.testResults.map(test => `
        <tr>
            <td>${test.name}</td>
            <td class="${test.status}">${test.status}</td>
            <td>${(test.duration / 1000).toFixed(2)}s</td>
            <td>${test.attempt || test.attempts || 1}</td>
        </tr>
        `).join('')}
    </table>
</body>
</html>`;
    
    const reportPath = path.join(this.testEnvironment.reportsDir, 'test-report.html');
    await fs.writeFile(reportPath, html);
  }
  
  /**
   * Markdownレポートの生成
   */
  async generateMarkdownReport(data) {
    const markdown = `# CCSP Integration Test Report

## Summary

- **Total Tests**: ${data.summary.totalTests}
- **Passed**: ${data.summary.passedTests} ✅
- **Failed**: ${data.summary.failedTests} ❌
- **Skipped**: ${data.summary.skippedTests} ⏭️
- **Total Duration**: ${(data.summary.totalDuration / 1000).toFixed(2)}s
- **Generated**: ${data.timestamp}

## Test Results

| Test Name | Status | Duration | Attempts |
|-----------|--------|----------|----------|
${data.testResults.map(test => 
  `| ${test.name} | ${test.status === 'passed' ? '✅' : test.status === 'failed' ? '❌' : '⏭️'} ${test.status} | ${(test.duration / 1000).toFixed(2)}s | ${test.attempt || test.attempts || 1} |`
).join('\n')}

## Environment

- **Platform**: ${data.environment.platform}
- **Architecture**: ${data.environment.arch}
- **Node Version**: ${data.environment.nodeVersion}
- **PID**: ${data.environment.pid}
- **Working Directory**: ${data.environment.workingDir}
`;
    
    const reportPath = path.join(this.testEnvironment.reportsDir, 'test-report.md');
    await fs.writeFile(reportPath, markdown);
  }
  
  /**
   * クリーンアップの登録
   */
  registerCleanup(callback) {
    this.teardownCallbacks.push(callback);
  }
  
  /**
   * 全体のクリーンアップ
   */
  async cleanup() {
    this.emit('framework:cleanup:start');
    
    // 登録されたクリーンアップを逆順で実行
    for (const callback of this.teardownCallbacks.reverse()) {
      try {
        await callback();
      } catch (error) {
        this.emit('framework:cleanup:error', error);
      }
    }
    
    // モックサービスの停止
    for (const [name, service] of this.mockServices) {
      try {
        await service.stop();
      } catch (error) {
        this.emit('framework:cleanup:error', `Failed to stop ${name}:`, error);
      }
    }
    
    this.emit('framework:cleanup:complete');
  }
  
  /**
   * ユーティリティメソッド
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
  
  createTimeout(ms) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Test timeout after ${ms}ms`)), ms);
    });
  }
  
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  async cleanupTestEnvironment(environment) {
    try {
      await fs.rm(environment.tempDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup test environment: ${error.message}`);
    }
  }
}

module.exports = CCSPTestFramework;