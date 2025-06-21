const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const ConfigLoader = require('./config-loader');

/**
 * 設定ファイルの変更を監視し、動的に再読み込みを行うクラス
 */
class ConfigWatcher extends EventEmitter {
  constructor(logger = console) {
    super();
    this.logger = logger;
    this.configLoader = new ConfigLoader();
    this.watchers = new Map();
    this.currentConfig = null;
    this.isInitialized = false;
    this.debounceTimers = new Map();
    this.debounceDelay = 500; // 変更検知の遅延時間（ミリ秒）
    
    // 監視対象の設定ファイルパス
    this.watchPaths = this._getWatchPaths();
    
    // 即座に反映可能な設定項目
    this.hotReloadableSettings = new Set([
      'logLevel',
      'claude.timeout',
      'claude.maxRetries',
      'rateLimiter',
      'monitoring',
      'language',
      'projectSpecific',
      'processingOptions',
      'agentMonitoring',
      'dogfooding',
      'notification'
    ]);
    
    // 再起動が必要な設定項目
    this.restartRequiredSettings = new Set([
      'port',
      'workerCount',
      'maxConcurrentTasks',
      'security.enabled',
      'dashboard.port'
    ]);
  }

  /**
   * 監視対象のファイルパスを取得
   */
  _getWatchPaths() {
    const paths = [];
    
    // システムデフォルト設定
    paths.push(path.join(__dirname, '..', 'config', 'defaults.json'));
    paths.push(path.join(__dirname, '..', 'config', 'config.json'));
    
    // プロジェクト設定
    const projectConfigPath = path.join(process.cwd(), '.poppo', 'config.json');
    if (fs.existsSync(projectConfigPath)) {
      paths.push(projectConfigPath);
    }
    
    // グローバル設定
    const homeDir = process.env.HOME || process.env.USERPROFILE;
    if (homeDir) {
      const globalConfigPath = path.join(homeDir, '.poppo', 'config.json');
      if (fs.existsSync(globalConfigPath)) {
        paths.push(globalConfigPath);
      }
    }
    
    return paths;
  }

  /**
   * 設定の監視を開始
   */
  start() {
    if (this.isInitialized) {
      this.logger.warn('ConfigWatcher は既に初期化されています');
      return;
    }

    // 初期設定を読み込み
    try {
      this.currentConfig = this.configLoader.loadConfig();
      this.logger.info('初期設定を読み込みました');
    } catch (error) {
      this.logger.error('初期設定の読み込みに失敗しました:', error);
      throw error;
    }

    // 各設定ファイルの監視を開始
    for (const filePath of this.watchPaths) {
      this._watchFile(filePath);
    }

    this.isInitialized = true;
    this.logger.info(`ConfigWatcher が起動しました。監視対象: ${this.watchPaths.length} ファイル`);
  }

  /**
   * 個別ファイルの監視
   */
  _watchFile(filePath) {
    try {
      const watcher = fs.watch(filePath, (eventType, filename) => {
        if (eventType === 'change') {
          this._handleFileChange(filePath);
        }
      });

      this.watchers.set(filePath, watcher);
      this.logger.debug(`ファイル監視を開始: ${filePath}`);
    } catch (error) {
      this.logger.warn(`ファイル監視の設定に失敗: ${filePath}`, error.message);
    }
  }

  /**
   * ファイル変更の処理（デバウンス付き）
   */
  _handleFileChange(filePath) {
    // 既存のタイマーをクリア
    if (this.debounceTimers.has(filePath)) {
      clearTimeout(this.debounceTimers.get(filePath));
    }

    // 新しいタイマーを設定
    const timer = setTimeout(() => {
      this._processConfigChange(filePath);
      this.debounceTimers.delete(filePath);
    }, this.debounceDelay);

    this.debounceTimers.set(filePath, timer);
  }

  /**
   * 設定変更の処理
   */
  async _processConfigChange(filePath) {
    this.logger.info(`設定ファイルの変更を検知: ${filePath}`);

    try {
      // 新しい設定を読み込み
      const newConfig = this.configLoader.loadConfig();
      
      // 設定のバリデーション
      const validation = this.configLoader.validateConfig(newConfig);
      if (!validation.valid) {
        this.logger.error('新しい設定のバリデーションに失敗しました:', validation.errors);
        this.emit('validation-error', { filePath, errors: validation.errors });
        return;
      }

      // 変更点の検出
      const changes = this._detectChanges(this.currentConfig, newConfig);
      if (changes.length === 0) {
        this.logger.debug('設定に変更はありませんでした');
        return;
      }

      // 変更の分類
      const { hotReloadable, restartRequired, partialReloadable } = this._classifyChanges(changes);

      // 設定適用前の通知
      this.emit('before-reload', {
        filePath,
        changes,
        hotReloadable,
        restartRequired,
        partialReloadable
      });

      // ホットリロード可能な設定を適用
      if (hotReloadable.length > 0) {
        const previousConfig = { ...this.currentConfig };
        this.currentConfig = newConfig;
        
        try {
          this.emit('config-updated', {
            newConfig,
            previousConfig,
            changes: hotReloadable,
            source: filePath
          });
          
          this.logger.info(`設定を動的に更新しました: ${hotReloadable.map(c => c.path).join(', ')}`);
        } catch (error) {
          // ロールバック
          this.currentConfig = previousConfig;
          this.logger.error('設定の適用に失敗しました。ロールバックします。', error);
          this.emit('reload-error', { error, changes: hotReloadable });
          throw error;
        }
      }

      // 再起動が必要な設定の通知
      if (restartRequired.length > 0) {
        this.logger.warn('以下の設定変更にはプロセスの再起動が必要です:');
        restartRequired.forEach(change => {
          this.logger.warn(`  - ${change.path}: ${JSON.stringify(change.oldValue)} → ${JSON.stringify(change.newValue)}`);
        });
        
        this.emit('restart-required', {
          changes: restartRequired,
          source: filePath
        });
      }

      // 部分的な再起動で対応可能な設定の通知
      if (partialReloadable.length > 0) {
        this.emit('partial-reload-required', {
          changes: partialReloadable,
          source: filePath
        });
      }

    } catch (error) {
      this.logger.error('設定の再読み込みに失敗しました:', error);
      this.emit('reload-error', { error, filePath });
    }
  }

  /**
   * 設定の変更点を検出
   */
  _detectChanges(oldConfig, newConfig, basePath = '') {
    const changes = [];

    // 新旧設定のキーをマージ
    const allKeys = new Set([
      ...Object.keys(oldConfig || {}),
      ...Object.keys(newConfig || {})
    ]);

    for (const key of allKeys) {
      const currentPath = basePath ? `${basePath}.${key}` : key;
      const oldValue = oldConfig?.[key];
      const newValue = newConfig?.[key];

      if (typeof oldValue === 'object' && oldValue !== null &&
          typeof newValue === 'object' && newValue !== null &&
          !Array.isArray(oldValue) && !Array.isArray(newValue)) {
        // ネストされたオブジェクトの場合、再帰的に処理
        changes.push(...this._detectChanges(oldValue, newValue, currentPath));
      } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
        // 値が異なる場合
        changes.push({
          path: currentPath,
          oldValue,
          newValue
        });
      }
    }

    return changes;
  }

  /**
   * 変更を分類
   */
  _classifyChanges(changes) {
    const hotReloadable = [];
    const restartRequired = [];
    const partialReloadable = [];

    for (const change of changes) {
      const rootKey = change.path.split('.')[0];
      
      if (this.restartRequiredSettings.has(change.path) || 
          this.restartRequiredSettings.has(rootKey)) {
        restartRequired.push(change);
      } else if (this.hotReloadableSettings.has(change.path) || 
                 this.hotReloadableSettings.has(rootKey)) {
        hotReloadable.push(change);
      } else {
        partialReloadable.push(change);
      }
    }

    return { hotReloadable, restartRequired, partialReloadable };
  }

  /**
   * 現在の設定を取得
   */
  getConfig() {
    return this.currentConfig;
  }

  /**
   * 設定を手動で再読み込み
   */
  async reload() {
    this.logger.info('設定の手動再読み込みを実行します');
    
    try {
      const newConfig = this.configLoader.loadConfig();
      await this._processConfigChange('manual-reload');
      return { success: true, config: newConfig };
    } catch (error) {
      this.logger.error('手動再読み込みに失敗しました:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 監視を停止
   */
  stop() {
    // デバウンスタイマーをクリア
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // ファイル監視を停止
    for (const [filePath, watcher] of this.watchers) {
      watcher.close();
      this.logger.debug(`ファイル監視を停止: ${filePath}`);
    }
    this.watchers.clear();

    this.isInitialized = false;
    this.logger.info('ConfigWatcher を停止しました');
  }

  /**
   * 設定項目が即座に反映可能かチェック
   */
  isHotReloadable(settingPath) {
    const rootKey = settingPath.split('.')[0];
    return this.hotReloadableSettings.has(settingPath) || 
           this.hotReloadableSettings.has(rootKey);
  }

  /**
   * 設定項目が再起動を必要とするかチェック
   */
  requiresRestart(settingPath) {
    const rootKey = settingPath.split('.')[0];
    return this.restartRequiredSettings.has(settingPath) || 
           this.restartRequiredSettings.has(rootKey);
  }
}

module.exports = ConfigWatcher;