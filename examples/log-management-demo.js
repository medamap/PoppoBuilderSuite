#!/usr/bin/env node

/**
 * Log Management Demo
 * Demonstrates the multi-project log management capabilities
 */

const path = require('path');
const os = require('os');
const fs = require('fs').promises;
const { MultiLogger, getInstance } = require('../lib/utils/multi-logger');
const LogAggregator = require('../lib/utils/log-aggregator');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(colors[color] + message + colors.reset);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  try {
    log('\n=== PoppoBuilder Log Management Demo ===\n', 'bright');

    // Set up temporary directories for demo
    const demoDir = path.join(os.tmpdir(), `poppo-log-demo-${Date.now()}`);
    const project1Dir = path.join(demoDir, 'project1');
    const project2Dir = path.join(demoDir, 'project2');
    
    await fs.mkdir(demoDir, { recursive: true });
    await fs.mkdir(project1Dir, { recursive: true });
    await fs.mkdir(project2Dir, { recursive: true });

    log('1. Initializing MultiLogger...', 'cyan');
    
    // Initialize logger
    const logger = new MultiLogger({
      globalLogDir: path.join(demoDir, 'logs'),
      logLevel: 'debug',
      format: 'json',
      maxFileSize: 1024 * 1024, // 1MB for demo
      enableRotation: true
    });
    
    await logger.initialize();
    log('   ✓ MultiLogger initialized', 'green');

    // Register projects
    log('\n2. Registering projects...', 'cyan');
    await logger.registerProject('project1', project1Dir);
    await logger.registerProject('project2', project2Dir);
    log('   ✓ Projects registered', 'green');

    // Write various logs
    log('\n3. Writing sample logs...', 'cyan');
    
    // Global logs
    await logger.info('System startup', { component: 'core' });
    await logger.debug('Loading configuration', { component: 'config-loader' });
    
    // Daemon logs
    await logger.info('Daemon process started', { daemon: true, pid: process.pid });
    await logger.warn('High memory usage detected', { 
      daemon: true, 
      component: 'monitor',
      metadata: { memory: '85%' }
    });
    
    // Project 1 logs
    await logger.info('Building project', { 
      projectId: 'project1',
      component: 'builder'
    });
    await logger.error('Build failed', {
      projectId: 'project1',
      component: 'builder',
      error: new Error('Module not found: react')
    });
    
    // Project 2 logs
    await logger.info('Running tests', {
      projectId: 'project2',
      component: 'test-runner'
    });
    await logger.debug('Test suite completed', {
      projectId: 'project2',
      component: 'test-runner',
      metadata: { passed: 45, failed: 2 }
    });
    
    // Broadcast log
    await logger.warn('System maintenance scheduled', { 
      broadcast: true,
      metadata: { time: '2024-06-22 02:00 UTC' }
    });
    
    log('   ✓ Sample logs written', 'green');

    // Show statistics
    log('\n4. Logger Statistics:', 'cyan');
    const stats = logger.getStats();
    console.log('   Total bytes written:', stats.totals.bytesWritten);
    console.log('   Total lines written:', stats.totals.linesWritten);
    console.log('   Active log streams:', stats.totals.activeStreams);

    // Initialize aggregator
    log('\n5. Initializing LogAggregator...', 'cyan');
    const aggregator = new LogAggregator({
      globalLogDir: path.join(demoDir, 'logs')
    });
    
    await aggregator.initialize();
    aggregator.registerProject('project1', project1Dir);
    aggregator.registerProject('project2', project2Dir);
    log('   ✓ LogAggregator initialized', 'green');

    // Search logs
    log('\n6. Searching logs...', 'cyan');
    
    // Search all logs
    const allLogs = await aggregator.search({ limit: 5 });
    log(`   Found ${allLogs.length} recent logs`, 'yellow');
    
    // Search errors only
    const errors = await aggregator.search({ level: 'error' });
    log(`   Found ${errors.length} error logs`, 'red');
    
    // Search by project
    const project1Logs = await aggregator.search({ projectId: 'project1' });
    log(`   Found ${project1Logs.length} logs for project1`, 'yellow');

    // Aggregate logs
    log('\n7. Aggregating logs...', 'cyan');
    const aggregated = await aggregator.aggregate({ 
      groupBy: 'level',
      includeStats: true 
    });
    
    log('   Log counts by level:', 'yellow');
    for (const [level, stats] of Object.entries(aggregated.groupStats)) {
      console.log(`     ${level}: ${stats.count} (${stats.percentage.toFixed(1)}%)`);
    }

    // Error summary
    log('\n8. Error Summary:', 'cyan');
    const errorSummary = await aggregator.getErrorSummary();
    log(`   Total errors: ${errorSummary.total}`, 'red');
    if (errorSummary.topErrors.length > 0) {
      log('   Top errors:', 'yellow');
      errorSummary.topErrors.forEach(err => {
        console.log(`     - ${err.message} (${err.count} times)`);
      });
    }

    // Stream logs
    log('\n9. Streaming logs (5 seconds)...', 'cyan');
    const stream = aggregator.streamLogs({ follow: true, tail: 0 });
    
    stream.on('log', (logEntry) => {
      log(`   [STREAM] ${logEntry.level}: ${logEntry.message}`, 'magenta');
    });
    
    // Write some logs while streaming
    setTimeout(async () => {
      await logger.info('Live log entry 1', { projectId: 'project1' });
    }, 1000);
    
    setTimeout(async () => {
      await logger.warn('Live log entry 2', { daemon: true });
    }, 2000);
    
    setTimeout(async () => {
      await logger.error('Live error', { 
        error: new Error('Demo error'),
        projectId: 'project2' 
      });
    }, 3000);
    
    // Stop streaming after 5 seconds
    await sleep(5000);
    stream.stop();
    log('   ✓ Streaming stopped', 'green');

    // Export logs
    log('\n10. Exporting logs...', 'cyan');
    const exportPath = path.join(demoDir, 'exported-logs.json');
    await aggregator.export(exportPath, { limit: 10 }, 'json');
    log(`   ✓ Logs exported to ${exportPath}`, 'green');

    // Clean up
    log('\n11. Cleaning up...', 'cyan');
    await logger.cleanup();
    log('   ✓ Logger cleaned up', 'green');

    // Show log file structure
    log('\n12. Log File Structure:', 'cyan');
    async function showDir(dir, indent = '   ') {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            console.log(indent + '📁 ' + entry.name + '/');
            await showDir(path.join(dir, entry.name), indent + '  ');
          } else {
            const size = (await fs.stat(path.join(dir, entry.name))).size;
            console.log(indent + '📄 ' + entry.name + ` (${size} bytes)`);
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }
    
    await showDir(demoDir);

    log('\n=== Demo Complete ===\n', 'bright');
    log(`Demo files created in: ${demoDir}`, 'yellow');
    log('To clean up, run:', 'yellow');
    log(`  rm -rf ${demoDir}`, 'gray');

  } catch (error) {
    log('\nError: ' + error.message, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

// Run demo
if (require.main === module) {
  main();
}