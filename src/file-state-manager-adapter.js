const UnifiedStateManager = require('./unified-state-manager');
const path = require('path');

/**
 * FileStateManagerアダプタ
 * 
 * FileStateManagerのインターフェースを提供しながら、
 * 内部でUnifiedStateManagerを使用する。
 * 既存コードの移行を最小限にするための互換性レイヤー。
 */
class FileStateManagerAdapter {
  constructor(stateDir = path.join(__dirname, '../state')) {
    this.stateDir = stateDir;
    this.unifiedStateManager = new UnifiedStateManager(stateDir);
  }

  /**
   * 初期化
   */
  async init() {
    await this.unifiedStateManager.initialize();
  }

  /**
   * 処理済みIssueの読み込み
   */
  async loadProcessedIssues() {
    const issues = await this.unifiedStateManager.getAll('issues');
    const processedNumbers = Object.keys(issues)
      .filter(num => {
        const status = issues[num].status;
        return status === 'completed' || status === 'awaiting-response';
      })
      .map(num => parseInt(num));
    return new Set(processedNumbers);
  }

  /**
   * 処理済みIssueの保存
   */
  async saveProcessedIssues(processedIssues) {
    // 現在のIssue状態を取得
    const currentIssues = await this.unifiedStateManager.getAll('issues');
    
    // トランザクションで更新
    await this.unifiedStateManager.transaction(async (tx) => {
      // 既存のIssueで処理済みでないものをチェック
      for (const [issueNumber, issue] of Object.entries(currentIssues)) {
        const num = parseInt(issueNumber);
        if (!processedIssues.has(num) && 
            (issue.status === 'completed' || issue.status === 'awaiting-response')) {
          // 処理済みリストから削除されたIssueのステータスをリセット
          await tx.delete('issues', issueNumber);
        }
      }
      
      // 新しく処理済みになったIssueを追加
      for (const issueNumber of processedIssues) {
        const existing = currentIssues[issueNumber.toString()];
        if (!existing || (existing.status !== 'completed' && existing.status !== 'awaiting-response')) {
          await tx.set('issues', issueNumber.toString(), {
            ...existing,
            status: 'completed',
            lastUpdated: new Date().toISOString()
          });
        }
      }
    });
  }

  /**
   * 処理済みIssueの追加
   */
  async addProcessedIssue(issueNumber) {
    const current = await this.unifiedStateManager.get('issues', issueNumber.toString()) || {};
    await this.unifiedStateManager.set('issues', issueNumber.toString(), {
      ...current,
      status: current.status === 'awaiting-response' ? 'awaiting-response' : 'completed',
      lastUpdated: new Date().toISOString()
    });
  }

  /**
   * 処理済みIssueのチェック
   */
  async isIssueProcessed(issueNumber) {
    const issue = await this.unifiedStateManager.get('issues', issueNumber.toString());
    return issue && (issue.status === 'completed' || issue.status === 'awaiting-response');
  }

  /**
   * 処理済みコメントの読み込み
   */
  async loadProcessedComments() {
    const comments = await this.unifiedStateManager.getAll('comments');
    const result = new Map();
    
    // オブジェクトからMapに変換
    for (const [issueNumber, commentIds] of Object.entries(comments)) {
      if (issueNumber !== 'migratedFrom' && Array.isArray(commentIds)) {
        const issueNum = parseInt(issueNumber);
        result.set(issueNum, new Set(commentIds));
      }
    }
    
    return result;
  }

  /**
   * 処理済みコメントの保存
   */
  async saveProcessedComments(processedComments) {
    const data = {};
    
    // MapからオブジェクトにJSONシリアライズ可能な形に変換
    for (const [issueNumber, commentIds] of processedComments.entries()) {
      data[issueNumber] = Array.from(commentIds);
    }
    
    await this.unifiedStateManager.setAll('comments', data);
  }

  /**
   * 処理済みコメントの追加
   */
  async addProcessedComment(issueNumber, commentId) {
    const comments = await this.unifiedStateManager.getAll('comments');
    
    if (!comments[issueNumber]) {
      comments[issueNumber] = [];
    }
    
    if (!comments[issueNumber].includes(commentId)) {
      comments[issueNumber].push(commentId);
    }
    
    await this.unifiedStateManager.set('comments', issueNumber.toString(), comments[issueNumber]);
  }

  /**
   * 処理済みコメントのチェック
   */
  async isCommentProcessed(issueNumber, commentId) {
    const comments = await this.unifiedStateManager.get('comments', issueNumber.toString());
    return comments && comments.includes(commentId);
  }

  /**
   * 特定Issueの処理済みコメントを取得
   */
  async getProcessedCommentsForIssue(issueNumber) {
    const comments = await this.unifiedStateManager.get('comments', issueNumber.toString()) || [];
    return new Set(comments);
  }

  /**
   * 実行中タスクの読み込み
   */
  async loadRunningTasks() {
    const tasks = await this.unifiedStateManager.getAll('tasks');
    const runningTasks = {};
    
    for (const [taskId, task] of Object.entries(tasks)) {
      if (task.status === 'running') {
        runningTasks[taskId] = task;
      }
    }
    
    return runningTasks;
  }

  /**
   * 実行中タスクの保存
   */
  async saveRunningTasks(runningTasks) {
    await this.unifiedStateManager.transaction(async (tx) => {
      // 既存のタスクを確認
      const allTasks = await tx.getAll('tasks');
      
      // running以外の状態のタスクを削除しないように
      for (const [taskId, task] of Object.entries(allTasks)) {
        if (task.status === 'running' && !runningTasks[taskId]) {
          // 実行中だったが、新しいリストにないタスクは完了とする
          await tx.set('tasks', taskId, {
            ...task,
            status: 'completed',
            completed: new Date().toISOString()
          });
        }
      }
      
      // 新しい実行中タスクを設定
      for (const [taskId, task] of Object.entries(runningTasks)) {
        await tx.set('tasks', taskId, {
          ...task,
          status: 'running'
        });
      }
    });
  }

  /**
   * タスクを実行中として記録
   */
  async addRunningTask(taskId, taskInfo) {
    await this.unifiedStateManager.set('tasks', taskId, {
      ...taskInfo,
      status: 'running',
      started: new Date().toISOString()
    });
  }

  /**
   * 実行中タスクを削除
   */
  async removeRunningTask(taskId) {
    const task = await this.unifiedStateManager.get('tasks', taskId);
    if (task) {
      await this.unifiedStateManager.set('tasks', taskId, {
        ...task,
        status: 'completed',
        completed: new Date().toISOString()
      });
    }
  }

  /**
   * 保留中タスクの読み込み
   */
  async loadPendingTasks() {
    const tasks = await this.unifiedStateManager.getAll('tasks');
    const pendingTasks = [];
    
    for (const [taskId, task] of Object.entries(tasks)) {
      if (task.status === 'queued' || task.status === 'pending') {
        pendingTasks.push(task);
      }
    }
    
    return pendingTasks;
  }

  /**
   * 保留中タスクの保存
   */
  async savePendingTasks(pendingTasks) {
    await this.unifiedStateManager.transaction(async (tx) => {
      // 既存のqueued/pendingタスクをクリア
      const allTasks = await tx.getAll('tasks');
      for (const [taskId, task] of Object.entries(allTasks)) {
        if (task.status === 'queued' || task.status === 'pending') {
          await tx.delete('tasks', taskId);
        }
      }
      
      // 新しい保留中タスクを追加
      for (const task of pendingTasks) {
        const taskId = `pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await tx.set('tasks', taskId, {
          ...task,
          status: 'queued'
        });
      }
    });
  }

  /**
   * プロセスロックの取得
   */
  async acquireProcessLock() {
    const lockData = {
      pid: process.pid,
      startTime: new Date().toISOString(),
      hostname: require('os').hostname()
    };
    
    const existingLock = await this.unifiedStateManager.get('processes', 'main-lock');
    
    if (existingLock && this.isProcessRunning(existingLock.pid)) {
      throw new Error(`プロセスは既に実行中です (PID: ${existingLock.pid})`);
    }
    
    await this.unifiedStateManager.set('processes', 'main-lock', lockData);
    return true;
  }

  /**
   * プロセスロックの解放
   */
  async releaseProcessLock() {
    await this.unifiedStateManager.delete('processes', 'main-lock');
  }

  /**
   * プロセスの生存確認
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
   * 状態の整合性チェック
   */
  async checkIntegrity() {
    // UnifiedStateManagerが内部的に整合性を保つため、特別な処理は不要
    return true;
  }

  /**
   * ファイルロック関連のメソッド（互換性のため残す）
   */
  async acquireLock(filePath, timeout = 5000) {
    // UnifiedStateManagerは内部でロック処理を行うため、ここでは何もしない
    return `lock-${Date.now()}`;
  }

  async releaseLock(lockFile) {
    // 互換性のため残すが、実際の処理は不要
  }

  /**
   * アトミック書き込み（互換性のため残す）
   */
  async atomicWrite(filePath, content) {
    // UnifiedStateManagerが内部で処理するため、ここでは何もしない
  }
}

module.exports = FileStateManagerAdapter;