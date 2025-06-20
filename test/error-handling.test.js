/**
 * エラーハンドリングとリカバリー戦略のテスト
 */

const assert = require('assert');
const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const {
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
} = require('../src/error-handler');

const {
  CircuitBreaker,
  CircuitBreakerFactory,
  CircuitState
} = require('../src/circuit-breaker');

const {
  ErrorRecoveryManager,
  RecoveryStrategy,
  RecoveryActions
} = require('../src/error-recovery');

const ErrorReporter = require('../src/error-reporter');

// モックLogger
class MockLogger {
  constructor() {
    this.logs = [];
  }
  
  log(level, message, context = {}) {
    this.logs.push({ level, message, context, timestamp: new Date() });
  }
  
  info(message, context) { this.log('info', message, context); }
  warn(message, context) { this.log('warn', message, context); }
  error(message, context) { this.log('error', message, context); }
  
  getLogs(level) {
    return level ? this.logs.filter(log => log.level === level) : this.logs;
  }
  
  clear() {
    this.logs = [];
  }
}

describe('Error Handling Framework', () => {
  let logger;
  let tempDir;
  
  beforeEach(async () => {
    logger = new MockLogger();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'poppo-error-test-'));
  });
  
  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // テンポラリディレクトリの削除に失敗しても無視
    }
  });
  
  describe('BaseError', () => {
    it('should create error with basic properties', () => {
      const error = new BaseError('Test error');
      
      assert.strictEqual(error.message, 'Test error');
      assert.strictEqual(error.code, ErrorCodes.UNKNOWN);
      assert.strictEqual(error.severity, ErrorSeverity.MEDIUM);
      assert.strictEqual(error.category, ErrorCategory.PERMANENT);
      assert.ok(error.timestamp instanceof Date);
    });
    
    it('should create error with custom properties', () => {
      const error = new BaseError('Custom error', ErrorCodes.NETWORK_TIMEOUT, {
        severity: ErrorSeverity.HIGH,
        category: ErrorCategory.TRANSIENT,
        context: { details: 'test' }
      });
      
      assert.strictEqual(error.code, ErrorCodes.NETWORK_TIMEOUT);
      assert.strictEqual(error.severity, ErrorSeverity.HIGH);
      assert.strictEqual(error.category, ErrorCategory.TRANSIENT);
      assert.deepStrictEqual(error.context, { details: 'test' });
      assert.strictEqual(error.retryable, true);
    });
    
    it('should convert to JSON properly', () => {
      const error = new BaseError('JSON test', ErrorCodes.API_RATE_LIMIT);
      const json = error.toJSON();
      
      assert.ok(json.name);
      assert.ok(json.message);
      assert.ok(json.code);
      assert.ok(json.timestamp);
      assert.ok(json.stack);
    });
  });
  
  describe('Specialized Error Classes', () => {
    it('should create NetworkError correctly', () => {
      const error = new NetworkError('Connection failed');
      
      assert.strictEqual(error.code, ErrorCodes.NETWORK_CONNECTION);
      assert.strictEqual(error.category, ErrorCategory.TRANSIENT);
      assert.strictEqual(error.retryable, true);
    });
    
    it('should create APIError with status code mapping', () => {
      const rateLimitError = new APIError('Rate limited', 429);
      assert.strictEqual(rateLimitError.code, ErrorCodes.API_RATE_LIMIT);
      assert.strictEqual(rateLimitError.retryable, true);
      
      const unauthorizedError = new APIError('Unauthorized', 401);
      assert.strictEqual(unauthorizedError.code, ErrorCodes.API_UNAUTHORIZED);
      assert.strictEqual(unauthorizedError.severity, ErrorSeverity.HIGH);
      
      const serverError = new APIError('Server error', 500);
      assert.strictEqual(serverError.code, ErrorCodes.NETWORK_CONNECTION);
      assert.strictEqual(serverError.retryable, true);
    });
    
    it('should create SystemError with system error mapping', () => {
      const enoentError = new SystemError('File not found', { code: 'ENOENT' });
      assert.strictEqual(enoentError.code, ErrorCodes.SYSTEM_FILE_NOT_FOUND);
      
      const diskFullError = new SystemError('Disk full', { code: 'ENOSPC' });
      assert.strictEqual(diskFullError.code, ErrorCodes.SYSTEM_DISK_FULL);
      assert.strictEqual(diskFullError.severity, ErrorSeverity.CRITICAL);
    });
  });
  
  describe('ErrorHandler', () => {
    let errorHandler;
    
    beforeEach(() => {
      errorHandler = new ErrorHandler(logger, {
        errorFile: path.join(tempDir, 'errors.json')
      });
    });
    
    it('should handle and log errors', async () => {
      const error = new BaseError('Test error');
      await errorHandler.handleError(error);
      
      const errorLogs = logger.getLogs('error');
      assert.strictEqual(errorLogs.length, 1);
      assert.ok(errorLogs[0].message.includes('Test error'));
    });
    
    it('should wrap native errors', async () => {
      const nativeError = new Error('Native error');
      nativeError.code = 'ENOENT';
      
      const wrappedError = await errorHandler.handleError(nativeError);
      assert.ok(wrappedError instanceof SystemError);
      assert.strictEqual(wrappedError.code, ErrorCodes.SYSTEM_FILE_NOT_FOUND);
    });
    
    it('should maintain error statistics', async () => {
      await errorHandler.handleError(new NetworkError('Network error 1'));
      await errorHandler.handleError(new NetworkError('Network error 2'));
      await errorHandler.handleError(new APIError('API error', 500));
      
      const stats = errorHandler.getStats();
      assert.strictEqual(stats.total, 3);
      assert.strictEqual(stats.byCategory[ErrorCategory.TRANSIENT], 3);
    });
    
    it('should save and load error history', async () => {
      await errorHandler.handleError(new BaseError('Test error'));
      await errorHandler.saveErrors();
      
      const newHandler = new ErrorHandler(logger, {
        errorFile: path.join(tempDir, 'errors.json')
      });
      await newHandler.loadErrors();
      
      const stats = newHandler.getStats();
      assert.strictEqual(stats.total, 1);
    });
    
    it('should emit events for errors', (done) => {
      const error = new BaseError('Event test', ErrorCodes.API_RATE_LIMIT);
      
      errorHandler.once('error:E_API_RATE_LIMIT', (emittedError) => {
        assert.strictEqual(emittedError.code, ErrorCodes.API_RATE_LIMIT);
        done();
      });
      
      errorHandler.handleError(error);
    });
  });
  
  describe('CircuitBreaker', () => {
    let circuitBreaker;
    
    beforeEach(() => {
      circuitBreaker = new CircuitBreaker('test-service', {
        failureThreshold: 3,
        successThreshold: 2,
        timeout: 100,
        resetTimeout: 500
      });
    });
    
    it('should start in CLOSED state', () => {
      assert.strictEqual(circuitBreaker.getState(), CircuitState.CLOSED);
      assert.strictEqual(circuitBreaker.isClosed(), true);
    });
    
    it('should execute successful operations', async () => {
      const result = await circuitBreaker.execute(() => Promise.resolve('success'));
      assert.strictEqual(result, 'success');
      
      const stats = circuitBreaker.getStats();
      assert.strictEqual(stats.stats.successes, 1);
    });
    
    it('should track failed operations', async () => {
      try {
        await circuitBreaker.execute(() => Promise.reject(new Error('failure')));
        assert.fail('Should have thrown error');
      } catch (error) {
        assert.strictEqual(error.message, 'failure');
      }
      
      const stats = circuitBreaker.getStats();
      assert.strictEqual(stats.stats.failures, 1);
    });
    
    it('should open circuit after failure threshold', async () => {
      // 閾値まで失敗させる
      for (let i = 0; i < 3; i++) {
        try {
          await circuitBreaker.execute(() => Promise.reject(new Error('failure')));
        } catch (error) {
          // 期待される失敗
        }
      }
      
      assert.strictEqual(circuitBreaker.getState(), CircuitState.OPEN);
    });
    
    it('should reject requests when circuit is open', async () => {
      // サーキットを開く
      circuitBreaker.open();
      
      try {
        await circuitBreaker.execute(() => Promise.resolve('success'));
        assert.fail('Should have rejected request');
      } catch (error) {
        assert.strictEqual(error.code, 'CIRCUIT_OPEN');
      }
    });
    
    it('should use fallback when provided', async () => {
      circuitBreaker.open();
      
      const result = await circuitBreaker.execute(
        () => Promise.resolve('success'),
        () => 'fallback'
      );
      
      assert.strictEqual(result, 'fallback');
    });
    
    it('should transition to HALF_OPEN after reset timeout', (done) => {
      circuitBreaker.open();
      
      setTimeout(() => {
        assert.strictEqual(circuitBreaker.getState(), CircuitState.HALF_OPEN);
        done();
      }, 600);
    });
    
    it('should close circuit after successful recoveries in HALF_OPEN', async () => {
      circuitBreaker.halfOpen();
      
      // 成功閾値まで成功させる
      for (let i = 0; i < 2; i++) {
        await circuitBreaker.execute(() => Promise.resolve('success'));
      }
      
      assert.strictEqual(circuitBreaker.getState(), CircuitState.CLOSED);
    });
  });
  
  describe('CircuitBreakerFactory', () => {
    let factory;
    
    beforeEach(() => {
      factory = new CircuitBreakerFactory();
    });
    
    it('should create and cache circuit breakers', () => {
      const breaker1 = factory.create('service1');
      const breaker2 = factory.create('service1');
      
      assert.strictEqual(breaker1, breaker2);
      assert.strictEqual(breaker1.name, 'service1');
    });
    
    it('should create different breakers for different names', () => {
      const breaker1 = factory.create('service1');
      const breaker2 = factory.create('service2');
      
      assert.notStrictEqual(breaker1, breaker2);
    });
    
    it('should get all breakers', () => {
      factory.create('service1');
      factory.create('service2');
      
      const all = factory.getAll();
      assert.strictEqual(all.length, 2);
    });
  });
  
  describe('ErrorRecoveryManager', () => {
    let recoveryManager;
    
    beforeEach(() => {
      recoveryManager = new ErrorRecoveryManager(logger);
    });
    
    it('should recover from transient errors', async () => {
      const error = new NetworkError('Connection failed');
      let attempts = 0;
      
      // カスタム戦略を登録
      recoveryManager.registerStrategy(ErrorCodes.NETWORK_CONNECTION, new RecoveryStrategy([
        {
          action: RecoveryActions.RETRY,
          params: {
            maxRetries: 2,
            operation: () => {
              attempts++;
              if (attempts < 2) {
                throw new Error('Still failing');
              }
              return 'success';
            }
          }
        }
      ]));
      
      const result = await recoveryManager.recover(error);
      assert.strictEqual(result, true);
      assert.strictEqual(attempts, 2);
    });
    
    it('should use exponential backoff', async () => {
      const error = new APIError('Rate limited', 429);
      const startTime = Date.now();
      let attempts = 0;
      
      recoveryManager.registerStrategy(ErrorCodes.API_RATE_LIMIT, new RecoveryStrategy([
        {
          action: RecoveryActions.EXPONENTIAL_BACKOFF,
          params: {
            maxRetries: 2,
            initialDelay: 100,
            multiplier: 2,
            operation: () => {
              attempts++;
              if (attempts < 2) {
                throw new Error('Still rate limited');
              }
              return 'success';
            }
          }
        }
      ]));
      
      const result = await recoveryManager.recover(error);
      const elapsed = Date.now() - startTime;
      
      assert.strictEqual(result, true);
      assert.ok(elapsed >= 100); // 最低でも初期遅延分は待つ
    });
    
    it('should track recovery statistics', async () => {
      const error1 = new NetworkError('Error 1');
      const error2 = new NetworkError('Error 2');
      
      await recoveryManager.recover(error1);
      await recoveryManager.recover(error2);
      
      const stats = recoveryManager.getStats();
      assert.ok(stats.total >= 2);
    });
    
    it('should prevent concurrent recovery for same error code', async () => {
      const error = new NetworkError('Concurrent test');
      
      // 長時間かかるリカバリーを設定
      recoveryManager.registerStrategy(ErrorCodes.NETWORK_CONNECTION, new RecoveryStrategy([
        {
          action: RecoveryActions.RETRY,
          params: {
            maxRetries: 1,
            operation: () => new Promise(resolve => setTimeout(resolve, 1000))
          }
        }
      ]));
      
      // 同時に2つのリカバリーを開始
      const promise1 = recoveryManager.recover(error);
      const promise2 = recoveryManager.recover(error);
      
      const [result1, result2] = await Promise.all([promise1, promise2]);
      
      // 一方は成功、もう一方はスキップされるはず
      assert.ok(result1 !== result2);
    });
  });
  
  describe('ErrorReporter', () => {
    let errorHandler;
    let recoveryManager;
    let reporter;
    
    beforeEach(() => {
      errorHandler = new ErrorHandler(logger, {
        errorFile: path.join(tempDir, 'errors.json')
      });
      recoveryManager = new ErrorRecoveryManager(logger);
      reporter = new ErrorReporter(errorHandler, recoveryManager, {
        reportPath: tempDir
      });
    });
    
    it('should generate JSON report', async () => {
      // テストデータを追加
      await errorHandler.handleError(new NetworkError('Network error'));
      await errorHandler.handleError(new APIError('API error', 500));
      
      const result = await reporter.generateReport({ format: 'json' });
      
      assert.strictEqual(result.format, 'json');
      assert.ok(result.path);
      
      // レポートファイルが作成されているか確認
      const reportContent = await fs.readFile(result.path, 'utf-8');
      const report = JSON.parse(reportContent);
      
      assert.ok(report.metadata);
      assert.ok(report.summary);
      assert.ok(report.topErrors);
    });
    
    it('should generate markdown report', async () => {
      await errorHandler.handleError(new NetworkError('Test error'));
      
      const result = await reporter.generateReport({ format: 'markdown' });
      
      assert.strictEqual(result.format, 'markdown');
      
      const content = await fs.readFile(result.path, 'utf-8');
      assert.ok(content.includes('# Error Report'));
      assert.ok(content.includes('## Summary'));
    });
    
    it('should generate recommendations', async () => {
      // 高頻度エラーを作成
      for (let i = 0; i < 15; i++) {
        await errorHandler.handleError(new APIError('Rate limit', 429));
      }
      
      const result = await reporter.generateReport({ format: 'json' });
      const reportContent = await fs.readFile(result.path, 'utf-8');
      const report = JSON.parse(reportContent);
      
      assert.ok(report.recommendations);
      assert.ok(report.recommendations.length > 0);
      
      // レート制限に関する推奨事項があるはず
      const rateLimitRec = report.recommendations.find(rec =>
        rec.type === 'error_frequency' && rec.title.includes('E_API_RATE_LIMIT')
      );
      assert.ok(rateLimitRec);
    });
    
    it('should analyze error trends', async () => {
      // 複数のエラーを時間をずらして追加
      await errorHandler.handleError(new NetworkError('Error 1'));
      await new Promise(resolve => setTimeout(resolve, 10));
      await errorHandler.handleError(new NetworkError('Error 2'));
      await errorHandler.handleError(new APIError('API Error', 500));
      
      const result = await reporter.generateReport({ format: 'json' });
      const reportContent = await fs.readFile(result.path, 'utf-8');
      const report = JSON.parse(reportContent);
      
      assert.ok(report.trends);
      assert.ok(['stable', 'increasing', 'decreasing'].includes(report.trends.errorTrend));
    });
  });
  
  describe('Integration Tests', () => {
    let errorHandler;
    let recoveryManager;
    let circuitBreakerFactory;
    
    beforeEach(() => {
      errorHandler = new ErrorHandler(logger);
      recoveryManager = new ErrorRecoveryManager(logger);
      circuitBreakerFactory = new CircuitBreakerFactory();
    });
    
    it('should integrate error handling with circuit breaker', async () => {
      const circuitBreaker = circuitBreakerFactory.create('test-service');
      let callCount = 0;
      
      const flakyOperation = () => {
        callCount++;
        if (callCount <= 3) {
          throw new NetworkError('Network failure');
        }
        return 'success';
      };
      
      // サーキットブレーカーでフォールバック付き実行
      try {
        await circuitBreaker.execute(flakyOperation, () => 'fallback');
      } catch (error) {
        await errorHandler.handleError(error);
      }
      
      // 複数回実行してサーキットが開くかテスト
      for (let i = 0; i < 5; i++) {
        try {
          await circuitBreaker.execute(flakyOperation, () => 'fallback');
        } catch (error) {
          await errorHandler.handleError(error);
        }
      }
      
      assert.strictEqual(circuitBreaker.getState(), CircuitState.OPEN);
      const stats = errorHandler.getStats();
      assert.ok(stats.total > 0);
    });
    
    it('should integrate recovery with error handling', async () => {
      let recovered = false;
      
      // カスタムリカバリー戦略を設定
      recoveryManager.registerStrategy(ErrorCodes.SYSTEM_RESOURCE, new RecoveryStrategy([
        {
          action: RecoveryActions.CLEANUP_RESOURCES,
          params: {
            customCleanup: () => {
              recovered = true;
            }
          }
        }
      ]));
      
      const error = new SystemError('Resource exhausted', { code: 'EMFILE' });
      await errorHandler.handleError(error);
      
      const recoveryResult = await recoveryManager.recover(error);
      
      assert.strictEqual(recoveryResult, true);
      assert.strictEqual(recovered, true);
    });
  });
});