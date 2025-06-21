/**
 * CCSP Phase 4 統合テスト
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 */

const assert = require('assert');
const path = require('path');
const CCSPAgent = require('../../agents/ccsp/index');
const AdvancedQueueManager = require('../../agents/ccsp/advanced-queue-manager');
const UsageMonitor = require('../../agents/ccsp/usage-monitor');
const ClaudeExecutor = require('../../agents/ccsp/claude-executor');
const NotificationHandler = require('../../agents/ccsp/notification-handler');
const PrometheusExporter = require('../../agents/ccsp/prometheus-exporter');
const EmergencyStop = require('../../agents/ccsp/emergency-stop');
const CCSPManagementAPI = require('../../agents/ccsp/management-api');

// Set Jest timeout to 30 seconds
jest.setTimeout(30000);

describe('CCSP Phase 4 - Advanced Control and Monitoring', () => {
  
  describe('AdvancedQueueManager', () => {
    let queueManager;
    
    beforeEach(() => {
      queueManager = new AdvancedQueueManager({
        maxQueueSize: 100,
        schedulerInterval: 1000
      });
    });
    
    afterEach(async () => {
      if (queueManager) {
        await queueManager.shutdown();
      }
    });
    
    it('should enqueue tasks with different priorities', async function() {
      const tasks = [
        { prompt: 'Task 1', agent: 'test' },
        { prompt: 'Task 2', agent: 'test' },
        { prompt: 'Task 3', agent: 'test' }
      ];
      
      const id1 = await queueManager.enqueue(tasks[0], 'urgent');
      const id2 = await queueManager.enqueue(tasks[1], 'normal');
      const id3 = await queueManager.enqueue(tasks[2], 'low');
      
      assert(typeof id1 === 'string');
      assert(typeof id2 === 'string');
      assert(typeof id3 === 'string');
      
      const status = queueManager.getStatus();
      assert.equal(status.queues.urgent.size, 1);
      assert.equal(status.queues.normal.size, 1);
      assert.equal(status.queues.low.size, 1);
    });
    
    it('should dequeue tasks in priority order', async function() {
      await queueManager.enqueue({ prompt: 'Low task', agent: 'test' }, 'low');
      await queueManager.enqueue({ prompt: 'Urgent task', agent: 'test' }, 'urgent');
      await queueManager.enqueue({ prompt: 'Normal task', agent: 'test' }, 'normal');
      
      const task1 = await queueManager.dequeue();
      const task2 = await queueManager.dequeue();
      const task3 = await queueManager.dequeue();
      
      assert.equal(task1.priority, 'urgent');
      assert.equal(task2.priority, 'normal');
      assert.equal(task3.priority, 'low');
    });
    
    it('should handle scheduled tasks', async function() {
      const executeAt = new Date(Date.now() + 2000); // 2秒後
      const taskId = await queueManager.enqueue(
        { prompt: 'Scheduled task', agent: 'test' },
        'normal',
        executeAt
      );
      
      const status = queueManager.getStatus();
      assert.equal(status.queues.scheduled.size, 1);
      
      // スケジューラーが動作するまで待機
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const updatedStatus = queueManager.getStatus();
      assert.equal(updatedStatus.queues.scheduled.size, 0);
      assert.equal(updatedStatus.queues.normal.size, 1);
    });
    
    it('should pause and resume queue processing', async function() {
      await queueManager.enqueue({ prompt: 'Test task', agent: 'test' }, 'normal');
      
      queueManager.pause();
      const pausedTask = await queueManager.dequeue();
      assert.equal(pausedTask, null);
      
      queueManager.resume();
      const resumedTask = await queueManager.dequeue();
      assert(resumedTask !== null);
      assert.equal(resumedTask.prompt, 'Test task');
    });
  });
  
  describe('UsageMonitor', function() {
    let usageMonitor;
    
    beforeEach(function() {
      usageMonitor = new UsageMonitor({
        windowSize: 60000, // 1分
        alertThreshold: 0.8
      });
    });
    
    afterEach(async function() {
      if (usageMonitor) {
        await usageMonitor.shutdown();
      }
    });
    
    it('should record API usage', function() {
      usageMonitor.recordUsage({
        agent: 'test-agent',
        requestId: 'req-1',
        success: true,
        responseTime: 1000
      });
      
      const stats = usageMonitor.getCurrentWindowStats();
      assert.equal(stats.requests, 1);
      assert.equal(stats.successCount, 1);
      assert.equal(stats.errorCount, 0);
    });
    
    it('should track agent-specific statistics', function() {
      usageMonitor.recordUsage({
        agent: 'agent-a',
        requestId: 'req-1',
        success: true,
        responseTime: 500
      });
      
      usageMonitor.recordUsage({
        agent: 'agent-b',
        requestId: 'req-2',
        success: false,
        responseTime: 1000,
        error: 'Test error'
      });
      
      const agentAStats = usageMonitor.getAgentStats('agent-a');
      const agentBStats = usageMonitor.getAgentStats('agent-b');
      
      assert.equal(agentAStats.totalRequests, 1);
      assert.equal(agentAStats.successCount, 1);
      assert.equal(agentBStats.totalRequests, 1);
      assert.equal(agentBStats.errorCount, 1);
    });
    
    it('should predict usage patterns', function() {
      // 複数の使用量データを記録
      for (let i = 0; i < 10; i++) {
        usageMonitor.recordUsage({
          agent: 'test-agent',
          requestId: `req-${i}`,
          success: true,
          responseTime: 500 + (i * 100)
        });
      }
      
      const prediction = usageMonitor.predictUsage(30);
      
      assert(prediction.prediction !== null);
      assert(typeof prediction.confidence === 'number');
      assert(['increasing', 'decreasing', 'stable'].includes(prediction.trend));
    });
  });
  
  describe('ClaudeExecutor', function() {
    let claudeExecutor;
    
    beforeEach(function() {
      claudeExecutor = new ClaudeExecutor({
        maxRetries: 2,
        timeout: 10000
      });
    });
    
    afterEach(async function() {
      if (claudeExecutor) {
        await claudeExecutor.shutdown();
      }
    });
    
    it('should analyze error types correctly', function() {
      const sessionError = claudeExecutor.analyzeError('Invalid API key');
      const rateLimitError = claudeExecutor.analyzeError('Rate limit exceeded');
      const networkError = claudeExecutor.analyzeError('Network timeout');
      
      assert.equal(sessionError, 'SESSION_TIMEOUT');
      assert.equal(rateLimitError, 'RATE_LIMIT');
      assert.equal(networkError, 'NETWORK_ERROR');
    });
    
    it('should enhance prompts with API warnings', function() {
      const originalPrompt = 'Test prompt';
      const enhancedPrompt = claudeExecutor.enhancePrompt(originalPrompt);
      
      assert(enhancedPrompt.includes('Claude API'));
      assert(enhancedPrompt.includes('CCSP'));
      assert(enhancedPrompt.includes(originalPrompt));
    });
    
    it('should track execution statistics', function() {
      claudeExecutor.stats.totalExecutions = 10;
      claudeExecutor.stats.successCount = 8;
      claudeExecutor.stats.errorCount = 2;
      
      const stats = claudeExecutor.getStats();
      
      assert.equal(stats.totalExecutions, 10);
      assert.equal(stats.successRate, 0.8);
      assert.equal(stats.errorRate, 0.2);
    });
  });
  
  describe('NotificationHandler', function() {
    let notificationHandler;
    
    beforeEach(function() {
      notificationHandler = new NotificationHandler({
        enableGitHub: false, // テストでは無効化
        enableSlack: false,
        enableEmail: false
      });
    });
    
    afterEach(async function() {
      if (notificationHandler) {
        await notificationHandler.shutdown();
      }
    });
    
    it('should select appropriate channels based on severity', function() {
      const criticalChannels = notificationHandler.selectChannels('error', 'critical');
      const infoChannels = notificationHandler.selectChannels('info', 'info');
      
      assert(Array.isArray(criticalChannels));
      assert(Array.isArray(infoChannels));
      assert(criticalChannels.includes('log'));
      assert(infoChannels.includes('log'));
    });
    
    it('should generate GitHub titles correctly', function() {
      const title1 = notificationHandler.generateGitHubTitle('session_timeout', 'critical');
      const title2 = notificationHandler.generateGitHubTitle('usage_alert', 'warning');
      
      assert(title1.includes('セッションタイムアウト'));
      assert(title1.includes('💥'));
      assert(title2.includes('使用量アラート'));
      assert(title2.includes('⚠️'));
    });
    
    it('should generate appropriate GitHub labels', function() {
      const labels = notificationHandler.generateGitHubLabels('session_timeout', 'critical');
      
      assert(labels.includes('ccsp'));
      assert(labels.includes('automated'));
      assert(labels.includes('urgent'));
      assert(labels.includes('session-timeout'));
      assert(labels.includes('requires-manual-action'));
    });
    
    it('should maintain notification history', async function() {
      await notificationHandler.notify({
        type: 'test',
        title: 'Test Notification',
        message: 'Test message',
        severity: 'info',
        channels: ['log']
      });
      
      const history = notificationHandler.getHistory();
      assert.equal(history.length, 1);
      assert.equal(history[0].type, 'test');
      assert.equal(history[0].title, 'Test Notification');
    });
  });
  
  describe('PrometheusExporter', function() {
    let prometheusExporter;
    
    beforeEach(function() {
      prometheusExporter = new PrometheusExporter();
    });
    
    afterEach(async function() {
      if (prometheusExporter) {
        await prometheusExporter.shutdown();
      }
    });
    
    it('should record API usage metrics', function() {
      prometheusExporter.recordAPIUsage({
        agent: 'test-agent',
        success: true,
        responseTime: 1000,
        rateLimited: false
      });
      
      assert.equal(prometheusExporter.metrics.requests_total, 1);
      assert.equal(prometheusExporter.metrics.requests_success_total, 1);
      assert.equal(prometheusExporter.metrics.requests_error_total, 0);
    });
    
    it('should update queue size metrics', function() {
      prometheusExporter.incrementQueueSize('urgent');
      prometheusExporter.incrementQueueSize('normal');
      prometheusExporter.decrementQueueSize('urgent');
      
      assert.equal(prometheusExporter.metrics.queue_size.urgent, 0);
      assert.equal(prometheusExporter.metrics.queue_size.normal, 1);
    });
    
    it('should generate Prometheus format metrics', async function() {
      prometheusExporter.recordAPIUsage({
        agent: 'test-agent',
        success: true,
        responseTime: 1000
      });
      
      const metrics = await prometheusExporter.getMetrics();
      
      assert(typeof metrics === 'string');
      assert(metrics.includes('ccsp_requests_total'));
      assert(metrics.includes('ccsp_uptime_seconds'));
      assert(metrics.includes('ccsp_queue_size'));
    });
    
    it('should set custom metrics', function() {
      prometheusExporter.setCustomMetric('test_metric', 42, { label: 'value' });
      
      assert(prometheusExporter.metrics.custom);
      const customKeys = Object.keys(prometheusExporter.metrics.custom);
      assert(customKeys.length > 0);
    });
  });
  
  describe('EmergencyStop', function() {
    let emergencyStop;
    let mockLogger;
    let mockNotificationHandler;
    
    beforeEach(function() {
      mockLogger = {
        error: function() {},
        info: function() {}
      };
      mockNotificationHandler = {
        notify: async function() {}
      };
      
      emergencyStop = new EmergencyStop(mockLogger, mockNotificationHandler);
    });
    
    it('should detect session timeout errors', function() {
      const result1 = emergencyStop.checkError('Invalid API key');
      const result2 = emergencyStop.checkError('Please run /login');
      const result3 = emergencyStop.checkError('Regular error message');
      
      assert(result1);
      assert.equal(emergencyStop.stopReason, 'SESSION_TIMEOUT');
      assert(result2);
      assert(!result3);
    });
    
    it('should detect rate limit errors', function() {
      const result = emergencyStop.checkError('Claude AI usage limit reached|1234567890');
      
      assert(result);
      assert.equal(emergencyStop.stopReason, 'RATE_LIMIT');
      assert(emergencyStop.resumeTime);
    });
    
    it('should check resumption conditions', function() {
      // Session timeout requires manual intervention
      emergencyStop.stopReason = 'SESSION_TIMEOUT';
      emergencyStop.stopped = true;
      assert(!emergencyStop.canResume());
      
      // Rate limit can be resumed after time
      emergencyStop.stopReason = 'RATE_LIMIT';
      emergencyStop.resumeTime = Date.now() - 1000; // Past time
      assert(emergencyStop.canResume());
      
      emergencyStop.resumeTime = Date.now() + 1000; // Future time
      assert(!emergencyStop.canResume());
    });
  });
  
  describe('CCSPAgent Integration', function() {
    let ccspAgent;
    
    beforeEach(async function() {
      // テスト用設定
      ccspAgent = new CCSPAgent({
        port: 3004, // テスト用ポート
        redisHost: 'localhost',
        redisPort: 6379,
        maxConcurrentRequests: 2,
        enableMetrics: true,
        enableDashboard: false, // テストでは無効化
        autoOptimization: false
      });
    });
    
    afterEach(async function() {
      if (ccspAgent) {
        await ccspAgent.shutdown();
      }
    });
    
    it('should initialize all components', function() {
      assert(ccspAgent.queueManager);
      assert(ccspAgent.usageMonitor);
      assert(ccspAgent.claudeExecutor);
      assert(ccspAgent.notificationHandler);
      assert(ccspAgent.emergencyStop);
      assert(ccspAgent.prometheusExporter);
    });
    
    it('should provide API methods', async function() {
      const queueStatus = await ccspAgent.getQueueStatus();
      const healthStatus = await ccspAgent.getHealthStatus();
      const usageStats = await ccspAgent.getUsageStats();
      
      assert(typeof queueStatus === 'object');
      assert(typeof healthStatus === 'object');
      assert(Array.isArray(usageStats));
      
      assert(queueStatus.hasOwnProperty('isPaused'));
      assert(healthStatus.hasOwnProperty('status'));
    });
    
    it('should handle throttling configuration', async function() {
      const throttleConfig = await ccspAgent.setThrottling({
        enabled: true,
        delay: 2000,
        mode: 'adaptive'
      });
      
      assert(throttleConfig.enabled);
      assert.equal(throttleConfig.delay, 2000);
      assert.equal(throttleConfig.mode, 'adaptive');
    });
    
    it('should set agent priorities', async function() {
      await ccspAgent.setAgentPriority('test-agent', 'high');
      
      const config = await ccspAgent.getConfig();
      assert(config.agentPriorities);
      assert.equal(config.agentPriorities['test-agent'], 'high');
    });
    
    it('should generate Prometheus metrics', async function() {
      const metrics = await ccspAgent.getPrometheusMetrics();
      
      assert(typeof metrics === 'string');
      assert(metrics.includes('ccsp_'));
    });
  });
  
  describe('Management API', function() {
    let managementAPI;
    let mockCCSPAgent;
    
    beforeEach(function() {
      mockCCSPAgent = {
        getQueueStatus: async function() {
          return { isPaused: false, totalQueueSize: 0 };
        },
        pauseQueue: async function() {},
        resumeQueue: async function() {},
        clearQueue: async function() { return { cleared: 0 }; },
        getUsageStats: async function() { return []; },
        getHealthStatus: async function() {
          return { status: 'healthy' };
        }
      };
      
      managementAPI = new CCSPManagementAPI(mockCCSPAgent);
    });
    
    it('should provide Express router', function() {
      const router = managementAPI.getRouter();
      assert(router);
      assert(typeof router === 'function');
    });
    
    it('should handle errors gracefully', function() {
      const mockRes = {
        status: function(code) {
          this.statusCode = code;
          return this;
        },
        json: function(data) {
          this.jsonData = data;
          return this;
        }
      };
      
      const error = new Error('Test error');
      managementAPI.handleError(mockRes, error, 'Test message');
      
      assert.equal(mockRes.statusCode, 500);
      assert(mockRes.jsonData.success === false);
      assert.equal(mockRes.jsonData.error, 'Test message');
    });
  });
});

// 統合テスト用のヘルパー関数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Redis接続テスト（オプション）
describe('Redis Integration (Optional)', function() {
  it('should connect to Redis if available', async function() {
    try {
      const Redis = require('redis');
      const client = Redis.createClient({
        host: 'localhost',
        port: 6379,
        connectTimeout: 1000
      });
      
      await client.connect();
      await client.ping();
      await client.disconnect();
      
      console.log('Redis connection test: PASSED');
    } catch (error) {
      console.log('Redis connection test: SKIPPED (Redis not available)');
      this.skip();
    }
  });
});