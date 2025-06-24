/**
 * クリーンアップマネージャー
 * エラー時やプロセス終了時のリソースクリーンアップを管理
 */
const fs = require('fs').promises;
const path = require('path');

class CleanupManager {
  constructor(options = {}) {
    this.logger = options.logger || console;
    this.isShuttingDown = false;
    
    // シグナルハンドラーの登録
    this.setupSignalHandlers();
  }


  /**
   * タスク固有のクリーンアップ
   */
  async cleanupTask(taskId, resources = {}) {
    const cleanupActions = [];

    // ロックの解放
    if (resources.lockManager && resources.issueNumber) {
      cleanupActions.push(async () => {
        try {
          await resources.lockManager.releaseLock(
            resources.issueNumber,
            resources.pid || process.pid
          );
          this.logger.info(`Lock released for Issue #${resources.issueNumber}`);
        } catch (error) {
          this.logger.warn(`Failed to release lock for Issue #${resources.issueNumber}: ${error.message}`);
        }
      });
    }

    // タスクキューからの削除
    if (resources.taskQueue && taskId) {
      cleanupActions.push(async () => {
        try {
          await resources.taskQueue.completeTask(taskId, false);
          this.logger.info(`Task ${taskId} marked as failed in queue`);
        } catch (error) {
          this.logger.warn(`Failed to update task queue for ${taskId}: ${error.message}`);
        }
      });
    }

    // StatusManagerのチェックイン
    if (resources.statusManager && resources.issueNumber) {
      cleanupActions.push(async () => {
        try {
          await resources.statusManager.checkin(resources.issueNumber, 'error', {
            error: resources.error || 'Unknown error'
          });
          this.logger.info(`Status updated for Issue #${resources.issueNumber}`);
        } catch (error) {
          this.logger.warn(`Failed to update status for Issue #${resources.issueNumber}: ${error.message}`);
        }
      });
    }

    // 一時ファイルの削除
    if (resources.tempFiles && Array.isArray(resources.tempFiles)) {
      cleanupActions.push(async () => {
        for (const file of resources.tempFiles) {
          try {
            await fs.unlink(file);
            this.logger.info(`Temp file deleted: ${file}`);
          } catch (error) {
            if (error.code !== 'ENOENT') {
              this.logger.warn(`Failed to delete temp file ${file}: ${error.message}`);
            }
          }
        }
      });
    }

    // すべてのクリーンアップアクションを実行
    const results = await Promise.allSettled(
      cleanupActions.map(action => action())
    );

    const failedCount = results.filter(r => r.status === 'rejected').length;
    if (failedCount > 0) {
      this.logger.warn(`${failedCount} cleanup actions failed for task ${taskId}`);
    }

    return {
      total: cleanupActions.length,
      failed: failedCount
    };
  }

  /**
   * 緊急クリーンアップ（プロセス終了時）
   */
  async emergencyCleanup() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.logger.info('緊急クリーンアップを開始します...');

    try {
      // 現在は特定のクリーンアップタスクは登録されていない
      // 将来的に必要に応じて追加
      this.logger.info('緊急クリーンアップ完了');
    } catch (error) {
      this.logger.error('緊急クリーンアップ中にエラー:', error);
    }
  }

  /**
   * シグナルハンドラーのセットアップ
   */
  setupSignalHandlers() {
    const signals = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
    
    signals.forEach(signal => {
      process.on(signal, async () => {
        this.logger.info(`${signal} received, starting cleanup...`);
        await this.emergencyCleanup();
        process.exit(0);
      });
    });

    // 未処理の例外
    process.on('uncaughtException', async (error) => {
      this.logger.error('Uncaught exception:', error);
      await this.emergencyCleanup();
      process.exit(1);
    });

    // 未処理のPromiseリジェクション
    process.on('unhandledRejection', async (reason, promise) => {
      this.logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      await this.emergencyCleanup();
      process.exit(1);
    });
  }

  /**
   * 孤児リソースの定期クリーンアップ
   */
  async cleanupOrphanedResources(stateDir) {
    const orphanedResources = {
      locks: 0,
      tempFiles: 0
    };

    try {
      // 古いロックファイルの検出と削除
      const lockDir = path.join(stateDir, '.locks');
      try {
        const files = await fs.readdir(lockDir);
        const now = Date.now();
        
        for (const file of files) {
          const filePath = path.join(lockDir, file);
          const stats = await fs.stat(filePath);
          
          // 1時間以上古いロックファイルは削除
          if (now - stats.mtimeMs > 3600000) {
            await fs.unlink(filePath);
            orphanedResources.locks++;
            this.logger.info(`Orphaned lock file removed: ${file}`);
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn('Failed to clean orphaned locks:', error.message);
        }
      }

      // 一時ファイルのクリーンアップ
      const tempDir = path.join(stateDir, '../temp');
      try {
        const files = await fs.readdir(tempDir);
        const now = Date.now();
        
        for (const file of files) {
          const filePath = path.join(tempDir, file);
          const stats = await fs.stat(filePath);
          
          // 24時間以上古い一時ファイルは削除
          if (now - stats.mtimeMs > 86400000) {
            await fs.unlink(filePath);
            orphanedResources.tempFiles++;
            this.logger.info(`Orphaned temp file removed: ${file}`);
          }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') {
          this.logger.warn('Failed to clean temp files:', error.message);
        }
      }

    } catch (error) {
      this.logger.error('Orphaned resource cleanup failed:', error);
    }

    return orphanedResources;
  }

}

module.exports = CleanupManager;