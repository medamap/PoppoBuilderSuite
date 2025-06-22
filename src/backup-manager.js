const fs = require('fs').promises;
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * PoppoBuilder Suiteのバックアップ・リストア機能を管理するクラス
 */
class BackupManager {
  constructor(config = {}, logger = null) {
    this.config = {
      enabled: true,
      schedule: '0 2 * * *', // 毎日午前2時
      retention: 30, // 30日間保持
      maxBackups: 10, // 最大10世代
      storage: {
        type: 'local', // local, s3, sftp
        path: './backups',
        compress: true,
        encrypt: false,
        encryptionKey: null
      },
      targets: {
        config: true,
        database: true,
        logs: true,
        agents: true,
        state: true,
        security: true
      },
      incremental: false,
      ...config
    };
    
    this.logger = logger || console;
    this.backupInProgress = false;
    this.lastBackupTime = null;
    this.backupHistory = [];
  }

  /**
   * バックアップを作成
   */
  async createBackup(options = {}) {
    if (this.backupInProgress) {
      throw new Error('バックアップが既に実行中です');
    }

    this.backupInProgress = true;
    const startTime = Date.now();
    const backupId = this.generateBackupId();
    
    try {
      this.logger.info(`バックアップを開始します: ${backupId}`);
      
      // バックアップディレクトリの準備
      const backupDir = path.join(this.config.storage.path, backupId);
      await this.ensureDirectory(backupDir);
      
      // メタデータの準備
      const metadata = {
        id: backupId,
        timestamp: new Date().toISOString(),
        version: this.getSystemVersion(),
        type: options.type || 'manual',
        incremental: this.config.incremental,
        targets: {}
      };
      
      // 各ターゲットのバックアップ
      if (this.config.targets.config) {
        await this.backupConfig(backupDir, metadata);
      }
      
      if (this.config.targets.database) {
        await this.backupDatabase(backupDir, metadata);
      }
      
      if (this.config.targets.logs) {
        await this.backupLogs(backupDir, metadata);
      }
      
      if (this.config.targets.agents) {
        await this.backupAgents(backupDir, metadata);
      }
      
      if (this.config.targets.state) {
        await this.backupState(backupDir, metadata);
      }
      
      if (this.config.targets.security) {
        await this.backupSecurity(backupDir, metadata);
      }
      
      // チェックサムの計算
      metadata.checksum = await this.calculateChecksum(backupDir);
      metadata.duration = Date.now() - startTime;
      metadata.size = await this.getDirectorySize(backupDir);
      
      // メタデータの保存
      await fs.writeFile(
        path.join(backupDir, 'metadata.json'),
        JSON.stringify(metadata, null, 2)
      );
      
      // アーカイブの作成
      if (this.config.storage.compress) {
        await this.createArchive(backupDir, backupId);
      }
      
      // バックアップ履歴の更新
      this.backupHistory.push(metadata);
      this.lastBackupTime = Date.now();
      
      // 古いバックアップの削除
      await this.cleanupOldBackups();
      
      this.logger.info(`バックアップが完了しました: ${backupId} (${metadata.duration}ms)`);
      
      return metadata;
      
    } catch (error) {
      this.logger.error(`バックアップ中にエラーが発生しました: ${error.message}`);
      throw error;
      
    } finally {
      this.backupInProgress = false;
    }
  }

  /**
   * 設定のバックアップ
   */
  async backupConfig(backupDir, metadata) {
    const configDir = path.join(backupDir, 'config');
    await this.ensureDirectory(configDir);
    
    // config/ディレクトリ全体
    await this.copyDirectory('./config', configDir);
    
    // .poppo/ディレクトリの設定
    const poppoConfigDir = path.join(backupDir, '.poppo');
    await this.ensureDirectory(poppoConfigDir);
    await this.copyFile('.poppo/config.json', path.join(poppoConfigDir, 'config.json'));
    
    // 環境変数（マスキング付き）
    const envVars = this.getFilteredEnvironmentVariables();
    await fs.writeFile(
      path.join(configDir, 'environment.json'),
      JSON.stringify(envVars, null, 2)
    );
    
    metadata.targets.config = {
      files: await this.countFiles(configDir),
      size: await this.getDirectorySize(configDir)
    };
  }

  /**
   * データベースのバックアップ
   */
  async backupDatabase(backupDir, metadata) {
    const dbDir = path.join(backupDir, 'database');
    await this.ensureDirectory(dbDir);
    
    // SQLiteデータベースファイル
    const dbFiles = [
      'data/poppo-history.db',
      '.poppo/poppo.db',
      'data/ccla.db',
      'data/security.db'
    ];
    
    for (const dbFile of dbFiles) {
      if (await this.fileExists(dbFile)) {
        const fileName = path.basename(dbFile);
        await this.copyFile(dbFile, path.join(dbDir, fileName));
      }
    }
    
    metadata.targets.database = {
      files: await this.countFiles(dbDir),
      size: await this.getDirectorySize(dbDir)
    };
  }

  /**
   * ログのバックアップ
   */
  async backupLogs(backupDir, metadata) {
    const logsDir = path.join(backupDir, 'logs');
    await this.ensureDirectory(logsDir);
    
    // 圧縮済みログのみコピー（現在のログは除外）
    const logFiles = await fs.readdir('./logs');
    for (const file of logFiles) {
      if (file.endsWith('.gz')) {
        await this.copyFile(
          path.join('./logs', file),
          path.join(logsDir, file)
        );
      }
    }
    
    // アーカイブディレクトリ
    if (await this.fileExists('./logs/archive')) {
      await this.copyDirectory('./logs/archive', path.join(logsDir, 'archive'));
    }
    
    metadata.targets.logs = {
      files: await this.countFiles(logsDir),
      size: await this.getDirectorySize(logsDir)
    };
  }

  /**
   * エージェントデータのバックアップ
   */
  async backupAgents(backupDir, metadata) {
    const agentsDir = path.join(backupDir, 'agents');
    await this.ensureDirectory(agentsDir);
    
    // CCLAの学習データ
    if (await this.fileExists('data/ccla')) {
      await this.copyDirectory('data/ccla', path.join(agentsDir, 'ccla'));
    }
    
    // CCAGの生成ドキュメント
    if (await this.fileExists('data/ccag')) {
      await this.copyDirectory('data/ccag', path.join(agentsDir, 'ccag'));
    }
    
    // CCPMの分析結果
    if (await this.fileExists('data/ccpm')) {
      await this.copyDirectory('data/ccpm', path.join(agentsDir, 'ccpm'));
    }
    
    metadata.targets.agents = {
      files: await this.countFiles(agentsDir),
      size: await this.getDirectorySize(agentsDir)
    };
  }

  /**
   * 状態ファイルのバックアップ
   */
  async backupState(backupDir, metadata) {
    const stateDir = path.join(backupDir, 'state');
    await this.ensureDirectory(stateDir);
    
    // state/ディレクトリ全体
    if (await this.fileExists('./state')) {
      await this.copyDirectory('./state', stateDir);
    }
    
    metadata.targets.state = {
      files: await this.countFiles(stateDir),
      size: await this.getDirectorySize(stateDir)
    };
  }

  /**
   * セキュリティ関連のバックアップ
   */
  async backupSecurity(backupDir, metadata) {
    const securityDir = path.join(backupDir, 'security');
    await this.ensureDirectory(securityDir);
    
    // 認証トークン（暗号化）
    if (await this.fileExists('.env')) {
      const envContent = await fs.readFile('.env', 'utf8');
      const encrypted = this.encryptData(envContent);
      await fs.writeFile(
        path.join(securityDir, 'env.encrypted'),
        encrypted
      );
    }
    
    // アクセスログ
    if (await this.fileExists('data/access.log')) {
      await this.copyFile('data/access.log', path.join(securityDir, 'access.log'));
    }
    
    metadata.targets.security = {
      files: await this.countFiles(securityDir),
      size: await this.getDirectorySize(securityDir)
    };
  }

  /**
   * バックアップからリストア
   */
  async restore(backupId, options = {}) {
    const startTime = Date.now();
    
    try {
      this.logger.info(`リストアを開始します: ${backupId}`);
      
      // バックアップの検証
      const backupPath = await this.findBackup(backupId);
      const metadata = await this.loadMetadata(backupPath);
      
      // ドライランモード
      if (options.dryRun) {
        this.logger.info('ドライランモード: 実際のリストアは実行されません');
        return this.analyzerestore(metadata, options);
      }
      
      // 現在の状態のバックアップ（安全のため）
      if (!options.skipBackup) {
        await this.createBackup({ type: 'pre-restore' });
      }
      
      // アーカイブの展開
      if (backupPath.endsWith('.tar.gz')) {
        backupPath = await this.extractArchive(backupPath);
      }
      
      // 各ターゲットのリストア
      if (options.targets?.config || (!options.targets && metadata.targets.config)) {
        await this.restoreConfig(backupPath, metadata);
      }
      
      if (options.targets?.database || (!options.targets && metadata.targets.database)) {
        await this.restoreDatabase(backupPath, metadata);
      }
      
      if (options.targets?.logs || (!options.targets && metadata.targets.logs)) {
        await this.restoreLogs(backupPath, metadata);
      }
      
      if (options.targets?.agents || (!options.targets && metadata.targets.agents)) {
        await this.restoreAgents(backupPath, metadata);
      }
      
      if (options.targets?.state || (!options.targets && metadata.targets.state)) {
        await this.restoreState(backupPath, metadata);
      }
      
      if (options.targets?.security || (!options.targets && metadata.targets.security)) {
        await this.restoreSecurity(backupPath, metadata);
      }
      
      const duration = Date.now() - startTime;
      this.logger.info(`リストアが完了しました: ${backupId} (${duration}ms)`);
      
      return {
        success: true,
        backupId,
        duration,
        targets: options.targets || Object.keys(metadata.targets)
      };
      
    } catch (error) {
      this.logger.error(`リストア中にエラーが発生しました: ${error.message}`);
      throw error;
    }
  }

  /**
   * バックアップ一覧の取得
   */
  async listBackups() {
    const backups = [];
    const files = await fs.readdir(this.config.storage.path);
    
    for (const file of files) {
      const filePath = path.join(this.config.storage.path, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory() || file.endsWith('.tar.gz')) {
        try {
          const metadata = await this.loadMetadata(filePath);
          backups.push({
            id: metadata.id,
            timestamp: metadata.timestamp,
            type: metadata.type,
            size: metadata.size,
            duration: metadata.duration,
            version: metadata.version,
            targets: Object.keys(metadata.targets)
          });
        } catch (error) {
          // メタデータが読み込めない場合はスキップ
        }
      }
    }
    
    return backups.sort((a, b) => 
      new Date(b.timestamp) - new Date(a.timestamp)
    );
  }

  /**
   * バックアップの検証
   */
  async verifyBackup(backupId) {
    try {
      const backupPath = await this.findBackup(backupId);
      const metadata = await this.loadMetadata(backupPath);
      
      // チェックサムの検証
      const currentChecksum = await this.calculateChecksum(backupPath);
      const isValid = currentChecksum === metadata.checksum;
      
      return {
        valid: isValid,
        backupId,
        timestamp: metadata.timestamp,
        checksum: {
          expected: metadata.checksum,
          actual: currentChecksum
        }
      };
      
    } catch (error) {
      return {
        valid: false,
        backupId,
        error: error.message
      };
    }
  }

  // ヘルパーメソッド

  generateBackupId() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const random = crypto.randomBytes(4).toString('hex');
    return `backup-${timestamp}-${random}`;
  }

  async ensureDirectory(dir) {
    await fs.mkdir(dir, { recursive: true });
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async copyFile(src, dest) {
    await this.ensureDirectory(path.dirname(dest));
    await fs.copyFile(src, dest);
  }

  async copyDirectory(src, dest) {
    await this.ensureDirectory(dest);
    const files = await fs.readdir(src);
    
    for (const file of files) {
      const srcPath = path.join(src, file);
      const destPath = path.join(dest, file);
      const stat = await fs.stat(srcPath);
      
      if (stat.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await this.copyFile(srcPath, destPath);
      }
    }
  }

  async countFiles(dir) {
    let count = 0;
    const files = await fs.readdir(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory()) {
        count += await this.countFiles(filePath);
      } else {
        count++;
      }
    }
    
    return count;
  }

  async getDirectorySize(dir) {
    let size = 0;
    const files = await fs.readdir(dir);
    
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory()) {
        size += await this.getDirectorySize(filePath);
      } else {
        size += stat.size;
      }
    }
    
    return size;
  }

  async calculateChecksum(dir) {
    const hash = crypto.createHash('sha256');
    await this.hashDirectory(dir, hash);
    return hash.digest('hex');
  }

  async hashDirectory(dir, hash) {
    const files = await fs.readdir(dir);
    files.sort(); // 一貫性のため
    
    for (const file of files) {
      if (file === 'metadata.json') continue; // メタデータは除外
      
      const filePath = path.join(dir, file);
      const stat = await fs.stat(filePath);
      
      if (stat.isDirectory()) {
        await this.hashDirectory(filePath, hash);
      } else {
        const content = await fs.readFile(filePath);
        hash.update(content);
      }
    }
  }

  async createArchive(sourceDir, archiveName) {
    const archivePath = path.join(this.config.storage.path, `${archiveName}.tar.gz`);
    
    return new Promise((resolve, reject) => {
      const tar = spawn('tar', [
        '-czf',
        archivePath,
        '-C',
        path.dirname(sourceDir),
        path.basename(sourceDir)
      ]);
      
      tar.on('close', async (code) => {
        if (code === 0) {
          // 元のディレクトリを削除
          await fs.rm(sourceDir, { recursive: true });
          resolve(archivePath);
        } else {
          reject(new Error(`アーカイブ作成に失敗しました: ${code}`));
        }
      });
    });
  }

  async extractArchive(archivePath) {
    const extractDir = archivePath.replace('.tar.gz', '');
    
    return new Promise((resolve, reject) => {
      const tar = spawn('tar', [
        '-xzf',
        archivePath,
        '-C',
        this.config.storage.path
      ]);
      
      tar.on('close', (code) => {
        if (code === 0) {
          resolve(extractDir);
        } else {
          reject(new Error(`アーカイブ展開に失敗しました: ${code}`));
        }
      });
    });
  }

  encryptData(data) {
    if (!this.config.storage.encrypt || !this.config.storage.encryptionKey) {
      return data;
    }
    
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(this.config.storage.encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    return iv.toString('hex') + ':' + encrypted;
  }

  decryptData(encryptedData) {
    if (!this.config.storage.encrypt || !this.config.storage.encryptionKey) {
      return encryptedData;
    }
    
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(this.config.storage.encryptionKey, 'salt', 32);
    const [ivHex, encrypted] = encryptedData.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  }

  getFilteredEnvironmentVariables() {
    const filtered = {};
    const sensitiveKeys = ['TOKEN', 'KEY', 'SECRET', 'PASSWORD'];
    
    for (const [key, value] of Object.entries(process.env)) {
      if (key.startsWith('POPPO_') || key.startsWith('CLAUDE_')) {
        if (sensitiveKeys.some(sensitive => key.includes(sensitive))) {
          filtered[key] = '***MASKED***';
        } else {
          filtered[key] = value;
        }
      }
    }
    
    return filtered;
  }

  getSystemVersion() {
    try {
      const packageJson = require('../package.json');
      return packageJson.version || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  async findBackup(backupId) {
    const directPath = path.join(this.config.storage.path, backupId);
    const archivePath = path.join(this.config.storage.path, `${backupId}.tar.gz`);
    
    if (await this.fileExists(directPath)) {
      return directPath;
    } else if (await this.fileExists(archivePath)) {
      return archivePath;
    } else {
      throw new Error(`バックアップが見つかりません: ${backupId}`);
    }
  }

  async loadMetadata(backupPath) {
    let metadataPath;
    
    if (backupPath.endsWith('.tar.gz')) {
      // アーカイブからメタデータを抽出
      const tempDir = path.join(this.config.storage.path, '.temp');
      await this.ensureDirectory(tempDir);
      
      await new Promise((resolve, reject) => {
        const tar = spawn('tar', [
          '-xzf',
          backupPath,
          '-C',
          tempDir,
          '--strip-components=1',
          'metadata.json'
        ]);
        
        tar.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error('メタデータの抽出に失敗しました'));
          }
        });
      });
      
      metadataPath = path.join(tempDir, 'metadata.json');
    } else {
      metadataPath = path.join(backupPath, 'metadata.json');
    }
    
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
    
    // 一時ファイルのクリーンアップ
    if (backupPath.endsWith('.tar.gz')) {
      await fs.rm(path.dirname(metadataPath), { recursive: true });
    }
    
    return metadata;
  }

  async cleanupOldBackups() {
    const backups = await this.listBackups();
    const now = Date.now();
    const retentionMs = this.config.retention * 24 * 60 * 60 * 1000;
    
    // 保持期間を過ぎたバックアップ
    const oldBackups = backups.filter(backup => {
      const age = now - new Date(backup.timestamp).getTime();
      return age > retentionMs;
    });
    
    // 最大世代数を超えたバックアップ
    const excessBackups = backups.slice(this.config.maxBackups);
    
    // 削除対象の結合
    const toDelete = new Set([
      ...oldBackups.map(b => b.id),
      ...excessBackups.map(b => b.id)
    ]);
    
    for (const backupId of toDelete) {
      try {
        const backupPath = await this.findBackup(backupId);
        if (backupPath.endsWith('.tar.gz')) {
          await fs.unlink(backupPath);
        } else {
          await fs.rm(backupPath, { recursive: true });
        }
        this.logger.info(`古いバックアップを削除しました: ${backupId}`);
      } catch (error) {
        this.logger.error(`バックアップ削除中にエラー: ${error.message}`);
      }
    }
  }

  // リストア関連のメソッド

  async restoreConfig(backupPath, metadata) {
    this.logger.info('設定をリストアしています...');
    const configDir = path.join(backupPath, 'config');
    
    // config/ディレクトリ
    await this.copyDirectory(configDir, './config');
    
    // .poppo/config.json
    const poppoConfig = path.join(backupPath, '.poppo', 'config.json');
    if (await this.fileExists(poppoConfig)) {
      await this.copyFile(poppoConfig, '.poppo/config.json');
    }
  }

  async restoreDatabase(backupPath, metadata) {
    this.logger.info('データベースをリストアしています...');
    const dbDir = path.join(backupPath, 'database');
    
    const dbFiles = await fs.readdir(dbDir);
    for (const file of dbFiles) {
      let destPath;
      if (file === 'poppo-history.db') {
        destPath = 'data/poppo-history.db';
      } else if (file === 'poppo.db') {
        destPath = '.poppo/poppo.db';
      } else if (file === 'ccla.db') {
        destPath = 'data/ccla.db';
      } else if (file === 'security.db') {
        destPath = 'data/security.db';
      }
      
      if (destPath) {
        await this.copyFile(path.join(dbDir, file), destPath);
      }
    }
  }

  async restoreLogs(backupPath, metadata) {
    this.logger.info('ログをリストアしています...');
    const logsDir = path.join(backupPath, 'logs');
    
    // アーカイブされたログのみリストア（現在のログは上書きしない）
    const files = await fs.readdir(logsDir);
    for (const file of files) {
      if (file.endsWith('.gz')) {
        await this.copyFile(
          path.join(logsDir, file),
          path.join('./logs', file)
        );
      }
    }
    
    // アーカイブディレクトリ
    const archiveDir = path.join(logsDir, 'archive');
    if (await this.fileExists(archiveDir)) {
      await this.copyDirectory(archiveDir, './logs/archive');
    }
  }

  async restoreAgents(backupPath, metadata) {
    this.logger.info('エージェントデータをリストアしています...');
    const agentsDir = path.join(backupPath, 'agents');
    
    // 各エージェントのデータ
    const agents = ['ccla', 'ccag', 'ccpm'];
    for (const agent of agents) {
      const agentDir = path.join(agentsDir, agent);
      if (await this.fileExists(agentDir)) {
        await this.copyDirectory(agentDir, path.join('data', agent));
      }
    }
  }

  async restoreState(backupPath, metadata) {
    this.logger.info('状態ファイルをリストアしています...');
    const stateDir = path.join(backupPath, 'state');
    
    if (await this.fileExists(stateDir)) {
      await this.copyDirectory(stateDir, './state');
    }
  }

  async restoreSecurity(backupPath, metadata) {
    this.logger.info('セキュリティデータをリストアしています...');
    const securityDir = path.join(backupPath, 'security');
    
    // 暗号化された環境変数
    const envFile = path.join(securityDir, 'env.encrypted');
    if (await this.fileExists(envFile)) {
      const encrypted = await fs.readFile(envFile, 'utf8');
      const decrypted = this.decryptData(encrypted);
      // 注意: .envファイルは上書きせず、.env.restoredとして保存
      await fs.writeFile('.env.restored', decrypted);
      this.logger.warn('.envファイルは .env.restored として保存されました。手動で確認してください。');
    }
    
    // アクセスログ
    const accessLog = path.join(securityDir, 'access.log');
    if (await this.fileExists(accessLog)) {
      await this.copyFile(accessLog, 'data/access.log');
    }
  }

  analyzerestore(metadata, options) {
    return {
      backupId: metadata.id,
      timestamp: metadata.timestamp,
      targets: options.targets || Object.keys(metadata.targets),
      dryRun: true,
      wouldRestore: metadata.targets
    };
  }
}

module.exports = BackupManager;