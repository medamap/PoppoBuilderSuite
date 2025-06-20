/**
 * インスタンス調整モジュール
 * 
 * 複数のCCSPインスタンス間でリクエストの重複処理を防止
 */

const os = require('os');

class InstanceCoordinator {
  constructor(redis, logger) {
    this.redis = redis;
    this.logger = logger;
    this.instanceId = `ccsp:${os.hostname()}:${process.pid}`;
    this.claimTTL = 300; // 5分
  }
  
  /**
   * リクエストをアトミックに要求
   * @param {string} requestId - リクエストID
   * @returns {boolean} 要求に成功した場合true
   */
  async claimRequest(requestId) {
    try {
      const claimKey = `ccsp:claim:${requestId}`;
      
      // SET NX EX でアトミックに要求
      const result = await this.redis.set(
        claimKey,
        this.instanceId,
        'NX', // 存在しない場合のみセット
        'EX', this.claimTTL // TTL
      );
      
      if (result === 'OK') {
        this.logger.debug(`Request ${requestId} claimed by ${this.instanceId}`);
        return true;
      } else {
        this.logger.debug(`Request ${requestId} already claimed by another instance`);
        return false;
      }
      
    } catch (error) {
      this.logger.error(`Failed to claim request ${requestId}:`, error);
      return false;
    }
  }
  
  /**
   * リクエストの要求を解放
   * @param {string} requestId - リクエストID
   */
  async releaseRequest(requestId) {
    try {
      const claimKey = `ccsp:claim:${requestId}`;
      
      // 自分が要求しているか確認してから削除
      const currentClaim = await this.redis.get(claimKey);
      if (currentClaim === this.instanceId) {
        await this.redis.del(claimKey);
        this.logger.debug(`Request ${requestId} released by ${this.instanceId}`);
      }
      
    } catch (error) {
      this.logger.error(`Failed to release request ${requestId}:`, error);
    }
  }
  
  /**
   * リクエストの要求を延長
   * @param {string} requestId - リクエストID
   */
  async extendClaim(requestId) {
    try {
      const claimKey = `ccsp:claim:${requestId}`;
      
      // 自分が要求しているか確認
      const currentClaim = await this.redis.get(claimKey);
      if (currentClaim === this.instanceId) {
        // TTLを延長
        await this.redis.expire(claimKey, this.claimTTL);
        this.logger.debug(`Request ${requestId} claim extended by ${this.instanceId}`);
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.logger.error(`Failed to extend claim for request ${requestId}:`, error);
      return false;
    }
  }
  
  /**
   * インスタンスの負荷情報を更新
   * @param {number} activeRequests - アクティブなリクエスト数
   */
  async updateLoad(activeRequests) {
    try {
      const loadKey = `ccsp:load:${this.instanceId}`;
      const loadInfo = {
        instanceId: this.instanceId,
        activeRequests,
        timestamp: Date.now(),
        capacity: 2 // 最大同時実行数
      };
      
      // 60秒のTTLで保存
      await this.redis.setex(loadKey, 60, JSON.stringify(loadInfo));
      
    } catch (error) {
      this.logger.error('Failed to update load info:', error);
    }
  }
  
  /**
   * 最も負荷の低いインスタンスを取得
   */
  async getLeastLoadedInstance() {
    try {
      const pattern = 'ccsp:load:*';
      const keys = await this.redis.keys(pattern);
      
      let leastLoaded = null;
      let minLoad = Infinity;
      
      for (const key of keys) {
        const data = await this.redis.get(key);
        if (data) {
          const loadInfo = JSON.parse(data);
          const loadRatio = loadInfo.activeRequests / loadInfo.capacity;
          
          if (loadRatio < minLoad) {
            minLoad = loadRatio;
            leastLoaded = loadInfo;
          }
        }
      }
      
      return leastLoaded;
      
    } catch (error) {
      this.logger.error('Failed to get least loaded instance:', error);
      return null;
    }
  }
  
  /**
   * リクエストを自分が処理すべきか判断
   */
  async shouldProcessRequest() {
    try {
      const leastLoaded = await this.getLeastLoadedInstance();
      
      // 最も負荷の低いインスタンスが自分かチェック
      if (leastLoaded && leastLoaded.instanceId === this.instanceId) {
        return true;
      }
      
      // 他のインスタンスがない場合は処理する
      if (!leastLoaded) {
        return true;
      }
      
      // ランダムに処理（負荷分散）
      return Math.random() < 0.5;
      
    } catch (error) {
      this.logger.error('Failed to determine if should process:', error);
      return true; // エラー時はデフォルトで処理
    }
  }
  
  /**
   * 古い要求をクリーンアップ
   */
  async cleanupOldClaims() {
    try {
      const pattern = 'ccsp:claim:*';
      const keys = await this.redis.keys(pattern);
      let cleaned = 0;
      
      for (const key of keys) {
        const ttl = await this.redis.ttl(key);
        if (ttl === -1) {
          // TTLが設定されていない古い要求を削除
          await this.redis.del(key);
          cleaned++;
        }
      }
      
      if (cleaned > 0) {
        this.logger.info(`Cleaned up ${cleaned} old claims`);
      }
      
    } catch (error) {
      this.logger.error('Failed to cleanup old claims:', error);
    }
  }
}

module.exports = InstanceCoordinator;