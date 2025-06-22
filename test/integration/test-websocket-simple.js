#!/usr/bin/env node
/**
 * WebSocket簡略化統合テスト
 * - getSystemStats()の実装を前提とした簡潔なテスト
 */

const assert = require('assert');
const WebSocket = require('ws');
const http = require('http');
const express = require('express');

console.log('🔌 WebSocket簡略化テストを開始します...\n');

/**
 * モックStateManager
 */
class MockStateManager {
  constructor() {
    this.processes = new Map();
    this.listeners = new Map();
  }

  getAllProcesses() {
    return Array.from(this.processes.values());
  }

  getRunningProcesses() {
    return this.getAllProcesses().filter(p => p.status === 'running');
  }

  getProcess(processId) {
    return this.processes.get(processId);
  }

  getSystemStats() {
    const processes = this.getAllProcesses();
    const running = processes.filter(p => p.status === 'running').length;
    const completed = processes.filter(p => p.status === 'completed').length;
    const failed = processes.filter(p => p.status === 'failed').length;

    return {
      total: processes.length,
      running,
      completed,
      failed,
      startTime: new Date().toISOString(),
      uptime: process.uptime()
    };
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

  // EventEmitter風のメソッド
  on(event, listener) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event).push(listener);
  }

  removeListener(event, listener) {
    if (this.listeners.has(event)) {
      const listeners = this.listeners.get(event);
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(listener => {
        listener(data);
      });
    }
  }
}

/**
 * 簡易WebSocketサーバー
 */
class SimpleWebSocketServer {
  constructor(port) {
    this.port = port;
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ server: this.server });
    this.stateManager = new MockStateManager();
    this.clients = new Set();

    this.setupRoutes();
    this.setupWebSocket();
  }

  setupRoutes() {
    this.app.get('/api/health', (req, res) => {
      res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    this.app.get('/api/system/stats', (req, res) => {
      res.json(this.stateManager.getSystemStats());
    });

    this.app.get('/api/processes', (req, res) => {
      res.json(this.stateManager.getAllProcesses());
    });
  }

  setupWebSocket() {
    this.wss.on('connection', (ws) => {
      console.log('✅ クライアント接続');
      this.clients.add(ws);

      // 接続確認メッセージを送信
      ws.send(JSON.stringify({
        type: 'connection',
        status: 'connected',
        timestamp: new Date().toISOString()
      }));

      // 初期状態を送信
      ws.send(JSON.stringify({
        type: 'initial',
        data: {
          processes: this.stateManager.getAllProcesses(),
          stats: this.stateManager.getSystemStats()
        }
      }));

      // プロセスイベントリスナーを設定
      const processStartedHandler = (process) => {
        this.broadcast({
          type: 'process-added',
          process: process
        });
      };

      const processUpdatedHandler = (process) => {
        this.broadcast({
          type: 'process-updated',
          process: process
        });
      };

      const processEndedHandler = (process) => {
        this.broadcast({
          type: 'process-removed',
          process: process
        });
      };

      this.stateManager.on('process-started', processStartedHandler);
      this.stateManager.on('process-updated', processUpdatedHandler);
      this.stateManager.on('process-ended', processEndedHandler);

      // クライアント切断時のクリーンアップ
      ws.on('close', () => {
        console.log('👋 クライアント切断');
        this.clients.delete(ws);
        this.stateManager.removeListener('process-started', processStartedHandler);
        this.stateManager.removeListener('process-updated', processUpdatedHandler);
        this.stateManager.removeListener('process-ended', processEndedHandler);
      });

      // エラーハンドリング
      ws.on('error', (error) => {
        console.error('WebSocketエラー:', error);
      });
    });
  }

  broadcast(message) {
    const data = JSON.stringify(message);
    this.clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  }

  start() {
    return new Promise((resolve) => {
      this.server.listen(this.port, () => {
        console.log(`🚀 サーバー起動: http://localhost:${this.port}`);
        resolve();
      });
    });
  }

  stop() {
    return new Promise((resolve) => {
      this.wss.close(() => {
        this.server.close(() => {
          console.log('🛑 サーバー停止');
          resolve();
        });
      });
    });
  }
}

/**
 * テスト実行
 */
async function runTests() {
  let passed = 0;
  let failed = 0;

  // テスト1: 基本的な接続とメッセージ
  console.log('\n📋 テスト1: 基本的な接続とメッセージ');
  let server1 = null;
  let ws1 = null;
  try {
    const port = 3100 + Math.floor(Math.random() * 900);
    server1 = new SimpleWebSocketServer(port);
    await server1.start();

    // WebSocket接続
    ws1 = new WebSocket(`ws://localhost:${port}/ws`);
    
    const messages = [];
    ws1.on('message', (data) => {
      messages.push(JSON.parse(data.toString()));
    });

    // 接続を待機
    await new Promise(resolve => ws1.on('open', resolve));
    await new Promise(resolve => setTimeout(resolve, 100));

    // メッセージを確認
    assert(messages.length >= 2, 'メッセージが受信されていません');
    assert(messages[0].type === 'connection', '接続メッセージが正しくありません');
    assert(messages[1].type === 'initial', '初期メッセージが正しくありません');
    assert(messages[1].data.stats !== undefined, 'statsが含まれていません');

    console.log('✅ 基本的な接続とメッセージが正常に動作しました');
    passed++;
  } catch (error) {
    console.error('❌ エラー:', error.message);
    failed++;
  } finally {
    if (ws1) ws1.close();
    if (server1) await server1.stop();
  }

  // テスト2: プロセス更新のリアルタイム通知
  console.log('\n📋 テスト2: プロセス更新のリアルタイム通知');
  let server2 = null;
  let ws2 = null;
  try {
    const port = 3200 + Math.floor(Math.random() * 900);
    server2 = new SimpleWebSocketServer(port);
    await server2.start();

    // WebSocket接続
    ws2 = new WebSocket(`ws://localhost:${port}/ws`);
    
    const messages = [];
    ws2.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type !== 'connection' && msg.type !== 'initial') {
        messages.push(msg);
      }
    });

    // 接続を待機
    await new Promise(resolve => ws2.on('open', resolve));
    await new Promise(resolve => setTimeout(resolve, 100));

    // プロセスを追加
    server2.stateManager.addProcess({
      processId: 'test-123',
      issueNumber: 123,
      status: 'running',
      startTime: new Date().toISOString()
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // プロセスを更新
    server2.stateManager.updateProcess('test-123', {
      status: 'completed',
      endTime: new Date().toISOString()
    });

    await new Promise(resolve => setTimeout(resolve, 100));

    // メッセージを確認
    assert(messages.length >= 2, 'プロセス更新メッセージが受信されていません');
    
    const addedMsg = messages.find(m => m.type === 'process-added');
    assert(addedMsg, 'process-addedメッセージがありません');
    assert(addedMsg.process.processId === 'test-123', 'プロセスIDが正しくありません');

    const updatedMsg = messages.find(m => m.type === 'process-updated');
    assert(updatedMsg, 'process-updatedメッセージがありません');
    assert(updatedMsg.process.status === 'completed', 'ステータスが更新されていません');

    console.log('✅ プロセス更新のリアルタイム通知が正常に動作しました');
    passed++;
  } catch (error) {
    console.error('❌ エラー:', error.message);
    failed++;
  } finally {
    if (ws2) ws2.close();
    if (server2) await server2.stop();
  }

  // テスト3: 複数クライアントへのブロードキャスト
  console.log('\n📋 テスト3: 複数クライアントへのブロードキャスト');
  let server3 = null;
  let ws3a = null;
  let ws3b = null;
  try {
    const port = 3300 + Math.floor(Math.random() * 900);
    server3 = new SimpleWebSocketServer(port);
    await server3.start();

    // 2つのWebSocket接続
    ws3a = new WebSocket(`ws://localhost:${port}/ws`);
    ws3b = new WebSocket(`ws://localhost:${port}/ws`);
    
    const messagesA = [];
    const messagesB = [];

    ws3a.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'process-added') {
        messagesA.push(msg);
      }
    });

    ws3b.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'process-added') {
        messagesB.push(msg);
      }
    });

    // 両方の接続を待機
    await Promise.all([
      new Promise(resolve => ws3a.on('open', resolve)),
      new Promise(resolve => ws3b.on('open', resolve))
    ]);
    await new Promise(resolve => setTimeout(resolve, 100));

    // プロセスを追加
    server3.stateManager.addProcess({
      processId: 'broadcast-test',
      status: 'running'
    });

    await new Promise(resolve => setTimeout(resolve, 200));

    // 両方のクライアントがメッセージを受信したか確認
    assert(messagesA.length > 0, 'クライアントAがメッセージを受信していません');
    assert(messagesB.length > 0, 'クライアントBがメッセージを受信していません');
    assert(
      messagesA[0].process.processId === messagesB[0].process.processId,
      'クライアント間でメッセージが一致しません'
    );

    console.log('✅ 複数クライアントへのブロードキャストが正常に動作しました');
    passed++;
  } catch (error) {
    console.error('❌ エラー:', error.message);
    failed++;
  } finally {
    if (ws3a) ws3a.close();
    if (ws3b) ws3b.close();
    if (server3) await server3.stop();
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