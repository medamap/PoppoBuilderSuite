const fs = require('fs').promises;
const path = require('path');
const os = require('os');

class IssueLockManager {
  constructor(lockDir = '.poppo/locks', logger = console) {
    this.lockDir = lockDir;
    this.logger = logger;
    this.locks = new Map(); // メモリキャッシュ
    this.defaultTTL = 3600000; // 1時間
    this.cleanupInterval = 300000; // 5分ごとにクリーンアップ
    this.cleanupTimer = null;
  }

  async initialize() {
    try {
      await fs.mkdir(this.lockDir, { recursive: true });
      await this.loadExistingLocks();
      this.startCleanupTimer();
      this.logger.info('IssueLockManager initialized');
    } catch (error) {
      this.logger.error('Failed to initialize IssueLockManager:', error);
      throw error;
    }
  }

  async acquireLock(issueNumber, lockInfo = {}) {
    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      // 既存のロックをチェック
      const existingLock = await this.checkLock(issueNumber);
      if (existingLock && this.isLockValid(existingLock)) {
        this.logger.warn(`Issue #${issueNumber} is already locked by PID ${existingLock.lockedBy.pid}`);
        return false;
      }

      // 新しいロックデータ
      const lockData = {
        issueNumber,
        lockedAt: new Date().toISOString(),
        lockedBy: {
          pid: lockInfo.pid || process.pid,
          sessionId: lockInfo.sessionId || process.env.CLAUDE_SESSION_ID || `session_${Date.now()}`,
          taskId: lockInfo.taskId || `issue-${issueNumber}`,
          hostname: os.hostname()
        },
        type: lockInfo.type || 'issue_processing',
        ttl: lockInfo.ttl || this.defaultTTL,
        expiresAt: new Date(Date.now() + (lockInfo.ttl || this.defaultTTL)).toISOString()
      };

      // ロックファイルの作成（アトミック操作）
      await fs.writeFile(lockFile, JSON.stringify(lockData, null, 2), { flag: 'wx' });
      
      // メモリキャッシュに保存
      this.locks.set(issueNumber, lockData);
      
      this.logger.info(`Lock acquired for Issue #${issueNumber} by PID ${lockData.lockedBy.pid}`);
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') {
        // ロックファイルが既に存在する
        this.logger.warn(`Lock file already exists for Issue #${issueNumber}`);
        return false;
      }
      this.logger.error(`Failed to acquire lock for Issue #${issueNumber}:`, error);
      throw error;
    }
  }

  async releaseLock(issueNumber, pid = process.pid) {
    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      const lockData = await this.checkLock(issueNumber);
      
      if (!lockData) {
        this.logger.warn(`No lock found for Issue #${issueNumber}`);
        return false;
      }

      // PIDチェック（自分のロックか確認）
      if (lockData.lockedBy.pid !== pid) {
        this.logger.warn(`Cannot release lock for Issue #${issueNumber}: locked by different PID ${lockData.lockedBy.pid}`);
        return false;
      }

      // ロックファイルの削除
      await fs.unlink(lockFile);
      
      // メモリキャッシュから削除
      this.locks.delete(issueNumber);
      
      this.logger.info(`Lock released for Issue #${issueNumber} by PID ${pid}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // ファイルが存在しない
        this.locks.delete(issueNumber);
        return true;
      }
      this.logger.error(`Failed to release lock for Issue #${issueNumber}:`, error);
      throw error;
    }
  }

  async checkLock(issueNumber) {
    // メモリキャッシュを先にチェック
    const cached = this.locks.get(issueNumber);
    if (cached && this.isLockValid(cached)) {
      return cached;
    }

    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      const data = await fs.readFile(lockFile, 'utf8');
      const lockData = JSON.parse(data);
      
      // メモリキャッシュを更新
      this.locks.set(issueNumber, lockData);
      
      return lockData;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // ファイルが存在しない
        this.locks.delete(issueNumber);
        return null;
      }
      if (error instanceof SyntaxError) {
        // 破損したロックファイル（通常運用で発生しうるので警告レベル）
        this.logger.warn(`Corrupted lock file for Issue #${issueNumber}, removing...`);
        await this.forceReleaseLock(issueNumber);
        return null;
      }
      throw error;
    }
  }

  isLockValid(lockData) {
    if (!lockData || !lockData.expiresAt) {
      return false;
    }

    // TTLチェック
    if (new Date(lockData.expiresAt) < new Date()) {
      return false;
    }

    // プロセス生存確認（同一ホストの場合のみ）
    if (lockData.lockedBy.hostname === os.hostname()) {
      try {
        // プロセスにシグナル0を送信して存在確認
        process.kill(lockData.lockedBy.pid, 0);
        return true;
      } catch (error) {
        // プロセスが存在しない
        return false;
      }
    }

    // 他のホストのロックは有効期限のみで判断
    return true;
  }

  async forceReleaseLock(issueNumber) {
    const lockFile = this.getLockFilePath(issueNumber);
    
    try {
      await fs.unlink(lockFile);
      this.locks.delete(issueNumber);
      this.logger.debug(`Force released lock for Issue #${issueNumber}`);
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        this.locks.delete(issueNumber);
        return true;
      }
      throw error;
    }
  }

  async cleanup() {
    const lockFiles = await fs.readdir(this.lockDir);
    let cleaned = 0;

    for (const file of lockFiles) {
      if (!file.endsWith('.lock')) continue;

      const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
      if (isNaN(issueNumber)) continue;

      try {
        const lockData = await this.checkLock(issueNumber);
        if (lockData && !this.isLockValid(lockData)) {
          await this.forceReleaseLock(issueNumber);
          cleaned++;
        }
      } catch (error) {
        this.logger.error(`Error during cleanup of Issue #${issueNumber}:`, error);
      }
    }

    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} expired locks`);
    }
  }

  async loadExistingLocks() {
    try {
      const files = await fs.readdir(this.lockDir);
      for (const file of files) {
        if (file.endsWith('.lock')) {
          const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
          if (!isNaN(issueNumber)) {
            await this.checkLock(issueNumber);
          }
        }
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.logger.error('Error loading existing locks:', error);
      }
    }
  }

  startCleanupTimer() {
    this.cleanupTimer = setInterval(() => {
      this.cleanup().catch(error => {
        this.logger.error('Error during periodic cleanup:', error);
      });
    }, this.cleanupInterval);
  }

  stopCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  getLockFilePath(issueNumber) {
    return path.join(this.lockDir, `issue-${issueNumber}.lock`);
  }

  async releaseAllLocks(pid = process.pid) {
    const lockFiles = await fs.readdir(this.lockDir);
    let released = 0;

    for (const file of lockFiles) {
      if (!file.endsWith('.lock')) continue;

      const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
      if (isNaN(issueNumber)) continue;

      try {
        const lockData = await this.checkLock(issueNumber);
        if (lockData && lockData.lockedBy.pid === pid) {
          await this.releaseLock(issueNumber, pid);
          released++;
        }
      } catch (error) {
        this.logger.error(`Error releasing lock for Issue #${issueNumber}:`, error);
      }
    }

    this.logger.info(`Released ${released} locks for PID ${pid}`);
    return released;
  }

  async getActiveLocks() {
    await this.cleanup(); // 期限切れのロックをクリーンアップ

    const locks = [];
    const lockFiles = await fs.readdir(this.lockDir);

    for (const file of lockFiles) {
      if (!file.endsWith('.lock')) continue;

      const issueNumber = parseInt(file.replace('issue-', '').replace('.lock', ''));
      if (isNaN(issueNumber)) continue;

      const lockData = await this.checkLock(issueNumber);
      if (lockData && this.isLockValid(lockData)) {
        locks.push(lockData);
      }
    }

    return locks;
  }

  async shutdown() {
    this.stopCleanupTimer();
    await this.releaseAllLocks();
    this.logger.info('IssueLockManager shut down');
  }
}

module.exports = IssueLockManager;