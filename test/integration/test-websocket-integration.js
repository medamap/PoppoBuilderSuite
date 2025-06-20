#!/usr/bin/env node
/**
 * WebSocketリアルタイム更新統合テスト
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs').promises;
const WebSocket = require('ws');
const TestHelper = require('./test-helper');

async function runTests() {
  const helper = new TestHelper();
  let passed = 0;
  let failed = 0;

  console.log('🔌 WebSocket統合テストを開始します...\n');

  try {
    // テスト1: ダッシュボードサーバーの起動確認
    console.log('📋 テスト1: ダッシュボードサーバーの起動確認');
    try {
      const tempDir = await helper.createTempDir('dashboard-');
      const config = helper.createTestConfig({
        dashboard: {
          enabled: true,
          port: 3001 + Math.floor(Math.random() * 1000),
          auth: {
            enabled: false
          }
        }
      });

      // 設定ファイルを作成
      const configPath = path.join(tempDir, 'config.json');
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));

      // ダッシュボードサーバーを起動
      const { proc } = await helper.startProcess('node', [
        path.join(__dirname, '../../dashboard/server/index.js')
      ], {
        env: {
          ...process.env,
          CONFIG_PATH: configPath,
          PORT: config.dashboard.port
        }
      });

      // サーバーの起動を待機
      await helper.wait(2000);

      // HTTPリクエストでヘルスチェック
      const response = await helper.httpRequest(
        `http://localhost:${config.dashboard.port}/api/health`
      );
      
      assert(response.statusCode === 200, 'ヘルスチェックが失敗しました');
      const health = JSON.parse(response.body);
      assert(health.status === 'ok', 'ステータスが正しくありません');

      console.log('✅ ダッシュボードサーバーが正常に起動しました');
      passed++;
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト2: WebSocket接続の確立
    console.log('\n📋 テスト2: WebSocket接続の確立');
    let ws = null;
    try {
      const port = 3001 + Math.floor(Math.random() * 1000);
      const tempDir = await helper.createTempDir('ws-');
      const config = helper.createTestConfig({
        dashboard: { enabled: true, port, auth: { enabled: false } }
      });

      // 設定ファイルを作成
      await fs.writeFile(
        path.join(tempDir, 'config.json'),
        JSON.stringify(config, null, 2)
      );

      // ProcessStateManagerのモックを作成
      const mockStateManager = {
        getAllProcesses: () => [],
        on: () => {},
        removeListener: () => {}
      };

      // ダッシュボードサーバーを起動（モックを使用）
      const DashboardServer = require('../../dashboard/server/index');
      const server = new DashboardServer(config, mockStateManager, console);
      await server.start();

      // WebSocket接続を作成
      ws = await helper.createWebSocket(`ws://localhost:${port}/ws`);
      
      // 接続確認メッセージを待機
      const message = await new Promise((resolve) => {
        ws.once('message', (data) => {
          resolve(JSON.parse(data.toString()));
        });
      });

      assert(message.type === 'connection', '接続メッセージが正しくありません');
      assert(message.status === 'connected', 'ステータスが正しくありません');

      console.log('✅ WebSocket接続が正常に確立されました');
      passed++;

      // サーバーを停止
      await server.stop();
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    } finally {
      if (ws) ws.close();
    }

    // テスト3: リアルタイム更新の動作確認
    console.log('\n📋 テスト3: リアルタイム更新の動作確認');
    try {
      const port = 3001 + Math.floor(Math.random() * 1000);
      const tempDir = await helper.createTempDir('realtime-');
      const config = helper.createTestConfig({
        dashboard: { enabled: true, port, auth: { enabled: false } }
      });

      // 設定ファイルを作成
      await fs.writeFile(
        path.join(tempDir, 'config.json'),
        JSON.stringify(config, null, 2)
      );

      // ProcessStateManagerのモックを作成（EventEmitter機能付き）
      const EventEmitter = require('events');
      class MockStateManager extends EventEmitter {
        constructor() {
          super();
          this.processes = new Map();
        }

        getAllProcesses() {
          return Array.from(this.processes.values());
        }

        addProcess(process) {
          this.processes.set(process.processId, process);
          this.emit('process-started', process);
        }

        updateProcess(processId, updates) {
          const process = this.processes.get(processId);
          if (process) {
            Object.assign(process, updates);
            this.emit('process-updated', process);
          }
        }

        removeProcess(processId) {
          const process = this.processes.get(processId);
          if (process) {
            this.processes.delete(processId);
            this.emit('process-ended', process);
          }
        }
      }

      const mockStateManager = new MockStateManager();

      // ダッシュボードサーバーを起動
      const DashboardServer = require('../../dashboard/server/index');
      const server = new DashboardServer(config, mockStateManager, console);
      await server.start();

      // WebSocket接続を作成
      const ws = await helper.createWebSocket(`ws://localhost:${port}/ws`);
      
      // メッセージを収集
      const messages = [];
      ws.on('message', (data) => {
        messages.push(JSON.parse(data.toString()));
      });

      // 接続メッセージを待機
      await helper.wait(100);

      // プロセス追加をシミュレート
      mockStateManager.addProcess({
        processId: 'test-123',
        issueNumber: 123,
        status: 'running',
        startTime: new Date().toISOString()
      });

      // メッセージを待機
      await helper.wait(500);

      // プロセス更新をシミュレート
      mockStateManager.updateProcess('test-123', {
        status: 'completed',
        endTime: new Date().toISOString()
      });

      // メッセージを待機
      await helper.wait(500);

      // メッセージを検証
      const addedMsg = messages.find(m => m.type === 'process-added');
      assert(addedMsg, 'process-addedメッセージが受信されませんでした');
      assert(addedMsg.process.processId === 'test-123', 'プロセスIDが正しくありません');

      const updatedMsg = messages.find(m => m.type === 'process-updated');
      assert(updatedMsg, 'process-updatedメッセージが受信されませんでした');
      assert(updatedMsg.process.status === 'completed', 'ステータスが更新されていません');

      console.log('✅ リアルタイム更新が正常に動作しました');
      passed++;

      // クリーンアップ
      ws.close();
      await server.stop();
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト4: 差分更新の動作確認
    console.log('\n📋 テスト4: 差分更新の動作確認');
    try {
      const port = 3001 + Math.floor(Math.random() * 1000);
      const EventEmitter = require('events');
      
      class MockStateManager extends EventEmitter {
        constructor() {
          super();
          this.processes = new Map([
            ['proc-1', { processId: 'proc-1', status: 'running', output: 'initial' }],
            ['proc-2', { processId: 'proc-2', status: 'running', output: 'initial' }]
          ]);
        }

        getAllProcesses() {
          return Array.from(this.processes.values());
        }
      }

      const mockStateManager = new MockStateManager();
      const config = helper.createTestConfig({
        dashboard: { enabled: true, port, auth: { enabled: false } }
      });

      // サーバーを起動
      const DashboardServer = require('../../dashboard/server/index');
      const server = new DashboardServer(config, mockStateManager, console);
      await server.start();

      // WebSocket接続
      const ws = await helper.createWebSocket(`ws://localhost:${port}/ws`);
      
      const messages = [];
      ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'connection') {
          messages.push(msg);
        }
      });

      // 初期状態を受信
      await helper.wait(500);

      // プロセスを更新
      mockStateManager.processes.get('proc-1').output = 'updated';
      mockStateManager.emit('process-updated', mockStateManager.processes.get('proc-1'));

      await helper.wait(500);

      // 差分更新メッセージを確認
      const updateMsg = messages.find(m => 
        m.type === 'process-updated' && 
        m.process.processId === 'proc-1'
      );
      
      assert(updateMsg, '差分更新メッセージが受信されませんでした');
      assert(updateMsg.process.output === 'updated', '出力が更新されていません');

      console.log('✅ 差分更新が正常に動作しました');
      passed++;

      ws.close();
      await server.stop();
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

    // テスト5: 複数クライアントの同期
    console.log('\n📋 テスト5: 複数クライアントの同期');
    try {
      const port = 3001 + Math.floor(Math.random() * 1000);
      const EventEmitter = require('events');
      
      class MockStateManager extends EventEmitter {
        constructor() {
          super();
          this.processes = new Map();
        }

        getAllProcesses() {
          return Array.from(this.processes.values());
        }

        addProcess(process) {
          this.processes.set(process.processId, process);
          this.emit('process-started', process);
        }
      }

      const mockStateManager = new MockStateManager();
      const config = helper.createTestConfig({
        dashboard: { enabled: true, port, auth: { enabled: false } }
      });

      // サーバーを起動
      const DashboardServer = require('../../dashboard/server/index');
      const server = new DashboardServer(config, mockStateManager, console);
      await server.start();

      // 複数のWebSocket接続を作成
      const ws1 = await helper.createWebSocket(`ws://localhost:${port}/ws`);
      const ws2 = await helper.createWebSocket(`ws://localhost:${port}/ws`);
      
      const messages1 = [];
      const messages2 = [];
      
      ws1.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'connection') messages1.push(msg);
      });
      
      ws2.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.type !== 'connection') messages2.push(msg);
      });

      // 接続を待機
      await helper.wait(500);

      // プロセスを追加
      mockStateManager.addProcess({
        processId: 'sync-test',
        status: 'running'
      });

      // メッセージを待機
      await helper.wait(500);

      // 両方のクライアントがメッセージを受信したか確認
      assert(messages1.length > 0, 'クライアント1がメッセージを受信していません');
      assert(messages2.length > 0, 'クライアント2がメッセージを受信していません');
      
      const msg1 = messages1.find(m => m.type === 'process-added');
      const msg2 = messages2.find(m => m.type === 'process-added');
      
      assert(msg1 && msg2, '両方のクライアントがprocess-addedを受信していません');
      assert(
        msg1.process.processId === msg2.process.processId,
        'クライアント間でデータが一致しません'
      );

      console.log('✅ 複数クライアントの同期が正常に動作しました');
      passed++;

      ws1.close();
      ws2.close();
      await server.stop();
    } catch (error) {
      console.error('❌ エラー:', error.message);
      failed++;
    }

  } finally {
    // クリーンアップ
    await helper.cleanup();
  }

  // 結果サマリー
  console.log('\n📊 テスト結果サマリー');
  console.log(`✅ 成功: ${passed}`);
  console.log(`❌ 失敗: ${failed}`);
  console.log(`🏁 合計: ${passed + failed}`);

  process.exit(failed > 0 ? 1 : 0);
}

// テスト実行
runTests().catch(error => {
  console.error('致命的なエラー:', error);
  process.exit(1);
});