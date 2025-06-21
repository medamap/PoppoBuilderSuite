/**
 * State Synchronizer
 * グローバル状態とプロジェクトローカル状態の同期を管理
 */

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');
const crypto = require('crypto');
const { LockManager } = require('../utils/lock-manager');

class StateSynchronizer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      globalStateDir: options.globalStateDir || path.join(process.env.HOME || process.env.USERPROFILE, '.poppobuilder', 'state'),
      syncInterval: options.syncInterval || 5000, // 5秒
      conflictResolution: options.conflictResolution || 'last-write-wins',
      enableAutoSync: options.enableAutoSync !== false,
      transactionTimeout: options.transactionTimeout || 30000,
      ...options
    };
    
    this.lockManager = new LockManager({
      lockDir: path.join(this.options.globalStateDir, '.locks')
    });
    
    this.globalState = new Map();
    this.localStates = new Map(); // projectId -> state
    this.pendingTransactions = new Map();
    this.syncTimers = new Map();
    this.stateWatchers = new Map();
    
    this.isInitialized = false;
  }

  /**
   * Initialize state synchronizer
   */
  async initialize() {
    if (this.isInitialized) return;
    
    // ディレクトリの作成
    await fs.mkdir(this.options.globalStateDir, { recursive: true });
    
    // ロックマネージャーの初期化
    await this.lockManager.initialize();
    
    // グローバル状態の読み込み
    await this.loadGlobalState();
    
    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * Register a project for state synchronization
   * @param {string} projectId - Project identifier
   * @param {string} projectPath - Project path
   */
  async registerProject(projectId, projectPath) {
    const localStateDir = path.join(projectPath, '.poppobuilder', 'state');
    
    // ローカル状態ディレクトリの作成
    await fs.mkdir(localStateDir, { recursive: true });
    
    // プロジェクトを登録
    this.localStates.set(projectId, {
      id: projectId,
      path: projectPath,
      stateDir: localStateDir,
      lastSync: null,
      version: 0
    });
    
    // 初期同期
    await this.syncProject(projectId);
    
    // 自動同期の設定
    if (this.options.enableAutoSync) {
      this.startAutoSync(projectId);
    }
    
    // ファイル監視の設定
    await this.setupFileWatcher(projectId);
    
    this.emit('project-registered', { projectId, projectPath });
  }

  /**
   * Unregister a project
   * @param {string} projectId - Project identifier
   */
  async unregisterProject(projectId) {
    // 自動同期の停止
    this.stopAutoSync(projectId);
    
    // ファイル監視の停止
    this.stopFileWatcher(projectId);
    
    // 登録解除
    this.localStates.delete(projectId);
    
    this.emit('project-unregistered', { projectId });
  }

  /**
   * Get global state
   * @param {string} key - State key
   * @param {*} defaultValue - Default value if key doesn't exist
   */
  async getGlobalState(key, defaultValue = null) {
    await this.ensureInitialized();
    
    const state = this.globalState.get(key);
    return state !== undefined ? state : defaultValue;
  }

  /**
   * Set global state
   * @param {string} key - State key
   * @param {*} value - State value
   * @param {Object} options - Set options
   */
  async setGlobalState(key, value, options = {}) {
    await this.ensureInitialized();
    
    return await this.executeTransaction(async () => {
      const lockId = await this.lockManager.acquire(`global:${key}`, {
        timeout: options.lockTimeout || 5000
      });
      
      try {
        // 現在の値を取得
        const current = this.globalState.get(key);
        
        // 競合チェック
        if (options.version !== undefined && current?.version !== options.version) {
          throw new Error(`Version conflict for key: ${key}`);
        }
        
        // 新しい値を設定
        const newValue = {
          value,
          version: (current?.version || 0) + 1,
          updatedAt: Date.now(),
          updatedBy: options.updatedBy || 'system'
        };
        
        this.globalState.set(key, newValue);
        
        // ファイルに保存
        await this.saveGlobalState();
        
        // 変更をブロードキャスト
        this.broadcastStateChange('global', key, newValue);
        
        return newValue;
      } finally {
        await this.lockManager.release(`global:${key}`, lockId);
      }
    }, options);
  }

  /**
   * Get local state
   * @param {string} projectId - Project identifier
   * @param {string} key - State key
   * @param {*} defaultValue - Default value
   * @param {boolean} returnFullState - Return full state object instead of just value
   */
  async getLocalState(projectId, key, defaultValue = null, returnFullState = false) {
    const project = this.localStates.get(projectId);
    if (!project) {
      throw new Error(`Project not registered: ${projectId}`);
    }
    
    const statePath = path.join(project.stateDir, `${key}.json`);
    
    try {
      const content = await fs.readFile(statePath, 'utf8');
      const state = JSON.parse(content);
      
      if (returnFullState) {
        return state;
      }
      
      return state.value !== undefined ? state.value : defaultValue;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return defaultValue;
      }
      throw error;
    }
  }

  /**
   * Set local state
   * @param {string} projectId - Project identifier
   * @param {string} key - State key
   * @param {*} value - State value
   * @param {Object} options - Set options
   */
  async setLocalState(projectId, key, value, options = {}) {
    const project = this.localStates.get(projectId);
    if (!project) {
      throw new Error(`Project not registered: ${projectId}`);
    }
    
    return await this.executeTransaction(async () => {
      const lockId = await this.lockManager.acquire(`local:${projectId}:${key}`, {
        timeout: options.lockTimeout || 5000
      });
      
      try {
        const statePath = path.join(project.stateDir, `${key}.json`);
        
        // 現在の値を取得
        let current = null;
        try {
          const content = await fs.readFile(statePath, 'utf8');
          current = JSON.parse(content);
        } catch (error) {
          // ファイルが存在しない場合は無視
        }
        
        // 競合チェック
        if (options.version !== undefined && current?.version !== options.version) {
          throw new Error(`Version conflict for key: ${key} in project: ${projectId}`);
        }
        
        // 新しい値を設定
        const newValue = {
          value,
          version: (current?.version || 0) + 1,
          updatedAt: Date.now(),
          updatedBy: options.updatedBy || 'system',
          projectId
        };
        
        // ファイルに保存
        await fs.writeFile(statePath, JSON.stringify(newValue, null, 2));
        
        // 変更をブロードキャスト
        this.broadcastStateChange('local', `${projectId}:${key}`, newValue);
        
        // グローバルとの同期が必要な場合
        if (options.syncToGlobal) {
          await this.syncLocalToGlobal(projectId, key, newValue);
        }
        
        return newValue;
      } finally {
        await this.lockManager.release(`local:${projectId}:${key}`, lockId);
      }
    }, options);
  }

  /**
   * Sync project state
   * @param {string} projectId - Project identifier
   */
  async syncProject(projectId) {
    const project = this.localStates.get(projectId);
    if (!project) {
      throw new Error(`Project not registered: ${projectId}`);
    }
    
    const lockId = await this.lockManager.acquire(`sync:${projectId}`, {
      timeout: 10000
    });
    
    try {
      // グローバル→ローカルの同期
      await this.syncGlobalToLocal(projectId);
      
      // ローカル→グローバルの同期
      await this.syncLocalToGlobal(projectId);
      
      // 最終同期時刻を更新
      project.lastSync = Date.now();
      
      this.emit('project-synced', { projectId });
    } finally {
      await this.lockManager.release(`sync:${projectId}`, lockId);
    }
  }

  /**
   * Sync all projects
   */
  async syncAll() {
    const promises = [];
    
    for (const projectId of this.localStates.keys()) {
      promises.push(this.syncProject(projectId));
    }
    
    await Promise.all(promises);
    this.emit('all-synced');
  }

  /**
   * Execute a transaction
   * @private
   */
  async executeTransaction(fn, options = {}) {
    const transactionId = crypto.randomUUID();
    const timeout = options.transactionTimeout || this.options.transactionTimeout;
    
    this.pendingTransactions.set(transactionId, {
      id: transactionId,
      startedAt: Date.now(),
      status: 'pending'
    });
    
    const timeoutHandle = setTimeout(() => {
      const transaction = this.pendingTransactions.get(transactionId);
      if (transaction && transaction.status === 'pending') {
        transaction.status = 'timeout';
        this.emit('transaction-timeout', { transactionId });
      }
    }, timeout);
    
    try {
      const result = await fn();
      
      const transaction = this.pendingTransactions.get(transactionId);
      if (transaction) {
        transaction.status = 'completed';
        transaction.completedAt = Date.now();
      }
      
      return result;
    } catch (error) {
      const transaction = this.pendingTransactions.get(transactionId);
      if (transaction) {
        transaction.status = 'failed';
        transaction.error = error;
      }
      
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
      
      // トランザクション情報をクリーンアップ
      setTimeout(() => {
        this.pendingTransactions.delete(transactionId);
      }, 60000); // 1分後に削除
    }
  }

  /**
   * Sync global state to local
   * @private
   */
  async syncGlobalToLocal(projectId) {
    const project = this.localStates.get(projectId);
    if (!project) return;
    
    // プロジェクト固有のグローバル状態キーを取得
    const globalKeys = await this.getProjectGlobalKeys(projectId);
    
    for (const key of globalKeys) {
      const globalState = await this.getGlobalState(key);
      if (globalState === null) continue;
      
      const localKey = this.globalToLocalKey(key, projectId);
      const localState = await this.getLocalState(projectId, localKey, null, true);
      
      // 競合解決
      if (localState !== null && this.shouldResolveConflict(globalState, localState)) {
        const resolved = await this.resolveConflict(globalState, localState);
        await this.setLocalState(projectId, localKey, resolved.value, {
          syncToGlobal: false // 循環を防ぐ
        });
      } else if (localState === null || globalState.version > (localState?.version || 0)) {
        // グローバルの方が新しい場合は上書き
        await this.setLocalState(projectId, localKey, globalState.value, {
          syncToGlobal: false // 循環を防ぐ
        });
      }
    }
  }

  /**
   * Sync local state to global
   * @private
   */
  async syncLocalToGlobal(projectId, specificKey = null) {
    const project = this.localStates.get(projectId);
    if (!project) return;
    
    try {
      const localFiles = specificKey 
        ? [`${specificKey}.json`]
        : await fs.readdir(project.stateDir);
      
      for (const file of localFiles) {
        if (!file.endsWith('.json')) continue;
        
        const key = path.basename(file, '.json');
        const localState = await this.getLocalState(projectId, key, null, true);
        
        if (localState === null) continue;
        
        // グローバルキーに変換
        const globalKey = this.localToGlobalKey(key, projectId);
        const globalState = await this.getGlobalState(globalKey);
        
        // 競合解決
        if (globalState !== null && this.shouldResolveConflict(localState, globalState)) {
          const resolved = await this.resolveConflict(localState, globalState);
          await this.setGlobalState(globalKey, resolved.value);
        } else if (globalState === null || localState.version > (globalState?.version || 0)) {
          // ローカルの方が新しい場合は上書き
          await this.setGlobalState(globalKey, localState.value);
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * Resolve conflict between states
   * @private
   */
  async resolveConflict(state1, state2) {
    switch (this.options.conflictResolution) {
      case 'last-write-wins':
        return state1.updatedAt > state2.updatedAt ? state1 : state2;
        
      case 'version-wins':
        return state1.version > state2.version ? state1 : state2;
        
      case 'merge':
        return await this.mergeStates(state1, state2);
        
      case 'callback':
        if (this.options.conflictResolver) {
          return await this.options.conflictResolver(state1, state2);
        }
        // フォールバック
        return state1.updatedAt > state2.updatedAt ? state1 : state2;
        
      default:
        return state1.updatedAt > state2.updatedAt ? state1 : state2;
    }
  }

  /**
   * Merge two states
   * @private
   */
  async mergeStates(state1, state2) {
    // 単純な実装: より新しいフィールドを採用
    const merged = {
      value: {},
      version: Math.max(state1.version, state2.version) + 1,
      updatedAt: Date.now(),
      updatedBy: 'merge'
    };
    
    // オブジェクトの場合はディープマージ
    if (typeof state1.value === 'object' && typeof state2.value === 'object') {
      merged.value = this.deepMerge(state1.value, state2.value);
    } else {
      // プリミティブ値の場合は新しい方を採用
      merged.value = state1.updatedAt > state2.updatedAt ? state1.value : state2.value;
    }
    
    return merged;
  }

  /**
   * Deep merge objects
   * @private
   */
  deepMerge(obj1, obj2) {
    const result = { ...obj1 };
    
    for (const key in obj2) {
      if (obj2.hasOwnProperty(key)) {
        if (typeof obj2[key] === 'object' && obj2[key] !== null && !Array.isArray(obj2[key])) {
          result[key] = this.deepMerge(obj1[key] || {}, obj2[key]);
        } else {
          result[key] = obj2[key];
        }
      }
    }
    
    return result;
  }

  /**
   * Should resolve conflict
   * @private
   */
  shouldResolveConflict(state1, state2) {
    return state1.version !== state2.version && 
           state1.updatedAt !== state2.updatedAt;
  }

  /**
   * Get project global keys
   * @private
   */
  async getProjectGlobalKeys(projectId) {
    const keys = [];
    
    for (const [key, value] of this.globalState) {
      if (key.startsWith(`project:${projectId}:`)) {
        keys.push(key);
      }
    }
    
    return keys;
  }

  /**
   * Convert global key to local key
   * @private
   */
  globalToLocalKey(globalKey, projectId) {
    const prefix = `project:${projectId}:`;
    if (globalKey.startsWith(prefix)) {
      return globalKey.substring(prefix.length);
    }
    return globalKey;
  }

  /**
   * Convert local key to global key
   * @private
   */
  localToGlobalKey(localKey, projectId) {
    return `project:${projectId}:${localKey}`;
  }

  /**
   * Load global state from disk
   * @private
   */
  async loadGlobalState() {
    const stateFiles = ['processes.json', 'queue.json'];
    
    for (const file of stateFiles) {
      const filePath = path.join(this.options.globalStateDir, file);
      
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const data = JSON.parse(content);
        
        // 各エントリをロード
        for (const [key, value] of Object.entries(data)) {
          this.globalState.set(key, value);
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          console.error(`Error loading global state from ${file}:`, error);
        }
      }
    }
  }

  /**
   * Save global state to disk
   * @private
   */
  async saveGlobalState() {
    // プロセス関連の状態
    const processes = {};
    const queue = {};
    
    for (const [key, value] of this.globalState) {
      if (key.includes('process')) {
        processes[key] = value;
      } else if (key.includes('queue')) {
        queue[key] = value;
      }
    }
    
    // ファイルに保存
    await fs.writeFile(
      path.join(this.options.globalStateDir, 'processes.json'),
      JSON.stringify(processes, null, 2)
    );
    
    await fs.writeFile(
      path.join(this.options.globalStateDir, 'queue.json'),
      JSON.stringify(queue, null, 2)
    );
  }

  /**
   * Broadcast state change
   * @private
   */
  broadcastStateChange(type, key, value) {
    this.emit('state-changed', {
      type,
      key,
      value,
      timestamp: Date.now()
    });
  }

  /**
   * Start auto sync for a project
   * @private
   */
  startAutoSync(projectId) {
    if (this.syncTimers.has(projectId)) return;
    
    const timer = setInterval(() => {
      this.syncProject(projectId).catch(error => {
        console.error(`Auto sync error for project ${projectId}:`, error);
      });
    }, this.options.syncInterval);
    
    this.syncTimers.set(projectId, timer);
  }

  /**
   * Stop auto sync for a project
   * @private
   */
  stopAutoSync(projectId) {
    const timer = this.syncTimers.get(projectId);
    if (timer) {
      clearInterval(timer);
      this.syncTimers.delete(projectId);
    }
  }

  /**
   * Setup file watcher for a project
   * @private
   */
  async setupFileWatcher(projectId) {
    const project = this.localStates.get(projectId);
    if (!project) return;
    
    const { watch } = require('fs');
    
    const watcher = watch(project.stateDir, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.json')) {
        this.emit('local-state-file-changed', {
          projectId,
          eventType,
          filename
        });
        
        // 自動同期が有効な場合は同期を実行
        if (this.options.enableAutoSync) {
          this.syncProject(projectId).catch(error => {
            console.error(`File watcher sync error:`, error);
          });
        }
      }
    });
    
    this.stateWatchers.set(projectId, watcher);
  }

  /**
   * Stop file watcher for a project
   * @private
   */
  stopFileWatcher(projectId) {
    const watcher = this.stateWatchers.get(projectId);
    if (watcher) {
      watcher.close();
      this.stateWatchers.delete(projectId);
    }
  }

  /**
   * Ensure initialized
   * @private
   */
  async ensureInitialized() {
    if (!this.isInitialized) {
      await this.initialize();
    }
  }

  /**
   * Cleanup
   */
  async cleanup() {
    // すべての自動同期を停止
    for (const projectId of this.syncTimers.keys()) {
      this.stopAutoSync(projectId);
    }
    
    // すべてのファイル監視を停止
    for (const projectId of this.stateWatchers.keys()) {
      this.stopFileWatcher(projectId);
    }
    
    // ロックマネージャーのクリーンアップ
    await this.lockManager.cleanup();
    
    this.emit('cleanup');
  }
}

// Singleton instance
let instance = null;

/**
 * Get singleton instance
 */
function getInstance(options) {
  if (!instance) {
    instance = new StateSynchronizer(options);
  }
  return instance;
}

module.exports = {
  StateSynchronizer,
  getInstance
};