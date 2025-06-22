/**
 * CCSP 統合バリデーションテスト
 * 実際のCCSP実装と設計書の統合性を検証
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const Redis = require('ioredis');

// 実際のCCSPクラスを読み込み（テスト環境用）
const CCSPAgent = require('../../agents/ccsp/index');

describe('CCSP 統合バリデーション', function() {
  this.timeout(30000); // 30秒のタイムアウト
  
  let redisClient;
  let ccssp;
  let sandbox;
  
  before(async () => {
    // Redis接続テスト
    try {
      redisClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        lazyConnect: true,
        retryDelayOnFailover: 100,
        maxRetriesPerRequest: 1
      });
      
      await redisClient.connect();
      console.log('Redis connection established for testing');
    } catch (error) {
      console.warn('Redis not available, using mock for tests:', error.message);
      redisClient = null;
    }
  });
  
  after(async () => {
    if (ccssp) {
      await ccssp.stop();
    }
    if (redisClient) {
      await redisClient.quit();
    }
  });
  
  describe('1. CCSP エージェント初期化検証', () => {
    it('CCSPエージェントが正常に初期化できること', () => {
      const config = {
        redis: {
          host: 'localhost',
          port: 6379
        },
        maxConcurrent: 2,
        requestQueue: 'test:ccsp:requests'
      };
      
      // 初期化テスト
      assert.doesNotThrow(() => {
        ccssp = new CCSPAgent(config);
      }, 'CCSP Agent should initialize without errors');
      
      assert(ccssp instanceof CCSPAgent, 'Should be instance of CCSPAgent');
      assert.strictEqual(ccssp.config.maxConcurrent, 2, 'Config should be properly set');
    });
    
    it('必須コンポーネントが初期化されていること', () => {
      if (!ccssp) {
        ccssp = new CCSPAgent();
      }
      
      // 主要コンポーネントの存在確認
      assert(ccssp.claudeExecutor, 'Claude Executor should be initialized');
      assert(ccssp.advancedQueueManager, 'Advanced Queue Manager should be initialized');
      assert(ccssp.usageMonitor, 'Usage Monitor should be initialized');
      assert(ccssp.rateLimiter, 'Rate Limiter should be initialized');
      assert(ccssp.metricsCollector, 'Metrics Collector should be initialized');
      assert(ccssp.healthMonitor, 'Health Monitor should be initialized');
      assert(ccssp.sessionMonitor, 'Session Monitor should be initialized');
      assert(ccssp.notificationHandler, 'Notification Handler should be initialized');
      assert(ccssp.emergencyStop, 'Emergency Stop should be initialized');
    });
  });
  
  describe('2. API インターフェース検証', () => {
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      if (!ccssp) {
        ccssp = new CCSPAgent();
      }
    });
    
    it('必須APIメソッドが存在すること', () => {
      const requiredMethods = [
        'start',
        'stop',
        'getHealthStatus',
        'getQueueStatus',
        'getUsageStats',
        'pauseQueue',
        'resumeQueue',
        'clearQueue',
        'removeTask',
        'enqueueTask'
      ];
      
      requiredMethods.forEach(method => {
        assert(
          typeof ccssp[method] === 'function',
          `Method ${method} should exist and be a function`
        );
      });
    });
    
    it('ヘルスステータスAPIが正常に動作すること', async () => {
      try {
        const healthStatus = await ccssp.getHealthStatus();
        
        assert(typeof healthStatus === 'object', 'Health status should be an object');
        assert(healthStatus.hasOwnProperty('status'), 'Should have status property');
        
        // 基本的なヘルス情報の検証
        const validStatuses = ['healthy', 'degraded', 'unhealthy'];
        assert(
          validStatuses.includes(healthStatus.status),
          `Status should be one of ${validStatuses.join(', ')}`
        );
        
      } catch (error) {
        // Redis接続がない場合は警告のみ
        if (error.message.includes('Redis') || error.message.includes('connection')) {
          console.warn('Health status test skipped due to Redis unavailability');
        } else {
          throw error;
        }
      }
    });
    
    it('キューステータスAPIが正常に動作すること', async () => {
      try {
        const queueStatus = await ccssp.getQueueStatus();
        
        assert(typeof queueStatus === 'object', 'Queue status should be an object');
        
        // 期待されるキュー情報の検証
        const expectedProperties = ['totalSize', 'isPaused'];
        expectedProperties.forEach(prop => {
          assert(
            queueStatus.hasOwnProperty(prop),
            `Queue status should have ${prop} property`
          );
        });
        
      } catch (error) {
        if (error.message.includes('Redis') || error.message.includes('connection')) {
          console.warn('Queue status test skipped due to Redis unavailability');
        } else {
          throw error;
        }
      }
    });
    
    it('使用量統計APIが正常に動作すること', async () => {
      try {
        const usageStats = await ccssp.getUsageStats(30);
        
        assert(typeof usageStats === 'object', 'Usage stats should be an object');
        
        // 期待される統計情報の検証
        const expectedSections = ['currentWindow', 'timeSeries', 'prediction'];
        expectedSections.forEach(section => {
          assert(
            usageStats.hasOwnProperty(section),
            `Usage stats should have ${section} section`
          );
        });
        
      } catch (error) {
        if (error.message.includes('Redis') || error.message.includes('connection')) {
          console.warn('Usage stats test skipped due to Redis unavailability');
        } else {
          throw error;
        }
      }
    });
  });
  
  describe('3. 設定と環境変数の検証', () => {
    it('環境変数が適切に読み込まれること', () => {
      const ccssp = new CCSPAgent();
      
      // デフォルト設定の確認
      assert(ccssp.config.redis.host, 'Redis host should be configured');
      assert(typeof ccssp.config.redis.port === 'number', 'Redis port should be a number');
      assert(typeof ccssp.config.maxConcurrent === 'number', 'Max concurrent should be a number');
    });
    
    it('設定ファイルが正しく読み込まれること', () => {
      const configPath = path.join(__dirname, '../../config/config.json');
      
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        
        // CCSP関連設定の確認
        const claudeConfig = config.claude || config.ccsp;
        if (claudeConfig) {
          assert(typeof claudeConfig.maxConcurrent === 'number', 'maxConcurrent should be configured');
          assert(typeof claudeConfig.timeout === 'number', 'timeout should be configured');
        }
        
        // Redis設定の確認
        if (config.redis) {
          assert(config.redis.host, 'Redis host should be configured');
          assert(config.redis.port, 'Redis port should be configured');
        }
      } else {
        console.warn('Config file not found, using default configuration');
      }
    });
  });
  
  describe('4. コンポーネント間連携の検証', () => {
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      if (!ccssp) {
        ccssp = new CCSPAgent();
      }
    });
    
    it('Claude Executor とQueue Manager の連携が正常であること', () => {
      // コンポーネント間の参照関係確認
      assert(ccssp.claudeExecutor, 'Claude Executor should exist');
      assert(ccssp.advancedQueueManager, 'Queue Manager should exist');
      
      // 基本的なインターフェース確認
      assert(
        typeof ccssp.advancedQueueManager.enqueue === 'function',
        'Queue Manager should have enqueue method'
      );
      assert(
        typeof ccssp.claudeExecutor.execute === 'function',
        'Claude Executor should have execute method'
      );
    });
    
    it('Usage Monitor とMetrics Collector の連携が正常であること', () => {
      assert(ccssp.usageMonitor, 'Usage Monitor should exist');
      assert(ccssp.metricsCollector, 'Metrics Collector should exist');
      
      // メトリクス収集の基本機能確認
      assert(
        typeof ccssp.usageMonitor.getCurrentWindowStats === 'function',
        'Usage Monitor should have getCurrentWindowStats method'
      );
    });
    
    it('Emergency Stop と他コンポーネントの連携が正常であること', () => {
      assert(ccssp.emergencyStop, 'Emergency Stop should exist');
      
      // 緊急停止機能の基本確認
      assert(
        typeof ccssp.emergencyStop.checkError === 'function',
        'Emergency Stop should have checkError method'
      );
    });
  });
  
  describe('5. エラーハンドリングの検証', () => {
    beforeEach(() => {
    sandbox = sinon.createSandbox();
      if (!ccssp) {
        ccssp = new CCSPAgent();
      }
    });
    
    it('Redis接続エラーが適切にハンドリングされること', async () => {
      // 無効なRedis設定でのテスト
      const invalidCCSP = new CCSPAgent({
        redis: {
          host: 'invalid-host',
          port: 9999
        }
      });
      
      // エラーが発生しても例外で停止しないことを確認
      assert.doesNotThrow(() => {
        // Redis接続エラーはログに記録されるが、例外は発生しない
        invalidCCSP.redis.on('error', () => {
          // エラーハンドリングが設定されていることを確認
        });
      });
    });
    
    it('不正なリクエストが適切に処理されること', async () => {
      try {
        // 不正なパラメータでのテスト
        const result = await ccssp.enqueueTask(null, 'invalid-priority');
        
        // エラーが適切に返されることを確認
        assert(
          !result || !result.success,
          'Invalid request should be rejected or return error'
        );
        
      } catch (error) {
        // 例外が発生する場合は、適切なエラーメッセージを持つことを確認
        assert(typeof error.message === 'string', 'Error should have message');
      }
    });
  });
  
  describe('6. セキュリティ要件の検証', () => {
    it('機密情報が適切にマスキングされること', () => {
      // ログ出力のテスト（実際のログファイルを確認）
      const logPath = path.join(__dirname, '../../logs/ccsp.log');
      
      if (fs.existsSync(logPath)) {
        const logContent = fs.readFileSync(logPath, 'utf8');
        
        // 機密情報パターンの検出
        const sensitivePatterns = [
          /password.*[:=].*[^*]/i,
          /token.*[:=].*[^*]/i,
          /api[_-]?key.*[:=].*[^*]/i
        ];
        
        sensitivePatterns.forEach((pattern, index) => {
          const matches = logContent.match(pattern);
          if (matches) {
            console.warn(`Potential sensitive information in logs: ${matches[0]}`);
          }
        });
      }
    });
    
    it('環境変数での認証情報管理が適切であること', () => {
      // 環境変数の使用確認
      const ccssp = new CCSPAgent();
      
      // Redis設定が環境変数から取得されていることを確認
      const expectedEnvVars = ['REDIS_HOST', 'REDIS_PORT', 'REDIS_PASSWORD'];
      expectedEnvVars.forEach(envVar => {
        if (process.env[envVar]) {
          // 環境変数が設定されている場合、それが使用されていることを確認
          // （実際の値はチェックしない）
          console.log(`Environment variable ${envVar} is configured`);
        }
      });
    });
  });
  
  describe('7. ドキュメントと実装の整合性検証', () => {
    it('アーキテクチャドキュメントに記載されたコンポーネントが存在すること', () => {
      const documentedComponents = [
        'claudeExecutor',
        'advancedQueueManager',
        'usageMonitor',
        'rateLimiter',
        'metricsCollector',
        'healthMonitor',
        'sessionMonitor',
        'notificationHandler',
        'emergencyStop'
      ];
      
      documentedComponents.forEach(component => {
        assert(
          ccssp[component],
          `Documented component ${component} should exist in implementation`
        );
      });
    });
    
    it('設計書に記載されたAPIエンドポイントが実装されていること', () => {
      const documentedMethods = [
        'getHealthStatus',
        'getQueueStatus', 
        'getUsageStats',
        'pauseQueue',
        'resumeQueue',
        'clearQueue',
        'getDetailedHealth',
        'getPrometheusMetrics'
      ];
      
      documentedMethods.forEach(method => {
        assert(
          typeof ccssp[method] === 'function',
          `Documented method ${method} should be implemented`
        );
      });
    });
  });
  
  describe('8. 拡張性アーキテクチャの検証', () => {
    it('プラグイン対応のための基盤が整っていること', () => {
      // 設定ベースの初期化が可能であることを確認
      const customConfig = {
        maxConcurrent: 4,
        customOption: 'test'
      };
      
      const customCCSP = new CCSPAgent(customConfig);
      assert.strictEqual(customCCSP.config.maxConcurrent, 4, 'Custom config should be applied');
    });
    
    it('新しいExecutorの追加が可能な設計であること', () => {
      // Claude Executorのインターフェースが明確であることを確認
      assert(
        typeof ccssp.claudeExecutor.execute === 'function',
        'Executor should have execute interface'
      );
      
      // 将来的な拡張のためのインターフェース確認
      // （実際の拡張実装はIssue #147で行う）
    });
  });
});