/**
 * JSON ベースの Issue ステータス管理システム
 * GitHubラベルの代わりにJSONファイルで状態を管理し、
 * すべてのラベル操作をMirinOrphanManagerに委譲する
 */
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class StatusManager extends EventEmitter {
  constructor(stateFile = 'state/issue-status.json', logger = console) {
    super();
    this.stateFile = stateFile;
    this.logger = logger;
    this.state = { issues: {}, lastSync: null };
    this.lockFile = `${stateFile}.lock`;
    // stateFileと同じディレクトリ階層にrequestsディレクトリを作成
    this.requestsDir = path.join(path.dirname(stateFile), 'requests');
    this.isInitialized = false;
  }

  /**
   * 初期化処理
   */
  async initialize() {
    try {
      // ディレクトリの作成
      await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
      await fs.mkdir(this.requestsDir, { recursive: true });

      // 既存の状態ファイルを読み込む
      try {
        const data = await fs.readFile(this.stateFile, 'utf8');
        this.state = JSON.parse(data);
        this.logger.info('StatusManager: 既存の状態ファイルを読み込みました');
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
        // ファイルが存在しない場合は初期状態を作成
        await this.saveState();
        this.logger.info('StatusManager: 新しい状態ファイルを作成しました');
      }

      this.isInitialized = true;
      this.emit('initialized');
    } catch (error) {
      this.logger.error('StatusManager 初期化エラー:', error);
      throw error;
    }
  }

  /**
   * 状態をファイルに保存
   */
  async saveState() {
    const tempFile = `${this.stateFile}.tmp`;
    try {
      await fs.writeFile(tempFile, JSON.stringify(this.state, null, 2));
      await fs.rename(tempFile, this.stateFile);
    } catch (error) {
      this.logger.error('状態の保存エラー:', error);
      // テンポラリファイルをクリーンアップ
      try {
        await fs.unlink(tempFile);
      } catch (unlinkError) {
        // 無視
      }
      throw error;
    }
  }

  /**
   * ファイルロックを取得
   */
  async acquireLock(timeout = 5000) {
    const startTime = Date.now();
    while (true) {
      try {
        await fs.writeFile(this.lockFile, process.pid.toString(), { flag: 'wx' });
        return true;
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
        
        // 既存ロックファイルのPIDをチェック
        try {
          const existingPid = await fs.readFile(this.lockFile, 'utf8');
          const pid = parseInt(existingPid.trim());
          
          // プロセスが存在するかチェック
          if (!this.isProcessRunning(pid)) {
            console.log(`[StatusManager] 古いロックファイルを削除: PID ${pid} は存在しません`);
            await fs.unlink(this.lockFile);
            continue; // 次のループでロック取得を再試行
          }
        } catch (readError) {
          // ロックファイルが読めない場合は削除
          try {
            await fs.unlink(this.lockFile);
          } catch (unlinkError) {
            // 削除に失敗しても続行
          }
          continue;
        }
        
        // タイムアウトチェック
        if (Date.now() - startTime > timeout) {
          throw new Error('ロック取得タイムアウト');
        }
        
        // 少し待機してリトライ
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * プロセスが実行中かチェック
   */
  isProcessRunning(pid) {
    try {
      // kill 0 はシグナルを送信せずにプロセスの存在確認のみ
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * ファイルロックを解放
   */
  async releaseLock() {
    try {
      await fs.unlink(this.lockFile);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('ロック解放エラー:', error);
      }
    }
  }

  /**
   * Issue の状態を取得
   */
  async getStatus(issueNumber) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }
    
    return this.state.issues[issueNumber] || null;
  }

  /**
   * Issue の状態を更新
   */
  async updateStatus(issueNumber, status, metadata = {}) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    await this.acquireLock();
    try {
      const currentStatus = this.state.issues[issueNumber] || {};
      const oldStatus = currentStatus.status;
      
      this.state.issues[issueNumber] = {
        ...currentStatus,
        status,
        lastUpdated: new Date().toISOString(),
        ...metadata
      };

      await this.saveState();
      
      // MirinOrphanManager にラベル更新を依頼
      await this.requestLabelUpdate(issueNumber, status, oldStatus);
      
      this.emit('statusUpdated', { issueNumber, status, metadata });
      
      // 新しいイベントも発行（GitHub Projects同期用）
      if (oldStatus !== status) {
        this.emit('status-changed', issueNumber, status, oldStatus);
      }
      
      return this.state.issues[issueNumber];
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Issue のチェックアウト（処理開始）
   */
  async checkout(issueNumber, processId, taskType) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const metadata = {
      processId,
      pid: process.pid,
      startTime: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      taskType,
      metadata: {
        retryCount: 0,
        errorCount: 0
      }
    };

    return await this.updateStatus(issueNumber, 'processing', metadata);
  }

  /**
   * Issue のチェックイン（処理完了）
   */
  async checkin(issueNumber, status = 'completed', result = {}) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    await this.acquireLock();
    try {
      const currentStatus = this.state.issues[issueNumber];
      if (!currentStatus) {
        throw new Error(`Issue ${issueNumber} is not checked out`);
      }

      // 状態を更新
      this.state.issues[issueNumber] = {
        ...currentStatus,
        status,
        endTime: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        result,
        // プロセス情報をクリア
        processId: null,
        pid: null,
        lastHeartbeat: null
      };

      await this.saveState();
      
      // MirinOrphanManager にラベル更新を依頼
      await this.requestLabelUpdate(issueNumber, status, 'processing');
      
      this.emit('checkedIn', { issueNumber, status, result });
      
      // GitHub Projects同期用のイベントも発行
      if (currentStatus.status !== status) {
        this.emit('status-changed', issueNumber, status, currentStatus.status);
      }
      
      return this.state.issues[issueNumber];
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * ハートビート更新
   */
  async updateHeartbeat(issueNumber) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    await this.acquireLock();
    try {
      const currentStatus = this.state.issues[issueNumber];
      if (!currentStatus || currentStatus.status !== 'processing') {
        return false;
      }

      currentStatus.lastHeartbeat = new Date().toISOString();
      await this.saveState();
      
      return true;
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * MirinOrphanManager にラベル更新を依頼
   */
  async requestLabelUpdate(issueNumber, newStatus, oldStatus) {
    const request = {
      requestId: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date().toISOString(),
      issueNumber,
      action: 'update',
      addLabels: [],
      removeLabels: [],
      requestedBy: 'StatusManager',
      processId: process.pid.toString()
    };

    // ステータスに基づいてラベルを決定
    if (oldStatus === 'processing') {
      request.removeLabels.push('processing');
    }
    
    switch (newStatus) {
      case 'processing':
        request.addLabels.push('processing');
        break;
      case 'awaiting-response':
        request.addLabels.push('awaiting-response');
        break;
      case 'completed':
        request.addLabels.push('awaiting-response');
        break;
      case 'error':
        request.addLabels.push('error');
        break;
    }

    // リクエストファイルを作成
    const requestFile = path.join(this.requestsDir, `label-update-${Date.now()}.json`);
    try {
      await fs.writeFile(requestFile, JSON.stringify(request, null, 2));
      this.logger.info(`ラベル更新リクエストを作成: ${requestFile}`);
    } catch (error) {
      this.logger.error('ラベル更新リクエストの作成エラー:', error);
      // エラーが発生してもステータス更新は継続
    }
  }

  /**
   * 孤児 Issue の検出
   */
  async detectOrphanedIssues(heartbeatTimeout = 5 * 60 * 1000) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const orphaned = [];
    const now = Date.now();

    for (const [issueNumber, status] of Object.entries(this.state.issues)) {
      if (status.status === 'processing' && status.lastHeartbeat) {
        const lastHeartbeat = new Date(status.lastHeartbeat).getTime();
        if (now - lastHeartbeat > heartbeatTimeout) {
          // プロセスが生存しているかチェック
          if (status.pid && !this.isProcessRunning(status.pid)) {
            orphaned.push({
              issueNumber,
              ...status
            });
          }
        }
      }
    }

    return orphaned;
  }

  /**
   * プロセスが実行中かチェック
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Issue の状態をリセット
   */
  async resetIssueStatus(issueNumber) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    await this.acquireLock();
    try {
      delete this.state.issues[issueNumber];
      await this.saveState();
      
      // MirinOrphanManager にラベル削除を依頼
      await this.requestLabelUpdate(issueNumber, 'idle', 'processing');
      
      this.emit('statusReset', { issueNumber });
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * すべての Issue の状態を取得
   */
  async getAllStatuses() {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }
    
    return { ...this.state.issues };
  }

  /**
   * 現在処理中のIssue番号の配列を取得
   */
  getCurrentlyProcessing() {
    const processing = [];
    for (const [issueNumber, status] of Object.entries(this.state.issues)) {
      if (status.status === 'processing') {
        processing.push(parseInt(issueNumber));
      }
    }
    return processing;
  }

  /**
   * 統計情報を取得
   */
  async getStatistics() {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const stats = {
      total: 0,
      byStatus: {},
      byTaskType: {},
      oldestProcessing: null
    };

    for (const [issueNumber, status] of Object.entries(this.state.issues)) {
      stats.total++;
      
      // ステータス別カウント
      stats.byStatus[status.status] = (stats.byStatus[status.status] || 0) + 1;
      
      // タスクタイプ別カウント
      if (status.taskType) {
        stats.byTaskType[status.taskType] = (stats.byTaskType[status.taskType] || 0) + 1;
      }
      
      // 最も古い processing を探す
      if (status.status === 'processing' && status.startTime) {
        if (!stats.oldestProcessing || status.startTime < stats.oldestProcessing.startTime) {
          stats.oldestProcessing = {
            issueNumber,
            startTime: status.startTime,
            duration: Date.now() - new Date(status.startTime).getTime()
          };
        }
      }
    }

    return stats;
  }

  /**
   * クリーンアップ処理
   */
  async cleanup() {
    if (!this.isInitialized) {
      return;
    }

    // ロックファイルを削除
    try {
      await fs.unlink(this.lockFile);
    } catch (error) {
      // 無視
    }

    this.removeAllListeners();
    this.isInitialized = false;
  }
}

module.exports = StatusManager;