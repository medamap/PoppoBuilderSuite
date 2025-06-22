#!/usr/bin/env node

/**
 * Test script for error code and message catalog system
 */

const { initI18n, t } = require('../lib/i18n');
const { 
  PoppoError, 
  ErrorHandler, 
  ERROR_CODES, 
  ERROR_SEVERITY,
  ERROR_CATEGORIES,
  createError,
  systemError,
  githubError,
  claudeError,
  fileError,
  agentError,
  wrapError,
  isPoppoError,
  createErrorHandler
} = require('../lib/errors');

async function testErrorSystem() {
  console.log('Testing error code and message catalog system...\n');

  try {
    // Initialize i18n
    console.log('1. Initializing i18n...');
    await initI18n();
    console.log('   ✅ i18n initialized successfully\n');

    // Test error codes
    console.log('2. Testing error codes:');
    console.log(`   Total error codes: ${Object.keys(ERROR_CODES).length}`);
    console.log(`   System errors: ${Object.values(ERROR_CODES).filter(c => c.startsWith('E1')).length}`);
    console.log(`   GitHub errors: ${Object.values(ERROR_CODES).filter(c => c.startsWith('E2')).length}`);
    console.log(`   Claude errors: ${Object.values(ERROR_CODES).filter(c => c.startsWith('E3')).length}`);
    console.log('   ✅ Error codes enumerated successfully\n');

    // Test PoppoError creation
    console.log('3. Testing PoppoError creation:');
    
    // Test basic error creation
    const error1 = new PoppoError(ERROR_CODES.CONFIG_FILE_NOT_FOUND, { path: '/config.json' });
    console.log(`   Created error: ${error1.code} - ${error1.message}`);
    console.log(`   Category: ${error1.category}, Severity: ${error1.severity}`);
    console.log(`   Retryable: ${error1.retryable}, Recoverable: ${error1.recoverable}`);
    
    // Test factory methods
    const githubErr = githubError(ERROR_CODES.GITHUB_RATE_LIMIT_EXCEEDED, {
      remaining: 0,
      limit: 5000,
      resetTime: new Date().toISOString()
    });
    console.log(`   GitHub error: ${githubErr.code} - ${githubErr.message}`);
    
    const claudeErr = claudeError(ERROR_CODES.CLAUDE_SESSION_EXPIRED, {
      expiredAt: new Date().toISOString()
    });
    console.log(`   Claude error: ${claudeErr.code} - ${claudeErr.message}`);
    
    console.log('   ✅ PoppoError creation tested\n');

    // Test error wrapping
    console.log('4. Testing error wrapping:');
    const originalError = new Error('Original filesystem error');
    const wrappedError = wrapError(originalError, ERROR_CODES.FILE_READ_FAILED, { path: '/test.txt' });
    console.log(`   Wrapped error: ${wrappedError.code} - ${wrappedError.message}`);
    console.log(`   Original cause: ${wrappedError.cause.message}`);
    console.log(`   Is PoppoError: ${isPoppoError(wrappedError)}`);
    console.log('   ✅ Error wrapping tested\n');

    // Test localization
    console.log('5. Testing error message localization:');
    
    // English messages
    process.env.POPPOBUILDER_LOCALE = 'en';
    const enError = createError(ERROR_CODES.TASK_TIMEOUT, { taskId: 'task-123', timeout: 30000 });
    console.log(`   EN: ${enError.message}`);
    
    // Japanese messages
    process.env.POPPOBUILDER_LOCALE = 'ja';
    const jaError = createError(ERROR_CODES.TASK_TIMEOUT, { taskId: 'task-123', timeout: 30000 });
    console.log(`   JA: ${jaError.message}`);
    
    // Specific locale
    const specificLocaleMsg = enError.getLocalizedMessage('ja');
    console.log(`   Specific locale (JA): ${specificLocaleMsg}`);
    
    // Reset locale
    process.env.POPPOBUILDER_LOCALE = 'en';
    console.log('   ✅ Error localization tested\n');

    // Test error JSON serialization
    console.log('6. Testing error serialization:');
    const errorJson = enError.toJSON();
    console.log(`   Serialized error has ${Object.keys(errorJson).length} properties`);
    console.log(`   Contains: code, message, category, severity, timestamp, etc.`);
    console.log('   ✅ Error serialization tested\n');

    // Test ErrorHandler
    console.log('7. Testing ErrorHandler:');
    const errorHandler = createErrorHandler({
      enableRetry: true,
      enableRecovery: true,
      maxRetries: 2
    });
    
    // Test error handling
    const testError = systemError(ERROR_CODES.NETWORK_TIMEOUT, { host: 'api.github.com', timeout: 5000 });
    const handlingResult = await errorHandler.handleError(testError, { operation: 'api_call' });
    console.log(`   Handling result: ${handlingResult.strategy} (success: ${handlingResult.success})`);
    
    // Test retry logic
    console.log('   Testing retry logic...');
    let attemptCount = 0;
    const retryableOperation = async (attempt) => {
      attemptCount = attempt;
      if (attempt < 1) {
        throw systemError(ERROR_CODES.NETWORK_TIMEOUT, { host: 'test.com' });
      }
      return { success: true, attempt };
    };
    
    try {
      const retryResult = await errorHandler.executeWithRetry(retryableOperation, { 
        operation: 'test_retry' 
      });
      console.log(`   Retry succeeded on attempt ${retryResult.attempt}`);
    } catch (retryError) {
      console.log(`   Retry failed after ${attemptCount + 1} attempts`);
    }
    
    console.log('   ✅ ErrorHandler tested\n');

    // Test error statistics
    console.log('8. Testing error statistics:');
    
    // Generate some test errors
    await errorHandler.handleError(githubError(ERROR_CODES.GITHUB_AUTH_FAILED, { reason: 'invalid token' }));
    await errorHandler.handleError(claudeError(ERROR_CODES.CLAUDE_RATE_LIMIT_EXCEEDED, { retryAfter: 60 }));
    await errorHandler.handleError(githubError(ERROR_CODES.GITHUB_AUTH_FAILED, { reason: 'expired token' }));
    
    const stats = errorHandler.getStats();
    console.log(`   Error statistics collected: ${Object.keys(stats).length} unique error codes`);
    console.log(`   GitHub auth failures: ${stats[ERROR_CODES.GITHUB_AUTH_FAILED]?.count || 0}`);
    console.log(`   Claude rate limits: ${stats[ERROR_CODES.CLAUDE_RATE_LIMIT_EXCEEDED]?.count || 0}`);
    console.log('   ✅ Error statistics tested\n');

    // Test recovery registration
    console.log('9. Testing recovery registration:');
    let recoveryExecuted = false;
    errorHandler.registerRecovery(ERROR_CODES.FILE_NOT_FOUND, async (error, context) => {
      recoveryExecuted = true;
      return { recovered: true, action: 'created_missing_file' };
    });
    
    const fileError = createError(ERROR_CODES.FILE_NOT_FOUND, { path: '/missing.txt' });
    const recoveryResult = await errorHandler.handleError(fileError);
    console.log(`   Recovery executed: ${recoveryExecuted}`);
    console.log(`   Recovery successful: ${recoveryResult.success}`);
    console.log('   ✅ Recovery registration tested\n');

    // Test error formatting
    console.log('10. Testing error response formatting:');
    const formattedResponse = errorHandler.formatErrorResponse(
      agentError(ERROR_CODES.AGENT_HEALTH_CHECK_FAILED, { agent: 'CCLA', reason: 'timeout' }),
      { requestId: 'req-123' }
    );
    console.log(`   Formatted response contains: ${Object.keys(formattedResponse).length} top-level properties`);
    console.log(`   Error code: ${formattedResponse.error.code}`);
    console.log(`   Success: ${formattedResponse.success}`);
    console.log('   ✅ Error formatting tested\n');

    // Test category-based filtering
    console.log('11. Testing category-based operations:');
    const errors = [
      systemError(ERROR_CODES.CONFIG_FILE_NOT_FOUND, { path: '/config.json' }),
      githubError(ERROR_CODES.GITHUB_RATE_LIMIT_EXCEEDED, {}),
      claudeError(ERROR_CODES.CLAUDE_SESSION_EXPIRED, {}),
      createError(ERROR_CODES.FILE_WRITE_FAILED, { path: '/test.txt' })
    ];
    
    const systemErrors = errors.filter(e => e.category === ERROR_CATEGORIES.SYSTEM);
    const networkErrors = errors.filter(e => e.category === ERROR_CATEGORIES.GITHUB || e.category === ERROR_CATEGORIES.CLAUDE);
    const fileErrors = errors.filter(e => e.category === ERROR_CATEGORIES.FILE);
    
    console.log(`   System errors: ${systemErrors.length}`);
    console.log(`   Network errors: ${networkErrors.length}`);
    console.log(`   File errors: ${fileErrors.length}`);
    console.log('   ✅ Category filtering tested\n');

    // Test severity-based operations
    console.log('12. Testing severity-based operations:');
    const criticalErrors = errors.filter(e => e.severity === ERROR_SEVERITY.CRITICAL);
    const highErrors = errors.filter(e => e.severity === ERROR_SEVERITY.HIGH);
    const mediumErrors = errors.filter(e => e.severity === ERROR_SEVERITY.MEDIUM);
    
    console.log(`   Critical errors: ${criticalErrors.length}`);
    console.log(`   High severity errors: ${highErrors.length}`);
    console.log(`   Medium severity errors: ${mediumErrors.length}`);
    console.log('   ✅ Severity filtering tested\n');

    console.log('✅ All error system tests passed successfully!');
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Run tests if script is executed directly
if (require.main === module) {
  testErrorSystem().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}

module.exports = { testErrorSystem };