const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');
const MessageQueue = require('./message-queue');
const Logger = require('../../../src/logger');

/**
 * 互換性レイヤー
 * 既存のファイルベースメッセージングとメッセージキューの橋渡し
 */
class CompatibilityLayer extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      mode: config.mode || process.env.MESSAGING_MODE || 'hybrid', // 'file', 'queue', 'hybrid'
      fileCheckInterval: config.fileCheckInterval || 5000,
      migrationBatchSize: config.migrationBatchSize || 10,
      enableAutoMigration: config.enableAutoMigration !== false,
      messageDir: config.messageDir || path.join(__dirname, '../../../messages'),
      ...config
    };
    
    this.logger = new Logger('CompatibilityLayer');
    this.messageQueue = null;
    this.fileWatchers = new Map();
    this.migrationStats = {
      migrated: 0,
      failed: 0,
      pending: 0
    };
  }
  
  /**
   * 初期化
   */
  async initialize() {
    this.logger.info(`互換性レイヤー初期化 (モード: ${this.config.mode})`);
    
    if (this.config.mode !== 'file') {
      // メッセージキューの初期化
      this.messageQueue = new MessageQueue(this.config);
      
      // キューイベントの転送
      this.messageQueue.on('error', (error) => this.emit('error', error));
      this.messageQueue.on('ready', (info) => this.emit('ready', info));
    }
    
    if (this.config.mode !== 'queue') {
      // ファイル監視の設定
      await this.setupFileWatching();
    }
    
    if (this.config.mode === 'hybrid' && this.config.enableAutoMigration) {
      // 自動マイグレーションの開始
      this.startAutoMigration();
    }
    
    this.logger.info('互換性レイヤー初期化完了');
  }
  
  /**
   * メッセージ送信（統一インターフェース）
   */
  async sendMessage(recipient, message) {
    switch (this.config.mode) {
      case 'file':
        return await this.sendFileMessage(recipient, message);
        
      case 'queue':
        return await this.sendQueueMessage(recipient, message);
        
      case 'hybrid':
        // 両方に送信（移行期間用）
        const results = await Promise.allSettled([
          this.sendFileMessage(recipient, message),
          this.sendQueueMessage(recipient, message)
        ]);
        
        // どちらか成功すればOK
        const success = results.find(r => r.status === 'fulfilled');
        if (success) {
          return success.value;
        }
        
        // 両方失敗した場合
        throw new Error('メッセージ送信失敗: ' + results.map(r => r.reason?.message).join(', '));
        
      default:
        throw new Error(`不明なモード: ${this.config.mode}`);
    }
  }
  
  /**
   * ファイルベースのメッセージ送信
   */
  async sendFileMessage(recipient, message) {
    try {
      // メッセージIDとタイムスタンプ
      message.id = message.id || this.generateMessageId();
      message.timestamp = message.timestamp || Date.now();
      
      // ファイル名の生成
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${timestamp}_${message.id}_${message.type}.json`;
      
      // 送信先のinboxパス
      const recipientInbox = path.join(this.config.messageDir, recipient.toLowerCase(), 'inbox');
      await fs.mkdir(recipientInbox, { recursive: true });
      
      const filePath = path.join(recipientInbox, filename);
      
      // メッセージを書き込み
      await fs.writeFile(filePath, JSON.stringify(message, null, 2));
      
      this.logger.debug(`ファイルメッセージ送信: ${message.type} → ${recipient}`);
      
      return {
        mode: 'file',
        messageId: message.id,
        path: filePath
      };
      
    } catch (error) {
      this.logger.error(`ファイルメッセージ送信エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * キューベースのメッセージ送信
   */
  async sendQueueMessage(recipient, message) {
    if (!this.messageQueue) {
      throw new Error('メッセージキューが初期化されていません');
    }
    
    const queueName = this.getQueueName(recipient);
    return await this.messageQueue.sendMessage(
      queueName,
      message.type,
      message.payload || message,
      {
        priority: message.priority,
        delay: message.delay
      }
    );
  }
  
  /**
   * メッセージ受信の登録（統一インターフェース）
   */
  async registerMessageHandler(agent, messageType, handler) {
    switch (this.config.mode) {
      case 'file':
        return this.registerFileHandler(agent, messageType, handler);
        
      case 'queue':
        return this.registerQueueHandler(agent, messageType, handler);
        
      case 'hybrid':
        // 両方から受信（重複排除あり）
        const processedMessages = new Set();
        
        const deduplicatedHandler = async (message, source) => {
          const messageId = message.id || message.messageId;
          if (processedMessages.has(messageId)) {
            this.logger.debug(`重複メッセージをスキップ: ${messageId}`);
            return;
          }
          
          processedMessages.add(messageId);
          
          // 古いメッセージIDを定期的にクリーンアップ
          if (processedMessages.size > 10000) {
            const oldIds = Array.from(processedMessages).slice(0, 5000);
            oldIds.forEach(id => processedMessages.delete(id));
          }
          
          return await handler(message, source);
        };
        
        await Promise.all([
          this.registerFileHandler(agent, messageType, (msg) => deduplicatedHandler(msg, 'file')),
          this.registerQueueHandler(agent, messageType, (msg) => deduplicatedHandler(msg.payload, 'queue'))
        ]);
        break;
        
      default:
        throw new Error(`不明なモード: ${this.config.mode}`);
    }
  }
  
  /**
   * ファイルハンドラーの登録
   */
  registerFileHandler(agent, messageType, handler) {
    const key = `${agent}:${messageType}`;
    
    if (!this.fileWatchers.has(agent)) {
      this.fileWatchers.set(agent, new Map());
    }
    
    const handlers = this.fileWatchers.get(agent);
    handlers.set(messageType, handler);
    
    this.logger.info(`ファイルハンドラー登録: ${key}`);
  }
  
  /**
   * キューハンドラーの登録
   */
  async registerQueueHandler(agent, messageType, handler) {
    if (!this.messageQueue) {
      throw new Error('メッセージキューが初期化されていません');
    }
    
    const queueName = this.getQueueName(agent);
    await this.messageQueue.registerProcessor(queueName, messageType, handler);
  }
  
  /**
   * ファイル監視のセットアップ
   */
  async setupFileWatching() {
    // エージェントディレクトリの取得
    const agentDirs = await this.getAgentDirectories();
    
    for (const agentDir of agentDirs) {
      const agent = path.basename(agentDir);
      const inboxDir = path.join(agentDir, 'inbox');
      
      // inboxディレクトリの作成
      await fs.mkdir(inboxDir, { recursive: true });
      
      // ポーリングベースのファイルチェック
      setInterval(async () => {
        await this.checkInboxFiles(agent, inboxDir);
      }, this.config.fileCheckInterval);
      
      this.logger.info(`ファイル監視開始: ${agent}`);
    }
  }
  
  /**
   * Inboxファイルのチェック
   */
  async checkInboxFiles(agent, inboxDir) {
    try {
      const files = await fs.readdir(inboxDir);
      const jsonFiles = files.filter(f => f.endsWith('.json'));
      
      const handlers = this.fileWatchers.get(agent);
      if (!handlers || handlers.size === 0) {
        return;
      }
      
      for (const file of jsonFiles) {
        const filePath = path.join(inboxDir, file);
        
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const message = JSON.parse(content);
          
          // 適切なハンドラーを探す
          const handler = handlers.get(message.type) || handlers.get('*');
          
          if (handler) {
            await handler(message);
            
            // 処理済みファイルを削除
            await fs.unlink(filePath);
          }
          
        } catch (error) {
          this.logger.error(`ファイルメッセージ処理エラー (${file}): ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Inboxチェックエラー: ${error.message}`);
    }
  }
  
  /**
   * 自動マイグレーションの開始
   */
  startAutoMigration() {
    setInterval(async () => {
      await this.migrateFileMessages();
    }, 30000); // 30秒ごと
    
    // 初回実行
    this.migrateFileMessages();
  }
  
  /**
   * ファイルメッセージのキューへの移行
   */
  async migrateFileMessages() {
    try {
      const agentDirs = await this.getAgentDirectories();
      let migratedCount = 0;
      
      for (const agentDir of agentDirs) {
        const agent = path.basename(agentDir);
        const inboxDir = path.join(agentDir, 'inbox');
        
        const files = await fs.readdir(inboxDir).catch(() => []);
        const jsonFiles = files.filter(f => f.endsWith('.json')).slice(0, this.config.migrationBatchSize);
        
        for (const file of jsonFiles) {
          const filePath = path.join(inboxDir, file);
          
          try {
            const content = await fs.readFile(filePath, 'utf8');
            const message = JSON.parse(content);
            
            // キューに送信
            await this.sendQueueMessage(agent, message);
            
            // マイグレーション済みディレクトリに移動
            const migratedDir = path.join(agentDir, 'migrated');
            await fs.mkdir(migratedDir, { recursive: true });
            await fs.rename(filePath, path.join(migratedDir, file));
            
            migratedCount++;
            this.migrationStats.migrated++;
            
          } catch (error) {
            this.logger.error(`マイグレーションエラー (${file}): ${error.message}`);
            this.migrationStats.failed++;
          }
        }
      }
      
      if (migratedCount > 0) {
        this.logger.info(`${migratedCount}件のメッセージをマイグレーション`);
      }
      
    } catch (error) {
      this.logger.error(`自動マイグレーションエラー: ${error.message}`);
    }
  }
  
  /**
   * エージェントディレクトリの取得
   */
  async getAgentDirectories() {
    try {
      const entries = await fs.readdir(this.config.messageDir, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => path.join(this.config.messageDir, entry.name));
    } catch (error) {
      return [];
    }
  }
  
  /**
   * キュー名の取得
   */
  getQueueName(agent) {
    return `poppo:${agent.toLowerCase()}`;
  }
  
  /**
   * メッセージIDの生成
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  /**
   * 統計情報の取得
   */
  async getStats() {
    const stats = {
      mode: this.config.mode,
      migration: this.migrationStats
    };
    
    if (this.messageQueue) {
      // キューの統計を追加
      const queueStats = {};
      const agentDirs = await this.getAgentDirectories();
      
      for (const agentDir of agentDirs) {
        const agent = path.basename(agentDir);
        const queueName = this.getQueueName(agent);
        queueStats[agent] = await this.messageQueue.getQueueStats(queueName);
      }
      
      stats.queues = queueStats;
    }
    
    return stats;
  }
  
  /**
   * クリーンアップ
   */
  async cleanup() {
    if (this.messageQueue) {
      await this.messageQueue.cleanup();
    }
    
    // タイマーのクリア
    for (const [agent, timerId] of this.fileWatchers) {
      if (timerId) {
        clearInterval(timerId);
      }
    }
    
    this.fileWatchers.clear();
    this.logger.info('互換性レイヤーのクリーンアップ完了');
  }
}

module.exports = CompatibilityLayer;