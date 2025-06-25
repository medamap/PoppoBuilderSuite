const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');

const stat = promisify(fs.stat);
const readdir = promisify(fs.readdir);
const rename = promisify(fs.rename);
const unlink = promisify(fs.unlink);
const createReadStream = fs.createReadStream;
const createWriteStream = fs.createWriteStream;

/**
 * ログローテーション管理クラス（シングルトン）
 */
class LogRotator {
  // グローバルサイレントモードフラグ
  static globalSilent = undefined; // undefined = デフォルト, true/false = 明示的設定
  
  constructor(config = {}) {
    // シングルトンパターンの実装
    if (LogRotator.instance) {
      // 既存のインスタンスがある場合は設定をマージ
      Object.assign(LogRotator.instance.config, config);
      
      // デバッグ設定を再計算
      LogRotator.instance.debugEnabled = process.env.POPPO_DEBUG_LOG_ROTATION === 'true';
      if (!LogRotator.instance.debugEnabled && (config.silent === false || LogRotator.globalSilent === false)) {
        LogRotator.instance.debugEnabled = true;
      }
      
      return LogRotator.instance;
    }

    // Deprecation warning for silent config
    if (config.hasOwnProperty('silent')) {
      console.warn('[LogRotator] DEPRECATION: "silent" config option is deprecated. Use POPPO_DEBUG_LOG_ROTATION environment variable instead.');
    }
    
    this.config = {
      enabled: config.enabled !== false,
      maxSize: config.maxSize || 100 * 1024 * 1024, // 100MB
      maxFiles: config.maxFiles || 10,
      datePattern: config.datePattern || 'YYYY-MM-DD',
      compress: config.compress !== false,
      compressionLevel: config.compressionLevel || 6,
      retentionDays: config.retentionDays || 30,
      checkInterval: config.checkInterval || 60000, // 1分
      archivePath: config.archivePath || 'logs/archive',
      silent: config.silent || false // サイレントモード（コンソール出力を抑制） - DEPRECATED
    };
    
    // 環境変数からデバッグモードを初期化
    this.debugEnabled = process.env.POPPO_DEBUG_LOG_ROTATION === 'true';
    
    // 後方互換性: silentとglobalSilentがfalseの場合はデバッグを有効化
    if (!this.debugEnabled && (config.silent === false || LogRotator.globalSilent === false)) {
      this.debugEnabled = true;
    }
    
    this.rotationInProgress = new Set();
    this.watchedFiles = new Map();
    this.checkIntervalId = null;
    
    if (this.config.enabled) {
      this.ensureArchiveDir();
      this.startWatching();
    }

    // シングルトンインスタンスを保存
    LogRotator.instance = this;
  }

  /**
   * アーカイブディレクトリのパスを取得
   */
  getArchivePath() {
    // 絶対パスでない場合は、プロジェクトルートからの相対パスとして解決
    return path.isAbsolute(this.config.archivePath) 
      ? this.config.archivePath 
      : path.resolve(process.cwd(), this.config.archivePath);
  }

  /**
   * アーカイブディレクトリを確保
   */
  ensureArchiveDir() {
    const archivePath = this.getArchivePath();
    
    if (!fs.existsSync(archivePath)) {
      fs.mkdirSync(archivePath, { recursive: true });
    }
  }

  /**
   * ログファイルの監視を開始
   */
  startWatching() {
    // 定期チェックを開始
    this.checkIntervalId = setInterval(() => {
      this.checkAllLogFiles();
    }, this.config.checkInterval);
    
    // 初回チェック
    this.checkAllLogFiles();
  }

  /**
   * 監視を停止
   */
  stopWatching() {
    if (this.checkIntervalId) {
      clearInterval(this.checkIntervalId);
      this.checkIntervalId = null;
    }
    
    // ファイル監視を解除
    for (const [filePath, watcher] of this.watchedFiles) {
      if (watcher) {
        watcher.close();
      }
    }
    this.watchedFiles.clear();
  }

  /**
   * デバッグ出力が有効かチェック
   */
  isDebugEnabled() {
    return this.debugEnabled;
  }
  
  /**
   * 条件付きデバッグログ出力
   */
  debugLog(...args) {
    if (this.isDebugEnabled()) {
      console.log(...args);
    }
  }
  
  /**
   * 条件付きデバッグエラー出力
   */
  debugError(...args) {
    if (this.isDebugEnabled()) {
      console.error(...args);
    }
  }

  /**
   * シングルトンインスタンスをリセット（テスト用）
   */
  static reset() {
    if (LogRotator.instance) {
      LogRotator.instance.stopWatching();
      LogRotator.instance = null;
    }
  }

  /**
   * グローバルサイレントモードを設定
   * @deprecated Use POPPO_DEBUG_LOG_ROTATION environment variable instead
   */
  static setGlobalSilent(silent) {
    console.warn('[LogRotator] DEPRECATION: "setGlobalSilent" is deprecated. Use POPPO_DEBUG_LOG_ROTATION environment variable instead.');
    LogRotator.globalSilent = silent;
  }

  /**
   * 現在のインスタンスを取得
   */
  static getInstance(config = {}) {
    return new LogRotator(config);
  }

  /**
   * 全ログファイルをチェック
   */
  async checkAllLogFiles() {
    try {
      const logDir = path.resolve('logs');
      if (!fs.existsSync(logDir)) {
        return;
      }
      
      const files = await readdir(logDir);
      const logFiles = files.filter(file => file.endsWith('.log'));
      
      for (const file of logFiles) {
        const filePath = path.join(logDir, file);
        await this.checkLogFile(filePath);
      }
      
      // 古いアーカイブファイルをクリーンアップ
      await this.cleanupOldArchives();
    } catch (error) {
      this.debugError('[LogRotator] エラー:', error);
    }
  }

  /**
   * 個別のログファイルをチェック
   */
  async checkLogFile(filePath) {
    try {
      // 既にローテーション中の場合はスキップ
      if (this.rotationInProgress.has(filePath)) {
        return;
      }
      
      const stats = await stat(filePath);
      
      // サイズベースのローテーション
      if (stats.size >= this.config.maxSize) {
        await this.rotateFile(filePath, 'size');
      }
      
      // 時間ベースのローテーション（日付が変わった場合）
      const fileName = path.basename(filePath);
      if (this.shouldRotateByDate(fileName, stats)) {
        await this.rotateFile(filePath, 'date');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.debugError(`[LogRotator] ファイルチェックエラー ${filePath}:`, error);
      }
    }
  }

  /**
   * 日付によるローテーションが必要かチェック
   */
  shouldRotateByDate(fileName, stats) {
    // ファイル名から日付を抽出
    const dateMatch = fileName.match(/(\d{4}-\d{2}-\d{2})/);
    if (!dateMatch) {
      return false;
    }
    
    const fileDate = new Date(dateMatch[1]);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // ファイルの日付が今日より前で、最終更新が今日の場合
    return fileDate < today && stats.mtime >= today;
  }

  /**
   * ファイルをローテーション
   */
  async rotateFile(filePath, reason) {
    // 既にローテーション中の場合はスキップ
    if (this.rotationInProgress.has(filePath)) {
      return;
    }

    // ファイルが存在しない場合はスキップ
    if (!fs.existsSync(filePath)) {
      return;
    }

    this.rotationInProgress.add(filePath);
    
    try {
      this.debugLog(`[LogRotator] ローテーション開始: ${filePath} (理由: ${reason})`);
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      let baseName = path.basename(filePath, '.log');
      
      // 既存のタイムスタンプパターンを完全に削除
      // 例: issue-100-2025-06-18-2025-06-18T23-49-29-187Z -> issue-100
      baseName = baseName.replace(/(-\d{4}-\d{2}-\d{2}.*?)+$/g, '');
      
      // 日付パターンも削除（例: issue-100-2025-06-18 -> issue-100）
      baseName = baseName.replace(/-\d{4}-\d{2}-\d{2}$/g, '');
      
      // ファイル名の最大長を制限（50文字）
      const maxBaseNameLength = 50;
      if (baseName.length > maxBaseNameLength) {
        // ハッシュを使用して短縮
        const hash = require('crypto').createHash('md5').update(baseName).digest('hex').substring(0, 8);
        baseName = baseName.substring(0, 20) + '-' + hash;
      }
      
      const rotatedName = `${baseName}-${timestamp}.log`;
      const rotatedPath = path.join(path.dirname(filePath), rotatedName);
      
      // ファイルをリネーム（ファイルが存在することを再確認）
      if (fs.existsSync(filePath)) {
        await rename(filePath, rotatedPath);
        
        // 圧縮が有効な場合
        if (this.config.compress) {
          await this.compressFile(rotatedPath);
        } else {
          // 圧縮しない場合はアーカイブディレクトリに移動
          const archivePath = path.join(this.getArchivePath(), path.basename(rotatedPath));
          await rename(rotatedPath, archivePath);
        }
        
        // 新しい空のログファイルを作成
        fs.writeFileSync(filePath, '');
        
        // ファイル数制限をチェック
        await this.enforceFileLimit();
        
        this.debugLog(`[LogRotator] ローテーション完了: ${filePath}`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        this.debugError(`[LogRotator] ローテーションエラー ${filePath}:`, error);
      }
    } finally {
      this.rotationInProgress.delete(filePath);
    }
  }

  /**
   * ファイルを圧縮
   */
  async compressFile(filePath) {
    return new Promise((resolve, reject) => {
      const gzipPath = `${filePath}.gz`;
      const archivePath = path.join(this.getArchivePath(), path.basename(gzipPath));
      
      // アーカイブディレクトリを確認
      this.ensureArchiveDir();
      
      // 圧縮前にファイルサイズを取得
      const originalStats = fs.statSync(filePath);
      const originalSize = originalStats.size;
      
      const readStream = createReadStream(filePath);
      const writeStream = createWriteStream(archivePath);
      const gzipStream = zlib.createGzip({ level: this.config.compressionLevel });
      
      // エラーハンドリングを設定
      readStream.on('error', reject);
      gzipStream.on('error', reject);
      writeStream.on('error', reject);
      
      writeStream.on('finish', async () => {
        try {
          // メタデータを保存
          const stats = await stat(archivePath);
          const metadata = {
            originalName: path.basename(filePath),
            compressedName: path.basename(archivePath),
            originalSize: originalSize,
            compressedSize: stats.size,
            compressionRatio: ((1 - stats.size / originalSize) * 100).toFixed(2),
            timestamp: new Date().toISOString()
          };
          
          const metadataPath = archivePath.replace('.gz', '.meta.json');
          fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
          
          // 元ファイルを削除
          await unlink(filePath);
          
          resolve();
        } catch (error) {
          reject(error);
        }
      });
      
      // パイプラインを開始
      readStream.pipe(gzipStream).pipe(writeStream);
    });
  }

  /**
   * ファイル数制限を適用
   */
  async enforceFileLimit() {
    try {
      const archiveDir = this.getArchivePath();
      const files = await readdir(archiveDir);
      
      // ログファイル（.logまたは.log.gz）を取得
      const logFiles = files.filter(file => 
        file.endsWith('.log') || file.endsWith('.log.gz')
      );
      
      // ファイル名でソート（新しい順）
      logFiles.sort((a, b) => b.localeCompare(a));
      
      // 制限を超えるファイルを削除
      if (logFiles.length > this.config.maxFiles) {
        const filesToDelete = logFiles.slice(this.config.maxFiles);
        
        for (const file of filesToDelete) {
          const filePath = path.join(archiveDir, file);
          await unlink(filePath);
          
          // メタデータファイルも削除
          const metaPath = filePath.replace('.gz', '.meta.json');
          if (fs.existsSync(metaPath)) {
            await unlink(metaPath);
          }
          
          if (!this.config.silent && !LogRotator.globalSilent) {
            this.debugLog(`[LogRotator] 古いファイルを削除: ${file}`);
          }
        }
      }
    } catch (error) {
      this.debugError('[LogRotator] ファイル数制限エラー:', error);
    }
  }

  /**
   * 古いアーカイブをクリーンアップ
   */
  async cleanupOldArchives() {
    try {
      const archiveDir = this.getArchivePath();
      const files = await readdir(archiveDir);
      const now = Date.now();
      const retentionMs = this.config.retentionDays * 24 * 60 * 60 * 1000;
      
      for (const file of files) {
        const filePath = path.join(archiveDir, file);
        const stats = await stat(filePath);
        
        if (now - stats.mtime.getTime() > retentionMs) {
          await unlink(filePath);
          if (!this.config.silent && !LogRotator.globalSilent) {
            this.debugLog(`[LogRotator] 保存期間超過により削除: ${file}`);
          }
        }
      }
    } catch (error) {
      this.debugError('[LogRotator] クリーンアップエラー:', error);
    }
  }

  /**
   * 手動でローテーションを実行
   */
  async rotateAll() {
    if (!this.config.silent && !LogRotator.globalSilent) {
      this.debugLog('[LogRotator] 手動ローテーション開始');
    }
    
    try {
      const logDir = path.resolve('logs');
      const files = await readdir(logDir);
      const logFiles = files.filter(file => file.endsWith('.log'));
      
      for (const file of logFiles) {
        const filePath = path.join(logDir, file);
        await this.rotateFile(filePath, 'manual');
      }
      
      if (!this.config.silent && !LogRotator.globalSilent) {
        this.debugLog('[LogRotator] 手動ローテーション完了');
      }
    } catch (error) {
      this.debugError('[LogRotator] 手動ローテーションエラー:', error);
      throw error;
    }
  }

  /**
   * アーカイブの統計情報を取得
   */
  async getArchiveStats() {
    try {
      const archiveDir = this.getArchivePath();
      const files = await readdir(archiveDir);
      
      let totalSize = 0;
      let totalCount = 0;
      let compressedCount = 0;
      let totalOriginalSize = 0;
      let totalCompressedSize = 0;
      
      for (const file of files) {
        if (file.endsWith('.log') || file.endsWith('.log.gz')) {
          totalCount++;
          const filePath = path.join(archiveDir, file);
          const stats = await stat(filePath);
          totalSize += stats.size;
          
          if (file.endsWith('.gz')) {
            compressedCount++;
            totalCompressedSize += stats.size;
            
            // メタデータから元のサイズを取得
            const metaPath = filePath.replace('.gz', '.meta.json');
            if (fs.existsSync(metaPath)) {
              const metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
              totalOriginalSize += metadata.originalSize || 0;
            }
          }
        }
      }
      
      return {
        totalFiles: totalCount,
        compressedFiles: compressedCount,
        totalSize: totalSize,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2),
        averageCompressionRatio: compressedCount > 0 
          ? ((1 - totalCompressedSize / totalOriginalSize) * 100).toFixed(2) 
          : 0,
        oldestFile: files.length > 0 ? files.sort()[0] : null,
        newestFile: files.length > 0 ? files.sort().reverse()[0] : null
      };
    } catch (error) {
      this.debugError('[LogRotator] 統計情報取得エラー:', error);
      return null;
    }
  }
}

module.exports = LogRotator;