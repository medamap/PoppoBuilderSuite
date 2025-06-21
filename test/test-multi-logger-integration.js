#!/usr/bin/env node

/**
 * Test Multi-Logger Integration
 * Tests the integration of MultiLogger with existing components
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;

// Test LoggerAdapter compatibility
async function testLoggerAdapter() {
  console.log('\n=== Testing LoggerAdapter Compatibility ===\n');
  
  const Logger = require('../src/logger');
  
  // Test backward compatibility - old style constructor
  console.log('1. Testing old-style constructor...');
  const logger1 = new Logger(path.join(__dirname, 'test-logs'));
  await logger1.info('test', 'Old style logger works');
  console.log('   ✓ Old style constructor works');
  
  // Test new style constructor
  console.log('2. Testing new-style constructor...');
  const logger2 = new Logger('TestModule', { 
    logDir: path.join(__dirname, 'test-logs'),
    projectId: 'test-project'
  });
  await logger2.info('New style logger works');
  console.log('   ✓ New style constructor works');
  
  // Test convenience methods
  console.log('3. Testing convenience methods...');
  await logger2.error('Error test');
  await logger2.warn('Warning test');
  await logger2.debug('Debug test');
  console.log('   ✓ Convenience methods work');
  
  // Test Issue logging
  console.log('4. Testing Issue logging...');
  await logger2.logIssue(123, 'Test event', { foo: 'bar' });
  console.log('   ✓ Issue logging works');
  
  // Test Process logging
  console.log('5. Testing Process logging...');
  await logger2.logProcess('task-456', 'Process started', { pid: process.pid });
  console.log('   ✓ Process logging works');
}

// Test MultiLogger directly
async function testMultiLogger() {
  console.log('\n=== Testing MultiLogger Directly ===\n');
  
  const { MultiLogger } = require('../lib/utils/multi-logger');
  const tempDir = path.join(os.tmpdir(), `multi-logger-test-${Date.now()}`);
  
  // Create test directories
  await fs.mkdir(tempDir, { recursive: true });
  const project1Dir = path.join(tempDir, 'project1');
  const project2Dir = path.join(tempDir, 'project2');
  await fs.mkdir(project1Dir);
  await fs.mkdir(project2Dir);
  
  // Initialize MultiLogger
  const logger = new MultiLogger({
    globalLogDir: path.join(tempDir, 'logs'),
    logLevel: 'debug'
  });
  await logger.initialize();
  
  // Register projects
  console.log('1. Registering projects...');
  await logger.registerProject('project1', project1Dir);
  await logger.registerProject('project2', project2Dir);
  console.log('   ✓ Projects registered');
  
  // Test logging to different destinations
  console.log('2. Testing log destinations...');
  
  // Global log
  await logger.info('Global log entry');
  
  // Daemon log
  await logger.info('Daemon log entry', { daemon: true });
  
  // Project-specific logs
  await logger.info('Project 1 log', { projectId: 'project1' });
  await logger.info('Project 2 log', { projectId: 'project2' });
  
  // Broadcast log
  await logger.warn('Broadcast warning', { broadcast: true });
  
  console.log('   ✓ All log destinations work');
  
  // Check log files
  console.log('3. Verifying log files...');
  const globalLog = await fs.readFile(path.join(tempDir, 'logs', 'global.log'), 'utf8');
  const daemonLog = await fs.readFile(path.join(tempDir, 'logs', 'daemon.log'), 'utf8');
  const project1Log = await fs.readFile(path.join(project1Dir, '.poppobuilder', 'logs', 'project.log'), 'utf8');
  const project2Log = await fs.readFile(path.join(project2Dir, '.poppobuilder', 'logs', 'project.log'), 'utf8');
  
  console.log('   ✓ Global log contains:', globalLog.split('\n').length - 1, 'entries');
  console.log('   ✓ Daemon log contains:', daemonLog.split('\n').length - 1, 'entries');
  console.log('   ✓ Project1 log contains:', project1Log.split('\n').length - 1, 'entries');
  console.log('   ✓ Project2 log contains:', project2Log.split('\n').length - 1, 'entries');
  
  // Clean up
  await logger.cleanup();
  console.log('\n   ✓ Logger cleaned up');
  
  // Show directory structure
  console.log('\n4. Log directory structure:');
  async function showDir(dir, indent = '   ') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        console.log(indent + '📁 ' + entry.name + '/');
        await showDir(path.join(dir, entry.name), indent + '  ');
      } else {
        console.log(indent + '📄 ' + entry.name);
      }
    }
  }
  await showDir(tempDir);
  
  // Clean up temp directory
  await fs.rm(tempDir, { recursive: true, force: true });
}

// Test LogAggregator
async function testLogAggregator() {
  console.log('\n=== Testing LogAggregator ===\n');
  
  const LogAggregator = require('../lib/utils/log-aggregator');
  const { MultiLogger } = require('../lib/utils/multi-logger');
  
  const tempDir = path.join(os.tmpdir(), `aggregator-test-${Date.now()}`);
  await fs.mkdir(tempDir, { recursive: true });
  
  // Create some test logs
  const logger = new MultiLogger({
    globalLogDir: path.join(tempDir, 'logs')
  });
  await logger.initialize();
  
  // Write various logs
  await logger.error('Test error', { component: 'test' });
  await logger.warn('Test warning', { component: 'test' });
  await logger.info('Test info 1');
  await logger.info('Test info 2');
  await logger.debug('Test debug');
  
  // Initialize aggregator
  const aggregator = new LogAggregator({
    globalLogDir: path.join(tempDir, 'logs')
  });
  await aggregator.initialize();
  
  // Search logs
  console.log('1. Searching all logs...');
  const allLogs = await aggregator.search({});
  console.log(`   ✓ Found ${allLogs.length} logs`);
  
  // Search by level
  console.log('2. Searching by level...');
  const errors = await aggregator.search({ level: 'error' });
  console.log(`   ✓ Found ${errors.length} error logs`);
  
  // Aggregate by level
  console.log('3. Aggregating by level...');
  const aggregated = await aggregator.aggregate({ groupBy: 'level' });
  for (const [level, stats] of Object.entries(aggregated.groupStats)) {
    console.log(`   ${level}: ${stats.count} entries`);
  }
  
  // Clean up
  await logger.cleanup();
  await fs.rm(tempDir, { recursive: true, force: true });
  console.log('\n   ✓ Test completed and cleaned up');
}

// Main test runner
async function main() {
  try {
    console.log('Testing Multi-Project Log Management Integration\n');
    
    // Run tests
    await testLoggerAdapter();
    await testMultiLogger();
    await testLogAggregator();
    
    console.log('\n✅ All tests passed!\n');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
if (require.main === module) {
  main();
}

🤖 Generated with [Claude Code](https://claude.ai/code)

Co-Authored-By: Claude <noreply@anthropic.com>