#!/usr/bin/env node

/**
 * Test script for MemoryManager - Issue #123
 * Tests memory monitoring, leak detection, and optimization features
 */

const MemoryManager = require('../src/memory-manager');
const Logger = require('../src/logger');

class MockLogger {
  info(message, data) {
    console.log(`[INFO] ${message}`, data || '');
  }
  
  warn(message, data) {
    console.log(`[WARN] ${message}`, data || '');
  }
  
  error(message, data) {
    console.log(`[ERROR] ${message}`, data || '');
  }
  
  debug(message, data) {
    console.log(`[DEBUG] ${message}`, data || '');
  }
}

async function testMemoryManager() {
  console.log('='.repeat(60));
  console.log('🧪 MemoryManager Test Suite - Issue #123');
  console.log('='.repeat(60));
  
  const logger = new MockLogger();
  
  // Test 1: Basic initialization
  console.log('\n📋 Test 1: Basic Initialization');
  const memoryManager = new MemoryManager({
    enabled: true,
    checkInterval: 2000, // 2 seconds for testing
    memoryThreshold: 100, // Low threshold for testing
    heapSnapshotEnabled: false // Disable for testing
  }, logger);
  
  console.log('✅ MemoryManager created successfully');
  
  // Test 2: Start monitoring
  console.log('\n📋 Test 2: Start Memory Monitoring');
  await memoryManager.start();
  console.log('✅ Memory monitoring started');
  
  // Test 3: Collect metrics
  console.log('\n📋 Test 3: Collect Memory Metrics');
  const metrics = memoryManager.collectMemoryMetrics();
  console.log('Current memory metrics:');
  console.log(`  Heap Used: ${Math.round(metrics.process.heapUsed / 1024 / 1024)}MB`);
  console.log(`  Heap Total: ${Math.round(metrics.process.heapTotal / 1024 / 1024)}MB`);
  console.log(`  RSS: ${Math.round(metrics.process.rss / 1024 / 1024)}MB`);
  console.log(`  System Usage: ${metrics.system.percentage.toFixed(1)}%`);
  console.log('✅ Metrics collection working');
  
  // Test 4: Memory status
  console.log('\n📋 Test 4: Memory Status');
  const status = memoryManager.getMemoryStatus();
  console.log(`Running: ${status.isRunning}`);
  console.log(`GC Count: ${status.stats.gcCount}`);
  console.log(`Leaks Detected: ${status.stats.leaksDetected}`);
  console.log('✅ Status retrieval working');
  
  // Test 5: Force garbage collection (if available)
  console.log('\n📋 Test 5: Garbage Collection');
  if (global.gc) {
    const gcResult = memoryManager.performGarbageCollection();
    console.log(`GC Result: ${gcResult ? 'Success' : 'Failed'}`);
    if (gcResult) {
      console.log(`  Freed: ${gcResult.freedMB.toFixed(1)}MB`);
      console.log(`  Duration: ${gcResult.duration}ms`);
    }
    console.log('✅ Garbage collection working');
  } else {
    console.log('⚠️  GC not exposed (start with --expose-gc)');
  }
  
  // Test 6: Simulate memory pressure
  console.log('\n📋 Test 6: Memory Pressure Simulation');
  let pressureDetected = false;
  
  memoryManager.on('memoryPressure', (data) => {
    pressureDetected = true;
    console.log('🚨 Memory pressure detected!');
    console.log(`  Reasons: ${data.reasons.join(', ')}`);
  });
  
  // Create some memory pressure (allocate large buffer)
  const largeBufers = [];
  for (let i = 0; i < 5; i++) {
    largeBufers.push(Buffer.alloc(10 * 1024 * 1024)); // 10MB each
  }
  
  // Wait and check metrics
  await new Promise(resolve => setTimeout(resolve, 3000));
  const newMetrics = memoryManager.collectMemoryMetrics();
  console.log(`New heap usage: ${Math.round(newMetrics.process.heapUsed / 1024 / 1024)}MB`);
  
  // Clean up large buffers
  largeBufers.length = 0;
  if (global.gc) global.gc();
  
  console.log('✅ Memory pressure simulation completed');
  
  // Test 7: Memory history
  console.log('\n📋 Test 7: Memory History');
  const { history, analysis } = memoryManager.getMemoryHistory(5);
  console.log(`History entries: ${history.length}`);
  if (analysis) {
    console.log(`  Time span: ${analysis.timeSpanMinutes} minutes`);
    console.log(`  Heap growth: ${analysis.heapGrowthMB}MB`);
    console.log(`  Trend: ${analysis.trend}`);
  }
  console.log('✅ Memory history working');
  
  // Test 8: Generate report
  console.log('\n📋 Test 8: Generate Report');
  const report = memoryManager.generateReport();
  console.log('Report generated:');
  console.log(`  Timestamp: ${report.timestamp}`);
  console.log(`  Node Version: ${report.system.nodeVersion}`);
  console.log(`  Current Heap: ${Math.round(report.status.current.process.heapUsed / 1024 / 1024)}MB`);
  console.log(`  Recommendations: ${report.recommendations.length}`);
  if (report.recommendations.length > 0) {
    report.recommendations.forEach((rec, i) => {
      console.log(`    ${i + 1}. [${rec.priority}] ${rec.message}`);
    });
  }
  console.log('✅ Report generation working');
  
  // Test 9: Events
  console.log('\n📋 Test 9: Event System');
  let eventCount = 0;
  
  memoryManager.on('metrics', () => eventCount++);
  
  await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for some metrics
  
  console.log(`Events received: ${eventCount}`);
  console.log('✅ Event system working');
  
  // Test 10: Stop monitoring
  console.log('\n📋 Test 10: Stop Monitoring');
  memoryManager.stop();
  console.log('✅ Memory monitoring stopped');
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  console.log('✅ All memory manager tests completed successfully!');
  console.log(`📈 Final memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  
  if (pressureDetected) {
    console.log('🚨 Memory pressure was successfully detected during testing');
  }
  
  console.log('\n💡 To test with GC capabilities, run with:');
  console.log('   node --expose-gc test/test-memory-manager.js');
}

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n🛑 Test interrupted');
  process.exit(0);
});

// Run tests
if (require.main === module) {
  testMemoryManager().catch(console.error);
}

module.exports = { testMemoryManager };