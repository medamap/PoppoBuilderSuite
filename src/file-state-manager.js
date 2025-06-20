const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

/**
 * ファイルベースの状態管理（修正版）
 * PoppoBuilderのcron実行で状態を永続化
 * 
 * 修正内容：
 * - アトミックな書き込み処理
 * - 適切なエラー伝播
 * - データ検証の追加
 * - ファイルロック機構
 * - 自動リカバリー機能
 */
class FileStateManager {
  constructor(stateDir = path.join(__dirname, '../state')) {
    this.stateDir = stateDir;
    this.processedIssuesFile = path.join(stateDir, 'processed-issues.json');
    this.processedCommentsFile = path.join(stateDir, 'processed-comments.json');
    this.runningTasksFile = path.join(stateDir, 'running-tasks.json');
    this.lastRunFile = path.join(stateDir, 'last-run.json');
    this.pendingTasksFile = path.join(stateDir, 'pending-tasks.json');
    this.processLockFile = path.join(stateDir, 'poppo-node.lock');
    this.lockDir = path.join(stateDir, '.locks');
  }

  /**
   * 初期化
   */
  async init() {
    // ディレクトリが存在しない場合は作成
    try {
      await fs.access(this.stateDir);
    } catch {
      try {
        await fs.mkdir(this.stateDir, { recursive: true });
      } catch (error) {
        throw new Error(`状態ディレクトリの作成に失敗: ${error.message}`);
      }
    }

    // ロックディレクトリの作成
    try {
      await fs.mkdir(this.lockDir, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw new Error(`ロックディレクトリの作成に失敗: ${error.message}`);
      }
    }

    // 各ファイルが存在しない場合は初期化
    await this.ensureFile(this.processedIssuesFile, '[]');
    await this.ensureFile(this.processedCommentsFile, '{}');
    await this.ensureFile(this.runningTasksFile, '{}');
    await this.ensureFile(this.lastRunFile, '{}');
    await this.ensureFile(this.pendingTasksFile, '[]');
  }

  /**
   * ファイルの存在確認と初期化
   */
  async ensureFile(filePath, defaultContent) {
    try {
      await fs.access(filePath);
      // ファイルが存在する場合、JSONとして有効か確認
      const content = await fs.readFile(filePath, 'utf8');
      try {
        JSON.parse(content);
      } catch {
        // JSONが不正な場合は修復
        console.warn(`不正なJSONファイルを修復: ${filePath}`);
        await this.atomicWrite(filePath, defaultContent);
      }
    } catch {
      await this.atomicWrite(filePath, defaultContent);
    }
  }

  /**
   * ファイルロックの取得
   */
  async acquireLock(filePath, timeout = 5000) {
    const lockFile = path.join(this.lockDir, `${path.basename(filePath)}.lock`);
    const startTime = Date.now();
    
    while (true) {
      try {
        // O_EXCL フラグでアトミックにファイル作成
        const fd = await fs.open(lockFile, 'wx');
        await fd.write(Buffer.from(String(process.pid)));
        await fd.close();
        return lockFile;
      } catch (error) {
        if (error.code === 'EEXIST') {
          // ロックが既に存在する場合
          if (Date.now() - startTime > timeout) {
            // タイムアウト - 古いロックを強制削除
            try {
              const pid = await fs.readFile(lockFile, 'utf8');
              console.warn(`古いロックを強制削除 (PID: ${pid})`);
              await fs.unlink(lockFile);
            } catch {}
            throw new Error(`ロック取得タイムアウト: ${filePath}`);
          }
          // 少し待ってリトライ
          await new Promise(resolve => setTimeout(resolve, 100));
        } else {
          throw error;
        }
      }
    }
  }

  /**
   * ファイルロックの解放
   */
  async releaseLock(lockFile) {
    try {
      await fs.unlink(lockFile);
    } catch (error) {
      console.warn(`ロック解放エラー: ${error.message}`);
    }
  }

  /**
   * アトミックな書き込み
   */
  async atomicWrite(filePath, content) {
    const tempFile = `${filePath}.tmp.${process.pid}.${Date.now()}`;
    const backupFile = `${filePath}.backup`;
    
    try {
      // 一時ファイルに書き込み
      await fs.writeFile(tempFile, content, 'utf8');
      
      // 既存ファイルのバックアップ
      try {
        // ソケットファイルやその他特殊ファイルをコピーしようとすると ENOTSUP エラー
        // 通常のファイルのみバックアップを作成
        const stats = await fs.stat(filePath);
        if (stats.isFile()) {
          await fs.copyFile(filePath, backupFile);
        }
      } catch (error) {
        // 初回作成時やアクセスエラー時はバックアップ不要
        if (error.code !== 'ENOENT' && error.code !== 'ENOTSUP') {
          console.warn(`バックアップ作成をスキップ: ${error.code} - ${filePath}`);
        }
      }
      
      // アトミックに置換
      await fs.rename(tempFile, filePath);
    } catch (error) {
      // エラー時は一時ファイルを削除
      try {
        await fs.unlink(tempFile);
      } catch {}
      throw error;
    }
  }

  /**
   * 処理済みIssueの読み込み
   */
  async loadProcessedIssues() {
    const lockFile = await this.acquireLock(this.processedIssuesFile);
    try {
      const data = await fs.readFile(this.processedIssuesFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // データ検証
      if (!Array.isArray(parsed)) {
        throw new Error('処理済みIssueデータが配列ではありません');
      }
      
      // 数値のみを含む配列であることを確認
      const validated = parsed.filter(item => typeof item === 'number');
      if (validated.length !== parsed.length) {
        console.warn('不正な処理済みIssueデータを除外しました');
      }
      
      return new Set(validated);
    } catch (error) {
      console.error('処理済みIssue読み込みエラー:', error);
      return new Set();
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 処理済みIssueの保存
   */
  async saveProcessedIssues(processedIssues) {
    const lockFile = await this.acquireLock(this.processedIssuesFile);
    try {
      const data = Array.from(processedIssues);
      await this.atomicWrite(this.processedIssuesFile, JSON.stringify(data, null, 2));
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 処理済みIssueの追加
   */
  async addProcessedIssue(issueNumber) {
    const processedIssues = await this.loadProcessedIssues();
    processedIssues.add(issueNumber);
    await this.saveProcessedIssues(processedIssues);
  }

  /**
   * 処理済みIssueのチェック
   */
  async isIssueProcessed(issueNumber) {
    const processedIssues = await this.loadProcessedIssues();
    return processedIssues.has(issueNumber);
  }

  /**
   * 処理済みコメントの読み込み
   */
  async loadProcessedComments() {
    const lockFile = await this.acquireLock(this.processedCommentsFile);
    try {
      const data = await fs.readFile(this.processedCommentsFile, 'utf8');
      const parsed = JSON.parse(data);
      const result = new Map();
      
      // オブジェクトからMapに変換（データ検証付き）
      for (const [issueNumber, commentIds] of Object.entries(parsed)) {
        const issueNum = parseInt(issueNumber);
        if (!isNaN(issueNum) && Array.isArray(commentIds)) {
          // 文字列のコメントIDのみを受け入れる
          const validCommentIds = commentIds.filter(id => typeof id === 'string');
          result.set(issueNum, new Set(validCommentIds));
        }
      }
      
      return result;
    } catch (error) {
      console.error('処理済みコメント読み込みエラー:', error);
      return new Map();
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 処理済みコメントの保存
   */
  async saveProcessedComments(processedComments) {
    const lockFile = await this.acquireLock(this.processedCommentsFile);
    try {
      const data = {};
      
      // MapからオブジェクトにJSONシリアライズ可能な形に変換
      for (const [issueNumber, commentIds] of processedComments.entries()) {
        data[issueNumber] = Array.from(commentIds);
      }
      
      await this.atomicWrite(this.processedCommentsFile, JSON.stringify(data, null, 2));
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 処理済みコメントの追加
   */
  async addProcessedComment(issueNumber, commentId) {
    const processedComments = await this.loadProcessedComments();
    
    if (!processedComments.has(issueNumber)) {
      processedComments.set(issueNumber, new Set());
    }
    
    processedComments.get(issueNumber).add(commentId);
    await this.saveProcessedComments(processedComments);
  }

  /**
   * 処理済みコメントのチェック
   */
  async isCommentProcessed(issueNumber, commentId) {
    const processedComments = await this.loadProcessedComments();
    
    if (!processedComments.has(issueNumber)) {
      return false;
    }
    
    return processedComments.get(issueNumber).has(commentId);
  }

  /**
   * 特定Issueの処理済みコメントを取得
   */
  async getProcessedCommentsForIssue(issueNumber) {
    const processedComments = await this.loadProcessedComments();
    return processedComments.get(issueNumber) || new Set();
  }

  /**
   * 実行中タスクの読み込み
   */
  async loadRunningTasks() {
    const lockFile = await this.acquireLock(this.runningTasksFile);
    try {
      const data = await fs.readFile(this.runningTasksFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // オブジェクトであることを確認
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('実行中タスクデータがオブジェクトではありません');
      }
      
      return parsed;
    } catch (error) {
      console.error('実行中タスク読み込みエラー:', error);
      return {};
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 実行中タスクの保存
   */
  async saveRunningTasks(runningTasks) {
    const lockFile = await this.acquireLock(this.runningTasksFile);
    try {
      await this.atomicWrite(this.runningTasksFile, JSON.stringify(runningTasks, null, 2));
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * タスクを実行中として記録（アトミック操作）
   */
  async addRunningTask(taskId, taskInfo) {
    const lockFile = await this.acquireLock(this.runningTasksFile);
    try {
      const runningTasks = await this.loadRunningTasksNoLock();
      runningTasks[taskId] = {
        ...taskInfo,
        startTime: new Date().toISOString()
      };
      await this.atomicWrite(this.runningTasksFile, JSON.stringify(runningTasks, null, 2));
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * タスクを完了として削除（アトミック操作）
   */
  async removeRunningTask(taskId) {
    const lockFile = await this.acquireLock(this.runningTasksFile);
    try {
      const runningTasks = await this.loadRunningTasksNoLock();
      delete runningTasks[taskId];
      await this.atomicWrite(this.runningTasksFile, JSON.stringify(runningTasks, null, 2));
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * ロックなしで実行中タスクを読み込み（内部使用）
   */
  async loadRunningTasksNoLock() {
    try {
      const data = await fs.readFile(this.runningTasksFile, 'utf8');
      return JSON.parse(data);
    } catch {
      return {};
    }
  }

  /**
   * 古い実行中タスクをクリーンアップ
   */
  async cleanupStaleRunningTasks(maxAgeMs = 24 * 60 * 60 * 1000) {
    const lockFile = await this.acquireLock(this.runningTasksFile);
    try {
      const runningTasks = await this.loadRunningTasksNoLock();
      const now = Date.now();
      let hasChanges = false;

      for (const [taskId, taskInfo] of Object.entries(runningTasks)) {
        if (!taskInfo.startTime) {
          // startTimeがない場合は削除
          delete runningTasks[taskId];
          hasChanges = true;
          console.log(`不正なタスクをクリーンアップ: ${taskId}`);
          continue;
        }
        
        const startTime = new Date(taskInfo.startTime).getTime();
        if (isNaN(startTime) || now - startTime > maxAgeMs) {
          delete runningTasks[taskId];
          hasChanges = true;
          console.log(`古いタスクをクリーンアップ: ${taskId}`);
        }
      }

      if (hasChanges) {
        await this.atomicWrite(this.runningTasksFile, JSON.stringify(runningTasks, null, 2));
      }
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 最終実行情報の読み込み
   */
  async loadLastRun() {
    const lockFile = await this.acquireLock(this.lastRunFile);
    try {
      const data = await fs.readFile(this.lastRunFile, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('最終実行情報読み込みエラー:', error);
      return {};
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 最終実行情報の保存
   */
  async saveLastRun(info) {
    const lockFile = await this.acquireLock(this.lastRunFile);
    try {
      const data = {
        ...info,
        timestamp: new Date().toISOString()
      };
      await this.atomicWrite(this.lastRunFile, JSON.stringify(data, null, 2));
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * プロセスレベルのロック取得
   * 他のcronプロセスとの二重起動を防止
   */
  async acquireProcessLock() {
    try {
      // プロセス情報を含むロックファイルを作成
      const lockData = {
        pid: process.pid,
        startTime: new Date().toISOString(),
        hostname: require('os').hostname()
      };
      
      // ロックファイルが既に存在するかチェック
      try {
        const existingLock = await fs.readFile(this.processLockFile, 'utf8');
        const lockInfo = JSON.parse(existingLock);
        
        // プロセスが実行中かチェック
        if (this.isProcessRunning(lockInfo.pid)) {
          console.log(`別のPoppoBuilderプロセスが既に実行中です (PID: ${lockInfo.pid})`);
          return false;
        } else {
          console.log(`古いプロセスロックを削除します (PID: ${lockInfo.pid})`);
        }
      } catch (error) {
        // ロックファイルが存在しない、または不正な場合は続行
      }
      
      // 新しいロックファイルを作成
      await this.atomicWrite(this.processLockFile, JSON.stringify(lockData, null, 2));
      return true;
    } catch (error) {
      console.error('プロセスロック取得エラー:', error);
      return false;
    }
  }

  /**
   * プロセスレベルのロック解放
   */
  async releaseProcessLock() {
    try {
      await fs.unlink(this.processLockFile);
    } catch (error) {
      console.warn(`プロセスロック解放エラー: ${error.message}`);
    }
  }

  /**
   * プロセスが実行中かチェック
   */
  isProcessRunning(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * 保留中のタスクを保存
   */
  async savePendingTasks(tasks) {
    const lockFile = await this.acquireLock(this.pendingTasksFile);
    try {
      await this.atomicWrite(this.pendingTasksFile, JSON.stringify(tasks, null, 2));
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * 保留中のタスクを読み込み
   */
  async loadPendingTasks() {
    const lockFile = await this.acquireLock(this.pendingTasksFile);
    try {
      const data = await fs.readFile(this.pendingTasksFile, 'utf8');
      const parsed = JSON.parse(data);
      
      // 配列であることを確認
      if (!Array.isArray(parsed)) {
        throw new Error('保留中タスクデータが配列ではありません');
      }
      
      return parsed;
    } catch (error) {
      console.error('保留中タスク読み込みエラー:', error);
      return [];
    } finally {
      await this.releaseLock(lockFile);
    }
  }

  /**
   * すべての状態をリセット（テスト用）
   */
  async reset() {
    await this.saveProcessedIssues(new Set());
    await this.saveProcessedComments(new Map());
    await this.saveRunningTasks({});
    await this.saveLastRun({});
    await this.savePendingTasks([]);
  }

  /**
   * 状態の整合性チェック
   */
  async checkIntegrity() {
    const errors = [];

    try {
      // 各ファイルが正しくパースできるかチェック
      const processedIssues = await this.loadProcessedIssues();
      if (!(processedIssues instanceof Set)) {
        errors.push('処理済みIssueがSetではありません');
      }

      const processedComments = await this.loadProcessedComments();
      if (!(processedComments instanceof Map)) {
        errors.push('処理済みコメントがMapではありません');
      }

      const runningTasks = await this.loadRunningTasks();
      if (typeof runningTasks !== 'object') {
        errors.push('実行中タスクがオブジェクトではありません');
      }

      const lastRun = await this.loadLastRun();
      if (typeof lastRun !== 'object') {
        errors.push('最終実行情報がオブジェクトではありません');
      }
    } catch (error) {
      errors.push(`状態ファイルの整合性エラー: ${error.message}`);
    }

    // ロックファイルのクリーンアップ
    try {
      const lockFiles = await fs.readdir(this.lockDir);
      for (const lockFile of lockFiles) {
        const lockPath = path.join(this.lockDir, lockFile);
        const stat = await fs.stat(lockPath);
        // 5分以上古いロックファイルは削除
        if (Date.now() - stat.mtimeMs > 5 * 60 * 1000) {
          await fs.unlink(lockPath);
          console.warn(`古いロックファイルを削除: ${lockFile}`);
        }
      }
    } catch (error) {
      errors.push(`ロックファイルのクリーンアップエラー: ${error.message}`);
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = FileStateManager;