const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * CCLAエージェントのログアーカイブ管理クラス
 */
class LogArchiver {
  constructor(config, logger) {
    this.config = config.errorLogCollection?.archiving || {};
    this.logger = logger;
    
    // デフォルト設定
    this.archivePath = this.config.archivePath || 'data/ccla/archives';
    this.processedPath = this.config.processedLogsPath || 'data/ccla/processed';
    this.retentionDays = this.config.retentionDays || 30;
    this.compressionLevel = this.config.compressionLevel || 6;
    this.autoCleanup = this.config.autoCleanup !== false;
    this.maxArchiveSize = this.parseSize(this.config.maxArchiveSize || '1GB');
    this.alertThreshold = this.parseSize(this.config.alertThreshold || '800MB');
  }

  /**
   * 初期化処理
   */
  async initialize() {
    try {
      // 必要なディレクトリを作成
      await this.ensureDirectory(this.archivePath);
      await this.ensureDirectory(this.processedPath);
      
      this.logger.info('LogArchiver: 初期化完了', {
        archivePath: this.archivePath,
        processedPath: this.processedPath,
        retentionDays: this.retentionDays
      });
    } catch (error) {
      this.logger.error('LogArchiver: 初期化エラー', error);
      throw error;
    }
  }

  /**
   * 処理済みログファイルをアーカイブ
   */
  async archiveProcessedLogs() {
    try {
      const processedFiles = await this.getProcessedLogFiles();
      let archivedCount = 0;
      let totalSize = 0;

      for (const file of processedFiles) {
        const filePath = path.join(this.processedPath, file);
        const stats = await fs.stat(filePath);
        
        // 24時間以上経過したファイルをアーカイブ
        if (Date.now() - stats.mtime.getTime() > 24 * 60 * 60 * 1000) {
          const archived = await this.archiveFile(filePath);
          if (archived) {
            archivedCount++;
            totalSize += stats.size;
          }
        }
      }

      if (archivedCount > 0) {
        this.logger.info(`LogArchiver: ${archivedCount}個のファイルをアーカイブ（合計${this.formatSize(totalSize)}）`);
      }

      // 古いアーカイブのクリーンアップ
      if (this.autoCleanup) {
        await this.cleanupOldArchives();
      }

      // アーカイブサイズのチェック
      await this.checkArchiveSize();

    } catch (error) {
      this.logger.error('LogArchiver: アーカイブ処理エラー', error);
      throw error;
    }
  }

  /**
   * ファイルをアーカイブ
   */
  async archiveFile(filePath) {
    try {
      const fileName = path.basename(filePath);
      const date = new Date();
      const dateDir = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const archiveDir = path.join(this.archivePath, dateDir);
      
      await this.ensureDirectory(archiveDir);

      // ファイル内容を読み込んで圧縮
      const content = await fs.readFile(filePath);
      const compressed = await gzip(content, { level: this.compressionLevel });
      
      // アーカイブファイル名（タイムスタンプ付き）
      const timestamp = Date.now();
      const archiveFileName = `${fileName}.${timestamp}.gz`;
      const archivePath = path.join(archiveDir, archiveFileName);
      
      // 圧縮ファイルを保存
      await fs.writeFile(archivePath, compressed);
      
      // メタデータを保存
      const metadata = {
        originalName: fileName,
        originalPath: filePath,
        originalSize: content.length,
        compressedSize: compressed.length,
        compressionRatio: (1 - compressed.length / content.length) * 100,
        archivedAt: new Date().toISOString(),
        checksum: this.calculateChecksum(content)
      };
      
      await fs.writeFile(
        `${archivePath}.meta.json`,
        JSON.stringify(metadata, null, 2)
      );
      
      // 元ファイルを削除
      await fs.unlink(filePath);
      
      this.logger.debug(`LogArchiver: ファイルをアーカイブ: ${fileName} → ${archiveFileName}`);
      return true;
      
    } catch (error) {
      this.logger.error(`LogArchiver: ファイルアーカイブエラー: ${filePath}`, error);
      return false;
    }
  }

  /**
   * 古いアーカイブをクリーンアップ
   */
  async cleanupOldArchives() {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionDays);
      
      const directories = await fs.readdir(this.archivePath);
      let deletedCount = 0;
      let deletedSize = 0;

      for (const dir of directories) {
        const dirPath = path.join(this.archivePath, dir);
        const stats = await fs.stat(dirPath);
        
        if (stats.isDirectory()) {
          // ディレクトリ名から日付を解析
          const match = dir.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (match) {
            const dirDate = new Date(match[1], match[2] - 1, match[3]);
            
            if (dirDate < cutoffDate) {
              // ディレクトリ内のファイルサイズを集計
              const files = await fs.readdir(dirPath);
              for (const file of files) {
                const filePath = path.join(dirPath, file);
                const fileStats = await fs.stat(filePath);
                deletedSize += fileStats.size;
                await fs.unlink(filePath);
              }
              
              // 空のディレクトリを削除
              await fs.rmdir(dirPath);
              deletedCount += files.length;
            }
          }
        }
      }

      if (deletedCount > 0) {
        this.logger.info(
          `LogArchiver: 古いアーカイブを削除: ${deletedCount}ファイル（${this.formatSize(deletedSize)}）`
        );
      }

    } catch (error) {
      this.logger.error('LogArchiver: クリーンアップエラー', error);
    }
  }

  /**
   * アーカイブのサイズをチェック
   */
  async checkArchiveSize() {
    try {
      const totalSize = await this.calculateDirectorySize(this.archivePath);
      
      if (totalSize > this.maxArchiveSize) {
        this.logger.error(
          `LogArchiver: アーカイブサイズが上限を超過: ${this.formatSize(totalSize)} / ${this.formatSize(this.maxArchiveSize)}`
        );
        // 最も古いアーカイブから削除
        await this.removeOldestArchives(totalSize - this.maxArchiveSize);
      } else if (totalSize > this.alertThreshold) {
        this.logger.warn(
          `LogArchiver: アーカイブサイズが警告閾値に到達: ${this.formatSize(totalSize)} / ${this.formatSize(this.alertThreshold)}`
        );
      }
      
    } catch (error) {
      this.logger.error('LogArchiver: サイズチェックエラー', error);
    }
  }

  /**
   * アーカイブされたログを検索
   */
  async searchArchives(criteria) {
    const results = [];
    
    try {
      const directories = await fs.readdir(this.archivePath);
      
      for (const dir of directories) {
        const dirPath = path.join(this.archivePath, dir);
        const stats = await fs.stat(dirPath);
        
        if (stats.isDirectory()) {
          const files = await fs.readdir(dirPath);
          
          for (const file of files) {
            if (file.endsWith('.meta.json')) {
              const metaPath = path.join(dirPath, file);
              const metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));
              
              // 検索条件に一致するかチェック
              if (this.matchesCriteria(metadata, criteria)) {
                results.push({
                  ...metadata,
                  archiveFile: file.replace('.meta.json', ''),
                  archivePath: dirPath
                });
              }
            }
          }
        }
      }
      
      return results;
      
    } catch (error) {
      this.logger.error('LogArchiver: 検索エラー', error);
      return [];
    }
  }

  /**
   * アーカイブされたログを復元
   */
  async restoreArchive(archiveFile, targetPath) {
    try {
      const archivePath = path.join(this.archivePath, archiveFile);
      const metaPath = `${archivePath}.meta.json`;
      
      // メタデータを読み込み
      const metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));
      
      // 圧縮ファイルを読み込んで解凍
      const compressed = await fs.readFile(archivePath);
      const decompressed = await gunzip(compressed);
      
      // ターゲットパスに復元
      const restoredPath = targetPath || path.join(this.processedPath, metadata.originalName);
      await fs.writeFile(restoredPath, decompressed);
      
      this.logger.info(`LogArchiver: アーカイブを復元: ${archiveFile} → ${restoredPath}`);
      return restoredPath;
      
    } catch (error) {
      this.logger.error(`LogArchiver: 復元エラー: ${archiveFile}`, error);
      throw error;
    }
  }

  /**
   * 処理済みログファイルのリストを取得
   */
  async getProcessedLogFiles() {
    try {
      const files = await fs.readdir(this.processedPath);
      return files.filter(file => 
        file.endsWith('.json') || file.endsWith('.log')
      );
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * ディレクトリのサイズを計算
   */
  async calculateDirectorySize(dirPath) {
    let totalSize = 0;
    
    try {
      const files = await fs.readdir(dirPath);
      
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stats = await fs.stat(filePath);
        
        if (stats.isDirectory()) {
          totalSize += await this.calculateDirectorySize(filePath);
        } else {
          totalSize += stats.size;
        }
      }
      
      return totalSize;
      
    } catch (error) {
      return 0;
    }
  }

  /**
   * 最も古いアーカイブを削除
   */
  async removeOldestArchives(targetSize) {
    try {
      const archives = [];
      const directories = await fs.readdir(this.archivePath);
      
      // すべてのアーカイブファイルを収集
      for (const dir of directories) {
        const dirPath = path.join(this.archivePath, dir);
        const stats = await fs.stat(dirPath);
        
        if (stats.isDirectory()) {
          const files = await fs.readdir(dirPath);
          
          for (const file of files) {
            if (file.endsWith('.gz')) {
              const filePath = path.join(dirPath, file);
              const fileStats = await fs.stat(filePath);
              archives.push({
                path: filePath,
                metaPath: `${filePath}.meta.json`,
                size: fileStats.size,
                mtime: fileStats.mtime
              });
            }
          }
        }
      }
      
      // 古い順にソート
      archives.sort((a, b) => a.mtime - b.mtime);
      
      // 目標サイズに達するまで削除
      let deletedSize = 0;
      for (const archive of archives) {
        await fs.unlink(archive.path);
        try {
          await fs.unlink(archive.metaPath);
        } catch (e) {
          // メタファイルがない場合は無視
        }
        
        deletedSize += archive.size;
        
        if (deletedSize >= targetSize) {
          break;
        }
      }
      
      this.logger.info(`LogArchiver: 容量確保のため古いアーカイブを削除: ${this.formatSize(deletedSize)}`);
      
    } catch (error) {
      this.logger.error('LogArchiver: 古いアーカイブの削除エラー', error);
    }
  }

  /**
   * ディレクトリの存在を確認し、なければ作成
   */
  async ensureDirectory(dirPath) {
    try {
      await fs.access(dirPath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(dirPath, { recursive: true });
      } else {
        throw error;
      }
    }
  }

  /**
   * サイズ文字列をバイトに変換
   */
  parseSize(sizeStr) {
    const units = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };
    
    const match = sizeStr.match(/^(\d+(?:\.\d+)?)\s*([KMGT]?B)$/i);
    if (!match) {
      return parseInt(sizeStr) || 0;
    }
    
    const value = parseFloat(match[1]);
    const unit = match[2].toUpperCase();
    
    return Math.floor(value * (units[unit] || 1));
  }

  /**
   * バイトサイズを読みやすい形式にフォーマット
   */
  formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * チェックサムを計算
   */
  calculateChecksum(data) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * 検索条件に一致するかチェック
   */
  matchesCriteria(metadata, criteria) {
    if (criteria.fileName && !metadata.originalName.includes(criteria.fileName)) {
      return false;
    }
    
    if (criteria.dateFrom && new Date(metadata.archivedAt) < new Date(criteria.dateFrom)) {
      return false;
    }
    
    if (criteria.dateTo && new Date(metadata.archivedAt) > new Date(criteria.dateTo)) {
      return false;
    }
    
    if (criteria.minSize && metadata.originalSize < criteria.minSize) {
      return false;
    }
    
    if (criteria.maxSize && metadata.originalSize > criteria.maxSize) {
      return false;
    }
    
    return true;
  }
}

module.exports = LogArchiver;