const EventEmitter = require('events');
const FileStateManager = require('./file-state-manager');
const path = require('path');
const fs = require('fs').promises;

/**
 * 統一状態管理システム
 * 
 * PoppoBuilder Suiteの全コンポーネントで使用する統一された状態管理インターフェース。
 * FileStateManagerを基盤として、名前空間、トランザクション、監視機能を提供。
 */
class UnifiedStateManager extends EventEmitter {
  constructor(stateDir = path.join(__dirname, '../state')) {
    super();
    this.stateDir = stateDir;
    this.fileStateManager = new FileStateManager(stateDir);
    this.namespaces = new Map();
    this.transactionLock = null;
    this.transactionData = null;
    this.watchers = new Map();
  }

  /**
   * 初期化
   */
  async initialize() {
    await this.fileStateManager.init();
    
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
  }

  /**
   * 名前空間の確保
   */
  async ensureNamespace(namespace) {
    if (!this.namespaces.has(namespace)) {
      const filePath = path.join(this.stateDir, `unified-${namespace}.json`);
      try {
        await fs.access(filePath);
        const data = await fs.readFile(filePath, 'utf8');
        this.namespaces.set(namespace, JSON.parse(data));
      } catch {
        // ファイルが存在しない場合は空のオブジェクトで初期化
        this.namespaces.set(namespace, {});
        await this.saveNamespace(namespace);
      }
    }
  }

  /**
   * 名前空間の保存
   */
  async saveNamespace(namespace) {
    const data = this.namespaces.get(namespace);
    if (!data) return;
    
    const filePath = path.join(this.stateDir, `unified-${namespace}.json`);
    await this.fileStateManager.atomicWrite(filePath, JSON.stringify(data, null, 2));
  }

  /**
   * 値の取得
   */
  async get(namespace, key) {
    await this.ensureNamespace(namespace);
    const data = this.namespaces.get(namespace);
    return key ? data[key] : data;
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
      data[key] = value;
      
      await this.saveNamespace(namespace);
      
      // 変更を通知
      this.emit('change', {
        namespace,
        key,
        oldValue,
        newValue: value
      });
      
      // ウォッチャーに通知
      this.notifyWatchers(namespace, key, oldValue, value);
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
      
      await this.saveNamespace(namespace);
      
      // 変更を通知
      this.emit('change', {
        namespace,
        key,
        oldValue,
        newValue: undefined
      });
      
      // ウォッチャーに通知
      this.notifyWatchers(namespace, key, oldValue, undefined);
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
      for (const [namespace, changes] of Object.entries(this.transactionData)) {
        const data = this.namespaces.get(namespace);
        for (const [key, value] of Object.entries(changes)) {
          if (value === undefined) {
            delete data[key];
          } else {
            data[key] = value;
          }
        }
        await this.saveNamespace(namespace);
      }
      
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
      // ロールバック（メモリ上のデータを再読み込み）
      for (const namespace of Object.keys(this.transactionData)) {
        const filePath = path.join(this.stateDir, `unified-${namespace}.json`);
        try {
          const data = await fs.readFile(filePath, 'utf8');
          this.namespaces.set(namespace, JSON.parse(data));
        } catch {
          this.namespaces.set(namespace, {});
        }
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
    return { ...this.namespaces.get(namespace) };
  }

  /**
   * 名前空間の全データ設定
   */
  async setAll(namespace, data) {
    await this.ensureNamespace(namespace);
    this.namespaces.set(namespace, { ...data });
    await this.saveNamespace(namespace);
    
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
    this.namespaces.set(namespace, {});
    await this.saveNamespace(namespace);
    
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
      .filter(num => issues[num].status === 'completed' || issues[num].status === 'awaiting-response')
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
    const currentStatus = await this.get('issues', issueNumber) || {};
    await this.set('issues', issueNumber, {
      ...currentStatus,
      status: 'completed',
      lastUpdated: new Date().toISOString()
    });
  }

  async isIssueProcessed(issueNumber) {
    const issue = await this.get('issues', issueNumber);
    return issue && (issue.status === 'completed' || issue.status === 'awaiting-response');
  }

  // 実行中タスク関連メソッド
  async loadRunningTasks() {
    const tasks = await this.getAll('tasks');
    const runningTasks = {};
    for (const [taskId, task] of Object.entries(tasks)) {
      if (task.status === 'running') {
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
}

module.exports = UnifiedStateManager;