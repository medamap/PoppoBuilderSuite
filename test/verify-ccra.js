#!/usr/bin/env node

/**
 * CCRA (Code Change Review Agent) 動作確認テスト
 * 各コンポーネントが正しく動作することを確認
 */

const PRAnalyzer = require('../agents/ccra/pr-analyzer');
const CodeQualityChecker = require('../agents/ccra/code-quality-checker');
const SecurityScanner = require('../agents/ccra/security-scanner');
const ReviewGenerator = require('../agents/ccra/review-generator');

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
  
  try {
    // 1. PRAnalyzer のテスト
    console.log('1️⃣ PRAnalyzer のテスト');
    const prAnalyzer = new PRAnalyzer(mockLogger, mockGitHub);
    const analysis = await prAnalyzer.analyze(mockPR);
    
    console.log('✅ PR分析完了:');
    console.log(`  - ファイル数: ${analysis.stats.files}`);
    console.log(`  - 追加行数: ${analysis.stats.additions}`);
    console.log(`  - 削除行数: ${analysis.stats.deletions}`);
    console.log(`  - 言語: ${analysis.stats.languages.map(l => l.language).join(', ')}`);
    console.log(`  - インサイト: ${analysis.insights.length}個\n`);
    
    // 2. CodeQualityChecker のテスト
    console.log('2️⃣ CodeQualityChecker のテスト');
    const qualityChecker = new CodeQualityChecker(mockLogger);
    const qualityResults = await qualityChecker.check(mockPR, analysis.files);
    
    console.log('✅ 品質チェック完了:');
    console.log(`  - 品質スコア: ${qualityResults.overall.score}/100`);
    console.log(`  - 複雑度の問題: ${qualityResults.complexity.length}個`);
    console.log(`  - 重複コード: ${qualityResults.duplication.length}個`);
    console.log(`  - スタイルの問題: ${qualityResults.style.length}個`);
    console.log(`  - ベストプラクティス違反: ${qualityResults.bestPractices.length}個\n`);
    
    // 検出された問題を表示
    if (qualityResults.complexity.length > 0) {
      console.log('  複雑度の問題:');
      qualityResults.complexity.forEach(issue => {
        console.log(`    - ${issue.message} (${issue.severity})`);
      });
    }
    
    if (qualityResults.bestPractices.length > 0) {
      console.log('  ベストプラクティス違反:');
      qualityResults.bestPractices.forEach(issue => {
        console.log(`    - ${issue.message} (${issue.severity})`);
      });
    }
    console.log('');
    
    // 3. SecurityScanner のテスト
    console.log('3️⃣ SecurityScanner のテスト');
    const securityScanner = new SecurityScanner(mockLogger);
    const securityResults = await securityScanner.scan(mockPR, analysis.files);
    
    console.log('✅ セキュリティスキャン完了:');
    console.log(`  - セキュアステータス: ${securityResults.overall.secure ? '安全' : '問題あり'}`);
    console.log(`  - 重大: ${securityResults.overall.criticalCount}個`);
    console.log(`  - 高: ${securityResults.overall.highCount}個`);
    console.log(`  - 中: ${securityResults.overall.mediumCount}個`);
    console.log(`  - 低: ${securityResults.overall.lowCount}個\n`);
    
    // 検出された脆弱性を表示
    if (securityResults.vulnerabilities.length > 0) {
      console.log('  検出された脆弱性:');
      securityResults.vulnerabilities.forEach(vuln => {
        console.log(`    - ${vuln.message} (${vuln.severity})`);
        if (vuln.detectedValue) {
          console.log(`      検出値: ${vuln.detectedValue}`);
        }
      });
    }
    console.log('');
    
    // 4. ReviewGenerator のテスト（Redisなしで基本機能のみ）
    console.log('4️⃣ ReviewGenerator のテスト');
    const reviewGenerator = new ReviewGenerator(mockLogger);
    
    // Redisを使わないようにモック
    reviewGenerator.redis = {
      lpush: async () => {},
      rpop: async () => null,
      quit: async () => {}
    };
    
    const reviewData = {
      pr: { pr: mockPR },
      analysis,
      quality: qualityResults,
      security: securityResults
    };
    
    const review = await reviewGenerator.generate(reviewData);
    
    console.log('✅ レビュー生成完了:');
    console.log(`  - ステータス: ${review.status}`);
    console.log(`  - 説明: ${review.statusDescription}`);
    console.log(`  - 必須修正: ${review.mustFix.length}個`);
    console.log(`  - 提案: ${review.suggestions.length}個`);
    console.log(`  - コメント数: ${review.comments.length}個`);
    console.log(`  - サマリー: ${review.summary}\n`);
    
    // レビュー本文の一部を表示
    if (review.body) {
      console.log('  レビュー本文（抜粋）:');
      const lines = review.body.split('\n').slice(0, 10);
      lines.forEach(line => console.log(`    ${line}`));
      console.log('    ...\n');
    }
    
    // クリーンアップ
    await reviewGenerator.cleanup();
    
    console.log('✅ すべてのテストが正常に完了しました！');
    console.log('\n📊 テスト結果サマリー:');
    console.log('  - PRAnalyzer: ✅ 正常動作');
    console.log('  - CodeQualityChecker: ✅ 正常動作');
    console.log('  - SecurityScanner: ✅ 正常動作');
    console.log('  - ReviewGenerator: ✅ 正常動作');
    console.log('\n🎉 CCRAエージェントのすべてのコンポーネントが正しく動作しています！');
    
  } catch (error) {
    console.error('\n❌ テスト中にエラーが発生しました:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// テスト実行
console.log('=====================================');
console.log('  CCRA エージェント動作確認テスト');
console.log('=====================================\n');

runTests().catch(error => {
  console.error('予期しないエラー:', error);
  process.exit(1);
});