#!/usr/bin/env node

/**
 * CCRA (Code Change Review Agent) フル機能確認テスト
 * 実際のPRレビューシナリオをシミュレート
 */

const PRAnalyzer = require('../agents/ccra/pr-analyzer');
const CodeQualityChecker = require('../agents/ccra/code-quality-checker');
const SecurityScanner = require('../agents/ccra/security-scanner');
const ReviewGenerator = require('../agents/ccra/review-generator');

// カラー出力用
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

// モックオブジェクト
const mockLogger = {
  info: (message) => console.log(`${colors.blue}[INFO]${colors.reset} ${message}`),
  error: (message) => console.error(`${colors.red}[ERROR]${colors.reset} ${message}`),
  warn: (message) => console.warn(`${colors.yellow}[WARN]${colors.reset} ${message}`)
};

// 実際のPRに近いモックデータ
const mockGitHub = {
  getPullRequest: async (owner, repo, number) => ({
    mergeable: true,
    rebaseable: true,
    changed_files: 3,
    review_comments: 0,
    comments: 2
  }),
  
  getPullRequestFiles: async (owner, repo, number) => [
    // ファイル1: 新しいAPI実装（セキュリティ問題あり）
    {
      filename: 'src/api/user-api.js',
      status: 'added',
      additions: 45,
      deletions: 0,
      changes: 45,
      patch: `@@ -0,0 +1,45 @@
+const express = require('express');
+const router = express.Router();
+const db = require('../database');
+
+// APIキーをハードコード（重大なセキュリティ問題）
+const API_KEY = 'sk-1234567890abcdef';
+const SECRET_TOKEN = 'super-secret-token-123';
+
+// ユーザー情報取得API
+router.get('/user/:id', async (req, res) => {
+  const userId = req.params.id;
+  
+  // SQLインジェクション脆弱性
+  const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
+  
+  try {
+    const result = await db.query(query);
+    
+    // XSS脆弱性 - HTMLを直接出力
+    res.send(\`<h1>User: \${result.name}</h1>\`);
+  } catch (error) {
+    // エラー情報をそのまま返す（情報漏洩）
+    res.status(500).json({ error: error.message, stack: error.stack });
+  }
+});
+
+// 管理者API（認証なし）
+router.delete('/user/:id', async (req, res) => {
+  // 認証チェックなし
+  const userId = req.params.id;
+  await db.query(\`DELETE FROM users WHERE id = \${userId}\`);
+  res.json({ message: 'User deleted' });
+});
+
+module.exports = router;`
    },
    
    // ファイル2: 複雑なビジネスロジック（品質問題あり）
    {
      filename: 'src/services/order-service.js',
      status: 'modified',
      additions: 80,
      deletions: 20,
      changes: 100,
      patch: `@@ -10,20 +10,80 @@
-function calculateOrderTotal(order) {
-  return order.items.reduce((sum, item) => sum + item.price, 0);
-}
+// 過度に複雑な関数
+function calculateOrderTotal(order, customer, promotions, config) {
+  var total = 0; // varの使用
+  
+  if (order && order.items && order.items.length > 0) {
+    for (let i = 0; i < order.items.length; i++) {
+      const item = order.items[i];
+      
+      if (item.price > 0) {
+        if (customer.type == 'premium') { // == の使用
+          if (item.category === 'electronics') {
+            if (promotions.electronics) {
+              if (promotions.electronics.discount > 0) {
+                total += item.price * (1 - promotions.electronics.discount);
+              } else {
+                total += item.price;
+              }
+            } else {
+              total += item.price * 0.95; // マジックナンバー
+            }
+          } else if (item.category === 'books') {
+            // 重複コード
+            if (promotions.books) {
+              if (promotions.books.discount > 0) {
+                total += item.price * (1 - promotions.books.discount);
+              } else {
+                total += item.price;
+              }
+            } else {
+              total += item.price * 0.90; // マジックナンバー
+            }
+          } else {
+            total += item.price;
+          }
+        } else {
+          total += item.price;
+        }
+      }
+    }
+    
+    // 税金計算（ハードコード）
+    const tax = total * 0.08;
+    total += tax;
+    
+    // 送料計算（マジックナンバー）
+    if (total < 50) {
+      total += 10;
+    }
+  }
+  
+  return total;
+}
+
+// 未使用の変数
+const UNUSED_CONSTANT = 'this is never used';
+
+// console.logの使用
+console.log('Order service loaded');`
    },
    
    // ファイル3: 設定ファイル（セキュリティ設定問題）
    {
      filename: 'config/app-config.json',
      status: 'modified',
      additions: 5,
      deletions: 2,
      changes: 7,
      patch: `@@ -10,8 +10,11 @@
   "server": {
     "port": 3000,
-    "host": "localhost",
-    "secure": true
+    "host": "0.0.0.0",
+    "secure": false,
+    "cors": {
+      "origin": "*",
+      "credentials": true
+    }
   },`
    }
  ],
  
  getPullRequestCommits: async (owner, repo, number) => [
    {
      sha: 'abc123',
      commit: {
        message: 'Add user API endpoints',
        author: {
          name: 'Developer',
          date: new Date(Date.now() - 3600000).toISOString()
        },
        verification: { verified: false }
      }
    },
    {
      sha: 'def456',
      commit: {
        message: 'Fix',  // 不適切なコミットメッセージ
        author: {
          name: 'Developer',
          date: new Date(Date.now() - 1800000).toISOString()
        },
        verification: { verified: false }
      }
    },
    {
      sha: 'ghi789',
      commit: {
        message: 'Update config',
        author: {
          name: 'Developer',
          date: new Date().toISOString()
        },
        verification: { verified: true }
      }
    }
  ]
};

// テスト用のPRデータ
const mockPR = {
  number: 456,
  title: 'Add user management API and update order service',
  body: `## Description
This PR adds new user management API endpoints and refactors the order calculation service.

## Changes
- Added user API endpoints (GET, DELETE)
- Refactored order total calculation to support promotions
- Updated server configuration

## Testing
- [ ] Unit tests added
- [ ] Integration tests passed
- [ ] Security review completed`,
  user: { login: 'developer123' },
  created_at: new Date(Date.now() - 7200000).toISOString(),
  updated_at: new Date().toISOString(),
  base: {
    ref: 'main',
    repo: { full_name: 'company/ecommerce-app' }
  },
  head: { ref: 'feature/user-api' },
  additions: 130,
  deletions: 22,
  draft: false,
  labels: [
    { name: 'enhancement' },
    { name: 'api' }
  ]
};

async function simulateReview() {
  console.log(`${colors.bright}${colors.cyan}🔍 CCRA フルレビューシミュレーション開始${colors.reset}\n`);
  console.log(`${colors.bright}PR #${mockPR.number}: ${mockPR.title}${colors.reset}`);
  console.log(`👤 作成者: ${mockPR.user.login}`);
  console.log(`📅 作成日時: ${new Date(mockPR.created_at).toLocaleString('ja-JP')}`);
  console.log(`📝 変更: +${mockPR.additions} -${mockPR.deletions}\n`);
  
  console.log('=====================================\n');
  
  try {
    // ステップ1: PR分析
    console.log(`${colors.bright}📊 ステップ1: PR分析${colors.reset}`);
    const prAnalyzer = new PRAnalyzer(mockLogger, mockGitHub);
    const analysis = await prAnalyzer.analyze(mockPR);
    
    console.log('✅ 分析完了:');
    console.log(`  - ファイル数: ${analysis.stats.files}`);
    console.log(`  - カテゴリ別:`);
    Object.entries(analysis.stats.changedFiles).forEach(([category, files]) => {
      if (files.length > 0) {
        console.log(`    - ${category}: ${files.length}個`);
      }
    });
    console.log(`  - 使用言語: ${analysis.stats.languages.map(l => `${l.language}(${l.files})`).join(', ')}`);
    
    if (analysis.insights.length > 0) {
      console.log('  - インサイト:');
      analysis.insights.forEach(insight => {
        const icon = insight.severity === 'error' ? '❌' : 
                    insight.severity === 'warning' ? '⚠️' : 'ℹ️';
        console.log(`    ${icon} ${insight.message}`);
      });
    }
    console.log('');
    
    // ステップ2: コード品質チェック
    console.log(`${colors.bright}🔧 ステップ2: コード品質チェック${colors.reset}`);
    const qualityChecker = new CodeQualityChecker(mockLogger);
    const qualityResults = await qualityChecker.check(mockPR, analysis.files);
    
    console.log('✅ 品質チェック完了:');
    console.log(`  - 品質スコア: ${qualityResults.overall.score}/100`);
    
    const qualityIssues = {
      complexity: qualityResults.complexity.length,
      duplication: qualityResults.duplication.length,
      style: qualityResults.style.length,
      bestPractices: qualityResults.bestPractices.length
    };
    
    console.log('  - 検出された問題:');
    Object.entries(qualityIssues).forEach(([type, count]) => {
      if (count > 0) {
        console.log(`    - ${type}: ${count}個`);
      }
    });
    
    // 主な問題を表示
    const majorIssues = [...qualityResults.complexity, ...qualityResults.bestPractices]
      .filter(i => i.severity === 'error' || i.severity === 'warning')
      .slice(0, 3);
    
    if (majorIssues.length > 0) {
      console.log('  - 主な問題:');
      majorIssues.forEach(issue => {
        console.log(`    ⚠️  ${issue.message} (${issue.file})`);
      });
    }
    console.log('');
    
    // ステップ3: セキュリティスキャン
    console.log(`${colors.bright}🔐 ステップ3: セキュリティスキャン${colors.reset}`);
    const securityScanner = new SecurityScanner(mockLogger);
    const securityResults = await securityScanner.scan(mockPR, analysis.files);
    
    console.log('✅ セキュリティスキャン完了:');
    console.log(`  - ステータス: ${securityResults.overall.secure ? 
      `${colors.green}安全${colors.reset}` : 
      `${colors.red}問題あり${colors.reset}`}`);
    
    const severityColors = {
      critical: colors.red,
      high: colors.yellow,
      medium: colors.yellow,
      low: colors.cyan
    };
    
    console.log('  - 脆弱性サマリー:');
    ['critical', 'high', 'medium', 'low'].forEach(severity => {
      const count = securityResults.overall[`${severity}Count`];
      if (count > 0) {
        console.log(`    ${severityColors[severity]}${severity.toUpperCase()}: ${count}個${colors.reset}`);
      }
    });
    
    // 重大な脆弱性を表示
    const criticalVulns = securityResults.vulnerabilities
      .filter(v => v.severity === 'critical' || v.severity === 'high')
      .slice(0, 3);
    
    if (criticalVulns.length > 0) {
      console.log('  - 重大な脆弱性:');
      criticalVulns.forEach(vuln => {
        console.log(`    🚨 ${vuln.message} (${vuln.file})`);
        if (vuln.suggestion) {
          console.log(`       → ${vuln.suggestion}`);
        }
      });
    }
    console.log('');
    
    // ステップ4: レビュー生成（簡易版）
    console.log(`${colors.bright}📝 ステップ4: レビュー生成${colors.reset}`);
    
    // レビュー結果のサマリー
    const mustFix = [];
    const suggestions = [];
    
    // セキュリティ問題を必須修正に追加
    securityResults.vulnerabilities
      .filter(v => v.severity === 'critical' || v.severity === 'high')
      .forEach(v => mustFix.push(v));
    
    // 品質問題を追加
    [...qualityResults.complexity, ...qualityResults.bestPractices]
      .filter(i => i.severity === 'error')
      .forEach(i => mustFix.push(i));
    
    [...qualityResults.style, ...qualityResults.bestPractices]
      .filter(i => i.severity === 'warning')
      .forEach(i => suggestions.push(i));
    
    console.log('✅ レビュー結果:');
    
    // レビュー判定
    let reviewDecision;
    if (mustFix.length > 0) {
      reviewDecision = `${colors.red}❌ CHANGES REQUESTED${colors.reset}`;
    } else if (suggestions.length > 5) {
      reviewDecision = `${colors.yellow}⚠️  COMMENT${colors.reset}`;
    } else {
      reviewDecision = `${colors.green}✅ APPROVED${colors.reset}`;
    }
    
    console.log(`  - 判定: ${reviewDecision}`);
    console.log(`  - 必須修正: ${mustFix.length}個`);
    console.log(`  - 改善提案: ${suggestions.length}個`);
    console.log(`  - インラインコメント: ${mustFix.length + Math.min(suggestions.length, 3)}個`);
    
    // レビューコメントのプレビュー
    console.log('\n📄 レビューコメント（プレビュー）:');
    console.log('-----------------------------------');
    console.log(`## 🔍 コードレビュー結果\n`);
    console.log(`PR #${mockPR.number} のレビューを完了しました。\n`);
    
    if (mustFix.length > 0) {
      console.log(`### ❗ 必須修正項目 (${mustFix.length}個)\n`);
      mustFix.slice(0, 3).forEach((issue, index) => {
        console.log(`${index + 1}. **${issue.message}**`);
        if (issue.suggestion) {
          console.log(`   - ${issue.suggestion}`);
        }
      });
      if (mustFix.length > 3) {
        console.log(`   ... 他${mustFix.length - 3}個`);
      }
    }
    
    if (suggestions.length > 0) {
      console.log(`\n### 💡 改善提案`);
      suggestions.slice(0, 2).forEach(suggestion => {
        console.log(`- ${suggestion.message}`);
      });
    }
    
    console.log('\n-----------------------------------');
    
    // 最終サマリー
    console.log(`\n${colors.bright}📊 最終サマリー${colors.reset}`);
    console.log('=====================================');
    console.log(`レビュー対象: PR #${mockPR.number}`);
    console.log(`判定: ${reviewDecision}`);
    console.log(`\n主な問題:`);
    console.log(`- セキュリティ: ${securityResults.overall.criticalCount + securityResults.overall.highCount}個の重大な問題`);
    console.log(`- コード品質: スコア ${qualityResults.overall.score}/100`);
    console.log(`- ベストプラクティス: ${qualityResults.bestPractices.length}個の違反`);
    
    console.log(`\n${colors.bright}${colors.green}✅ CCRAによるレビューシミュレーション完了！${colors.reset}`);
    
  } catch (error) {
    console.error(`\n${colors.red}❌ エラーが発生しました:${colors.reset}`, error);
    console.error(error.stack);
    process.exit(1);
  }
}

// メイン実行
console.clear();
console.log(`${colors.bright}${colors.magenta}=====================================`);
console.log(`  CCRA - Code Change Review Agent`);
console.log(`  Full Review Simulation`);
console.log(`=====================================${colors.reset}\n`);

simulateReview().catch(error => {
  console.error('予期しないエラー:', error);
  process.exit(1);
});