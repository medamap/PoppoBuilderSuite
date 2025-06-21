#!/usr/bin/env node
/**
 * WebSocketリアルタイム更新機能のテスト
 */

const WebSocket = require('ws');
const ProcessStateManager = require('../src/process-state-manager');
const DashboardServer = require('../dashboard/server/index');

// テスト用のコンフィグ
const config = {
  dashboard: {
    enabled: true,
    port: 3002,
    host: 'localhost',
    updateInterval: 1000
  }
};

// テスト用のロガー
const logger = {
  info: console.log,
  error: console.error,
  warn: console.warn
};

console.log('WebSocketリアルタイム更新テストを開始します...\n');

// ProcessStateManagerの初期化
const processStateManager = new ProcessStateManager(logger);

// ダッシュボードサーバーの初期化
const dashboardServer = new DashboardServer(config, processStateManager, logger);

// イベントを接続
processStateManager.on('process-added', (process) => {
  console.log('📨 process-added イベント発行:', process.processId);
  dashboardServer.notifyProcessAdded(process);
});

processStateManager.on('process-updated', (process) => {
  console.log('📨 process-updated イベント発行:', process.processId);
  dashboardServer.notifyProcessUpdated(process);
});

processStateManager.on('process-removed', (processId) => {
  console.log('📨 process-removed イベント発行:', processId);
  dashboardServer.notifyProcessRemoved(processId);
});

// サーバーを起動
dashboardServer.start();

// WebSocketクライアントを作成
setTimeout(() => {
  console.log('\nWebSocketクライアントを接続中...');
  const ws = new WebSocket(`ws://localhost:${config.dashboard.port}`);
  
  ws.on('open', () => {
    console.log('✅ WebSocket接続成功\n');
    
    // テストシナリオ実行
    runTestScenario();
  });
  
  ws.on('message', (data) => {
    const message = JSON.parse(data);
    console.log('📥 受信メッセージ:', {
      type: message.type,
      timestamp: message.timestamp,
      data: message.type === 'process-removed' ? message.processId : 
            message.type === 'notification' ? message.notification :
            message.process ? { 
              processId: message.process.processId, 
              issueNumber: message.process.issueNumber,
              status: message.process.status 
            } : message.data
    });
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocketエラー:', error);
  });
  
  ws.on('close', () => {
    console.log('WebSocket接続が閉じられました');
  });
}, 1000);

// テストシナリオ
async function runTestScenario() {
  console.log('テストシナリオを開始します...\n');
  
  // 1. プロセス追加
  console.log('1️⃣ プロセスを追加');
  processStateManager.recordProcessStart('test-001', 123, 'test', 'テストタスク');
  
  await sleep(2000);
  
  // 2. プロセス更新（出力）
  console.log('\n2️⃣ プロセス出力を更新');
  processStateManager.updateProcessOutput('test-001', 'テスト実行中...');
  
  await sleep(2000);
  
  // 3. プロセス更新（メトリクス）
  console.log('\n3️⃣ プロセスメトリクスを更新');
  processStateManager.updateProcessMetrics('test-001', {
    cpuUsage: 25.5,
    memoryUsage: 128.3
  });
  
  await sleep(2000);
  
  // 4. プロセス終了
  console.log('\n4️⃣ プロセスを終了');
  processStateManager.recordProcessEnd('test-001', 'completed', 0);
  
  await sleep(2000);
  
  // 5. 複数プロセスの同時操作
  console.log('\n5️⃣ 複数プロセスを同時に操作');
  processStateManager.recordProcessStart('test-002', 124, 'test', 'テストタスク2');
  processStateManager.recordProcessStart('test-003', 125, 'test', 'テストタスク3');
  
  await sleep(1000);
  
  processStateManager.updateProcessOutput('test-002', '処理中...');
  processStateManager.updateProcessOutput('test-003', '分析中...');
  
  await sleep(2000);
  
  // 6. 通知メッセージテスト
  console.log('\n6️⃣ 通知メッセージを送信');
  dashboardServer.sendNotification({
    type: 'success',
    message: 'すべてのテストが完了しました！'
  });
  
  await sleep(2000);
  
  // 7. ログメッセージテスト
  console.log('\n7️⃣ ログメッセージを送信');
  dashboardServer.sendLogMessage({
    message: 'WebSocketリアルタイム更新が正常に動作しています',
    level: 'info'
  });
  
  await sleep(3000);
  
  console.log('\n✅ テストシナリオ完了');
  console.log('Ctrl+C で終了してください');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
  console.log('\n終了します...');
  dashboardServer.stop();
  process.exit(0);
});