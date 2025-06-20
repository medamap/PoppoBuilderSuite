const { expect } = require('chai');
const sinon = require('sinon');
const CCRAAgent = require('../agents/ccra');
const PRAnalyzer = require('../agents/ccra/pr-analyzer');
const CodeQualityChecker = require('../agents/ccra/code-quality-checker');
const SecurityScanner = require('../agents/ccra/security-scanner');
const ReviewGenerator = require('../agents/ccra/review-generator');
const github = require('../src/github-client');
const fs = require('fs').promises;
const path = require('path');

describe('CCRA (Code Change Review Agent)', () => {
  let agent;
  let sandbox;
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    
    // GitHub APIのモック
    sandbox.stub(github, 'listPullRequests').resolves([]);
    sandbox.stub(github, 'getPullRequest').resolves({});
    sandbox.stub(github, 'getPullRequestFiles').resolves([]);
    sandbox.stub(github, 'getPullRequestCommits').resolves([]);
    sandbox.stub(github, 'createReview').resolves({});
    sandbox.stub(github, 'createReviewComment').resolves({});
    sandbox.stub(github, 'createStatus').resolves({});
    
    // 環境変数の設定
    process.env.GITHUB_TOKEN = 'test-token';
    process.env.GITHUB_REPOSITORY = 'test/repo';
    
    agent = new CCRAAgent({
      checkInterval: 60000,
      repository: 'test/repo'
    });
  });
  
  afterEach(async () => {
    sandbox.restore();
    if (agent && agent.checkTimer) {
      clearInterval(agent.checkTimer);
    }
  });
  
  describe('初期化', () => {
    it('正常に初期化できること', async () => {
      await agent.onInitialize();
      
      expect(agent.prAnalyzer).to.be.instanceOf(PRAnalyzer);
      expect(agent.qualityChecker).to.be.instanceOf(CodeQualityChecker);
      expect(agent.securityScanner).to.be.instanceOf(SecurityScanner);
      expect(agent.reviewGenerator).to.be.instanceOf(ReviewGenerator);
    });
    
    it('GITHUB_TOKENがない場合エラーになること', async () => {
      delete process.env.GITHUB_TOKEN;
      
      try {
        await agent.onInitialize();
        expect.fail('エラーが発生するはず');
      } catch (error) {
        expect(error.message).to.include('GITHUB_TOKEN');
      }
    });
  });
  
  describe('PR監視', () => {
    it('オープンなPRをチェックすること', async () => {
      const mockPRs = [
        {
          number: 1,
          title: 'Test PR',
          draft: false,
          labels: [],
          user: { type: 'User' }
        }
      ];
      
      github.listPullRequests.resolves(mockPRs);
      sandbox.stub(agent, 'handleTaskAssignment').resolves();
      
      await agent.checkPullRequests();
      
      expect(github.listPullRequests).to.have.been.calledOnce;
      expect(agent.handleTaskAssignment).to.have.been.calledOnce;
    });
    
    it('ドラフトPRはスキップすること', async () => {
      const mockPRs = [
        {
          number: 1,
          title: 'Draft PR',
          draft: true,
          labels: [],
          user: { type: 'User' }
        }
      ];
      
      github.listPullRequests.resolves(mockPRs);
      sandbox.stub(agent, 'handleTaskAssignment').resolves();
      
      await agent.checkPullRequests();
      
      expect(agent.handleTaskAssignment).to.not.have.been.called;
    });
    
    it('skip-reviewラベルがあるPRはスキップすること', async () => {
      const mockPRs = [
        {
          number: 1,
          title: 'Skip Review PR',
          draft: false,
          labels: [{ name: 'skip-review' }],
          user: { type: 'User' }
        }
      ];
      
      github.listPullRequests.resolves(mockPRs);
      sandbox.stub(agent, 'handleTaskAssignment').resolves();
      
      await agent.checkPullRequests();
      
      expect(agent.handleTaskAssignment).to.not.have.been.called;
    });
  });
  
  describe('PR分析', () => {
    it('PR情報を正しく分析すること', async () => {
      const mockPR = {
        number: 1,
        title: 'Test PR',
        body: 'Test description',
        user: { login: 'testuser' },
        base: { ref: 'main', repo: { full_name: 'test/repo' } },
        head: { ref: 'feature-branch', sha: 'abc123' },
        additions: 50,
        deletions: 20
      };
      
      const mockFiles = [
        {
          filename: 'src/test.js',
          status: 'modified',
          additions: 30,
          deletions: 10,
          patch: '+console.log("test");'
        }
      ];
      
      const mockCommits = [
        {
          sha: 'abc123',
          commit: {
            message: 'Test commit',
            author: { name: 'Test User', date: new Date().toISOString() }
          }
        }
      ];
      
      github.getPullRequest.resolves(mockPR);
      github.getPullRequestFiles.resolves(mockFiles);
      github.getPullRequestCommits.resolves(mockCommits);
      
      const analysis = await agent.prAnalyzer.analyze(mockPR);
      
      expect(analysis.pr.number).to.equal(1);
      expect(analysis.stats.files).to.equal(1);
      expect(analysis.stats.additions).to.equal(50);
      expect(analysis.files).to.have.length(1);
      expect(analysis.commits).to.have.length(1);
    });
  });
  
  describe('コード品質チェック', () => {
    it('複雑度の高いコードを検出すること', () => {
      const file = {
        filename: 'test.js',
        patch: `
+function complex() {
+  if (a) {
+    if (b) {
+      if (c) {
+        if (d) {
+          if (e) {
+            return true;
+          }
+        }
+      }
+    }
+  }
+}`
      };
      
      const issues = agent.qualityChecker.checkComplexity(file);
      
      expect(issues).to.have.length.greaterThan(0);
      expect(issues[0].type).to.equal('complexity');
      expect(issues[0].severity).to.be.oneOf(['warning', 'error']);
    });
    
    it('コード重複を検出すること', () => {
      const file = {
        filename: 'test.js',
        patch: `
+console.log('duplicate');
+console.log('duplicate');
+console.log('duplicate');
+console.log('other');
+console.log('duplicate');
+console.log('duplicate');
+console.log('duplicate');`
      };
      
      const issues = agent.qualityChecker.checkDuplication(file);
      
      expect(issues).to.have.length.greaterThan(0);
      expect(issues[0].type).to.equal('duplication');
    });
  });
  
  describe('セキュリティスキャン', () => {
    it('ハードコードされたAPIキーを検出すること', () => {
      const file = {
        filename: 'config.js',
        patch: '+const apiKey = "sk-1234567890abcdef";'
      };
      
      const scanner = agent.securityScanner;
      const vulnerabilities = [];
      
      scanner.patterns.hardcodedSecrets.forEach(pattern => {
        const match = file.patch.match(pattern.pattern);
        if (match) {
          vulnerabilities.push({
            severity: pattern.severity,
            message: pattern.message
          });
        }
      });
      
      expect(vulnerabilities).to.have.length.greaterThan(0);
      expect(vulnerabilities[0].severity).to.equal('critical');
    });
    
    it('evalの使用を検出すること', () => {
      const file = {
        filename: 'script.js',
        patch: '+eval(userInput);'
      };
      
      const scanner = agent.securityScanner;
      const vulnerabilities = [];
      
      scanner.patterns.xss.forEach(pattern => {
        const match = file.patch.match(pattern.pattern);
        if (match) {
          vulnerabilities.push({
            severity: pattern.severity,
            message: pattern.message
          });
        }
      });
      
      expect(vulnerabilities).to.have.length.greaterThan(0);
      expect(vulnerabilities[0].severity).to.equal('high');
    });
  });
  
  describe('レビュー生成', () => {
    it('レビューコメントを生成すること', async () => {
      const reviewData = {
        pr: {
          pr: { number: 1, title: 'Test PR' }
        },
        analysis: {
          stats: {
            files: 2,
            additions: 100,
            deletions: 50,
            languages: [{ language: 'JavaScript', files: 2 }]
          },
          insights: []
        },
        quality: {
          overall: { score: 85 },
          issues: [],
          complexity: [],
          duplication: [],
          style: [],
          bestPractices: []
        },
        security: {
          overall: { secure: true, criticalCount: 0 },
          vulnerabilities: []
        }
      };
      
      const review = await agent.reviewGenerator.generate(reviewData);
      
      expect(review).to.have.property('body');
      expect(review).to.have.property('status');
      expect(review).to.have.property('summary');
      expect(review.status).to.equal('success');
    });
  });
  
  describe('優先度計算', () => {
    it('urgentラベルのPRは高優先度になること', () => {
      const pr = {
        labels: [{ name: 'urgent' }],
        additions: 100,
        deletions: 50,
        created_at: new Date().toISOString()
      };
      
      const priority = agent.calculatePriority(pr);
      
      expect(priority).to.be.greaterThan(70);
    });
    
    it('古いPRは優先度が上がること', () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 10);
      
      const pr = {
        labels: [],
        additions: 100,
        deletions: 50,
        created_at: oldDate.toISOString()
      };
      
      const priority = agent.calculatePriority(pr);
      
      expect(priority).to.be.greaterThan(50);
    });
  });
  
  describe('タスク処理', () => {
    it('PR_REVIEWタスクを処理できること', async () => {
      const mockPR = {
        number: 1,
        title: 'Test PR',
        base: { repo: { full_name: 'test/repo' } },
        head: { sha: 'abc123' },
        additions: 50,
        deletions: 20
      };
      
      const message = {
        taskId: 'test-task-1',
        type: 'PR_REVIEW',
        pr: mockPR
      };
      
      // モック設定
      sandbox.stub(agent, 'reportProgress').resolves();
      sandbox.stub(agent.prAnalyzer, 'analyze').resolves({
        pr: mockPR,
        stats: { files: 1 },
        files: []
      });
      sandbox.stub(agent.qualityChecker, 'check').resolves({
        overall: { score: 90, issues: [] }
      });
      sandbox.stub(agent.securityScanner, 'scan').resolves({
        overall: { secure: true },
        vulnerabilities: []
      });
      sandbox.stub(agent.reviewGenerator, 'generate').resolves({
        body: 'Test review',
        status: 'success',
        summary: 'No issues',
        issues: [],
        securityIssues: [],
        comments: []
      });
      sandbox.stub(agent, 'postReview').resolves();
      
      const result = await agent.processTask(message);
      
      expect(result.success).to.be.true;
      expect(result.prNumber).to.equal(1);
      expect(agent.reportProgress).to.have.been.called;
      expect(agent.postReview).to.have.been.calledOnce;
    });
  });
});

// 個別モジュールのテスト
describe('PRAnalyzer', () => {
  let analyzer;
  let logger;
  
  beforeEach(() => {
    logger = { info: sinon.stub(), error: sinon.stub() };
    analyzer = new PRAnalyzer(logger);
  });
  
  it('ファイルの言語を正しく検出すること', () => {
    expect(analyzer.detectFileLanguage('test.js')).to.equal('JavaScript');
    expect(analyzer.detectFileLanguage('test.py')).to.equal('Python');
    expect(analyzer.detectFileLanguage('test.java')).to.equal('Java');
    expect(analyzer.detectFileLanguage('test.unknown')).to.be.null;
  });
  
  it('ファイルをカテゴリ分類できること', () => {
    expect(analyzer.categorizeFile('test.spec.js')).to.equal('test');
    expect(analyzer.categorizeFile('config.json')).to.equal('config');
    expect(analyzer.categorizeFile('README.md')).to.equal('documentation');
    expect(analyzer.categorizeFile('package.json')).to.equal('dependency');
    expect(analyzer.categorizeFile('index.js')).to.equal('source');
  });
});

describe('CodeQualityChecker', () => {
  let checker;
  let logger;
  
  beforeEach(() => {
    logger = { info: sinon.stub(), error: sinon.stub() };
    checker = new CodeQualityChecker(logger);
  });
  
  it('長い行を検出すること', () => {
    const file = {
      filename: 'test.js',
      patch: '+' + 'a'.repeat(150)
    };
    
    const issues = checker.checkStyle(file);
    
    expect(issues).to.have.length.greaterThan(0);
    expect(issues[0].type).to.equal('style');
    expect(issues[0].message).to.include('長すぎます');
  });
  
  it('varの使用を検出すること', () => {
    const file = {
      filename: 'test.js',
      patch: '+var oldStyle = true;'
    };
    
    const issues = checker.checkBestPractices(file);
    
    expect(issues).to.have.length.greaterThan(0);
    expect(issues[0].message).to.include('var');
  });
});

describe('SecurityScanner', () => {
  let scanner;
  let logger;
  
  beforeEach(() => {
    logger = { info: sinon.stub(), error: sinon.stub() };
    scanner = new SecurityScanner(logger);
  });
  
  it('センシティブな値をマスクすること', () => {
    const value = 'sk-1234567890abcdef';
    const masked = scanner.maskSensitiveValue(value);
    
    expect(masked).to.include('sk');
    expect(masked).to.include('*');
    expect(masked).to.include('ef');
    expect(masked).to.not.include('34567890');
  });
});