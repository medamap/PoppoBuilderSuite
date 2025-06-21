/**
 * MirinRedisAmbassador
 * ミリンちゃんRedis大使 - PoppoBuilderの状態管理をRedis経由で一元化
 */

const Redis = require('ioredis');
const EventEmitter = require('events');
const { spawn } = require('child_process');

// 名前空間ヘルパークラス
class PoppoRedisKeys {
  static issue(issueNumber) {
    return {
      status: `poppo:issue:status:${issueNumber}`,
      metadata: `poppo:issue:metadata:${issueNumber}`,
      lock: `poppo:lock:issue:${issueNumber}`
    };
  }
  
  static process(processId) {
    return {
      info: `poppo:process:info:${processId}`,
      heartbeat: `poppo:process:heartbeat:${processId}`,
      lock: `poppo:lock:process:${processId}`
    };
  }
  
  static queue(priority = 'normal') {
    return `poppo:queue:${priority}`;
  }
  
  static channel(type, subtype) {
    return `poppo:channel:${type}:${subtype}`;
  }
  
  static lists() {
    return {
      processingIssues: 'poppo:issues:processing',
      processedIssues: 'poppo:issues:processed',
      activeProcesses: 'poppo:processes:active',
      zombieProcesses: 'poppo:processes:zombies'
    };
  }
}

// TTL定数
const TTL = {
  HEARTBEAT: 1800,        // 30分
  TEMP_DATA: 3600,        // 1時間  
  DAILY_STATS: 86400 * 7, // 1週間
  SESSION: 86400 * 30,    // 30日
  LOCK: 300               // 5分
};

class MirinRedisAmbassador extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      redis: {
        host: '127.0.0.1',
        port: 6379,
        retryDelayOnFailover: 100,
        enableReadyCheck: false,
        maxRetriesPerRequest: 3,
        ...options.redis
      },
      github: options.github || null,
      logger: options.logger || console,
      requestChannel: 'poppo:channel:mirin:requests',
      responseChannel: 'poppo:channel:mirin:responses',
      heartbeatInterval: 30000, // 30秒
      orphanCheckInterval: 300000, // 5分
      ...options
    };
    
    // Redis接続（読み書き用と購読用）
    this.redis = null;
    this.subscriber = null;
    this.github = this.options.github;
    this.logger = this.options.logger;
    
    // 状態管理
    this.isInitialized = false;
    this.isShuttingDown = false;
    this.activeRequests = new Map(); // リクエストID -> 応答待ちPromise
    
    // タイマー
    this.heartbeatTimer = null;
    this.orphanCheckTimer = null;
  }

  /**
   * Redis大使の初期化
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      this.logger.info('🎋 MirinRedisAmbassador初期化開始');

      // Redis接続を確立
      this.redis = new Redis(this.options.redis);
      this.subscriber = new Redis(this.options.redis);

      // 接続テスト
      await this.redis.ping();
      this.logger.info('✅ Redis接続確立');

      // 購読設定
      await this.subscriber.subscribe(this.options.requestChannel);
      this.subscriber.on('message', this.handleIncomingRequest.bind(this));
      this.logger.info(`📡 チャンネル ${this.options.requestChannel} を購読開始`);

      // 定期処理の開始
      this.startPeriodicTasks();

      this.isInitialized = true;
      this.emit('initialized');
      this.logger.info('🎉 MirinRedisAmbassador初期化完了');

    } catch (error) {
      this.logger.error('❌ MirinRedisAmbassador初期化エラー:', error);
      throw error;
    }
  }

  /**
   * 定期処理の開始
   */
  startPeriodicTasks() {
    // ハートビート送信
    this.heartbeatTimer = setInterval(() => {
      this.sendSelfHeartbeat().catch(error => {
        this.logger.error('ハートビート送信エラー:', error);
      });
    }, this.options.heartbeatInterval);

    // 孤児Issue検出
    this.orphanCheckTimer = setInterval(() => {
      this.checkOrphanedIssues().catch(error => {
        this.logger.error('孤児Issue検出エラー:', error);
      });
    }, this.options.orphanCheckInterval);

    this.logger.info('⏰ 定期処理開始（ハートビート・孤児Issue検出）');
  }

  /**
   * 受信リクエストのハンドラ
   */
  async handleIncomingRequest(channel, message) {
    try {
      const request = JSON.parse(message);
      this.logger.info(`📩 リクエスト受信: ${request.action} (${request.requestId})`);

      let response;
      try {
        response = await this.processRequest(request);
        response.success = true;
      } catch (error) {
        this.logger.error(`リクエスト処理エラー (${request.requestId}):`, error);
        response = {
          success: false,
          error: error.message,
          stack: error.stack
        };
      }

      // 応答を送信
      const responseMessage = {
        requestId: request.requestId,
        timestamp: new Date().toISOString(),
        ...response
      };

      await this.redis.publish(this.options.responseChannel, JSON.stringify(responseMessage));
      this.logger.info(`📤 応答送信: ${request.action} (${request.requestId})`);

    } catch (error) {
      this.logger.error('リクエスト処理エラー:', error);
    }
  }

  /**
   * リクエストの処理分岐
   */
  async processRequest(request) {
    switch (request.action) {
      case 'checkout_issue':
        return await this.checkoutIssue(request);
      case 'checkin_issue':
        return await this.checkinIssue(request);
      case 'heartbeat':
        return await this.updateHeartbeat(request);
      case 'get_issue_status':
        return await this.getIssueStatus(request);
      case 'list_processing_issues':
        return await this.listProcessingIssues(request);
      case 'cleanup_process':
        return await this.cleanupProcess(request);
      default:
        throw new Error(`Unknown action: ${request.action}`);
    }
  }

  /**
   * Issue状態のチェックアウト
   */
  async checkoutIssue(request) {
    const { issueNumber, processId, pid, taskType } = request;
    const issueKeys = PoppoRedisKeys.issue(issueNumber);
    const processKeys = PoppoRedisKeys.process(processId);
    const lists = PoppoRedisKeys.lists();

    // 分散ロックを取得
    const lockKey = issueKeys.lock;
    const lockValue = `${processId}-${Date.now()}`;
    const lockAcquired = await this.redis.set(lockKey, lockValue, 'PX', TTL.LOCK * 1000, 'NX');

    if (!lockAcquired) {
      throw new Error(`Issue #${issueNumber} is already locked by another process`);
    }

    try {
      // 既に処理中かチェック
      const currentStatus = await this.redis.hget(issueKeys.status, 'status');
      if (currentStatus === 'processing') {
        const currentProcessId = await this.redis.hget(issueKeys.status, 'processId');
        if (currentProcessId !== processId) {
          throw new Error(`Issue #${issueNumber} is already being processed by ${currentProcessId}`);
        }
      }

      // アトミックに状態を設定
      const multi = this.redis.multi();
      
      // Issue状態を設定
      multi.hset(issueKeys.status, {
        status: 'processing',
        processId,
        pid,
        taskType,
        startTime: new Date().toISOString(),
        checkedOutBy: 'mirin-redis-ambassador',
        lastUpdate: new Date().toISOString()
      });

      // プロセス情報を設定
      multi.hset(processKeys.info, {
        pid,
        issueNumber,
        status: 'active',
        taskType,
        lastSeen: new Date().toISOString()
      });

      // ハートビートを設定
      multi.setex(processKeys.heartbeat, TTL.HEARTBEAT, 'alive');

      // 処理中Issue一覧に追加
      multi.sadd(lists.processingIssues, issueNumber);
      
      // アクティブプロセス一覧に追加
      multi.sadd(lists.activeProcesses, processId);

      const results = await multi.exec();
      
      // すべての操作が成功したかチェック
      if (results.some(([err]) => err)) {
        throw new Error('Failed to checkout issue: Redis transaction failed');
      }

      // GitHubラベルを更新（非同期で実行）
      if (this.github) {
        this.updateGitHubLabel(issueNumber, 'processing').catch(error => {
          this.logger.error(`GitHub label update error for issue #${issueNumber}:`, error);
        });
      }

      this.logger.info(`✅ Issue #${issueNumber} をプロセス ${processId} がチェックアウト`);
      
      return {
        message: 'Issue checked out successfully',
        issueNumber,
        processId,
        status: 'processing'
      };

    } finally {
      // ロックを解放
      await this.redis.del(lockKey);
    }
  }

  /**
   * Issue状態のチェックイン
   */
  async checkinIssue(request) {
    const { issueNumber, processId, finalStatus, metadata = {} } = request;
    const issueKeys = PoppoRedisKeys.issue(issueNumber);
    const processKeys = PoppoRedisKeys.process(processId);
    const lists = PoppoRedisKeys.lists();

    // 分散ロックを取得
    const lockKey = issueKeys.lock;
    const lockValue = `${processId}-${Date.now()}`;
    const lockAcquired = await this.redis.set(lockKey, lockValue, 'PX', TTL.LOCK * 1000, 'NX');

    if (!lockAcquired) {
      throw new Error(`Issue #${issueNumber} is locked by another process`);
    }

    try {
      // 現在の状態を確認
      const currentStatus = await this.redis.hgetall(issueKeys.status);
      if (currentStatus.processId !== processId) {
        throw new Error(`Issue #${issueNumber} is not checked out by process ${processId}`);
      }

      // アトミックに状態を更新
      const multi = this.redis.multi();
      
      // Issue状態を更新
      multi.hset(issueKeys.status, {
        status: finalStatus,
        endTime: new Date().toISOString(),
        lastUpdate: new Date().toISOString(),
        ...metadata
      });

      // メタデータを保存
      if (Object.keys(metadata).length > 0) {
        multi.hset(issueKeys.metadata, metadata);
      }

      // 処理中Issue一覧から削除
      multi.srem(lists.processingIssues, issueNumber);
      
      // 処理済みIssue一覧に追加
      if (finalStatus === 'completed') {
        multi.sadd(lists.processedIssues, issueNumber);
      }

      // プロセス情報を更新
      multi.hset(processKeys.info, {
        status: 'completed',
        endTime: new Date().toISOString(),
        finalStatus
      });

      // アクティブプロセス一覧から削除
      multi.srem(lists.activeProcesses, processId);

      const results = await multi.exec();
      
      if (results.some(([err]) => err)) {
        throw new Error('Failed to checkin issue: Redis transaction failed');
      }

      // GitHubラベルを更新（非同期で実行）
      if (this.github) {
        this.updateGitHubLabel(issueNumber, finalStatus).catch(error => {
          this.logger.error(`GitHub label update error for issue #${issueNumber}:`, error);
        });
      }

      this.logger.info(`✅ Issue #${issueNumber} をプロセス ${processId} がチェックイン (${finalStatus})`);
      
      return {
        message: 'Issue checked in successfully',
        issueNumber,
        processId,
        finalStatus
      };

    } finally {
      // ロックを解放
      await this.redis.del(lockKey);
    }
  }

  /**
   * ハートビートの更新
   */
  async updateHeartbeat(request) {
    const { processId, pid } = request;
    const processKeys = PoppoRedisKeys.process(processId);

    // ハートビートを更新
    await this.redis.setex(processKeys.heartbeat, TTL.HEARTBEAT, 'alive');
    
    // プロセス情報を更新
    await this.redis.hset(processKeys.info, {
      lastSeen: new Date().toISOString(),
      pid: pid || await this.redis.hget(processKeys.info, 'pid')
    });

    return {
      message: 'Heartbeat updated successfully',
      processId,
      ttl: TTL.HEARTBEAT
    };
  }

  /**
   * Issue状態の取得
   */
  async getIssueStatus(request) {
    const { issueNumber } = request;
    const issueKeys = PoppoRedisKeys.issue(issueNumber);

    const status = await this.redis.hgetall(issueKeys.status);
    const metadata = await this.redis.hgetall(issueKeys.metadata);

    return {
      issueNumber,
      status,
      metadata
    };
  }

  /**
   * 処理中Issue一覧の取得
   */
  async listProcessingIssues(request) {
    const lists = PoppoRedisKeys.lists();
    const processingIssues = await this.redis.smembers(lists.processingIssues);
    
    const issueDetails = [];
    for (const issueNumber of processingIssues) {
      const issueKeys = PoppoRedisKeys.issue(issueNumber);
      const status = await this.redis.hgetall(issueKeys.status);
      issueDetails.push({
        issueNumber: parseInt(issueNumber),
        ...status
      });
    }

    return {
      count: processingIssues.length,
      issues: issueDetails
    };
  }

  /**
   * 自分自身のハートビート送信
   */
  async sendSelfHeartbeat() {
    const processId = 'mirin-redis-ambassador';
    const processKeys = PoppoRedisKeys.process(processId);
    
    await this.redis.setex(processKeys.heartbeat, TTL.HEARTBEAT, 'alive');
    await this.redis.hset(processKeys.info, {
      pid: process.pid,
      status: 'active',
      role: 'redis-ambassador',
      lastSeen: new Date().toISOString()
    });
  }

  /**
   * 孤児Issue検出と修復
   */
  async checkOrphanedIssues() {
    const lists = PoppoRedisKeys.lists();
    const processingIssues = await this.redis.smembers(lists.processingIssues);
    const orphaned = [];

    this.logger.info(`🔍 孤児Issue検出開始 (${processingIssues.length}件の処理中Issue)`);

    for (const issueNumber of processingIssues) {
      const issueKeys = PoppoRedisKeys.issue(issueNumber);
      const issueData = await this.redis.hgetall(issueKeys.status);
      
      if (!issueData.processId) {
        continue;
      }

      const processKeys = PoppoRedisKeys.process(issueData.processId);
      
      // ハートビートチェック
      const heartbeat = await this.redis.get(processKeys.heartbeat);
      if (!heartbeat) {
        // プロセス生存確認
        const isAlive = this.isProcessAlive(issueData.pid);
        if (!isAlive) {
          orphaned.push({
            issue: issueNumber,
            processId: issueData.processId,
            pid: issueData.pid,
            startTime: issueData.startTime,
            taskType: issueData.taskType
          });
        }
      }
    }

    // 孤児Issueを修復
    for (const orphan of orphaned) {
      await this.repairOrphanedIssue(orphan);
    }

    if (orphaned.length > 0) {
      this.logger.info(`🛠️  ${orphaned.length}件の孤児Issueを修復`);
    }

    return orphaned;
  }

  /**
   * 孤児Issueの修復
   */
  async repairOrphanedIssue(orphan) {
    const { issue: issueNumber, processId } = orphan;
    this.logger.warn(`🚨 孤児Issue検出: #${issueNumber} (プロセス: ${processId})`);

    try {
      // チェックイン処理で状態をリセット
      await this.checkinIssue({
        issueNumber,
        processId,
        finalStatus: 'error',
        metadata: {
          error: 'Process died unexpectedly',
          orphanedAt: new Date().toISOString(),
          originalPid: orphan.pid
        }
      });

      // GitHubコメントを追加
      if (this.github) {
        const comment = `## 孤児Issue修復

プロセス \`${processId}\` (PID: ${orphan.pid}) が予期せず終了したため、Issue #${issueNumber} の処理を中断しました。

- 開始時刻: ${orphan.startTime}
- タスクタイプ: ${orphan.taskType}
- 修復時刻: ${new Date().toISOString()}

再度処理を行いたい場合は、\`processing\` ラベルを削除してください。`;

        await this.github.addComment(issueNumber, comment);
      }

      this.logger.info(`✅ 孤児Issue #${issueNumber} を修復完了`);

    } catch (error) {
      this.logger.error(`❌ 孤児Issue #${issueNumber} の修復エラー:`, error);
    }
  }

  /**
   * プロセスのクリーンアップ
   */
  async cleanupProcess(request) {
    const { processId } = request;
    const processKeys = PoppoRedisKeys.process(processId);
    const lists = PoppoRedisKeys.lists();

    try {
      // プロセス情報を取得
      const processInfo = await this.redis.hgetall(processKeys.info);
      if (!processInfo || !processInfo.issueNumber) {
        return {
          message: 'Process not found or already cleaned up',
          processId
        };
      }

      // 関連するIssueをチェックイン
      if (processInfo.issueNumber && processInfo.status === 'active') {
        await this.checkinIssue({
          issueNumber: processInfo.issueNumber,
          processId,
          finalStatus: 'error',
          metadata: {
            error: 'Process cleanup requested',
            cleanupAt: new Date().toISOString()
          }
        });
      }

      // プロセス情報を削除
      const multi = this.redis.multi();
      multi.del(processKeys.info);
      multi.del(processKeys.heartbeat);
      multi.srem(lists.activeProcesses, processId);
      
      await multi.exec();

      this.logger.info(`🧹 プロセス ${processId} をクリーンアップ`);
      
      return {
        message: 'Process cleaned up successfully',
        processId,
        issueNumber: processInfo.issueNumber
      };

    } catch (error) {
      this.logger.error(`プロセス ${processId} のクリーンアップエラー:`, error);
      throw error;
    }
  }

  /**
   * プロセス生存確認
   */
  isProcessAlive(pid) {
    if (!pid) return false;
    
    try {
      // シグナル0を送ってプロセスの存在確認
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * GitHubラベルの更新
   */
  async updateGitHubLabel(issueNumber, status) {
    if (!this.github) return;

    try {
      // 現在のラベルを取得
      const issue = await this.github.getIssue(issueNumber);
      const currentLabels = issue.labels.map(l => l.name);
      
      // 状態ラベルを更新
      const statusLabels = ['processing', 'awaiting-response', 'completed', 'error'];
      const labelsToRemove = currentLabels.filter(label => statusLabels.includes(label));
      const labelToAdd = status;

      if (labelsToRemove.length > 0) {
        await this.github.removeLabels(issueNumber, labelsToRemove);
      }
      
      if (labelToAdd && !currentLabels.includes(labelToAdd)) {
        await this.github.addLabels(issueNumber, [labelToAdd]);
      }

      this.logger.info(`🏷️  Issue #${issueNumber} のラベルを ${status} に更新`);

    } catch (error) {
      this.logger.error(`GitHub label update error for issue #${issueNumber}:`, error);
      throw error;
    }
  }

  /**
   * 正常終了処理
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.info('🛑 MirinRedisAmbassador終了処理開始');

    try {
      // タイマーの停止
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
      }
      if (this.orphanCheckTimer) {
        clearInterval(this.orphanCheckTimer);
      }

      // Redis接続の切断
      if (this.subscriber) {
        await this.subscriber.unsubscribe();
        this.subscriber.disconnect();
      }
      if (this.redis) {
        this.redis.disconnect();
      }

      this.emit('shutdown');
      this.logger.info('✅ MirinRedisAmbassador正常終了');

    } catch (error) {
      this.logger.error('❌ MirinRedisAmbassador終了エラー:', error);
    }
  }
}

module.exports = { MirinRedisAmbassador, PoppoRedisKeys, TTL };