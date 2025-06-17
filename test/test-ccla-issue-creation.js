#!/usr/bin/env node

/**
 * CCLAエージェントによるIssue作成の統合テスト
 */

const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');

async function createErrorLog() {
  const logFile = path.join(__dirname, '../logs', `poppo-issue-test-${Date.now()}.log`);
  
  const errorLog = `[2025-06-17 03:00:01] [INFO] Issue作成テスト開始
[2025-06-17 03:00:02] [ERROR] TypeError: Cannot read property 'testIssueCreation' of undefined
    at testIssueCreation (/test/test-ccla-issue-creation.js:50:15)
    at async main (/test/test-ccla-issue-creation.js:100:5)
    at async Object.<anonymous> (/test/test-ccla-issue-creation.js:150:1)
[2025-06-17 03:00:03] [INFO] テスト継続中
`;

  await fs.writeFile(logFile, errorLog, 'utf8');
  console.log('✅ テストエラーログを作成しました:', logFile);
  return logFile;
}

async function waitForIssueCreation(timeout = 60000) {
  console.log('\n⏳ Issue作成を待機中...');
  console.log('（CCLAエージェントがエラーを検出し、GitHubにIssueを作成するまで待ちます）\n');
  
  const startTime = Date.now();
  const processedFile = path.join(__dirname, '../.poppo/processed-errors.json');
  
  while (Date.now() - startTime < timeout) {
    try {
      const content = await fs.readFile(processedFile, 'utf8');
      const processed = JSON.parse(content);
      
      for (const [hash, info] of Object.entries(processed)) {
        if (info.issueUrl) {
          console.log('\n🎉 Issueが作成されました！');
          console.log(`   URL: ${info.issueUrl}`);
          console.log(`   ハッシュ: ${hash}`);
          console.log(`   作成日時: ${info.timestamp}`);
          return true;
        }
      }
    } catch (error) {
      // ファイルが存在しない場合は無視
    }
    
    // 1秒待機
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  return false;
}

async function main() {
  console.log('🧪 CCLAエージェントIssue作成統合テスト\n');
  
  try {
    // 1. 処理済みエラーをクリア
    const processedFile = path.join(__dirname, '../.poppo/processed-errors.json');
    await fs.writeFile(processedFile, '{}', 'utf8');
    console.log('✅ 処理済みエラーファイルをクリア');
    
    // 2. テスト用エラーログを作成
    const logFile = await createErrorLog();
    
    // 3. PoppoBuilderをエージェントモードで起動
    console.log('\n🚀 PoppoBuilderをエージェントモードで起動中...');
    const poppo = spawn('node', [
      path.join(__dirname, '../src/minimal-poppo.js')
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, POPPO_TEST_MODE: 'true' }
    });
    
    let poppoReady = false;
    
    poppo.stdout.on('data', (data) => {
      const output = data.toString();
      process.stdout.write('[PoppoBuilder] ' + output);
      
      if (output.includes('エージェント統合の初期化完了')) {
        poppoReady = true;
      }
    });
    
    poppo.stderr.on('data', (data) => {
      process.stderr.write('[PoppoBuilder Error] ' + data.toString());
    });
    
    // PoppoBuilderの初期化を待つ
    await new Promise((resolve) => {
      const checkReady = setInterval(() => {
        if (poppoReady) {
          clearInterval(checkReady);
          resolve();
        }
      }, 100);
    });
    
    // 4. Issue作成を待つ
    const issueCreated = await waitForIssueCreation();
    
    // 5. クリーンアップ
    console.log('\n🧹 クリーンアップ中...');
    poppo.kill('SIGTERM');
    
    await new Promise(resolve => {
      poppo.on('exit', () => {
        console.log('✅ PoppoBuilder停止完了');
        resolve();
      });
    });
    
    // テストログファイルを削除
    await fs.unlink(logFile);
    console.log('✅ テストログファイルを削除');
    
    // 6. 結果表示
    console.log('\n📊 テスト結果:');
    if (issueCreated) {
      console.log('✅ 成功: エラーログが検出され、GitHub Issueが作成されました！');
      console.log('\n💡 次のステップ:');
      console.log('- 作成されたIssueを確認してください');
      console.log('- 必要に応じてIssueをクローズしてください');
    } else {
      console.log('❌ 失敗: タイムアウト - Issueが作成されませんでした');
      console.log('\n💡 確認事項:');
      console.log('- GitHub APIトークンが正しく設定されているか');
      console.log('- レート制限に達していないか');
      console.log('- ネットワーク接続が正常か');
    }
    
  } catch (error) {
    console.error('\n❌ エラー:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}