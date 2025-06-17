#!/usr/bin/env node

/**
 * 整合性監査CLIツール
 * 要求定義、設計、実装、テストの整合性をチェック
 */

const ConsistencyAuditor = require('../src/consistency-auditor');
const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

// コマンドライン引数の解析
const args = process.argv.slice(2);
const command = args[0];

async function main() {
  const auditor = new ConsistencyAuditor();
  
  try {
    switch (command) {
      case 'run':
      case undefined:
        await runAudit(auditor);
        break;
        
      case 'report':
        await generateReport(auditor);
        break;
        
      case 'fix':
        await suggestFixes(auditor);
        break;
        
      case 'coverage':
        await showCoverage(auditor);
        break;
        
      case 'help':
        showHelp();
        break;
        
      default:
        console.error(`不明なコマンド: ${command}`);
        showHelp();
        process.exit(1);
    }
  } catch (error) {
    console.error('エラーが発生しました:', error.message);
    process.exit(1);
  }
}

/**
 * 監査を実行
 */
async function runAudit(auditor) {
  console.log('🔍 整合性監査を開始します...\n');
  
  const results = await auditor.audit();
  
  // 結果のサマリーを表示
  console.log(`📊 総合スコア: ${results.score}/100`);
  console.log('');
  
  // カバレッジを表示
  console.log('📈 カバレッジ:');
  console.log(`  要求定義: ${results.coverage.requirements.covered}/${results.coverage.requirements.total} (${Math.round(results.coverage.requirements.covered / (results.coverage.requirements.total || 1) * 100)}%)`);
  console.log(`  設計書:   ${results.coverage.design.covered}/${results.coverage.design.total} (${Math.round(results.coverage.design.covered / (results.coverage.design.total || 1) * 100)}%)`);
  console.log(`  実装:     ${results.coverage.implementation.covered}/${results.coverage.implementation.total} (${Math.round(results.coverage.implementation.covered / (results.coverage.implementation.total || 1) * 100)}%)`);
  console.log(`  テスト:   ${results.coverage.tests.covered}/${results.coverage.tests.total} (${Math.round(results.coverage.tests.covered / (results.coverage.tests.total || 1) * 100)}%)`);
  console.log('');
  
  // 問題のサマリーを表示
  if (results.issues.length > 0) {
    const issuesBySeverity = {};
    for (const issue of results.issues) {
      if (!issuesBySeverity[issue.severity]) {
        issuesBySeverity[issue.severity] = 0;
      }
      issuesBySeverity[issue.severity]++;
    }
    
    console.log('⚠️  検出された問題:');
    for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']) {
      if (issuesBySeverity[severity]) {
        const emoji = {
          CRITICAL: '🔴',
          HIGH: '🟠',
          MEDIUM: '🟡',
          LOW: '🔵'
        }[severity];
        console.log(`  ${emoji} ${severity}: ${issuesBySeverity[severity]}件`);
      }
    }
    console.log('');
  } else {
    console.log('✅ 問題は検出されませんでした\n');
  }
  
  // 提案がある場合
  if (results.suggestions.length > 0) {
    console.log(`💡 ${results.suggestions.length}件の改善提案があります`);
    console.log('詳細は "npm run audit report" でレポートを生成してください\n');
  }
  
  // スコアに基づいたメッセージ
  if (results.score >= 90) {
    console.log('🎉 素晴らしい！整合性が非常に高い状態です。');
  } else if (results.score >= 80) {
    console.log('👍 良好です。いくつかの改善点はありますが、全体的に整合性が保たれています。');
  } else if (results.score >= 70) {
    console.log('⚡ 改善が必要です。重要な問題から順に対処してください。');
  } else {
    console.log('🚨 緊急の対応が必要です。整合性に重大な問題があります。');
  }
}

/**
 * 詳細レポートを生成
 */
async function generateReport(auditor) {
  console.log('📝 詳細レポートを生成中...\n');
  
  const results = await auditor.audit();
  const reportPath = await auditor.generateReport();
  
  console.log(`✅ レポートを生成しました: ${reportPath}`);
  console.log('');
  
  // レポートの概要を表示
  const reportContent = await fs.readFile(reportPath, 'utf8');
  const lines = reportContent.split('\n');
  console.log('📄 レポートの概要:');
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    console.log(lines[i]);
  }
  if (lines.length > 20) {
    console.log('...\n');
    console.log(`完全なレポートは ${reportPath} を参照してください。`);
  }
}

/**
 * 修正提案を表示
 */
async function suggestFixes(auditor) {
  console.log('🔧 修正提案を生成中...\n');
  
  const results = await auditor.audit();
  
  if (results.suggestions.length === 0) {
    console.log('✅ 現在、修正提案はありません。');
    return;
  }
  
  // 優先度別に提案を表示
  const suggestionsByPriority = {
    HIGH: [],
    MEDIUM: [],
    LOW: []
  };
  
  for (const suggestion of results.suggestions) {
    suggestionsByPriority[suggestion.priority].push(suggestion);
  }
  
  for (const priority of ['HIGH', 'MEDIUM', 'LOW']) {
    const suggestions = suggestionsByPriority[priority];
    if (suggestions.length === 0) continue;
    
    const emoji = {
      HIGH: '🔴',
      MEDIUM: '🟡',
      LOW: '🔵'
    }[priority];
    
    console.log(`${emoji} 優先度 ${priority}:`);
    
    for (const suggestion of suggestions) {
      console.log(`\n  📌 ${suggestion.title}`);
      console.log(`     ${suggestion.description}`);
      
      // アクションに応じた具体的なコマンドを提示
      switch (suggestion.action) {
        case 'CREATE_DESIGN_DOCS':
          console.log('     実行コマンド例:');
          if (suggestion.files) {
            for (const file of suggestion.files.slice(0, 3)) {
              const designName = file.replace('-requirements.md', '-design.md');
              console.log(`       touch docs/design/${designName}`);
            }
            if (suggestion.files.length > 3) {
              console.log(`       ... 他 ${suggestion.files.length - 3} ファイル`);
            }
          }
          break;
          
        case 'CREATE_TESTS':
          console.log('     実行コマンド例:');
          if (suggestion.files) {
            for (const file of suggestion.files.slice(0, 3)) {
              const testName = `test-${path.basename(file, '.js')}.js`;
              console.log(`       touch test/${testName}`);
            }
            if (suggestion.files.length > 3) {
              console.log(`       ... 他 ${suggestion.files.length - 3} ファイル`);
            }
          }
          break;
          
        case 'UPDATE_TRACEABILITY':
          console.log('     実行コマンド例:');
          console.log('       npm run trace link <from-id> <to-id>');
          break;
      }
    }
    console.log('');
  }
  
  console.log('\n💡 ヒント: 各提案の詳細は "npm run audit report" で確認できます。');
}

/**
 * カバレッジ詳細を表示
 */
async function showCoverage(auditor) {
  console.log('📊 カバレッジ詳細を分析中...\n');
  
  const results = await auditor.audit();
  
  // 各カテゴリーの詳細を表示
  const categories = [
    { name: '要求定義', data: results.coverage.requirements },
    { name: '設計書', data: results.coverage.design },
    { name: '実装', data: results.coverage.implementation },
    { name: 'テスト', data: results.coverage.tests }
  ];
  
  for (const category of categories) {
    const percentage = category.data.total > 0 
      ? Math.round(category.data.covered / category.data.total * 100)
      : 100;
    
    console.log(`${category.name}:`);
    console.log(`  総数: ${category.data.total}`);
    console.log(`  カバー済み: ${category.data.covered}`);
    console.log(`  カバレッジ: ${percentage}%`);
    
    // プログレスバーを表示
    const barLength = 40;
    const filledLength = Math.round(barLength * percentage / 100);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    console.log(`  [${bar}]`);
    console.log('');
  }
  
  // 未カバーの項目を表示
  const uncoveredIssues = results.issues.filter(issue => 
    ['MISSING_DESIGN', 'MISSING_IMPLEMENTATION', 'MISSING_TEST'].includes(issue.type)
  );
  
  if (uncoveredIssues.length > 0) {
    console.log('📋 未カバー項目の例:');
    for (const issue of uncoveredIssues.slice(0, 10)) {
      console.log(`  - ${issue.message}`);
    }
    if (uncoveredIssues.length > 10) {
      console.log(`  ... 他 ${uncoveredIssues.length - 10} 項目`);
    }
  }
}

/**
 * ヘルプを表示
 */
function showHelp() {
  console.log(`
整合性監査ツール

使用方法:
  npm run audit [コマンド]

コマンド:
  run      監査を実行（デフォルト）
  report   詳細レポートを生成
  fix      修正提案を表示
  coverage カバレッジ詳細を表示
  help     このヘルプを表示

例:
  npm run audit           # 監査を実行
  npm run audit report    # 詳細レポートを生成
  npm run audit fix       # 修正提案を確認
  npm run audit coverage  # カバレッジ詳細を表示
`);
}

// メイン処理を実行
main().catch(error => {
  console.error('エラー:', error);
  process.exit(1);
});