const { expect } = require('chai');
const sinon = require('sinon');
const CCTAAgent = require('../agents/ccta');
const TestRunner = require('../agents/ccta/test-runner');
const CoverageReporter = require('../agents/ccta/coverage-reporter');
const PerformanceTester = require('../agents/ccta/performance-tester');
const ReportGenerator = require('../agents/ccta/report-generator');

describe('CCTA Agent Tests', () => {
  let agent;
  let sandbox;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    agent = new CCTAAgent({
      frameworks: ['jest'],
      coverageThreshold: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    });
    
    // Logger stub
    agent.logger = {
      info: sandbox.stub(),
      error: sandbox.stub(),
      warn: sandbox.stub()
    };
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  describe('初期化', () => {
    it('エージェントが正しく初期化される', async () => {
      sandbox.stub(agent, 'detectTestFrameworks').resolves(['jest']);
      sandbox.stub(agent, 'detectCoverageTools').resolves(['jest']);
      
      await agent.initialize();
      
      expect(agent.logger.info).to.have.been.calledWith('CCTA Agent (クーちゃん) の初期化が完了しました');
    });
  });
  
  describe('タスク処理', () => {
    it('PRテストタスクを処理できる', async () => {
      const task = {
        id: 'test-001',
        type: 'pr_test',
        prNumber: 123,
        baseBranch: 'main'
      };
      
      sandbox.stub(agent, 'runPRTests').resolves({
        success: true,
        tests: { passed: true },
        coverage: { summary: { lines: 85 } }
      });
      
      sandbox.stub(agent.reportGenerator, 'generate').resolves({
        markdown: '# Test Report',
        json: '{}',
        summary: { status: 'passed' }
      });
      
      const result = await agent.processTask(task);
      
      expect(result.success).to.be.true;
      expect(agent.runPRTests).to.have.been.calledWith(task);
    });
    
    it('フルテストタスクを処理できる', async () => {
      const task = {
        id: 'test-002',
        type: 'full_test'
      };
      
      sandbox.stub(agent, 'runFullTests').resolves({
        success: true,
        tests: { passed: true, total: 100, passed: 98, failed: 2 },
        coverage: { meetsThreshold: true }
      });
      
      sandbox.stub(agent.reportGenerator, 'generate').resolves({
        markdown: '# Test Report',
        json: '{}',
        summary: { status: 'passed' }
      });
      
      const result = await agent.processTask(task);
      
      expect(result.success).to.be.true;
      expect(agent.stats.totalRuns).to.equal(1);
      expect(agent.stats.successfulRuns).to.equal(1);
    });
    
    it('エラー時に適切に処理される', async () => {
      const task = {
        id: 'test-003',
        type: 'invalid_type'
      };
      
      sandbox.stub(agent, 'runGeneralTests').rejects(new Error('Test failed'));
      
      const result = await agent.processTask(task);
      
      expect(result.success).to.be.false;
      expect(result.error).to.include('Test failed');
      expect(agent.stats.failedRuns).to.equal(1);
    });
  });
  
  describe('テストフレームワーク検出', () => {
    it('package.jsonから正しくフレームワークを検出する', async () => {
      const fs = require('fs').promises;
      sandbox.stub(fs, 'readFile').resolves(JSON.stringify({
        devDependencies: {
          jest: '^29.0.0',
          mocha: '^10.0.0'
        }
      }));
      
      const frameworks = await agent.detectTestFrameworks();
      
      expect(frameworks).to.include('jest');
      expect(frameworks).to.include('mocha');
    });
  });
  
  describe('パフォーマンス閾値チェック', () => {
    it('閾値違反を正しく検出する', () => {
      const results = {
        loadTime: 4000,
        memoryUsage: 150,
        bundleSize: 600
      };
      
      const violations = agent.checkPerformanceThresholds(results);
      
      expect(violations).to.have.lengthOf(3);
      expect(violations[0].metric).to.equal('loadTime');
      expect(violations[1].metric).to.equal('memoryUsage');
      expect(violations[2].metric).to.equal('bundleSize');
    });
  });
  
  describe('カバレッジ改善提案', () => {
    it('適切な提案を生成する', () => {
      const comparison = {
        decreased: true,
        decreasedFiles: ['src/file1.js', 'src/file2.js'],
        uncoveredLines: 100
      };
      
      const suggestions = agent.generateCoverageSuggestions(comparison);
      
      expect(suggestions).to.have.lengthOf(2);
      expect(suggestions[0].type).to.equal('coverage_decrease');
      expect(suggestions[1].type).to.equal('low_coverage');
    });
  });
});

describe('TestRunner Tests', () => {
  let runner;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    runner = new TestRunner({
      frameworks: ['jest'],
      timeout: 60000
    });
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  it('フレームワークを正しく検出する', async () => {
    const fs = require('fs').promises;
    sandbox.stub(fs, 'readFile').resolves(JSON.stringify({
      scripts: {
        test: 'jest'
      }
    }));
    
    const framework = await runner.detectFramework();
    expect(framework).to.equal('jest');
  });
  
  it('Jest結果を正しく解析する', () => {
    const jsonResult = {
      numTotalTests: 10,
      numPassedTests: 8,
      numFailedTests: 2,
      testResults: [{
        name: 'test.js',
        testResults: [
          {
            status: 'passed',
            title: 'test 1',
            duration: 10
          },
          {
            status: 'failed',
            title: 'test 2',
            duration: 20,
            failureMessages: ['Error']
          }
        ],
        perfStats: { runtime: 100 }
      }]
    };
    
    const result = runner.parseJestResults(jsonResult);
    
    expect(result.passed).to.be.false;
    expect(result.total).to.equal(10);
    expect(result.failures).to.have.lengthOf(1);
    expect(result.passes).to.have.lengthOf(1);
  });
});

describe('CoverageReporter Tests', () => {
  let reporter;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    reporter = new CoverageReporter({
      coverageThreshold: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80
        }
      }
    });
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  it('閾値チェックが正しく動作する', () => {
    const summary = {
      lines: { pct: 85 },
      statements: { pct: 85 },
      functions: { pct: 85 },
      branches: { pct: 75 }
    };
    
    const meetsThreshold = reporter.checkThreshold(summary, reporter.coverageThreshold);
    
    expect(meetsThreshold).to.be.false;
  });
  
  it('バッジデータを正しく生成する', () => {
    const summary = {
      lines: { pct: 92.5 }
    };
    
    const badge = reporter.generateBadgeData(summary);
    
    expect(badge.label).to.equal('coverage');
    expect(badge.message).to.equal('92.5%');
    expect(badge.color).to.equal('brightgreen');
  });
  
  it('カバレッジ比較が正しく動作する', () => {
    const current = {
      available: true,
      summary: {
        lines: 85,
        statements: 85,
        functions: 85,
        branches: 85
      }
    };
    
    const baseline = {
      available: true,
      summary: {
        lines: 80,
        statements: 80,
        functions: 90,
        branches: 80
      }
    };
    
    const comparison = reporter.compare(current, baseline);
    
    expect(comparison.improved).to.be.true;
    expect(comparison.decreased).to.be.true;
    expect(comparison.changes.lines.improved).to.be.true;
    expect(comparison.changes.functions.decreased).to.be.true;
  });
});

describe('ReportGenerator Tests', () => {
  let generator;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    generator = new ReportGenerator({
      reportsDir: 'test-reports'
    });
  });
  
  afterEach(() => {
    sandbox.restore();
  });
  
  it('サマリーを正しく生成する', () => {
    const result = {
      success: true,
      tests: {
        total: 100,
        passed: 95,
        failed: 5,
        duration: 30000
      },
      coverage: {
        summary: {
          lines: 85,
          statements: 84,
          functions: 88,
          branches: 79
        },
        meetsThreshold: true
      }
    };
    
    const summary = generator.generateSummary(result);
    
    expect(summary.totalTests).to.equal(100);
    expect(summary.passedTests).to.equal(95);
    expect(summary.failedTests).to.equal(5);
    expect(summary.coverage.lines).to.equal('85.00%');
    expect(summary.status).to.equal('failed'); // テストが失敗しているため
  });
  
  it('推奨事項を適切に生成する', () => {
    const report = {
      summary: {
        failedTests: 10,
        totalTests: 100,
        coverage: {
          meetsThreshold: false
        },
        duration: 360000 // 6分
      },
      details: {
        coverage: {
          uncoveredLines: 150
        }
      }
    };
    
    const recommendations = generator.generateRecommendations(report);
    
    expect(recommendations).to.have.length.greaterThan(2);
    expect(recommendations[0]).to.include('10個のテストが失敗');
    expect(recommendations).to.include.oneOf(['テスト実行時間が長すぎます']);
  });
  
  it('ステータス絵文字を正しく取得する', () => {
    expect(generator.getStatusEmoji('passed')).to.equal('✅');
    expect(generator.getStatusEmoji('failed')).to.equal('❌');
    expect(generator.getStatusEmoji('coverage_failed')).to.equal('📉');
    expect(generator.getStatusEmoji('performance_failed')).to.equal('⚡');
  });
});