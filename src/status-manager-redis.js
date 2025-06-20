const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');
const UnifiedStateManagerRedis = require('./unified-state-manager-redis');

/**
 * StatusManagerRedis - Redis対応版StatusManager
 * 
 * StatusManagerUnifiedを拡張し、RedisバックエンドのUnifiedStateManagerを使用。
 * MirinRedisAmbassadorを通じてRedisに状態を保存する。
 */
class StatusManagerRedis extends EventEmitter {
  constructor(configPath = path.join(__dirname, '../state'), options = {}) {
    super();
    this.configPath = configPath;
    this.options = {
      processId: `status-manager-${process.pid}`,
      ...options
    };
    this.unifiedStateManager = null;
    this.isInitialized = false;
    this.lockTimeout = options.lockTimeout || 30000; // 30秒
  }

  /**
   * 初期化
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    // UnifiedStateManagerRedisを使用
    this.unifiedStateManager = new UnifiedStateManagerRedis(this.configPath, this.options);
    await this.unifiedStateManager.initialize();
    
    // 既存のissue-status.jsonがある場合はマイグレーション（初回のみ）
    await this.migrateExistingData();
    
    this.isInitialized = true;
    this.emit('initialized');
  }

  /**
   * 既存データのマイグレーション
   */
  async migrateExistingData() {
    const migrationFlag = await this.unifiedStateManager.get('config', 'statusManagerMigrated');
    if (migrationFlag) {
      return; // 既にマイグレーション済み
    }

    const oldPath = path.join(this.configPath, 'issue-status.json');
    try {
      await fs.access(oldPath);
      const oldData = JSON.parse(await fs.readFile(oldPath, 'utf8'));
      
      if (oldData.issues) {
        // 既存のデータをUnifiedStateManagerに移行
        await this.unifiedStateManager.setAll('issues', oldData.issues);
        
        // マイグレーションフラグを設定
        await this.unifiedStateManager.set('config', 'statusManagerMigrated', true);
        
        // バックアップを作成
        const backupPath = oldPath + '.backup-' + Date.now();
        await fs.rename(oldPath, backupPath);
        
        console.log(`StatusManagerRedis: 既存データを移行しました (バックアップ: ${backupPath})`);
      }
    } catch (error) {
      // ファイルが存在しない場合は無視
      if (error.code !== 'ENOENT') {
        console.error('マイグレーションエラー:', error);
      }
    }
  }

  /**
   * Issue のチェックアウト（処理開始）
   */
  async checkout(issueNumber, processId, taskType = 'claude-cli') {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const metadata = {
      status: 'processing',
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

    await this.unifiedStateManager.set('issues', issueNumber.toString(), metadata);
    
    // MirinOrphanManager にラベル更新を依頼
    await this.requestLabelUpdate(issueNumber, 'processing', null);
    
    this.emit('checkedOut', { issueNumber, processId, taskType });
    
    return metadata;
  }

  /**
   * Issue のチェックイン（処理完了）
   */
  async checkin(issueNumber, status = 'completed', result = {}) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const currentStatus = await this.unifiedStateManager.get('issues', issueNumber.toString());
    if (!currentStatus) {
      throw new Error(`Issue ${issueNumber} is not checked out`);
    }

    const updatedStatus = {
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

    await this.unifiedStateManager.set('issues', issueNumber.toString(), updatedStatus);
    
    // MirinOrphanManager にラベル更新を依頼
    await this.requestLabelUpdate(issueNumber, status, 'processing');
    
    this.emit('checkedIn', { issueNumber, status, result });
    
    return updatedStatus;
  }

  /**
   * ハートビート更新
   */
  async updateHeartbeat(issueNumber) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const currentStatus = await this.unifiedStateManager.get('issues', issueNumber.toString());
    if (!currentStatus || currentStatus.status !== 'processing') {
      return false;
    }

    await this.unifiedStateManager.set('issues', issueNumber.toString(), {
      ...currentStatus,
      lastHeartbeat: new Date().toISOString()
    });
    
    return true;
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
      requestedBy: 'StatusManagerRedis',
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
      case 'completed':
        request.addLabels.push('completed');
        break;
      case 'awaiting-response':
        request.addLabels.push('awaiting-response');
        break;
      case 'error':
        request.addLabels.push('error');
        break;
    }

    // リクエストファイルを作成（互換性のため）
    const requestsDir = path.join(this.configPath, 'requests');
    await fs.mkdir(requestsDir, { recursive: true });
    
    const filename = `label-update-${Date.now()}.json`;
    const filepath = path.join(requestsDir, filename);
    
    await fs.writeFile(filepath, JSON.stringify(request, null, 2));
    
    this.emit('labelUpdateRequested', request);
  }

  /**
   * Issue のステータスを取得
   */
  async getIssueStatus(issueNumber) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    return await this.unifiedStateManager.get('issues', issueNumber.toString());
  }

  /**
   * Issue のステータスを更新
   */
  async updateStatus(issueNumber, status, metadata = {}) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const currentStatus = await this.unifiedStateManager.get('issues', issueNumber.toString()) || {};
    
    const updatedStatus = {
      ...currentStatus,
      status,
      lastUpdated: new Date().toISOString(),
      ...metadata
    };

    await this.unifiedStateManager.set('issues', issueNumber.toString(), updatedStatus);
    
    // ラベル更新を依頼
    await this.requestLabelUpdate(issueNumber, status, currentStatus.status);
    
    this.emit('statusUpdated', { issueNumber, status, metadata });
    
    return updatedStatus;
  }

  /**
   * Issue のステータスをリセット
   */
  async resetIssueStatus(issueNumber) {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const currentStatus = await this.unifiedStateManager.get('issues', issueNumber.toString());
    if (currentStatus) {
      await this.requestLabelUpdate(issueNumber, null, currentStatus.status);
    }
    
    await this.unifiedStateManager.delete('issues', issueNumber.toString());
    
    this.emit('statusReset', { issueNumber });
  }

  /**
   * 現在処理中の Issue 一覧を取得
   */
  async getCurrentlyProcessing() {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const allIssues = await this.unifiedStateManager.getAll('issues');
    const processingIssues = [];
    
    for (const [issueNumber, status] of Object.entries(allIssues)) {
      if (status && status.status === 'processing') {
        processingIssues.push(parseInt(issueNumber));
      }
    }
    
    return processingIssues;
  }

  /**
   * 全ての Issue ステータスを取得
   */
  async getAllIssueStatuses() {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    return await this.unifiedStateManager.getAll('issues');
  }

  /**
   * プロセスの生存確認
   */
  isProcessRunning(pid) {
    try {
      // プロセスの存在確認（シグナル0を送信）
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * 孤児となった Issue を検出
   */
  async detectOrphanedIssues() {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const allIssues = await this.unifiedStateManager.getAll('issues');
    const orphaned = [];
    const now = Date.now();
    
    for (const [issueNumber, status] of Object.entries(allIssues)) {
      if (status && status.status === 'processing') {
        const isOrphaned = 
          // PIDが存在しない、または無効
          (status.pid && !this.isProcessRunning(status.pid)) ||
          // ハートビートが古い（30秒以上）
          (status.lastHeartbeat && (now - new Date(status.lastHeartbeat).getTime()) > this.lockTimeout);
        
        if (isOrphaned) {
          orphaned.push({
            issueNumber: parseInt(issueNumber),
            status
          });
        }
      }
    }
    
    return orphaned;
  }

  /**
   * 統計情報の取得
   */
  async getStatistics() {
    if (!this.isInitialized) {
      throw new Error('StatusManager が初期化されていません');
    }

    const allIssues = await this.unifiedStateManager.getAll('issues');
    const stats = {
      total: 0,
      processing: 0,
      completed: 0,
      error: 0,
      awaitingResponse: 0,
      orphaned: 0
    };

    const orphanedIssues = await this.detectOrphanedIssues();
    stats.orphaned = orphanedIssues.length;

    for (const [issueNumber, status] of Object.entries(allIssues)) {
      if (!status) continue;
      
      stats.total++;
      switch (status.status) {
        case 'processing':
          stats.processing++;
          break;
        case 'completed':
          stats.completed++;
          break;
        case 'error':
          stats.error++;
          break;
        case 'awaiting-response':
          stats.awaitingResponse++;
          break;
      }
    }

    return stats;
  }

  /**
   * クリーンアップ
   */
  async cleanup() {
    this.removeAllListeners();
    if (this.unifiedStateManager) {
      await this.unifiedStateManager.cleanup();
    }
    this.isInitialized = false;
  }
}

module.exports = StatusManagerRedis;