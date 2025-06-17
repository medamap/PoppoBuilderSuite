#!/usr/bin/env node

const TraceabilityManager = require('../src/traceability-manager');
const TraceabilityGitHubSync = require('../src/traceability-github-sync');

async function testGitHubSync() {
  console.log('🧪 GitHub同期機能のテスト開始...\n');

  const tm = new TraceabilityManager('.poppo/test-traceability.yaml');
  const sync = new TraceabilityGitHubSync(tm);

  try {
    // テスト1: ID抽出機能のテスト
    console.log('1️⃣ ID抽出機能のテスト');
    const testText = `
    Issue #52のテスト
    トレーサビリティ機能 PBS-REQ-001 を実装しました。
    PBS-SPEC-001とPBS-IMP-001も関連しています。
    PR #123 も参照してください。
    `;
    
    const ids = sync.extractIdsFromText(testText);
    console.log('  抽出されたID:', ids);
    console.assert(ids.length === 3, 'ID抽出エラー');
    console.assert(ids.includes('PBS-REQ-001'), 'PBS-REQ-001が見つかりません');
    console.log('  ✅ ID抽出: 成功\n');

    // テスト2: Issue/PR番号抽出
    console.log('2️⃣ Issue/PR番号抽出のテスト');
    const refs = sync.extractIssueNumbers(testText);
    console.log('  Issues:', refs.issues);
    console.log('  PRs:', refs.prs);
    console.assert(refs.issues.includes(52), 'Issue #52が見つかりません');
    console.assert(refs.prs.includes(123), 'PR #123が見つかりません');
    console.log('  ✅ 番号抽出: 成功\n');

    // テスト3: トレーサビリティデータの準備
    console.log('3️⃣ テストデータの準備');
    await tm.load();
    
    // テスト用アイテムを追加（存在しない場合）
    try {
      tm.addItem('REQ', 'GitHub連携機能', 'GitHub Issue/PRとの自動連携', 'PBS-REQ-101');
      tm.addItem('SPEC', 'GitHub同期仕様', 'IDの自動抽出と双方向同期', 'PBS-SPEC-101');
      tm.addLink('PBS-SPEC-101', 'PBS-REQ-101', 'implements');
      await tm.save();
      console.log('  ✅ テストアイテム追加: 成功\n');
    } catch (e) {
      console.log('  ℹ️ テストアイテムは既に存在します\n');
    }

    // テスト4: 手動リンク機能
    console.log('4️⃣ 手動リンク機能のテスト');
    const linkedItem = await sync.linkItemToGitHub('PBS-REQ-101', 'issue', 52);
    console.log('  リンク結果:', linkedItem.github);
    console.assert(linkedItem.github.issues.includes(52), 'Issue #52がリンクされていません');
    console.log('  ✅ 手動リンク: 成功\n');

    // テスト5: コミットメッセージからのID抽出
    console.log('5️⃣ コミットメッセージからのID抽出');
    console.log('  最新10件のコミットを確認中...');
    const commitIds = await sync.extractIdsFromCommits(10);
    console.log('  検出されたID数:', commitIds.size);
    if (commitIds.size > 0) {
      console.log('  検出されたID:');
      for (const [id, commits] of commitIds) {
        console.log(`    ${id}: ${commits.join(', ')}`);
      }
    } else {
      console.log('  コミットメッセージにトレーサビリティIDが見つかりませんでした');
    }
    console.log('  ✅ コミット抽出: 成功\n');

    // テスト6: 同期レポート生成
    console.log('6️⃣ 同期レポートの生成');
    const report = await sync.generateSyncReport();
    console.log('  レポート長:', report.length, '文字');
    console.assert(report.includes('GitHub同期レポート'), 'レポートタイトルが見つかりません');
    console.log('  ✅ レポート生成: 成功\n');

    // テスト7: GitHub Issue情報の取得（実際のIssue）
    console.log('7️⃣ 実際のGitHub Issue情報取得テスト');
    try {
      const issueInfo = await sync.getIssueInfo(52);
      if (issueInfo) {
        console.log('  Issue #52:');
        console.log('    タイトル:', issueInfo.title);
        console.log('    状態:', issueInfo.state);
        console.log('    作成者:', issueInfo.author.login);
        console.log('  ✅ Issue情報取得: 成功\n');
      } else {
        console.log('  ⚠️ Issue #52が見つかりませんでした\n');
      }
    } catch (e) {
      console.log('  ⚠️ GitHub CLIが利用できません:', e.message, '\n');
    }

    console.log('✅ すべてのテストが完了しました！');

  } catch (error) {
    console.error('❌ テストエラー:', error);
    process.exit(1);
  }
}

// テストの実行
testGitHubSync().catch(console.error);