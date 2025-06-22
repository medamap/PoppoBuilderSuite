#!/usr/bin/env node

/**
 * Test script for i18n logging functionality
 */

const path = require('path');
const { initI18n, t } = require('../lib/i18n');
const I18nLogger = require('../lib/utils/i18n-logger');
const LoggerFactory = require('../lib/utils/logger-factory');

async function testI18nLogging() {
  console.log('Testing i18n logging functionality...\n');

  try {
    // Initialize i18n
    console.log('1. Initializing i18n...');
    await initI18n();
    console.log('   ✅ i18n initialized successfully\n');

    // Test direct translation
    console.log('2. Testing direct translation:');
    console.log('   EN:', t('messages:startup.ready'));
    console.log('   JA:', t('messages:startup.ready', {}, 'ja'));
    console.log('');

    // Test logger factory
    console.log('3. Testing LoggerFactory:');
    const logger1 = LoggerFactory.createI18n('test-module');
    const logger2 = LoggerFactory.createPlain('test-module');
    console.log('   ✅ Created i18n and plain loggers\n');

    // Test i18n logging
    console.log('4. Testing i18n logging methods:');
    
    // Test system logging
    await logger1.logSystem('starting');
    await logger1.logSystem('started');
    
    // Test issue logging
    await logger1.logIssue(123, 'processing', { number: 123, title: 'Test Issue' });
    await logger1.logIssue(123, 'completed', { number: 123 });
    
    // Test task logging
    await logger1.logTask('task-001', 'started', { id: 'task-001' });
    await logger1.logTask('task-001', 'completed', { id: 'task-001' });
    
    // Test agent logging
    await logger1.logAgent('TestAgent', 'started', { name: 'TestAgent' });
    await logger1.logAgent('TestAgent', 'healthy', { name: 'TestAgent' });
    
    // Test process logging
    await logger1.logProcess(12345, 'started', { pid: 12345 });
    await logger1.logProcess(12345, 'stopped', { pid: 12345 });
    
    console.log('   ✅ All logging methods executed successfully\n');

    // Test language switching
    console.log('5. Testing language switching:');
    process.env.POPPOBUILDER_LOCALE = 'ja';
    const japaneseLogger = LoggerFactory.createI18n('japanese-test');
    await japaneseLogger.logSystem('starting');
    await japaneseLogger.logIssue(456, 'processing', { number: 456, title: 'テストイシュー' });
    
    // Reset locale
    process.env.POPPOBUILDER_LOCALE = 'en';
    console.log('   ✅ Language switching tested\n');

    // Test fallback for missing translations
    console.log('6. Testing fallback for missing translations:');
    await logger1.info('messages:nonexistent.key', { test: 'data' });
    await logger1.info('Raw message without translation key');
    console.log('   ✅ Fallback mechanisms tested\n');

    console.log('✅ All i18n logging tests passed successfully!');
    return true;

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
    return false;
  }
}

// Run tests if script is executed directly
if (require.main === module) {
  testI18nLogging().then(success => {
    process.exit(success ? 0 : 1);
  }).catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
  });
}

module.exports = { testI18nLogging };