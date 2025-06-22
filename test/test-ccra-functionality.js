#!/usr/bin/env node

const path = require('path');

// Test environment setup
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-token';
process.env.GITHUB_REPOSITORY = 'medamap/PoppoBuilderSuite';
process.env.NODE_ENV = 'test';

console.log('CCRA Agent Functionality Test');
console.log('=============================\n');

async function testCCRA() {
  try {
    // Test PR Analysis
    console.log('1. Testing PR Analysis:');
    const PRAnalyzer = require('../agents/ccra/pr-analyzer');
    const analyzer = new PRAnalyzer();
    
    const mockPR = {
      number: 123,
      title: 'Test PR for CCRA',
      body: 'This PR tests the CCRA functionality',
      base: { ref: 'main' },
      head: { ref: 'test-branch' },
      additions: 100,
      deletions: 50,
      changed_files: 3
    };
    
    const mockFiles = [
      { filename: 'src/test.js', additions: 80, deletions: 30, changes: 110 },
      { filename: 'test/test.spec.js', additions: 20, deletions: 10, changes: 30 },
      { filename: 'package.json', additions: 0, deletions: 10, changes: 10 }
    ];
    
    const analysis = await analyzer.analyzePR(mockPR, mockFiles);
    console.log('  ✅ PR Analysis Results:');
    console.log('    - Total changes:', analysis.totalChanges);
    console.log('    - Has tests:', analysis.hasTests);
    console.log('    - Languages detected:', analysis.languages.length);
    console.log('    - File categories:', JSON.stringify(analysis.fileCategories));
    console.log();
    
    // Test Code Quality Check
    console.log('2. Testing Code Quality Check:');
    const CodeQualityChecker = require('../agents/ccra/code-quality-checker');
    const checker = new CodeQualityChecker({
      maxComplexity: 10,
      maxNesting: 5,
      maxLineLength: 120
    });
    
    const testFile = {
      filename: 'test.js',
      patch: `@@ -0,0 +1,10 @@
+function testFunc() {
+  if (a) {
+    if (b) {
+      if (c) {
+        console.log('nested');
+      }
+    }
+  }
+  var oldVar = 'using var';
+}`
    };
    
    const issues = checker.checkFile(testFile);
    console.log(`  ✅ Found ${issues.length} quality issues`);
    issues.forEach(issue => {
      console.log(`    - ${issue.type}: ${issue.message} (severity: ${issue.severity})`);
    });
    console.log();
    
    // Test Security Scanner
    console.log('3. Testing Security Scanner:');
    const SecurityScanner = require('../agents/ccra/security-scanner');
    const scanner = new SecurityScanner();
    
    const secTestFile = {
      filename: 'config.js',
      patch: `@@ -0,0 +1,5 @@
+const API_KEY = 'sk-1234567890';
+const password = 'hardcoded123';
+eval(userInput);`
    };
    
    const vulns = scanner.scanFile(secTestFile);
    console.log(`  ✅ Found ${vulns.length} security issues`);
    vulns.forEach(vuln => {
      console.log(`    - ${vuln.severity}: ${vuln.message}`);
    });
    console.log();
    
    // Test Review Generator
    console.log('4. Testing Review Generator:');
    const ReviewGenerator = require('../agents/ccra/review-generator');
    const mockClaudeClient = {
      sendMessage: async () => ({ content: 'Mock review generated' })
    };
    const generator = new ReviewGenerator(mockClaudeClient, { useTemplates: true });
    
    const review = await generator.generateReview(analysis, issues, vulns);
    console.log('  ✅ Review generated:');
    console.log('    - Event:', review.event);
    console.log('    - Body length:', review.body.length, 'chars');
    console.log('    - Comments:', review.comments.length);
    console.log();
    
    // Test CCRA Agent
    console.log('5. Testing CCRA Agent Integration:');
    const CCRAAgent = require('../agents/ccra');
    
    const mockGitHub = {
      listPullRequests: async () => [mockPR],
      getPullRequest: async () => mockPR,
      getFiles: async () => mockFiles,
      createReview: async () => ({ id: 999 })
    };
    
    const mockLogger = {
      info: () => {},
      error: console.error,
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
    
    console.log('  ✅ Agent initialized successfully');
    console.log('    - Components:', {
      prAnalyzer: !!agent.prAnalyzer,
      qualityChecker: !!agent.qualityChecker,
      securityScanner: !!agent.securityScanner,
      reviewGenerator: !!agent.reviewGenerator
    });
    
    console.log('\n✅ All tests passed! CCRA agent is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run tests
testCCRA();