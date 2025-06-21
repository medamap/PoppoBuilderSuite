/**
 * モックRedis
 * 
 * Redis機能をメモリ内で模擬するテスト用実装
 */

const EventEmitter = require('events');

class MockRedis extends EventEmitter {
  constructor(config = {}) {
    super();
    
    this.config = {
      latency: config.latency || 1, // 1ms
      errorRate: config.errorRate || 0,
      maxMemory: config.maxMemory || 100 * 1024 * 1024, // 100MB
      ...config
    };
    
    // データストレージ
    this.data = new Map();
    this.lists = new Map();
    this.sets = new Map();
    this.hashes = new Map();
    this.expirations = new Map();
    
    // 統計
    this.stats = {
      commands: 0,
      reads: 0,
      writes: 0,
      errors: 0,
      connections: 0
    };
    
    this.isConnected = false;
    this.cleanupInterval = null;
  }
  
  /**
   * 接続開始
   */
  async start() {
    this.isConnected = true;
    this.stats.connections++;
    
    // 期限切れキーのクリーンアップを開始
    this.cleanupInterval = setInterval(() => {
      this.cleanupExpiredKeys();
    }, 1000);
    
    this.emit('connect');
    console.log('Mock Redis started');
  }
  
  /**
   * レイテンシーのシミュレーション
   */
  async simulateLatency() {
    if (this.config.latency > 0) {
      await new Promise(resolve => setTimeout(resolve, this.config.latency));
    }
  }
  
  /**
   * エラーのシミュレーション
   */
  simulateError() {
    if (Math.random() < this.config.errorRate) {
      throw new Error('Simulated Redis error');
    }
  }
  
  /**
   * 期限切れキーのクリーンアップ
   */
  cleanupExpiredKeys() {
    const now = Date.now();
    
    for (const [key, expireTime] of this.expirations) {
      if (expireTime <= now) {
        this.data.delete(key);
        this.lists.delete(key);
        this.sets.delete(key);
        this.hashes.delete(key);
        this.expirations.delete(key);
      }
    }
  }
  
  /**
   * 基本的なRedisコマンド
   */
  
  // PING
  async ping() {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    
    if (!this.isConnected) {
      throw new Error('Redis not connected');
    }
    
    return 'PONG';
  }
  
  // SET
  async set(key, value, options = {}) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    this.data.set(key, value);
    
    if (options.EX) {
      this.expirations.set(key, Date.now() + (options.EX * 1000));
    }
    
    return 'OK';
  }
  
  // GET
  async get(key) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    return this.data.get(key) || null;
  }
  
  // DEL
  async del(...keys) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    let deletedCount = 0;
    
    for (const key of keys) {
      if (this.data.has(key) || this.lists.has(key) || this.sets.has(key) || this.hashes.has(key)) {
        this.data.delete(key);
        this.lists.delete(key);
        this.sets.delete(key);
        this.hashes.delete(key);
        this.expirations.delete(key);
        deletedCount++;
      }
    }
    
    return deletedCount;
  }
  
  // EXISTS
  async exists(...keys) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    let count = 0;
    for (const key of keys) {
      if (this.data.has(key) || this.lists.has(key) || this.sets.has(key) || this.hashes.has(key)) {
        count++;
      }
    }
    
    return count;
  }
  
  // リストコマンド
  
  // LPUSH
  async lpush(key, ...values) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }
    
    const list = this.lists.get(key);
    list.unshift(...values);
    
    return list.length;
  }
  
  // RPUSH
  async rpush(key, ...values) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    if (!this.lists.has(key)) {
      this.lists.set(key, []);
    }
    
    const list = this.lists.get(key);
    list.push(...values);
    
    return list.length;
  }
  
  // LPOP
  async lpop(key) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    const list = this.lists.get(key);
    if (!list || list.length === 0) {
      return null;
    }
    
    return list.shift();
  }
  
  // RPOP
  async rpop(key) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    const list = this.lists.get(key);
    if (!list || list.length === 0) {
      return null;
    }
    
    return list.pop();
  }
  
  // LLEN
  async llen(key) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    const list = this.lists.get(key);
    return list ? list.length : 0;
  }
  
  // BLPOP (ブロッキング)
  async blpop(key, timeout) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    const list = this.lists.get(key);
    if (list && list.length > 0) {
      return [key, list.shift()];
    }
    
    // タイムアウトをシミュレート
    if (timeout > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(timeout * 1000, 100)));
    }
    
    return null;
  }
  
  // BRPOP (ブロッキング)
  async brpop(key, timeout) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    const list = this.lists.get(key);
    if (list && list.length > 0) {
      return [key, list.pop()];
    }
    
    // タイムアウトをシミュレート
    if (timeout > 0) {
      await new Promise(resolve => setTimeout(resolve, Math.min(timeout * 1000, 100)));
    }
    
    return null;
  }
  
  // ハッシュコマンド
  
  // HSET
  async hset(key, field, value) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    if (!this.hashes.has(key)) {
      this.hashes.set(key, new Map());
    }
    
    const hash = this.hashes.get(key);
    const isNew = !hash.has(field);
    hash.set(field, value);
    
    return isNew ? 1 : 0;
  }
  
  // HGET
  async hget(key, field) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    const hash = this.hashes.get(key);
    return hash ? hash.get(field) || null : null;
  }
  
  // HGETALL
  async hgetall(key) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    const hash = this.hashes.get(key);
    if (!hash) return {};
    
    const result = {};
    for (const [field, value] of hash) {
      result[field] = value;
    }
    
    return result;
  }
  
  // セットコマンド
  
  // SADD
  async sadd(key, ...members) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    if (!this.sets.has(key)) {
      this.sets.set(key, new Set());
    }
    
    const set = this.sets.get(key);
    let addedCount = 0;
    
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        addedCount++;
      }
    }
    
    return addedCount;
  }
  
  // SMEMBERS
  async smembers(key) {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.reads++;
    
    const set = this.sets.get(key);
    return set ? Array.from(set) : [];
  }
  
  // 統計情報の取得
  getStats() {
    return {
      ...this.stats,
      memory: {
        dataSize: this.data.size,
        listsSize: this.lists.size,
        setsSize: this.sets.size,
        hashesSize: this.hashes.size,
        expirationsSize: this.expirations.size
      },
      config: this.config
    };
  }
  
  // メモリのクリア
  async flushall() {
    await this.simulateLatency();
    this.simulateError();
    this.stats.commands++;
    this.stats.writes++;
    
    this.data.clear();
    this.lists.clear();
    this.sets.clear();
    this.hashes.clear();
    this.expirations.clear();
    
    return 'OK';
  }
  
  // 接続終了
  async quit() {
    this.isConnected = false;
    
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.emit('end');
    return 'OK';
  }
  
  // エラーハンドリング
  on(event, callback) {
    super.on(event, callback);
  }
  
  /**
   * モックサービスの停止
   */
  async stop() {
    await this.quit();
    console.log('Mock Redis stopped');
  }
}

module.exports = MockRedis;