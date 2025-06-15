#!/usr/bin/env node

const { execSync } = require('child_process');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// PoppoBuilder必須ラベル
const REQUIRED_LABELS = [
  { name: 'task:misc', description: '雑用（即実行）', color: 'aaaaaa' },
  { name: 'task:feature', description: '要求定義から始まる機能開発', color: '1d76db' },
  { name: 'task:fix', description: 'バグ修正タスク', color: 'd73a4a' },
  { name: 'task:docs', description: 'ドキュメント更新タスク', color: '0075ca' },
  { name: 'processing', description: 'PoppoBuilderが処理中', color: '0052CC' },
  { name: 'completed', description: 'PoppoBuilderが処理完了', color: '0E8A16' },
  { name: 'needs:answer', description: 'ユーザーの回答待ち', color: 'd876e3' },
  { name: 'phase:requirements', description: '要求定義フェーズ', color: 'c5def5' },
  { name: 'phase:design', description: '設計フェーズ', color: 'bfd4f2' },
  { name: 'phase:implementation', description: '実装フェーズ', color: 'd4c5f9' },
  { name: 'phase:testing', description: 'テストフェーズ', color: 'f9c5c5' },
  { name: 'phase:waiting-approval', description: '承認待ちフェーズ', color: 'fef2c0' }
];

// デフォルトラベル（削除候補）
const DEFAULT_LABELS = [
  'duplicate',
  'good first issue',
  'invalid',
  'wontfix'
];

async function question(prompt) {
  return new Promise(resolve => {
    rl.question(prompt, answer => {
      resolve(answer.toLowerCase());
    });
  });
}

async function setup() {
  console.log('🚀 PoppoBuilder Suite ラベルセットアップ\n');

  // リポジトリ情報取得
  const repoInfo = execSync('gh repo view --json owner,name').toString();
  const { owner, name } = JSON.parse(repoInfo);
  const repo = `${owner.login}/${name}`;
  
  console.log(`リポジトリ: ${repo}\n`);

  // 必須ラベルの作成
  console.log('📌 必須ラベルを作成中...\n');
  
  for (const label of REQUIRED_LABELS) {
    try {
      execSync(`gh label create "${label.name}" --repo ${repo} --description "${label.description}" --color "${label.color}"`, { stdio: 'pipe' });
      console.log(`✅ ${label.name} - 作成完了`);
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log(`⏭️  ${label.name} - すでに存在`);
      } else {
        console.log(`❌ ${label.name} - エラー: ${error.message}`);
      }
    }
  }

  // デフォルトラベルの削除確認
  console.log('\n📌 デフォルトラベルの処理\n');
  const answer = await question('GitHubのデフォルトラベルを削除しますか？ (y/n): ');
  
  if (answer === 'y' || answer === 'yes') {
    for (const label of DEFAULT_LABELS) {
      try {
        execSync(`gh label delete "${label}" --repo ${repo} --yes`, { stdio: 'pipe' });
        console.log(`🗑️  ${label} - 削除完了`);
      } catch (error) {
        console.log(`⏭️  ${label} - 存在しないかすでに削除済み`);
      }
    }
  } else {
    console.log('デフォルトラベルを保持します。');
  }

  console.log('\n✨ セットアップ完了！');
  rl.close();
}

setup().catch(console.error);