#!/usr/bin/env node

/**
 * ダッシュボードが有効な場合のテスト
 */

const DashboardServer = require('../dashboard/server/index');
const ProcessStateManager = require('../src/process-state-manager');
const Logger = require('../src/logger');

console.log('=== ダッシュボード有効化テスト ===\n');

// テスト用の設定（ダッシュボード有効）
const testConfig = {
  dashboard: {
    enabled: true,
    port: 3002,  // テスト用に別ポート
    host: 'localhost',
    updateInterval: 5000
  }
};

// 依存関係の初期化
const logger = new Logger();
const processStateManager = new ProcessStateManager(logger);

console.log('1. DashboardServerインスタンスを作成（dashboard.enabled = true）');
const dashboardServer = new DashboardServer(testConfig, processStateManager, logger);

console.log('\n2. start()メソッドを呼び出し');
dashboardServer.start();

// サーバーが起動するまで少し待つ
setTimeout(() => {
  console.log('\n3. notifyProcessEvent()メソッドを呼び出し');
  dashboardServer.notifyProcessEvent({ type: 'test', data: 'test event' });
  
  console.log('\n4. stop()メソッドを呼び出し');
  dashboardServer.stop();
  
  console.log('\n✅ テスト完了');
  
  // プロセス状態管理を停止
  processStateManager.stop();
  
  process.exit(0);
}, 1000);