const cron = require('node-cron');
const BackupManager = require('./backup-manager');

/**
 * バックアップの自動スケジューリングを管理するクラス
 */
class BackupScheduler {
  constructor(config = {}, logger = null) {
    this.config = config;
    this.logger = logger || console;
    this.backupManager = new BackupManager(config.backup, logger);
    this.scheduledTasks = new Map();
    this.isRunning = false;
  }

  /**
   * スケジューラーを開始
   */
  start() {
    if (this.isRunning) {
      this.logger.warn('バックアップスケジューラーは既に実行中です');
      return;
    }

    if (!this.config.backup?.enabled) {
      this.logger.info('バックアップスケジューラーは無効化されています');
      return;
    }

    this.isRunning = true;
    this.scheduleBackups();
    this.logger.info('バックアップスケジューラーを開始しました');
  }

  /**
   * スケジューラーを停止
   */
  stop() {
    if (!this.isRunning) {
      return;
    }

    // すべてのスケジュールされたタスクを停止
    for (const [name, task] of this.scheduledTasks) {
      task.stop();
      this.logger.info(`バックアップスケジュール「${name}」を停止しました`);
    }

    this.scheduledTasks.clear();
    this.isRunning = false;
    this.logger.info('バックアップスケジューラーを停止しました');
  }

  /**
   * バックアップをスケジュール
   */
  scheduleBackups() {
    const schedule = this.config.backup?.schedule;
    
    if (!schedule) {
      this.logger.warn('バックアップスケジュールが設定されていません');
      return;
    }

    // デフォルトスケジュール
    if (typeof schedule === 'string') {
      this.scheduleTask('default', schedule, { type: 'scheduled' });
    } 
    // 複数スケジュール
    else if (typeof schedule === 'object') {
      for (const [name, config] of Object.entries(schedule)) {
        if (typeof config === 'string') {
          this.scheduleTask(name, config, { type: 'scheduled', name });
        } else if (config.cron) {
          this.scheduleTask(name, config.cron, {
            type: config.type || 'scheduled',
            name,
            ...config.options
          });
        }
      }
    }
  }

  /**
   * 個別のタスクをスケジュール
   */
  scheduleTask(name, cronExpression, options = {}) {
    if (!cron.validate(cronExpression)) {
      this.logger.error(`無効なcron式です: ${cronExpression}`);
      return;
    }

    const task = cron.schedule(cronExpression, async () => {
      await this.executeBackup(name, options);
    }, {
      scheduled: true,
      timezone: this.config.timezone || 'Asia/Tokyo'
    });

    this.scheduledTasks.set(name, task);
    this.logger.info(`バックアップスケジュール「${name}」を登録しました: ${cronExpression}`);
  }

  /**
   * バックアップを実行
   */
  async executeBackup(name, options = {}) {
    try {
      this.logger.info(`スケジュールされたバックアップを開始します: ${name}`);
      
      // バックアップ前の整合性チェック
      if (this.config.backup?.beforeBackup?.checkIntegrity) {
        const integrityOk = await this.checkSystemIntegrity();
        if (!integrityOk) {
          this.logger.error('システム整合性チェックに失敗しました。バックアップをスキップします。');
          return;
        }
      }

      // バックアップの実行
      const result = await this.backupManager.createBackup({
        ...options,
        scheduleName: name
      });

      // 成功通知
      if (this.config.backup?.notifications?.onSuccess) {
        await this.sendNotification('success', {
          name,
          backupId: result.id,
          duration: result.duration,
          size: result.size
        });
      }

      // 増分バックアップの管理
      if (this.config.backup?.incremental) {
        await this.manageIncrementalBackups();
      }

    } catch (error) {
      this.logger.error(`バックアップ実行中にエラーが発生しました: ${error.message}`);
      
      // エラー通知
      if (this.config.backup?.notifications?.onError) {
        await this.sendNotification('error', {
          name,
          error: error.message
        });
      }

      // リトライ設定
      if (this.config.backup?.retry?.enabled) {
        await this.retryBackup(name, options, error);
      }
    }
  }

  /**
   * システム整合性チェック
   */
  async checkSystemIntegrity() {
    try {
      // データベースの整合性チェック
      const dbCheck = await this.checkDatabaseIntegrity();
      if (!dbCheck) return false;

      // 設定ファイルの妥当性チェック
      const configCheck = await this.checkConfigIntegrity();
      if (!configCheck) return false;

      // 必要なディレクトリの存在確認
      const dirCheck = await this.checkDirectories();
      if (!dirCheck) return false;

      return true;
    } catch (error) {
      this.logger.error(`整合性チェック中にエラー: ${error.message}`);
      return false;
    }
  }

  /**
   * データベース整合性チェック
   */
  async checkDatabaseIntegrity() {
    const sqlite3 = require('sqlite3').verbose();
    const databases = [
      'data/poppo-history.db',
      '.poppo/poppo.db'
    ];

    for (const dbPath of databases) {
      const db = new sqlite3.Database(dbPath);
      
      const result = await new Promise((resolve) => {
        db.get("PRAGMA integrity_check", (err, row) => {
          db.close();
          if (err || row.integrity_check !== 'ok') {
            this.logger.error(`データベース整合性エラー: ${dbPath}`);
            resolve(false);
          } else {
            resolve(true);
          }
        });
      });

      if (!result) return false;
    }

    return true;
  }

  /**
   * 設定ファイル整合性チェック
   */
  async checkConfigIntegrity() {
    const fs = require('fs').promises;
    
    try {
      // config.jsonの検証
      const configContent = await fs.readFile('config/config.json', 'utf8');
      JSON.parse(configContent);
      
      // .poppo/config.jsonの検証
      const poppoConfigContent = await fs.readFile('.poppo/config.json', 'utf8');
      JSON.parse(poppoConfigContent);
      
      return true;
    } catch (error) {
      this.logger.error(`設定ファイル検証エラー: ${error.message}`);
      return false;
    }
  }

  /**
   * 必要なディレクトリの確認
   */
  async checkDirectories() {
    const fs = require('fs').promises;
    const requiredDirs = [
      'config',
      'data',
      'logs',
      'state',
      '.poppo'
    ];

    for (const dir of requiredDirs) {
      try {
        await fs.access(dir);
      } catch {
        this.logger.error(`必要なディレクトリが存在しません: ${dir}`);
        return false;
      }
    }

    return true;
  }

  /**
   * バックアップのリトライ
   */
  async retryBackup(name, options, error) {
    const retryConfig = this.config.backup?.retry || {};
    const maxRetries = retryConfig.maxRetries || 3;
    const retryDelay = retryConfig.delay || 300000; // 5分
    
    const retryCount = (options.retryCount || 0) + 1;
    
    if (retryCount > maxRetries) {
      this.logger.error(`バックアップのリトライ上限に達しました: ${name}`);
      return;
    }

    this.logger.info(`バックアップをリトライします (${retryCount}/${maxRetries}): ${name}`);
    
    setTimeout(() => {
      this.executeBackup(name, {
        ...options,
        retryCount
      });
    }, retryDelay);
  }

  /**
   * 増分バックアップの管理
   */
  async manageIncrementalBackups() {
    // 完全バックアップと増分バックアップの管理ロジック
    const backups = await this.backupManager.listBackups();
    const fullBackups = backups.filter(b => b.type === 'full');
    const incrementalBackups = backups.filter(b => b.type === 'incremental');
    
    // 最後の完全バックアップからの増分バックアップ数をチェック
    if (incrementalBackups.length >= (this.config.backup?.incremental?.maxIncrementals || 7)) {
      // 次回は完全バックアップを実行
      this.config.backup.incremental = false;
      this.logger.info('次回は完全バックアップを実行します');
    }
  }

  /**
   * 通知を送信
   */
  async sendNotification(type, data) {
    // 通知設定に基づいて通知を送信
    const notificationConfig = this.config.backup?.notifications;
    
    if (!notificationConfig || !notificationConfig.enabled) {
      return;
    }

    // ログ通知
    if (notificationConfig.channels?.includes('log')) {
      if (type === 'success') {
        this.logger.info(`バックアップ成功: ${data.name} (ID: ${data.backupId})`);
      } else if (type === 'error') {
        this.logger.error(`バックアップ失敗: ${data.name} - ${data.error}`);
      }
    }

    // その他の通知チャンネル（将来の拡張用）
    // Slack、Email、WebHook等
  }

  /**
   * 手動バックアップの実行
   */
  async manualBackup(options = {}) {
    return await this.backupManager.createBackup({
      ...options,
      type: 'manual'
    });
  }

  /**
   * スケジューラーの状態を取得
   */
  getStatus() {
    const schedules = [];
    
    for (const [name, task] of this.scheduledTasks) {
      schedules.push({
        name,
        status: task.status
      });
    }

    return {
      running: this.isRunning,
      schedules,
      lastBackup: this.backupManager.lastBackupTime,
      backupHistory: this.backupManager.backupHistory.slice(-10) // 最新10件
    };
  }
}

module.exports = BackupScheduler;