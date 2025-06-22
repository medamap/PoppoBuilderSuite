/**
 * 統一的なエラーハンドリングフレームワーク
 * エラーの分類、重要度、リカバリー可能性を管理
 */

const EventEmitter = require('events');
const fs = require('fs').promises;
const path = require('path');

// エラーコードの定義
const ErrorCodes = {
  // ネットワーク関連
  NETWORK_TIMEOUT: 'E_NETWORK_TIMEOUT',
  NETWORK_CONNECTION: 'E_NETWORK_CONNECTION',
  API_RATE_LIMIT: 'E_API_RATE_LIMIT',
  API_UNAUTHORIZED: 'E_API_UNAUTHORIZED',
  API_NOT_FOUND: 'E_API_NOT_FOUND',
  
  // システム関連
  SYSTEM_RESOURCE: 'E_SYSTEM_RESOURCE',
  SYSTEM_PERMISSION: 'E_SYSTEM_PERMISSION',
  SYSTEM_FILE_NOT_FOUND: 'E_SYSTEM_FILE_NOT_FOUND',
  SYSTEM_DISK_FULL: 'E_SYSTEM_DISK_FULL',
  
  // プロセス関連
  PROCESS_TIMEOUT: 'E_PROCESS_TIMEOUT',
  PROCESS_CRASHED: 'E_PROCESS_CRASHED',
  PROCESS_KILLED: 'E_PROCESS_KILLED',
  
  // 設定関連
  CONFIG_INVALID: 'E_CONFIG_INVALID',
  CONFIG_MISSING: 'E_CONFIG_MISSING',
  
  // データ関連
  DATA_CORRUPTION: 'E_DATA_CORRUPTION',
  DATA_VALIDATION: 'E_DATA_VALIDATION',
  
  // ビジネスロジック関連
  BUSINESS_LOGIC: 'E_BUSINESS_LOGIC',
  INVALID_STATE: 'E_INVALID_STATE',
  
  // 不明なエラー
  UNKNOWN: 'E_UNKNOWN'
};

// エラーの重要度
const ErrorSeverity = {
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical'
};

// エラーカテゴリ
const ErrorCategory = {
  TRANSIENT: 'transient',      // 一時的なエラー（リトライ可能）
  PERMANENT: 'permanent',      // 永続的なエラー（設定ミス等）
  RECOVERABLE: 'recoverable',  // リカバリー可能なエラー
  FATAL: 'fatal'              // 致命的なエラー
};

/**
 * 基本エラークラス
 */
class BaseError extends Error {
  constructor(message, code = ErrorCodes.UNKNOWN, options = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.severity = options.severity || ErrorSeverity.MEDIUM;
    this.category = options.category || ErrorCategory.PERMANENT;
    this.context = options.context || {};
    this.timestamp = new Date();
    this.retryable = options.retryable !== undefined ? options.retryable : this.category === ErrorCategory.TRANSIENT;
    this.recoverable = options.recoverable !== undefined ? options.recoverable : this.category === ErrorCategory.RECOVERABLE;
    
    // スタックトレースを保持
    Error.captureStackTrace(this, this.constructor);
  }
  
  /**
   * エラーのJSON表現を取得
   */
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      severity: this.severity,
      category: this.category,
      context: this.context,
      timestamp: this.timestamp,
      retryable: this.retryable,
      recoverable: this.recoverable,
      stack: this.stack
    };
  }
}

/**
 * ネットワークエラー
 */
class NetworkError extends BaseError {
  constructor(message, options = {}) {
    super(message, ErrorCodes.NETWORK_CONNECTION, {
      severity: ErrorSeverity.MEDIUM,
      category: ErrorCategory.TRANSIENT,
      retryable: true,
      ...options
    });
  }
}

/**
 * APIエラー
 */
class APIError extends BaseError {
  constructor(message, statusCode, options = {}) {
    let code = ErrorCodes.UNKNOWN;
    let category = ErrorCategory.PERMANENT;
    let severity = ErrorSeverity.MEDIUM;
    let retryable = false;
    
    // ステータスコードに基づいてエラーを分類
    switch (statusCode) {
      case 401:
        code = ErrorCodes.API_UNAUTHORIZED;
        severity = ErrorSeverity.HIGH;
        break;
      case 404:
        code = ErrorCodes.API_NOT_FOUND;
        severity = ErrorSeverity.LOW;
        break;
      case 429:
        code = ErrorCodes.API_RATE_LIMIT;
        category = ErrorCategory.TRANSIENT;
        retryable = true;
        break;
      case 500:
      case 502:
      case 503:
      case 504:
        code = ErrorCodes.NETWORK_CONNECTION;
        category = ErrorCategory.TRANSIENT;
        retryable = true;
        break;
    }
    
    super(message, code, {
      severity,
      category,
      retryable,
      context: { statusCode },
      ...options
    });
  }
}

/**
 * システムエラー
 */
class SystemError extends BaseError {
  constructor(message, systemError, options = {}) {
    let code = ErrorCodes.SYSTEM_RESOURCE;
    let severity = ErrorSeverity.HIGH;
    let category = ErrorCategory.PERMANENT;
    
    // システムエラーコードに基づいて分類
    if (systemError) {
      switch (systemError.code) {
        case 'ENOENT':
          code = ErrorCodes.SYSTEM_FILE_NOT_FOUND;
          severity = ErrorSeverity.MEDIUM;
          break;
        case 'EACCES':
        case 'EPERM':
          code = ErrorCodes.SYSTEM_PERMISSION;
          severity = ErrorSeverity.HIGH;
          break;
        case 'ENOSPC':
          code = ErrorCodes.SYSTEM_DISK_FULL;
          severity = ErrorSeverity.CRITICAL;
          break;
        case 'ETIMEDOUT':
          code = ErrorCodes.NETWORK_TIMEOUT;
          category = ErrorCategory.TRANSIENT;
          break;
      }
    }
    
    super(message, code, {
      severity,
      category,
      context: { systemError: systemError?.code },
      ...options
    });
  }
}

/**
 * プロセスエラー
 */
class ProcessError extends BaseError {
  constructor(message, processInfo, options = {}) {
    const code = processInfo.timeout ? ErrorCodes.PROCESS_TIMEOUT :
                processInfo.killed ? ErrorCodes.PROCESS_KILLED :
                ErrorCodes.PROCESS_CRASHED;
    
    super(message, code, {
      severity: ErrorSeverity.HIGH,
      category: ErrorCategory.RECOVERABLE,
      recoverable: true,
      context: processInfo,
      ...options
    });
  }
}

/**
 * 設定エラー
 */
class ConfigError extends BaseError {
  constructor(message, options = {}) {
    super(message, ErrorCodes.CONFIG_INVALID, {
      severity: ErrorSeverity.HIGH,
      category: ErrorCategory.PERMANENT,
      retryable: false,
      recoverable: false,
      ...options
    });
  }
}

/**
 * データエラー
 */
class DataError extends BaseError {
  constructor(message, options = {}) {
    super(message, ErrorCodes.DATA_VALIDATION, {
      severity: ErrorSeverity.MEDIUM,
      category: ErrorCategory.PERMANENT,
      ...options
    });
  }
}

/**
 * ビジネスロジックエラー
 */
class BusinessError extends BaseError {
  constructor(message, options = {}) {
    super(message, ErrorCodes.BUSINESS_LOGIC, {
      severity: ErrorSeverity.MEDIUM,
      category: ErrorCategory.PERMANENT,
      ...options
    });
  }
}

/**
 * エラーハンドラークラス
 */
class ErrorHandler extends EventEmitter {
  constructor(logger, config = {}) {
    super();
    this.logger = logger;
    this.config = {
      maxErrorHistory: 1000,
      errorFile: 'logs/errors.json',
      enableStackTrace: true,
      ...config
    };
    
    this.errorHistory = [];
    this.errorStats = new Map();
    this.handlers = new Map();
    
    // デフォルトのエラーハンドラーを登録
    this.registerDefaultHandlers();
  }
  
  /**
   * エラーを処理
   */
  async handleError(error, context = {}) {
    // BaseErrorでない場合は変換
    if (!(error instanceof BaseError)) {
      error = this.wrapError(error);
    }
    
    // コンテキストを追加
    error.context = { ...error.context, ...context };
    
    // エラー履歴に追加
    this.addToHistory(error);
    
    // 統計を更新
    this.updateStats(error);
    
    // ログに記録
    this.logError(error);
    
    // イベントを発行
    this.emit('error', error);
    this.emit(`error:${error.code}`, error);
    
    // カスタムハンドラーを実行
    const handler = this.handlers.get(error.code) || this.handlers.get('default');
    if (handler) {
      try {
        await handler(error);
      } catch (handlerError) {
        this.logger.error('Error in error handler:', handlerError);
      }
    }
    
    // エラーファイルに保存
    await this.saveErrors();
    
    return error;
  }
  
  /**
   * 通常のエラーをBaseErrorにラップ
   */
  wrapError(error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM' || error.code === 'ENOSPC') {
      return new SystemError(error.message, error);
    }
    
    if (error.statusCode) {
      return new APIError(error.message, error.statusCode, { context: { originalError: error } });
    }
    
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return new NetworkError(error.message, { context: { originalError: error } });
    }
    
    return new BaseError(error.message, ErrorCodes.UNKNOWN, {
      context: { originalError: error },
      severity: ErrorSeverity.MEDIUM,
      category: ErrorCategory.PERMANENT
    });
  }
  
  /**
   * エラー履歴に追加
   */
  addToHistory(error) {
    this.errorHistory.push(error.toJSON());
    
    // 最大数を超えたら古いものを削除
    if (this.errorHistory.length > this.config.maxErrorHistory) {
      this.errorHistory.shift();
    }
  }
  
  /**
   * エラー統計を更新
   */
  updateStats(error) {
    const key = error.code;
    const stats = this.errorStats.get(key) || {
      count: 0,
      firstOccurrence: error.timestamp,
      lastOccurrence: error.timestamp,
      severityCounts: {}
    };
    
    stats.count++;
    stats.lastOccurrence = error.timestamp;
    stats.severityCounts[error.severity] = (stats.severityCounts[error.severity] || 0) + 1;
    
    this.errorStats.set(key, stats);
  }
  
  /**
   * エラーをログに記録
   */
  logError(error) {
    const logMessage = `[${error.code}] ${error.message}`;
    const logContext = {
      code: error.code,
      severity: error.severity,
      category: error.category,
      retryable: error.retryable,
      recoverable: error.recoverable,
      context: error.context
    };
    
    // 重要度に応じてログレベルを変更
    switch (error.severity) {
      case ErrorSeverity.LOW:
        this.logger.warn(logMessage, logContext);
        break;
      case ErrorSeverity.MEDIUM:
        this.logger.error(logMessage, logContext);
        break;
      case ErrorSeverity.HIGH:
      case ErrorSeverity.CRITICAL:
        this.logger.error(`[${error.severity.toUpperCase()}] ${logMessage}`, logContext);
        if (this.config.enableStackTrace && error.stack) {
          this.logger.error('Stack trace:', error.stack);
        }
        break;
    }
  }
  
  /**
   * カスタムエラーハンドラーを登録
   */
  registerHandler(errorCode, handler) {
    this.handlers.set(errorCode, handler);
  }
  
  /**
   * デフォルトのエラーハンドラーを登録
   */
  registerDefaultHandlers() {
    // デフォルトハンドラー
    this.registerHandler('default', async (error) => {
      // 何もしない（ログは既に記録済み）
    });
    
    // レート制限エラーのハンドラー
    this.registerHandler(ErrorCodes.API_RATE_LIMIT, async (error) => {
      this.emit('rateLimitExceeded', error);
    });
    
    // ディスクフルエラーのハンドラー
    this.registerHandler(ErrorCodes.SYSTEM_DISK_FULL, async (error) => {
      this.emit('diskFull', error);
    });
  }
  
  /**
   * エラー履歴をファイルに保存
   */
  async saveErrors() {
    try {
      const errorData = {
        timestamp: new Date(),
        errors: this.errorHistory.slice(-100), // 最新100件のみ保存
        stats: Object.fromEntries(this.errorStats)
      };
      
      await fs.mkdir(path.dirname(this.config.errorFile), { recursive: true });
      await fs.writeFile(
        this.config.errorFile,
        JSON.stringify(errorData, null, 2)
      );
    } catch (error) {
      this.logger.error('Failed to save error history:', error);
    }
  }
  
  /**
   * エラー履歴を読み込み
   */
  async loadErrors() {
    try {
      const data = await fs.readFile(this.config.errorFile, 'utf-8');
      const errorData = JSON.parse(data);
      
      this.errorHistory = errorData.errors || [];
      this.errorStats = new Map(Object.entries(errorData.stats || {}));
    } catch (error) {
      // ファイルが存在しない場合は無視
      if (error.code !== 'ENOENT') {
        this.logger.error('Failed to load error history:', error);
      }
    }
  }
  
  /**
   * エラー統計を取得
   */
  getStats() {
    const stats = {
      total: 0,
      byCode: {},
      bySeverity: {},
      byCategory: {},
      recent: []
    };
    
    // エラーコード別統計
    for (const [code, codeStats] of this.errorStats) {
      stats.byCode[code] = codeStats;
      stats.total += codeStats.count;
    }
    
    // 重要度別・カテゴリ別統計を計算
    for (const error of this.errorHistory) {
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
      stats.byCategory[error.category] = (stats.byCategory[error.category] || 0) + 1;
    }
    
    // 最近のエラー（最新10件）
    stats.recent = this.errorHistory.slice(-10).reverse();
    
    return stats;
  }
  
  /**
   * エラー履歴をクリア
   */
  clearHistory() {
    this.errorHistory = [];
    this.errorStats.clear();
  }
}

module.exports = {
  ErrorHandler,
  BaseError,
  NetworkError,
  APIError,
  SystemError,
  ProcessError,
  ConfigError,
  DataError,
  BusinessError,
  ErrorCodes,
  ErrorSeverity,
  ErrorCategory
};