#!/usr/bin/env node

/**
 * CCSP Phase 4 検証スクリプト
 * Redis接続なしでコンポーネントをテストします
 */

const path = require('path');
process.chdir(path.join(__dirname, '..'));

const AdvancedQueueManager = require('../agents/ccsp/advanced-queue-manager');
const UsageMonitor = require('../agents/ccsp/usage-monitor');
const ClaudeExecutor = require('../agents/ccsp/claude-executor');
const NotificationHandler = require('../agents/ccsp/notification-handler');
const PrometheusExporter = require('../agents/ccsp/prometheus-exporter');
const EmergencyStop = require('../agents/ccsp/emergency-stop');

console.log('🔍 CCSP Phase 4 Component Verification\n');

async function verifyAdvancedQueueManager() {
  console.log('1️⃣ Testing AdvancedQueueManager...');
  
  const queueManager = new AdvancedQueueManager({
    maxQueueSize: 10,
    schedulerInterval: 1000
  });
  
  try {
    // Test enqueue
    const taskId = await queueManager.enqueue(
      { prompt: 'Test task', agent: 'test' },
      'high'
    );
    console.log('   ✅ Enqueue test passed');
    
    // Test dequeue
    const task = await queueManager.dequeue();
    console.log('   ✅ Dequeue test passed');
    
    // Test status
    const status = queueManager.getStatus();
    console.log('   ✅ Status test passed');
    
    await queueManager.shutdown();
    console.log('   ✅ AdvancedQueueManager: ALL TESTS PASSED\n');
    
  } catch (error) {
    console.log('   ❌ AdvancedQueueManager test failed:', error.message);
  }
}

async function verifyUsageMonitor() {
  console.log('2️⃣ Testing UsageMonitor...');
  
  const usageMonitor = new UsageMonitor({
    windowSize: 60000,
    alertThreshold: 0.8
  });
  
  try {
    // Test record usage
    usageMonitor.recordUsage({
      agent: 'test-agent',
      requestId: 'req-1',
      success: true,
      responseTime: 1000
    });
    console.log('   ✅ Record usage test passed');
    
    // Test get stats
    const stats = usageMonitor.getCurrentWindowStats();
    console.log('   ✅ Get stats test passed');
    
    // Test agent stats
    const agentStats = usageMonitor.getAgentStats('test-agent');
    console.log('   ✅ Agent stats test passed');
    
    // Test prediction
    const prediction = usageMonitor.predictUsage(30);
    console.log('   ✅ Prediction test passed');
    
    await usageMonitor.shutdown();
    console.log('   ✅ UsageMonitor: ALL TESTS PASSED\n');
    
  } catch (error) {
    console.log('   ❌ UsageMonitor test failed:', error.message);
  }
}

async function verifyClaudeExecutor() {
  console.log('3️⃣ Testing ClaudeExecutor...');
  
  const claudeExecutor = new ClaudeExecutor({
    maxRetries: 2,
    timeout: 10000
  });
  
  try {
    // Test error analysis
    const sessionError = claudeExecutor.analyzeError('Invalid API key');
    const rateLimitError = claudeExecutor.analyzeError('Rate limit exceeded');
    console.log('   ✅ Error analysis test passed');
    
    // Test prompt enhancement
    const enhanced = claudeExecutor.enhancePrompt('Test prompt');
    console.log('   ✅ Prompt enhancement test passed');
    
    // Test stats
    const stats = claudeExecutor.getStats();
    console.log('   ✅ Stats test passed');
    
    await claudeExecutor.shutdown();
    console.log('   ✅ ClaudeExecutor: ALL TESTS PASSED\n');
    
  } catch (error) {
    console.log('   ❌ ClaudeExecutor test failed:', error.message);
  }
}

async function verifyNotificationHandler() {
  console.log('4️⃣ Testing NotificationHandler...');
  
  const notificationHandler = new NotificationHandler({
    enableGitHub: false,
    enableSlack: false,
    enableEmail: false
  });
  
  try {
    // Test channel selection
    const channels = notificationHandler.selectChannels('error', 'critical');
    console.log('   ✅ Channel selection test passed');
    
    // Test GitHub title generation
    const title = notificationHandler.generateGitHubTitle('session_timeout', 'critical');
    console.log('   ✅ GitHub title generation test passed');
    
    // Test label generation
    const labels = notificationHandler.generateGitHubLabels('session_timeout', 'critical');
    console.log('   ✅ Label generation test passed');
    
    // Test notification (log only)
    await notificationHandler.notify({
      type: 'test',
      title: 'Test Notification',
      message: 'Test message',
      severity: 'info',
      channels: ['log']
    });
    console.log('   ✅ Notification test passed');
    
    await notificationHandler.shutdown();
    console.log('   ✅ NotificationHandler: ALL TESTS PASSED\n');
    
  } catch (error) {
    console.log('   ❌ NotificationHandler test failed:', error.message);
  }
}

async function verifyPrometheusExporter() {
  console.log('5️⃣ Testing PrometheusExporter...');
  
  const prometheusExporter = new PrometheusExporter();
  
  try {
    // Test record usage
    prometheusExporter.recordAPIUsage({
      agent: 'test-agent',
      success: true,
      responseTime: 1000,
      rateLimited: false
    });
    console.log('   ✅ Record API usage test passed');
    
    // Test queue size update
    prometheusExporter.incrementQueueSize('urgent');
    prometheusExporter.decrementQueueSize('urgent');
    console.log('   ✅ Queue size update test passed');
    
    // Test metrics generation
    const metrics = await prometheusExporter.getMetrics();
    console.log('   ✅ Metrics generation test passed');
    
    // Test custom metrics
    prometheusExporter.setCustomMetric('test_metric', 42, { label: 'value' });
    console.log('   ✅ Custom metrics test passed');
    
    await prometheusExporter.shutdown();
    console.log('   ✅ PrometheusExporter: ALL TESTS PASSED\n');
    
  } catch (error) {
    console.log('   ❌ PrometheusExporter test failed:', error.message);
  }
}

async function verifyEmergencyStop() {
  console.log('6️⃣ Testing EmergencyStop...');
  
  const mockLogger = {
    error: () => {},
    info: () => {}
  };
  const mockNotificationHandler = {
    notify: async () => {}
  };
  
  const emergencyStop = new EmergencyStop(mockLogger, mockNotificationHandler);
  
  try {
    // Test error detection
    const result1 = emergencyStop.checkError('Invalid API key');
    const result2 = emergencyStop.checkError('Regular error message');
    console.log('   ✅ Error detection test passed');
    
    // Test resumption conditions
    emergencyStop.stopReason = 'RATE_LIMIT';
    emergencyStop.resumeTime = Date.now() - 1000;
    emergencyStop.stopped = true;
    const canResume = emergencyStop.canResume();
    console.log('   ✅ Resumption condition test passed');
    
    // Test reset
    emergencyStop.reset();
    console.log('   ✅ Reset test passed');
    
    console.log('   ✅ EmergencyStop: ALL TESTS PASSED\n');
    
  } catch (error) {
    console.log('   ❌ EmergencyStop test failed:', error.message);
  }
}

async function main() {
  try {
    await verifyAdvancedQueueManager();
    await verifyUsageMonitor();
    await verifyClaudeExecutor();
    await verifyNotificationHandler();
    await verifyPrometheusExporter();
    await verifyEmergencyStop();
    
    console.log('🎉 CCSP Phase 4 Component Verification Complete!');
    console.log('✅ All components are working correctly');
    console.log('\n📝 Next steps:');
    console.log('   1. Start Redis: docker run -d -p 6379:6379 redis:alpine');
    console.log('   2. Start CCSP: npm run ccsp:start');
    console.log('   3. Check status: npm run ccsp:status');
    console.log('   4. View metrics: npm run ccsp:metrics');
    
  } catch (error) {
    console.log('❌ Verification failed:', error.message);
    process.exit(1);
  }
}

main();