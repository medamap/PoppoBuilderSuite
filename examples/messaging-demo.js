#!/usr/bin/env node

const EnhancedAgentBase = require('../agents/shared/enhanced-agent-base');
const { MessageQueue, EventBus } = require('../agents/shared/messaging');
const Logger = require('../src/logger');

/**
 * メッセージキューシステムのデモ
 */
class DemoAgent extends EnhancedAgentBase {
  constructor(name, role) {
    super(name, {
      messagingMode: 'queue',
      enableEvents: true
    });
    
    this.role = role;
  }
  
  async onInitialize() {
    console.log(`🚀 ${this.agentName} (${this.role}) 初期化完了`);
    
    // イベント購読
    this.subscribeEvent('DEMO_EVENT', async (event) => {
      console.log(`📨 ${this.agentName} がイベントを受信:`, event.payload);
    });
    
    // エラーイベント購読
    this.subscribeEvent('ERROR_OCCURRED', async (event) => {
      console.log(`❌ ${this.agentName} がエラーを検知:`, event.payload.errorMessage);
    });
  }
  
  async processTask(message) {
    console.log(`⚙️  ${this.agentName} がタスクを処理中:`, message.payload);
    
    // 進捗報告
    await this.reportProgress(message.taskId, 25, '処理開始');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await this.reportProgress(message.taskId, 50, 'データ処理中');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await this.reportProgress(message.taskId, 75, '結果生成中');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 完了イベント発行
    await this.publishEvent('DEMO_EVENT', {
      message: `${this.agentName} がタスク ${message.taskId} を完了しました`,
      timestamp: new Date().toISOString()
    }, { broadcast: true });
    
    return {
      success: true,
      processedBy: this.agentName,
      result: `Task ${message.taskId} completed`
    };
  }
}

/**
 * コーディネーターエージェント
 */
class CoordinatorAgent extends EnhancedAgentBase {
  constructor() {
    super('Coordinator', {
      messagingMode: 'queue',
      enableEvents: true
    });
    
    this.taskCounter = 0;
  }
  
  async onInitialize() {
    console.log('🎯 コーディネーター初期化完了');
    
    // タスク完了イベントの監視
    this.subscribeEvent('TASK_COMPLETED', async (event) => {
      console.log('✅ タスク完了:', event.payload);
    });
    
    // 進捗イベントの監視
    this.subscribeEvent('TASK_PROGRESS', async (event) => {
      console.log(`📊 進捗更新: ${event.payload.taskId} - ${event.payload.progress}% - ${event.payload.milestone}`);
    });
  }
  
  async distributeTask(workerName, taskData) {
    this.taskCounter++;
    const taskId = `demo-task-${this.taskCounter}`;
    
    console.log(`📤 タスク ${taskId} を ${workerName} に割り当て`);
    
    await this.sendMessage(workerName, {
      type: 'TASK_ASSIGNMENT',
      taskId,
      taskType: 'demo-task',
      payload: taskData
    });
  }
  
  async simulateError() {
    await this.publishEvent('ERROR_OCCURRED', {
      errorCode: 'DEMO_ERROR',
      errorMessage: 'これはデモ用のエラーです',
      source: {
        agent: this.agentName,
        task: 'error-simulation'
      },
      severity: 'medium',
      retryable: false,
      timestamp: new Date().toISOString()
    });
  }
}

/**
 * デモの実行
 */
async function runDemo() {
  const logger = new Logger('MessagingDemo');
  
  console.log('=== PoppoBuilder メッセージキューシステム デモ ===\n');
  
  // Redisの確認
  try {
    const testQueue = new MessageQueue();
    const queue = testQueue.getQueue('test');
    await queue.isReady();
    await testQueue.cleanup();
  } catch (error) {
    console.error('❌ Redisが起動していません。');
    console.error('   docker-compose up -d redis でRedisを起動してください。');
    process.exit(1);
  }
  
  // エージェントの作成
  const coordinator = new CoordinatorAgent();
  const worker1 = new DemoAgent('Worker1', 'データ処理');
  const worker2 = new DemoAgent('Worker2', '解析処理');
  
  // エージェントの初期化
  await Promise.all([
    coordinator.initialize(),
    worker1.initialize(),
    worker2.initialize()
  ]);
  
  console.log('\n--- デモ開始 ---\n');
  
  // シナリオ1: タスクの分配と処理
  console.log('📌 シナリオ1: タスクの分配と処理');
  await coordinator.distributeTask('Worker1', { data: 'サンプルデータ1' });
  await new Promise(resolve => setTimeout(resolve, 100));
  
  await coordinator.distributeTask('Worker2', { data: 'サンプルデータ2' });
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // シナリオ2: 並行処理
  console.log('\n📌 シナリオ2: 並行処理');
  await Promise.all([
    coordinator.distributeTask('Worker1', { data: '並行データ1' }),
    coordinator.distributeTask('Worker2', { data: '並行データ2' }),
    coordinator.distributeTask('Worker1', { data: '並行データ3' })
  ]);
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // シナリオ3: イベントブロードキャスト
  console.log('\n📌 シナリオ3: イベントブロードキャスト');
  await coordinator.publishEvent('DEMO_EVENT', {
    message: 'すべてのエージェントへのお知らせ',
    important: true
  }, { broadcast: true });
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // シナリオ4: エラーハンドリング
  console.log('\n📌 シナリオ4: エラーハンドリング');
  await coordinator.simulateError();
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // 統計情報の表示
  console.log('\n--- 統計情報 ---');
  const stats = await Promise.all([
    coordinator.getStats(),
    worker1.getStats(),
    worker2.getStats()
  ]);
  
  stats.forEach(stat => {
    console.log(`\n${stat.agent}:`);
    console.log(`  タスク完了: ${stat.metrics.tasksCompleted}`);
    console.log(`  イベント発行: ${stat.metrics.eventsPublished}`);
    console.log(`  イベント受信: ${stat.metrics.eventsConsumed}`);
  });
  
  // クリーンアップ
  console.log('\n--- シャットダウン ---');
  await Promise.all([
    coordinator.shutdown(),
    worker1.shutdown(),
    worker2.shutdown()
  ]);
  
  console.log('\n✨ デモ完了！');
  process.exit(0);
}

// エラーハンドリング
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// デモ実行
if (require.main === module) {
  runDemo().catch(error => {
    console.error('デモ実行エラー:', error);
    process.exit(1);
  });
}