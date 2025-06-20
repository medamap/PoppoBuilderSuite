const EventEmitter = require('events');
const RedisStateClient = require('./redis-state-client');
const { PoppoRedisKeys } = require('./mirin-redis-ambassador');
const path = require('path');

/**
 * UnifiedStateManagerRedis
 * 
 * UnifiedStateManagerのRedisバックエンド実装。
 * RedisStateClientを使用してMirinRedisAmbassadorと通信し、
 * 状態管理をRedisで行う。
 */
class UnifiedStateManagerRedis extends EventEmitter {
  constructor(stateDir = path.join(__dirname, '../state'), options = {}) {
    super();
    this.stateDir = stateDir; // 互換性のため保持
    this.processId = options.processId || `unified-state-${process.pid}`;
    this.redisClient = new RedisStateClient(this.processId, options);
    this.namespaces = new Map(); // ローカルキャッシュ
    this.transactionLock = null;
    this.transactionData = null;
    this.watchers = new Map();
    this.isInitialized = false;
  }

  /**
   * 初期化
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    // RedisStateClientを接続
    await this.redisClient.connect();
    
    // デフォルトの名前空間を定義
    const defaultNamespaces = [
      'issues',      // Issue関連の状態
      'comments',    // コメント関連の状態
      'tasks',       // タスク実行状態
      'processes',   // プロセス管理
      'agents',      // エージェント固有データ
      'config'       // 動的設定
    ];
    
    for (const namespace of defaultNamespaces) {
      await this.ensureNamespace(namespace);
    }

    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * 名前空間の確保
   */
  async ensureNamespace(namespace) {
    if (!this.namespaces.has(namespace)) {
      const redisKey = `poppo:state:${namespace}`;
      try {
        // Redisから既存データを取得
        const data = await this.redisClient.directHGetAll(redisKey);
        this.namespaces.set(namespace, data || {});
      } catch (error) {
        // エラーの場合は空のオブジェクトで初期化
        this.namespaces.set(namespace, {});
      }
    }
  }

  /**
   * 名前空間の保存（Redisへの書き込み）
   */
  async saveNamespace(namespace) {
    const data = this.namespaces.get(namespace);
    if (!data) return;
    
    const redisKey = `poppo:state:${namespace}`;
    const redis = this.redisClient.redis;
    
    // 全データをRedisに保存
    if (Object.keys(data).length === 0) {
      // 空の場合はキー自体を削除
      await redis.del(redisKey);
    } else {
      // データをハッシュとして保存
      const flatData = {};
      for (const [key, value] of Object.entries(data)) {
        flatData[key] = JSON.stringify(value);
      }
      await redis.hset(redisKey, flatData);
    }
  }

  /**
   * 値の取得
   */
  async get(namespace, key) {
    await this.ensureNamespace(namespace);
    const data = this.namespaces.get(namespace);
    
    if (key) {
      const value = data[key];
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    }
    
    // 全データを返す場合はパースして返す
    const parsedData = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') {
        try {
          parsedData[k] = JSON.parse(v);
        } catch {
          parsedData[k] = v;
        }
      } else {
        parsedData[k] = v;
      }
    }
    return parsedData;
  }

  /**
   * 値の設定
   */
  async set(namespace, key, value) {
    await this.ensureNamespace(namespace);
    
    if (this.transactionLock) {
      // トランザクション中はトランザクションデータに保存
      if (!this.transactionData[namespace]) {
        this.transactionData[namespace] = {};
      }
      this.transactionData[namespace][key] = value;
    } else {
      const data = this.namespaces.get(namespace);
      const oldValue = data[key];
      
      // 値をJSON文字列として保存
      data[key] = JSON.stringify(value);
      
      // Redisに即座に保存
      const redisKey = `poppo:state:${namespace}`;
      await this.redisClient.redis.hset(redisKey, key, data[key]);
      
      // 変更を通知
      this.emit('change', {
        namespace,
        key,
        oldValue: oldValue ? JSON.parse(oldValue) : undefined,
        newValue: value
      });
      
      // ウォッチャーに通知
      this.notifyWatchers(namespace, key, oldValue ? JSON.parse(oldValue) : undefined, value);
    }
  }

  /**
   * 値の削除
   */
  async delete(namespace, key) {
    await this.ensureNamespace(namespace);
    
    if (this.transactionLock) {
      if (!this.transactionData[namespace]) {
        this.transactionData[namespace] = {};
      }
      this.transactionData[namespace][key] = undefined;
    } else {
      const data = this.namespaces.get(namespace);
      const oldValue = data[key];
      delete data[key];
      
      // Redisから削除
      const redisKey = `poppo:state:${namespace}`;
      await this.redisClient.redis.hdel(redisKey, key);
      
      // 変更を通知
      this.emit('change', {
        namespace,
        key,
        oldValue: oldValue ? JSON.parse(oldValue) : undefined,
        newValue: undefined
      });
      
      // ウォッチャーに通知
      this.notifyWatchers(namespace, key, oldValue ? JSON.parse(oldValue) : undefined, undefined);
    }
  }

  /**
   * 値の存在確認
   */
  async has(namespace, key) {
    await this.ensureNamespace(namespace);
    const data = this.namespaces.get(namespace);
    return key in data;
  }

  /**
   * トランザクション処理
   */
  async transaction(callback) {
    if (this.transactionLock) {
      throw new Error('既にトランザクションが進行中です');
    }
    
    this.transactionLock = true;
    this.transactionData = {};
    
    try {
      // トランザクション内で操作を実行
      await callback(this);
      
      // すべての変更をコミット
      const multi = this.redisClient.redis.multi();
      
      for (const [namespace, changes] of Object.entries(this.transactionData)) {
        const redisKey = `poppo:state:${namespace}`;
        const data = this.namespaces.get(namespace);
        
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) {
            delete data[key];
            multi.hdel(redisKey, key);
          } else {
            data[key] = JSON.stringify(value);
            multi.hset(redisKey, key, data[key]);
          }
        }
      }
      
      await multi.exec();
      
      // 変更を通知
      for (const [namespace, changes] of Object.entries(this.transactionData)) {
        for (const [key, value] of Object.entries(changes)) {
          this.emit('change', {
            namespace,
            key,
            newValue: value
          });
          this.notifyWatchers(namespace, key, null, value);
        }
      }
    } catch (error) {
      // ロールバック（Redisから再読み込み）
      for (const namespace of Object.keys(this.transactionData)) {
        const redisKey = `poppo:state:${namespace}`;
        const data = await this.redisClient.directHGetAll(redisKey);
        this.namespaces.set(namespace, data || {});
      }
      throw error;
    } finally {
      this.transactionLock = false;
      this.transactionData = null;
    }
  }

  /**
   * 監視の開始
   */
  watch(namespace, callback) {
    if (!this.watchers.has(namespace)) {
      this.watchers.set(namespace, new Set());
    }
    this.watchers.get(namespace).add(callback);
  }

  /**
   * 監視の解除
   */
  unwatch(namespace, callback) {
    const watchers = this.watchers.get(namespace);
    if (watchers) {
      watchers.delete(callback);
    }
  }

  /**
   * ウォッチャーへの通知
   */
  notifyWatchers(namespace, key, oldValue, newValue) {
    const watchers = this.watchers.get(namespace);
    if (watchers) {
      for (const callback of watchers) {
        try {
          callback({
            key,
            oldValue,
            newValue
          });
        } catch (error) {
          console.error('ウォッチャーエラー:', error);
        }
      }
    }
  }

  /**
   * 名前空間の全データ取得
   */
  async getAll(namespace) {
    await this.ensureNamespace(namespace);
    return await this.get(namespace);
  }

  /**
   * 名前空間の全データ設定
   */
  async setAll(namespace, data) {
    await this.ensureNamespace(namespace);
    
    // トランザクションとして実行
    await this.transaction(async () => {
      // 既存のキーをすべて削除
      const currentData = await this.getAll(namespace);
      for (const key of Object.keys(currentData)) {
        await this.delete(namespace, key);
      }
      
      // 新しいデータを設定
      for (const [key, value] of Object.entries(data)) {
        await this.set(namespace, key, value);
      }
    });
    
    this.emit('change', {
      namespace,
      type: 'bulk'
    });
  }

  /**
   * 名前空間のクリア
   */
  async clear(namespace) {
    await this.ensureNamespace(namespace);
    const redisKey = `poppo:state:${namespace}`;
    
    // Redisからキーを削除
    await this.redisClient.redis.del(redisKey);
    
    // ローカルキャッシュもクリア
    this.namespaces.set(namespace, {});
    
    this.emit('change', {
      namespace,
      type: 'clear'
    });
  }

  /**
   * 既存メソッドとの互換性（後方互換性のため）
   */
  
  // FileStateManagerの処理済みIssue関連メソッド
  async loadProcessedIssues() {
    const issues = await this.getAll('issues');
    const processedNumbers = Object.keys(issues)
      .filter(num => {
        const issue = issues[num];
        return issue && (issue.status === 'completed' || issue.status === 'awaiting-response');
      })
      .map(num => parseInt(num));
    return new Set(processedNumbers);
  }

  async saveProcessedIssues(processedSet) {
    // 既存のIssue状態を保持しながら更新
    const currentIssues = await this.getAll('issues');
    for (const issueNumber of processedSet) {
      if (!currentIssues[issueNumber]) {
        currentIssues[issueNumber] = {
          status: 'completed',
          lastUpdated: new Date().toISOString()
        };
      }
    }
    await this.setAll('issues', currentIssues);
  }

  async addProcessedIssue(issueNumber) {
    const currentStatus = await this.get('issues', issueNumber.toString()) || {};
    await this.set('issues', issueNumber.toString(), {
      ...currentStatus,
      status: 'completed',
      lastUpdated: new Date().toISOString()
    });
  }

  async isIssueProcessed(issueNumber) {
    const issue = await this.get('issues', issueNumber.toString());
    return issue && (issue.status === 'completed' || issue.status === 'awaiting-response');
  }

  // 実行中タスク関連メソッド
  async loadRunningTasks() {
    const tasks = await this.getAll('tasks');
    const runningTasks = {};
    for (const [taskId, task] of Object.entries(tasks)) {
      if (task && task.status === 'running') {
        runningTasks[taskId] = task;
      }
    }
    return runningTasks;
  }

  async saveRunningTasks(runningTasks) {
    const currentTasks = await this.getAll('tasks');
    for (const [taskId, task] of Object.entries(runningTasks)) {
      currentTasks[taskId] = {
        ...task,
        status: 'running'
      };
    }
    await this.setAll('tasks', currentTasks);
  }

  async addRunningTask(taskId, taskInfo) {
    await this.set('tasks', taskId, {
      ...taskInfo,
      status: 'running',
      started: new Date().toISOString()
    });
  }

  async removeRunningTask(taskId) {
    const task = await this.get('tasks', taskId);
    if (task) {
      await this.set('tasks', taskId, {
        ...task,
        status: 'completed',
        completed: new Date().toISOString()
      });
    }
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    this.removeAllListeners();
    if (this.redisClient) {
      await this.redisClient.disconnect();
    }
    this.isInitialized = false;
  }
}

module.exports = UnifiedStateManagerRedis;