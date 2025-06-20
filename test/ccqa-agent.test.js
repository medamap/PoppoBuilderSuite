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
      const checkToolsSpy = jest.spyOn(agent, 'checkRequiredTools');
      await agent.initialize();
      expect(checkToolsSpy).toHaveBeenCalled();
    });
    
    it('should handle initialization errors gracefully', async () => {
      agent.onInitialize = jest.fn().mockRejectedValue(new Error('Init error'));
      await expect(agent.initialize()).rejects.toThrow('Init error');
      expect(agent.status).toBe('error');
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
      agent.testRunner.runTests = jest.fn().mockResolvedValue({
        success: true,
        total: 10,
        passed: 9,
        failed: 1,
        coverage: 85
      });
      
      agent.qualityChecker.checkQuality = jest.fn().mockResolvedValue({
        issues: [],
        metrics: {},
        suggestions: []
      });
      
      agent.securityScanner.scanSecurity = jest.fn().mockResolvedValue({
        vulnerabilities: [],
        credentials: [],
        dependencies: [],
        summary: { critical: 0, high: 0, medium: 0, low: 0 }
      });
      
      agent.performanceAnalyzer.analyzePerformance = jest.fn().mockResolvedValue({
        regressions: [],
        memoryLeaks: [],
        executionTime: {},
        bundleSize: {},
        recommendations: []
      });
      
      agent.reportGenerator.generateReport = jest.fn().mockResolvedValue({
        markdown: '# Test Report',
        json: {},
        summary: 'All checks passed'
      });
      
      const result = await agent.processTask(mockMessage);
      
      expect(result.success).toBe(true);
      expect(result.qualityScore).toBeGreaterThan(0);
      expect(result.summary).toBeDefined();
    });
    
    it('should handle task processing errors', async () => {
      const mockMessage = {
        taskId: 'test-task-2',
        taskType: 'quality-assurance',
        repository: 'test-repo',
        issue: { number: 124 }
      };
      
      agent.testRunner.runTests = jest.fn().mockRejectedValue(new Error('Test error'));
      
      await expect(agent.processTask(mockMessage)).rejects.toThrow('Test error');
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
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(100);
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
      expect(score).toBe(100);
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
      expect(summary).toContain('テスト: 10/12 成功');
      expect(summary).toContain('品質: 3 件の問題');
      expect(summary).toContain('セキュリティ: 1 件の脆弱性');
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
        expect.objectContaining({
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
        expect.objectContaining({
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
        expect.objectContaining({
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
      expect(duration).toBeGreaterThan(60000); // 1分以上
      expect(duration).toBe(60000 + (3 * 30000)); // base + (3 files * 30s)
    });
    
    it('should return base time for no files', () => {
      const message = {
        changes: []
      };
      
      const duration = agent.estimateTaskDuration(message);
      expect(duration).toBe(60000); // 1分
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
      agent.processTask = jest.fn().mockResolvedValue({
        success: true,
        qualityScore: 95
      });
      
      await agent.handleMessage(message);
      
      expect(agent.processTask).toHaveBeenCalledWith(message);
      expect(agent.activeTasks.has('test-task-3')).toBe(false); // タスク完了後は削除される
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
      expect(testRunner.availableRunners).toBeInstanceOf(Array);
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
      expect(qualityChecker.availableTools).toBeInstanceOf(Object);
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
      expect(complexity).toBeGreaterThan(1);
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
      
      expect(masked).toContain('supe');
      expect(masked).toContain('2345');
      expect(masked).toContain('*');
      expect(masked).not.toContain('secret');
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
      expect(score).toBeLessThan(100);
      expect(score).toBeGreaterThanOrEqual(0);
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
      expect(functions.length).toBeGreaterThan(0);
      expect(functions.some(f => f.name === 'testFunc')).toBe(true);
    });
    
    it('should estimate execution time', () => {
      const func = {
        complexity: 5,
        body: 'for (let i = 0; i < 10; i++) { console.log(i); }'
      };
      
      const time = performanceAnalyzer.estimateExecutionTime(func);
      expect(time).toBeGreaterThan(0);
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
      expect(reportGenerator.getQualityEmoji(95)).toBe('🌟');
      expect(reportGenerator.getQualityEmoji(85)).toBe('✅');
      expect(reportGenerator.getQualityEmoji(75)).toBe('⚠️');
      expect(reportGenerator.getQualityEmoji(65)).toBe('⚡');
      expect(reportGenerator.getQualityEmoji(50)).toBe('❌');
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
      expect(report).toContain('# 🔍 Code Quality Assurance Report');
      expect(report).toContain('品質スコア');
      expect(report).toContain('90/100');
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
      expect(report.metadata).toBeDefined();
      expect(report.summary.qualityScore).toBe(90);
      expect(report.details.tests).toBeDefined();
    });
  });
});