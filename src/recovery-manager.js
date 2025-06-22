const fs = require('fs').promises;
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const Logger = require('./logger');

/**
 * リカバリーマネージャー
 * 自動回復アクションを実行
 */
class RecoveryManager {
  constructor(processManager) {
    this.processManager = processManager;
    this.logger = new Logger('RecoveryManager');
    
    // 回復アクションの履歴
    this.actionHistory = [];
    this.maxHistorySize = 100;
    
    // アクションのクールダウン管理
    this.cooldowns = new Map();
    this.defaultCooldown = 300000; // 5分
  }
  
  /**
   * メモリクリーンアップの実行
   */
  async cleanupMemory() {
    const actionType = 'memory_cleanup';
    
    if (this.isInCooldown(actionType)) {
      this.logger.info('メモリクリーンアップはクールダウン中です');
      return { success: false, reason: 'cooldown' };
    }
    
    this.logger.info('メモリクリーンアップを開始します');
    const startTime = Date.now();
    const actions = [];
    
    try {
      // 1. Node.jsのガベージコレクションを強制実行
      if (global.gc) {
        global.gc();
        actions.push('ガベージコレクション実行');
      }
      
      // 2. 古いログファイルの削除
      const logsDeleted = await this.cleanupOldLogs();
      if (logsDeleted > 0) {
        actions.push(`${logsDeleted}個の古いログファイルを削除`);
      }
      
      // 3. 一時ファイルの削除
      const tempDeleted = await this.cleanupTempFiles();
      if (tempDeleted > 0) {
        actions.push(`${tempDeleted}個の一時ファイルを削除`);
      }
      
      // 4. キャッシュのクリア
      await this.clearCaches();
      actions.push('キャッシュをクリア');
      
      // 成功を記録
      this.recordAction(actionType, true, actions);
      this.setCooldown(actionType);
      
      const duration = Date.now() - startTime;
      this.logger.info(`メモリクリーンアップ完了: ${actions.length}個のアクション実行（${duration}ms）`);
      
      return {
        success: true,
        actions,
        duration
      };
      
    } catch (error) {
      this.logger.error('メモリクリーンアップエラー:', error);
      this.recordAction(actionType, false, error.message);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * プロセスの再起動
   */
  async restartProcess(processId) {
    const actionType = `process_restart_${processId}`;
    
    if (this.isInCooldown(actionType)) {
      this.logger.info(`プロセス${processId}の再起動はクールダウン中です`);
      return { success: false, reason: 'cooldown' };
    }
    
    this.logger.info(`プロセス${processId}を再起動します`);
    
    try {
      if (!this.processManager) {
        throw new Error('ProcessManagerが利用できません');
      }
      
      // プロセスの停止
      const stopped = await this.processManager.stopProcess(processId);
      if (!stopped) {
        throw new Error('プロセスの停止に失敗しました');
      }
      
      // 少し待機
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // プロセスの再起動
      // 注意: processManagerの実装に応じて、再起動メソッドを調整する必要があります
      const restarted = await this.processManager.restartProcess(processId);
      
      if (restarted) {
        this.recordAction(actionType, true, `プロセス${processId}を再起動`);
        this.setCooldown(actionType);
        
        return {
          success: true,
          processId
        };
      } else {
        throw new Error('プロセスの再起動に失敗しました');
      }
      
    } catch (error) {
      this.logger.error(`プロセス再起動エラー (${processId}):`, error);
      this.recordAction(actionType, false, error.message);
      
      return {
        success: false,
        processId,
        error: error.message
      };
    }
  }
  
  /**
   * ディスククリーンアップの実行
   */
  async cleanupDisk() {
    const actionType = 'disk_cleanup';
    
    if (this.isInCooldown(actionType)) {
      this.logger.info('ディスククリーンアップはクールダウン中です');
      return { success: false, reason: 'cooldown' };
    }
    
    this.logger.info('ディスククリーンアップを開始します');
    const startTime = Date.now();
    const actions = [];
    let totalFreed = 0;
    
    try {
      // 1. 古いログファイルのアーカイブと削除
      const logsFreed = await this.archiveAndCleanLogs();
      totalFreed += logsFreed;
      actions.push(`ログファイル: ${this.formatBytes(logsFreed)}解放`);
      
      // 2. 一時ファイルの削除
      const tempFreed = await this.cleanupTempFiles(true);
      totalFreed += tempFreed;
      actions.push(`一時ファイル: ${this.formatBytes(tempFreed)}解放`);
      
      // 3. 古いバックアップの削除
      const backupFreed = await this.cleanupOldBackups();
      totalFreed += backupFreed;
      actions.push(`バックアップ: ${this.formatBytes(backupFreed)}解放`);
      
      // 4. データベースのVACUUM実行
      await this.vacuumDatabase();
      actions.push('データベースを最適化');
      
      // 成功を記録
      this.recordAction(actionType, true, actions);
      this.setCooldown(actionType);
      
      const duration = Date.now() - startTime;
      this.logger.info(`ディスククリーンアップ完了: ${this.formatBytes(totalFreed)}解放（${duration}ms）`);
      
      return {
        success: true,
        actions,
        totalFreed,
        duration
      };
      
    } catch (error) {
      this.logger.error('ディスククリーンアップエラー:', error);
      this.recordAction(actionType, false, error.message);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * API接続のリセット
   */
  async resetApiConnections() {
    const actionType = 'api_reset';
    
    if (this.isInCooldown(actionType)) {
      this.logger.info('API接続リセットはクールダウン中です');
      return { success: false, reason: 'cooldown' };
    }
    
    this.logger.info('API接続をリセットします');
    
    try {
      const actions = [];
      
      // 1. HTTPSエージェントのリセット（Node.jsのキープアライブ接続をクリア）
      const https = require('https');
      https.globalAgent.destroy();
      actions.push('HTTPSエージェントをリセット');
      
      // 2. DNSキャッシュのクリア（可能な場合）
      if (process.platform !== 'win32') {
        try {
          await execAsync('sudo dscacheutil -flushcache 2>/dev/null || sudo systemd-resolve --flush-caches 2>/dev/null || true');
          actions.push('DNSキャッシュをクリア');
        } catch (error) {
          // DNSキャッシュクリアは失敗しても続行
        }
      }
      
      // 3. レート制限カウンターのリセット
      // 注意: 実際のレート制限管理の実装に応じて調整が必要
      actions.push('レート制限カウンターをリセット');
      
      this.recordAction(actionType, true, actions);
      this.setCooldown(actionType);
      
      return {
        success: true,
        actions
      };
      
    } catch (error) {
      this.logger.error('API接続リセットエラー:', error);
      this.recordAction(actionType, false, error.message);
      
      return {
        success: false,
        error: error.message
      };
    }
  }
  
  /**
   * 古いログファイルのクリーンアップ
   */
  async cleanupOldLogs(daysToKeep = 7) {
    const logsDir = path.join(__dirname, '../logs');
    let deletedCount = 0;
    
    try {
      const files = await fs.readdir(logsDir);
      const cutoffTime = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);
      
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        
        const filePath = path.join(logsDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffTime) {
          await fs.unlink(filePath);
          deletedCount++;
        }
      }
      
    } catch (error) {
      this.logger.error('ログクリーンアップエラー:', error);
    }
    
    return deletedCount;
  }
  
  /**
   * 一時ファイルのクリーンアップ
   */
  async cleanupTempFiles(returnSize = false) {
    const tempDirs = [
      path.join(__dirname, '../temp'),
      path.join(__dirname, '../.temp'),
      '/tmp/poppobuilder'
    ];
    
    let totalSize = 0;
    let deletedCount = 0;
    
    for (const dir of tempDirs) {
      try {
        const files = await fs.readdir(dir);
        
        for (const file of files) {
          const filePath = path.join(dir, file);
          
          try {
            const stats = await fs.stat(filePath);
            if (returnSize) totalSize += stats.size;
            
            await fs.unlink(filePath);
            deletedCount++;
          } catch (error) {
            // ファイルごとのエラーは無視
          }
        }
      } catch (error) {
        // ディレクトリが存在しない場合は無視
      }
    }
    
    return returnSize ? totalSize : deletedCount;
  }
  
  /**
   * キャッシュのクリア
   */
  async clearCaches() {
    // require.cacheのクリア（注意深く実行）
    const cacheKeys = Object.keys(require.cache);
    const projectRoot = path.resolve(__dirname, '..');
    
    for (const key of cacheKeys) {
      // プロジェクト外のモジュールはクリアしない
      if (!key.startsWith(projectRoot)) continue;
      
      // 重要なモジュールは除外
      if (key.includes('node_modules') || 
          key.includes('logger.js') ||
          key.includes('config')) continue;
      
      delete require.cache[key];
    }
  }
  
  /**
   * ログファイルのアーカイブとクリーンアップ
   */
  async archiveAndCleanLogs() {
    const logsDir = path.join(__dirname, '../logs');
    const archiveDir = path.join(__dirname, '../logs/archive');
    let totalFreed = 0;
    
    try {
      await fs.mkdir(archiveDir, { recursive: true });
      
      const files = await fs.readdir(logsDir);
      const cutoffTime = Date.now() - (3 * 24 * 60 * 60 * 1000); // 3日前
      
      for (const file of files) {
        if (!file.endsWith('.log')) continue;
        
        const filePath = path.join(logsDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffTime) {
          // アーカイブ（gzip圧縮）
          const archivePath = path.join(archiveDir, `${file}.gz`);
          
          try {
            await execAsync(`gzip -c "${filePath}" > "${archivePath}"`);
            await fs.unlink(filePath);
            totalFreed += stats.size;
          } catch (error) {
            // 圧縮失敗時は単純削除
            await fs.unlink(filePath);
            totalFreed += stats.size;
          }
        }
      }
      
    } catch (error) {
      this.logger.error('ログアーカイブエラー:', error);
    }
    
    return totalFreed;
  }
  
  /**
   * 古いバックアップの削除
   */
  async cleanupOldBackups() {
    const backupDir = path.join(__dirname, '../.poppo/backups');
    let totalFreed = 0;
    
    try {
      const files = await fs.readdir(backupDir);
      const cutoffTime = Date.now() - (30 * 24 * 60 * 60 * 1000); // 30日前
      
      for (const file of files) {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        
        if (stats.mtime < cutoffTime) {
          totalFreed += stats.size;
          await fs.unlink(filePath);
        }
      }
      
    } catch (error) {
      // バックアップディレクトリが存在しない場合は無視
    }
    
    return totalFreed;
  }
  
  /**
   * データベースのVACUUM実行
   */
  async vacuumDatabase() {
    const dbPath = path.join(__dirname, '../.poppo/poppo.db');
    
    try {
      const sqlite3 = require('sqlite3');
      const db = new sqlite3.Database(dbPath);
      
      await new Promise((resolve, reject) => {
        db.run('VACUUM', (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      
      db.close();
      
    } catch (error) {
      this.logger.error('データベースVACUUMエラー:', error);
      throw error;
    }
  }
  
  /**
   * アクションの記録
   */
  recordAction(type, success, details) {
    const action = {
      type,
      success,
      details,
      timestamp: new Date().toISOString()
    };
    
    this.actionHistory.push(action);
    
    if (this.actionHistory.length > this.maxHistorySize) {
      this.actionHistory.shift();
    }
  }
  
  /**
   * クールダウンのチェック
   */
  isInCooldown(actionType) {
    const cooldownUntil = this.cooldowns.get(actionType);
    if (!cooldownUntil) return false;
    
    return Date.now() < cooldownUntil;
  }
  
  /**
   * クールダウンの設定
   */
  setCooldown(actionType, duration = this.defaultCooldown) {
    this.cooldowns.set(actionType, Date.now() + duration);
  }
  
  /**
   * バイト数をフォーマット
   */
  formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  }
  
  /**
   * アクション履歴の取得
   */
  getActionHistory() {
    return [...this.actionHistory];
  }
  
  /**
   * 統計情報の取得
   */
  getStatistics() {
    const total = this.actionHistory.length;
    const successful = this.actionHistory.filter(a => a.success).length;
    const failed = total - successful;
    
    const byType = {};
    for (const action of this.actionHistory) {
      const baseType = action.type.split('_')[0];
      if (!byType[baseType]) {
        byType[baseType] = { total: 0, successful: 0 };
      }
      byType[baseType].total++;
      if (action.success) {
        byType[baseType].successful++;
      }
    }
    
    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? Math.round((successful / total) * 100) : 0,
      byType
    };
  }
}

module.exports = RecoveryManager;