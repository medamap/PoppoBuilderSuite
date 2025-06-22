const { expect } = require('chai');
const sinon = require('sinon');
const MockFactory = require('./helpers/mock-factory');
const CCQAAgent = require('../agents/ccqa');
const fs = require('fs').promises;
const path = require('path');

describe('CCQA Agent', () => {
  let agent;
  let mockConfig;
  let sandbox;
  let mockFactory;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    mockFactory = new MockFactory();
    mockConfig = {
      runTests: true,
      checkQuality: true,
      scanSecurity: true,
      analyzePerformance: true,
      thresholds: {
        coverage: 80,
        complexity: 20,
        duplicateRatio: 5,
        securityLevel: 'high',
        performanceRegressionThreshold: 10
      },
      testConfig: {
        runners: ['jest'],
        timeout: 30000
      },
      qualityConfig: {
        linters: ['eslint'],
        formatters: ['prettier']
      }
    };
    
    agent = new CCQAAgent(mockConfig);
  });
  
  afterEach(async () => {
    if (agent && agent.shutdown) {
      await agent.shutdown();
    }
    sandbox.restore();
    mockFactory.cleanup();
  });
  
  describe('Initialization', () => {
    it('should initialize agent successfully', async () => {
      await agent.initialize();
      expect(agent.status).to.equal('running');
    });
    
    it('should check required tools during initialization', async () => {
      const checkToolsSpy = sandbox.spy(agent, 'checkRequiredTools');
      await agent.initialize();
      expect(checkToolsSpy).to.have.been.called;
    });
    
    it('should handle initialization errors gracefully', async () => {
      agent.onInitialize = sandbox.stub().rejects(new Error('Init error'));
      await expect(agent.initialize()).to.be.rejectedWith('Init error');
      expect(agent.status).to.equal('error');
    });
  });
  
  describe('Task Processing', () => {
    beforeEach(async () => {
      await agent.initialize();
    });
    
    it('should process quality assurance task', async () => {
      const mockMessage = {
        taskId: 'test-task-1',
        taskType: 'quality-assurance',
        repository: 'test-repo',
        issue: { number: 123 },
        changes: ['src/test.js']
      };
      
      // Mock各モジュールの結果
      agent.testRunner.runTests = sandbox.stub().resolves({
        success: true,
        total: 10,
        passed: 9,
        failed: 1,
        coverage: 85
      });
      
      agent.qualityChecker.checkQuality = sandbox.stub().resolves({
        issues: [],
        metrics: {},
        suggestions: []
      });
      
      agent.securityScanner.scanSecurity = sandbox.stub().resolves({
        vulnerabilities: [],
        credentials: [],
        dependencies: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0 }
      });
      
      agent.performanceAnalyzer.analyzePerformance = sandbox.stub().resolves({
        regressions: [],
        memoryLeaks: [],
        executionTime: {},
        bundleSize: {},
        recommendations: []
      });
      
      agent.reportGenerator.generateReport = sandbox.stub().resolves({
        markdown: '# Test Report',
        json: {},
        summary: 'All checks passed'
      });
      
      const result = await agent.processTask(mockMessage);
      
      expect(result.success).to.be.true;
      expect(result.qualityScore).to.be.greaterThan(0);
      expect(result.summary).to.exist;
    });
    
    it('should handle task processing errors', async () => {
      const mockMessage = {
        taskId: 'test-task-2',
        taskType: 'quality-assurance',
        repository: 'test-repo',
        issue: { number: 124 }
      };
      
      agent.testRunner.runTests = sandbox.stub().rejects(new Error('Test error'));
      
      await expect(agent.processTask(mockMessage)).to.be.rejectedWith('Test error');
    });
  });
  
  describe('Quality Score Calculation', () => {
    it('should calculate quality score based on results', () => {
      const results = {
        results: {
          tests: {
            coverage: 90,
            total: 100,
            passed: 95,
            failed: 5
          },
          quality: {
            issues: [
              { severity: 'error' },
              { severity: 'warning' },
              { severity: 'warning' }
            ]
          },
          security: {
            vulnerabilities: [
              { severity: 'high' }
            ]
          },
          performance: {
            regressions: []
          }
        }
      };
      
      const score = agent.calculateQualityScore(results);
      expect(score).to.be.greaterThan(0);
      expect(score).to.be.at.most(100);
    });
    
    it('should return 100 for perfect results', () => {
      const results = {
        results: {
          tests: {
            coverage: 100,
            total: 100,
            passed: 100,
            failed: 0
          },
          quality: {
            issues: []
          },
          security: {
            vulnerabilities: []
          },
          performance: {
            regressions: []
          }
        }
      };
      
      const score = agent.calculateQualityScore(results);
      expect(score).to.equal(100);
    });
  });
  
  describe('Summary Generation', () => {
    it('should generate summary from results', () => {
      const results = {
        results: {
          tests: {
            passed: 10,
            total: 12,
            coverage: 85
          },
          quality: {
            issues: [1, 2, 3]
          },
          security: {
            vulnerabilities: [1]
          },
          performance: {
            regressions: []
          }
        }
      };
      
      const summary = agent.generateSummary(results);
      expect(summary).to.include('テスト: 10/12 成功');
      expect(summary).to.include('品質: 3 件の問題');
      expect(summary).to.include('セキュリティ: 1 件の脆弱性');
    });
  });
  
  describe('Recommendations Generation', () => {
    it('should generate recommendations for low coverage', () => {
      const results = {
        results: {
          tests: {
            coverage: 60
          }
        }
      };
      
      const recommendations = agent.generateRecommendations(results);
      expect(recommendations).toContainEqual(
        sinon.match({
          type: 'test_coverage',
          priority: 'high'
        })
      );
    });
    
    it('should generate recommendations for quality errors', () => {
      const results = {
        results: {
          quality: {
            issues: [
              { severity: 'error' },
              { severity: 'error' }
            ]
          }
        }
      };
      
      const recommendations = agent.generateRecommendations(results);
      expect(recommendations).toContainEqual(
        sinon.match({
          type: 'quality_errors',
          priority: 'critical'
        })
      );
    });
    
    it('should generate recommendations for security vulnerabilities', () => {
      const results = {
        results: {
          security: {
            vulnerabilities: [
              { severity: 'critical' }
            ]
          }
        }
      };
      
      const recommendations = agent.generateRecommendations(results);
      expect(recommendations).toContainEqual(
        sinon.match({
          type: 'security_critical',
          priority: 'critical'
        })
      );
    });
  });
  
  describe('Task Duration Estimation', () => {
    it('should estimate task duration based on file count', () => {
      const message = {
        changes: ['file1.js', 'file2.js', 'file3.js']
      };
      
      const duration = agent.estimateTaskDuration(message);
      expect(duration).to.be.greaterThan(60000); // 1分以上
      expect(duration).to.equal(60000 + (3 * 30000)); // base + (3 files * 30s)
    });
    
    it('should return base time for no files', () => {
      const message = {
        changes: []
      };
      
      const duration = agent.estimateTaskDuration(message);
      expect(duration).to.equal(60000); // 1分
    });
  });
  
  describe('Message Handling', () => {
    it('should handle TASK_ASSIGNMENT message', async () => {
      const message = {
        type: 'TASK_ASSIGNMENT',
        taskId: 'test-task-3',
        taskType: 'quality-assurance',
        issueNumber: 125,
        priority: 'high',
        deadline: new Date(Date.now() + 3600000).toISOString(),
        context: {},
        payload: {}
      };
      
      // Mock processTask
      agent.processTask = sandbox.stub().resolves({
        success: true,
        qualityScore: 95
      });
      
      await agent.handleMessage(message);
      
      expect(agent.processTask).to.have.been.calledWith(message);
      expect(agent.activeTasks.has('test-task-3')).to.be.false; // タスク完了後は削除される
    });
  });
});

describe('CCQA Modules', () => {
  describe('TestRunner', () => {
    const TestRunner = require('../agents/ccqa/test-runner');
    let testRunner;
    
    beforeEach(() => {
      testRunner = new TestRunner({
        runners: ['jest'],
        timeout: 30000
      });
    });
    
    it('should detect available test runners', async () => {
      await testRunner.initialize();
      expect(testRunner.availableRunners).to.be.an('array');
    });
  });
  
  describe('QualityChecker', () => {
    const QualityChecker = require('../agents/ccqa/quality-checker');
    let qualityChecker;
    
    beforeEach(() => {
      qualityChecker = new QualityChecker({
        linters: ['eslint'],
        formatters: ['prettier']
      });
    });
    
    it('should detect available tools', async () => {
      await qualityChecker.initialize();
      expect(qualityChecker.availableTools).to.be.an('object');
    });
    
    it('should calculate cyclomatic complexity', () => {
      const code = `
        function it(x) {
          if (x > 0) {
            for (let i = 0; i < x; i++) {
              if (i % 2 === 0) {
                console.log(i);
              }
            }
          } else {
            return null;
          }
        }
      `;
      
      const complexity = qualityChecker.calculateCyclomaticComplexity(code);
      expect(complexity).to.be.greaterThan(1);
    });
  });
  
  describe('SecurityScanner', () => {
    const SecurityScanner = require('../agents/ccqa/security-scanner');
    let securityScanner;
    
    beforeEach(() => {
      securityScanner = new SecurityScanner({
        securityLevel: 'high'
      });
    });
    
    it('should mask credentials', () => {
      const credential = 'super-secret-api-key-12345';
      const masked = securityScanner.maskCredential(credential);
      
      expect(masked).to.include('supe');
      expect(masked).to.include('2345');
      expect(masked).to.include('*');
      expect(masked).not.to.include('secret');
    });
    
    it('should calculate security score', () => {
      const results = {
        summary: {
          critical: 1,
          high: 2,
          medium: 3,
          low: 5
        },
        credentials: []
      };
      
      const score = securityScanner.calculateSecurityScore(results);
      expect(score).to.be.lessThan(100);
      expect(score).to.be.at.least(0);
    });
  });
  
  describe('PerformanceAnalyzer', () => {
    const PerformanceAnalyzer = require('../agents/ccqa/performance-analyzer');
    let performanceAnalyzer;
    
    beforeEach(() => {
      performanceAnalyzer = new PerformanceAnalyzer({
        performanceRegressionThreshold: 10
      });
    });
    
    it('should extract functions from code', () => {
      const code = `
        function testFunc() {}
        const arrowFunc = () => {}
        async function asyncFunc() {}
      `;
      
      const functions = performanceAnalyzer.extractFunctions(code);
      expect(functions.length).to.be.greaterThan(0);
      expect(functions.some(f => f.name === 'testFunc')).to.be.true;
    });
    
    it('should estimate execution time', () => {
      const func = {
        complexity: 5,
        body: 'for (let i = 0; i < 10; i++) { console.log(i); }'
      };
      
      const time = performanceAnalyzer.estimateExecutionTime(func);
      expect(time).to.be.greaterThan(0);
    });
  });
  
  describe('ReportGenerator', () => {
    const ReportGenerator = require('../agents/ccqa/report-generator');
    let reportGenerator;
    
    beforeEach(() => {
      reportGenerator = new ReportGenerator({
        formats: ['markdown', 'json'],
        includeDetails: true,
        includeRecommendations: true
      });
    });
    
    it('should generate quality emoji based on score', () => {
      expect(reportGenerator.getQualityEmoji(95)).to.equal('🌟');
      expect(reportGenerator.getQualityEmoji(85)).to.equal('✅');
      expect(reportGenerator.getQualityEmoji(75)).to.equal('⚠️');
      expect(reportGenerator.getQualityEmoji(65)).to.equal('⚡');
      expect(reportGenerator.getQualityEmoji(50)).to.equal('❌');
    });
    
    it('should generate markdown report', async () => {
      const results = {
        qualityScore: 90,
        repository: 'test-repo',
        issue: 123,
        results: {
          tests: {
            total: 10,
            passed: 9,
            failed: 1,
            coverage: 85
          }
        },
        recommendations: []
      };
      
      const report = await reportGenerator.generateMarkdownReport(results);
      expect(report).to.include('# 🔍 Code Quality Assurance Report');
      expect(report).to.include('品質スコア');
      expect(report).to.include('90/100');
    });
    
    it('should generate JSON report', async () => {
      const results = {
        qualityScore: 90,
        repository: 'test-repo',
        issue: 123,
        results: {
          tests: {
            total: 10,
            passed: 9,
            failed: 1,
            coverage: 85
          }
        }
      };
      
      const report = await reportGenerator.generateJSONReport(results);
      expect(report.metadata).to.exist;
      expect(report.summary.qualityScore).to.equal(90);
      expect(report.details.tests).to.exist;
    });
  });
});