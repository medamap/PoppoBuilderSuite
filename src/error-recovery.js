/**
 * エラー分類と自動リカバリー戦略
 * エラーの種類に応じて適切なリカバリー処理を実行
 */

const EventEmitter = require('events');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const fs = require('fs').promises;
const path = require('path');

const { ErrorCodes, ErrorCategory } = require('./error-handler');

/**
 * リカバリーアクションの定義
 */
const RecoveryActions = {
  RETRY: 'retry',                    // リトライ
  EXPONENTIAL_BACKOFF: 'exponential_backoff', // 指数バックオフでリトライ
  RESET_CONNECTION: 'reset_connection',  // 接続リセット
  CLEAR_CACHE: 'clear_cache',           // キャッシュクリア
  RESTART_PROCESS: 'restart_process',   // プロセス再起動
  CLEANUP_RESOURCES: 'cleanup_resources', // リソースクリーンアップ
  NOTIFY_ADMIN: 'notify_admin',         // 管理者通知
  FALLBACK: 'fallback',                 // フォールバック処理
  IGNORE: 'ignore',                     // 無視
  MANUAL: 'manual'                      // 手動介入が必要
};

/**
 * リカバリー戦略
 */
class RecoveryStrategy {
  constructor(actions = [], options = {}) {
    this.actions = actions;
    this.options = {
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2,
      ...options
    };
  }
  
  /**
   * 戦略にアクションを追加
   */
  addAction(action, params = {}) {
    this.actions.push({ action, params });
    return this;
  }
}

/**
 * エラーリカバリーマネージャー
 */
class ErrorRecoveryManager extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      enableAutoRecovery: true,
      maxRecoveryAttempts: 3,
      recoveryTimeout: 300000, // 5分
      ...config
    };
    
    // リカバリー戦略マップ
    this.strategies = new Map();
    this.recoveryHistory = [];
    this.activeRecoveries = new Map();
    
    // デフォルトの戦略を登録
    this.registerDefaultStrategies();
  }
  
  /**
   * エラーから自動的にリカバリー
   */
  async recover(error, context = {}) {
    if (!this.config.enableAutoRecovery) {
      this.logger.warn('Auto recovery is disabled');
      return false;
    }
    
    const recoveryId = `${error.code}_${Date.now()}`;
    
    // すでにリカバリー中の場合はスキップ
    if (this.isRecovering(error.code)) {
      this.logger.warn(`Already recovering from ${error.code}`);
      return false;
    }
    
    // リカバリー開始を記録
    this.activeRecoveries.set(error.code, {
      id: recoveryId,
      startTime: new Date(),
      error: error,
      attempts: 0
    });
    
    try {
      // エラーコードに対応する戦略を取得
      const strategy = this.getStrategy(error);
      if (!strategy) {
        this.logger.warn(`No recovery strategy for error code: ${error.code}`);
        return false;
      }
      
      // リカバリーを実行
      const result = await this.executeStrategy(strategy, error, context);
      
      // 成功を記録
      this.recordRecovery(recoveryId, error, strategy, true, result);
      this.emit('recoverySuccess', { error, strategy, result });
      
      return true;
    } catch (recoveryError) {
      // 失敗を記録
      this.recordRecovery(recoveryId, error, null, false, recoveryError);
      this.emit('recoveryFailed', { error, recoveryError });
      
      return false;
    } finally {
      // アクティブリカバリーから削除
      this.activeRecoveries.delete(error.code);
    }
  }
  
  /**
   * リカバリー戦略を実行
   */
  async executeStrategy(strategy, error, context) {
    const results = [];
    
    for (const { action, params } of strategy.actions) {
      try {
        const result = await this.executeAction(action, error, context, params);
        results.push({ action, success: true, result });
        
        // アクションが成功したら次のアクションへ
        this.logger.info(`Recovery action ${action} succeeded`);
      } catch (actionError) {
        results.push({ action, success: false, error: actionError });
        
        // アクションが失敗したら戦略全体を失敗とする
        this.logger.error(`Recovery action ${action} failed:`, actionError);
        throw new Error(`Recovery strategy failed at action: ${action}`);
      }
    }
    
    return results;
  }
  
  /**
   * リカバリーアクションを実行
   */
  async executeAction(action, error, context, params = {}) {
    switch (action) {
      case RecoveryActions.RETRY:
        return await this.actionRetry(error, context, params);
        
      case RecoveryActions.EXPONENTIAL_BACKOFF:
        return await this.actionExponentialBackoff(error, context, params);
        
      case RecoveryActions.RESET_CONNECTION:
        return await this.actionResetConnection(error, context, params);
        
      case RecoveryActions.CLEAR_CACHE:
        return await this.actionClearCache(error, context, params);
        
      case RecoveryActions.RESTART_PROCESS:
        return await this.actionRestartProcess(error, context, params);
        
      case RecoveryActions.CLEANUP_RESOURCES:
        return await this.actionCleanupResources(error, context, params);
        
      case RecoveryActions.NOTIFY_ADMIN:
        return await this.actionNotifyAdmin(error, context, params);
        
      case RecoveryActions.FALLBACK:
        return await this.actionFallback(error, context, params);
        
      case RecoveryActions.IGNORE:
        return { ignored: true };
        
      case RecoveryActions.MANUAL:
        throw new Error('Manual intervention required');
        
      default:
        throw new Error(`Unknown recovery action: ${action}`);
    }
  }
  
  /**
   * リトライアクション
   */
  async actionRetry(error, context, params) {
    const { maxRetries = 3, retryDelay = 1000, operation } = params;
    
    if (!operation) {
      throw new Error('No operation provided for retry');
    }
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`Retry attempt ${attempt}/${maxRetries} for ${error.code}`);
        const result = await operation();
        return { attempts: attempt, result };
      } catch (retryError) {
        if (attempt === maxRetries) {
          throw retryError;
        }
        await this.delay(retryDelay);
      }
    }
  }
  
  /**
   * 指数バックオフアクション
   */
  async actionExponentialBackoff(error, context, params) {
    const {
      maxRetries = 3,
      initialDelay = 1000,
      multiplier = 2,
      maxDelay = 30000,
      operation
    } = params;
    
    if (!operation) {
      throw new Error('No operation provided for exponential backoff');
    }
    
    let delay = initialDelay;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.logger.info(`Exponential backoff attempt ${attempt}/${maxRetries} (delay: ${delay}ms)`);
        const result = await operation();
        return { attempts: attempt, totalDelay: delay * attempt, result };
      } catch (retryError) {
        if (attempt === maxRetries) {
          throw retryError;
        }
        
        await this.delay(delay);
        delay = Math.min(delay * multiplier, maxDelay);
      }
    }
  }
  
  /**
   * 接続リセットアクション
   */
  async actionResetConnection(error, context, params) {
    const { connectionManager, serviceName } = params;
    
    if (connectionManager && connectionManager.reset) {
      this.logger.info(`Resetting connection for ${serviceName || 'service'}`);
      await connectionManager.reset();
      return { reset: true, service: serviceName };
    }
    
    return { reset: false, reason: 'No connection manager provided' };
  }
  
  /**
   * キャッシュクリアアクション
   */
  async actionClearCache(error, context, params) {
    const { cachePath = 'cache', cacheManager } = params;
    
    if (cacheManager && cacheManager.clear) {
      this.logger.info('Clearing cache using cache manager');
      await cacheManager.clear();
      return { cleared: true, method: 'cacheManager' };
    }
    
    // ファイルシステムベースのキャッシュクリア
    try {
      await fs.rm(cachePath, { recursive: true, force: true });
      await fs.mkdir(cachePath, { recursive: true });
      this.logger.info(`Cleared cache directory: ${cachePath}`);
      return { cleared: true, method: 'filesystem', path: cachePath };
    } catch (clearError) {
      this.logger.error('Failed to clear cache:', clearError);
      return { cleared: false, error: clearError.message };
    }
  }
  
  /**
   * プロセス再起動アクション
   */
  async actionRestartProcess(error, context, params) {
    const { processName, gracefulShutdown = true, timeout = 5000 } = params;
    
    if (!processName) {
      throw new Error('Process name not provided');
    }
    
    try {
      if (gracefulShutdown) {
        // グレースフルシャットダウン
        await execAsync(`kill -TERM $(pgrep -f "${processName}")`);
        await this.delay(timeout);
      }
      
      // 強制終了
      await execAsync(`kill -KILL $(pgrep -f "${processName}") 2>/dev/null || true`);
      
      // 再起動（ここでは例として単純なコマンドを使用）
      // 実際の実装では、プロセスマネージャーを使用する
      this.logger.info(`Process ${processName} restarted`);
      
      return { restarted: true, processName };
    } catch (restartError) {
      throw new Error(`Failed to restart process: ${restartError.message}`);
    }
  }
  
  /**
   * リソースクリーンアップアクション
   */
  async actionCleanupResources(error, context, params) {
    const cleanupTasks = [];
    
    // メモリクリーンアップ
    if (params.cleanMemory !== false) {
      if (global.gc) {
        global.gc();
        cleanupTasks.push('memory_gc');
      }
    }
    
    // 一時ファイルクリーンアップ
    if (params.tempPath) {
      try {
        const tempFiles = await fs.readdir(params.tempPath);
        const now = Date.now();
        const maxAge = params.maxAge || 3600000; // 1時間
        
        for (const file of tempFiles) {
          const filePath = path.join(params.tempPath, file);
          const stats = await fs.stat(filePath);
          
          if (now - stats.mtimeMs > maxAge) {
            await fs.unlink(filePath);
            cleanupTasks.push(`temp_file:${file}`);
          }
        }
      } catch (cleanupError) {
        this.logger.error('Failed to cleanup temp files:', cleanupError);
      }
    }
    
    // カスタムクリーンアップ
    if (params.customCleanup && typeof params.customCleanup === 'function') {
      await params.customCleanup();
      cleanupTasks.push('custom_cleanup');
    }
    
    return { cleaned: cleanupTasks };
  }
  
  /**
   * 管理者通知アクション
   */
  async actionNotifyAdmin(error, context, params) {
    const { notificationManager, channel = 'error', priority = 'high' } = params;
    
    if (!notificationManager) {
      this.logger.warn('No notification manager provided');
      return { notified: false };
    }
    
    const message = {
      title: `Error Recovery Required: ${error.code}`,
      body: error.message,
      severity: error.severity,
      context: context,
      timestamp: new Date()
    };
    
    await notificationManager.send(channel, message, { priority });
    
    return { notified: true, channel, priority };
  }
  
  /**
   * フォールバックアクション
   */
  async actionFallback(error, context, params) {
    const { fallbackFunction, defaultValue } = params;
    
    if (fallbackFunction && typeof fallbackFunction === 'function') {
      const result = await fallbackFunction(error, context);
      return { fallback: 'function', result };
    }
    
    if (defaultValue !== undefined) {
      return { fallback: 'default', result: defaultValue };
    }
    
    return { fallback: 'none' };
  }
  
  /**
   * デフォルトのリカバリー戦略を登録
   */
  registerDefaultStrategies() {
    // ネットワークタイムアウト
    this.registerStrategy(ErrorCodes.NETWORK_TIMEOUT, new RecoveryStrategy([
      { action: RecoveryActions.EXPONENTIAL_BACKOFF, params: { maxRetries: 3 } },
      { action: RecoveryActions.RESET_CONNECTION, params: {} }
    ]));
    
    // API レート制限
    this.registerStrategy(ErrorCodes.API_RATE_LIMIT, new RecoveryStrategy([
      { action: RecoveryActions.EXPONENTIAL_BACKOFF, params: { 
        maxRetries: 5,
        initialDelay: 60000,
        multiplier: 1.5
      }}
    ]));
    
    // ネットワーク接続エラー
    this.registerStrategy(ErrorCodes.NETWORK_CONNECTION, new RecoveryStrategy([
      { action: RecoveryActions.RETRY, params: { maxRetries: 3, retryDelay: 2000 } },
      { action: RecoveryActions.RESET_CONNECTION, params: {} }
    ]));
    
    // システムリソースエラー
    this.registerStrategy(ErrorCodes.SYSTEM_RESOURCE, new RecoveryStrategy([
      { action: RecoveryActions.CLEANUP_RESOURCES, params: {} },
      { action: RecoveryActions.RETRY, params: { maxRetries: 2 } }
    ]));
    
    // ディスクフルエラー
    this.registerStrategy(ErrorCodes.SYSTEM_DISK_FULL, new RecoveryStrategy([
      { action: RecoveryActions.CLEANUP_RESOURCES, params: { cleanTempFiles: true } },
      { action: RecoveryActions.NOTIFY_ADMIN, params: { priority: 'critical' } }
    ]));
    
    // プロセスタイムアウト
    this.registerStrategy(ErrorCodes.PROCESS_TIMEOUT, new RecoveryStrategy([
      { action: RecoveryActions.RESTART_PROCESS, params: {} },
      { action: RecoveryActions.NOTIFY_ADMIN, params: {} }
    ]));
    
    // データ破損
    this.registerStrategy(ErrorCodes.DATA_CORRUPTION, new RecoveryStrategy([
      { action: RecoveryActions.FALLBACK, params: {} },
      { action: RecoveryActions.NOTIFY_ADMIN, params: { priority: 'critical' } }
    ]));
    
    // 権限エラー
    this.registerStrategy(ErrorCodes.SYSTEM_PERMISSION, new RecoveryStrategy([
      { action: RecoveryActions.NOTIFY_ADMIN, params: { priority: 'high' } },
      { action: RecoveryActions.MANUAL, params: {} }
    ]));
  }
  
  /**
   * カスタムリカバリー戦略を登録
   */
  registerStrategy(errorCode, strategy) {
    this.strategies.set(errorCode, strategy);
  }
  
  /**
   * エラーに対応する戦略を取得
   */
  getStrategy(error) {
    // エラーコードで直接マッチ
    if (this.strategies.has(error.code)) {
      return this.strategies.get(error.code);
    }
    
    // カテゴリベースのデフォルト戦略
    switch (error.category) {
      case ErrorCategory.TRANSIENT:
        return new RecoveryStrategy([
          { action: RecoveryActions.EXPONENTIAL_BACKOFF, params: { maxRetries: 3 } }
        ]);
        
      case ErrorCategory.RECOVERABLE:
        return new RecoveryStrategy([
          { action: RecoveryActions.RETRY, params: { maxRetries: 2 } },
          { action: RecoveryActions.CLEANUP_RESOURCES, params: {} }
        ]);
        
      case ErrorCategory.PERMANENT:
        return new RecoveryStrategy([
          { action: RecoveryActions.NOTIFY_ADMIN, params: {} }
        ]);
        
      case ErrorCategory.FATAL:
        return new RecoveryStrategy([
          { action: RecoveryActions.NOTIFY_ADMIN, params: { priority: 'critical' } },
          { action: RecoveryActions.MANUAL, params: {} }
        ]);
        
      default:
        return null;
    }
  }
  
  /**
   * リカバリー中かチェック
   */
  isRecovering(errorCode) {
    return this.activeRecoveries.has(errorCode);
  }
  
  /**
   * リカバリー履歴を記録
   */
  recordRecovery(id, error, strategy, success, result) {
    const recovery = {
      id,
      timestamp: new Date(),
      error: {
        code: error.code,
        message: error.message,
        category: error.category
      },
      strategy: strategy ? strategy.actions.map(a => a.action) : null,
      success,
      result: success ? result : result?.message || 'Unknown error',
      duration: this.activeRecoveries.has(error.code) ?
        Date.now() - this.activeRecoveries.get(error.code).startTime.getTime() : 0
    };
    
    this.recoveryHistory.push(recovery);
    
    // 履歴を制限（最新1000件）
    if (this.recoveryHistory.length > 1000) {
      this.recoveryHistory.shift();
    }
  }
  
  /**
   * リカバリー統計を取得
   */
  getStats() {
    const stats = {
      total: this.recoveryHistory.length,
      successful: 0,
      failed: 0,
      byErrorCode: {},
      byAction: {},
      averageDuration: 0,
      recentRecoveries: []
    };
    
    let totalDuration = 0;
    
    for (const recovery of this.recoveryHistory) {
      if (recovery.success) {
        stats.successful++;
      } else {
        stats.failed++;
      }
      
      // エラーコード別統計
      stats.byErrorCode[recovery.error.code] = stats.byErrorCode[recovery.error.code] || {
        total: 0,
        successful: 0,
        failed: 0
      };
      stats.byErrorCode[recovery.error.code].total++;
      if (recovery.success) {
        stats.byErrorCode[recovery.error.code].successful++;
      } else {
        stats.byErrorCode[recovery.error.code].failed++;
      }
      
      // アクション別統計
      if (recovery.strategy) {
        for (const action of recovery.strategy) {
          stats.byAction[action] = (stats.byAction[action] || 0) + 1;
        }
      }
      
      totalDuration += recovery.duration;
    }
    
    stats.averageDuration = stats.total > 0 ? totalDuration / stats.total : 0;
    stats.recentRecoveries = this.recoveryHistory.slice(-10).reverse();
    stats.activeRecoveries = Array.from(this.activeRecoveries.values());
    
    return stats;
  }
  
  /**
   * 遅延ユーティリティ
   */
  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = {
  ErrorRecoveryManager,
  RecoveryStrategy,
  RecoveryActions
};