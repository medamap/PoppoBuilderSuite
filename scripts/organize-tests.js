#!/usr/bin/env node

/**
 * テストファイルを整理するスクリプト
 * test/ディレクトリ直下のファイルをカテゴリ別に整理
 */

const fs = require('fs');
const path = require('path');

const TEST_DIR = path.join(__dirname, '../test');

// カテゴリの定義
const categories = {
  unit: {
    pattern: /^(test-)?(.*)\.(test|spec)\.js$/,
    exclude: ['integration', 'e2e', 'performance', 'dangerous']
  },
  integration: {
    pattern: /integration|redis|websocket|github/i,
    exclude: []
  },
  agents: {
    pattern: /cc[a-z]{2}|agent/i,
    exclude: []
  },
  security: {
    pattern: /security|auth|rbac|jwt/i,
    exclude: []
  },
  helpers: {
    pattern: /helper|setup|mock|fixture/i,
    exclude: []
  },
  dangerous: {
    pattern: /dangerous|cleanup|destructive/i,
    exclude: []
  }
};

// 実行関数
async function organizeTests() {
  console.log('📁 テストファイルの整理を開始します...\n');

  // test/ディレクトリのファイル一覧を取得
  const files = fs.readdirSync(TEST_DIR).filter(file => {
    const fullPath = path.join(TEST_DIR, file);
    return fs.statSync(fullPath).isFile() && file.endsWith('.js');
  });

  console.log(`📊 ${files.length}個のテストファイルを発見しました\n`);

  // カテゴリごとにファイルを分類
  const categorized = {
    unit: [],
    integration: [],
    agents: [],
    security: [],
    helpers: [],
    dangerous: [],
    misc: []
  };

  files.forEach(file => {
    let assigned = false;

    // 各カテゴリにマッチするかチェック
    for (const [category, config] of Object.entries(categories)) {
      if (config.pattern.test(file)) {
        // 除外パターンをチェック
        const excluded = config.exclude.some(exc => file.includes(exc));
        if (!excluded) {
          categorized[category].push(file);
          assigned = true;
          break;
        }
      }
    }

    // どのカテゴリにも属さない場合
    if (!assigned) {
      categorized.misc.push(file);
    }
  });

  // 結果を表示
  console.log('📋 分類結果:\n');
  for (const [category, files] of Object.entries(categorized)) {
    if (files.length > 0) {
      console.log(`${category}/ (${files.length}ファイル)`);
      files.forEach(file => console.log(`  - ${file}`));
      console.log('');
    }
  }

  // ユーザーに確認
  console.log('⚠️  この操作により、テストファイルが移動されます。');
  console.log('実行しますか？ (y/N): ');

  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('', (answer) => {
    if (answer.toLowerCase() === 'y') {
      // ディレクトリ作成とファイル移動
      for (const [category, files] of Object.entries(categorized)) {
        if (files.length > 0 && category !== 'misc') {
          const categoryDir = path.join(TEST_DIR, category);
          
          // ディレクトリ作成
          if (!fs.existsSync(categoryDir)) {
            fs.mkdirSync(categoryDir, { recursive: true });
            console.log(`✅ ディレクトリ作成: ${category}/`);
          }

          // ファイル移動
          files.forEach(file => {
            const oldPath = path.join(TEST_DIR, file);
            const newPath = path.join(categoryDir, file);
            
            try {
              fs.renameSync(oldPath, newPath);
              console.log(`📦 移動: ${file} → ${category}/${file}`);
            } catch (error) {
              console.error(`❌ 移動失敗: ${file} - ${error.message}`);
            }
          });
        }
      }

      console.log('\n✅ テストファイルの整理が完了しました！');
    } else {
      console.log('❌ 操作をキャンセルしました');
    }
    
    rl.close();
  });
}

// 実行
organizeTests().catch(error => {
  console.error('エラーが発生しました:', error);
  process.exit(1);
});