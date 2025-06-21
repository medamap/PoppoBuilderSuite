/**
 * RedisStateClient
 * 各プロセス用のRedis状態管理クライアント
 * MirinRedisAmbassadorとの通信を仲介
 */

const Redis = require('ioredis');
const EventEmitter = require('events');

class RedisStateClient extends EventEmitter {
  constructor(processId, options = {}) {
    super();
    
    this.processId = processId;
    this.options = {
      redis: {
        host: '127.0.0.1',
        port: 6379,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
        ...options.redis
      },
      requestChannel: 'poppo:channel:mirin:requests',
      responseChannel: 'poppo:channel:mirin:responses',
      requestTimeout: 30000, // 30秒
      heartbeatInterval: 30000, // 30秒
      logger: options.logger || console,
      ...options
    };
    
    // Redis接続（読み取り専用と購読用）
    this.redis = null;
    this.subscriber = null;
    this.logger = this.options.logger;
    
    // 状態管理
    this.isConnected = false;
    this.isShuttingDown = false;
    this.pendingRequests = new Map(); // リクエストID -> Promise resolver
    this.requestCounter = 0;
    this.heartbeatTimer = null;
    this.lastHeartbeat = null;
  }

  /**
   * Redis接続の初期化
   */
  async connect() {
    if (this.isConnected) {
      return;
    }

    try {
      this.logger.info(`📡 RedisStateClient (${this.processId}) 接続開始`);

      // Redis接続を確立
      this.redis = new Redis(this.options.redis);
      this.subscriber = new Redis(this.options.redis);

      // 接続テスト
      await this.redis.ping();

      // 応答チャンネルを購読
      await this.subscriber.subscribe(this.options.responseChannel);
      this.subscriber.on('message', this.handleResponse.bind(this));

      // 定期ハートビート開始
      this.startHeartbeat();

      this.isConnected = true;
      this.emit('connected');
      this.logger.info(`✅ RedisStateClient (${this.processId}) 接続完了`);

    } catch (error) {
      this.logger.error(`❌ RedisStateClient (${this.processId}) 接続エラー:`, error);
      throw error;
    }
  }

  /**
   * 応答メッセージのハンドラ
   */
  handleResponse(channel, message) {
    try {
      const response = JSON.parse(message);
      const { requestId } = response;

      if (this.pendingRequests.has(requestId)) {
        const { resolve, reject } = this.pendingRequests.get(requestId);
        this.pendingRequests.delete(requestId);

        if (response.success) {
          resolve(response);
        } else {
          const error = new Error(response.error || 'Unknown error');
          error.stack = response.stack;
          reject(error);
        }
      }
    } catch (error) {
      this.logger.error('応答処理エラー:', error);
    }
  }

  /**
   * リクエストの送信
   */
  async sendRequest(action, payload = {}, timeout = null) {
    if (!this.isConnected) {
      throw new Error('Redis client is not connected');
    }

    const requestId = `${this.processId}-${++this.requestCounter}-${Date.now()}`;
    const requestTimeout = timeout || this.options.requestTimeout;

    const request = {
      requestId,
      action,
      processId: this.processId,
      pid: process.pid,
      timestamp: new Date().toISOString(),
      ...payload
    };

    // Promise を作成して応答を待機
    const responsePromise = new Promise((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      // タイムアウト設定
      setTimeout(() => {
        if (this.pendingRequests.has(requestId)) {
          this.pendingRequests.delete(requestId);
          reject(new Error(`Request timeout: ${action} (${requestId})`));
        }
      }, requestTimeout);
    });

    // リクエストを送信
    await this.redis.publish(this.options.requestChannel, JSON.stringify(request));
    this.logger.info(`📤 リクエスト送信: ${action} (${requestId})`);

    return responsePromise;
  }

  /**
   * Issue状態のチェックアウト
   */
  async checkoutIssue(issueNumber, taskType) {
    const response = await this.sendRequest('checkout_issue', {
      issueNumber,
      taskType
    });

    this.logger.info(`🔒 Issue #${issueNumber} をチェックアウト (${taskType})`);
    return response;
  }

  /**
   * Issue状態のチェックイン
   */
  async checkinIssue(issueNumber, finalStatus, metadata = {}) {
    const response = await this.sendRequest('checkin_issue', {
      issueNumber,
      finalStatus,
      metadata
    });

    this.logger.info(`🔓 Issue #${issueNumber} をチェックイン (${finalStatus})`);
    return response;
  }

  /**
   * Issue状態の取得
   */
  async getIssueStatus(issueNumber) {
    const response = await this.sendRequest('get_issue_status', {
      issueNumber
    });

    return response;
  }

  /**
   * 処理中Issue一覧の取得
   */
  async listProcessingIssues() {
    const response = await this.sendRequest('list_processing_issues');
    return response;
  }

  /**
   * プロセスのクリーンアップ
   */
  async cleanupProcess() {
    const response = await this.sendRequest('cleanup_process');
    return response;
  }

  /**
   * 手動ハートビート送信
   */
  async sendHeartbeat() {
    try {
      const response = await this.sendRequest('heartbeat', {}, 5000); // 5秒タイムアウト
      this.lastHeartbeat = new Date();
      this.emit('heartbeat', this.lastHeartbeat);
      return response;
    } catch (error) {
      this.logger.error('ハートビート送信エラー:', error);
      throw error;
    }
  }

  /**
   * 定期ハートビートの開始
   */
  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    this.heartbeatTimer = setInterval(async () => {
      try {
        await this.sendHeartbeat();
      } catch (error) {
        this.logger.error('定期ハートビートエラー:', error);
        this.emit('heartbeatError', error);
      }
    }, this.options.heartbeatInterval);

    this.logger.info(`💓 定期ハートビート開始 (${this.options.heartbeatInterval}ms間隔)`);
  }

  /**
   * 定期ハートビートの停止
   */
  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
      this.logger.info('💓 定期ハートビート停止');
    }
  }

  /**
   * 接続状態の確認
   */
  isHealthy() {
    if (!this.isConnected) {
      return false;
    }

    // 最後のハートビートから一定時間経過していないかチェック
    if (this.lastHeartbeat) {
      const elapsed = Date.now() - this.lastHeartbeat.getTime();
      const threshold = this.options.heartbeatInterval * 3; // 3回分の間隔
      return elapsed < threshold;
    }

    return true;
  }

  /**
   * 統計情報の取得
   */
  getStats() {
    return {
      processId: this.processId,
      isConnected: this.isConnected,
      pendingRequests: this.pendingRequests.size,
      lastHeartbeat: this.lastHeartbeat,
      isHealthy: this.isHealthy(),
      uptime: this.isConnected ? Date.now() - (this.lastHeartbeat?.getTime() || Date.now()) : 0
    };
  }

  /**
   * 読み取り専用操作（直接Redis実行）
   */
  async directGet(key) {
    if (!this.isConnected) {
      throw new Error('Redis client is not connected');
    }
    return await this.redis.get(key);
  }

  async directHGetAll(key) {
    if (!this.isConnected) {
      throw new Error('Redis client is not connected');
    }
    return await this.redis.hgetall(key);
  }

  async directSMembers(key) {
    if (!this.isConnected) {
      throw new Error('Redis client is not connected');
    }
    return await this.redis.smembers(key);
  }

  async directKeys(pattern) {
    if (!this.isConnected) {
      throw new Error('Redis client is not connected');
    }
    return await this.redis.keys(pattern);
  }

  /**
   * 緊急時の状態確認（MirinRedisAmbassadorを経由しない）
   */
  async emergencyStatusCheck() {
    if (!this.isConnected) {
      throw new Error('Redis client is not connected');
    }

    try {
      const processingIssues = await this.directSMembers('poppo:issues:processing');
      const activeProcesses = await this.directSMembers('poppo:processes:active');
      
      const issueDetails = [];
      for (const issueNumber of processingIssues) {
        const status = await this.directHGetAll(`poppo:issue:status:${issueNumber}`);
        issueDetails.push({
          issueNumber: parseInt(issueNumber),
          ...status
        });
      }

      return {
        processingIssues: processingIssues.length,
        activeProcesses: activeProcesses.length,
        issues: issueDetails,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.logger.error('緊急状態確認エラー:', error);
      throw error;
    }
  }

  /**
   * 接続切断
   */
  async disconnect() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.info(`🛑 RedisStateClient (${this.processId}) 切断開始`);

    try {
      // ハートビート停止
      this.stopHeartbeat();

      // 保留中のリクエストをキャンセル
      for (const [requestId, { reject }] of this.pendingRequests) {
        reject(new Error('Client disconnecting'));
      }
      this.pendingRequests.clear();

      // Redis接続の切断
      if (this.subscriber) {
        await this.subscriber.unsubscribe();
        this.subscriber.disconnect();
      }
      if (this.redis) {
        this.redis.disconnect();
      }

      this.isConnected = false;
      this.emit('disconnected');
      this.logger.info(`✅ RedisStateClient (${this.processId}) 切断完了`);

    } catch (error) {
      this.logger.error(`❌ RedisStateClient (${this.processId}) 切断エラー:`, error);
    }
  }
}

module.exports = RedisStateClient;