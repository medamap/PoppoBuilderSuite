/**
 * ロールバック機能
 * 修復失敗時の自動ロールバック、変更履歴の管理、安全な復元プロセスを提供
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class RollbackManager {
  constructor(logger = console) {
    this.logger = logger;
    
    // バックアップディレクトリ
    this.backupDir = path.join(__dirname, '../../.poppo/backups');
    
    // ロールバック履歴
    this.rollbackHistory = [];
    
    // 設定
    this.config = {
      maxBackups: 50,              // 最大バックアップ数
      backupRetentionDays: 7,      // バックアップ保持期間（日）
      compressionEnabled: false,   // 圧縮を有効にするか（将来実装）
      verifyBackup: true          // バックアップの検証を行うか
    };
  }
  
  /**
   * 初期化処理
   */
  async initialize() {
    // バックアップディレクトリを作成
    await fs.mkdir(this.backupDir, { recursive: true });
    
    // 古いバックアップをクリーンアップ
    await this.cleanupOldBackups();
  }
  
  /**
   * ファイルのバックアップを作成
   */
  async createBackup(filePath, metadata = {}) {
    try {
      const backupId = this.generateBackupId();
      const timestamp = new Date().toISOString();
      
      // オリジナルファイルを読み込む
      const content = await fs.readFile(filePath, 'utf8');
      const checksum = this.calculateChecksum(content);
      
      // バックアップメタデータ
      const backupMetadata = {
        id: backupId,
        originalPath: filePath,
        timestamp,
        checksum,
        size: Buffer.byteLength(content),
        ...metadata
      };
      
      // バックアップファイルのパス
      const backupFilePath = path.join(this.backupDir, `${backupId}.backup`);
      const metadataFilePath = path.join(this.backupDir, `${backupId}.meta.json`);
      
      // バックアップを保存
      await fs.writeFile(backupFilePath, content);
      await fs.writeFile(metadataFilePath, JSON.stringify(backupMetadata, null, 2));
      
      // 検証
      if (this.config.verifyBackup) {
        const verified = await this.verifyBackup(backupFilePath, checksum);
        if (!verified) {
          throw new Error('バックアップの検証に失敗しました');
        }
      }
      
      this.logger.info(`バックアップを作成しました: ${backupId} (${filePath})`);
      
      return {
        backupId,
        backupPath: backupFilePath,
        metadata: backupMetadata
      };
      
    } catch (error) {
      this.logger.error(`バックアップ作成エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * 修復結果のロールバック
   */
  async rollback(repairResult, reason = '') {
    try {
      this.logger.info(`ロールバックを開始: ${reason}`);
      
      const rollbackEntry = {
        timestamp: new Date().toISOString(),
        reason,
        files: [],
        success: true
      };
      
      // バックアップパスからファイルを復元
      if (repairResult.backupPath) {
        await this.restoreFromBackup(repairResult.backupPath, repairResult.file);
        rollbackEntry.files.push({
          file: repairResult.file,
          backupPath: repairResult.backupPath,
          restored: true
        });
      }
      
      // 複数ファイルの修復の場合
      if (repairResult.files && Array.isArray(repairResult.files)) {
        for (const fileInfo of repairResult.files) {
          if (fileInfo.backupPath) {
            await this.restoreFromBackup(fileInfo.backupPath, fileInfo.file);
            rollbackEntry.files.push({
              file: fileInfo.file,
              backupPath: fileInfo.backupPath,
              restored: true
            });
          }
        }
      }
      
      // 新規作成されたファイルの削除
      if (repairResult.createdFiles && Array.isArray(repairResult.createdFiles)) {
        for (const createdFile of repairResult.createdFiles) {
          try {
            await fs.unlink(createdFile);
            rollbackEntry.files.push({
              file: createdFile,
              action: 'deleted',
              restored: true
            });
          } catch (error) {
            this.logger.warn(`ファイル削除エラー: ${createdFile} - ${error.message}`);
          }
        }
      }
      
      // ロールバック履歴に記録
      this.rollbackHistory.push(rollbackEntry);
      
      this.logger.info(`ロールバックが完了しました: ${rollbackEntry.files.length}ファイル`);
      
      return rollbackEntry;
      
    } catch (error) {
      this.logger.error(`ロールバックエラー: ${error.message}`);
      
      // ロールバック自体が失敗した場合の記録
      this.rollbackHistory.push({
        timestamp: new Date().toISOString(),
        reason,
        success: false,
        error: error.message
      });
      
      throw error;
    }
  }
  
  /**
   * バックアップからファイルを復元
   */
  async restoreFromBackup(backupPath, targetPath) {
    try {
      // バックアップファイルが直接のパスの場合
      if (backupPath.endsWith('.backup')) {
        const content = await fs.readFile(backupPath, 'utf8');
        await fs.writeFile(targetPath, content);
        this.logger.info(`ファイルを復元しました: ${targetPath}`);
        return;
      }
      
      // バックアップIDの場合
      const backupId = backupPath;
      const backupFilePath = path.join(this.backupDir, `${backupId}.backup`);
      const metadataFilePath = path.join(this.backupDir, `${backupId}.meta.json`);
      
      // メタデータを読み込む
      const metadataContent = await fs.readFile(metadataFilePath, 'utf8');
      const metadata = JSON.parse(metadataContent);
      
      // バックアップファイルを読み込む
      const content = await fs.readFile(backupFilePath, 'utf8');
      
      // チェックサムを検証
      const checksum = this.calculateChecksum(content);
      if (checksum !== metadata.checksum) {
        throw new Error('バックアップファイルの整合性チェックに失敗しました');
      }
      
      // ファイルを復元
      await fs.writeFile(targetPath, content);
      
      this.logger.info(`バックアップから復元しました: ${targetPath} (ID: ${backupId})`);
      
    } catch (error) {
      this.logger.error(`復元エラー: ${error.message}`);
      throw error;
    }
  }
  
  /**
   * バックアップIDを生成
   */
  generateBackupId() {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `backup-${timestamp}-${random}`;
  }
  
  /**
   * チェックサムを計算
   */
  calculateChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }
  
  /**
   * バックアップを検証
   */
  async verifyBackup(backupPath, expectedChecksum) {
    try {
      const content = await fs.readFile(backupPath, 'utf8');
      const actualChecksum = this.calculateChecksum(content);
      return actualChecksum === expectedChecksum;
    } catch (error) {
      this.logger.error(`バックアップ検証エラー: ${error.message}`);
      return false;
    }
  }
  
  /**
   * 古いバックアップをクリーンアップ
   */
  async cleanupOldBackups() {
    try {
      const files = await fs.readdir(this.backupDir);
      const now = Date.now();
      const maxAge = this.config.backupRetentionDays * 24 * 60 * 60 * 1000;
      
      const backupFiles = [];
      
      // バックアップファイルの情報を収集
      for (const file of files) {
        if (file.endsWith('.meta.json')) {
          const metaPath = path.join(this.backupDir, file);
          try {
            const content = await fs.readFile(metaPath, 'utf8');
            const metadata = JSON.parse(content);
            const age = now - new Date(metadata.timestamp).getTime();
            
            backupFiles.push({
              id: metadata.id,
              timestamp: metadata.timestamp,
              age,
              metaPath,
              backupPath: path.join(this.backupDir, `${metadata.id}.backup`)
            });
          } catch (error) {
            // 無効なメタデータファイルはスキップ
          }
        }
      }
      
      // 古い順にソート
      backupFiles.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // 削除対象を決定
      const toDelete = [];
      
      // 保持期間を超えたバックアップ
      for (const backup of backupFiles) {
        if (backup.age > maxAge) {
          toDelete.push(backup);
        }
      }
      
      // 最大数を超えた場合は古いものから削除
      const remaining = backupFiles.length - toDelete.length;
      if (remaining > this.config.maxBackups) {
        const excess = remaining - this.config.maxBackups;
        for (let i = 0; i < excess && i < backupFiles.length; i++) {
          if (!toDelete.includes(backupFiles[i])) {
            toDelete.push(backupFiles[i]);
          }
        }
      }
      
      // 削除を実行
      for (const backup of toDelete) {
        try {
          await fs.unlink(backup.metaPath);
          await fs.unlink(backup.backupPath);
          this.logger.info(`古いバックアップを削除: ${backup.id}`);
        } catch (error) {
          this.logger.warn(`バックアップ削除エラー: ${backup.id} - ${error.message}`);
        }
      }
      
      if (toDelete.length > 0) {
        this.logger.info(`${toDelete.length}個の古いバックアップを削除しました`);
      }
      
    } catch (error) {
      this.logger.error(`バックアップクリーンアップエラー: ${error.message}`);
    }
  }
  
  /**
   * バックアップ一覧を取得
   */
  async listBackups(options = {}) {
    try {
      const files = await fs.readdir(this.backupDir);
      const backups = [];
      
      for (const file of files) {
        if (file.endsWith('.meta.json')) {
          const metaPath = path.join(this.backupDir, file);
          try {
            const content = await fs.readFile(metaPath, 'utf8');
            const metadata = JSON.parse(content);
            
            if (options.filePath && metadata.originalPath !== options.filePath) {
              continue;
            }
            
            backups.push(metadata);
          } catch (error) {
            // 無効なメタデータファイルはスキップ
          }
        }
      }
      
      // タイムスタンプでソート（新しい順）
      backups.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      
      return backups;
      
    } catch (error) {
      this.logger.error(`バックアップ一覧取得エラー: ${error.message}`);
      return [];
    }
  }
  
  /**
   * ロールバック履歴を取得
   */
  getRollbackHistory() {
    return [...this.rollbackHistory];
  }
  
  /**
   * 特定のバックアップの詳細を取得
   */
  async getBackupDetails(backupId) {
    try {
      const metadataPath = path.join(this.backupDir, `${backupId}.meta.json`);
      const content = await fs.readFile(metadataPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      this.logger.error(`バックアップ詳細取得エラー: ${error.message}`);
      return null;
    }
  }
  
  /**
   * バックアップの統計情報を取得
   */
  async getStatistics() {
    try {
      const backups = await this.listBackups();
      
      let totalSize = 0;
      const byFile = {};
      
      for (const backup of backups) {
        totalSize += backup.size || 0;
        
        const file = backup.originalPath;
        if (!byFile[file]) {
          byFile[file] = {
            count: 0,
            totalSize: 0,
            lastBackup: null
          };
        }
        
        byFile[file].count++;
        byFile[file].totalSize += backup.size || 0;
        
        if (!byFile[file].lastBackup || 
            new Date(backup.timestamp) > new Date(byFile[file].lastBackup)) {
          byFile[file].lastBackup = backup.timestamp;
        }
      }
      
      return {
        totalBackups: backups.length,
        totalSize,
        totalRollbacks: this.rollbackHistory.length,
        successfulRollbacks: this.rollbackHistory.filter(r => r.success).length,
        failedRollbacks: this.rollbackHistory.filter(r => !r.success).length,
        byFile,
        oldestBackup: backups.length > 0 ? backups[backups.length - 1].timestamp : null,
        newestBackup: backups.length > 0 ? backups[0].timestamp : null
      };
      
    } catch (error) {
      this.logger.error(`統計情報取得エラー: ${error.message}`);
      return null;
    }
  }
}

module.exports = RollbackManager;