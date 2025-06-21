/**
 * エラーハンドリングフレームワークの簡単なテスト
 */

const assert = require('assert');
const { BaseError, ErrorCodes, ErrorSeverity, ErrorCategory } = require('../src/error-handler');

describe('Error Handling Framework - Simple Tests', () => {
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
  
  describe('Error Codes', () => {
    it('should have network error codes', () => {
      assert.ok(ErrorCodes.NETWORK_TIMEOUT);
      assert.ok(ErrorCodes.NETWORK_CONNECTION);
      assert.ok(ErrorCodes.API_RATE_LIMIT);
    });
    
    it('should have system error codes', () => {
      assert.ok(ErrorCodes.SYSTEM_RESOURCE);
      assert.ok(ErrorCodes.SYSTEM_PERMISSION);
      assert.ok(ErrorCodes.SYSTEM_DISK_FULL);
    });
  });
  
  describe('Error Severity', () => {
    it('should have all severity levels', () => {
      assert.ok(ErrorSeverity.LOW);
      assert.ok(ErrorSeverity.MEDIUM);
      assert.ok(ErrorSeverity.HIGH);
      assert.ok(ErrorSeverity.CRITICAL);
    });
  });
  
  describe('Error Category', () => {
    it('should have all categories', () => {
      assert.ok(ErrorCategory.TRANSIENT);
      assert.ok(ErrorCategory.PERMANENT);
      assert.ok(ErrorCategory.RECOVERABLE);
      assert.ok(ErrorCategory.FATAL);
    });
  });
});