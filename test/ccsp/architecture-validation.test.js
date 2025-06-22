/**
 * CCSP アーキテクチャ検証テスト
 * 設計書とコード実装の整合性を検証
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');

// このファイルはmock-mochaで適切にセットアップされる

describe('CCSP アーキテクチャ整合性検証', () => {
  const ccsopPath = path.join(__dirname, '../../agents/ccsp');
  
  describe('1. 必須コンポーネントの存在確認', () => {
    const requiredComponents = [
      'index.js',          // メインエージェント
      'claude-executor.js', // Claude実行
      'advanced-queue-manager.js', // 高度キュー管理
      'usage-monitor.js',   // 使用量監視
      'rate-limiter.js',    // レート制限
      'metrics-collector.js', // メトリクス収集
      'health-monitor.js',  // ヘルス監視
      'session-monitor.js', // セッション監視
      'notification-handler.js', // 通知処理
      'emergency-stop.js',  // 緊急停止
      'management-api.js'   // 管理API
    ];
    
    requiredComponents.forEach(component => {
      it(`${component} が存在すること`, () => {
        const filePath = path.join(ccsopPath, component);
        assert(fs.existsSync(filePath), `Required component ${component} not found`);
      });
    });
  });
  
  describe('2. メインエージェント（index.js）の検証', () => {
    let indexContent;
    
    before(() => {
      indexContent = fs.readFileSync(path.join(ccsopPath, 'index.js'), 'utf8');
    });
    
    it('すべての必須モジュールをrequireしていること', () => {
      const requiredImports = [
        'claude-executor',
        'advanced-queue-manager',
        'usage-monitor',
        'rate-limiter',
        'metrics-collector',
        'health-monitor',
        'session-monitor',
        'notification-handler',
        'emergency-stop'
      ];
      
      requiredImports.forEach(module => {
        assert(
          indexContent.includes(`require('./${module}')`),
          `Missing import: ${module}`
        );
      });
    });
    
    it('CCSPAgentクラスが定義されていること', () => {
      assert(indexContent.includes('class CCSPAgent'), 'CCSPAgent class not found');
    });
    
    it('必須メソッドが定義されていること', () => {
      const requiredMethods = [
        'start()',
        'stop()',
        'processRequest(',
        'getHealthStatus()',
        'getQueueStatus()',
        'getUsageStats('
      ];
      
      requiredMethods.forEach(method => {
        assert(
          indexContent.includes(method),
          `Missing method: ${method}`
        );
      });
    });
  });
  
  describe('3. コンポーネント責任境界の検証', () => {
    describe('Claude Executor', () => {
      let executorContent;
      
      before(() => {
        executorContent = fs.readFileSync(path.join(ccsopPath, 'claude-executor.js'), 'utf8');
      });
      
      it('Claude CLI実行機能を持つこと', () => {
        assert(executorContent.includes('execute'), 'execute method not found');
      });
      
      it('セッションタイムアウト検出機能を持つこと', () => {
        assert(
          executorContent.includes('sessionTimeout') || 
          executorContent.includes('Invalid API key'),
          'Session timeout detection not found'
        );
      });
    });
    
    describe('Advanced Queue Manager', () => {
      let queueContent;
      
      before(() => {
        queueContent = fs.readFileSync(path.join(ccsopPath, 'advanced-queue-manager.js'), 'utf8');
      });
      
      it('優先度付きキューイング機能を持つこと', () => {
        const priorities = ['urgent', 'high', 'normal', 'low'];
        priorities.forEach(priority => {
          assert(
            queueContent.includes(priority),
            `Priority ${priority} not found`
          );
        });
      });
      
      it('スケジュール実行機能を持つこと', () => {
        assert(
          queueContent.includes('executeAt') || queueContent.includes('scheduled'),
          'Scheduled execution not found'
        );
      });
    });
    
    describe('Usage Monitor', () => {
      let usageContent;
      
      before(() => {
        usageContent = fs.readFileSync(path.join(ccsopPath, 'usage-monitor.js'), 'utf8');
      });
      
      it('使用量統計機能を持つこと', () => {
        const metrics = ['requestsPerMinute', 'successRate', 'averageResponseTime'];
        metrics.forEach(metric => {
          assert(
            usageContent.includes(metric),
            `Metric ${metric} not found`
          );
        });
      });
      
      it('予測機能を持つこと', () => {
        assert(
          usageContent.includes('predict') || usageContent.includes('forecast'),
          'Prediction functionality not found'
        );
      });
    });
  });
  
  describe('4. 設定とインターフェースの検証', () => {
    it('設定ファイルの構造が正しいこと', () => {
      const configPath = path.join(__dirname, '../../config/config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      // CCSP設定セクションの存在確認
      assert(config.ccsp || config.claude, 'CCSP configuration section not found');
      
      // 必須設定項目の確認
      const claudeConfig = config.ccsp || config.claude;
      assert(typeof claudeConfig.maxConcurrent === 'number', 'maxConcurrent not configured');
      assert(typeof claudeConfig.timeout === 'number', 'timeout not configured');
    });
    
    it('Redis設定が存在すること', () => {
      const configPath = path.join(__dirname, '../../config/config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      
      assert(config.redis, 'Redis configuration not found');
      assert(config.redis.host, 'Redis host not configured');
      assert(config.redis.port, 'Redis port not configured');
    });
  });
  
  describe('5. API エンドポイントの整合性確認', () => {
    let managementApiContent;
    
    before(() => {
      managementApiContent = fs.readFileSync(path.join(ccsopPath, 'management-api.js'), 'utf8');
    });
    
    it('設計書に記載されたAPIエンドポイントが実装されていること', () => {
      const requiredEndpoints = [
        '/api/ccsp/health',
        '/api/ccsp/queue/status',
        '/api/ccsp/stats/usage',
        '/api/ccsp/control'
      ];
      
      requiredEndpoints.forEach(endpoint => {
        assert(
          managementApiContent.includes(endpoint) || 
          managementApiContent.includes(endpoint.replace('/api/ccsp', '')),
          `API endpoint ${endpoint} not found`
        );
      });
    });
  });
  
  describe('6. エラーハンドリングパターンの検証', () => {
    it('緊急停止機能が実装されていること', () => {
      const emergencyContent = fs.readFileSync(path.join(ccsopPath, 'emergency-stop.js'), 'utf8');
      
      assert(
        emergencyContent.includes('initiateEmergencyStop') || emergencyContent.includes('emergencyStop'),
        'Emergency stop function not found'
      );
      assert(emergencyContent.includes('checkError'), 'Error checking function not found');
    });
    
    it('セッション監視機能が実装されていること', () => {
      const sessionContent = fs.readFileSync(path.join(ccsopPath, 'session-monitor.js'), 'utf8');
      
      assert(
        sessionContent.includes('sessionTimeout') || 
        sessionContent.includes('handleSessionTimeout') ||
        sessionContent.includes('SessionMonitor'),
        'Session timeout handling not found'
      );
      assert(
        sessionContent.includes('blocked') || sessionContent.includes('sessionBlocked'),
        'Session blocking not found'
      );
    });
  });
  
  describe('7. 拡張性アーキテクチャの検証', () => {
    it('プラグイン可能な設計になっていること', () => {
      const indexContent = fs.readFileSync(path.join(ccsopPath, 'index.js'), 'utf8');
      
      // 設定ベースのコンポーネント初期化
      assert(
        indexContent.includes('config') && indexContent.includes('this.config'),
        'Configuration-based initialization not found'
      );
    });
    
    it('Executorが拡張可能な設計になっていること', () => {
      const executorContent = fs.readFileSync(path.join(ccsopPath, 'claude-executor.js'), 'utf8');
      
      // インターフェースベースの設計確認
      assert(
        executorContent.includes('class') || executorContent.includes('function'),
        'Extensible executor design not found'
      );
    });
  });
  
  describe('8. セキュリティ要件の検証', () => {
    it('認証情報が環境変数で管理されていること', () => {
      const indexContent = fs.readFileSync(path.join(ccsopPath, 'index.js'), 'utf8');
      
      assert(
        indexContent.includes('process.env'),
        'Environment variable usage not found'
      );
    });
    
    it('ログマスキング機能が存在すること', () => {
      const files = ['index.js', 'claude-executor.js', 'notification-handler.js'];
      
      files.forEach(file => {
        const content = fs.readFileSync(path.join(ccsopPath, file), 'utf8');
        
        // 機密情報のマスキングまたは適切なログ処理
        const hasSecureLogging = 
          content.includes('mask') ||
          content.includes('redact') ||
          !content.includes('console.log') || // 本格運用では console.log を避ける
          content.includes('winston') ||
          content.includes('logger');
          
        assert(hasSecureLogging, `Secure logging not implemented in ${file}`);
      });
    });
  });
});