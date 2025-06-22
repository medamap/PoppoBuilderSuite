#!/usr/bin/env node

const path = require('path');

// Test environment setup
process.env.GITHUB_TOKEN = 'test-token';
process.env.GITHUB_REPOSITORY = 'medamap/PoppoBuilderSuite';
process.env.NODE_ENV = 'test';

console.log('CCRAエージェント簡易テスト');
console.log('=========================\n');

// Test 1: PRAnalyzer
console.log('1. PRAnalyzerのテスト');
try {
  const PRAnalyzer = require('../agents/ccra/pr-analyzer');
  const analyzer = new PRAnalyzer();
  
  // Test file categorization
  console.log('  ファイルカテゴリ分類:');
  console.log('    test.js:', analyzer.categorizeFile('test.js'));
  console.log('    test.spec.js:', analyzer.categorizeFile('test.spec.js'));
  console.log('    package.json:', analyzer.categorizeFile('package.json'));
  console.log('    README.md:', analyzer.categorizeFile('README.md'));
  
  // Test language detection
  console.log('  言語検出:');
  console.log('    test.js:', analyzer.detectFileLanguage('test.js'));
  console.log('    test.py:', analyzer.detectFileLanguage('test.py'));
  console.log('    test.java:', analyzer.detectFileLanguage('test.java'));
  
  console.log('  ✅ PRAnalyzer: OK\n');
} catch (error) {
  console.error('  ❌ PRAnalyzer: エラー', error.message, '\n');
}

// Test 2: CodeQualityChecker
console.log('2. CodeQualityCheckerのテスト');
try {
  const CodeQualityChecker = require('../agents/ccra/code-quality-checker');
  const checker = new CodeQualityChecker({
    maxComplexity: 10,
    maxNesting: 5,
    maxLineLength: 120
  });
  
  // Test complexity check
  const complexFile = {
    filename: 'test.js',
    patch: `+function complex() {
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
  
  const issues = checker.checkFile(complexFile);
  console.log('  複雑度チェック結果:', issues.length, '個の問題を検出');
  issues.forEach((issue, i) => {
    console.log(`    ${i+1}. ${issue.type}: ${issue.message}`);
  });
  
  console.log('  ✅ CodeQualityChecker: OK\n');
} catch (error) {
  console.error('  ❌ CodeQualityChecker: エラー', error.message, '\n');
}

// Test 3: SecurityScanner
console.log('3. SecurityScannerのテスト');
try {
  const SecurityScanner = require('../agents/ccra/security-scanner');
  const scanner = new SecurityScanner();
  
  // Test credential detection
  const credFile = {
    filename: 'config.js',
    patch: `+const API_KEY = 'sk-1234567890abcdef';
+const password = 'admin123';
+eval(userInput);`
  };
  
  const vulns = scanner.scanFile(credFile);
  console.log('  セキュリティ問題検出結果:', vulns.length, '個の脆弱性を検出');
  vulns.forEach((vuln, i) => {
    console.log(`    ${i+1}. ${vuln.severity}: ${vuln.message}`);
  });
  
  console.log('  ✅ SecurityScanner: OK\n');
} catch (error) {
  console.error('  ❌ SecurityScanner: エラー', error.message, '\n');
}

// Test 4: ReviewGenerator
console.log('4. ReviewGeneratorのテスト');
try {
  const ReviewGenerator = require('../agents/ccra/review-generator');
  
  // Mock Claude client
  const mockClaudeClient = {
    sendMessage: async () => ({ content: 'テストレビューコメント' })
  };
  
  const generator = new ReviewGenerator(mockClaudeClient, { useTemplates: true });
  
  const analysis = {
    prNumber: 123,
    title: 'Test PR',
    fileCount: 3,
    totalChanges: 150,
    hasTests: true,
    insights: ['Small focused change']
  };
  
  console.log('  レビュー生成中...');
  generator.generateReview(analysis, [], [])
    .then(review => {
      console.log('  レビュー生成結果:');
      console.log('    イベント:', review.event);
      console.log('    本文長さ:', review.body.length, '文字');
      console.log('  ✅ ReviewGenerator: OK\n');
    })
    .catch(error => {
      console.error('  ❌ ReviewGenerator: エラー', error.message, '\n');
    });
  
} catch (error) {
  console.error('  ❌ ReviewGenerator: エラー', error.message, '\n');
}

// Test 5: CCRAAgent Integration
console.log('5. CCRAエージェント統合テスト');
try {
  const CCRAAgent = require('../agents/ccra');
  
  // Mock GitHub client
  const mockGitHub = {
    listPullRequests: async () => [],
    getPullRequest: async () => ({
      number: 1,
      title: 'Test PR',
      additions: 50,
      deletions: 20
    }),
    getFiles: async () => [],
    createReview: async () => ({ id: 123 })
  };
  
  // Mock logger
  const mockLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {}
  };
  
  const agent = new CCRAAgent({
    name: 'ccra-test',
    githubClient: mockGitHub,
    logger: mockLogger,
    config: {
      checkInterval: 300000,
      maxFilesPerPR: 100,
      maxPRsPerRun: 10,
      thresholds: {
        maxComplexity: 10,
        maxNesting: 5,
        maxLineLength: 120
      }
    }
  });
  
  console.log('  エージェント初期化: OK');
  console.log('  コンポーネント:');
  console.log('    - PRAnalyzer:', agent.prAnalyzer ? 'OK' : 'NG');
  console.log('    - CodeQualityChecker:', agent.qualityChecker ? 'OK' : 'NG');
  console.log('    - SecurityScanner:', agent.securityScanner ? 'OK' : 'NG');
  console.log('    - ReviewGenerator:', agent.reviewGenerator ? 'OK' : 'NG');
  
  console.log('  ✅ CCRAAgent: OK\n');
} catch (error) {
  console.error('  ❌ CCRAAgent: エラー', error.message, '\n');
}

console.log('\nテスト完了');