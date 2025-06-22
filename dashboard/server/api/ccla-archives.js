const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs').promises;

/**
 * CCLAアーカイブ管理API
 */
class CCLAArchivesAPI {
  constructor(logArchiver) {
    this.logArchiver = logArchiver;
    this.setupRoutes();
  }

  setupRoutes() {
    // アーカイブ検索
    router.get('/search', async (req, res) => {
      try {
        const criteria = {
          fileName: req.query.fileName,
          dateFrom: req.query.dateFrom,
          dateTo: req.query.dateTo,
          minSize: req.query.minSize ? parseInt(req.query.minSize) : undefined,
          maxSize: req.query.maxSize ? parseInt(req.query.maxSize) : undefined
        };

        // undefinedの項目を削除
        Object.keys(criteria).forEach(key => 
          criteria[key] === undefined && delete criteria[key]
        );

        const results = await this.logArchiver.searchArchives(criteria);
        
        res.json({
          success: true,
          count: results.length,
          results: results
        });
      } catch (error) {
        console.error('アーカイブ検索エラー:', error);
        res.status(500).json({
          success: false,
          error: 'アーカイブ検索に失敗しました'
        });
      }
    });

    // アーカイブ統計情報
    router.get('/stats', async (req, res) => {
      try {
        const totalSize = await this.logArchiver.calculateDirectorySize(
          this.logArchiver.archivePath
        );
        
        const processedSize = await this.logArchiver.calculateDirectorySize(
          this.logArchiver.processedPath
        );

        const stats = {
          archiveSize: this.logArchiver.formatSize(totalSize),
          archiveSizeBytes: totalSize,
          processedSize: this.logArchiver.formatSize(processedSize),
          processedSizeBytes: processedSize,
          maxSize: this.logArchiver.formatSize(this.logArchiver.maxArchiveSize),
          alertThreshold: this.logArchiver.formatSize(this.logArchiver.alertThreshold),
          retentionDays: this.logArchiver.retentionDays,
          compressionLevel: this.logArchiver.compressionLevel,
          usagePercent: (totalSize / this.logArchiver.maxArchiveSize * 100).toFixed(2)
        };

        res.json({
          success: true,
          stats: stats
        });
      } catch (error) {
        console.error('統計情報取得エラー:', error);
        res.status(500).json({
          success: false,
          error: '統計情報の取得に失敗しました'
        });
      }
    });

    // アーカイブ復元
    router.post('/restore/:archiveFile', async (req, res) => {
      try {
        const { archiveFile } = req.params;
        const { targetPath } = req.body;

        // セキュリティチェック（パストラバーサル防止）
        if (archiveFile.includes('..') || (targetPath && targetPath.includes('..'))) {
          return res.status(400).json({
            success: false,
            error: '不正なファイルパスです'
          });
        }

        const restoredPath = await this.logArchiver.restoreArchive(
          archiveFile,
          targetPath
        );

        res.json({
          success: true,
          restoredPath: restoredPath
        });
      } catch (error) {
        console.error('アーカイブ復元エラー:', error);
        res.status(500).json({
          success: false,
          error: 'アーカイブの復元に失敗しました'
        });
      }
    });

    // 手動アーカイブ実行
    router.post('/archive', async (req, res) => {
      try {
        await this.logArchiver.archiveProcessedLogs();
        
        res.json({
          success: true,
          message: 'アーカイブ処理を実行しました'
        });
      } catch (error) {
        console.error('手動アーカイブエラー:', error);
        res.status(500).json({
          success: false,
          error: 'アーカイブ処理に失敗しました'
        });
      }
    });

    // アーカイブ一覧
    router.get('/list', async (req, res) => {
      try {
        const { page = 1, limit = 20, sortBy = 'date', order = 'desc' } = req.query;
        const offset = (page - 1) * limit;

        const archives = [];
        const directories = await fs.readdir(this.logArchiver.archivePath);

        for (const dir of directories) {
          const dirPath = path.join(this.logArchiver.archivePath, dir);
          const stats = await fs.stat(dirPath);
          
          if (stats.isDirectory()) {
            const files = await fs.readdir(dirPath);
            
            for (const file of files) {
              if (file.endsWith('.gz')) {
                const filePath = path.join(dirPath, file);
                const fileStats = await fs.stat(filePath);
                const metaPath = `${filePath}.meta.json`;
                
                let metadata = {};
                try {
                  metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));
                } catch (e) {
                  // メタデータがない場合は基本情報のみ
                }

                archives.push({
                  file: file,
                  directory: dir,
                  size: fileStats.size,
                  created: fileStats.birthtime,
                  modified: fileStats.mtime,
                  metadata: metadata
                });
              }
            }
          }
        }

        // ソート
        archives.sort((a, b) => {
          let compareValue = 0;
          switch (sortBy) {
            case 'size':
              compareValue = a.size - b.size;
              break;
            case 'name':
              compareValue = a.file.localeCompare(b.file);
              break;
            case 'date':
            default:
              compareValue = new Date(a.created) - new Date(b.created);
          }
          return order === 'desc' ? -compareValue : compareValue;
        });

        // ページネーション
        const paginatedArchives = archives.slice(offset, offset + parseInt(limit));

        res.json({
          success: true,
          total: archives.length,
          page: parseInt(page),
          limit: parseInt(limit),
          archives: paginatedArchives
        });
      } catch (error) {
        console.error('アーカイブ一覧取得エラー:', error);
        res.status(500).json({
          success: false,
          error: 'アーカイブ一覧の取得に失敗しました'
        });
      }
    });
  }

  getRouter() {
    return router;
  }
}

module.exports = CCLAArchivesAPI;