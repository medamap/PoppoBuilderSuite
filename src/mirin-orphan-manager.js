/**
 * MirinOrphanManager - 孤児 Issue の検出・管理とラベル操作の一元化
 * すべてのラベル操作はこのコンポーネントを通じて行われる
 */
const fs = require('fs').promises;
const path = require('path');
const EventEmitter = require('events');

class MirinOrphanManager extends EventEmitter {
  constructor(githubClient, statusManager, config = {}, logger = console) {
    super();
    this.githubClient = githubClient;
    this.statusManager = statusManager;
    this.logger = logger;
    this.config = {
      checkInterval: 30 * 60 * 1000, // 30分（毎時3分・33分に実行）
      heartbeatTimeout: 5 * 60 * 1000, // 5分
      requestsDir: 'state/requests',
      requestCheckInterval: 5000, // 5秒
      ...config
    };
    this.isRunning = false;
    this.checkTimer = null;
    this.requestTimer = null;
  }

  /**
   * 初期化処理
   */
  async initialize() {
    try {
      // リクエストディレクトリの作成
      await fs.mkdir(this.config.requestsDir, { recursive: true });
      
      // StatusManager の初期化
      if (this.statusManager && !this.statusManager.isInitialized) {
        await this.statusManager.initialize();
      }
      
      this.logger.info('MirinOrphanManager: 初期化完了');
      this.emit('initialized');
    } catch (error) {
      this.logger.error('MirinOrphanManager 初期化エラー:', error);
      throw error;
    }
  }

  /**
   * 監視を開始
   */
  start() {
    if (this.isRunning) {
      this.logger.warn('MirinOrphanManager: 既に実行中です');
      return;
    }

    this.isRunning = true;
    
    // 初回チェック
    this.checkOrphanedIssues().catch(error => {
      this.logger.error('孤児チェックエラー:', error);
    });
    
    // 定期チェックを開始
    this.checkTimer = setInterval(() => {
      this.checkOrphanedIssues().catch(error => {
        this.logger.error('孤児チェックエラー:', error);
      });
    }, this.config.checkInterval);

    // ラベル更新リクエストの処理を開始
    this.startRequestProcessor();

    this.logger.info('MirinOrphanManager: 監視を開始しました');
    this.emit('started');
  }

  /**
   * 監視を停止
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    
    if (this.requestTimer) {
      clearInterval(this.requestTimer);
      this.requestTimer = null;
    }

    this.logger.info('MirinOrphanManager: 監視を停止しました');
    this.emit('stopped');
  }

  /**
   * 孤児 Issue のチェック
   */
  async checkOrphanedIssues() {
    try {
      this.logger.info('MirinOrphanManager: 孤児 Issue のチェックを開始');
      
      // StatusManager から孤児を検出
      const orphanedFromStatus = await this.statusManager.detectOrphanedIssues(
        this.config.heartbeatTimeout
      );
      
      // GitHub ラベルとの同期チェック
      const orphanedFromLabels = await this.detectOrphanedFromLabels();
      
      // 孤児を統合（重複を除く）
      const allOrphaned = this.mergeOrphaned(orphanedFromStatus, orphanedFromLabels);
      
      if (allOrphaned.length === 0) {
        this.logger.info('MirinOrphanManager: 孤児 Issue は見つかりませんでした');
        return;
      }
      
      this.logger.info(`MirinOrphanManager: ${allOrphaned.length} 件の孤児 Issue を検出`);
      
      // 各孤児を処理
      for (const orphan of allOrphaned) {
        await this.handleOrphanedIssue(orphan);
      }
      
      this.emit('checkCompleted', { orphanedCount: allOrphaned.length });
    } catch (error) {
      this.logger.error('孤児チェック中のエラー:', error);
      this.emit('error', error);
    }
  }

  /**
   * GitHub ラベルから孤児を検出
   */
  async detectOrphanedFromLabels() {
    const orphaned = [];
    
    try {
      // processing ラベルが付いた Issue を取得
      const issues = await this.githubClient.listIssuesWithLabel('processing');
      
      for (const issue of issues) {
        const issueNumber = issue.number.toString();
        const status = await this.statusManager.getStatus(issueNumber);
        
        // StatusManager に状態がない、または processing でない場合は孤児
        if (!status || status.status !== 'processing') {
          orphaned.push({
            issueNumber,
            title: issue.title,
            labels: issue.labels.map(l => l.name),
            source: 'github-labels'
          });
        }
      }
    } catch (error) {
      this.logger.error('GitHub ラベルからの孤児検出エラー:', error);
    }
    
    return orphaned;
  }

  /**
   * 孤児リストをマージ（重複を除く）
   */
  mergeOrphaned(fromStatus, fromLabels) {
    const merged = [...fromStatus];
    const existingNumbers = new Set(fromStatus.map(o => o.issueNumber));
    
    for (const orphan of fromLabels) {
      if (!existingNumbers.has(orphan.issueNumber)) {
        merged.push(orphan);
      }
    }
    
    return merged;
  }

  /**
   * 孤児 Issue の処理
   */
  async handleOrphanedIssue(orphan) {
    try {
      this.logger.info(`MirinOrphanManager: Issue #${orphan.issueNumber} を孤児として処理`);
      
      // StatusManager の状態をリセット
      await this.statusManager.resetIssueStatus(orphan.issueNumber);
      
      // processing ラベルを削除
      await this.updateLabels({
        issueNumber: orphan.issueNumber,
        removeLabels: ['processing'],
        addLabels: [],
        requestedBy: 'MirinOrphanManager',
        reason: 'orphan-cleanup'
      });
      
      // GitHub に通知コメントを投稿
      await this.postOrphanNotification(orphan);
      
      this.emit('orphanHandled', orphan);
    } catch (error) {
      this.logger.error(`Issue #${orphan.issueNumber} の孤児処理エラー:`, error);
    }
  }

  /**
   * 孤児通知をGitHubに投稿
   */
  async postOrphanNotification(orphan) {
    try {
      const comment = [
        '🎋 **MirinOrphanManager より通知**',
        '',
        'この Issue は孤児として検出されました。',
        '',
        '**詳細:**',
        `- 検出元: ${orphan.source === 'github-labels' ? 'GitHub ラベル' : 'StatusManager'}`,
        orphan.processId ? `- プロセス ID: ${orphan.processId}` : '',
        orphan.startTime ? `- 開始時刻: ${new Date(orphan.startTime).toLocaleString('ja-JP')}` : '',
        orphan.lastHeartbeat ? `- 最終ハートビート: ${new Date(orphan.lastHeartbeat).toLocaleString('ja-JP')}` : '',
        '',
        '`processing` ラベルを削除し、Issue を再処理可能な状態に戻しました。'
      ].filter(line => line !== '').join('\n');
      
      await this.githubClient.createComment(orphan.issueNumber, comment);
    } catch (error) {
      this.logger.error(`Issue #${orphan.issueNumber} への通知投稿エラー:`, error);
    }
  }

  /**
   * ラベル更新リクエストの処理を開始
   */
  startRequestProcessor() {
    // 初回チェック
    this.processLabelRequests().catch(error => {
      this.logger.error('ラベル更新リクエスト処理エラー:', error);
    });
    
    // 定期チェック
    this.requestTimer = setInterval(() => {
      this.processLabelRequests().catch(error => {
        this.logger.error('ラベル更新リクエスト処理エラー:', error);
      });
    }, this.config.requestCheckInterval);
  }

  /**
   * ラベル更新リクエストを処理
   */
  async processLabelRequests() {
    try {
      const files = await fs.readdir(this.config.requestsDir);
      const requestFiles = files.filter(f => f.startsWith('label-update-') && f.endsWith('.json'));
      
      for (const file of requestFiles) {
        await this.processRequest(file);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  /**
   * 個別のリクエストを処理
   */
  async processRequest(filename) {
    const filepath = path.join(this.config.requestsDir, filename);
    
    try {
      // リクエストを読み込む
      const content = await fs.readFile(filepath, 'utf8');
      const request = JSON.parse(content);
      
      // ラベルを更新
      await this.updateLabels(request);
      
      // 処理済みリクエストを削除
      await fs.unlink(filepath);
      
      this.logger.info(`ラベル更新リクエスト処理完了: ${request.requestId}`);
    } catch (error) {
      this.logger.error(`リクエスト処理エラー (${filename}):`, error);
      
      // エラーが続く場合は古いリクエストを削除
      try {
        const stats = await fs.stat(filepath);
        const age = Date.now() - stats.mtime.getTime();
        if (age > 60 * 60 * 1000) { // 1時間以上古い
          await fs.unlink(filepath);
          this.logger.warn(`古いリクエストを削除: ${filename}`);
        }
      } catch (unlinkError) {
        // 無視
      }
    }
  }

  /**
   * ラベル更新API
   */
  async updateLabels(request) {
    const { issueNumber, addLabels = [], removeLabels = [] } = request;
    
    try {
      // 現在のラベルを取得
      const issue = await this.githubClient.getIssue(issueNumber);
      const currentLabels = issue.labels.map(l => l.name);
      
      // 新しいラベルセットを計算
      const newLabels = new Set(currentLabels);
      
      // ラベルを削除
      for (const label of removeLabels) {
        newLabels.delete(label);
      }
      
      // ラベルを追加
      for (const label of addLabels) {
        newLabels.add(label);
      }
      
      // 変更がない場合はスキップ
      const newLabelsArray = Array.from(newLabels);
      if (this.arraysEqual(currentLabels.sort(), newLabelsArray.sort())) {
        this.logger.info(`Issue #${issueNumber}: ラベル変更なし`);
        return;
      }
      
      // GitHub API でラベルを更新
      await this.githubClient.updateLabels(issueNumber, newLabelsArray);
      
      this.logger.info(`Issue #${issueNumber}: ラベル更新完了`, {
        added: addLabels,
        removed: removeLabels,
        requestedBy: request.requestedBy
      });
      
      this.emit('labelsUpdated', {
        issueNumber,
        addLabels,
        removeLabels,
        newLabels: newLabelsArray
      });
    } catch (error) {
      this.logger.error(`Issue #${issueNumber} のラベル更新エラー:`, error);
      throw error;
    }
  }

  /**
   * 状態同期機能 - StatusManager の JSON と GitHub ラベルを同期
   */
  async syncWithStatusManager() {
    try {
      this.logger.info('MirinOrphanManager: 状態同期を開始');
      
      const statuses = await this.statusManager.getAllStatuses();
      let syncCount = 0;
      
      for (const [issueNumber, status] of Object.entries(statuses)) {
        try {
          const issue = await this.githubClient.getIssue(issueNumber);
          const currentLabels = issue.labels.map(l => l.name);
          const hasProcessingLabel = currentLabels.includes('processing');
          
          // 状態とラベルの不整合をチェック
          if (status.status === 'processing' && !hasProcessingLabel) {
            // processing 状態なのにラベルがない
            await this.updateLabels({
              issueNumber,
              addLabels: ['processing'],
              removeLabels: [],
              requestedBy: 'MirinOrphanManager',
              reason: 'sync-add-missing'
            });
            syncCount++;
          } else if (status.status !== 'processing' && hasProcessingLabel) {
            // processing 状態でないのにラベルがある
            await this.updateLabels({
              issueNumber,
              removeLabels: ['processing'],
              addLabels: [],
              requestedBy: 'MirinOrphanManager',
              reason: 'sync-remove-extra'
            });
            syncCount++;
          }
        } catch (error) {
          this.logger.error(`Issue #${issueNumber} の同期エラー:`, error);
        }
      }
      
      this.logger.info(`MirinOrphanManager: 状態同期完了 (${syncCount} 件更新)`);
      this.emit('syncCompleted', { syncCount });
    } catch (error) {
      this.logger.error('状態同期エラー:', error);
      this.emit('error', error);
    }
  }

  /**
   * 配列が等しいかチェック
   */
  arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  /**
   * 統計情報を取得
   */
  async getStatistics() {
    const stats = {
      isRunning: this.isRunning,
      lastCheck: null,
      orphanedCount: 0,
      syncedCount: 0,
      pendingRequests: 0
    };
    
    try {
      // 保留中のリクエスト数を取得
      const files = await fs.readdir(this.config.requestsDir);
      stats.pendingRequests = files.filter(f => 
        f.startsWith('label-update-') && f.endsWith('.json')
      ).length;
    } catch (error) {
      // 無視
    }
    
    return stats;
  }

  /**
   * クリーンアップ
   */
  cleanup() {
    this.stop();
    this.removeAllListeners();
  }
}

module.exports = MirinOrphanManager;