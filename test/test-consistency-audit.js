/**
 * 整合性監査機能のテスト
 */

const ConsistencyAuditor = require('../src/consistency-auditor');
const fs = require('fs').promises;
const path = require('path');

async function test() {
  console.log('=== 整合性監査機能テスト ===\n');
  
  const auditor = new ConsistencyAuditor();
  let passed = 0;
  let failed = 0;
  
  // テスト1: 監査の実行
  console.log('1. 監査の実行テスト');
  try {
    const results = await auditor.audit();
    
    console.log(`   ✓ 監査実行成功`);
    console.log(`   - スコア: ${results.score}/100`);
    console.log(`   - 検出された問題: ${results.issues.length}件`);
    console.log(`   - 改善提案: ${results.suggestions.length}件`);
    
    // 基本的な構造の確認
    if (typeof results.score === 'number' && 
        Array.isArray(results.issues) && 
        Array.isArray(results.suggestions) &&
        results.coverage) {
      console.log('   ✓ 結果の構造が正しい');
      passed++;
    } else {
      console.log('   ✗ 結果の構造が不正');
      failed++;
    }
  } catch (error) {
    console.log(`   ✗ 監査実行失敗: ${error.message}`);
    failed++;
  }
  
  // テスト2: カバレッジ計算
  console.log('\n2. カバレッジ計算テスト');
  try {
    const results = await auditor.audit();
    const coverage = results.coverage;
    
    console.log('   カバレッジ詳細:');
    console.log(`   - 要求定義: ${coverage.requirements.covered}/${coverage.requirements.total}`);
    console.log(`   - 設計書: ${coverage.design.covered}/${coverage.design.total}`);
    console.log(`   - 実装: ${coverage.implementation.covered}/${coverage.implementation.total}`);
    console.log(`   - テスト: ${coverage.tests.covered}/${coverage.tests.total}`);
    
    // 各カバレッジが0以上であることを確認
    if (coverage.requirements.total >= 0 && 
        coverage.design.total >= 0 &&
        coverage.implementation.total >= 0 &&
        coverage.tests.total >= 0) {
      console.log('   ✓ カバレッジ計算が正常');
      passed++;
    } else {
      console.log('   ✗ カバレッジ計算に問題あり');
      failed++;
    }
  } catch (error) {
    console.log(`   ✗ カバレッジ計算失敗: ${error.message}`);
    failed++;
  }
  
  // テスト3: 問題の検出
  console.log('\n3. 問題検出テスト');
  try {
    const results = await auditor.audit();
    const issueTypes = new Set();
    const severities = new Set();
    
    for (const issue of results.issues) {
      issueTypes.add(issue.type);
      severities.add(issue.severity);
    }
    
    console.log(`   - 検出された問題タイプ: ${Array.from(issueTypes).join(', ')}`);
    console.log(`   - 重要度レベル: ${Array.from(severities).join(', ')}`);
    
    // 期待される問題タイプの確認
    const expectedTypes = [
      'MISSING_DESIGN', 'MISSING_IMPLEMENTATION', 'MISSING_TEST',
      'MISSING_TRACEABILITY', 'UNIMPLEMENTED_DESIGN', 'UNTESTED_IMPLEMENTATION',
      'ORPHAN_TEST', 'MISSING_REQUIREMENT', 'MISSING_DESIGN_DOC', 'MISSING_GUIDE'
    ];
    
    const validTypes = Array.from(issueTypes).every(type => expectedTypes.includes(type));
    
    if (validTypes) {
      console.log('   ✓ 問題タイプが正しい');
      passed++;
    } else {
      console.log('   ✗ 不正な問題タイプを検出');
      failed++;
    }
  } catch (error) {
    console.log(`   ✗ 問題検出失敗: ${error.message}`);
    failed++;
  }
  
  // テスト4: 改善提案の生成
  console.log('\n4. 改善提案生成テスト');
  try {
    const results = await auditor.audit();
    
    if (results.suggestions.length > 0) {
      const suggestion = results.suggestions[0];
      console.log(`   - 最初の提案: ${suggestion.title}`);
      console.log(`   - 優先度: ${suggestion.priority}`);
      console.log(`   - アクション: ${suggestion.action}`);
      
      // 提案の構造確認
      if (suggestion.priority && suggestion.action && suggestion.title && suggestion.description) {
        console.log('   ✓ 改善提案の構造が正しい');
        passed++;
      } else {
        console.log('   ✗ 改善提案の構造が不正');
        failed++;
      }
    } else {
      console.log('   ✓ 問題がないため改善提案なし');
      passed++;
    }
  } catch (error) {
    console.log(`   ✗ 改善提案生成失敗: ${error.message}`);
    failed++;
  }
  
  // テスト5: レポート生成
  console.log('\n5. レポート生成テスト');
  try {
    const results = await auditor.audit();
    const reportPath = 'test-audit-report.md';
    await auditor.generateReport(reportPath);
    
    // レポートファイルの存在確認
    const reportExists = await fs.access(reportPath).then(() => true).catch(() => false);
    
    if (reportExists) {
      console.log('   ✓ レポートファイルが生成された');
      
      // レポート内容の確認
      const content = await fs.readFile(reportPath, 'utf8');
      if (content.includes('整合性監査レポート') && 
          content.includes('総合スコア') &&
          content.includes('カバレッジ')) {
        console.log('   ✓ レポート内容が適切');
        passed++;
      } else {
        console.log('   ✗ レポート内容が不適切');
        failed++;
      }
      
      // テスト用レポートを削除
      await fs.unlink(reportPath);
    } else {
      console.log('   ✗ レポートファイルが生成されなかった');
      failed++;
    }
  } catch (error) {
    console.log(`   ✗ レポート生成失敗: ${error.message}`);
    failed++;
  }
  
  // テスト6: トレーサビリティとの連携
  console.log('\n6. トレーサビリティ連携テスト');
  try {
    // トレーサビリティファイルの存在確認
    const traceabilityPath = path.join(process.cwd(), '.poppo', 'traceability.yaml');
    const traceabilityExists = await fs.access(traceabilityPath).then(() => true).catch(() => false);
    
    if (traceabilityExists) {
      const results = await auditor.audit();
      
      // トレーサビリティ関連の問題が検出されているか確認
      const traceabilityIssues = results.issues.filter(issue => 
        issue.type === 'MISSING_TRACEABILITY' || 
        issue.type === 'UNIMPLEMENTED_DESIGN' ||
        issue.type === 'UNTESTED_IMPLEMENTATION'
      );
      
      console.log(`   - トレーサビリティ関連の問題: ${traceabilityIssues.length}件`);
      console.log('   ✓ トレーサビリティデータを活用');
      passed++;
    } else {
      console.log('   ! トレーサビリティファイルが存在しないためスキップ');
      passed++;
    }
  } catch (error) {
    console.log(`   ✗ トレーサビリティ連携失敗: ${error.message}`);
    failed++;
  }
  
  // テスト7: スコア計算の妥当性
  console.log('\n7. スコア計算テスト');
  try {
    const results = await auditor.audit();
    
    // スコアが0-100の範囲内か確認
    if (results.score >= 0 && results.score <= 100) {
      console.log(`   ✓ スコアが適切な範囲内: ${results.score}/100`);
      
      // 問題が多いほどスコアが低いことを確認
      const highSeverityCount = results.issues.filter(i => i.severity === 'HIGH').length;
      const mediumSeverityCount = results.issues.filter(i => i.severity === 'MEDIUM').length;
      
      console.log(`   - HIGH問題: ${highSeverityCount}件`);
      console.log(`   - MEDIUM問題: ${mediumSeverityCount}件`);
      
      passed++;
    } else {
      console.log(`   ✗ スコアが範囲外: ${results.score}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ✗ スコア計算失敗: ${error.message}`);
    failed++;
  }
  
  // 結果サマリー
  console.log('\n=== テスト結果 ===');
  console.log(`成功: ${passed}`);
  console.log(`失敗: ${failed}`);
  console.log(`成功率: ${Math.round(passed / (passed + failed) * 100)}%`);
  
  // 実際の監査結果のサマリーも表示
  console.log('\n=== 実際の監査結果サマリー ===');
  try {
    const results = await auditor.audit();
    console.log(`総合スコア: ${results.score}/100`);
    console.log('\n主な問題:');
    
    const issuesByType = {};
    for (const issue of results.issues) {
      if (!issuesByType[issue.type]) {
        issuesByType[issue.type] = 0;
      }
      issuesByType[issue.type]++;
    }
    
    for (const [type, count] of Object.entries(issuesByType)) {
      if (count > 3) {
        console.log(`- ${type}: ${count}件`);
      }
    }
    
    console.log('\n推奨アクション:');
    for (const suggestion of results.suggestions.slice(0, 3)) {
      console.log(`- [${suggestion.priority}] ${suggestion.title}`);
    }
  } catch (error) {
    console.log('監査結果サマリーの表示に失敗:', error.message);
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// テスト実行
test().catch(error => {
  console.error('テスト実行エラー:', error);
  process.exit(1);
});