const Bull = require('bull');
const EventEmitter = require('events');
const Logger = require('../../../src/logger');

/**
 * メッセージキュー基盤クラス
 * Bull (Redis ベース) を使用した堅牢なメッセージング実装
 */
class MessageQueue extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      redis: {
        host: config.redis?.host || process.env.REDIS_HOST || 'localhost',
        port: config.redis?.port || process.env.REDIS_PORT || 6379,
        password: config.redis?.password || process.env.REDIS_PASSWORD,
        db: config.redis?.db || 0,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 1000, 5000)
      },
      defaultJobOptions: {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000
        },
        ...config.defaultJobOptions
      },
      enableMonitoring: config.enableMonitoring !== false,
      messageVersion: '1.0.0'
    };
    
    this.logger = new Logger('MessageQueue');
    this.queues = new Map();
    this.processors = new Map();
    this.metrics = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesProcessed: 0,
      messagesFailed: 0,
      latencies: []
    };
  }
  
  /**
   * キューの初期化・取得
   */
  getQueue(queueName) {
    if (!this.queues.has(queueName)) {
      const queue = new Bull(queueName, {
        redis: this.config.redis,
        defaultJobOptions: this.config.defaultJobOptions
      });
      
      // エラーハンドリング
      queue.on('error', (error) => {
        this.logger.error(`キューエラー (${queueName}): ${error.message}`);
        this.emit('error', { queue: queueName, error });
      });
      
      // 接続成功
      queue.on('ready', () => {
        this.logger.info(`キュー接続成功: ${queueName}`);
        this.emit('ready', { queue: queueName });
      });
      
      // 監視イベント
      if (this.config.enableMonitoring) {
        queue.on('completed', (job, result) => {
          this.metrics.messagesProcessed++;
          const latency = Date.now() - job.timestamp;
          this.metrics.latencies.push(latency);
          if (this.metrics.latencies.length > 1000) {
            this.metrics.latencies.shift();
          }
          this.emit('message:completed', { queue: queueName, job, result, latency });
        });
        
        queue.on('failed', (job, error) => {
          this.metrics.messagesFailed++;
          this.emit('message:failed', { queue: queueName, job, error });
        });
      }
      
      this.queues.set(queueName, queue);
    }
    
    return this.queues.get(queueName);
  }
  
  /**
   * メッセージの送信
   * @param {string} queueName - 送信先キュー名
   * @param {string} messageType - メッセージタイプ
   * @param {object} payload - メッセージペイロード
   * @param {object} options - ジョブオプション
   */
  async sendMessage(queueName, messageType, payload, options = {}) {
    try {
      const queue = this.getQueue(queueName);
      
      // メッセージの構築
      const message = {
        id: this.generateMessageId(),
        type: messageType,
        version: this.config.messageVersion,
        timestamp: Date.now(),
        payload
      };
      
      // ジョブオプション
      const jobOptions = {
        ...this.config.defaultJobOptions,
        ...options,
        delay: options.delay || 0,
        priority: options.priority || 0
      };
      
      // デッドレターキューの設定
      if (options.enableDeadLetter) {
        jobOptions.failedReason = 'dead-letter';
      }
      
      // メッセージ送信
      const job = await queue.add(messageType, message, jobOptions);
      
      this.metrics.messagesSent++;
      this.logger.debug(`メッセージ送信: ${messageType} → ${queueName} (${job.id})`);
      
      return {
        messageId: message.id,
        jobId: job.id,
        queue: queueName,
        type: messageType
      };
      
    } catch (error) {
      this.logger.error(`メッセージ送信エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * ブロードキャストメッセージの送信
   * @param {string[]} queueNames - 送信先キュー名のリスト
   * @param {string} messageType - メッセージタイプ
   * @param {object} payload - メッセージペイロード
   */
  async broadcast(queueNames, messageType, payload, options = {}) {
    const results = await Promise.allSettled(
      queueNames.map(queueName => 
        this.sendMessage(queueName, messageType, payload, options)
      )
    );
    
    const succeeded = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    const failed = results.filter(r => r.status === 'rejected').map((r, i) => ({
      queue: queueNames[i],
      error: r.reason
    }));
    
    if (failed.length > 0) {
      this.logger.warn(`ブロードキャスト一部失敗: ${failed.length}/${queueNames.length}`);
    }
    
    return { succeeded, failed };
  }
  
  /**
   * メッセージプロセッサーの登録
   * @param {string} queueName - キュー名
   * @param {string} messageType - 処理するメッセージタイプ
   * @param {function} handler - メッセージハンドラー関数
   * @param {object} options - プロセッサーオプション
   */
  async registerProcessor(queueName, messageType, handler, options = {}) {
    const queue = this.getQueue(queueName);
    const processorKey = `${queueName}:${messageType}`;
    
    // 既存のプロセッサーをチェック
    if (this.processors.has(processorKey)) {
      throw new Error(`プロセッサー既登録: ${processorKey}`);
    }
    
    // プロセッサー関数
    const processor = async (job) => {
      const message = job.data;
      
      // バージョンチェック
      if (!this.isCompatibleVersion(message.version)) {
        throw new Error(`非互換メッセージバージョン: ${message.version}`);
      }
      
      // メッセージタイプのフィルタリング
      if (message.type !== messageType && messageType !== '*') {
        // 他のタイプは無視
        return { skipped: true, reason: 'type-mismatch' };
      }
      
      const startTime = Date.now();
      
      try {
        // ハンドラー実行
        const result = await handler(message, job);
        
        const processingTime = Date.now() - startTime;
        this.metrics.messagesReceived++;
        
        return {
          messageId: message.id,
          type: message.type,
          processingTime,
          result
        };
        
      } catch (error) {
        // リトライ可能なエラーかチェック
        if (error.retryable === false) {
          job.discard();
        }
        throw error;
      }
    };
    
    // プロセッサーの並行数設定
    const concurrency = options.concurrency || 1;
    
    // プロセッサー登録
    queue.process(messageType, concurrency, processor);
    this.processors.set(processorKey, { handler, options });
    
    this.logger.info(`プロセッサー登録: ${processorKey} (並行数: ${concurrency})`);
  }
  
  /**
   * 全メッセージタイプを処理するプロセッサーの登録
   */
  async registerGlobalProcessor(queueName, handler, options = {}) {
    await this.registerProcessor(queueName, '*', handler, options);
  }
  
  /**
   * キューの一時停止
   */
  async pauseQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.pause();
      this.logger.info(`キュー一時停止: ${queueName}`);
    }
  }
  
  /**
   * キューの再開
   */
  async resumeQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.resume();
      this.logger.info(`キュー再開: ${queueName}`);
    }
  }
  
  /**
   * デッドレターキューの処理
   */
  async processDeadLetterQueue(queueName, handler) {
    const dlqName = `${queueName}:dead-letter`;
    await this.registerProcessor(dlqName, '*', async (message, job) => {
      const originalError = job.failedReason;
      return await handler(message, originalError, job);
    });
  }
  
  /**
   * キューの統計情報取得
   */
  async getQueueStats(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      return null;
    }
    
    const [waiting, active, completed, failed, delayed, paused] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.isPaused()
    ]);
    
    const avgLatency = this.metrics.latencies.length > 0
      ? this.metrics.latencies.reduce((a, b) => a + b, 0) / this.metrics.latencies.length
      : 0;
    
    return {
      queue: queueName,
      status: paused ? 'paused' : 'active',
      counts: {
        waiting,
        active,
        completed,
        failed,
        delayed
      },
      metrics: {
        messagesSent: this.metrics.messagesSent,
        messagesReceived: this.metrics.messagesReceived,
        messagesProcessed: this.metrics.messagesProcessed,
        messagesFailed: this.metrics.messagesFailed,
        averageLatency: Math.round(avgLatency)
      }
    };
  }
  
  /**
   * 全キューのクリーンアップ
   */
  async cleanup() {
    for (const [queueName, queue] of this.queues) {
      try {
        await queue.close();
        this.logger.info(`キューをクローズ: ${queueName}`);
      } catch (error) {
        this.logger.error(`キュークローズエラー (${queueName}): ${error.message}`);
      }
    }
    
    this.queues.clear();
    this.processors.clear();
  }
  
  /**
   * メッセージIDの生成
   */
  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  
  /**
   * バージョン互換性チェック
   */
  isCompatibleVersion(messageVersion) {
    // セマンティックバージョニングの簡易チェック
    const [major] = messageVersion.split('.');
    const [currentMajor] = this.config.messageVersion.split('.');
    return major === currentMajor;
  }
  
  /**
   * ヘルスチェック
   */
  async healthCheck() {
    const results = {};
    
    for (const [queueName, queue] of this.queues) {
      try {
        // Redis接続確認
        await queue.isReady();
        results[queueName] = { status: 'healthy' };
      } catch (error) {
        results[queueName] = { 
          status: 'unhealthy', 
          error: error.message 
        };
      }
    }
    
    return {
      status: Object.values(results).every(r => r.status === 'healthy') ? 'healthy' : 'degraded',
      queues: results,
      redis: {
        host: this.config.redis.host,
        port: this.config.redis.port
      }
    };
  }
}

module.exports = MessageQueue;