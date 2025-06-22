#!/usr/bin/env node

/**
 * CCRA (Code Change Review Agent) 簡易動作確認テスト
 * 各コンポーネントが正しく動作することを確認（外部依存なし）
 */

const PRAnalyzer = require('../agents/ccra/pr-analyzer');
const CodeQualityChecker = require('../agents/ccra/code-quality-checker');
const SecurityScanner = require('../agents/ccra/security-scanner');

// モックオブジェクト
const mockLogger = {
  info: (message) => console.log(`[INFO] ${message}`),
  error: (message) => console.error(`[ERROR] ${message}`),
  warn: (message) => console.warn(`[WARN] ${message}`)
};

const mockGitHub = {
  getPullRequest: async (owner, repo, number) => ({
    mergeable: true,
    rebaseable: true
  }),
  
  getPullRequestFiles: async (owner, repo, number) => [
    {
      filename: 'src/test-file.js',
      status: 'modified',
      additions: 50,
      deletions: 10,
      changes: 60,
      patch: `@@ -1,10 +1,50 @@
+const apiKey = 'hardcoded-api-key-12345'; // セキュリティ問題
+const password = 'admin123'; // セキュリティ問題
+
+// 複雑な関数（ネストが深い）
+function complexFunction(data) {
+  if (data) {
+    if (data.type == 'user') { // == の使用
+      if (data.active) {
+        if (data.role) {
+          if (data.permissions) {
+            console.log('Too deep nesting'); // console.logの使用
+            return true;
+          }
+        }
+      }
+    }
+  }
+  return false;
+}
+
+// 重複コード
+function processUser(user) {
+  if (!user) return null;
+  user.name = user.name.trim();
+  user.email = user.email.toLowerCase();
+  return user;
+}
+
+// 重複コード（類似）
+function processAdmin(admin) {
+  if (!admin) return null;
+  admin.name = admin.name.trim();
+  admin.email = admin.email.toLowerCase();
+  return admin;
+}
+
+// varの使用
+var oldVariable = 'should use const or let';
+
+// 未使用の変数
+const unusedVar = 'this is not used';
+
+// 危険な関数
+eval('console.log("dangerous")'); // evalの使用
+
+// HTTPの使用
+const apiUrl = 'http://api.example.com/data'; // HTTPSを使うべき`
    }
  ],
  
  getPullRequestCommits: async (owner, repo, number) => [
    {
      sha: 'abc123',
      commit: {
        message: 'Add new feature with security issues',
        author: {
          name: 'Test Author',
          date: new Date().toISOString()
        },
        verification: { verified: true }
      }
    }
  ]
};

// テスト用のPRデータ
const mockPR = {
  number: 123,
  title: 'Test PR for CCRA verification',
  body: 'This PR contains various code quality and security issues for testing',
  user: { login: 'testuser' },
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  base: {
    ref: 'main',
    repo: { full_name: 'test/repo' }
  },
  head: { ref: 'feature/test' },
  additions: 50,
  deletions: 10,
  draft: false
};

async function runTests() {
  console.log('🔍 CCRA コンポーネント動作確認テスト開始\n');
  
  const results = {
    passed: 0,
    failed: 0,
    errors: []
  };
  
  try {
    // 1. PRAnalyzer のテスト
    console.log('1️⃣ PRAnalyzer のテスト');
    try {
      const prAnalyzer = new PRAnalyzer(mockLogger, mockGitHub);
      const analysis = await prAnalyzer.analyze(mockPR);
      
      // 結果の検証
      if (analysis.stats.files === 1 && 
          analysis.stats.additions === 50 &&
          analysis.stats.deletions === 10 &&
          analysis.files.length === 1 &&
          analysis.commits.length === 1) {
        console.log('✅ PR分析: 成功');
        console.log(`  - ファイル数: ${analysis.stats.files}`);
        console.log(`  - 言語: ${analysis.stats.languages.map(l => l.language).join(', ')}`);
        results.passed++;
      } else {
        throw new Error('分析結果が期待値と異なります');
      }
    } catch (error) {
      console.log('❌ PR分析: 失敗');
      console.error(`  エラー: ${error.message}`);
      results.failed++;
      results.errors.push({ component: 'PRAnalyzer', error: error.message });
    }
    console.log('');
    
    // 2. CodeQualityChecker のテスト
    console.log('2️⃣ CodeQualityChecker のテスト');
    try {
      const qualityChecker = new CodeQualityChecker(mockLogger);
      const analysis = await (new PRAnalyzer(mockLogger, mockGitHub)).analyze(mockPR);
      const qualityResults = await qualityChecker.check(mockPR, analysis.files);
      
      // 結果の検証
      const totalIssues = qualityResults.complexity.length + 
                         qualityResults.duplication.length + 
                         qualityResults.style.length + 
                         qualityResults.bestPractices.length;
      
      if (totalIssues > 0 && qualityResults.overall.score < 100) {
        console.log('✅ 品質チェック: 成功');
        console.log(`  - 品質スコア: ${qualityResults.overall.score}/100`);
        console.log(`  - 検出された問題: ${totalIssues}個`);
        
        // 問題の種類を表示
        const issueTypes = [];
        if (qualityResults.complexity.length > 0) issueTypes.push('複雑度');
        if (qualityResults.duplication.length > 0) issueTypes.push('重複コード');
        if (qualityResults.style.length > 0) issueTypes.push('スタイル');
        if (qualityResults.bestPractices.length > 0) issueTypes.push('ベストプラクティス');
        console.log(`  - 問題の種類: ${issueTypes.join(', ')}`);
        
        results.passed++;
      } else {
        throw new Error('品質問題が検出されませんでした');
      }
    } catch (error) {
      console.log('❌ 品質チェック: 失敗');
      console.error(`  エラー: ${error.message}`);
      results.failed++;
      results.errors.push({ component: 'CodeQualityChecker', error: error.message });
    }
    console.log('');
    
    // 3. SecurityScanner のテスト
    console.log('3️⃣ SecurityScanner のテスト');
    try {
      const securityScanner = new SecurityScanner(mockLogger);
      const analysis = await (new PRAnalyzer(mockLogger, mockGitHub)).analyze(mockPR);
      const securityResults = await securityScanner.scan(mockPR, analysis.files);
      
      // 結果の検証
      const totalVulnerabilities = securityResults.overall.criticalCount +
                                  securityResults.overall.highCount +
                                  securityResults.overall.mediumCount +
                                  securityResults.overall.lowCount;
      
      if (totalVulnerabilities > 0 && !securityResults.overall.secure) {
        console.log('✅ セキュリティスキャン: 成功');
        console.log(`  - 検出された脆弱性: ${totalVulnerabilities}個`);
        console.log(`  - 重大度別: Critical(${securityResults.overall.criticalCount}), ` +
                   `High(${securityResults.overall.highCount}), ` +
                   `Medium(${securityResults.overall.mediumCount}), ` +
                   `Low(${securityResults.overall.lowCount})`);
        
        // 検出された脆弱性の種類
        const vulnTypes = new Set(securityResults.vulnerabilities.map(v => v.category));
        console.log(`  - 脆弱性の種類: ${Array.from(vulnTypes).join(', ')}`);
        
        results.passed++;
      } else {
        throw new Error('セキュリティ問題が検出されませんでした');
      }
    } catch (error) {
      console.log('❌ セキュリティスキャン: 失敗');
      console.error(`  エラー: ${error.message}`);
      results.failed++;
      results.errors.push({ component: 'SecurityScanner', error: error.message });
    }
    console.log('');
    
    // 4. 統合テスト
    console.log('4️⃣ 統合テスト（全コンポーネント連携）');
    try {
      const prAnalyzer = new PRAnalyzer(mockLogger, mockGitHub);
      const qualityChecker = new CodeQualityChecker(mockLogger);
      const securityScanner = new SecurityScanner(mockLogger);
      
      // 順次実行
      const analysis = await prAnalyzer.analyze(mockPR);
      const qualityResults = await qualityChecker.check(mockPR, analysis.files);
      const securityResults = await securityScanner.scan(mockPR, analysis.files);
      
      // 結果の統合検証
      if (analysis && qualityResults && securityResults) {
        console.log('✅ 統合テスト: 成功');
        console.log('  - すべてのコンポーネントが正常に連携しています');
        results.passed++;
      } else {
        throw new Error('コンポーネントの連携に問題があります');
      }
    } catch (error) {
      console.log('❌ 統合テスト: 失敗');
      console.error(`  エラー: ${error.message}`);
      results.failed++;
      results.errors.push({ component: 'Integration', error: error.message });
    }
    
  } catch (error) {
    console.error('\n❌ 予期しないエラーが発生しました:', error);
    results.failed++;
    results.errors.push({ component: 'Global', error: error.message });
  }
  
  // テスト結果サマリー
  console.log('\n=====================================');
  console.log('📊 テスト結果サマリー');
  console.log('=====================================');
  console.log(`✅ 成功: ${results.passed}/4`);
  console.log(`❌ 失敗: ${results.failed}/4`);
  
  if (results.errors.length > 0) {
    console.log('\n❌ エラー詳細:');
    results.errors.forEach(err => {
      console.log(`  - ${err.component}: ${err.error}`);
    });
  }
  
  if (results.passed === 4) {
    console.log('\n🎉 すべてのテストに合格しました！');
    console.log('CCRAエージェントは正常に動作しています。');
  } else {
    console.log('\n⚠️  一部のテストが失敗しました。');
    console.log('エラーを確認して修正してください。');
    process.exit(1);
  }
}

// テスト実行
console.log('=====================================');
console.log('  CCRA エージェント簡易動作確認テスト');
console.log('=====================================\n');

runTests().catch(error => {
  console.error('予期しないエラー:', error);
  process.exit(1);
});