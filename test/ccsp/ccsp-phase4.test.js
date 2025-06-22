/**
 * CCSP Phase 4 統合テスト
 * 
 * Issue #142: CCSPの高度な制御機能とモニタリング実装
 */

const { expect } = require('chai');
const sinon = require('sinon');
const path = require('path');
const CCSPAgent = require('../../agents/ccsp/index');
const AdvancedQueueManager = require('../../agents/ccsp/advanced-queue-manager');
const UsageMonitor = require('../../agents/ccsp/usage-monitor');
const ClaudeExecutor = require('../../agents/ccsp/claude-executor');
const NotificationHandler = require('../../agents/ccsp/notification-handler');
const PrometheusExporter = require('../../agents/ccsp/prometheus-exporter');
const EmergencyStop = require('../../agents/ccsp/emergency-stop');
const CCSPManagementAPI = require('../../agents/ccsp/management-api');

// Set Mocha timeout to 30 seconds (handled by this.timeout() in individual tests)

describe('CCSP Phase 4 - Advanced Control and Monitoring', () => {
  
  describe('AdvancedQueueManager', () => {
    let queueManager;
    let sandbox;
    
    beforeEach(() => {
      sandbox = sinon.createSandbox();
      queueManager = new AdvancedQueueManager({
        maxQueueSize: 100,
        schedulerInterval: 1000
      });
    });
    
    afterEach(async () => {
      if (queueManager) {
        await queueManager.shutdown();
      }
      sandbox.restore();
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
      
      expect(typeof id1).to.equal('string');
      expect(typeof id2).to.equal('string');
      expect(typeof id3).to.equal('string');
      
      const status = queueManager.getStatus();
      expect(status.queues.urgent.size).to.equal(1);
      expect(status.queues.normal.size).to.equal(1);
      expect(status.queues.low.size).to.equal(1);
    });
    
    it('should dequeue tasks in priority order', async function() {
      await queueManager.enqueue({ prompt: 'Low task', agent: 'test' }, 'low');
      await queueManager.enqueue({ prompt: 'Urgent task', agent: 'test' }, 'urgent');
      await queueManager.enqueue({ prompt: 'Normal task', agent: 'test' }, 'normal');
      
      const task1 = await queueManager.dequeue();
      const task2 = await queueManager.dequeue();
      const task3 = await queueManager.dequeue();
      
      expect(task1.priority).to.equal('urgent');
      expect(task2.priority).to.equal('normal');
      expect(task3.priority).to.equal('low');
    });
    
    it('should handle scheduled tasks', async function() {
      const executeAt = new Date(Date.now() + 2000); // 2秒後
      const taskId = await queueManager.enqueue(
        { prompt: 'Scheduled task', agent: 'test' },
        'normal',
        executeAt
      );
      
      const status = queueManager.getStatus();
      expect(status.queues.scheduled.size).to.equal( 1);
      
      // スケジューラーが動作するまで待機
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const updatedStatus = queueManager.getStatus();
      expect(updatedStatus.queues.scheduled.size).to.equal( 0);
      expect(updatedStatus.queues.normal.size).to.equal( 1);
    });
    
    it('should pause and resume queue processing', async function() {
      await queueManager.enqueue({ prompt: 'Test task', agent: 'test' }, 'normal');
      
      queueManager.pause();
      const pausedTask = await queueManager.dequeue();
      expect(pausedTask).to.equal( null);
      
      queueManager.resume();
      const resumedTask = await queueManager.dequeue();
      expect(resumedTask !== null).to.be.true;
      expect(resumedTask.prompt).to.equal( 'Test task');
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
      expect(stats.requests).to.equal( 1);
      expect(stats.successCount).to.equal( 1);
      expect(stats.errorCount).to.equal( 0);
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
      
      expect(agentAStats.totalRequests).to.equal( 1);
      expect(agentAStats.successCount).to.equal( 1);
      expect(agentBStats.totalRequests).to.equal( 1);
      expect(agentBStats.errorCount).to.equal( 1);
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
      
      expect(prediction.prediction !== null).to.be.true;
      expect(typeof prediction.confidence === 'number').to.be.true;
      expect(['increasing', 'decreasing', 'stable'].includes(prediction.trend)).to.be.true;
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
      
      expect(sessionError).to.equal( 'SESSION_TIMEOUT');
      expect(rateLimitError).to.equal( 'RATE_LIMIT');
      expect(networkError).to.equal( 'NETWORK_ERROR');
    });
    
    it('should enhance prompts with API warnings', function() {
      const originalPrompt = 'Test prompt';
      const enhancedPrompt = claudeExecutor.enhancePrompt(originalPrompt);
      
      expect(enhancedPrompt.includes('Claude API')).to.be.true;
      expect(enhancedPrompt.includes('CCSP')).to.be.true;
      expect(enhancedPrompt.includes(originalPrompt)).to.be.true;
    });
    
    it('should track execution statistics', function() {
      claudeExecutor.stats.totalExecutions = 10;
      claudeExecutor.stats.successCount = 8;
      claudeExecutor.stats.errorCount = 2;
      
      const stats = claudeExecutor.getStats();
      
      expect(stats.totalExecutions).to.equal( 10);
      expect(stats.successRate).to.equal( 0.8);
      expect(stats.errorRate).to.equal( 0.2);
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
      
      expect(Array.isArray(criticalChannels)).to.be.true;
      expect(Array.isArray(infoChannels)).to.be.true;
      expect(criticalChannels.includes('log')).to.be.true;
      expect(infoChannels.includes('log')).to.be.true;
    });
    
    it('should generate GitHub titles correctly', function() {
      const title1 = notificationHandler.generateGitHubTitle('session_timeout', 'critical');
      const title2 = notificationHandler.generateGitHubTitle('usage_alert', 'warning');
      
      expect(title1.includes('セッションタイムアウト')).to.be.true;
      expect(title1.includes('💥')).to.be.true;
      expect(title2.includes('使用量アラート')).to.be.true;
      expect(title2.includes('⚠️')).to.be.true;
    });
    
    it('should generate appropriate GitHub labels', function() {
      const labels = notificationHandler.generateGitHubLabels('session_timeout', 'critical');
      
      expect(labels.includes('ccsp')).to.be.true;
      expect(labels.includes('automated')).to.be.true;
      expect(labels.includes('urgent')).to.be.true;
      expect(labels.includes('session-timeout')).to.be.true;
      expect(labels.includes('requires-manual-action')).to.be.true;
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
      expect(history.length).to.equal( 1);
      expect(history[0].type).to.equal( 'test');
      expect(history[0].title).to.equal( 'Test Notification');
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
      
      expect(prometheusExporter.metrics.requests_total).to.equal( 1);
      expect(prometheusExporter.metrics.requests_success_total).to.equal( 1);
      expect(prometheusExporter.metrics.requests_error_total).to.equal( 0);
    });
    
    it('should update queue size metrics', function() {
      prometheusExporter.incrementQueueSize('urgent');
      prometheusExporter.incrementQueueSize('normal');
      prometheusExporter.decrementQueueSize('urgent');
      
      expect(prometheusExporter.metrics.queue_size.urgent).to.equal( 0);
      expect(prometheusExporter.metrics.queue_size.normal).to.equal( 1);
    });
    
    it('should generate Prometheus format metrics', async function() {
      prometheusExporter.recordAPIUsage({
        agent: 'test-agent',
        success: true,
        responseTime: 1000
      });
      
      const metrics = await prometheusExporter.getMetrics();
      
      expect(typeof metrics === 'string').to.be.true;
      expect(metrics.includes('ccsp_requests_total')).to.be.true;
      expect(metrics.includes('ccsp_uptime_seconds')).to.be.true;
      expect(metrics.includes('ccsp_queue_size')).to.be.true;
    });
    
    it('should set custom metrics', function() {
      prometheusExporter.setCustomMetric('test_metric', 42, { label: 'value' });
      
      expect(prometheusExporter.metrics.custom).to.be.true;
      const customKeys = Object.keys(prometheusExporter.metrics.custom);
      expect(customKeys.length > 0).to.be.true;
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
      
      expect(result1).to.be.true;
      expect(emergencyStop.stopReason).to.equal( 'SESSION_TIMEOUT');
      expect(result2).to.be.true;
      expect(result3).to.be.false;
    });
    
    it('should detect rate limit errors', function() {
      const result = emergencyStop.checkError('Claude AI usage limit reached|1234567890');
      
      expect(result).to.be.true;
      expect(emergencyStop.stopReason).to.equal( 'RATE_LIMIT');
      expect(emergencyStop.resumeTime).to.be.true;
    });
    
    it('should check resumption conditions', function() {
      // Session timeout requires manual intervention
      emergencyStop.stopReason = 'SESSION_TIMEOUT';
      emergencyStop.stopped = true;
      expect(emergencyStop.canResume()).to.be.false;
      
      // Rate limit can be resumed after time
      emergencyStop.stopReason = 'RATE_LIMIT';
      emergencyStop.resumeTime = Date.now() - 1000; // Past time
      expect(emergencyStop.canResume()).to.be.true;
      
      emergencyStop.resumeTime = Date.now() + 1000; // Future time
      expect(emergencyStop.canResume()).to.be.false;
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
      expect(ccspAgent.queueManager).to.be.true;
      expect(ccspAgent.usageMonitor).to.be.true;
      expect(ccspAgent.claudeExecutor).to.be.true;
      expect(ccspAgent.notificationHandler).to.be.true;
      expect(ccspAgent.emergencyStop).to.be.true;
      expect(ccspAgent.prometheusExporter).to.be.true;
    });
    
    it('should provide API methods', async function() {
      const queueStatus = await ccspAgent.getQueueStatus();
      const healthStatus = await ccspAgent.getHealthStatus();
      const usageStats = await ccspAgent.getUsageStats();
      
      expect(typeof queueStatus === 'object').to.be.true;
      expect(typeof healthStatus === 'object').to.be.true;
      expect(Array.isArray(usageStats)).to.be.true;
      
      expect(queueStatus.hasOwnProperty('isPaused')).to.be.true;
      expect(healthStatus.hasOwnProperty('status')).to.be.true;
    });
    
    it('should handle throttling configuration', async function() {
      const throttleConfig = await ccspAgent.setThrottling({
        enabled: true,
        delay: 2000,
        mode: 'adaptive'
      });
      
      expect(throttleConfig.enabled).to.be.true;
      expect(throttleConfig.delay).to.equal( 2000);
      expect(throttleConfig.mode).to.equal( 'adaptive');
    });
    
    it('should set agent priorities', async function() {
      await ccspAgent.setAgentPriority('test-agent', 'high');
      
      const config = await ccspAgent.getConfig();
      expect(config.agentPriorities).to.be.true;
      expect(config.agentPriorities['test-agent']).to.equal( 'high');
    });
    
    it('should generate Prometheus metrics', async function() {
      const metrics = await ccspAgent.getPrometheusMetrics();
      
      expect(typeof metrics === 'string').to.be.true;
      expect(metrics.includes('ccsp_')).to.be.true;
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
      expect(router).to.be.true;
      expect(typeof router === 'function').to.be.true;
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
      
      expect(mockRes.statusCode).to.equal( 500);
      expect(mockRes.jsonData.success === false).to.be.true;
      expect(mockRes.jsonData.error).to.equal( 'Test message');
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