const assert = require('assert');
const { MessageQueue, MessageSchema, CompatibilityLayer, EventBus } = require('../agents/shared/messaging');
const fs = require('fs').promises;
const path = require('path');

describe('メッセージキューシステム', () => {
  let messageQueue;
  let messageSchema;
  let sandbox;
  let compatibilityLayer;
  let eventBus;
  
  // テスト用設定
  const testConfig = {
    redis: {
      host: 'localhost',
      port: 6379,
      db: 15  // テスト用DB
    },
    enableMonitoring: true
  };
  
  before(async () => {
    // Redis接続確認
    try {
      messageQueue = new MessageQueue(testConfig);
      const queue = messageQueue.getQueue('test-queue');
      await queue.isReady();
    } catch (error) {
      console.log('⚠️  Redisが起動していません。テストをスキップします。');
      console.log('   docker-compose up -d redis でRedisを起動してください。');
      process.exit(0);
    }
  });
  
  beforeEach(() => {
    sandbox = sinon.createSandbox();
    messageQueue = new MessageQueue(testConfig);
    messageSchema = new MessageSchema();
    eventBus = new EventBus(testConfig);
  });
  
  afterEach(async () => {
    // クリーンアップ
    if (messageQueue) {
      await messageQueue.cleanup();
    }
    if (eventBus) {
      await eventBus.cleanup();
    }
  });
  
  describe('MessageQueue', () => {
    it('メッセージの送信と受信', async () => {
      const queueName = 'test-queue';
      const messageType = 'TEST_MESSAGE';
      const payload = { test: 'data', timestamp: Date.now() };
      
      // プロセッサー登録
      let receivedMessage = null;
      await messageQueue.registerProcessor(queueName, messageType, async (message) => {
        receivedMessage = message;
        return { processed: true };
      });
      
      // メッセージ送信
      const result = await messageQueue.sendMessage(queueName, messageType, payload);
      assert(result.messageId);
      assert(result.jobId);
      
      // 処理待ち
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 受信確認
      assert(receivedMessage);
      assert.equal(receivedMessage.type, messageType);
      assert.deepEqual(receivedMessage.payload, payload);
    });
    
    it('優先度付きメッセージ', async () => {
      const queueName = 'priority-test';
      const receivedOrder = [];
      
      // プロセッサー登録
      await messageQueue.registerProcessor(queueName, '*', async (message) => {
        receivedOrder.push(message.payload.id);
        await new Promise(resolve => setTimeout(resolve, 10));
      });
      
      // 異なる優先度でメッセージ送信
      await messageQueue.sendMessage(queueName, 'TEST', { id: 'low' }, { priority: 1 });
      await messageQueue.sendMessage(queueName, 'TEST', { id: 'high' }, { priority: 10 });
      await messageQueue.sendMessage(queueName, 'TEST', { id: 'medium' }, { priority: 5 });
      
      // 処理待ち
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 高優先度が先に処理されることを確認
      assert.equal(receivedOrder[0], 'high');
    });
    
    it('ブロードキャスト', async () => {
      const queues = ['queue1', 'queue2', 'queue3'];
      const received = new Set();
      
      // 各キューにプロセッサー登録
      for (const q of queues) {
        await messageQueue.registerProcessor(q, 'BROADCAST', async (message) => {
          received.add(q);
        });
      }
      
      // ブロードキャスト送信
      const result = await messageQueue.broadcast(queues, 'BROADCAST', { data: 'test' });
      assert.equal(result.succeeded.length, 3);
      assert.equal(result.failed.length, 0);
      
      // 処理待ち
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // 全キューで受信確認
      assert.equal(received.size, 3);
    });
    
    it('エラーハンドリングとリトライ', async () => {
      const queueName = 'error-test';
      let attemptCount = 0;
      
      // エラーを発生させるプロセッサー
      await messageQueue.registerProcessor(queueName, 'ERROR_TEST', async (message) => {
        attemptCount++;
        if (attemptCount < 3) {
          throw new Error('Retry me');
        }
        return { success: true };
      });
      
      // メッセージ送信
      await messageQueue.sendMessage(queueName, 'ERROR_TEST', {}, {
        attempts: 3,
        backoff: { type: 'fixed', delay: 50 }
      });
      
      // リトライ完了待ち
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 3回試行されたことを確認
      assert.equal(attemptCount, 3);
    });
    
    it('キューの統計情報', async () => {
      const queueName = 'stats-test';
      
      // いくつかメッセージを送信
      for (let i = 0; i < 5; i++) {
        await messageQueue.sendMessage(queueName, 'TEST', { id: i });
      }
      
      // 統計取得
      const stats = await messageQueue.getQueueStats(queueName);
      assert(stats);
      assert.equal(stats.queue, queueName);
      assert(stats.counts.waiting >= 0);
      assert(stats.metrics);
    });
  });
  
  describe('MessageSchema', () => {
    it('メッセージバリデーション - 成功', () => {
      const message = {
        id: 'msg_123',
        type: 'TASK_ASSIGNMENT',
        version: '1.0.0',
        timestamp: Date.now(),
        payload: {
          taskId: 'task-1',
          taskType: 'process-issue',
          data: {}
        }
      };
      
      const result = messageSchema.validateMessage(message);
      assert(result.valid);
    });
    
    it('メッセージバリデーション - 失敗', () => {
      const message = {
        type: 'TASK_ASSIGNMENT',
        // id, version, timestamp が不足
        payload: {}
      };
      
      const result = messageSchema.validateMessage(message);
      assert(!result.valid);
      assert(result.errors);
    });
    
    it('カスタムメッセージタイプの登録', () => {
      messageSchema.registerCustomType('CUSTOM_EVENT', {
        type: 'object',
        required: ['customField'],
        properties: {
          customField: { type: 'string' }
        }
      });
      
      const message = {
        id: 'msg_custom',
        type: 'CUSTOM_EVENT',
        version: '1.0.0',
        timestamp: Date.now(),
        payload: {
          customField: 'value'
        }
      };
      
      const result = messageSchema.validateMessage(message);
      assert(result.valid);
    });
  });
  
  describe('CompatibilityLayer', () => {
    let tempDir;
    
    beforeEach(async () => {
      // テスト用の一時ディレクトリ
      tempDir = path.join(__dirname, 'temp-messages');
      await fs.mkdir(tempDir, { recursive: true });
      
      compatibilityLayer = new CompatibilityLayer({
        mode: 'hybrid',
        messageDir: tempDir,
        redis: testConfig.redis
      });
    });
    
    afterEach(async () => {
      if (compatibilityLayer) {
        await compatibilityLayer.cleanup();
      }
      // 一時ディレクトリ削除
      await fs.rm(tempDir, { recursive: true, force: true });
    });
    
    it('ハイブリッドモードでのメッセージ送受信', async () => {
      await compatibilityLayer.initialize();
      
      const receivedMessages = [];
      
      // ハンドラー登録
      await compatibilityLayer.registerMessageHandler('test-agent', 'TEST', async (message) => {
        receivedMessages.push(message);
      });
      
      // メッセージ送信
      const message = {
        type: 'TEST',
        payload: { data: 'hybrid test' }
      };
      
      await compatibilityLayer.sendMessage('test-agent', message);
      
      // 処理待ち（ファイルとキューの両方）
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // 1回だけ受信されることを確認（重複排除）
      assert.equal(receivedMessages.length, 1);
      assert.equal(receivedMessages[0].payload.data, 'hybrid test');
    });
    
    it('ファイルからキューへの自動マイグレーション', async () => {
      compatibilityLayer.config.enableAutoMigration = true;
      await compatibilityLayer.initialize();
      
      // ファイルメッセージを作成
      const agentDir = path.join(tempDir, 'test-agent');
      const inboxDir = path.join(agentDir, 'inbox');
      await fs.mkdir(inboxDir, { recursive: true });
      
      const fileMessage = {
        id: 'file-msg-1',
        type: 'MIGRATE_TEST',
        payload: { migrate: true }
      };
      
      await fs.writeFile(
        path.join(inboxDir, 'test-message.json'),
        JSON.stringify(fileMessage)
      );
      
      // マイグレーション実行
      await compatibilityLayer.migrateFileMessages();
      
      // ファイルが移動されたことを確認
      const migratedDir = path.join(agentDir, 'migrated');
      const migratedFiles = await fs.readdir(migratedDir);
      assert.equal(migratedFiles.length, 1);
      
      // 統計確認
      const stats = await compatibilityLayer.getStats();
      assert.equal(stats.migration.migrated, 1);
    });
  });
  
  describe('EventBus', () => {
    beforeEach(async () => {
      await eventBus.initialize(messageQueue);
    });
    
    it('イベントの発行と購読', async () => {
      let receivedEvent = null;
      
      // イベント購読
      const unsubscribe = eventBus.subscribe('TEST_EVENT', async (event) => {
        receivedEvent = event;
      });
      
      // イベント発行
      const eventId = await eventBus.publish('TEST_EVENT', {
        testData: 'value'
      });
      
      assert(eventId);
      assert(receivedEvent);
      assert.equal(receivedEvent.type, 'TEST_EVENT');
      assert.equal(receivedEvent.payload.testData, 'value');
      
      // 購読解除
      unsubscribe();
    });
    
    it('パターンマッチング購読', async () => {
      const receivedEvents = [];
      
      // パターンで購読
      eventBus.subscribePattern('TASK_.*', async (eventType, event) => {
        receivedEvents.push({ type: eventType, event });
      });
      
      // 複数のイベント発行
      await eventBus.publish('TASK_STARTED', { task: 1 });
      await eventBus.publish('TASK_COMPLETED', { task: 2 });
      await eventBus.publish('OTHER_EVENT', { other: true });
      
      // パターンにマッチするイベントのみ受信
      assert.equal(receivedEvents.length, 2);
      assert(receivedEvents.some(e => e.type === 'TASK_STARTED'));
      assert(receivedEvents.some(e => e.type === 'TASK_COMPLETED'));
    });
    
    it('イベントのブロードキャスト', async () => {
      const event = {
        id: 'evt_123',
        type: 'BROADCAST_TEST',
        version: '1.0.0',
        timestamp: Date.now(),
        payload: { broadcast: true }
      };
      
      // ブロードキャスト（モック）
      let broadcastCalled = false;
      eventBus.messageQueue.broadcast = async () => {
        broadcastCalled = true;
      };
      
      await eventBus.broadcastEvent(event, ['ccla', 'ccag']);
      assert(broadcastCalled);
    });
    
    it('イベント統計', () => {
      const stats = eventBus.getStats();
      assert(stats);
      assert(typeof stats.published === 'number');
      assert(typeof stats.consumed === 'number');
      assert(typeof stats.failed === 'number');
    });
  });
  
  describe('統合テスト', () => {
    it('エンドツーエンドのメッセージフロー', async () => {
      // 初期化
      await compatibilityLayer.initialize();
      await eventBus.initialize(compatibilityLayer.messageQueue);
      
      const results = {
        messageReceived: false,
        eventReceived: false,
        progressReceived: false
      };
      
      // メッセージハンドラー
      await compatibilityLayer.registerMessageHandler('worker', 'WORK', async (message) => {
        results.messageReceived = true;
        
        // 進捗イベント発行
        await eventBus.publish('TASK_PROGRESS', {
          taskId: message.taskId,
          progress: 50
        });
        
        // 完了イベント発行
        await eventBus.publish('TASK_COMPLETED', {
          taskId: message.taskId,
          result: 'done'
        });
      });
      
      // イベント購読
      eventBus.subscribe('TASK_PROGRESS', (event) => {
        results.progressReceived = true;
      });
      
      eventBus.subscribe('TASK_COMPLETED', (event) => {
        results.eventReceived = true;
      });
      
      // ワークフロー開始
      await compatibilityLayer.sendMessage('worker', {
        type: 'WORK',
        taskId: 'test-task-1'
      });
      
      // 処理完了待ち
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // 全ステップが完了したことを確認
      assert(results.messageReceived, 'メッセージが受信されていません');
      assert(results.progressReceived, '進捗イベントが受信されていません');
      assert(results.eventReceived, '完了イベントが受信されていません');
    });
  });
});

// テスト実行
if (require.main === module) {
  const Mocha = require('mocha');
  const mocha = new Mocha({ timeout: 5000 });
  
  mocha.addFile(__filename);
  mocha.run(failures => {
    process.exit(failures ? 1 : 0);
  });
}