#!/usr/bin/env node

const TraceabilityManager = require('../src/traceability-manager');
const ImpactAnalyzer = require('../src/impact-analyzer');
const fs = require('fs').promises;

const tm = new TraceabilityManager();

async function main() {
  const [,, command, ...args] = process.argv;

  try {
    await tm.load();

    switch (command) {
      case 'add':
        await handleAdd(args);
        break;
      
      case 'link':
        await handleLink(args);
        break;
      
      case 'list':
        await handleList(args);
        break;
      
      case 'matrix':
        await handleMatrix();
        break;
      
      case 'check':
        await handleCheck();
        break;
      
      case 'delete':
        await handleDelete(args);
        break;
      
      case 'update':
        await handleUpdate(args);
        break;
      
      case 'impact':
        await handleImpact(args);
        break;
      
      case 'analyze':
        await handleAnalyze(args);
        break;
      
      case 'help':
      default:
        showHelp();
        break;
    }
  } catch (error) {
    console.error('エラー:', error.message);
    process.exit(1);
  }
}

async function handleAdd([phase, ...titleParts]) {
  if (!phase || titleParts.length === 0) {
    console.error('使用法: trace add <phase> <title>');
    process.exit(1);
  }

  const title = titleParts.join(' ');
  const id = tm.addItem(phase.toUpperCase(), title);
  await tm.save();
  
  console.log(`アイテムを追加しました: ${id} - ${title}`);
}

async function handleLink([fromId, toId, linkType = 'implements']) {
  if (!fromId || !toId) {
    console.error('使用法: trace link <from-id> <to-id> [link-type]');
    process.exit(1);
  }

  tm.addLink(fromId, toId, linkType);
  await tm.save();
  
  console.log(`リンクを作成しました: ${fromId} ${linkType} ${toId}`);
}

async function handleList([phase]) {
  const items = phase ? tm.getItemsByPhase(phase.toUpperCase()) : tm.getAllItems();
  
  if (items.length === 0) {
    console.log('アイテムが見つかりません');
    return;
  }

  console.log('\n登録済みアイテム:');
  console.log('================');
  
  items.forEach(item => {
    console.log(`\n${item.id}: ${item.title}`);
    console.log(`  フェーズ: ${item.phase}`);
    console.log(`  ステータス: ${item.status}`);
    console.log(`  作成日: ${item.created}`);
    
    // リンク情報を表示
    Object.entries(item.links).forEach(([type, ids]) => {
      if (ids.length > 0) {
        console.log(`  ${type}: ${ids.join(', ')}`);
      }
    });
  });
}

async function handleMatrix() {
  const filePath = await tm.exportMatrix();
  console.log(`トレーサビリティマトリックスを生成しました: ${filePath}`);
  
  // コンソールにも簡易表示
  const matrix = tm.generateMatrix();
  console.log('\nトレーサビリティチェーン:');
  matrix.forEach((chain, index) => {
    const chainStr = chain.map(item => `${item.id}`).join(' → ');
    console.log(`${index + 1}. ${chainStr}`);
  });
}

async function handleCheck() {
  const issues = tm.checkConsistency();
  
  if (issues.length === 0) {
    console.log('✅ 整合性チェック: 問題は見つかりませんでした');
    return;
  }

  console.log('\n整合性チェック結果:');
  console.log('==================');
  
  const errors = issues.filter(i => i.type === 'error');
  const warnings = issues.filter(i => i.type === 'warning');
  
  if (errors.length > 0) {
    console.log('\n❌ エラー:');
    errors.forEach(issue => {
      console.log(`  - ${issue.message}`);
    });
  }
  
  if (warnings.length > 0) {
    console.log('\n⚠️  警告:');
    warnings.forEach(issue => {
      console.log(`  - ${issue.message}`);
    });
  }
}

async function handleDelete([itemId]) {
  if (!itemId) {
    console.error('使用法: trace delete <item-id>');
    process.exit(1);
  }

  // 削除前に影響分析を実行
  const analyzer = new ImpactAnalyzer(tm);
  const impact = analyzer.analyzeImpact(itemId, 'delete');
  
  if (impact.affectedItems.length > 0) {
    console.log('\n削除による影響:');
    console.log('==============');
    console.log(`影響を受けるアイテム数: ${impact.summary.total}`);
    console.log('\n影響度別:');
    Object.entries(impact.summary.byLevel).forEach(([level, count]) => {
      if (count > 0) {
        console.log(`  ${level}: ${count}件`);
      }
    });
    
    console.log('\n影響を受けるアイテム:');
    impact.affectedItems.forEach(affected => {
      console.log(`  - ${affected.item.id}: ${affected.item.title} (${affected.impactLevel})`);
    });
    
    // 確認プロンプト
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    const answer = await new Promise(resolve => {
      readline.question('\n本当に削除しますか？ (y/N): ', resolve);
    });
    readline.close();
    
    if (answer.toLowerCase() !== 'y') {
      console.log('削除をキャンセルしました');
      return;
    }
  }

  await tm.deleteItem(itemId);
  console.log(`アイテム ${itemId} を削除しました`);
}

async function handleUpdate([itemId, field, ...valueParts]) {
  if (!itemId || !field || valueParts.length === 0) {
    console.error('使用法: trace update <item-id> <field> <value>');
    console.error('フィールド: title, description, status');
    process.exit(1);
  }

  const value = valueParts.join(' ');
  const updates = { [field]: value };
  
  const item = await tm.updateItem(itemId, updates);
  console.log(`アイテム ${itemId} を更新しました`);
  console.log(`  ${field}: ${value}`);
}

async function handleImpact([itemId, changeType = 'modify']) {
  if (!itemId) {
    console.error('使用法: trace impact <item-id> [change-type]');
    console.error('change-type: modify (デフォルト), delete, add');
    process.exit(1);
  }

  const analyzer = new ImpactAnalyzer(tm);
  const impact = analyzer.analyzeImpact(itemId, changeType);
  
  // コンソールに表示
  console.log('\n影響分析結果:');
  console.log('============');
  console.log(`変更対象: ${impact.sourceItem.id} - ${impact.sourceItem.title}`);
  console.log(`変更種別: ${changeType}`);
  console.log(`影響を受けるアイテム数: ${impact.summary.total}`);
  
  if (impact.summary.total > 0) {
    console.log('\n影響度別:');
    Object.entries(impact.summary.byLevel).forEach(([level, count]) => {
      if (count > 0) {
        console.log(`  ${level}: ${count}件`);
      }
    });
    
    console.log('\n影響を受けるアイテム (高影響度):');
    impact.affectedItems
      .filter(a => a.impactLevel === 'High')
      .forEach(affected => {
        console.log(`  - ${affected.item.id}: ${affected.item.title}`);
        console.log(`    理由: ${affected.reason}`);
        console.log(`    更新必要: ${affected.updateRequired ? 'はい' : 'いいえ'}`);
      });
    
    console.log('\n推奨アクション:');
    impact.recommendations.forEach((rec, index) => {
      console.log(`${index + 1}. [${rec.priority}] ${rec.action}`);
      rec.items.forEach(item => {
        console.log(`   - ${item}`);
      });
    });
  }
  
  // レポートファイルも生成
  const report = analyzer.generateImpactReport(impact);
  const reportPath = `impact-analysis-${itemId}-${Date.now()}.md`;
  await fs.writeFile(reportPath, report, 'utf8');
  console.log(`\n詳細レポートを生成しました: ${reportPath}`);
}

async function handleAnalyze([itemId]) {
  if (!itemId) {
    console.error('使用法: trace analyze <item-id>');
    process.exit(1);
  }

  const analyzer = new ImpactAnalyzer(tm);
  
  // 変更種別ごとの影響を分析
  const changeTypes = ['modify', 'delete'];
  
  console.log(`\nアイテム ${itemId} の影響分析サマリー:`);
  console.log('=====================================');
  
  for (const changeType of changeTypes) {
    const impact = analyzer.analyzeImpact(itemId, changeType);
    console.log(`\n${changeType}時の影響:`);
    console.log(`  影響アイテム数: ${impact.summary.total}`);
    console.log(`  高影響度: ${impact.summary.byLevel.High}件`);
    console.log(`  中影響度: ${impact.summary.byLevel.Medium}件`);
    console.log(`  低影響度: ${impact.summary.byLevel.Low}件`);
  }
}

function showHelp() {
  console.log(`
トレーサビリティ管理ツール

使用法: trace <command> [arguments]

基本コマンド:
  add <phase> <title>              アイテムを追加
  link <from-id> <to-id> [type]    リンクを作成
  list [phase]                     アイテム一覧を表示
  matrix                           マトリックスを生成
  check                            整合性をチェック
  delete <item-id>                 アイテムを削除
  update <item-id> <field> <value> アイテムを更新

影響分析コマンド:
  impact <item-id> [change-type]   影響分析を実行
  analyze <item-id>                総合影響分析

フェーズ:
  REQ   - 要求定義
  SPEC  - 要件定義
  HLD   - 概要設計
  DLD   - 詳細設計
  IMP   - 実装
  TEST  - テスト

リンクタイプ:
  implements    - 実装関係
  references    - 参照関係
  derives_from  - 派生関係
  conflicts_with - 競合関係
  supersedes    - 置き換え関係

例:
  trace add REQ "ユーザー認証機能"
  trace add SPEC "ユーザー認証仕様"
  trace link PBS-SPEC-001 PBS-REQ-001
  trace impact PBS-REQ-001 modify
  `);
}

// メイン処理の実行
main().catch(error => {
  console.error('エラー:', error);
  process.exit(1);
});