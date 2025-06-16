#!/usr/bin/env node

/**
 * 独立プロセス方式のテスト
 */

const path = require('path');
const fs = require('fs');

// テスト用の設定を読み込み
const config = {
  claude: {
    maxConcurrent: 2,
    timeout: 86400000 // 24時間
  }
};

const IndependentProcessManager = require('../src/independent-process-manager');

// モックのrateLimit とlogger
const mockRateLimiter = {
  async isRateLimited() {
    return { limited: false };
  }
};

const mockLogger = {
  logProcess(taskId, event, data) {
    console.log(`[Logger] ${taskId}: ${event}`, data);
  }
};

async function testIndependentProcess() {
  console.log('🧪 独立プロセス方式のテストを開始');
  
  const processManager = new IndependentProcessManager(config.claude, mockRateLimiter, mockLogger);
  
  // テスト用のInstruction
  const testInstruction = {
    task: 'execute',
    issue: {
      number: 999,
      title: 'テスト用Issue',
      body: '現在の時刻を教えてください。これは独立プロセステストです。',
      type: 'normal'
    },
    context: {
      repository: 'test/test',
      workingDirectory: process.cwd(),
      defaultBranch: 'test',
      systemPrompt: 'あなたはテスト用のAIアシスタントです。日本語で回答してください。'
    }
  };
  
  try {
    console.log('📋 テストタスクを実行中...');
    
    // タスク実行
    const result = await processManager.execute('test-task-1', testInstruction);
    console.log('✅ タスク開始成功:', result);
    
    // 実行状況を表示
    console.log('\n📊 実行状況:');
    const status = processManager.getTaskStatus();
    console.log(JSON.stringify(status, null, 2));
    
    // 30秒間ポーリングして結果を確認
    console.log('\n⏰ 30秒間結果をポーリング...');
    
    for (let i = 0; i < 6; i++) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // 5秒待機
      
      console.log(`[${i + 1}/6] ポーリング中...`);
      const completedResults = await processManager.pollCompletedTasks();
      
      if (completedResults && completedResults.length > 0) {
        console.log('🎯 完了したタスクを発見:');
        for (const result of completedResults) {
          console.log('- タスクID:', result.taskId);
          console.log('- 成功:', result.success);
          console.log('- 出力:', result.output.substring(0, 100) + '...');
        }
        break;
      }
    }
    
    // 最終状況を表示
    console.log('\n📊 最終状況:');
    const finalStatus = processManager.getTaskStatus();
    console.log(JSON.stringify(finalStatus, null, 2));
    
  } catch (error) {
    console.error('❌ テストエラー:', error.message);
  }
  
  console.log('\n🏁 テスト完了');
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n\n🛑 テスト中断 - プロセスをクリーンアップ中...');
  // 実際の使用時にはprocessManager.killAll()を呼ぶ
  process.exit(0);
});

// テスト実行
testIndependentProcess().catch(console.error);